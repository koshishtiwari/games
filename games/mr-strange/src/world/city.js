// The Dark Souls / Bloodborne Gothic Citadel & City:
// Clean, monolithic, seamlessly-colored gothic stone keeps and towers around
// the courtyard.
//
//  * Seamless wall color: window quads share the EXACT same base wall texture
//    and vertex color as the building shaft, so window bays melt into the stone
//    with zero lighter-colored brick patches around them.
//  * Clean, bold gothic silhouettes: monolithic stone masses, corner pilasters,
//    recessed gothic lancet windows, and pitched roofs or watchtower battlements.
//  * Solid AABB collision boxes registered into level.boxes for every building.
//  * Watchtower Spotlights: real THREE.SpotLight + soft custom volumetric light
//    cone (radial & axial falloff, no hard geometric edges) that sweeps the
//    courtyard, tracks you when flying as a bat, turns blood-red on lock, and
//    alerts the high-accuracy rooftop tower sniper archers.

import * as THREE from 'three';
import { level, makeDitherMaterial } from './level.js';
import { lineBlocked } from './collision.js';

// ---- facade atlas -------------------------------------------------------------
const COLS = 4, ROWS = 4, CW = 128, CH = 192;
const CELL = {
  lancetDark: 0,
  lancetAmber: 1,
  lancetMoon: 2,
  lancetDim: 3,
  portalArch: 4,
  portalLit: 5,
  cryptGate: 6,
  plain: 7,
  ashlar: 8,
  lantern: 9,
  cobble: 10,
  slateRoof: 11,
};

// Every wall cell AND every window cell background uses this exact same base tone
// and the exact same vertex color (`o.wall`), so window quads never show a patch!
const WALL_BG = '#adb2be';
const REVEAL  = '#262932';
const TRIM    = '#787d88';

