import * as THREE from 'three';
import { CAPACITY, RADIUS, NEGATIVE, FREEZE, DOUBLE, EXTRA_MOVE } from './model.mjs';

// The original poker-chip bodies, faces, lights, and flip motion are retained.
export const COLORS = ['#f8fafc','#dc2626','#16a34a','#17181c','#7e22ce','#d51f4a','#66d9fa','#3f3f46','#475569','#16a34a','#15803d','#f59e0b','#edb746','#32c79b','#eeae35','#ffd66a','#34b77c'];

const VIEW_TILT = .83205;
const scratch = new THREE.Object3D(), base = new THREE.Matrix4(), local = new THREE.Matrix4(), matrix = new THREE.Matrix4();
const color = new THREE.Color();
const iceColor = new THREE.Color('#8be5ff');
// Internal lamps use the chip's ink/body color. Black chips light their gold ink.
const LAMP_COLORS = ['#e2faff','#ff2450','#21ff8a','#ffcf68','#c94fff','#ff325d','#69eaff',null,null,null,null,null,'#ffe383','#55ffd0'];
const lampColor = new THREE.Color();

function createBeveledPuckGeometry(radius, height, bevel = 0.055, segments = 56) {
  const h = height / 2;
  const r = radius;
  const b = bevel;
  const points = [
    new THREE.Vector2(0, -h),
    new THREE.Vector2(r - b, -h),
    new THREE.Vector2(r, -h + b),
    new THREE.Vector2(r, h - b),
    new THREE.Vector2(r - b, h),
    new THREE.Vector2(0, h)
  ];
  const geo = new THREE.LatheGeometry(points, segments);
  geo.computeVertexNormals();
  return geo;
}

