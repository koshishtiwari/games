// The world: renderer, scene, lights, sky environment and ground. Deliberately
// empty; everything the game adds later goes into `scene`.

import * as THREE from 'three';
import { CFG } from '../config.js';

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const touchScreen = window.matchMedia('(pointer: coarse)');
  const screenRatio = () => Math.min(window.devicePixelRatio || 1, touchScreen.matches ? 1.5 : CFG.pixelRatioCap);
  let pixelRatio = screenRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace  = THREE.SRGBColorSpace;

  const scene  = new THREE.Scene();
  scene.background = buildSky();
  scene.fog        = new THREE.Fog(0x2a1114, 12, 80);   // maroon haze: distant trunks sink into it as silhouettes

  const camera = new THREE.PerspectiveCamera(CFG.camFov, 1, 0.1, 90);
  camera.position.set(0, 2.2, 4.5);

  scene.environment = buildEnvironment(renderer);
  scene.add(new THREE.HemisphereLight(0xc08a8a, 0x1b1214, 0.7));

  // key light follows the hero so the shadow map stays tight and sharp
  const key = new THREE.DirectionalLight(0xffd0b0, 1.9)   // low red-orange sun;
  key.castShadow = true;
  key.shadow.mapSize.set(CFG.shadowMapSize, CFG.shadowMapSize);
  key.shadow.camera.near =  0.5;
  key.shadow.camera.far  = 16;
  key.shadow.camera.left = -3.0; key.shadow.camera.right =  3.0;
  key.shadow.camera.top  =  3.4; key.shadow.camera.bottom = -1.8;
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.022;
  key.shadow.radius = 2.2;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0xff6a4a, 0.9);
  rim.position.set(-4, 3.2, -5);
  scene.add(rim);

  scene.add(buildGround(renderer));

  function followLight(p) {
    key.position.set(p.x + 3.0, p.y * 0.5 + 5.6, p.z + 2.4);
    key.target.position.set(p.x, p.y * 0.5, p.z);
    key.target.updateMatrixWorld();
  }

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    pixelRatio = Math.min(pixelRatio, screenRatio());
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // portrait is tall and narrow: widen a little so the whole character fits
    camera.fov = camera.aspect < 1 ? CFG.camFov + 11 : CFG.camFov;
    camera.updateProjectionMatrix();
  }
  let windowTime = 0, samples = 0, missed = 0, stableTime = 0;
  function trackFrame(seconds) {
    if (document.hidden || seconds <= 0 || seconds >= 0.10) return;
    windowTime += seconds;
    samples++;
    if (seconds > 0.021) missed++;
    if (windowTime < 1.25) return;

    const max = screenRatio(), min = Math.min(1, max);
    let ratio = pixelRatio;
    if (missed > samples * 0.25 && windowTime / samples > 0.020) {
      ratio = Math.max(min, pixelRatio - 0.25);
      stableTime = 0;
    } else if (missed < samples * 0.10 && windowTime / samples < 0.018) {
      stableTime += windowTime;
      if (stableTime >= 8) {
        ratio = Math.min(max, pixelRatio + 0.25);
        stableTime = 0;
      }
    } else {
      stableTime = 0;
    }
    windowTime = samples = missed = 0;
    if (ratio !== pixelRatio) {
      pixelRatio = ratio;
      renderer.setPixelRatio(pixelRatio);
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, followLight, resize, trackFrame };
}

// the red-orange noir sky: a vertical gradient, drawn behind everything
function buildSky() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0.00, '#1d0709');
  gr.addColorStop(0.40, '#5a1410');
  gr.addColorStop(0.75, '#a82d14');
  gr.addColorStop(1.00, '#d4531f');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// a tiny procedural studio, PMREM-filtered (no assets)
function buildEnvironment(renderer) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0.00, '#9fc4e8');
  sky.addColorStop(0.46, '#4a5e75');
  sky.addColorStop(0.52, '#20262f');
  sky.addColorStop(1.00, '#0b0f15');
  g.fillStyle = sky; g.fillRect(0, 0, 256, 128);
  const blob = (x, y, r, col) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  blob(70, 34, 44, 'rgba(255,255,255,0.95)');
  blob(192, 48, 52, 'rgba(120,180,255,0.40)');
  blob(130, 112, 60, 'rgba(90,120,150,0.22)');

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose(); pmrem.dispose();
  return rt.texture;
}

// forest floor: dark loam with moss patches and leaf litter, painted once
function buildGround(renderer) {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = '#11160f'; g.fillRect(0, 0, N, N);
  const blob = (col, n, rmin, rmax, a) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * N, y = rnd() * N, r = rmin + rnd() * (rmax - rmin);
      g.fillStyle = col; g.globalAlpha = a;
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {   // wrap so it tiles
        g.beginPath(); g.arc(x + ox, y + oy, r, 0, 6.2832); g.fill();
      }
    }
  };
  blob('#1b2616', 70, 8, 26, 0.35);      // moss
  blob('#0a0d09', 60, 6, 20, 0.45);      // wet shadow
  blob('#2a2418', 160, 1.5, 4, 0.55);    // leaf litter
  blob('#3a3020', 80, 1, 2.5, 0.5);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(34, 34);
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  tex.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0.0, envMapIntensity: 0.08 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}