function drawAtlas() {
  const color = document.createElement('canvas');
  const emis = document.createElement('canvas');
  color.width = emis.width = COLS * CW;
  color.height = emis.height = ROWS * CH;
  const g = color.getContext('2d'), e = emis.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, emis.width, emis.height);
  const org = (i) => [(i % COLS) * CW, ((i / COLS) | 0) * CH];

  // Clean, uniform stone background shared by CELL.ashlar and all window/arch cells
  const paintWallBg = (i) => {
    const [ox, oy] = org(i);
    g.fillStyle = WALL_BG;
    g.fillRect(ox, oy, CW, CH);
    let s = 91;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < 140; k++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.03)';
      g.fillRect(ox + r() * CW, oy + r() * CH, 3 + r() * 10, 1 + r() * 3);
    }
  };

  const lancetPath = (ctx, cx, yTop, ySpring, yBot, hw) => {
    ctx.beginPath();
    ctx.moveTo(cx - hw, yBot);
    ctx.lineTo(cx - hw, ySpring);
    ctx.quadraticCurveTo(cx - hw, yTop + (ySpring - yTop) * 0.25, cx, yTop);
    ctx.quadraticCurveTo(cx + hw, yTop + (ySpring - yTop) * 0.25, cx + hw, ySpring);
    ctx.lineTo(cx + hw, yBot);
    ctx.closePath();
  };

  // Clean recessed Gothic lancet window (no bright frame border, melts into wall)
  const drawLancet = (i, topCol, botCol, glow) => {
    paintWallBg(i);
    const [ox, oy] = org(i);
    const cx = ox + 64, yTop = oy + 28, ySpring = oy + 74, yBot = oy + 158;

    // Subtle dark stone reveal
    g.fillStyle = TRIM;
    lancetPath(g, cx, yTop - 4, ySpring, yBot + 2, 27);
    g.fill();
    g.fillStyle = REVEAL;
    lancetPath(g, cx, yTop, ySpring + 1, yBot, 23);
    g.fill();

    // Window pane
    const gr = g.createLinearGradient(0, yTop, 0, yBot);
    gr.addColorStop(0, topCol);
    gr.addColorStop(1, botCol);
    g.fillStyle = gr;
    lancetPath(g, cx, yTop + 4, ySpring + 2, yBot - 3, 19);
    g.fill();

    if (glow) {
      e.save();
      lancetPath(e, cx, yTop + 4, ySpring + 2, yBot - 3, 19);
      e.clip();
      const eg = e.createLinearGradient(0, yTop, 0, yBot);
      eg.addColorStop(0, glow[0]);
      eg.addColorStop(1, glow[1]);
      e.fillStyle = eg;
      e.fillRect(ox + 40, yTop, 48, yBot - yTop);
      e.restore();
    }

    // Simple, clean gothic mullion crossbars
    for (const [ctx, col] of [[g, '#161820'], [e, '#000000']]) {
      ctx.save();
      lancetPath(ctx, cx, yTop + 3, ySpring + 2, yBot - 2, 20);
      ctx.clip();
      ctx.fillStyle = col;
      ctx.fillRect(cx - 1.5, yTop + 4, 3, yBot - yTop);
      ctx.fillRect(cx - 22, ySpring + 18, 44, 3);
      ctx.fillRect(cx - 22, ySpring + 52, 44, 3);
      ctx.restore();
    }

    // Subtle dark sill shadow
    g.fillStyle = TRIM;
    g.fillRect(cx - 29, yBot - 2, 58, 5);
    g.fillStyle = REVEAL;
    g.fillRect(cx - 27, yBot + 3, 54, 4);
  };

  drawLancet(CELL.lancetDark,  '#080a10', '#121622', null);
  drawLancet(CELL.lancetAmber, '#f2b866', '#9e3e12', ['#d89238', '#682006']);
  drawLancet(CELL.lancetMoon,  '#7896b8', '#2a3c54', ['#4c6888', '#1a2838']);
  drawLancet(CELL.lancetDim,   '#5c3c20', '#22140a', ['#3e2410', '#140a04']);

  // Ground-floor Gothic archway / portal
  const drawPortal = (i, kind) => {
    paintWallBg(i);
    const [ox, oy] = org(i);
    const cx = ox + 64, yTop = oy + 26, ySpring = oy + 84, yBot = oy + 186;

    g.fillStyle = TRIM;
    lancetPath(g, cx, yTop - 5, ySpring, yBot, 44);
    g.fill();
    g.fillStyle = REVEAL;
    lancetPath(g, cx, yTop + 2, ySpring + 2, yBot, 38);
    g.fill();

    g.save();
    lancetPath(g, cx, yTop + 8, ySpring + 4, yBot, 33);
    g.clip();

    if (kind === 'gate') {
      const gr = g.createLinearGradient(0, yTop + 8, 0, yBot);
      gr.addColorStop(0, '#050608');
      gr.addColorStop(0.6, '#18100c');
      gr.addColorStop(1, '#3d1d0e');
      g.fillStyle = gr;
      g.fillRect(ox, oy, CW, CH);

      e.save();
      lancetPath(e, cx, yTop + 8, ySpring + 4, yBot, 33);
      e.clip();
      const eg = e.createLinearGradient(0, yTop + 30, 0, yBot);
      eg.addColorStop(0, '#000000');
      eg.addColorStop(0.6, '#220e05');
      eg.addColorStop(1, '#6e2a0c');
      e.fillStyle = eg;
      e.fillRect(ox, oy, CW, CH);
      e.restore();

      for (const [ctx, col] of [[g, '#12141a'], [e, '#000000']]) {
        ctx.save();
        lancetPath(ctx, cx, yTop + 8, ySpring + 4, yBot, 33);
        ctx.clip();
        ctx.fillStyle = col;
        for (let bx = cx - 24; bx <= cx + 24; bx += 12) {
          ctx.fillRect(bx - 1.5, yTop + 8, 3, yBot - yTop);
        }
        for (let by = ySpring + 8; by < yBot; by += 26) {
          ctx.fillRect(cx - 34, by - 1.5, 68, 3);
        }
        ctx.restore();
      }
    } else {
      const gr = g.createLinearGradient(0, yTop + 8, 0, yBot);
      if (kind === 'lit') {
        gr.addColorStop(0, '#d49242');
        gr.addColorStop(1, '#682208');
      } else {
        gr.addColorStop(0, '#070910');
        gr.addColorStop(1, '#131824');
      }
      g.fillStyle = gr;
      g.fillRect(ox, oy, CW, CH);

      if (kind === 'lit') {
        e.save();
        lancetPath(e, cx, yTop + 8, ySpring + 4, yBot, 33);
        e.clip();
        const eg = e.createLinearGradient(0, yTop + 8, 0, yBot);
        eg.addColorStop(0, '#a86820');
        eg.addColorStop(1, '#481404');
        e.fillStyle = eg;
        e.fillRect(ox, oy, CW, CH);
        e.restore();
      }

      for (const [ctx, col] of [[g, '#161820'], [e, '#000000']]) {
        ctx.save();
        lancetPath(ctx, cx, yTop + 8, ySpring + 4, yBot, 33);
        ctx.clip();
        ctx.fillStyle = col;
        ctx.fillRect(cx - 2, yTop + 8, 4, yBot - yTop);
        for (const ty of [ySpring + 12, ySpring + 50]) {
          ctx.fillRect(cx - 34, ty, 68, 3.5);
        }
        ctx.restore();
      }
    }
    g.restore();
  };

  drawPortal(CELL.portalArch, 'dark');
  drawPortal(CELL.portalLit,  'lit');
  drawPortal(CELL.cryptGate,  'gate');

  // Plain cell
  {
    const [ox, oy] = org(CELL.plain);
    g.fillStyle = '#ffffff';
    g.fillRect(ox, oy, CW, CH);
  }

  // Ashlar stone wall cell — identical background to the window cells so they blend 100% seamlessly!
  paintWallBg(CELL.ashlar);

  // Lantern cell
  {
    const [ox, oy] = org(CELL.lantern);
    const gr = g.createRadialGradient(ox + 64, oy + 96, 6, ox + 64, oy + 96, 64);
    gr.addColorStop(0, '#ffebc0');
    gr.addColorStop(0.5, '#e89228');
    gr.addColorStop(1, '#581c06');
    g.fillStyle = gr;
    g.fillRect(ox, oy, CW, CH);
    e.fillStyle = gr;
    e.fillRect(ox, oy, CW, CH);
  }

  // Cobble plinth cell
  paintWallBg(CELL.cobble);

  // Dark slate roof cell
  {
    const [ox, oy] = org(CELL.slateRoof);
    g.fillStyle = '#383d4a';
    g.fillRect(ox, oy, CW, CH);
    for (let y = 0; y < CH; y += 20) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(ox, oy + y, CW, 2);
    }
  }

  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: mk(color), emissiveMap: mk(emis) };
}

