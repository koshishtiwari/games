import * as THREE from '/Users/kosh/Documents/Github/pipal/public/games/mr-strange/three.module.min.js';
import { buildForest } from './world/forest.js';
import { level } from './world/level.js';
const scene = new THREE.Scene();
const f = buildForest(scene);
let tris=0, draws=0; scene.traverse(o=>{ if(o.isInstancedMesh){ draws++; tris += (o.geometry.attributes.position.count/3); }});
console.log(f, 'meshes', draws, 'colliders', level.boxes.length);
const g=new Set(); scene.traverse(o=>{if(o.isInstancedMesh) g.add(o.geometry)}); console.log([...g].map(x=>x.attributes.position.count/3));
