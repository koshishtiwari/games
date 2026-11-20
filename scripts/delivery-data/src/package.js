/* ---- cargo crate and parachute: release tumble, chute inflation, swing, landing collapse, dust ---- */
var PK={chute:null,crate:null,chuteU:null,dust:null,dustAge:-1,dustPts:null};
var CHUTE_VS=['uniform float uT,uOpen,uCol;varying vec3 vN;varying float vA;varying float vY;',
'void main(){vec3 p=position;float R=3.6;float rim=1.-smoothstep(0.,.55,p.y/R);float ang=atan(p.z,p.x);',
'p.xz*=1.+.035*sin(uT*2.1+p.y*2.4)+uCol*.5;p.y*=1.+.03*sin(uT*2.1+.6);p.y+=sin(ang*6.+uT*3.)*.14*rim;p.y*=1.-uCol*.9;',
'vN=normal;vA=ang;vY=p.y/R;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}'].join('\n');
var CHUTE_FS=['precision highp float;varying vec3 vN;varying float vA;varying float vY;uniform vec3 uLight;',
'void main(){float pan=step(.5,fract(vA/6.2832*12.+.5));vec3 a=vec3(.96,.45,.16),b=vec3(.96,.92,.84);vec3 c=mix(a,b,pan);',
'float seam=smoothstep(.0,.04,abs(fract(vA/6.2832*12.+.5)-.5)*0.+abs(fract(vA/6.2832*12.)-.5)-.47);c*=1.-.25*seam;',
'c*=uLight*(.8+.35*vY);gl_FragColor=vec4(c,1.);',
'#include <tonemapping_fragment>','#include <colorspace_fragment>','}'].join('\n');
function buildPackage(){
  var g=new THREE.Group();PK.grp=g;
  var c=document.createElement('canvas');c.width=256;c.height=256;var x=c.getContext('2d');x.fillStyle='#b98a52';x.fillRect(0,0,256,256);
  for(var i=0;i<8;i++){x.fillStyle=i%2?'rgba(120,80,40,.25)':'rgba(255,220,170,.12)';x.fillRect(0,i*32,256,30);x.fillStyle='rgba(70,45,20,.5)';x.fillRect(0,i*32,256,2);}
  var r=mulberry(9);for(i=0;i<400;i++){x.fillStyle='rgba(80,50,25,'+r()*.2+')';x.fillRect(r()*256,r()*256,12*r(),1);}
  var tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  var crate=new THREE.Group();PK.crate=crate;
  var box=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.2,1.6),new THREE.MeshPhongMaterial({map:tex,shininess:8}));box.position.y=.6;crate.add(box);
  var strapM=new THREE.MeshPhongMaterial({color:0x2a2d33,shininess:30});
  [-.4,.4].forEach(function(z){var s=new THREE.Mesh(new THREE.BoxGeometry(1.66,1.26,.12),strapM);s.position.set(0,.6,z);crate.add(s);var s2=new THREE.Mesh(new THREE.BoxGeometry(.12,1.26,1.66),strapM);s2.position.set(z,.6,0);crate.add(s2);});
  var edgeM=new THREE.MeshPhongMaterial({color:0x6d4a26,shininess:10});
  [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(function(q){var e=new THREE.Mesh(new THREE.BoxGeometry(.1,1.24,.1),edgeM);e.position.set(q[0]*.8,.6,q[1]*.8);crate.add(e);});
  [.0,1.2].forEach(function(y){[[0,-.8,1.7,.1],[0,.8,1.7,.1]].forEach(function(q){var e=new THREE.Mesh(new THREE.BoxGeometry(1.7,.09,.1),edgeM);e.position.set(0,y,q[1]);crate.add(e);var e2=new THREE.Mesh(new THREE.BoxGeometry(.1,.09,1.7),edgeM);e2.position.set(q[1],y,0);crate.add(e2);});});
  var lc=document.createElement('canvas');lc.width=128;lc.height=64;var lx=lc.getContext('2d');lx.fillStyle='#f5f3ea';lx.fillRect(0,0,128,64);lx.fillStyle='#222';lx.font='700 20px Helvetica,Arial,sans-serif';lx.textAlign='center';lx.fillText('DELIVERY',64,28);lx.fillRect(14,36,100,3);lx.fillRect(14,44,60,3);
  var lt=new THREE.CanvasTexture(lc);lt.colorSpace=THREE.SRGBColorSpace;var label=new THREE.Mesh(new THREE.PlaneGeometry(.9,.45),new THREE.MeshBasicMaterial({map:lt}));label.position.set(0,.7,.83);crate.add(label);
  var inner=new THREE.Group();inner.scale.setScalar(3.4);g.add(inner);inner.add(crate);PK.inner=inner;
  // chute group: canopy hemisphere with panel stripes, 12 suspension lines
  var chute=new THREE.Group();chute.position.y=1.2;PK.chute=chute;
  PK.chuteU={uT:{value:0},uOpen:{value:0},uCol:{value:0},uLight:{value:new THREE.Color(1,1,1)}};
  var cm=new THREE.Mesh(new THREE.SphereGeometry(3.6,36,14,0,Math.PI*2,0,Math.PI*.5),new THREE.ShaderMaterial({uniforms:PK.chuteU,vertexShader:CHUTE_VS,fragmentShader:CHUTE_FS,side:THREE.DoubleSide}));
  cm.position.y=6.2;chute.add(cm);
  var lv=[];for(i=0;i<12;i++){var a=i/12*Math.PI*2;lv.push(Math.cos(a)*3.55,6.3,Math.sin(a)*3.55,Math.cos(a)*.55*(i%3?1:1),0,Math.sin(a)*.55);}
  chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(lv,3)),new THREE.LineBasicMaterial({color:0xf2eee4})));
  inner.add(chute);
  var dg=new THREE.BufferGeometry();PK.dustPts=new Float32Array(14*3);dg.setAttribute('position',new THREE.BufferAttribute(PK.dustPts,3));
  var dc=document.createElement('canvas');dc.width=dc.height=64;var dx=dc.getContext('2d');var gr=dx.createRadialGradient(32,32,2,32,32,30);gr.addColorStop(0,'rgba(210,190,150,.9)');gr.addColorStop(1,'rgba(210,190,150,0)');dx.fillStyle=gr;dx.fillRect(0,0,64,64);
  PK.dust=new THREE.Points(dg,new THREE.PointsMaterial({size:14,map:new THREE.CanvasTexture(dc),transparent:true,depthWrite:false,opacity:0,sizeAttenuation:true}));PK.dust.frustumCulled=false;PK.dust.visible=false;scene.add(PK.dust);
  g.visible=false;scene.add(g);
  return g;
}
function startDust(x,y,z){
  PK.dust.visible=true;PK.dustAge=0;PK.dustO=[x,y,z];PK.dustV=[];for(var i=0;i<14;i++){var a=Math.random()*6.28,s=.8+Math.random()*1.8;PK.dustV.push([Math.cos(a)*s,.4+Math.random()*1.2,Math.sin(a)*s]);}
}
function updateDust(dt){
  if(PK.dustAge<0)return;PK.dustAge+=dt;var t=PK.dustAge,P=PK.dustPts;
  for(var i=0;i<14;i++){P[i*3]=PK.dustO[0]+PK.dustV[i][0]*t*2.2;P[i*3+1]=PK.dustO[1]+.3+PK.dustV[i][1]*Math.min(t,.9)*1.4;P[i*3+2]=PK.dustO[2]+PK.dustV[i][2]*t*2.2;}
  PK.dust.geometry.attributes.position.needsUpdate=true;PK.dust.material.opacity=clamp(1-t/1.6,0,1)*.8;PK.dust.material.size=12+t*10;
  if(t>1.7){PK.dust.visible=false;PK.dustAge=-1;}
}