// ---- tiny deterministic RNG ---------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---- merged geometry builder --------------------------------------------------
class Mesh {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = [];
    this.n = 0; this.ox = 0; this.oz = 0;
  }
  at(ox, oz) { this.ox = ox; this.oz = oz; }
  vert(x, y, z, n, u, v, col) {
    this.pos.push(this.ox + x, y, this.oz + z);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(col.r, col.g, col.b);
    return this.n++;
  }
  cellUV(cell) {
    const cx = cell % COLS, cy = (cell / COLS) | 0, e = 1.5;
    const u0 = (cx * CW + e) / (COLS * CW), u1 = ((cx + 1) * CW - e) / (COLS * CW);
    const v0 = 1 - ((cy + 1) * CH - e) / (ROWS * CH), v1 = 1 - (cy * CH + e) / (ROWS * CH);
    return [u0, u1, v0, v1];
  }
  quad(p0, p1, p2, p3, n, cell, col) {
    const [u0, u1, v0, v1] = this.cellUV(cell);
    const a = this.vert(p0[0], p0[1], p0[2], n, u0, v0, col);
    const b = this.vert(p1[0], p1[1], p1[2], n, u1, v0, col);
    const c = this.vert(p2[0], p2[1], p2[2], n, u1, v1, col);
    const d = this.vert(p3[0], p3[1], p3[2], n, u0, v1, col);
    this.idx.push(a, b, c, a, c, d);
  }
  tri(p0, p1, p2, n, cell, col) {
    const [u0, u1, v0, v1] = this.cellUV(cell);
    const a = this.vert(p0[0], p0[1], p0[2], n, u0, v0, col);
    const b = this.vert(p1[0], p1[1], p1[2], n, u1, v0, col);
    const c = this.vert(p2[0], p2[1], p2[2], n, (u0 + u1) * 0.5, v1, col);
    this.idx.push(a, b, c);
  }
  box(x0, y0, z0, x1, y1, z1, col, cell = CELL.ashlar) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], cell, col);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], cell, col);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], cell, col);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], cell, col);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], cell, col);
  }
  spire(x0, y0, z0, x1, y1, z1, col, cell = CELL.slateRoof) {
    const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5, h = y1 - y0;
    const hw = (x1 - x0) * 0.5, hd = (z1 - z0) * 0.5;
    const apex = [cx, y1, cz];
    const nz = h / Math.hypot(h, hd), nyz = hd / Math.hypot(h, hd);
    const nx = h / Math.hypot(h, hw), nyx = hw / Math.hypot(h, hw);
    this.tri([x0, y0, z1], [x1, y0, z1], apex, [0, nyz, nz], cell, col);
    this.tri([x1, y0, z0], [x0, y0, z0], apex, [0, nyz, -nz], cell, col);
    this.tri([x1, y0, z1], [x1, y0, z0], apex, [nx, nyx, 0], cell, col);
    this.tri([x0, y0, z0], [x0, y0, z1], apex, [-nx, nyx, 0], cell, col);
  }
  gableRoof(x0, y0, z0, x1, y1, z1, alongZ, col, wallCol) {
    const h = y1 - y0;
    if (alongZ) {
      const cx = (x0 + x1) * 0.5, hw = (x1 - x0) * 0.5;
      const len = Math.hypot(h, hw), nx = h / len, ny = hw / len;
      this.quad([x1, y0, z1], [x1, y0, z0], [cx, y1, z0], [cx, y1, z1], [nx, ny, 0], CELL.slateRoof, col);
      this.quad([x0, y0, z0], [x0, y0, z1], [cx, y1, z1], [cx, y1, z0], [-nx, ny, 0], CELL.slateRoof, col);
      this.tri([x0, y0, z1], [x1, y0, z1], [cx, y1, z1], [0, 0, 1], CELL.ashlar, wallCol);
      this.tri([x1, y0, z0], [x0, y0, z0], [cx, y1, z0], [0, 0, -1], CELL.ashlar, wallCol);
    } else {
      const cz = (z0 + z1) * 0.5, hd = (z1 - z0) * 0.5;
      const len = Math.hypot(h, hd), nz = h / len, ny = hd / len;
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, cz], [x0, y1, cz], [0, ny, nz], CELL.slateRoof, col);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, cz], [x1, y1, cz], [0, ny, -nz], CELL.slateRoof, col);
      this.tri([x1, y0, z1], [x1, y0, z0], [x1, y1, cz], [1, 0, 0], CELL.ashlar, wallCol);
      this.tri([x0, y0, z0], [x0, y0, z1], [x0, y1, cz], [-1, 0, 0], CELL.ashlar, wallCol);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Cohesive, clean dark-gothic stone palette
