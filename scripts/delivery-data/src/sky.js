/* ---- time of day, sky, sun, moon, stars, light colours ---- */
var DEG=Math.PI/180,SK={sunE:.1,night:0,hold:false,moon:new THREE.Vector3(),sunCol:new THREE.Color(),moonCol:new THREE.Color(),alpCol:new THREE.Color(),fog:new THREE.Color()};
var SKYV='varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
var SKYF=[
'precision highp float;varying vec3 vDir;uniform vec3 uSun,uMoon,uSunCol,uHor;uniform float uHigh,uNight,uSunE,uMoonUp;',
'vec3 S(float r,float g,float b){return pow(vec3(r,g,b),vec3(2.2));}',
'float h3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}',
'float vn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}',
'void main(){',
'  vec3 d=normalize(vDir);float y=d.y,sE=uSunE;',
'  float twK=smoothstep(-.3,-.05,sE)*(1.-smoothstep(.03,.3,sE));',
'  vec3 zen=mix(mix(S(.008,.014,.045),S(.09,.11,.28),smoothstep(-.3,-.08,sE)),S(.15,.32,.62),smoothstep(-.02,.28,sE));',
'  vec3 mid=mix(mix(S(.014,.022,.07),S(.2,.2,.42),smoothstep(-.3,-.08,sE)),S(.5,.67,.88),smoothstep(-.02,.28,sE));',
'  vec3 c=mix(uHor,mid,smoothstep(0.,.2,y));c=mix(c,zen,smoothstep(.12,.85,y));',
'  vec2 sh=normalize(uSun.xz+1e-5),dh=normalize(d.xz+1e-5);float az=dot(dh,sh);',
'  float hb=exp(-max(y,0.)*6.5);',
'  vec3 tw1=mix(S(1.,.45,.25),S(1.,.72,.45),smoothstep(-.1,.1,sE));',
'  c+=tw1*pow(max(az,0.),2.2)*hb*twK*1.15;',
'  float ab=smoothstep(-.01,.05,y)*exp(-pow((y-.17)/.1,2.));',
'  c=mix(c,S(.92,.5,.6),ab*max(-az,0.)*twK*.62);',
'  float eshade=exp(-pow((y-.015)/.05,2.))*max(-az,0.)*twK*smoothstep(-.12,-.02,sE);',
'  c=mix(c,S(.12,.12,.24),eshade*.5);',
'  float s=max(dot(d,uSun),0.);float up=smoothstep(-.025,.015,y);',
'  c+=uSunCol*(pow(s,8.)*.04+pow(s,150.)*.32+pow(s,2200.)*3.)*up;',
'  float m=dot(d,uMoon);',
'  c+=S(.8,.85,1.)*(smoothstep(.99955,.9998,m)*1.6+pow(max(m,0.),400.)*.18+pow(max(m,0.),30.)*.015)*uMoonUp*up;',
'  if(uNight>.02){',
'    vec3 g=vec3(dot(d,vec3(.8,.1,.55)),dot(d,vec3(-.1,.99,.05)),dot(d,vec3(-.6,0.,.8)));',
'    float band=exp(-g.y*g.y*13.);float nz=vn(d*7.)*.55+vn(d*17.+3.)*.3+vn(d*41.)*.15;',
'    c+=vec3(.5,.55,.8)*band*(.3+1.0*nz)*smoothstep(-.02,.3,y)*.13*uNight*(1.-twK*.5);',
'  }',
'  c=mix(c,S(.012,.025,.06),uHigh*smoothstep(-.45,.45,y)*(1.-.6*(1.-uNight)*0.));',
'  c=mix(c,uHor,smoothstep(-.02,-.12,y)*(1.-uHigh));',
'  gl_FragColor=vec4(c,1.);',
'  #include <tonemapping_fragment>',
'  #include <colorspace_fragment>',
'}'].join('\n');
function ss(a,b,x){var t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
function initSky(){
  SK.u={uSun:{value:sunVec},uMoon:{value:SK.moon},uSunCol:{value:SK.sunCol},uHor:common.uHazeCol,uHigh:{value:0},uNight:{value:0},uSunE:{value:.1},uMoonUp:{value:0}};
  var sky=new THREE.Mesh(new THREE.SphereGeometry(3500,28,16),new THREE.ShaderMaterial({uniforms:SK.u,vertexShader:SKYV,fragmentShader:SKYF,side:THREE.BackSide,depthWrite:false,depthTest:false}));
  sky.renderOrder=-100;sky.frustumCulled=false;scene.add(sky);terrain.sky=sky;
  var sp=[],rn=mulberry(5),i;for(i=0;i<900;i++){var th=rn()*Math.PI*2,yy=-.15+rn()*1.15,rr=Math.sqrt(Math.max(.01,1-yy*yy))*3300;sp.push(Math.cos(th)*rr,yy*3300,Math.sin(th)*rr);}
  var sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(new Float32Array(sp),3));
  var starMat=new THREE.PointsMaterial({color:0xffffff,size:1.4,transparent:true,opacity:0,depthWrite:false,sizeAttenuation:false,fog:false});
  var stars=new THREE.Points(sg,starMat);stars.renderOrder=-90;stars.frustumCulled=false;scene.add(stars);terrain.stars=stars;terrain.starMat=starMat;
  sunLight=new THREE.DirectionalLight(0xffe2b8,3.0);scene.add(sunLight);scene.add(sunLight.target);
  moonLight=new THREE.DirectionalLight(0x8fa8ff,0);scene.add(moonLight);
  hemi=new THREE.HemisphereLight(0x9cc4ff,0x6b5a40,1.0);scene.add(hemi);
  var q=/[?&]t=([0-9.]+)/.exec(location.search);if(q){tod=parseFloat(q[1])%24;}
  SK.hold=/[?&]hold/.test(location.search);
  updateSky(0);
}
var moonLight;
function updateSky(dt){
  if(!SK.hold&&dt>0){var f=.45+.55*ss(.02,.25,Math.abs(SK.sunE));tod=(tod+dt*(24/600)*f)%24;}
  var Hh=(tod-12)*15*DEG,lat=28.3*DEG;
  var dec=-12*DEG,sx=-Math.cos(dec)*Math.sin(Hh),sy=Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(Hh),sz=-(Math.cos(lat)*Math.sin(dec)-Math.sin(lat)*Math.cos(dec)*Math.cos(Hh));
  sunVec.set(sx,sy,sz).normalize();var sE=sunVec.y;SK.sunE=sE;
  SK.moon.set(-sunVec.x,-sunVec.y,-sunVec.z);
  var night=1-ss(-.18,-.02,sE);SK.night=night;nightF=night;
  // sun colour (warm at the horizon), intensity fades out below it
  var c=SK.sunCol.setRGB(1,.35,.15);c.lerp(_c1.setRGB(1,.62,.36),ss(-.02,.06,sE));c.lerp(_c1.setRGB(1,.92,.8),ss(.05,.4,sE));
  var inten=(2.45-.35*ss(.3,.8,sE))*ss(-.045,.22,sE);c.multiplyScalar(inten);
  var moonUp=ss(-.03,.2,SK.moon.y)*night;SK.moonUp=moonUp;
  SK.moonCol.setRGB(.42,.52,.9).multiplyScalar(.85*moonUp);
  var cm=common;
  cm.uSunCol.value.copy(c);cm.uMoon.value.copy(SK.moon);cm.uMoonCol.value.copy(SK.moonCol);
  cm.uNight.value=night;
  // ambient
  cm.uSkyAmb.value.copy(lin(.06,.085,.18)).lerp(lin(.24,.3,.62),ss(-.2,-.02,sE)).lerp(lin(.36,.5,.74),ss(.0,.3,sE));
  cm.uSkyAmb.value.multiplyScalar(.85*(night>.5?1.25:1));
  cm.uGndAmb.value.copy(lin(.03,.03,.05)).lerp(lin(.2,.16,.14),ss(-.2,-.02,sE)).lerp(lin(.34,.3,.24),ss(.0,.3,sE)).multiplyScalar(.5);
  // haze / horizon colour
  var hz=cm.uHazeCol.value;hz.copy(lin(.035,.05,.10)).lerp(lin(.36,.33,.52),ss(-.25,-.04,sE)).lerp(lin(.96,.70,.52),ss(-.04,.07,sE)).lerp(lin(.74,.82,.92),ss(.07,.3,sE));
  hz.lerp(lin(.05,.09,.18),highAlt*.75);
  // alpenglow: peaks go orange, pink and deep red at sunrise/sunset
  var aw=ss(-.07,-.01,sE)*(1-ss(.06,.17,sE));cm.uAlp.value=aw;
  SK.alpCol.setRGB(.85,.08,.2);SK.alpCol.lerp(_c1.setRGB(1,.28,.2),ss(-.045,.0,sE)).lerp(_c1.setRGB(1,.52,.18),ss(-.005,.05,sE)).lerp(_c1.setRGB(1,.68,.34),ss(.04,.12,sE));
  cm.uAlpCol.value.copy(SK.alpCol);
  cm.uTermH.value=7600*Math.pow(clamp((.17-sE)/.17,0,1),1.5);
  cm.uShadowOn.value=(sE<.5&&sE>.0&&shadowsOn)?1:0;
  cm.uFogMorn.value=(1-ss(7.2,9.9,tod))*ss(3,5,tod)*(tod<12?1:0);
  cm.uFogCol.value.copy(hz).multiplyScalar(1.35).lerp(lin(1,.8,.78),(1-ss(.0,.2,sE))*.4);
  cm.uLineGain.value=1-night*.4;
  // sky
  var u=SK.u;u.uHigh.value=highAlt;u.uNight.value=night;u.uSunE.value=sE;u.uMoonUp.value=moonUp;
  terrain.starMat.opacity=clamp(Math.max(night*.95,highAlt*1.0*(.3+.7*night))*1.0,0,.95);
  // lights on the aircraft and clouds
  sunLight.color.copy(c).multiplyScalar(1/Math.max(.3,inten||.3));sunLight.intensity=inten*(1-highAlt*.17);
  moonLight.intensity=moonUp*1.3;moonLight.color.set(0x8fa8ff);
  hemi.intensity=(.5+.5*ss(-.1,.25,sE))*(1-highAlt*.4);hemi.color.copy(lin(.55,.7,1)).lerp(lin(.9,.6,.55),(1-ss(.0,.3,sE))*.4*ss(-.1,.0,sE));
  if(cloudMesh){var cu=cloudMesh.material.uniforms;cu.uLight.value.copy(c).multiplyScalar(.42).add(_c1.setRGB(.06,.07,.1)).lerp(lin(.12,.14,.24),night*.9);
    cu.uShade.value.copy(cm.uSkyAmb.value).multiplyScalar(1.6).lerp(lin(.04,.05,.09),night*.7);
    cu.uHaze.value=hz;cu.uDrift.value.set(tod*3600*.012,tod*3600*.005);}
  cm.uDrift.value.set(tod*3600*.012,tod*3600*.005);
}
var _c1=new THREE.Color(),shadowsOn=true;

function updateLamp(onGroundish){
  var fx=-Math.sin(heading),fz=-Math.cos(heading),agl=py-gY(px,pz);
  var on=Math.max(SK.night*.9,onGroundish?1:0)*(1-ss(25,100,agl));
  var cm=common;cm.uLampOn.value=on;
  cm.uLampPos.value.set(px+fx*3.5,py-.5,pz+fz*3.5);cm.uLampDir.value.set(fx*.93,-.37,fz*.93).normalize();
}