// Tactile "stamped/debossed" text used on every chip face — a lighter lower
// lip, a dark cavity shadow, then a crisp top layer, so text reads as molded
// into the chip rather than printed flat on top of it.
function stampedText(g, text, fontSize, dark = false, dy = 0) {
  g.font = `900 ${fontSize}px "Lilita One", "SF Pro Rounded", "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (!dark) {
    g.fillStyle = 'rgba(255, 255, 255, 0.38)'; g.fillText(text, 0, dy + 3);
    g.fillStyle = 'rgba(15, 23, 42, 0.85)'; g.fillText(text, 0, dy - 2.5);
    g.fillStyle = 'rgba(0, 0, 0, 0.5)'; g.fillText(text, 0, dy - 1);
    g.fillStyle = '#ffffff'; g.fillText(text, 0, dy + 1);
  } else {
    // Dark variant for light-bodied chips (e.g. the white $1 chip) where
    // white-on-white text would be invisible.
    g.fillStyle = 'rgba(0, 0, 0, 0.28)'; g.fillText(text, 0, dy + 3);
    g.fillStyle = 'rgba(255, 255, 255, 0.75)'; g.fillText(text, 0, dy - 2.5);
    g.fillStyle = 'rgba(255, 255, 255, 0.4)'; g.fillText(text, 0, dy - 1);
    g.fillStyle = '#17181c'; g.fillText(text, 0, dy + 1);
  }
}

// The classic alternating colored dashes around a real poker chip's rim.
function chipRimSpots(g, color, count = 12, inner = 80, outer = 96, alpha = 0.95) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a0 = (i / count) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2 / count) * 0.52;
    g.beginPath();
    g.arc(0, 0, outer, a0, a1);
    g.arc(0, 0, inner, a1, a0, true);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function glyph(g, type) {
  g.save();
  g.translate(128, 128); // 256x256 tile center
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const circle = (x, y, r, fill, stroke) => {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    if (fill) g.fill();
    if (stroke) g.stroke();
  };

  if (type < 5) {
    // Denomination faces (shown before a chip is flipped) — real casino
    // poker-chip look: rim dashes + stripe ring + bold printed value. The
    // chip's actual color comes from the puck body underneath (this tile
    // only draws strokes/text on a transparent background).
    const DENOM = [
      { label: '$1', edge: '#1e293b', dark: true, size: 70 },
      { label: '$5', edge: '#ffffff', dark: false, size: 70 },
      { label: '$25', edge: '#ffffff', dark: false, size: 60 },
      { label: '$100', edge: '#fbbf24', dark: false, size: 48 },
      { label: '$500', edge: '#fde047', dark: false, size: 42 }
    ][type];

    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    circle(0, 0, 96, false, true);

    chipRimSpots(g, DENOM.edge, 12, 80, 96);

    g.lineWidth = 7;
    g.strokeStyle = DENOM.edge;
    g.globalAlpha = 0.95;
    circle(0, 0, 66, false, true);
    g.globalAlpha = 1;

    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    circle(0, 0, 56, false, true);

    stampedText(g, DENOM.label, DENOM.size, DENOM.dark);
  } else if (type === NEGATIVE) {
    // Large ninja stamp. Hazard faces have no rim spots or denomination ring.
    g.shadowColor='rgba(0,0,0,.45)'; g.shadowOffsetY=4;
    g.fillStyle='#101925'; circle(0,-2,82,true,false);
    g.fillStyle='#e84760'; g.beginPath(); g.moveTo(52,-48); g.lineTo(103,-61); g.lineTo(81,-23); g.closePath(); g.fill();
    g.fillStyle='#f16b77'; g.beginPath(); g.roundRect(-77,-44,154,23,9); g.fill();
    g.fillStyle='#efc198'; g.beginPath(); g.roundRect(-60,-18,120,39,15); g.fill();
    g.fillStyle='#18232f'; g.beginPath();g.moveTo(-46,-8);g.lineTo(-13,2);g.lineTo(-40,8);g.closePath();g.fill();
    g.beginPath();g.moveTo(46,-8);g.lineTo(13,2);g.lineTo(40,8);g.closePath();g.fill();
    g.strokeStyle='#425164'; g.lineWidth=4;g.beginPath();g.moveTo(-47,43);g.quadraticCurveTo(0,68,47,43);g.stroke();
  } else if (type === FREEZE) {
    // A faceted ice crystal fills the face.
    g.shadowColor='#276d9b';g.shadowOffsetY=5;
    const points=[[0,-99],[65,-56],[75,39],[0,94],[-75,39],[-65,-56]];
    g.fillStyle='#e9fcff';g.beginPath();points.forEach(([x,y])=>g.lineTo(x,y));g.closePath();g.fill();
    const shades=['#b1efff','#eaffff','#49bfe7','#71d8f4','#249acb','#a0eaff'];
    for(let i=0;i<6;i++){g.fillStyle=shades[i];g.beginPath();g.moveTo(0,-1);g.lineTo(...points[i]);g.lineTo(...points[(i+1)%6]);g.closePath();g.fill();}
    g.shadowColor='transparent';g.strokeStyle='#eaffff';g.lineWidth=4;g.beginPath();g.moveTo(0,-91);g.lineTo(0,82);g.moveTo(-62,-49);g.lineTo(65,34);g.moveTo(62,-49);g.lineTo(-65,34);g.stroke();
  } else if (type === DOUBLE) {
    g.fillStyle='#765016';g.strokeStyle='#fff0b0';g.lineWidth=5;
    for(const x of [-25,25]) {circle(x,0,52,true,true);}
    stampedText(g,'2×',81,true);
  } else if (type === EXTRA_MOVE) {
    g.fillStyle='#103f34';g.strokeStyle='#b3ffe3';g.lineWidth=7;
    g.beginPath();g.moveTo(9,-91);g.lineTo(-53,14);g.lineTo(-5,11);g.lineTo(-17,83);g.lineTo(57,-27);g.lineTo(9,-23);g.closePath();g.fill();g.stroke();
    stampedText(g,'+1',37,false,66);
  } else {
    // Restore the original stamped outcome faces and their clean reverse rim.
    g.lineWidth=2.5;g.strokeStyle='rgba(0,0,0,.35)';circle(0,0,96,false,true);
    g.strokeStyle='rgba(255,255,255,.22)';circle(0,1.5,96,false,true);
    stampedText(g, {7:'STOLEN',8:'1×',9:'2×',10:'3×',11:'5×',14:'6×',15:'10×',16:'4×'}[type], type===7?35:type===15?54:68);
  }
  g.restore();
}

function atlasTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 1280; // Four columns, five rows of 256 px faces.
  const g = canvas.getContext('2d');
  for (let i = 0; i < 17; i++) {
    g.save();
    g.translate((i % 4) * 256, Math.floor(i / 4) * 256);
    glyph(g, i);
    g.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor('#075332');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100);

    const hemi = new THREE.HemisphereLight('#ffffff', '#334155', 1.6);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight('#ffffff', 3.2);
    key.position.set(12, 34, 18);
    key.castShadow = true;
    key.shadow.mapSize.width = 1024; key.shadow.mapSize.height = 1024;
    key.shadow.camera.near = 10; key.shadow.camera.far = 70;
    key.shadow.camera.left = -20; key.shadow.camera.right = 20; key.shadow.camera.top = 20; key.shadow.camera.bottom = -20;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 2.0;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#ffffff', 1.6);
    rim.position.set(-16, 22, -18);
    this.scene.add(rim);

    const fill = new THREE.PointLight('#94a3b8', 1.1, 40);
    fill.position.set(0, 12, 10);
    this.scene.add(fill);

    this.sun = key;

    const floorGeo = new THREE.PlaneGeometry(160, 160);
    const feltCanvas = document.createElement('canvas');
    feltCanvas.width = feltCanvas.height = 256;
    const felt = feltCanvas.getContext('2d');
    const grain = felt.createImageData(256, 256);
    for (let i = 0; i < grain.data.length; i += 4) {
      const shade = 185 + Math.floor(Math.random() * 45);
      grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = shade;
      grain.data[i + 3] = 255;
    }
    felt.putImageData(grain, 0, 0);
    const feltTexture = new THREE.CanvasTexture(feltCanvas);
    feltTexture.wrapS = feltTexture.wrapT = THREE.RepeatWrapping;
    feltTexture.repeat.set(48, 48);
    feltTexture.colorSpace = THREE.SRGBColorSpace;
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#075332', map: feltTexture,
      roughness: 1,
      metalness: 0
    });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Physical 3D beveled chamfer puck geometry catching natural specular highlights
    const geo = createBeveledPuckGeometry(RADIUS, 0.38, 0.055, 56);
    const bodyMat = new THREE.MeshStandardMaterial({
      roughness: 0.16,
      metalness: 0.24
    });
    this.lamp = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.lamp.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('lamp', this.lamp);
    // Emission is independent of the scene lights: the chip acts as a light box.
    bodyMat.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute vec3 lamp; varying vec3 vLamp;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n vLamp = lamp;');
      shader.fragmentShader = 'varying vec3 vLamp;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vLamp * 1.15;');
    };
    this.bodies = new THREE.InstancedMesh(geo, bodyMat, CAPACITY);
    this.bodies.castShadow = true; this.bodies.receiveShadow = true;
    this.bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.scene.add(this.bodies);

    this.atlas = atlasTexture();
    const faceMat = new THREE.ShaderMaterial({
      uniforms: { atlas: { value: this.atlas } },
      vertexShader: `
        attribute float tile;
        varying vec2 vUv;
        varying float vTile;
        void main() {
          vUv = uv;
          vTile = tile;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D atlas;
        varying vec2 vUv;
        varying float vTile;
        void main() {
          float idx = clamp(floor(vTile + 0.5), 0.0, 16.0);
          float col = mod(idx, 4.0);
          float row = floor(idx / 4.0);
          vec2 uv = vec2((col + vUv.x) * 0.25, 1.0 - (row + (1.0 - vUv.y)) * 0.2);
          vec4 tex = texture2D(atlas, uv);
          if (tex.a < 0.05) discard;
          gl_FragColor = tex;
        }
      `,
      transparent: true,
      depthWrite: true,
      depthTest: true
    });

    const faceGeo = new THREE.CircleGeometry(RADIUS * .88, 48);
    const tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    tileAttr.setUsage(THREE.DynamicDrawUsage);
    faceGeo.setAttribute('tile', tileAttr);
    this.faces = new THREE.InstancedMesh(faceGeo, faceMat, CAPACITY);
    this.tiles = tileAttr.array;
    this.scene.add(this.faces);

    // A narrow luminous seam and a small colored spill sit on the chip face.
    // This is additive light, not a translucent tint over the chip artwork.
    const glowGeo = new THREE.PlaneGeometry(RADIUS * 2.8, RADIUS * 2.8);
    glowGeo.setAttribute('lamp', this.lamp);
    this.backlights = new THREE.InstancedMesh(glowGeo, new THREE.ShaderMaterial({
      vertexShader: `attribute vec3 lamp; varying vec3 vLamp; varying vec2 vUv;
        void main(){vLamp=lamp;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec3 vLamp; varying vec2 vUv;
        void main(){
          if(dot(vLamp,vLamp)<.001) discard;
          float r=length(vUv-.5)*2.;
          float seam=exp(-pow((r-.695)/.021,2.));
          float spill=exp(-pow((r-.70)/.125,2.))*.28;
          float inside=(1.-smoothstep(.1,.68,r))*.035;
          float a=seam+spill+inside;
          if(a<.003) discard;
          vec3 hot=mix(vLamp,vec3(1.),seam*.68);
          gl_FragColor=vec4(hot,a);
        }`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
      side:THREE.DoubleSide, toneMapped:false
    }), CAPACITY);
    this.backlights.frustumCulled = false;
    this.scene.add(this.backlights);

    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.point = new THREE.Vector3();
    this.projectPoint = new THREE.Vector3();
    this.screen = { x: 0, y: 0 };
    this.cx = 0; this.cy = 0;
  }
  paintChip(canvas, type) {
    // Use the game's own stamped face, on an enlarged beveled chip body.
    const g=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    g.clearRect(0,0,w,h);g.save();g.translate(w/2,h*.46);g.rotate(-.12);g.scale(w/256,h/290);
    g.shadowColor='rgba(0,0,0,.65)';g.shadowBlur=16;g.shadowOffsetY=14;
    g.fillStyle='#0c1420';g.beginPath();g.ellipse(0,12,110,106,0,0,Math.PI*2);g.fill();
    g.shadowColor='transparent';g.fillStyle=COLORS[type];
    g.beginPath();g.arc(0,0,108,0,Math.PI*2);g.fill();
    const bevel=g.createRadialGradient(-32,-44,9,0,0,110);
    bevel.addColorStop(0,'rgba(255,255,255,.24)');bevel.addColorStop(.72,'rgba(255,255,255,0)');bevel.addColorStop(1,'rgba(0,0,0,.5)');
    g.fillStyle=bevel;g.fill();
    g.strokeStyle='rgba(255,255,255,.35)';g.lineWidth=3;g.beginPath();g.arc(0,0,106,-Math.PI*.95,-Math.PI*.12);g.stroke();
    g.drawImage(this.atlas.image,(type%4)*256,Math.floor(type/4)*256,256,256,-128,-128,256,256);
    g.restore();
  }
  resize(width, height) {
    this.width = width; this.height = height;
    const unit = Math.max(22, Math.min(31, width / 13.4));
    this.halfW = width / unit / 2; this.halfH = height / unit / 2;
    this.camera.left = -this.halfW; this.camera.right = this.halfW; this.camera.top = this.halfH; this.camera.bottom = -this.halfH;
    this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false);
  }
  setCamera(x, y) {
    this.cx = x; this.cy = y; this.camera.position.set(x, 30, y + 20); this.camera.lookAt(x, 0, y); this.camera.updateMatrixWorld();
    this.floor.position.set(x, -.2, y); this.sun.position.set(x - 6, 26, y - 8); this.sun.target.position.set(x, 0, y);
  }
  toWorld(x, y) {
    this.pointer.set(x / this.width * 2 - 1, 1 - y / this.height * 2); this.ray.setFromCamera(this.pointer, this.camera);
    this.ray.ray.intersectPlane(this.plane, this.point); return { x: this.point.x, y: this.point.z };
  }
  project(x, y, lift = .42) {
    this.projectPoint.set(x, lift, y).project(this.camera);
    this.screen.x = (this.projectPoint.x + 1) * this.width / 2; this.screen.y = (1 - this.projectPoint.y) * this.height / 2;
    return this.screen;
  }
  draw(field, time, pressedId, reduced, selected = new Set(), focus = null) {
    let count = 0;
    for (const ch of field.chips) {
      if (!ch.active || Math.abs(ch.x - this.cx) > this.halfW + 2 || Math.abs(ch.y - this.cy) > this.halfH / VIEW_TILT + 3) continue;
      let elapsed = ch.start < 0 ? -1 : (time - ch.start) * (ch.flipSpeed || 1);
      if (focus && focus.source === ch.id && (focus.kind === 'steal' || focus.kind === 'freeze')) elapsed = Math.max(0,focus.age-.12)*.42;
      let flip = 0, lift = 0, scale = 1, side = 1;

      // Every chip is a mystery until flipped now, so every flip gets the
      // same prominent swell-and-reveal animation (not just a rare subset).
      if (elapsed >= 0 && ch.state) {
        if (elapsed < .28) {
          const t = elapsed / .28;
          flip = Math.PI * t;
          lift = Math.sin(Math.PI * t) * (reduced ? .4 : 2.3 + (ch.serial % 4) * .18);
          scale = 1.0 + Math.sin(Math.PI * t) * .52;
        } else if (elapsed < .52) {
          flip = Math.PI;
          const t = (elapsed - .325) / .195;
          lift = (reduced ? .3 : 1.75) + Math.sin(t * Math.PI) * .25;
          scale = 1.48 - t * 0.06;
        } else {
          flip = Math.PI + (elapsed - .52) * 1.8;
          lift = (reduced ? .25 : 1.5) - Math.pow((elapsed - .52) * 4.2, 2);
          scale = Math.max(0, 1.42 - (elapsed - .52) * 2.6);
        }
        side = Math.cos(flip) >= 0 ? 1 : -1;
      }
      if (elapsed > 1.0) continue;
      if (ch.id === pressedId && !ch.state) { scale *= .95; lift -= .04; }
      else if (selected.has(ch.id) && !ch.state) { lift += .08; }
      const age = field.time - ch.birth; if (age >= 0 && age < .3) lift += (1 - age / .3) * .8;
      scratch.position.set(ch.x + (reduced ? 0 : Math.sin(Math.max(0,elapsed)*5) * (ch.toss || 0)), .22 + lift, ch.y); scratch.rotation.set(flip, -ch.angle + (ch.state ? Math.max(0,elapsed)*(ch.toss || 0)*3 : 0), 0); scratch.scale.setScalar(scale); scratch.updateMatrix(); base.copy(scratch.matrix);

      // Denomination color before reveal; outcome color once flipped.
      const isRevealed = ch.state && ch.revealed && ch.outcome >= 0;
      const tile = focus?.source===ch.id && focus.age<.45 ? ch.type : isRevealed ? ch.outcome : ch.type;
      const bodyColorHex = COLORS[tile] || '#007AFF';

      this.bodies.setMatrixAt(count, base);
      color.set(bodyColorHex);
      if (ch.frozen && !ch.state) color.lerp(iceColor, .58);

      this.bodies.setColorAt(count, color);

      // Face tile (no white torus ring!)
      scratch.position.set(0, .205 * side, 0);
      scratch.rotation.set(side > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      matrix.multiplyMatrices(base, scratch.matrix);
      this.faces.setMatrixAt(count, matrix);
      this.tiles[count] = tile;
      // Keep the internal lamp on through the start of the flip, then fade it.
      const focused = focus?.chips.some(c=>c.id===ch.id && c.serial===ch.serial);
      const lit = focused || selected.has(ch.id) || ch.state && elapsed >= 0 && elapsed < .25;
      const power = lit ? (focused ? .8 : elapsed < 0 ? 1 : Math.max(0,1-elapsed/.25)) : 0;
      lampColor.set(LAMP_COLORS[ch.type] || '#e2faff').multiplyScalar(power);
      this.lamp.setXYZ(count,lampColor.r,lampColor.g,lampColor.b);
      scratch.position.set(0, .218 * side, 0);
      scratch.rotation.set(side > 0 ? -Math.PI / 2 : Math.PI / 2,0,0);
      scratch.updateMatrix(); matrix.multiplyMatrices(base,scratch.matrix);
      this.backlights.setMatrixAt(count,matrix);
      count++;
    }
    for (const mesh of [this.bodies, this.faces, this.backlights]) { mesh.count = count; mesh.instanceMatrix.needsUpdate = true; }
    this.lamp.needsUpdate = true;
    this.bodies.instanceColor.needsUpdate = true; this.faces.geometry.attributes.tile.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    return { chips: count, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }
  get viewHalfHeight() { return this.halfH / VIEW_TILT; }
  get bottomLimitY() {
    const hudMarginPx = 12;
    return this.toWorld(this.width / 2, this.height - hudMarginPx).y;
  }
}