const WALL_PALETTE = [
  '#353a47', '#3b3642', '#303542', '#40343a',
  '#343c44', '#2e3340', '#3e3736', '#333846',
];
const C = (hex) => new THREE.Color(hex);
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

const FLOOR_H = 3.8, GROUND_H = 6.0, BAY = 3.4, BAY_G = 4.6;
const WIN_W = 2.0, WIN_H = 3.4;
const ARCH_W = 3.0, ARCH_H = 4.6;

function addCollider(x0, y0, z0, x1, y1, z1) {
  level.boxes.push({ x0, y0, z0, x1, y1, z1, color: 0, cap: false, mesh: false });
}

// Rows of gothic windows on one face. Uses the EXACT same vertex color as the wall (`wallCol`)
// so the surrounding quad area blends invisibly into the building wall!
function faceWindows(M, rnd, f, yBase, floors, o) {
  const [O, u, n, len, front] = f;
  const off = 0.035;
  const P = (s, y, cx) => [O[0] + u[0] * (cx + s) + n[0] * off, y, O[2] + u[2] * (cx + s) + n[2] * off];
  const wallCol = o.ground ? o.base : o.wall;

  if (o.ground) {
    const nb = Math.max(1, Math.floor(len / BAY_G)), bw = len / nb;
    for (let k = 0; k < nb; k++) {
      const cx = (k + 0.5) * bw, hw = ARCH_W / 2;
      const isGate = front && k === (nb >> 1);
      const cell = isGate ? CELL.cryptGate : (rnd() < o.lit * 0.55 ? CELL.portalLit : CELL.portalArch);
      M.quad(P(-hw, yBase + 0.15, cx), P(hw, yBase + 0.15, cx), P(hw, yBase + 0.15 + ARCH_H, cx), P(-hw, yBase + 0.15 + ARCH_H, cx), n, cell, wallCol);
    }
    return;
  }

  const nb = Math.max(2, Math.floor(len / BAY)), bw = len / nb;
  for (let fl = 0; fl < floors; fl++) {
    const y0 = yBase + fl * FLOOR_H + (FLOOR_H - WIN_H) / 2 + 0.05;
    for (let k = 0; k < nb; k++) {
      const r = rnd();
      const cell = r < o.lit * 0.48 ? CELL.lancetAmber
                 : r < o.lit * 0.78 ? CELL.lancetDim
                 : r < o.lit        ? CELL.lancetMoon
                 : CELL.lancetDark;
      const cx = (k + 0.5) * bw, hw = WIN_W / 2;
      M.quad(P(-hw, y0, cx), P(hw, y0, cx), P(hw, y0 + WIN_H, cx), P(-hw, y0 + WIN_H, cx), n, cell, wallCol);
    }
  }
}

