/* ---- airport scene: built when near, disposed when far. Runway from real heading and OSM length (scaled to the aircraft). ---- */
var AIR={g:null,id:-1,lampU:null,sock:null,wind:0,slope:0,len:40};
function rwyTex(a,len){
  var c=document.createElement('canvas');c.width=128;c.height=1024;var x=c.getContext('2d');
  x.fillStyle='#3a3d42';x.fillRect(0,0,128,1024);
  for(var i=0;i<900;i++){x.fillStyle='rgba('+(30+Math.random()*30|0)+','+(30+Math.random()*30|0)+','+(34+Math.random()*30|0)+',.25)';x.fillRect(Math.random()*128,Math.random()*1024,2,6);}
  x.fillStyle='#ecece4';
  x.fillRect(3,0,3,1024);x.fillRect(122,0,3,1024);
  for(i=0;i<22;i++)x.fillRect(61,90+i*40,6,24); // centre line dashes
  [[24,0],[1024-24-0,1]].forEach(function(t){for(var k=0;k<8;k++){x.fillRect(14+k*13,t[1]?1000-40:24,6,40);}});
  [[200,0],[1024-200-30,1]].forEach(function(t){x.fillRect(30,t[0],8,26);x.fillRect(90,t[0],8,26);});
  [[300,0],[1024-300-30,1]].forEach(function(t){x.fillRect(38,t[0],6,18);x.fillRect(84,t[0],6,18);});
  var n1=Math.round(((a.hdg%360)+360)%360/10)||36,n2=((n1+17)%36)+1;
  function pad(n){return (n<10?'0':'')+n;}
  x.font='700 58px Helvetica,Arial,sans-serif';x.textAlign='center';
  x.save();x.translate(64,120);x.rotate(0);x.fillText(pad(n2),0,0);x.restore(); // far end (top of the texture)
  x.save();x.translate(64,1024-150);x.scale(1,-1);x.rotate(0);x.restore();
  x.save();x.translate(64,1024-70);x.fillText(pad(n1),0,0);x.restore();
  var t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
function buildAirportScene(a){
  var KS=HUMAN_K/62,g=new THREE.Group(),len=a.len/KS,slope=a.slope||0,RWW=30*.01*62; // authored at K=62; the whole scene is scaled by KS to the current HUMAN_K
  AIR.slope=slope;AIR.len=a.len;AIR.KS=KS;AIR.hw=RWW*KS/2;
  var base=a.elev*VEX,M=function(c,s){return new THREE.MeshPhongMaterial({color:c,shininess:s||20,flatShading:true});};
  // runway: sloped (Lukla rises toward the mountain end), local -z is the take-off direction
  var rg=new THREE.PlaneGeometry(RWW,len,1,12);rg.rotateX(-Math.PI/2);
  var pos=rg.attributes.position;for(var i=0;i<pos.count;i++){var z=pos.getZ(i);pos.setY(i,.14-slope*(-z)); }
  rg.computeVertexNormals();
  var rm=new THREE.Mesh(rg,new THREE.MeshPhongMaterial({map:rwyTex(a,len),shininess:12,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));g.add(rm);
  var shoulder=new THREE.Mesh(new THREE.PlaneGeometry(RWW+4,len+3,1,12),new THREE.MeshPhongMaterial({color:0x6b6a62,shininess:5,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));shoulder.geometry.rotateX(-Math.PI/2);
  var sp=shoulder.geometry.attributes.position;for(i=0;i<sp.count;i++)sp.setY(i,.1-slope*(-sp.getZ(i)));g.add(shoulder);
  if(slope>0){ // embankment under the raised end and the mountain wall behind it
    var emb=new THREE.Mesh(new THREE.BoxGeometry(RWW+3,slope*len/2+3,len),M(0x7a6e5c));emb.position.set(0,(slope*len/2-3)/2-1.5+slope*len/4-slope*len/4,0);emb.visible=false;
    var wall=new THREE.Mesh(new THREE.BoxGeometry(22,16,5),M(0x6f6a62));wall.position.set(0,slope*len/2+7,len/2+3.5);g.add(wall);
    var wall2=new THREE.Mesh(new THREE.BoxGeometry(10,10,6),M(0x7b756b));wall2.position.set(-9,slope*len/2+3,len/2+1);g.add(wall2);
    var cliff=new THREE.Mesh(new THREE.BoxGeometry(RWW+10,4,2),M(0x5e5a52));cliff.position.set(0,-slope*len/2-2.2,-len/2-1.2);g.add(cliff);
  }
  // taxiway and apron
  var tw=new THREE.Mesh(new THREE.PlaneGeometry(3,len*.34),M(0x55585d));tw.geometry.rotateX(-Math.PI/2);tw.position.set(RWW/2+5.5,.13-slope*(len*.1),-len*.1);g.add(tw);
  var tl=new THREE.Mesh(new THREE.PlaneGeometry(5,3),M(0x55585d));tl.geometry.rotateX(-Math.PI/2);tl.position.set(RWW/2+2.8,.13,len*.07-len*.1*0);g.add(tl);
  var ap=new THREE.Mesh(new THREE.PlaneGeometry(30,20),M(0x5d6066));ap.geometry.rotateX(-Math.PI/2);ap.position.set(RWW/2+22,.13,len*.1);g.add(ap);
  // terminal, tower, hangars
  var term=new THREE.Mesh(new THREE.BoxGeometry(22,4,7),M(0xd9d4c8));term.position.set(RWW/2+36,2,len*.1);g.add(term);
  var glass=new THREE.Mesh(new THREE.BoxGeometry(22.2,1.4,.3),new THREE.MeshPhongMaterial({color:0x12202e,shininess:200}));glass.position.set(RWW/2+36,2.4,len*.1-3.6);g.add(glass);
  var roof=new THREE.Mesh(new THREE.BoxGeometry(23,.5,8.5),M(0x8a8f96));roof.position.set(RWW/2+36,4.2,len*.1);g.add(roof);
  var tower=new THREE.Mesh(new THREE.CylinderGeometry(.9,1.2,12,10),M(0xe3dfd5));tower.position.set(RWW/2+27,6,len*.1+8);g.add(tower);
  var cab=new THREE.Mesh(new THREE.BoxGeometry(3.2,2,3.2),new THREE.MeshPhongMaterial({color:0x1d3042,shininess:150,transparent:true,opacity:.85}));cab.position.set(RWW/2+27,13,len*.1+8);g.add(cab);
  var cabr=new THREE.Mesh(new THREE.BoxGeometry(3.8,.3,3.8),M(0xdedad0));cabr.position.set(RWW/2+27,14.2,len*.1+8);g.add(cabr);
  var beacon=new THREE.Mesh(new THREE.SphereGeometry(.25,8,6),new THREE.MeshBasicMaterial({color:0xffffff}));beacon.position.set(RWW/2+27,14.8,len*.1+8);g.add(beacon);AIR.beacon=beacon;beacon.userData.keep=true;
  for(i=0;i<2;i++){var hg=new THREE.CylinderGeometry(4.2,4.2,14,14,1,false,0,Math.PI);hg.rotateZ(Math.PI/2);hg.rotateY(Math.PI/2);var hm=new THREE.Mesh(hg,M(i?0x8e9aa6:0xa0a79b));hm.rotation.set(0,0,0);hm.position.set(RWW/2+20+i*11,0,len*.1+14);g.add(hm);
    var door=new THREE.Mesh(new THREE.PlaneGeometry(7,3.6),M(0x30353b));door.position.set(RWW/2+20+i*11,1.9,len*.1+14-7.05);g.add(door);}
  // windsock
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(.08,.1,4,6),M(0xdddddd));pole.position.set(-RWW/2-4,2,-len*.25);g.add(pole);
  var sock=new THREE.Group();sock.position.set(-RWW/2-4,4,-len*.25);var cone=new THREE.Mesh(new THREE.ConeGeometry(.3,1.5,10,1,true),new THREE.MeshPhongMaterial({color:0xff6a2b,side:THREE.DoubleSide,flatShading:true}));cone.rotation.z=-Math.PI/2;cone.position.x=.75;sock.add(cone);g.add(sock);AIR.sock=sock;sock.userData.keep=true;
  // parked aircraft (low-poly), fuel trucks, crew
  function parked(x,z,rot,col){var p=new THREE.Group();var f=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.6,9),M(0xeeeeea));p.add(f);var w=new THREE.Mesh(new THREE.BoxGeometry(12,.25,1.8),M(0xdedede));w.position.set(0,1,-.5);p.add(w);var t=new THREE.Mesh(new THREE.BoxGeometry(.2,2.8,1.6),M(col));t.position.set(0,1.8,4);p.add(t);var s=new THREE.Mesh(new THREE.BoxGeometry(3.6,.2,1),M(0xdedede));s.position.set(0,.9,4);p.add(s);
    [-1,1].forEach(function(q){var n=new THREE.Mesh(new THREE.CylinderGeometry(.35,.4,2,8),M(0xcccccc));n.rotation.x=Math.PI/2;n.position.set(q*3.6,1,-1.3);p.add(n);var wh=new THREE.Mesh(new THREE.CylinderGeometry(.4,.4,.3,10),M(0x111111));wh.rotation.z=Math.PI/2;wh.position.set(q*1.1,-.9,.3);p.add(wh);});
    p.position.set(x,1.6,z);p.rotation.y=rot;g.add(p);}
  parked(RWW/2+15,len*.04,.4,0xc8262c);parked(RWW/2+25,len*.16,-.3,0x1f4f9e);
  function truck(x,z,rot){var t=new THREE.Group();var cabm=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.4,1.6),M(0xdd3b2c));cabm.position.set(0,1,-1.7);t.add(cabm);var tank=new THREE.Mesh(new THREE.CylinderGeometry(.9,.9,4,12),M(0xe8e6dd));tank.rotation.x=Math.PI/2;tank.position.set(0,1.2,.8);t.add(tank);
    [-1,1].forEach(function(q){[-1.3,1.3].forEach(function(zz){var w=new THREE.Mesh(new THREE.CylinderGeometry(.4,.4,.3,8),M(0x101010));w.rotation.z=Math.PI/2;w.position.set(q*.85,.4,zz);t.add(w);});});t.position.set(x,.1,z);t.rotation.y=rot;g.add(t);}
  truck(RWW/2+12,len*.12,1.3);truck(RWW/2+30,len*.02,-.4);
  for(i=0;i<4;i++){var cr=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.9,6),M(0xff8a1c));cr.position.set(RWW/2+17+i*.8,.55,len*.07+(i%2)*.6);g.add(cr);}
  // perimeter fence and lamp posts
  var fv=[],fx0=-RWW/2-9,fx1=RWW/2+50,fz0=-len/2-6,fz1=len/2+22;
  [[fx0,fz0,fx1,fz0],[fx1,fz0,fx1,fz1],[fx1,fz1,fx0,fz1],[fx0,fz1,fx0,fz0]].forEach(function(q){var L=Math.hypot(q[2]-q[0],q[3]-q[1]),n=Math.ceil(L/3);for(var k=0;k<=n;k++){var t=k/n,x=q[0]+(q[2]-q[0])*t,z=q[1]+(q[3]-q[1])*t;fv.push(x,0,z,x,1.3,z);if(k<n){var t2=(k+1)/n,x2=q[0]+(q[2]-q[0])*t2,z2=q[1]+(q[3]-q[1])*t2;fv.push(x,1.3,z,x2,1.3,z2,x,.7,z,x2,.7,z2);}}});
  var fence=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(fv,3)),new THREE.LineBasicMaterial({color:0x9aa0a6,transparent:true,opacity:.7}));g.add(fence);
  var lp=[],lamps=[];
  for(i=0;i<7;i++){var lx=RWW/2+12+i*5,lz=len*.1-12+(i%2)*26;lp.push(lx,0,lz,lx,3.6,lz);lamps.push(lx,3.7,lz);}
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(lp,3)),new THREE.LineBasicMaterial({color:0x888d93})));
  // runway edge lights and PAPI
  var el=[],ec=[];for(i=0;i<=Math.floor(len/2.4);i++){var z2=-len/2+i*2.4;[-1,1].forEach(function(s){el.push(s*(RWW/2+.5),.35-slope*(-z2),z2);ec.push(1,.95,.8);});}
  for(i=0;i<8;i++){[-1,1].forEach(function(s){el.push(s*(RWW/2-.4+i*.0),.35-slope*(len/2),-len/2+.3+i*.4);ec.push(.3,1,.4);});}
  lamps.forEach(function(v,idx){el.push(v);if(idx%3===2){}});
  for(i=0;i<lamps.length;i+=3){ec.push(1,.85,.55);}
  var lg=new THREE.BufferGeometry();lg.setAttribute('position',new THREE.Float32BufferAttribute(el,3));lg.setAttribute('aCol',new THREE.Float32BufferAttribute(ec,3));
  AIR.lampU={uK:{value:230},uOn:{value:0}};
  var lights=new THREE.Points(lg,new THREE.ShaderMaterial({uniforms:AIR.lampU,vertexShader:PT_VS,fragmentShader:PT_FS,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));lights.frustumCulled=false;g.add(lights);
  for(i=0;i<4;i++){[-1,1].forEach(function(s){var pb=new THREE.Mesh(new THREE.BoxGeometry(.5,.35,.5),new THREE.MeshBasicMaterial({color:i<2?0xffffff:0xff3a2a}));pb.position.set(-(RWW/2+3+i*.7),.3-slope*(len/2-4),len/2-4);if(s>0)return;g.add(pb);});}
  var pp=lonLatToWorld(a.lon,a.lat);
  mergeStatic(g,function(p){return p===rm||p===shoulder;},true);
  g.traverse(function(o){o.frustumCulled=false;});
  var root=new THREE.Group();g.scale.setScalar(KS);root.add(g);root.position.set(pp.x,base,pp.z);root.rotation.y=-a.hdg*Math.PI/180;scene.add(root);AIR.g=root;AIR.baseY=base;AIR.hdg=-a.hdg*Math.PI/180;AIR.cx=pp.x;AIR.cz=pp.z;
}
function disposeAirportScene(){
  if(!AIR.g)return;scene.remove(AIR.g);
  AIR.g.traverse(function(o){if(o.geometry)o.geometry.dispose();if(o.material){if(o.material.map)o.material.map.dispose();o.material.dispose();}});AIR.g=null;
}
function rwyLocal(x,z){var dx=x-AIR.cx,dz=z-AIR.cz,c=Math.cos(AIR.hdg),s=Math.sin(AIR.hdg);return {lx:dx*c-dz*s,lz:dx*s+dz*c};} // inverse of rotation.y
function runwayY(x,z){ // surface height under (x,z) when on the runway strip, else NaN
  if(!AIR.g)return NaN;var l=rwyLocal(x,z);if(Math.abs(l.lx)>AIR.hw+.6||Math.abs(l.lz)>AIR.len/2+1.5)return NaN;
  return AIR.baseY+.14*AIR.KS-AIR.slope*(-clamp(l.lz,-AIR.len/2,AIR.len/2));
}
function updateAirports(t){
  if(!META)return;
  var want=null,best=1e9;
  META.airports.forEach(function(a,i){if(a.wx===undefined){var p=lonLatToWorld(a.lon,a.lat);a.wx=p.x;a.wz=p.z;}var d=Math.hypot(px-a.wx,pz-a.wz);if(d<best){best=d;want=i;}});
  if(want!==null&&best<520&&AIR.id!==want){disposeAirportScene();buildAirportScene(META.airports[want]);AIR.id=want;}
  else if(AIR.id>=0&&best>820){disposeAirportScene();AIR.id=-1;}
  if(AIR.g){
    AIR.wind=.6+.5*Math.sin(t*.13)+.2*Math.sin(t*.41);AIR.sock.rotation.y=AIR.wind+Math.sin(t*3)*.05;AIR.sock.children[0].rotation.x=Math.sin(t*5)*.06;
    AIR.lampU.uOn.value=clamp(SK.night*1.7,0,1);AIR.beacon.visible=Math.floor(t*1.2)%2===0;
  }
}
