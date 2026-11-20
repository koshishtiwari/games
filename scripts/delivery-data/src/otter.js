/* ---- DHC-6 Twin Otter: detailed procedural model (generic livery, no marks), animated control surfaces, gear and props ---- */
var jet,props=[],navL={},strobes=[],PSC=HUMAN_K/100,AF={},PROP_RPM=0,landBeam={material:{opacity:0}};
function panelTexture(){
  var c=document.createElement('canvas');c.width=1024;c.height=512;var x=c.getContext('2d');
  x.fillStyle='#f4f4ef';x.fillRect(0,0,1024,512);
  var g=x.createLinearGradient(0,0,0,512);g.addColorStop(0,'rgba(255,255,255,.0)');g.addColorStop(1,'rgba(120,120,110,.16)');x.fillStyle=g;x.fillRect(0,0,1024,512);
  x.strokeStyle='rgba(150,150,142,.55)';x.lineWidth=1.2;
  for(var i=0;i<=1024;i+=128){x.beginPath();x.moveTo(i,0);x.lineTo(i,512);x.stroke();}
  for(i=0;i<=512;i+=96){x.beginPath();x.moveTo(0,i);x.lineTo(1024,i);x.stroke();}
  x.fillStyle='rgba(120,120,112,.55)';
  for(i=0;i<1024;i+=16){for(var j=0;j<=512;j+=96){x.fillRect(i,j-2,1.6,1.6);x.fillRect(i,j+2,1.6,1.6);}}
  for(j=0;j<512;j+=16){for(i=0;i<=1024;i+=128){x.fillRect(i-2,j,1.6,1.6);x.fillRect(i+2,j,1.6,1.6);}}
  var r=mulberry(77);for(i=0;i<500;i++){x.fillStyle='rgba(90,90,80,'+(.02+r()*.05)+')';x.beginPath();x.arc(r()*1024,r()*512,2+r()*14,0,7);x.fill();}
  var t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=2;return t;
}
function buildJet(){
  jet=new THREE.Group();jet.rotation.order='YXZ';
  var body=new THREE.Group();body.scale.setScalar(PSC);jet.add(body);AF.body=body;
  var tex=panelTexture();
  var M=function(c,s,f,m){return new THREE.MeshPhongMaterial({color:c,shininess:s||60,flatShading:!!f,side:THREE.DoubleSide,map:m||null});};
  var WHITE=M(0xffffff,90,false,tex),WHITE2=M(0xe2e2dc,60,false,tex),RED=M(0xc8262c,70),BLUE=M(0x1f4f9e,70),DARK=M(0x1b2026,40),GREY=M(0x707a84,70),TYRE=M(0x121417,8),RUBB=M(0x2a2d31,10);
  var GLASS=new THREE.MeshPhongMaterial({color:0x0e1a26,shininess:240,transparent:true,opacity:.58,side:THREE.DoubleSide,specular:0x99bbdd});
  var INT=M(0x2c2f34,20),SEAT=M(0x3b4552,20);
  function ringPts(s,n){var p=[],yc=(s.t+s.b)/2,hh=(s.t-s.b)/2,e=2/(s.n||4);for(var i=0;i<n;i++){var a=i/n*Math.PI*2+Math.PI/2,cx=Math.cos(a),sy=Math.sin(a);p.push([s.w*Math.sign(cx)*Math.pow(Math.abs(cx),e),yc+hh*Math.sign(sy)*Math.pow(Math.abs(sy),e)]);}return p;}
  function loft(secs,mat,n){
    n=n||20;var v=[],uv=[],idx=[],z0=secs[0].z,z1=secs[secs.length-1].z;
    secs.forEach(function(s){ringPts(s,n).concat([ringPts(s,n)[0]]).forEach(function(p,i){v.push(p[0],p[1],s.z);uv.push((s.z-z0)/(z1-z0)*2.2,i/n*1.0);});});
    var rs=n+1;
    for(var i=0;i<secs.length-1;i++)for(var k=0;k<n;k++){var a=i*rs+k,b=a+1,c=(i+1)*rs+k,d=c+1;idx.push(a,c,b,b,c,d);}
    var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return new THREE.Mesh(g,mat);
  }
  function airfoil(chord,thick,n){var up=[],lo=[];for(var i=0;i<=n;i++){var s=Math.pow(i/n,1.6),t=thick*5*(.2969*Math.sqrt(s)-.126*s-.3516*s*s+.2843*s*s*s-.1015*s*s*s*s);up.push([s*chord,t+.02*(1-s)*thick*4]);lo.push([s*chord,-t*.85]);}return up.concat(lo.reverse().slice(1,-1));}
  function wingHalf(side,mat){
    var st=[[.9,2.0,.36,-.55],[4,1.85,.3,-.5],[7.8,1.62,.22,-.4],[9.9,1.45,.12,-.33]],verts=[],uv=[],idx=[],np=0;
    st.forEach(function(s,si){var pts=airfoil(s[1]*.7,s[2],10);np=pts.length;pts.forEach(function(p,pi){verts.push(side*s[0],p[1],s[3]+p[0]);uv.push(s[0]/10*3,pi/np*1.5);});});
    for(var i=0;i<st.length-1;i++)for(var k=0;k<np;k++){var a=i*np+k,b=i*np+(k+1)%np,c=(i+1)*np+k,d=(i+1)*np+(k+1)%np;if(side>0)idx.push(a,c,b,b,c,d);else idx.push(a,b,c,b,d,c);}
    var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return new THREE.Mesh(g,mat);
  }
  function surf(x0,x1,zh0,zh1,ch0,ch1,mat,th){ // control surface: hinge group at the trailing edge line, panel extends backwards
    var grp=new THREE.Group();grp.position.set((x0+x1)/2,1.52,(zh0+zh1)/2);
    var hx=Math.abs(x1-x0)/2,v=[-hx,0,0,hx,0,0,hx,0,ch1,-hx,0,ch0],g=new THREE.BufferGeometry();
    var p=[];[[-hx,th,0],[hx,th,0],[hx,th*.3,ch1],[-hx,th*.3,ch0],[-hx,-th,0],[hx,-th,0],[hx,-th*.3,ch1],[-hx,-th*.3,ch0]].forEach(function(q){p.push(q[0],q[1],q[2]);});
    g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex([0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0]);
    var uvs=[];for(var i=0;i<8;i++)uvs.push(p[i*3]*.2,p[i*3+2]*.4);g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.computeVertexNormals();
    var m=new THREE.Mesh(g,mat);grp.add(m);body.add(grp);return grp;
  }
  // fuselage: smooth rounded-box loft, snub nose, upswept tail cone
  var fus=loft([{z:-6.3,w:.46,t:.42,b:-.72,n:2.6},{z:-5.9,w:.7,t:.72,b:-.9,n:3},{z:-5.3,w:.9,t:1.0,b:-1.0,n:3.4},{z:-4.4,w:1.04,t:1.2,b:-1.1,n:4},{z:-3.9,w:1.06,t:1.22,b:-1.1,n:4.2},{z:4.4,w:1.06,t:1.22,b:-1.1,n:4.2},{z:5.4,w:.96,t:1.16,b:-.98,n:3.6},{z:6.8,w:.66,t:.95,b:-.62,n:3},{z:8.2,w:.36,t:.72,b:-.3,n:2.6},{z:9.4,w:.14,t:.52,b:-.04,n:2.2}],WHITE,22);
  body.add(fus);AF.fus=fus;
  [-1,1].forEach(function(s){
    // stripes follow the fuselage skin
    [[-.05,RED],[-.34,BLUE]].forEach(function(a){var st=new THREE.Mesh(new THREE.BoxGeometry(.035,.2,10.4),a[1]);st.position.set(s*1.068,a[0],.55);body.add(st);});
    for(var i=0;i<7;i++){var w=new THREE.Mesh(new THREE.BoxGeometry(.04,.4,.6),GLASS);w.position.set(s*1.066,.58,-2.2+i*1.0);body.add(w);
      var fr=new THREE.Mesh(new THREE.BoxGeometry(.045,.46,.68),RUBB);fr.position.set(s*1.062,.58,-2.2+i*1.0);body.add(fr);}
    var sw=new THREE.Mesh(new THREE.BoxGeometry(.05,.5,.95),GLASS);sw.position.set(s*.99,.7,-4.15);sw.rotation.y=s*.12;body.add(sw);
  });
  var ws=new THREE.Mesh(new THREE.BoxGeometry(1.5,.55,.1),GLASS);ws.position.set(0,.8,-5.1);ws.rotation.x=-.62;body.add(ws);
  // cockpit interior silhouettes: seats, yokes, instrument panel, headrests
  [-.4,.4].forEach(function(x){var seat=new THREE.Mesh(new THREE.BoxGeometry(.5,.55,.45),SEAT);seat.position.set(x,-.1,-3.5);body.add(seat);var back=new THREE.Mesh(new THREE.BoxGeometry(.5,.7,.1),SEAT);back.position.set(x,.35,-3.2);back.rotation.x=.12;body.add(back);
    var yoke=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.5,6),INT);yoke.rotation.x=Math.PI/2.4;yoke.position.set(x,.25,-4.4);body.add(yoke);var wheel=new THREE.Mesh(new THREE.TorusGeometry(.14,.02,6,12),INT);wheel.position.set(x,.38,-4.62);body.add(wheel);});
  var panel=new THREE.Mesh(new THREE.BoxGeometry(1.7,.5,.12),INT);panel.position.set(0,.45,-4.9);panel.rotation.x=-.35;body.add(panel);
  var cab=new THREE.Mesh(new THREE.BoxGeometry(1.9,.12,1.7),INT);cab.position.set(0,-.95,-.5);body.add(cab);
  for(var r=0;r<3;r++)[-.55,.55].forEach(function(x){var b=new THREE.Mesh(new THREE.BoxGeometry(.4,.4,.35),SEAT);b.position.set(x,-.55,-1+r*1.4);body.add(b);});
  // cargo door (rear left) with a sliding panel
  var door=new THREE.Group();door.position.set(-1.07,.05,4.1);var dm=new THREE.Mesh(new THREE.BoxGeometry(.04,1.5,1.6),WHITE2);door.add(dm);
  var df=new THREE.Mesh(new THREE.BoxGeometry(.05,1.56,.05),RUBB);df.position.z=-.8;door.add(df);var df2=df.clone();df2.position.z=.8;door.add(df2);var dh=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,.3),GREY);dh.position.set(-.02,0,.5);door.add(dh);
  body.add(door);AF.door=door;AF.doorX=-1.07;
  // main wings with flex pivots, flaps and ailerons
  AF.wing=[];AF.flap=[];AF.ail=[];
  [-1,1].forEach(function(s){
    var wp=new THREE.Group();wp.position.set(s*.9,1.52,0);wp.rotation.order='ZYX';var w=wingHalf(s,WHITE);w.position.set(-s*.9,-1.52,0);wp.add(w);body.add(wp);AF.wing.push({g:wp,s:s});
    var tip=new THREE.Mesh(new THREE.SphereGeometry(.2,10,8),BLUE);tip.scale.set(1,.5,1.7);tip.position.set(s*9.9-s*.9,0,.2);wp.add(tip);
    var f=surf(s*1.4,s*4.6,.85,.75,.56,.5,WHITE2,.05);AF.flap.push({g:f,s:s});
    var a=surf(s*4.9,s*9.4,.74,.68,.5,.42,BLUE,.04);AF.ail.push({g:a,s:s});
    // struts
    body.add(strutBar(new THREE.Vector3(s*3.4,1.4,.35),new THREE.Vector3(s*1.05,-.85,.1),.075,GREY));body.add(strutBar(new THREE.Vector3(s*3.4,1.4,.65),new THREE.Vector3(s*1.05,-.85,.65),.055,GREY));
    body.add(strutBar(new THREE.Vector3(s*6.2,1.45,.5),new THREE.Vector3(s*3.4,1.4,.5),.04,GREY));
  });
  function strutBar(a,b,r,mat){var d=new THREE.Vector3().subVectors(b,a),l=d.length(),m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,l,8),mat);m.position.copy(a).addScaledVector(d,.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m;}
  // turboprop nacelles, propellers, exhausts
  props=[];AF.shimmer=[];
  [-1,1].forEach(function(s){
    var nac=loft([{z:-3.4,w:.22,t:1.55+.22,b:1.55-.22,n:2.4},{z:-3.0,w:.5,t:2.04,b:1.04,n:2.4},{z:-2.2,w:.58,t:2.12,b:.96,n:2.6},{z:0,w:.6,t:2.14,b:.94,n:2.6},{z:1.2,w:.5,t:2.0,b:1.06,n:2.4},{z:1.9,w:.26,t:1.8,b:1.28,n:2.2}],WHITE2,18);nac.position.x=s*3.6;body.add(nac);
    var intake=new THREE.Mesh(new THREE.TorusGeometry(.3,.05,8,16),DARK);intake.position.set(s*3.6,1.16,-2.6);intake.rotation.x=Math.PI/2.4;body.add(intake);
    [-1,1].forEach(function(e){var ex=new THREE.Mesh(new THREE.CylinderGeometry(.09,.12,.6,10),DARK);ex.position.set(s*3.6+e*.5,1.45,-.9);ex.rotation.z=e*Math.PI/2.4;body.add(ex);});
    var sh=new THREE.Mesh(new THREE.ConeGeometry(.5,2.6,10,1,true),new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uT:{value:0},uA:{value:0}},side:THREE.DoubleSide,
      vertexShader:'uniform float uT;varying float vY;void main(){vY=position.y;vec3 p=position;p.x+=sin(p.y*9.+uT*14.)*.05*(1.-p.y);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
      fragmentShader:'uniform float uA;varying float vY;void main(){float a=uA*(.5-vY*.4)*smoothstep(1.3,-1.3,vY);gl_FragColor=vec4(vec3(1.,.85,.6)*a,a*.5);}'}));
    sh.rotation.x=-Math.PI/2;sh.position.set(s*3.9,1.25,.75);body.add(sh);AF.shimmer.push(sh);
    var pg=new THREE.Group();pg.position.set(s*3.6,1.55,-3.55);
    var hub=new THREE.Mesh(new THREE.SphereGeometry(.24,12,8),DARK);hub.scale.z=1.6;hub.position.z=.02;pg.add(hub);
    var blades=new THREE.Group();
    for(var i=0;i<3;i++){var ar=new THREE.Group();ar.rotation.z=i*Math.PI*2/3;
      var bl=new THREE.Mesh(new THREE.BoxGeometry(.22,1.55,.045),DARK);bl.position.y=.9;bl.rotation.y=.18;var tipc=new THREE.Mesh(new THREE.BoxGeometry(.23,.22,.047),M(0xe8c53a,40));tipc.position.y=1.62;tipc.rotation.y=.18;ar.add(bl,tipc);blades.add(ar);}
    pg.add(blades);
    var disc=new THREE.Mesh(new THREE.CircleGeometry(1.75,24),new THREE.MeshBasicMaterial({color:0xcfd6dc,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));disc.position.z=.05;pg.add(disc);
    body.add(pg);props.push({g:pg,blades:blades,disc:disc,s:s});
  });
  // tail: fin, rudder, tailplane, elevators
  function finShape(pts,x0,x1,mat){var v=[],idx=[],n=pts.length;pts.forEach(function(p){v.push(x1,p[1],p[0]);});pts.forEach(function(p){v.push(x0,p[1],p[0]);});
    for(var a=1;a<n-1;a++){idx.push(0,a,a+1);idx.push(n,n+a+1,n+a);}for(var k=0;k<n;k++){var kk=(k+1)%n;idx.push(k,n+k,kk);idx.push(kk,n+k,n+kk);}
    var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return new THREE.Mesh(g,mat);}
  body.add(finShape([[6.0,.7],[8.9,.42],[8.95,4.05],[7.9,4.3]],-.09,.09,WHITE));
  var fb=finShape([[7.9,2.9],[8.95,2.78],[8.97,4.05],[8.0,4.28]],-.095,.095,BLUE);body.add(fb);
  var rudder=new THREE.Group();rudder.position.set(0,.5,8.95);var rm=finShape([[0,0],[.55,.05],[.58,3.5],[.1,3.6]],-.06,.06,RED);rudder.add(rm);body.add(rudder);AF.rudder=rudder;
  var tp=new THREE.Mesh(new THREE.BoxGeometry(6.2,.14,1.3),WHITE);tp.position.set(0,.82,8.2);body.add(tp);
  AF.elev=[];[-1,1].forEach(function(s){var eg=new THREE.Group();eg.position.set(s*1.7,.82,8.85);var em=new THREE.Mesh(new THREE.BoxGeometry(2.9,.1,.7),WHITE2);em.position.set(0,0,.35);eg.add(em);body.add(eg);AF.elev.push(eg);});
  // fixed tricycle gear with oleos, scissor links, treaded tyres
  AF.gear=[];
  function wheelMesh(r,wd){var g=new THREE.Group();var tyre=new THREE.Mesh(new THREE.CylinderGeometry(r,r,wd,28),TYRE);tyre.rotation.z=Math.PI/2;g.add(tyre);
    for(var i=0;i<3;i++){var t=new THREE.Mesh(new THREE.TorusGeometry(r*.98,.012,6,28),M(0x07080a,5));t.rotation.y=Math.PI/2;t.position.x=(i-1)*wd*.28;g.add(t);}
    var hub=new THREE.Mesh(new THREE.CylinderGeometry(r*.5,r*.5,wd+.03,14),GREY);hub.rotation.z=Math.PI/2;g.add(hub);
    var lug=new THREE.Mesh(new THREE.BoxGeometry(wd+.05,r*.12,r*.12),DARK);g.add(lug);return g;}
  function leg(x,y0,z,reach,lat,r,wd,kind){
    var g=new THREE.Group();g.position.set(x,y0,z);body.add(g);
    var up=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.55,10),GREY);up.position.set(lat*.35,-.35,0);up.rotation.z=-lat*.25;g.add(up);
    var low=new THREE.Group();low.position.set(lat*.5,-.6,0);var lm=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,reach,10),M(0xc7ccd1,120));lm.position.y=-reach/2;low.add(lm);
    var wh=wheelMesh(r,wd);wh.position.set(lat*.12,-reach-.02,0);low.add(wh);var fork=new THREE.Mesh(new THREE.BoxGeometry(wd+.12,.06,.1),DARK);fork.position.set(lat*.12,-reach+.1,0);low.add(fork);
    var link=new THREE.Mesh(new THREE.BoxGeometry(.04,.34,.04),GREY);link.position.set(0,-.22,.1);low.add(link);var link2=link.clone();link2.position.z=-.1;low.add(link2);
    g.add(low);
    if(kind==='main'){g.add(strutBar(new THREE.Vector3(lat*.25,-.25,0),new THREE.Vector3(lat*1.0,-.55,1.3),.045,GREY));}
    AF.gear.push({low:low,wheel:wh,r:r,y0:-.6,kind:kind,g:g});
  }
  [-1,1].forEach(function(s){leg(s*1.0,-.9,.3,1.0,s*1.0,.5,.34,'main');});
  leg(0,-1.05,-4.2,.9,0,.36,.26,'nose');
  // navigation lights, strobes and landing lights
  function lamp(c,x,y,z,r){var m=new THREE.Mesh(new THREE.SphereGeometry(r,8,6),new THREE.MeshBasicMaterial({color:c}));m.position.set(x,y,z);body.add(m);return m;}
  navL.red=lamp(0xff2020,-9.95,1.55,.4,.14);navL.green=lamp(0x20ff50,9.95,1.55,.4,.14);navL.white=lamp(0xfff2d0,0,.5,9.55,.12);
  strobes=[lamp(0xffffff,-9.95,1.75,.4,.12),lamp(0xffffff,9.95,1.75,.4,.12),lamp(0xffffff,0,4.3,9.0,.1)];
  var halo=function(c){return new THREE.Mesh(new THREE.SphereGeometry(.5,8,6),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));};
  navL.hr=halo(0xff3030);navL.hr.scale.setScalar(.5);navL.hr.position.copy(navL.red.position);body.add(navL.hr);navL.hg=halo(0x30ff60);navL.hg.scale.setScalar(.5);navL.hg.position.copy(navL.green.position);body.add(navL.hg);
  navL.hs=strobes.map(function(s){var h=halo(0xffffff);h.position.copy(s.position);h.scale.setScalar(.8);body.add(h);return h;});
  navL.landMesh=lamp(0xfff6dd,0,-.55,-6.1,.22);
  [AF.door].concat(AF.wing.map(function(w){return w.g;}),AF.flap.map(function(f){return f.g;}),AF.ail.map(function(f){return f.g;}),AF.elev,[AF.rudder],props.map(function(p){return p.g;}),AF.gear.map(function(g){return g.g;}),AF.shimmer).forEach(function(x){x.userData.keep=true;});
  mergeStatic(body,null,true);props.forEach(function(p){mergeStatic(p.blades,null,true);});AF.gear.forEach(function(g){g.low.userData.keep=true;mergeStatic(g.g,null,true);mergeStatic(g.low,function(q){return q===g.wheel;},true);mergeStatic(g.wheel,null,true);});
  AF.wing.forEach(function(w){mergeStatic(w.g);});AF.flap.concat(AF.ail).forEach(function(s){mergeStatic(s.g);});
  scene.add(jet);AF.t=0;AF.flapA=0;AF.gearComp=0;AF.wheelSpin=0;
}
function updateProps(rpmN,k){ // rpm 0..1.5 smoothed, props spin up from stopped
  PROP_RPM+=(rpmN-PROP_RPM)*ease(.05,k);
  var spin=PROP_RPM*PROP_RPM*1.5*k;var blur=clamp((PROP_RPM-.38)/.5,0,1);
  props.forEach(function(p){p.blades.rotation.z+=spin;p.disc.material.opacity=blur*.26;p.blades.visible=blur<.9;});
}
var _ctl={ail:0,el:0,rud:0,flap:0,comp:0,vib:0,flex:0};
function updateOtter(k,t,o){ // o: {roll,pitch,yaw,flapTarget,onGround,speed,boost,rolling}
  AF.t=t;AF.flapA+=(o.flapTarget-AF.flapA)*ease(.04,k);
  AF.ailA=(AF.ailA||0)+((o.roll*.45)-(AF.ailA||0))*ease(.2,k);AF.elA=(AF.elA||0)+((-o.pitch*.38)-(AF.elA||0))*ease(.2,k);AF.rudA=(AF.rudA||0)+((o.yaw*.4)-(AF.rudA||0))*ease(.2,k);
  AF.flap.forEach(function(f){f.g.rotation.x=AF.flapA*.6;});
  AF.ail.forEach(function(a){a.g.rotation.x=a.s*AF.ailA;});
  AF.elev.forEach(function(e){e.rotation.x=AF.elA;});AF.rudder.rotation.y=AF.rudA;
  var flex=.015+Math.abs(o.roll)*.03+(o.boost?.012:0),vib=(o.boost?.006:.0015)+(o.onGround&&o.speed>.05?.003:0);
  AF.wing.forEach(function(w){w.g.rotation.z=w.s*(flex+Math.sin(t*38+w.s)*vib);});
  // gear: wheel spin, suspension compression and rebound
  var target=o.onGround?(.2+.08*Math.sin(t*9*(o.speed+.1))*Math.min(1,o.speed*3)):-.35;
  AF.gearComp+=(target-AF.gearComp)*ease(.1,k);
  AF.wheelSpin+=o.speed*60/.5*k/60*.5;
  AF.gear.forEach(function(g){g.low.position.y=g.y0+AF.gearComp*.3*(g.kind==='nose'?.8:1);g.wheel.rotation.x=AF.wheelSpin;});
  // door slides open while releasing cargo
  AF.door.position.z=4.1+(AF.doorOpen||0)*1.55;AF.door.position.x=AF.doorX-.12*(AF.doorOpen||0);
  AF.shimmer.forEach(function(s){s.material.uniforms.uT.value=t;s.material.uniforms.uA.value=clamp(PROP_RPM-.3,0,1)*(o.onGround?.9:.35);});
}
function updateLights(night,t,onGround){
  var flash=(Math.floor(t*1.6)%6===0)?1:0;
  strobes.forEach(function(s){s.visible=!!flash;});
  navL.hs.forEach(function(h){h.material.opacity=flash*(.15+night*.5);});
  navL.hr.material.opacity=.15+night*.5;navL.hg.material.opacity=.15+night*.5;
  navL.landMesh.material.color.setScalar(.5+.5*Math.max(night,onGround?.9:0));
}