// Clean, understated gothic stage: monolithic shaft, corner pilasters, simple cornice, roof/spire
function stage(M, rnd, x0, z0, x1, z1, yBase, floors, o) {
  const height = o.ground ? GROUND_H : floors * FLOOR_H;
  const top = yBase + height;
  const wallCol = o.ground ? o.base : o.wall;
  M.box(x0, yBase, z0, x1, top, z1, wallCol, CELL.ashlar);

  const topY = top + (o.ground ? 0 : 0.30);
  addCollider(M.ox + x0 - 0.20, yBase, M.oz + z0 - 0.20, M.ox + x1 + 0.20, topY, M.oz + z1 + 0.20);

  const W = x1 - x0, D = z1 - z0;
  const faces = [
    [[x0, 0, z1], [1, 0, 0], [0, 0, 1], W, o.front === 0],
    [[x1, 0, z0], [-1, 0, 0], [0, 0, -1], W, o.front === 1],
    [[x1, 0, z1], [0, 0, -1], [1, 0, 0], D, o.front === 2],
    [[x0, 0, z0], [0, 0, 1], [-1, 0, 0], D, o.front === 3],
  ];
  for (const f of faces) faceWindows(M, rnd, f, yBase, floors, o);

  // Clean corner pilasters (same stone family, slightly darker/lighter trim)
  const st = o.stone;
  const pw = 0.85, pd = 0.22;
  for (const [cx, cz, sx, sz] of [[x0, z0, -1, -1], [x1, z0, 1, -1], [x0, z1, -1, 1], [x1, z1, 1, 1]]) {
    const ax = sx < 0 ? cx - pd : cx - pw + pd, bx = sx < 0 ? cx + pw - pd : cx + pd;
    const az = sz < 0 ? cz - pd : cz - pw + pd, bz = sz < 0 ? cz + pw - pd : cz + pd;
    M.box(ax, yBase, az, bx, top, bz, st);
  }

  // Simple horizontal stone cornice ledge
  const ledge = (y, out, h, col = st) => M.box(x0 - out, y, z0 - out, x1 + out, y + h, z1 + out, col);
  if (o.ground) {
    ledge(top - 0.55, 0.28, 0.55);
  } else {
    ledge(top - 0.45, 0.28, 0.45);
    ledge(top, 0.42, 0.30);
  }

  // Clean roof silhouette: either a simple steep gothic gable/spire roof, or a clean flat watchtower deck
  if (o.crown && !o.watchtower) {
    const alongZ = D >= W;
    const roofH = Math.min(W, D) * 0.46;
    M.gableRoof(x0 + 0.15, top + 0.30, z0 + 0.15, x1 - 0.15, top + 0.30 + roofH, z1 - 0.15, alongZ, o.roof, o.wall);
    addCollider(M.ox + x0 * 0.75, topY, M.oz + z0 * 0.75, M.ox + x1 * 0.75, topY + roofH * 0.75, M.oz + z1 * 0.75);
  } else if (o.crown && o.watchtower) {
    // Low parapet rim around the flat watchtower roof deck
    const pH = 0.55, pT = 0.32;
    M.box(x0 - 0.1, topY, z1 - pT, x1 + 0.1, topY + pH, z1 + 0.1, st);
    M.box(x0 - 0.1, topY, z0 - 0.1, x1 + 0.1, topY + pH, z0 + pT, st);
    M.box(x1 - pT, topY, z0, x1 + 0.1, topY + pH, z1, st);
    M.box(x0 - 0.1, topY, z0, x0 + pT, topY + pH, z1, st);
    M.box(x0 + 0.2, top + 0.24, z0 + 0.2, x1 - 0.2, top + 0.32, z1 - 0.2, o.roof, CELL.cobble);
  }

  return topY;
}

function building(M, rnd, cx, cz, w, d, H, frontFace, isWatchtower = false) {
  M.at(cx, cz);
  const wall = C(WALL_PALETTE[(rnd() * WALL_PALETTE.length) | 0]);
  const stone = mix(wall, '#464c5a', 0.28);
  const base = mix(wall, '#1a1d24', 0.18);
  const roof = C('#161922');
  const lit = 0.14 + rnd() * 0.18;
  const hw = w / 2, hd = d / 2;
  const o = { wall, stone, base, roof, lit, front: frontFace, watchtower: isWatchtower };

  const floorsTotal = isWatchtower ? 3 : Math.max(4, Math.round((H - GROUND_H) / FLOOR_H));
  let x0 = -hw, x1 = hw, z0 = -hd, z1 = hd;
  let y = stage(M, rnd, x0, z0, x1, z1, 0.20, 1, { ...o, ground: true });

  const cuts = isWatchtower ? [] : (floorsTotal > 13 ? [0.58] : []);
  let used = 0;
  for (let s = 0; s <= cuts.length; s++) {
    const upto = s < cuts.length ? Math.round(floorsTotal * cuts[s]) : floorsTotal;
    const n = Math.max(2, upto - used);
    const last = s === cuts.length;
    y = stage(M, rnd, x0, z0, x1, z1, y, n, { ...o, ground: false, crown: last });
    used += n;
    if (!last) {
      const inset = Math.min(2.2, Math.min(x1 - x0, z1 - z0) * 0.16);
      x0 += inset; x1 -= inset; z0 += inset; z1 -= inset;
    }
  }
  return { topY: y, x0: cx + x0, x1: cx + x1, z0: cz + z0, z1: cz + z1 };
}

