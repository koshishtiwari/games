// The world: renderer, scene, lights, sky environment and ground. Deliberately
// empty; everything the game adds later goes into `scene`.
//
// Moody dark blood-twilight atmosphere: a 3D equirectangular sky dome (so the
// moon and clouds stay anchored in world space and never stick to the camera),
// dark smoldering crimson dusk on a deep midnight sky, dark brooding lighting,
// and weathered dark stone flagstone paving.

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
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace  = THREE.SRGBColorSpace;

  const scene  = new THREE.Scene();
  // Equirectangular 3D sky texture: fixed in world space so the moon & clouds NEVER follow the camera
  scene.background = buildSky();
  // Dense dark blood-slate twilight haze: distant towers and deadwood sink into dark wine-black mist
  scene.fog        = new THREE.Fog(0x211016, 26, 110);

  const camera = new THREE.PerspectiveCamera(CFG.camFov, 1, 0.1, 160);
  camera.position.set(0, 2.2, 4.5);

  scene.environment = buildEnvironment(renderer);
  // Moody twilight ambient: muted slate-blue sky above, dark crimson-charcoal ground bounce below
  scene.add(new THREE.HemisphereLight(0x7c92b8, 0x28151c, 0.78));

  // Key moonlight follows the hero so shadows stay sharp and dramatic without washing out the scene
  const key = new THREE.DirectionalLight(0xeae4f2, 1.85);
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

  // Subtle cool edge rim + faint blood-dusk horizon fill
  const rim = new THREE.DirectionalLight(0x688cc8, 1.05);
  rim.position.set(-4, 3.2, -5);
  scene.add(rim);

  const twilightFill = new THREE.DirectionalLight(0xc24430, 0.48);
  twilightFill.position.set(-6, 1.8, 5);
  scene.add(twilightFill);

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

// Dark Souls / Bloodborne late-twilight 360-degree equirectangular sky:
// Abyssal night zenith sinking into a dark smoldering blood-maroon horizon,
// with a fixed world-space moon that stays anchored in the sky.
function buildSky() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // Equirectangular: y = 0 is zenith (+Y), y = 256 is horizon (Y=0), y = 512 is nadir (-Y).
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0.00, '#050711');   // zenith: deep indigo night
  gr.addColorStop(0.20, '#0f1222');   // upper sky: twilight slate
  gr.addColorStop(0.34, '#241423');   // mid sky: dusky plum-maroon
  gr.addColorStop(0.44, '#541a20');   // lower sky: smoldering blood-crimson
  gr.addColorStop(0.49, '#7c2622');   // crimson twilight horizon rim
  gr.addColorStop(0.52, '#211016');   // horizon mist (matches scene.fog 0x211016)
  gr.addColorStop(1.00, '#0a0508');   // nadir
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);

  // Pale blood-moon fixed at a specific world azimuth & elevation
  const mx = 680, my = 184;
  const halo = g.createRadialGradient(mx, my, 4, mx, my, 105);
  halo.addColorStop(0.00, 'rgba(235, 195, 175, 0.36)');
  halo.addColorStop(0.24, 'rgba(175, 85, 75, 0.15)');
  halo.addColorStop(0.58, 'rgba(95, 30, 38, 0.05)');
  halo.addColorStop(1.00, 'rgba(22, 10, 14, 0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);

  const moon = g.createRadialGradient(mx, my, 0, mx, my, 12);
  moon.addColorStop(0.00, 'rgba(245, 228, 215, 0.82)');
  moon.addColorStop(0.75, 'rgba(215, 155, 135, 0.52)');
  moon.addColorStop(1.00, 'rgba(160, 75, 65, 0)');
  g.fillStyle = moon;
  g.beginPath(); g.arc(mx, my, 12, 0, Math.PI * 2); g.fill();

  // Dark cloud banks drifting across the twilight horizon
  let s = 409;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 44; i++) {
    const cx = rnd() * W, cy = 85 + rnd() * 155, rw = 55 + rnd() * 135, rh = 6 + rnd() * 16;
    const isWarm = cy > 185;
    for (const shift of [-W, 0, W]) {
      const x = cx + shift;
      if (x + rw < 0 || x - rw > W) continue;
      const cg = g.createRadialGradient(x, cy, 2, x, cy, rw);
      cg.addColorStop(0, isWarm ? 'rgba(120, 34, 28, 0.14)' : 'rgba(6, 5, 10, 0.36)');
      cg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.save();
      g.translate(x, cy);
      g.scale(1, rh / rw);
      g.fillStyle = cg;
      g.beginPath(); g.arc(0, 0, rw, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Moody twilight procedural studio environment, PMREM-filtered
function buildEnvironment(renderer) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0.00, '#3a4a66');
  sky.addColorStop(0.40, '#2e1c28');
  sky.addColorStop(0.50, '#521c1a');
  sky.addColorStop(0.58, '#170d12');
  sky.addColorStop(1.00, '#070508');
  g.fillStyle = sky; g.fillRect(0, 0, 256, 128);
  const blob = (x, y, r, col) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  blob(70, 34, 44, 'rgba(175,185,220,0.65)');
  blob(192, 54, 56, 'rgba(165,70,55,0.32)');
  blob(130, 112, 60, 'rgba(130,55,35,0.16)');

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose(); pmrem.dispose();
  return rt.texture;
}

// Weathered dark gothic courtyard flagstones
function buildGround(renderer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1e222d';
  g.fillRect(0, 0, 256, 256);

  let s = 73;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

  const rows = 4, cols = 4, sw = 256 / cols, sh = 256 / rows;
  const tones = ['#222632', '#1f232e', '#252936', '#1d202b', '#222430'];
  for (let r = 0; r < rows; r++) {
    const shift = (r & 1) ? sw * 0.5 : 0;
    for (let k = -1; k <= cols; k++) {
      const x = k * sw + shift, y = r * sh;
      g.fillStyle = tones[((r * 7 + k * 3) & 31) % tones.length];
      g.fillRect(x + 2, y + 2, sw - 4, sh - 4);
      g.fillStyle = 'rgba(175, 165, 195, 0.07)';
      g.fillRect(x + 2, y + 2, sw - 4, 1.5);
      g.fillRect(x + 2, y + 2, 1.5, sh - 4);
      g.fillStyle = '#0e1017';
      g.fillRect(x, y, sw, 2.5);
      g.fillRect(x, y, 2.5, sh);
    }
  }

  for (let i = 0; i < 420; i++) {
    const x = rnd() * 256, y = rnd() * 256;
    g.fillStyle = rnd() < 0.55 ? 'rgba(0, 0, 0, 0.14)' : 'rgba(140, 130, 160, 0.04)';
    g.fillRect(x, y, 2 + rnd() * 8, 2 + rnd() * 8);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(95, 95);
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  tex.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 280),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.03, envMapIntensity: 0.28 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}