/* ---- merge static meshes by material so the aircraft and airport cost a handful of draw calls ---- */
var _vcm=null;function VCMAT(){if(!_vcm)_vcm=new THREE.MeshPhongMaterial({vertexColors:true,shininess:60,side:THREE.DoubleSide});return _vcm;}
function mergeStatic(root,skip,vc){
  root.updateMatrixWorld(true);var inv=new THREE.Matrix4().copy(root.matrixWorld).invert(),groups=new Map(),rm=[];
  root.traverse(function(o){
    if(o===root||!o.isMesh||o.isInstancedMesh)return;
    for(var p=o;p&&p!==root;p=p.parent)if(p.userData.keep||(skip&&skip(p)))return;
    var g=o.geometry.clone(),m=new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld);g.applyMatrix4(m);
    if(!g.attributes.normal)g.computeVertexNormals();
    if(!g.attributes.uv){g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));}
    var mt=o.material,asVC=vc&&mt.type==='MeshPhongMaterial'&&!mt.map&&!mt.transparent;if(asVC){var cc=mt.color,n0=g.attributes.position.count,ca=new Float32Array(n0*3);for(var ci=0;ci<n0;ci++){ca[ci*3]=cc.r;ca[ci*3+1]=cc.g;ca[ci*3+2]=cc.b;}g.setAttribute('color',new THREE.Float32BufferAttribute(ca,3));}
    var key=asVC?'VC':mt.type+'|'+(mt.color?mt.color.getHex():'')+'|'+mt.shininess+'|'+mt.flatShading+'|'+(mt.map?mt.map.uuid:'')+'|'+mt.transparent+'|'+mt.opacity+'|'+mt.side+'|'+mt.polygonOffset+'|'+mt.blending,e=groups.get(key);if(!e)groups.set(key,e={mat:asVC?VCMAT():o.material,geos:[],vc:asVC});e.geos.push(g);rm.push(o);
  });
  rm.forEach(function(o){o.parent.remove(o);o.geometry.dispose();});
  groups.forEach(function(e){
    var pos=[],nor=[],uv=[],col=[],idx=[],off=0;
    e.geos.forEach(function(g){var n=g.attributes.position.count;for(var i=0;i<n;i++){pos.push(g.attributes.position.getX(i),g.attributes.position.getY(i),g.attributes.position.getZ(i));nor.push(g.attributes.normal.getX(i),g.attributes.normal.getY(i),g.attributes.normal.getZ(i));uv.push(g.attributes.uv.getX(i),g.attributes.uv.getY(i));if(e.vc)col.push(g.attributes.color.getX(i),g.attributes.color.getY(i),g.attributes.color.getZ(i));}
      if(g.index){for(i=0;i<g.index.count;i++)idx.push(g.index.getX(i)+off);}else{for(i=0;i<n;i++)idx.push(i+off);}off+=n;g.dispose();});
    var mg=new THREE.BufferGeometry();mg.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));mg.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));mg.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));if(e.vc)mg.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
    mg.setIndex(off>65535?new THREE.Uint32BufferAttribute(idx,1):new THREE.Uint16BufferAttribute(idx,1));
    var mesh=new THREE.Mesh(mg,e.mat);mesh.frustumCulled=false;root.add(mesh);
  });
}