function gothicLantern(M, x, z) {
  M.at(0, 0);
  const iron = C('#14161e');
  const stone = C('#282c36');
  M.box(x - 0.26, 0.20, z - 0.26, x + 0.26, 0.90, z + 0.26, stone, CELL.ashlar);
  M.box(x - 0.07, 0.90, z - 0.07, x + 0.07, 4.75, z + 0.07, iron, CELL.plain);
  M.box(x - 0.20, 4.75, z - 0.20, x + 0.20, 5.20, z + 0.20, C('#ffb85c'), CELL.lantern);
  M.spire(x - 0.26, 5.20, z - 0.26, x + 0.26, 5.68, z + 0.26, iron, CELL.plain);
}

// ---- Rooftop Watchtower Searchlights (Real THREE.SpotLight + Soft Volumetric Haze) ----
export const towerSpawns = [];

const VOL_VERT = /* glsl */`
  varying vec3 vLocal;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vLocal = position; // z in [0..1] along beam, xy in [-1..1] scaled by radius
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const VOL_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vLocal;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  uniform float uIntensity;
  void main() {
    float z = clamp(vLocal.z, 0.0, 1.0);
    // Smooth Fresnel edge falloff so the cone silhouette is completely soft (never a hard triangle)
    float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
    float fresnel = smoothstep(0.0, 0.85, ndv);
    fresnel = fresnel * fresnel;
    // Smooth fade out near the lamp housing and gently fade out over distance
    float axial = smoothstep(0.0, 0.08, z) * pow(1.0 - z, 1.6);
    float a = fresnel * axial * uIntensity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

function createWatchtowerSpotlights(scene, towers) {
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x181b24, roughness: 0.5, metalness: 0.5 });

  // High-segment open cone for silky-smooth normals: apex at z=0, base at z=1
  const coneGeo = new THREE.CylinderGeometry(0.04, 1.0, 1.0, 40, 1, true);
  coneGeo.translate(0, -0.5, 0);
  coneGeo.rotateX(Math.PI * 0.5);

  const spots = [];
  const COLOR_SEARCH = new THREE.Color(0xffe0a8);
  const COLOR_TRACK  = new THREE.Color(0xff7830);
  const COLOR_LOCKED = new THREE.Color(0xff1e34);

  for (let i = 0; i < towers.length; i++) {
    const tw = towers[i];
    const baseGroup = new THREE.Group();
    baseGroup.position.set(tw.sx, tw.y, tw.sz);
    scene.add(baseGroup);

    // Searchlight stand & swivel head
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.68, 12), ironMat);
    ped.position.y = 0.34;
    baseGroup.add(ped);

    const head = new THREE.Group();
    head.position.y = 0.80;
    baseGroup.add(head);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.48, 14), ironMat);
    barrel.rotation.x = Math.PI * 0.5;
    head.add(barrel);

    const lensMat = new THREE.MeshBasicMaterial({ color: 0xffe6b8 });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.19, 16), lensMat);
    lens.position.z = 0.245;
    head.add(lens);

    // Soft volumetric light haze cone
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: VOL_VERT,
      fragmentShader: VOL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: COLOR_SEARCH.clone() },
        uIntensity: { value: 0.15 },
      },
    });
    const beam = new THREE.Mesh(coneGeo, beamMat);
    beam.position.z = 0.24;
    beam.frustumCulled = false;
    beam.renderOrder = 6;
    head.add(beam);

    // Real THREE.SpotLight so the searchlight actually illuminates the ground, blocks, and bat!
    const spotLight = new THREE.SpotLight(0xffe0a8, 4.5, 65, 0.24, 0.65, 1.1);
    spotLight.position.set(tw.sx, tw.y + 0.80, tw.sz);
    spotLight.castShadow = false;
    scene.add(spotLight, spotLight.target);

    const homeDir = new THREE.Vector3(-tw.sx, -tw.y * 0.72, -tw.sz).normalize();
    spots.push({
      tw,
      origin: new THREE.Vector3(tw.sx, tw.y + 0.80, tw.sz),
      head,
      beam,
      beamMat,
      lensMat,
      spotLight,
      dir: homeDir.clone(),
      homeYaw: Math.atan2(-tw.sx, -tw.sz),
      phase: i * 1.57,
      alert: 0,
      spotted: false,
    });
  }

  const _toTarget = new THREE.Vector3();
  const _wantDir = new THREE.Vector3();
  const _lookPt = new THREE.Vector3();

  function update(dt, char, templars, time) {
    let anySpotted = false;
    const isBat = !!char.isBat;
    const heroX = char.pos.x, heroY = char.pos.y + (isBat ? 0.92 : 1.05), heroZ = char.pos.z;

    for (const s of spots) {
      const ox = s.origin.x, oy = s.origin.y, oz = s.origin.z;
      _toTarget.set(heroX - ox, heroY - oy, heroZ - oz);
      const dist = _toTarget.length();
      const toHeroDir = _toTarget.multiplyScalar(1 / (dist || 1));

      // When flying as a bat, watchtower spotlights actively swing toward you
      let canTrackBat = false;
      if (isBat && dist < 58) {
        canTrackBat = !lineBlocked(ox, oy, oz, heroX, heroY, heroZ);
      }

      if (canTrackBat) {
        _wantDir.copy(toHeroDir);
        const slewRate = s.spotted ? 5.0 : 2.5;
        s.dir.lerp(_wantDir, 1 - Math.exp(-slewRate * dt)).normalize();
      } else {
        const sweepYaw = s.homeYaw + Math.sin(time * 0.52 + s.phase) * 0.72;
        const sweepPitch = -0.36 + Math.cos(time * 0.38 + s.phase * 1.3) * 0.14;
        const cp = Math.cos(sweepPitch);
        _wantDir.set(Math.sin(sweepYaw) * cp, Math.sin(sweepPitch), Math.cos(sweepYaw) * cp).normalize();
        s.dir.lerp(_wantDir, 1 - Math.exp(-1.8 * dt)).normalize();
      }

      const cosAng = s.dir.dot(toHeroDir);
      const inCone = dist < 56 && cosAng > (isBat ? 0.945 : 0.965) && !lineBlocked(ox, oy, oz, heroX, heroY, heroZ);

      if (isBat && inCone) {
        s.alert = Math.min(1, s.alert + dt * 3.4);
      } else if (canTrackBat && cosAng > 0.86) {
        s.alert = Math.max(0.35, Math.min(0.75, s.alert + dt * 1.4));
      } else {
        s.alert = Math.max(0, s.alert - dt * 1.3);
      }
      s.spotted = isBat && (inCone || s.alert > 0.65);
      if (s.spotted) anySpotted = true;

      _lookPt.copy(s.origin).addScaledVector(s.dir, 25);
      s.head.lookAt(_lookPt);
      s.spotLight.target.position.copy(_lookPt);
      s.spotLight.target.updateMatrixWorld();

      let beamLen = 46;
      if (s.dir.y < -0.05) {
        const tGround = -oy / s.dir.y;
        if (tGround > 2 && tGround < 54) beamLen = tGround;
      }
      if (s.spotted && dist < beamLen) beamLen = dist + 2.5;
      const coneRad = beamLen * (s.spotted ? 0.15 : 0.20);
      s.beam.scale.set(coneRad, coneRad, beamLen);

      const col = s.beamMat.uniforms.uColor.value;
      if (s.alert < 0.5) {
        col.lerpColors(COLOR_SEARCH, COLOR_TRACK, s.alert * 2.0);
      } else {
        col.lerpColors(COLOR_TRACK, COLOR_LOCKED, (s.alert - 0.5) * 2.0);
      }
      s.beamMat.uniforms.uIntensity.value = 0.13 + s.alert * 0.18;
      s.lensMat.color.copy(col);
      s.spotLight.color.copy(col);
      s.spotLight.intensity = 4.5 + s.alert * 6.5;
      s.spotLight.angle = s.spotted ? 0.19 : 0.24;
    }

    char.spottedBySpotlight = anySpotted;
    if (anySpotted && templars && templars.knights) {
      for (const k of templars.knights) {
        if (k.towerArcher && k.down <= 0) {
          k.alertUntil = k.t + 9.0;
          k.sees = true;
          k.knownX = char.pos.x;
          k.knownY = char.pos.y;
          k.knownZ = char.pos.z;
        }
      }
    }
  }

  return { spots, update };
}

export function buildCity(scene, { seed = 77 } = {}) {
  const rnd = rng(seed);
  const M = new Mesh();
  const P = 36, B = 25;
  const MARGIN = 2.4, GAP = 1.5;
  let count = 0;

  towerSpawns.length = 0;
  const watchtowers = [];

  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const bx = i * P, bz = j * P, r = Math.hypot(bx, bz);
    if (r < P - 1 || r > 78) continue;
    M.at(0, 0);
    M.box(bx - B / 2, 0, bz - B / 2, bx + B / 2, 0.20, bz + B / 2, C('#232732'), CELL.cobble);
    M.box(bx - B / 2 - 0.22, 0, bz - B / 2 - 0.22, bx + B / 2 + 0.22, 0.11, bz + B / 2 + 0.22, C('#161920'), CELL.plain);

    const inner = B - 2 * MARGIN;
    const pat = rnd();
    const lots = [];
    const x0 = bx - inner / 2, z0 = bz - inner / 2;
    if (pat < 0.32) lots.push([x0, z0, inner, inner]);
    else if (pat < 0.56) {
      const a = inner * (0.42 + rnd() * 0.18) - GAP / 2;
      lots.push([x0, z0, a, inner], [x0 + a + GAP, z0, inner - a - GAP, inner]);
    } else if (pat < 0.80) {
      const a = inner * (0.42 + rnd() * 0.18) - GAP / 2;
      lots.push([x0, z0, inner, a], [x0, z0 + a + GAP, inner, inner - a - GAP]);
    } else {
      const h = (inner - GAP) / 2;
      lots.push([x0, z0, h, h], [x0 + h + GAP, z0, h, h], [x0, z0 + h + GAP, h, h], [x0 + h + GAP, z0 + h + GAP, h, h]);
    }

    const isCardinalInner = (Math.abs(i) + Math.abs(j) === 1);
    let bestLotIdx = -1, bestDist = Infinity;
    if (isCardinalInner) {
      for (let li = 0; li < lots.length; li++) {
        const [lx, lz, lw, ld] = lots[li];
        const d0 = Math.hypot(lx + lw * 0.5, lz + ld * 0.5);
        if (d0 < bestDist) { bestDist = d0; bestLotIdx = li; }
      }
    }

    for (let li = 0; li < lots.length; li++) {
      const [lx, lz, lw, ld] = lots[li];
      const cx = lx + lw / 2, cz = lz + ld / 2;
      const towardX = -cx, towardZ = -cz;
      const front = Math.abs(towardX) > Math.abs(towardZ) ? (towardX > 0 ? 2 : 3) : (towardZ > 0 ? 0 : 1);
      const isWT = (li === bestLotIdx);
      let H = 18 + rnd() * 26 + (r - P) * 0.45;
      if (rnd() < 0.28) H *= 1.48;
      const info = building(M, rnd, cx, cz, lw, ld, Math.min(H, 84), front, isWT);
      count++;

      if (isWT) {
        const dirX = -cx / (Math.hypot(cx, cz) || 1);
        const dirZ = -cz / (Math.hypot(cx, cz) || 1);
        const sideX = -dirZ, sideZ = dirX;
        const edgeDistX = (lw * 0.5 - 1.65) * dirX;
        const edgeDistZ = (ld * 0.5 - 1.65) * dirZ;
        const sx = cx + edgeDistX - sideX * 1.3;
        const sz = cz + edgeDistZ - sideZ * 1.3;
        const ax = cx + edgeDistX + sideX * 1.3;
        const az = cz + edgeDistZ + sideZ * 1.3;
        const yaw = Math.atan2(-ax, -az);
        watchtowers.push({ cx, cz, y: info.topY, sx, sz, ax, az, yaw });
        towerSpawns.push({ pts: [[ax, az]], y: info.topY, yaw, archer: true, towerArcher: true });
      }
    }

    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      gothicLantern(M, bx + sx * (B / 2 - 0.85), bz + sz * (B / 2 - 0.85));
    }
  }

  const { map, emissiveMap } = drawAtlas();
  const mat = makeDitherMaterial({
    map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.1,
    vertexColors: true, roughness: 0.88, metalness: 0.05, envMapIntensity: 0.30,
  });
  const mesh = new THREE.Mesh(M.build(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);

  const road = new THREE.Mesh(
    new THREE.RingGeometry(25.2, 102, 96, 1),
    new THREE.MeshStandardMaterial({ color: 0x11131a, roughness: 0.94, metalness: 0.02 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.012;
  road.receiveShadow = false;
  scene.add(road);

  const spotlights = createWatchtowerSpotlights(scene, watchtowers);

  return {
    mesh,
    buildings: count,
    triangles: M.idx.length / 3,
    watchtowers,
    update(dt, char, templars, time) {
      spotlights.update(dt, char, templars, time);
    },
  };
}
