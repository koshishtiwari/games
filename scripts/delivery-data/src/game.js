(function(){
'use strict';
/* ====================================================================
   Delivery: fly over a real, unlabeled Nepal and drop packages by district.
   World units: 1 unit = 100 m horizontally, vertical exaggeration 2.5x
   (1 m of elevation = 0.025 units). One data cell = 500 m = 5 units.
   ==================================================================== */
var HUMAN_K=40; // HUMAN_SCALE_K: exaggeration of everything human-made (1 m = HUMAN_K/100 world units; terrain 1 unit = 100 m). was 62.
var CELL=5, VEX=0.025, GN=161, HALF=80, LEVELS=5;
var COINS_MAX=100, MISSIONS_PER_RUN=8;
var CRUISE=0.82, BOOST=1.63;               // world units per 1/60 s frame (49 and 98 units/s)
var $=function(i){return document.getElementById(i);};
var DEBUG=/[?&]debug/.test(location.search);
function clamp(v,a,b){return v<a?a:v>b?b:v;}
function ease(e,k){return 1-Math.pow(1-e,k);}
function setProg(f,t){var b=$('b-fill');if(b)b.style.width=(clamp(f,0,1)*100).toFixed(1)+'%';if(t)$('b-txt').textContent=t;}
function post(o){try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(o));}catch(e){}}

/* ---------------- data loading ---------------- */
function fetchBlob(url,cb){
  return fetch(url).then(function(r){
    if(!r.ok)throw new Error(url+' '+r.status);
    var total=+r.headers.get('content-length')||0;
    if(!r.body||!total||!r.body.getReader){return r.blob().then(function(b){cb&&cb(1);return b;});}
    var rd=r.body.getReader(),parts=[],got=0;
    function pump(){return rd.read().then(function(x){if(x.done)return new Blob(parts);parts.push(x.value);got+=x.value.length;cb&&cb(Math.min(1,got/total));return pump();});}
    return pump();
  });
}
function blobImg(b){return new Promise(function(res,rej){var u=URL.createObjectURL(b),im=new Image();im.onload=function(){URL.revokeObjectURL(u);res(im);};im.onerror=function(){rej(new Error('image decode failed'));};im.src=u;});}
function readPixels(im,fn){ // fn(rowStart,rows,data) per strip to bound memory
  var w=im.naturalWidth,h=im.naturalHeight,c=document.createElement('canvas');c.width=w;
  var STRIP=256,x=c.getContext('2d',{willReadFrequently:true});
  for(var y=0;y<h;y+=STRIP){var n=Math.min(STRIP,h-y);c.height=n;x.clearRect(0,0,w,n);x.drawImage(im,0,y,w,n,0,0,w,n);fn(y,n,x.getImageData(0,0,w,n).data);}
}
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function makeNoise(){
  var N=256,out=new Uint8Array(N*N*4),rnd=mulberry(1337),ch,o,x,y;
  for(ch=0;ch<4;ch++){
    var acc=new Float32Array(N*N),octs=[[8,.5],[16,.3],[32,.2]];
    for(o=0;o<octs.length;o++){
      var L=octs[o][0],wt=octs[o][1],g=new Float32Array(L*L);for(var i=0;i<g.length;i++)g[i]=rnd();
      for(y=0;y<N;y++)for(x=0;x<N;x++){
        var fx=x/N*L,fy=y/N*L,ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy;
        tx=tx*tx*(3-2*tx);ty=ty*ty*(3-2*ty);
        var a=g[(iy%L)*L+ix%L],b=g[(iy%L)*L+(ix+1)%L],c=g[((iy+1)%L)*L+ix%L],d=g[((iy+1)%L)*L+(ix+1)%L];
        acc[y*N+x]+=wt*((a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty);
      }
    }
    var mn=1e9,mx=-1e9;for(i=0;i<acc.length;i++){if(acc[i]<mn)mn=acc[i];if(acc[i]>mx)mx=acc[i];}
    for(i=0;i<acc.length;i++)out[i*4+ch]=Math.round(255*(acc[i]-mn)/(mx-mn));
  }
  return out;
}
var NOISE=null;
function noiseAt(ch,u,v){ // CPU twin of the GPU bilinear repeat lookup
  var N=256,x=u*N-.5,y=v*N-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
  function t(i,j){return NOISE[(((j%N)+N)%N*N+((i%N)+N)%N)*4+ch]/255;}
  return (t(x0,y0)*(1-fx)+t(x0+1,y0)*fx)*(1-fy)+(t(x0,y0+1)*(1-fx)+t(x0+1,y0+1)*fx)*fy;
}
function smooth(a,b,x){var t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
function cloudDen(x,z){
  var a=noiseAt(0,x*.0016,z*.0016)*.65+noiseAt(1,x*.0057+.3,z*.0057+.3)*.35;
  return smooth(.52,.74,a);
}

/* ---------------- globals filled by boot ---------------- */
var META=null,W=0,H=0,SS=2,RW=0,RH=0,HF=null,IDS=null,DIST=null,DBYID={};
var renderer,scene,camera,jet,sunVec,sunLight,hemi,skyU,terrain={},cloudMesh=null;
var MASK_RIVER=null,texHeight,texData,texAux,texNoise,texDist,texEdge,common;

function hAt(x,z){ // metres, bilinear at texel centres (matches the GPU level-0 height)
  var fx=clamp(x/CELL+W/2-.5,0,W-1.001),fy=clamp(z/CELL+H/2-.5,0,H-1.001),i=Math.floor(fx),j=Math.floor(fy),tx=fx-i,ty=fy-j,p=j*W+i;
  return (HF[p]*(1-tx)+HF[p+1]*tx)*(1-ty)+(HF[p+W]*(1-tx)+HF[p+W+1]*tx)*ty;
}
function gY(x,z){return hAt(x,z)*VEX;}
function idAtWorld(x,z){
  var gx=x/CELL+W/2,gy=z/CELL+H/2,i=Math.floor(gx*SS),j=Math.floor(gy*SS);
  if(i<0||j<0||i>=RW||j>=RH)return 0;return IDS[j*RW+i];
}
function lonLatToWorld(lon,lat){return {x:((lon-META.grid.lon0)/META.grid.dlon-W/2)*CELL,z:((META.grid.lat1-lat)/META.grid.dlat-H/2)*CELL};}
function worldToLonLat(x,z){return {lon:META.grid.lon0+(x/CELL+W/2)*META.grid.dlon,lat:META.grid.lat1-(z/CELL+H/2)*META.grid.dlat};}

function boxBlur(src,w,h,r){
  var tmp=new Float32Array(w*h),out=new Float32Array(w*h),x,y,s,n;
  for(y=0;y<h;y++){s=0;n=0;var row=y*w;for(x=0;x<=r&&x<w;x++){s+=src[row+x];n++;}
    for(x=0;x<w;x++){tmp[row+x]=s/n;var a=x+r+1,b=x-r;if(a<w){s+=src[row+a];n++;}if(b>=0){s-=src[row+b];n--;}}}
  for(x=0;x<w;x++){s=0;n=0;for(y=0;y<=r&&y<h;y++){s+=tmp[y*w+x];n++;}
    for(y=0;y<h;y++){out[y*w+x]=s/n;var a2=y+r+1,b2=y-r;if(a2<h){s+=tmp[a2*w+x];n++;}if(b2>=0){s-=tmp[b2*w+x];n--;}}}
  return out;
}
function buildHalfMips(base,w,h){
  var DU=THREE.DataUtils,levels=[],cur=base,cw=w,ch=h;
  function half(a){var o=new Uint16Array(a.length);for(var i=0;i<a.length;i++)o[i]=DU.toHalfFloat(a[i]);return o;}
  levels.push({data:half(cur),width:cw,height:ch});
  while(cw>1||ch>1){
    var nw=Math.max(1,cw>>1),nh=Math.max(1,ch>>1),nx=new Float32Array(nw*nh);
    for(var y=0;y<nh;y++)for(var x=0;x<nw;x++){
      var x0=Math.min(cw-1,2*x),x1=Math.min(cw-1,2*x+1),y0=Math.min(ch-1,2*y),y1=Math.min(ch-1,2*y+1);
      var a=cur[y0*cw+x0],b=cur[y0*cw+x1],c=cur[y1*cw+x0],d=cur[y1*cw+x1];
      nx[y*nw+x]=.5*(a+b+c+d)*.25+.5*Math.max(a,b,c,d); // half mean, half max: peaks survive at distance
    }
    cur=nx;cw=nw;ch=nh;levels.push({data:half(cur),width:cw,height:ch});
  }
  return levels;
}

/* ---------------- shaders ---------------- */
var VERT=[
'attribute vec2 g;',
'uniform sampler2D uHeight;uniform vec2 uC;uniform float uS,uLod,uMorph;',
'varying vec3 vW;varying float vH;',
'#define CW __CW__',
'#define CH __CH__',
'float hs(vec2 p,float lod){return textureLod(uHeight,vec2(p.x/CW+.5,p.y/CH+.5),lod).r;}',
'void main(){',
'  vec2 p=uC+(g-80.)*uS;',
'  float h=hs(p,uLod);',
'  if(uMorph>.5){',
'    vec2 par=mod(g,2.)*uS;',
'    float r=max(abs(p.x-uC.x),abs(p.y-uC.y))/(80.*uS);',
'    float m=smoothstep(.76,.98,r);',
'    float c=.25*(hs(p+par,uLod+1.)+hs(p-par,uLod+1.)+hs(p+vec2(par.x,-par.y),uLod+1.)+hs(p+vec2(-par.x,par.y),uLod+1.));',
'    h=mix(h,c,m);',
'  }',
'  vW=vec3(p.x,h*'+VEX+',p.y);vH=h;',
'  gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);',
'}'].join('\n');

var FRAG=[
'precision highp float;',
'uniform sampler2D uData,uAux,uNoise,uDist;',
'uniform vec3 uSun,uSunCol,uHazeCol,uSkyAmb,uGndAmb,uFillCol,uTgtCol;',
'uniform float uFogK,uReveal,uLandId,uTgtId,uBorders,uCur,uPixW,uLineGain,uTermH,uAlp,uShadowOn,uFogMorn,uNight;',
'uniform vec3 uMoon,uMoonCol,uAlpCol,uFogCol,uLampPos,uLampDir;uniform float uLampOn;',
'uniform vec3 uDummy_;uniform vec2 uDrift,uKtm;uniform sampler2D uHeight;',
'#define VEXC 0.025',
'uniform sampler2D uWorld;uniform float uWorldOn,uLit;',
'uniform sampler2D uEdge;uniform float uProvOf[80];uniform vec3 uAccent;',
'varying vec3 vW;varying float vH;',
'#define CW __CW__',
'#define CH __CH__',
'vec3 S(float r,float g,float b){return pow(vec3(r,g,b),vec3(2.2));}',
'float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}',
'float idAt(vec2 uv){return floor(texture2D(uDist,uv).r*255.+.5);}',
'float cloudDen(vec2 p){float a=texture2D(uNoise,p*.0016).r*.65+texture2D(uNoise,p*.0057+vec2(.3)).g*.35;return smoothstep(.52,.74,a);}',
'void main(){',
'  vec2 uv=vec2(vW.x/CW+.5,vW.z/CH+.5);',
'  vec4 dt=texture2D(uData,uv);vec2 ax=texture2D(uAux,uv).rg;',
'  vec3 N;N.xz=dt.rg*2.-1.;N.y=sqrt(max(.03,1.-dot(N.xz,N.xz)));',
'  float river=dt.b,dry=dt.a,aoT=ax.r,urban=ax.g;',
'  float h=vH;',
'  vec3 Vv=cameraPosition-vW;float dist=length(Vv);Vv/=dist;',
'  float nearF=1.-smoothstep(200.,900.,dist);',
'  vec2 xz=vW.xz;',
'  vec4 nA=texture2D(uNoise,xz*.0021+vec2(.13,.71));',
'  vec4 nB=texture2D(uNoise,xz*.0083+vec2(.37,.22));',
'  vec4 nC=texture2D(uNoise,xz*.033+vec2(.61,.05));',
'  N.xz+=(nC.rg-.5)*.22*nearF*(.25+(1.-N.y)*2.);N=normalize(N);',
'  float slope=1.-N.y;',
'  // ---- vegetation and ground ----',
'  vec3 forest=mix(S(.14,.30,.12),S(.22,.38,.15),nB.r);',
'  forest=mix(forest,S(.20,.35,.11),(1.-smoothstep(300.,1200.,h))*.75);',
'  forest=mix(forest,S(.09,.21,.11),smoothstep(2500.,3500.,h));',
'  vec3 dryCol=mix(S(.68,.58,.41),S(.57,.45,.32),nB.g);',
'  float dryAmt=smoothstep(.28,.72,dry);',
'  vec3 veg=mix(forest,dryCol,dryAmt);',
'  float meadow=smoothstep(3300.,3900.,h+(nA.r-.5)*500.)*(1.-smoothstep(4500.,5000.,h));',
'  veg=mix(veg,mix(S(.44,.48,.26),dryCol,dryAmt*.8),meadow);',
'  // terraced hills',
'  float band=.5+.5*sin(h*.085+nB.r*6.);',
'  float terr=smoothstep(.05,.12,slope)*(1.-smoothstep(.3,.42,slope))*smoothstep(350.,700.,h)*(1.-smoothstep(1900.,2800.,h))*(1.-dryAmt*.5);',
'  veg=mix(veg,mix(S(.46,.52,.22),S(.55,.46,.27),band*nearF+(1.-nearF)*.4),terr*.5);',
'  // lowland farmland patchwork',
'  float flatF=1.-smoothstep(.04,.17,slope);',
'  float farmM=flatF*(1.-smoothstep(1500.,2300.,h));',
'  vec2 fq=xz/5.+(nB.rg-.5)*.9;vec2 fid=floor(fq);float fr=hash12(fid),fr2=hash12(fid+7.3);',
'  vec3 fA=mix(S(.33,.54,.17),S(.46,.62,.21),fr2),fB=mix(S(.80,.68,.31),S(.70,.58,.25),fr2),fC=S(.52,.42,.27);',
'  vec3 farm=fr<.46?fA:(fr<.8?fB:fC);',
'  farm=mix(farm,mix(fB,fC,.4),dry*.45);',
'  vec3 farmAvg=mix(S(.42,.56,.21),S(.68,.60,.29),clamp(nA.g*.7+dry*.5,0.,1.));',
'  farm=mix(farm,farmAvg,.28);farm=mix(farmAvg,farm,1.-smoothstep(140.,560.,dist));',
'  vec3 alb=mix(veg,farm,farmM);',
'  // rock, scree, snow',
'  vec3 rock=mix(S(.52,.47,.42),S(.37,.34,.33),smoothstep(.28,.7,slope));',
'  rock=mix(rock,S(.60,.49,.37),dryAmt*.55);',
'  float rockW=max(smoothstep(4200.,5000.,h+(nA.g-.5)*600.),smoothstep(.36,.6,slope+(nB.g-.5)*.12)*smoothstep(1700.,2900.,h));',
'  alb=mix(alb,rock,rockW);',
'  float snowLine=mix(4350.,5500.,dryAmt)+(nA.b-.5)*450.;',
'  float snow=smoothstep(snowLine-250.,snowLine+300.,h)*(1.-smoothstep(.58,.86,slope-(nC.r-.5)*.18));',
'  vec3 snowCol=mix(S(.93,.95,1.),S(.80,.88,.97),smoothstep(.1,.35,slope)*.7);',
'  alb=mix(alb,snowCol,snow);',
'  // cities',
'  float um=smoothstep(.12,.5,urban)*(1.-smoothstep(.08,.28,slope));',
'  vec3 uc=mix(S(.60,.56,.50),S(.72,.64,.52),nC.r)*(.85+.3*nC.b);',
'  alb=mix(alb,uc,um*.85);',
'  // ---- far tier: built-up density from the baked OSM/Overture raster ----',
'  float dn=0.;vec3 wd=vec3(0.);',
'  if(uWorldOn>.5){wd=texture2D(uWorld,uv).rgb;dn=wd.r;',
'    float bm=smoothstep(.30,.62,dn)*(1.-smoothstep(.08,.3,slope));',
'    vec3 roofc=mix(S(.58,.52,.47),S(.62,.38,.30),(1.-smoothstep(300.,700.,h))*smoothstep(.35,.6,nC.g))*(.85+.3*nC.b);',
'    alb=mix(alb,roofc,bm*.8);',
'  }',
'  // sand bars, rivers and lakes',
'  float lakeM=smoothstep(.955,.975,river);',
'  float wM=max(smoothstep(.20,.34,river),lakeM);',
'  float sandM=(smoothstep(.04,.14,river))*(1.-smoothstep(600.,1500.,h))*(1.-wM);',
'  alb=mix(alb,S(.64,.58,.45),sandM*.5);',
'  vec3 wCol=mix(S(.13,.30,.36),S(.28,.57,.62),smoothstep(2200.,4300.,h));',
'  wCol=mix(wCol,S(.07,.20,.30),lakeM*.7);',
'  alb=mix(alb,wCol,wM);',
'  // ---- district borders: sub-texel, constant on-screen width ----',
'  float lnA=0.,lnH=0.;vec3 lnC=vec3(0.);',
'  if(uBorders>.5){',
'    float pixW=dist*uPixW;',
'    vec2 cell=uv*vec2(__W__,__H__);vec2 f=cell-.5;vec2 fb=floor(f);vec2 w=f-fb;',
'    ivec2 b=clamp(ivec2(fb),ivec2(0),ivec2(__W1__,__H1__));',
'    vec4 e00=texelFetch(uEdge,b,0),e10=texelFetch(uEdge,b+ivec2(1,0),0),e01=texelFetch(uEdge,b+ivec2(0,1),0),e11=texelFetch(uEdge,b+ivec2(1,1),0);',
'    vec4 en=w.x<.5?(w.y<.5?e00:e01):(w.y<.5?e10:e11);',
'    float A=floor(en.g*255.+.5);float pA=uProvOf[int(A)];',
'    float sd00=(abs(floor(e00.g*255.+.5)-A)<.5?1.:-1.)*(e00.r*255.-1.)/254.*1.5,sd10=(abs(floor(e10.g*255.+.5)-A)<.5?1.:-1.)*(e10.r*255.-1.)/254.*1.5;',
'    float sd01=(abs(floor(e01.g*255.+.5)-A)<.5?1.:-1.)*(e01.r*255.-1.)/254.*1.5,sd11=(abs(floor(e11.g*255.+.5)-A)<.5?1.:-1.)*(e11.r*255.-1.)/254.*1.5;',
'    float phiD=abs(mix(mix(sd00,sd10,w.x),mix(sd01,sd11,w.x),w.y))*5.;',
'    float sp00=(uProvOf[int(floor(e00.g*255.+.5))]==pA?1.:-1.)*(e00.b*255.-1.)/254.*1.5,sp10=(uProvOf[int(floor(e10.g*255.+.5))]==pA?1.:-1.)*(e10.b*255.-1.)/254.*1.5;',
'    float sp01=(uProvOf[int(floor(e01.g*255.+.5))]==pA?1.:-1.)*(e01.b*255.-1.)/254.*1.5,sp11=(uProvOf[int(floor(e11.g*255.+.5))]==pA?1.:-1.)*(e11.b*255.-1.)/254.*1.5;',
'    float phiP=abs(mix(mix(sp00,sp10,w.x),mix(sp01,sp11,w.x),w.y))*5.;',
'    float aa=pixW*.7,hwD=.5*1.3*pixW,hwP=.5*2.6*pixW,hwC=.5*3.0*pixW;',
'    float fadeFar=1.-smoothstep(1800.,4800.,dist);',
'    float curN=step(.5,step(abs(floor(e00.g*255.+.5)-uCur),.5)+step(abs(floor(e10.g*255.+.5)-uCur),.5)+step(abs(floor(e01.g*255.+.5)-uCur),.5)+step(abs(floor(e11.g*255.+.5)-uCur),.5));',
'    float lD=1.-smoothstep(hwD-aa,hwD+aa,phiD);',
'    float lP=1.-smoothstep(hwP-aa,hwP+aa,phiP);',
'    float lC=curN*(1.-smoothstep(hwC-aa,hwC+aa,phiD));',
'    lnH=max(max(1.-smoothstep(hwD*2.3-aa,hwD*2.3+aa*2.,phiD),0.)*.4,(1.-smoothstep(hwP*1.9-aa,hwP*1.9+aa*2.,phiP))*.5)*fadeFar;',
'    lnC=vec3(1.,.95,.82);lnA=lD*.8;',
'    lnC=mix(lnC,vec3(1.,.86,.62),lP);lnA=max(lnA,lP*.95);',
'    lnC=mix(lnC,uAccent,lC);lnA=max(lnA,lC);',
'    lnA*=fadeFar;',
'    float idc=idAt(uv);alb=mix(alb,uAccent,step(abs(idc-uCur),.5)*.10);',
'  }',
'  // ---- district reveal ----',
'  vec3 emis=vec3(0.);',
'  if(uReveal>.001){',
'    float id0=idAt(uv);',
'    float off=max(1.,dist*.0045/2.5);vec2 o=vec2(off/3840.,off/2496.);',
'    float a1=idAt(uv+vec2(o.x,0.)),a2=idAt(uv-vec2(o.x,0.)),a3=idAt(uv+vec2(0.,o.y)),a4=idAt(uv-vec2(0.,o.y));',
'    float tIn=step(abs(id0-uTgtId),.5);',
'    float tN=step(abs(a1-uTgtId),.5)+step(abs(a2-uTgtId),.5)+step(abs(a3-uTgtId),.5)+step(abs(a4-uTgtId),.5);',
'    float edgeT=tIn>.5?step(tN,3.5):step(.5,tN);',
'    float lIn=step(abs(id0-uLandId),.5);',
'    alb=mix(alb,uFillCol,lIn*.5*uReveal);',
'    alb=mix(alb,uTgtCol,tIn*.26*uReveal);',
'    emis+=vec3(1.,.93,.75)*edgeT*uReveal*.95+uFillCol*lIn*.10*uReveal;',
'  }',
'  // ---- lighting: live sun and moon against heightmap normals ----',
'  float diff=max(dot(N,uSun),0.);',
'  float sunVis=smoothstep(uTermH-350.,uTermH+250.,h+(nA.r-.5)*200.);',
'  float cs=0.;if(vW.y<66.){cs=cloudDen(xz-uDrift+uSun.xz/max(uSun.y,.08)*(72.-vW.y))*(1.-uReveal);}',
'  float shT=0.;',
'  if(uShadowOn>.5&&diff>.02&&dist<1100.){',
'    vec2 sd=normalize(uSun.xz+1e-5);float tanE=uSun.y/max(length(uSun.xz),.05);float y0=vW.y+.8;',
'    for(int i=0;i<4;i++){float t=10.*pow(2.3,float(i));vec2 pp=xz+sd*t;',
'      float hh=textureLod(uHeight,vec2(pp.x/CW+.5,pp.y/CH+.5),i>0?1.:0.).r*VEXC;',
'      shT=max(shT,smoothstep(0.,3.+t*.04,hh-(y0+tanE*t)));}',
'  }',
'  vec3 direct=uSunCol*diff*sunVis*(1.-shT)*(1.-.5*cs);',
'  vec3 moonL=uMoonCol*max(dot(N,uMoon),0.)*(1.-.4*cs);',
'  float aoK=mix(.55,1.,aoT);',
'  vec3 amb=mix(uGndAmb,uSkyAmb,N.y*.5+.5)*(.7+.3*N.y)*aoK;',
'  vec3 col=alb*(direct+moonL+amb)+emis;',
'  // alpenglow: high snow and rock catch the last and first light',
'  float hi=smoothstep(4200.,5100.,h)*(.55+.45*smoothstep(.0,.5,max(snow,rockW*.7)));',
'  float soft=clamp(dot(N,uSun)*.5+.5,0.,1.);',
'  vec3 glowC=alb*mix(uAlpCol*vec3(.95,.62,1.2),uAlpCol*vec3(1.15,.95,.55),soft)*uAlp*hi*(.25+1.1*soft*soft)*2.6;',
'  if(uLampOn>.01){vec3 Lp=uLampPos-vW;float ld=length(Lp);vec3 Ld=Lp/ld;float cone=smoothstep(.88,.975,dot(-Ld,uLampDir));col+=alb*vec3(1.,.9,.68)*cone*uLampOn*max(dot(N,Ld),0.)*3.2/(1.+ld*ld*.0011);}',
'  col=mix(col,vec3(.02,.02,.03),lnH);col=mix(col,lnC*uLineGain,lnA);',
'  if(uWorldOn>.5){',
'    float core=smoothstep(.45,.95,dn);float flatL=1.-smoothstep(.1,.35,slope);float nearL=1.-smoothstep(150.,1100.,dist);',
'    float soft=core*(nB.g*.7+nC.b*.4+.2)*uNight*flatL*(.35+.65*(1.-nearL));',
'    vec2 lc=floor(xz*.55);float rr=hash12(lc),flick=.75+.25*sin(rr*40.+uNight*0.);float lamp=step(rr,core*.55)*smoothstep(.22,.0,length(fract(xz*.55)-.5))*nearL*uNight*flatL*flick;',
'    col+=vec3(1.,.47,.14)*soft*.9+vec3(1.,.72,.38)*lamp*2.6;',
'    float rs=texture2D(uWorld,uv,-1.).b*255.;float farFade=smoothstep(40.,140.,dist)*(1.-smoothstep(2500.,5000.,dist));',
'    float rl=smoothstep(2.3,3.5,rs);float dash=step(.45,fract(dot(xz,vec2(.7,.7))*.45));',
'    col=mix(col,vec3(.62,.58,.52)*(uSunCol*.25+uSkyAmb+.12),rl*.5*farFade*(1.-uNight));',
'    col+=vec3(1.,.5,.16)*rl*dash*uNight*.7*farFade;',
'  }',
'  // water glint (sun or moon)',
'  vec3 Rr=reflect(-uSun,vec3(0.,1.,0.));',
'  col+=uSunCol*pow(max(dot(Rr,Vv),0.),90.)*wM*.8*sunVis;',
'  vec3 Rm=reflect(-uMoon,vec3(0.,1.,0.));',
'  col+=uMoonCol*pow(max(dot(Rm,Vv),0.),60.)*wM*1.4;',
'  // morning valley fog (burns off after sunrise)',
'  float kt=1.-smoothstep(70.,190.,distance(xz,uKtm));',
'  float fogTop=mix(340.,1750.,kt);',
'  float fogA=uFogMorn*smoothstep(fogTop,fogTop-380.,h)*(.55+.45*nB.g)*(1.-smoothstep(700.,3500.,dist)*.5);',
'  col=mix(col,uFogCol,fogA*.5);',
'  // ---- aerial perspective ----',
'  float fd=1.-exp(-pow(dist*uFogK,1.4));',
'  fd=clamp(fd+(1.-exp(-dist*.0007))*exp(-max(h,0.)*.0005)*.16,0.,1.);',
'  vec3 hz=uHazeCol+uSunCol*.10*pow(max(dot(-Vv,uSun),0.),5.)*sunVis+uAlpCol*uAlp*.12*pow(max(dot(-Vv,uSun),0.),3.);',
'  col=mix(col,hz,fd);',
'  col+=glowC*(1.-.5*fd);',
'  vec2 oq=abs(uv-.5)*2.-1.;col=mix(col,hz,smoothstep(0.,.1,max(oq.x,oq.y)));',
'  gl_FragColor=vec4(col,1.);',
'  #include <tonemapping_fragment>',
'  #include <colorspace_fragment>',
'}'].join('\n');

var CLOUDV=[
'attribute vec4 aOff;attribute vec2 aSeed;uniform vec2 uDrift;varying vec2 vUv;varying float vA;varying float vDist;varying float vSeed;',
'void main(){',
'  vec3 c=aOff.xyz;float sz=aOff.w;c.x=mod(c.x+uDrift.x+4800.,9600.)-4800.;c.z=mod(c.z+uDrift.y+3120.,6240.)-3120.;',
'  vec3 toC=c-cameraPosition;float d=length(toC);',
'  vec3 r=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);',
'  vec3 u=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);',
'  vec3 p=c+(r*position.x+u*position.y*.62)*sz;',
'  vUv=position.xy;vSeed=aSeed.x;vDist=d;',
'  vA=smoothstep(35.,120.,d)*(1.-smoothstep(1500.,2600.,d));',
'  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);',
'}'].join('\n');
var CLOUDF=[
'precision highp float;varying vec2 vUv;varying float vA;varying float vDist;varying float vSeed;uniform vec3 uLight,uHaze,uShade;uniform float uFogK;uniform sampler2D uNoise;',
'void main(){',
'  float r=length(vUv);if(r>1.)discard;',
'  float n=texture2D(uNoise,vUv*.35+vec2(vSeed*.37,vSeed*.71)).b;',
'  float a=smoothstep(1.,.15,r)*(.55+.55*n);a=clamp(a,0.,1.)*vA*.8;',
'  vec3 c=mix(uShade,uLight,smoothstep(-.7,.6,vUv.y+n*.3));',
'  float fd=1.-exp(-pow(vDist*uFogK,1.4));c=mix(c,uHaze,fd*.8);',
'  gl_FragColor=vec4(c,a);',
'  #include <tonemapping_fragment>',
'  #include <colorspace_fragment>',
'}'].join('\n');

function lin(r,g,b){return new THREE.Color().setRGB(r,g,b,THREE.SRGBColorSpace);}

/* ---------------- terrain clipmap ---------------- */
var geoCache={},gridAttr=null;
function getGeo(ox,oz,hole){
  var key=hole?ox+','+oz:'full';if(geoCache[key])return geoCache[key];
  var idx=[],i,j,N1=GN-1;
  for(j=0;j<N1;j++)for(i=0;i<N1;i++){
    if(hole&&i>=40+ox&&i<120+ox&&j>=40+oz&&j<120+oz)continue;
    var a=j*GN+i,b=a+1,c=a+GN,d=c+1;
    if(((i+j)&1)===0)idx.push(a,c,b,b,c,d);else idx.push(a,c,d,a,d,b);
  }
  var geo=new THREE.BufferGeometry();geo.setAttribute('g',gridAttr);geo.setIndex(new THREE.BufferAttribute(new Uint16Array(idx),1));
  geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(),1e9);geoCache[key]=geo;return geo;
}
function initTerrain(){
  var g=new Float32Array(GN*GN*2);
  for(var j=0;j<GN;j++)for(var i=0;i<GN;i++){g[(j*GN+i)*2]=i;g[(j*GN+i)*2+1]=j;}
  gridAttr=new THREE.BufferAttribute(g,2);
  terrain.levels=[];
  var cw=W*CELL,ch=H*CELL;
  var vs=VERT.replace(/__CW__/g,cw.toFixed(1)).replace(/__CH__/g,ch.toFixed(1));
  var fs=FRAG.replace(/__CW__/g,cw.toFixed(1)).replace(/__CH__/g,ch.toFixed(1)).replace(/__W1__/g,String(W-2)).replace(/__H1__/g,String(H-2)).replace(/__W__/g,W+'.0').replace(/__H__/g,H+'.0');
  for(var k=0;k<LEVELS;k++){
    var u=Object.assign({},common,{uC:{value:new THREE.Vector2()},uS:{value:CELL*Math.pow(2,k)},uLod:{value:k},uMorph:{value:k<LEVELS-1?1:0}});
    var m=new THREE.ShaderMaterial({uniforms:u,vertexShader:vs,fragmentShader:fs,side:THREE.DoubleSide});
    var mesh=new THREE.Mesh(getGeo(0,0,k>0),m);mesh.frustumCulled=false;scene.add(mesh);
    terrain.levels.push({mesh:mesh,u:u,s:CELL*Math.pow(2,k)});
  }
}
function updateTerrain(px,pz){
  var prev=null,L=terrain.levels;
  for(var k=0;k<LEVELS;k++){
    var s=L[k].s,cx=Math.floor(px/(2*s))*2*s,cz=Math.floor(pz/(2*s))*2*s;
    L[k].u.uC.value.set(cx,cz);
    if(k>0){var ox=Math.round((prev.cx-cx)/s),oz=Math.round((prev.cz-cz)/s);ox=clamp(ox,0,1);oz=clamp(oz,0,1);L[k].mesh.geometry=getGeo(ox,oz,true);}
    L[k].cx=cx;L[k].cz=cz;prev=L[k];
  }
}

/* ---------------- clouds ---------------- */
function initClouds(){
  var offs=[],seeds=[],rnd=mulberry(99),GX=W*CELL,GZ=H*CELL,step=120;
  for(var z=-GZ/2;z<GZ/2;z+=step)for(var x=-GX/2;x<GX/2;x+=step){
    var cx=x+(rnd()-.5)*step,cz=z+(rnd()-.5)*step;
    var d=cloudDen(cx,cz);if(d<.35||rnd()>.8)continue;
    var n=1+Math.floor(rnd()*3);
    for(var q=0;q<n;q++){offs.push(cx+(rnd()-.5)*70,60+rnd()*26+d*8,cz+(rnd()-.5)*70,30+rnd()*46*(.6+d));seeds.push(rnd()*10,rnd());}
  }
  var cnt=offs.length/4;
  var geo=new THREE.InstancedBufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),3));
  geo.setIndex([0,1,2,0,2,3]);
  geo.setAttribute('aOff',new THREE.InstancedBufferAttribute(new Float32Array(offs),4));
  geo.setAttribute('aSeed',new THREE.InstancedBufferAttribute(new Float32Array(seeds),2));
  geo.instanceCount=cnt;
  var m=new THREE.ShaderMaterial({uniforms:{uNoise:common.uNoise,uFogK:common.uFogK,uHaze:common.uHazeCol,uLight:{value:lin(1,.97,.93)},uShade:{value:lin(.55,.62,.74)},uDrift:{value:new THREE.Vector2()}},vertexShader:CLOUDV,fragmentShader:CLOUDF,transparent:true,depthWrite:false});
  cloudMesh=new THREE.Mesh(geo,m);cloudMesh.frustumCulled=false;cloudMesh.renderOrder=5;scene.add(cloudMesh);
  return cnt;
}

/* ---------------- boot ---------------- */
var qualityPR=1.5,isMobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
function makeRenderer(){
  var pr=Math.min(window.devicePixelRatio||1,1.5);
  renderer=new THREE.WebGLRenderer({canvas:$('c'),antialias:!isMobile&&pr<=1.01,powerPreference:'high-performance'});
  qualityPR=pr;renderer.setPixelRatio(pr);renderer.setSize(innerWidth,innerHeight);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,1,7000);
}
async function boot(){
  setProg(.02,'Starting renderer');
  makeRenderer();
  var gl=renderer.getContext();
  if(!gl)throw new Error('WebGL is not available');
  var base='data/';
  setProg(.04,'Loading district data');
  META=await fetch(base+'districts.json').then(function(r){if(!r.ok)throw new Error('districts.json');return r.json();});
  if(META.districts.length!==77)throw new Error('expected 77 districts');
  W=META.grid.W;H=META.grid.H;SS=META.grid.SS;RW=W*SS;RH=H*SS;
  META.districts.forEach(function(d){DBYID[d.id]=d;});
  var sv=META.grid.sun;sunVec=new THREE.Vector3(sv[0],sv[1],sv[2]);

  setProg(.06,'Loading elevation');
  var hb=await fetchBlob(base+'height.png',function(f){setProg(.06+f*.34);});
  setProg(.40,'Decoding elevation');
  var him=await blobImg(hb);
  HF=new Float32Array(W*H);
  var hs=META.grid.hscale,ho=META.grid.hoff;
  readPixels(him,function(y0,n,d){for(var p=0;p<W*n;p++)HF[y0*W+p]=((d[p*4]<<8)|d[p*4+1])/hs-ho;});

  setProg(.46,'Loading rivers and masks');
  var mb=await fetchBlob(base+'mask.png',function(f){setProg(.46+f*.06);});
  var mim=await blobImg(mb);
  var mask=new Uint8Array(W*H*3);
  readPixels(mim,function(y0,n,d){for(var p=0;p<W*n;p++){var o=(y0*W+p)*3;mask[o]=d[p*4];mask[o+1]=d[p*4+1];mask[o+2]=d[p*4+2];}});
  MASK_RIVER=new Uint8Array(W*H);for(var mp=0;mp<W*H;mp++)MASK_RIVER[mp]=mask[mp*3];
  setProg(.56,'Loading districts');
  var db=await fetchBlob(base+'districts.png');var dim=await blobImg(db);
  IDS=new Uint8Array(RW*RH);
  readPixels(dim,function(y0,n,d){for(var p=0;p<RW*n;p++)IDS[y0*RW+p]=d[p*4];});

  setProg(.60,'Loading borders');
  var eb=await fetchBlob(base+'edge.png');var eim=await blobImg(eb);var ed=new Uint8Array(W*H*4);
  readPixels(eim,function(y0,n,px){ed.set(px,y0*W*4);});
  texEdge=new THREE.DataTexture(ed,W,H,THREE.RGBAFormat,THREE.UnsignedByteType);texEdge.minFilter=texEdge.magFilter=THREE.NearestFilter;texEdge.generateMipmaps=false;texEdge.needsUpdate=true;
  var provNames=[],provOf=new Array(80).fill(0);META.districts.forEach(function(d){var i=provNames.indexOf(d.province);if(i<0){provNames.push(d.province);i=provNames.length-1;}provOf[d.id]=i+1;});
  setProg(.62,'Building height pyramid');
  await new Promise(function(r){setTimeout(r,0);});
  var mips=buildHalfMips(HF,W,H);
  texHeight=new THREE.DataTexture(mips[0].data,W,H,THREE.RedFormat,THREE.HalfFloatType);
  texHeight.mipmaps=mips;texHeight.generateMipmaps=false;texHeight.minFilter=THREE.LinearMipmapLinearFilter;texHeight.magFilter=THREE.LinearFilter;
  texHeight.wrapS=texHeight.wrapT=THREE.ClampToEdgeWrapping;texHeight.unpackAlignment=1;texHeight.needsUpdate=true;

  setProg(.74,'Computing slopes');
  await new Promise(function(r){setTimeout(r,0);});
  var dat=new Uint8Array(W*H*4),k2=VEX/(2*CELL);
  for(var j=0;j<H;j++)for(var i=0;i<W;i++){
    var p=j*W+i,il=i>0?p-1:p,ir=i<W-1?p+1:p,ju=j>0?p-W:p,jd=j<H-1?p+W:p;
    var gx=(HF[ir]-HF[il])*k2,gz=(HF[jd]-HF[ju])*k2,len=Math.sqrt(gx*gx+1+gz*gz);
    dat[p*4]=Math.round(((-gx/len)*.5+.5)*255);dat[p*4+1]=Math.round(((-gz/len)*.5+.5)*255);dat[p*4+2]=mask[p*3];dat[p*4+3]=mask[p*3+1];
  }
  texData=new THREE.DataTexture(dat,W,H,THREE.RGBAFormat,THREE.UnsignedByteType);
  texData.generateMipmaps=true;texData.minFilter=THREE.LinearMipmapLinearFilter;texData.magFilter=THREE.LinearFilter;texData.needsUpdate=true;
  // aux: R shadow, G urban (half resolution)
  var SW=W>>1,SH=H>>1,aux=new Uint8Array(SW*SH*4),blr=boxBlur(HF,W,H,9);
  for(j=0;j<SH;j++)for(i=0;i<SW;i++){var q=(2*j*W+2*i)*3+2,hp=2*j*W+2*i;aux[(j*SW+i)*4]=Math.round(255*(1-clamp((blr[hp]-HF[hp])/650,0,1)));aux[(j*SW+i)*4+1]=Math.max(mask[q],mask[q+3],mask[q+W*3],mask[q+W*3+3]);aux[(j*SW+i)*4+3]=255;}
  texAux=new THREE.DataTexture(aux,SW,SH,THREE.RGBAFormat,THREE.UnsignedByteType);
  texAux.generateMipmaps=true;texAux.minFilter=THREE.LinearMipmapLinearFilter;texAux.magFilter=THREE.LinearFilter;texAux.needsUpdate=true;
  setProg(.82,'Preparing textures');
  NOISE=makeNoise();
  texNoise=new THREE.DataTexture(NOISE,256,256,THREE.RGBAFormat,THREE.UnsignedByteType);
  texNoise.wrapS=texNoise.wrapT=THREE.RepeatWrapping;texNoise.generateMipmaps=true;texNoise.minFilter=THREE.LinearMipmapLinearFilter;texNoise.magFilter=THREE.LinearFilter;texNoise.needsUpdate=true;
  texDist=new THREE.DataTexture(IDS,RW,RH,THREE.RedFormat,THREE.UnsignedByteType);
  texDist.minFilter=texDist.magFilter=THREE.NearestFilter;texDist.generateMipmaps=false;texDist.unpackAlignment=1;texDist.needsUpdate=true;

  setProg(.88,'Building terrain');
  await new Promise(function(r){setTimeout(r,0);});
  common={
    uHeight:{value:texHeight},uData:{value:texData},uAux:{value:texAux},uNoise:{value:texNoise},uDist:{value:texDist},
    uSun:{value:sunVec},uSunCol:{value:new THREE.Color(1.0,.78,.55).multiplyScalar(3.0)},
    uHazeCol:{value:lin(.74,.82,.92)},uSkyAmb:{value:lin(.36,.50,.74).multiplyScalar(.85)},uGndAmb:{value:lin(.34,.30,.24).multiplyScalar(.5)},
    uEdge:{value:texEdge},uProvOf:{value:provOf},uBorders:{value:bordersOn?1:0},uCur:{value:-1},uPixW:{value:.0015},uLineGain:{value:1},uAccent:{value:new THREE.Color(1,.78,.28)},uFogK:{value:1/2300},uWorld:{value:new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1,THREE.RGBAFormat,THREE.UnsignedByteType)},uWorldOn:{value:0},uLit:{value:0},uLampPos:{value:new THREE.Vector3()},uLampDir:{value:new THREE.Vector3(0,-1,0)},uLampOn:{value:0},uMoon:{value:new THREE.Vector3(0,-1,0)},uMoonCol:{value:new THREE.Color()},uAlpCol:{value:new THREE.Color(1,.4,.3)},uFogCol:{value:new THREE.Color(.8,.8,.9)},uDrift:{value:new THREE.Vector2()},uKtm:{value:new THREE.Vector2()},uTermH:{value:0},uAlp:{value:0},uShadowOn:{value:0},uFogMorn:{value:0},uNight:{value:0},uReveal:{value:0},uLandId:{value:-1},uTgtId:{value:-1},uFillCol:{value:new THREE.Color(.1,.9,.3)},uTgtCol:{value:new THREE.Color(.6,.8,1)}
  };
  initTerrain();
  initSky();
  setProg(.94,'Adding clouds and aircraft');
  var nc=initClouds();
  initBirds();
  buildJet();
  buildExtras();
  META.cloudCount=nc;
  initMinimap();
  setProg(1,'Ready');
}

/*__OTTER__*/
/*__SKY__*/
/*__BIRDS__*/
/*__WORLD__*/
/*__AIRPORT__*/
/*__PACKAGE__*/
/*__PEAKS__*/
/*__MINIMAP__*/

/* ====================== gameplay ====================== */
var peaksOn=true,soundOn=true,namesOn=true,paused=false;try{namesOn=localStorage.getItem('pipal_delivery_names')!=='0';peaksOn=localStorage.getItem('pipal_delivery_peaks')!=='0';soundOn=localStorage.getItem('pipal_delivery_sound')!=='0';}catch(e){}
var bordersOn=true;try{bordersOn=localStorage.getItem('pipal_delivery_borders')!=='0';}catch(e){}
var phase='boot';             // boot | pre | ground | fly | reveal | results
var px=0,py=0,pz=0,vy=0,speed=0,heading=0,steerDX=0,steerDY=0,tDX=0,tDY=0,steerActive=false,steerId=null,steerOX=0,steerOY=0,kbX=0,kbY=0,kbBoost=false;
var airMode='ground';         // ground | air
var camMode='orbit';
var runStart=0,run=null,mission=null,pkg=null,revealT=0,revealData=null,airport=null,lastAirport=-1;
var score=0,streak=0,maxStreak=0,hits=0,newLearned=0,coinsEarned=0;
var stats={};var STORE='pipal_delivery_v1';
function loadStats(){try{stats=JSON.parse(localStorage.getItem(STORE)||'{}')||{};}catch(e){stats={};}}
function saveStats(){try{localStorage.setItem(STORE,JSON.stringify(stats));}catch(e){}}
function st(id){return stats[id]||(stats[id]={a:0,h:0,b:-1});}
function learnedCount(){var n=0;for(var i=1;i<=77;i++)if(stats[i]&&stats[i].h>0)n++;return n;}
function masteredCount(){var n=0;for(var i=1;i<=77;i++){var s=stats[i];if(s&&s.h>=2&&s.h/s.a>=.6)n++;}return n;}
var ALIAS={'Chitawan':'Chitwan','Dhanusa':'Dhanusha','Nawalparasi East':'Nawalparasi East','Nawalparasi West':'Nawalparasi West'};
var ALT={'Nawalparasi East':'also called Nawalpur','Nawalparasi West':'also called Parasi','Chitawan':'','Rukum East':'','Rukum West':''};
function dname(d){return ALIAS[d.name]||d.name;}

/* --- audio --- */
var AC=null,aud={};
function initAudio(){
  if(AC)return;
  try{
    AC=new (window.AudioContext||window.webkitAudioContext)();
    var len=AC.sampleRate*2,buf=AC.createBuffer(1,len,AC.sampleRate),d=buf.getChannelData(0),last=0;
    for(var i=0;i<len;i++){var w=Math.random()*2-1;last=(last+.02*w)/1.02;d[i]=last*3.5;}
    var src=AC.createBufferSource();src.buffer=buf;src.loop=true;
    var eF=AC.createBiquadFilter();eF.type='lowpass';eF.frequency.value=300;var eG=AC.createGain();eG.gain.value=.0;
    src.connect(eF);eF.connect(eG);eG.connect(AC.destination);src.start();
    var o1=AC.createOscillator(),o2=AC.createOscillator();o1.type='sawtooth';o2.type='sawtooth';o1.frequency.value=70;o2.frequency.value=72;
    var oF=AC.createBiquadFilter();oF.type='lowpass';oF.frequency.value=180;var oG=AC.createGain();oG.gain.value=0;
    o1.connect(oF);o2.connect(oF);oF.connect(oG);oG.connect(AC.destination);o1.start();o2.start();var lfo=AC.createOscillator(),lg=AC.createGain();lfo.frequency.value=16;lg.gain.value=.022;lfo.connect(lg);lg.connect(oG.gain);lfo.start();
    var wS=AC.createBufferSource();wS.buffer=buf;wS.loop=true;wS.playbackRate.value=1.7;var wF=AC.createBiquadFilter();wF.type='bandpass';wF.frequency.value=900;wF.Q.value=.5;var wG=AC.createGain();wG.gain.value=0;
    wS.connect(wF);wF.connect(wG);wG.connect(AC.destination);wS.start();
    aud={lfo:lfo,eF:eF,eG:eG,o1:o1,o2:o2,oG:oG,wG:wG,wF:wF,buf:buf};
  }catch(e){AC=null;}
}
function audioUpdate(){
  if(!AC||!aud.eG)return;
  var on=(phase==='ground'||phase==='fly'||phase==='reveal')?1:0.25;
  var sp=clamp(speed/BOOST,0,1.1),t=AC.currentTime;
  aud.eG.gain.setTargetAtTime((.05+.10*sp)*on,t,.1);aud.eF.frequency.setTargetAtTime(220+sp*700,t,.1);
  aud.oG.gain.setTargetAtTime((.04+.05*sp)*on,t,.1);aud.o1.frequency.setTargetAtTime(62+PROP_RPM*52,t,.12);aud.o2.frequency.setTargetAtTime(64+PROP_RPM*53,t,.12);aud.lfo.frequency.setTargetAtTime(11+PROP_RPM*12,t,.12);
  var alt=clamp((py-gY(px,pz))/150,0,1);
  aud.wG.gain.setTargetAtTime((.01+.09*sp*sp)*(airMode==='air'?1:0)*on,t,.15);aud.wF.frequency.setTargetAtTime(500+sp*1500,t,.15);
}
function tone(f,dur,type,vol,delay,slide){
  if(!AC)return;try{var t=AC.currentTime+(delay||0),o=AC.createOscillator(),g=AC.createGain();o.type=type||'sine';o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(slide,t+dur);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol||.15,t+.02);g.gain.exponentialRampToValueAtTime(.0008,t+dur);o.connect(g);g.connect(AC.destination);o.start(t);o.stop(t+dur+.05);}catch(e){}
}
function whoosh(dur,from,to,vol){
  if(!AC||!aud.buf)return;try{var s=AC.createBufferSource();s.buffer=aud.buf;var f=AC.createBiquadFilter();f.type='bandpass';f.Q.value=.8;var t=AC.currentTime;f.frequency.setValueAtTime(from,t);f.frequency.exponentialRampToValueAtTime(to,t+dur);
  var g=AC.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+dur*.2);g.gain.linearRampToValueAtTime(0,t+dur);s.connect(f);f.connect(g);g.connect(AC.destination);s.start(t);s.stop(t+dur+.05);}catch(e){}
}

/* --- extras: runway, package, reveal props, wing vapor --- */
var runway,pkgMesh,beacon,ribbon,vapor={n:160,pos:null,life:null,line:null,i:0,a:null},prevL=null,prevR=null,vaporHold=0,pDX=0,pDY=0,pSpd=0;
function buildExtras(){
  var c=document.createElement('canvas');c.width=64;c.height=512;var x=c.getContext('2d');x.fillStyle='#3a3d42';x.fillRect(0,0,64,512);
  x.fillStyle='#e8e8e0';for(var i=0;i<16;i++)x.fillRect(29,i*32+6,6,18);x.fillRect(4,0,3,512);x.fillRect(57,0,3,512);
  for(i=0;i<6;i++){x.fillRect(12+i*6,14,3,40);x.fillRect(12+i*6,458,3,40);}
  var rt=new THREE.CanvasTexture(c);rt.colorSpace=THREE.SRGBColorSpace;
  runway=new THREE.Mesh(new THREE.PlaneGeometry(6,38),new THREE.MeshBasicMaterial({map:rt,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));
  runway.rotation.order='YXZ';runway.rotation.x=-Math.PI/2;runway.visible=false;scene.add(runway);
  pkgMesh=buildPackage();
  beacon=new THREE.Group();
  for(i=0;i<2;i++){var b=new THREE.Mesh(new THREE.CylinderGeometry(.8,.8,160,10,1,true),new THREE.MeshBasicMaterial({color:i?0xffffff:0x44ff88,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));b.position.y=80;b.visible=true;beacon.add(b);}
  beacon.visible=false;scene.add(beacon);
  ribbon=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.85,depthTest:false,side:THREE.DoubleSide}));
  ribbon.renderOrder=20;ribbon.frustumCulled=false;ribbon.visible=false;scene.add(ribbon);
  // wing vapor
  vapor.pos=new Float32Array(vapor.n*6);vapor.col=new Float32Array(vapor.n*6);vapor.life=new Float32Array(vapor.n);
  var vg=new THREE.BufferGeometry();vg.setAttribute('position',new THREE.BufferAttribute(vapor.pos,3));vg.setAttribute('color',new THREE.BufferAttribute(vapor.col,3));
  vapor.line=new THREE.LineSegments(vg,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  vapor.line.frustumCulled=false;scene.add(vapor.line);
}
function addVapor(a,b,life){var i=vapor.i;vapor.i=(i+1)%vapor.n;vapor.life[i]=life;vapor.pos.set([a.x,a.y,a.z,b.x,b.y,b.z],i*6);}
function updateVapor(k,fx,fz){
  if(airMode==='air'){
    jet.updateMatrixWorld(true);
    var L=jet.localToWorld(new THREE.Vector3(-9.95*PSC,1.55*PSC,.4*PSC)),R=jet.localToWorld(new THREE.Vector3(9.95*PSC,1.55*PSC,.4*PSC));
    var turn=Math.abs(steerDX),vert=Math.abs(steerDY),ich=Math.abs(steerDX-pDX)+Math.abs(steerDY-pDY),sch=Math.abs(speed-pSpd)*3.5/2.5;
    var act=turn*.65+vert*.55+ich*1.25+sch;
    if(ich<.025&&sch<.025)vaporHold=Math.min(1,vaporHold+.025*k);else vaporHold=0;
    var inten=Math.max(0,act-vaporHold*.8);
    if(inten>.35&&(turn>.5||speed>CRUISE*1.4)&&prevL){addVapor(L,prevL,.5+inten*.4);addVapor(R,prevR,.5+inten*.4);}
    prevL=L;prevR=R;pDX=steerDX;pDY=steerDY;pSpd=speed;
  }else{prevL=prevR=null;}
  var dec=k/60;
  for(var i=0;i<vapor.n;i++){
    var l=vapor.life[i];if(l>0){l=Math.max(0,l-dec);vapor.life[i]=l;}
    var c=Math.min(1,l*2)*.75;for(var q=0;q<6;q++)vapor.col[i*6+q]=c;
    if(l<=0){vapor.pos[i*6+1]=-9999;vapor.pos[i*6+4]=-9999;}
  }
  vapor.line.geometry.attributes.position.needsUpdate=true;vapor.line.geometry.attributes.color.needsUpdate=true;
}

/* --- missions --- */
var order=null;
function areaOrder(){if(!order)order=META.districts.slice().sort(function(a,b){return b.area-a.area;});return order;}
var ANCHORS=['Chitawan','Morang','Kaski','Jhapa','Kailali','Mustang','Dolpa','Kathmandu'];
function chooseMission(){
  var o=areaOrder(),pool=Math.min(77,14+2*learnedCount()),cand=[],w=[],i;
  for(i=0;i<o.length;i++){
    var d=o[i];if(run.used.indexOf(d.id)>=0)continue;
    if(i>=pool&&ANCHORS.indexOf(d.name)<0)continue;
    var s=stats[d.id],wt;
    if(!s||!s.a)wt=1.4;else{var miss=1-s.h/s.a;wt=(s.h>=2&&s.h/s.a>=.6)?.2:.45+2.2*miss;}
    cand.push(d);w.push(wt);
  }
  if(!cand.length){cand=META.districts.filter(function(d){return run.used.indexOf(d.id)<0;});w=cand.map(function(){return 1;});}
  var tot=0;for(i=0;i<w.length;i++)tot+=w[i];var r=Math.random()*tot;
  for(i=0;i<w.length;i++){r-=w[i];if(r<=0)return cand[i];}
  return cand[cand.length-1];
}
function startMission(){
  var d=chooseMission();run.used.push(d.id);
  mission={d:d,hints:0,err:(hsh(d.id,run.done,91)*2-1)*25*DEG,arrowT:0};rollDecoys();
  $('m-name').textContent=dname(d);$('m-alias').textContent=ALT[d.name]||'';
  $('m-hints').innerHTML='';renderHintDots();$('hintBtn').disabled=false;
  $('t-leg').textContent='Delivery '+(run.done+1)+' of '+MISSIONS_PER_RUN;$('t-pts').textContent=score+' pts';
  setDropState('armed');wake();
  setTip('Fly to where you think '+dname(d)+' is, then press Drop',6000);
}
function renderHintDots(){var n=mission?Math.max(0,4-mission.hints):4,h='';for(var i=0;i<4;i++)h+='<i class="'+(i<n?'':'u')+'"></i>';$('hintDots').innerHTML=h;}
function setDropState(s){var b=$('dropBtn');b.classList.toggle('armed',s==='armed');b.disabled=(s==='off'||s==='away'||s==='release');$('dropLab').textContent=s==='away'?'Away':(s==='release'?'Release':'Drop');
  if(s!=='away')b.querySelector('.rp').style.strokeDashoffset='295.3';}
function updateDustOnly(k){if(!pkg||!pkg.landed)updateDust(k/60);}
function updateLive(){}
function useHint(){
  if(!mission||phase!=='fly'||paused)return;
  var d=mission.d,h=mission.hints++;
  if(h===1){var el=document.createElement('div');el.innerHTML='<b>Province</b> '+d.province;$('m-hints').appendChild(el);}
  mission.arrowT=8;renderHintDots();wake();tone(660,.15,'sine',.08);
}
function hintMult(n){return [1,.85,.7,.58,.48,.4,.33,.28][Math.min(n,7)];}
var arrow3d=null;
function buildHintArrow(){
  var sh=new THREE.Shape();sh.moveTo(0,-3.2);sh.lineTo(1.5,-.6);sh.lineTo(.5,-.9);sh.lineTo(.5,2.4);sh.lineTo(-.5,2.4);sh.lineTo(-.5,-.9);sh.lineTo(-1.5,-.6);sh.closePath();
  var geo=new THREE.ShapeGeometry(sh);geo.rotateX(Math.PI/2);geo.scale(1,1,-1);
  var m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0xffbf5a,transparent:true,opacity:0,depthTest:false,side:THREE.DoubleSide}));m.renderOrder=30;m.frustumCulled=false;m.visible=false;scene.add(m);arrow3d=m;
}
function updateHintArrow(dt){
  var el=$('hintArrow');
  if(!mission||phase!=='fly'||mission.arrowT<=0){if(arrow3d)arrow3d.visible=false;el.classList.remove('on');return;}
  mission.arrowT-=dt;var a=clamp(Math.min(mission.arrowT/1.2,1,(8-mission.arrowT)/.3+.001),0,1);
  var d=mission.d,tx=(d.ix-W/2)*CELL,tz=(d.iy-H/2)*CELL,ht=Math.atan2(-(tx-px),-(tz-pz))+mission.err;
  if(!arrow3d)buildHintArrow();
  arrow3d.visible=true;arrow3d.material.opacity=.9*a;
  var tt=performance.now()/1000,fx=-Math.sin(ht),fz=-Math.cos(ht);
  arrow3d.position.set(px+fx*6.5,py+2.6+Math.sin(tt*3)*.25,pz+fz*6.5);arrow3d.rotation.y=ht;
  var ang=ht-heading;ang=Math.atan2(Math.sin(ang),Math.cos(ang));
  var cx=innerWidth/2,cy=innerHeight/2,dx=-Math.sin(ang),dy=-Math.cos(ang),m=58,tx2=Math.abs(dx)>1e-3?(cx-m)/Math.abs(dx):1e9,ty2=Math.abs(dy)>1e-3?(cy-m-40)/Math.abs(dy):1e9,t=Math.min(tx2,ty2);
  el.style.transform='translate('+(cx+dx*t)+'px,'+(cy+dy*t*.92+10)+'px) rotate('+(-ang)+'rad)';el.style.opacity=a;el.classList.add('on');
}
var tipTimer=null;
function setTip(t,ms){var e=$('tip');e.textContent=t;e.classList.add('on');clearTimeout(tipTimer);if(ms)tipTimer=setTimeout(function(){e.classList.remove('on');},ms);}
function clearTip(){clearTimeout(tipTimer);$('tip').classList.remove('on');}

/* --- start of run --- */
function pickAirport(){
  var n=META.airports.length,i;do{i=Math.floor(Math.random()*n);}while(i===lastAirport&&n>1);lastAirport=i;return META.airports[i];
}
function placeAtAirport(a){
  var p=lonLatToWorld(a.lon,a.lat),hd=-a.hdg*Math.PI/180,fx=-Math.sin(hd),fz=-Math.cos(hd);
  airport=a;heading=hd;a.wx=p.x;a.wz=p.z;
  px=p.x-fx*(a.len/2-3.5);pz=p.z-fz*(a.len/2-3.5);vy=0;speed=0;airMode='ground';TO.stage='idle';
  disposeAirportScene();buildAirportScene(a);AIR.id=META.airports.indexOf(a);
  py=groundSurface(px,pz)+GROUND_OFF;
  runway.visible=false;jet.position.set(px,py,pz);jet.rotation.set(0,heading,0);
  var did=idAtWorld(p.x,p.z);a.district=did?dname(DBYID[did]):'Nepal';
}
function groundSurface(x,z){var r=runwayY(x,z);return isNaN(r)?gY(x,z):r;}
function showPre(){
  phase='pre';camMode='orbit';mission=null;pkg=null;paused=false;
  $('reveal').classList.remove('on');$('cine').classList.remove('on');$('away').classList.remove('on');$('ring').classList.remove('on');$('hud').classList.remove('rv');
  placeAtAirport(pickAirport());
  var dl=idAtWorld(airport.wx,airport.wz);
  $('pre-ap').textContent=airport.name;$('pre-sub').textContent=airport.district+(dl&&DBYID[dl]?', '+DBYID[dl].province:'')+'  ·  '+(airport.elev)+' m';
  $('pre-learn').textContent=learnedCount()+'/77';$('pre-mast').textContent=masteredCount()+'/77';$('pre-bar').style.width=(learnedCount()/77*100)+'%';$('pre-time').textContent=clockText();
  refreshBord();
  $('pre').classList.remove('hide');$('hud').classList.add('hide');$('res').classList.add('hide');$('pause').classList.add('hide');$('cine').classList.add('hide');
  common.uReveal.value=0;beacon.visible=false;ribbon.visible=false;pkgMesh.visible=false;
  post({type:'stats',score:0,coins:0,timer:0,fuel:100,targets:0,kills:0,health:100});
}
function refreshBord(){
  var on=bordersOn?'On':'Off',pk=peaksOn?'On':'Off',sn=soundOn?'On':'Off';
  $('namesV').textContent=namesOn?'On':'Off';$('pNamesV').textContent=namesOn?'On':'Off';$('bordV').textContent=on;$('pBordV').textContent=on;$('peakV').textContent=pk;$('pPeakV').textContent=pk;$('pSoundV').textContent=sn;
  $('bordNote').textContent=(!bordersOn&&!namesOn)?'Expert x2: no borders and no map names.':(!bordersOn?'Expert x1.5: no borders.':(!namesOn?'Expert x1.5: no names on the map.':'Borders and map names help you learn the districts.'));
  common.uBorders.value=bordersOn?1:0;minimapCur(curId);
  var pe=$('peaks');if(pe)pe.style.display=peaksOn?'block':'none';
}
function setNames(v){namesOn=v;if(v&&run)run.namesUsed=true;try{localStorage.setItem('pipal_delivery_names',v?'1':'0');}catch(e){}refreshBord();}
function setBorders(v){bordersOn=v;if(v&&run)run.bordUsed=true;try{localStorage.setItem('pipal_delivery_borders',v?'1':'0');}catch(e){}refreshBord();}
function setPeaks(v){peaksOn=v;try{localStorage.setItem('pipal_delivery_peaks',v?'1':'0');}catch(e){}refreshBord();}
function setSound(v){soundOn=v;try{localStorage.setItem('pipal_delivery_sound',v?'1':'0');}catch(e){}if(AC){try{v?AC.resume():AC.suspend();}catch(e){}}refreshBord();}
function runMult(){if(!run)return 1;return Math.min(2,1+(run.bordUsed?0:.5)+(run.namesUsed?0:.5));}
function takeOff(){
  loadWorld();loadPeaks();loadCountries();
  initAudio();if(AC&&AC.state==='suspended'&&soundOn)try{AC.resume();}catch(e){}if(!soundOn&&AC)try{AC.suspend();}catch(e){}
  run={used:[],done:0,list:[],bordUsed:bordersOn,namesUsed:namesOn};score=0;streak=0;maxStreak=0;hits=0;newLearned=0;coinsEarned=0;runStart=performance.now();
  $('pre').classList.add('hide');$('hud').classList.remove('hide');$('cine').classList.remove('hide');
  phase='ground';camMode='chase';
  $('m-name').textContent='';$('m-alias').textContent='';$('m-hints').innerHTML='';$('t-leg').textContent='Departure';$('t-pts').textContent='';
  $('hintBtn').disabled=true;setDropState('off');renderHintDots();
  startTakeoffSeq();
  camTO=0;snapCamera();wake();
}
var TO={stage:'idle',t:0,a0:.001,yaw:0,pitchBlend:0,pitch:0,flapT:0,lift:0},camTO=1;
function solveAccel(D,VR){var lo=1e-5,hi=.03,a0=.001;for(var it=0;it<40;it++){a0=(lo+hi)/2;var v=0,s=0,n=0;while(v<VR&&n<4000){v+=a0*(.5+v/VR);s+=v;n++;}if(s>D)lo=a0;else hi=a0;}return a0;}
function startTakeoffSeq(){
  TO={stage:'spool',t:0,yaw:0,pitchBlend:0,pitch:0,flapT:1,lift:0,VR:.3,a0:solveAccel(airport.len*.66,.3)};PROP_RPM=0;AF.flapA=0;
  setTip('Engines starting',2600);
}

/* --- drop, reveal, scoring --- */
function doDrop(){
  if(phase!=='fly'||pkg||!mission||airMode!=='air'||paused)return;
  pkg={x:px,y:py,z:pz,vx:0,vy:0,vz:0,t:0,door:0,stage:'release',fall:0,mission:mission,hasChute:false,open:0,landed:false,lt:0,spin:0};
  pkgMesh.visible=false;setDropState('release');$('away').textContent='Releasing';$('away').classList.add('on');clearTip();
  whoosh(.5,600,300,.12);tone(180,.25,'triangle',.05,0,120);wake();
}
function updatePkg(k){
  var dt=k/60,P=pkg;P.t+=dt;
  if(P.landed){
    P.lt+=dt;PK.chuteU.uT.value=performance.now()/1000;PK.chuteU.uCol.value=clamp(P.lt/.9,0,1);
    PK.chute.position.x=P.lt*.7*Math.min(1,P.lt);PK.chute.position.y=1.2-clamp(P.lt/.9,0,1)*.9;
    var bt=P.lt<.5?Math.sin(P.lt/.5*Math.PI)*.35*Math.pow(1-P.lt/.5,1):0;
    P.y=P.gy+bt;pkgMesh.position.set(P.x,P.y,P.z);PK.crate.rotation.z*=.9;
    updateDust(dt);
    if(P.lt>1.7){var rec=P.pending;pkg=null;pkgMesh.visible=false;PK.chuteU.uCol.value=0;PK.chute.position.set(0,1.2,0);startReveal(rec);}
    return;
  }
  var jx=jet.position;
  if(P.stage==='release'){ // cargo door slides open, crate leaves the aircraft
    P.door=clamp(P.t/.45,0,1);$('away').textContent='Releasing';
    if(P.t>.55){jet.updateMatrixWorld(true);var l=jet.localToWorld(new THREE.Vector3(-1.4*PSC,-.1*PSC,3.6*PSC));P.x=l.x;P.y=l.y;P.z=l.z;
      var fx=-Math.sin(heading),fz=-Math.cos(heading);P.vx=fx*speed*60-fz*2.2;P.vz=fz*speed*60+fx*2.2;P.vy=-6+vy*60;
      var agl=py-gY(px,pz);P.fall=clamp(agl/5,10,80);P.stage='free';P.t=0;P.rot=[Math.random()*2-1,Math.random()*2-1,Math.random()*2-1];
      pkgMesh.visible=true;pkgMesh.position.set(P.x,P.y,P.z);PK.chute.scale.setScalar(.001);whoosh(.9,2500,300,.25);tone(220,.5,'triangle',.05,0,110);$('away').textContent='Package away';}
    else{AF.doorOpen=P.door;return;}
  }
  var open=0;
  if(P.stage==='free'){ // short tumble before the canopy opens
    P.vy-=26*dt;P.vx*=Math.exp(-dt*.12);P.vz*=Math.exp(-dt*.12);
    PK.crate.rotation.x+=P.rot[0]*3.2*dt*(1-P.t);PK.crate.rotation.z+=P.rot[1]*3.2*dt*(1-P.t);PK.crate.rotation.y+=P.rot[2]*2.4*dt;
    if(P.t>.85){P.stage='chute';P.t=0;tone(300,.3,'sine',.04,0,500);}
  }else{
    var o=clamp(P.t/.55,0,1);open=o*o*(3-2*o);P.open=open;
    var tau=1.8,dec=Math.exp(-dt/tau);P.vx*=dec;P.vz*=dec;
    P.vy+=(-P.fall-P.vy)*ease(.07,k);
    PK.crate.rotation.x*=.94;PK.crate.rotation.y*=.97;
    PK.crate.rotation.z=Math.sin(P.t*2.3)*.14*Math.exp(-P.t*.25)*open+PK.crate.rotation.z*(1-open)*.9;
  }
  P.x+=P.vx*dt;P.z+=P.vz*dt;P.y+=P.vy*dt;
  var scn=P.stage==='free'?.001:Math.max(.001,open);PK.chute.scale.set(scn,scn,scn);
  PK.chuteU.uT.value=performance.now()/1000;PK.chuteU.uCol.value=0;
  PK.chuteU.uLight.value.copy(common.uSkyAmb.value).multiplyScalar(1.5).add(_c1.copy(common.uSunCol.value).multiplyScalar(.3)).addScalar(.1);
  pkgMesh.position.set(P.x,P.y,P.z);
  var scl=1+Math.max(0,(camera.position.distanceTo(pkgMesh.position)-70)/110);pkgMesh.scale.setScalar(Math.min(2.4,scl));
  var v=pkgMesh.position.clone();v.y+=4;v.project(camera);
  var est=Math.max(.4,(P.y-gY(P.x,P.z))/Math.max(8,P.fall)),f=clamp((P.t+(P.stage==='chute'?.85:0))/(P.t+(P.stage==='chute'?.85:0)+est),0,1);
  $('dropBtn').querySelector('.rp').style.strokeDashoffset=String(295.3*(1-f));
  if(v.z<1){$('ring').style.left=((v.x*.5+.5)*innerWidth)+'px';$('ring').style.top=((-v.y*.5+.5)*innerHeight)+'px';$('ring').style.opacity=.9;$('ring').querySelector('.p').style.strokeDashoffset=String(138*(1-f));}else $('ring').style.opacity=0;
  var gy=gY(P.x,P.z);if(P.y<=gy+.3||P.t>14){P.gy=gy;land();}
}
function distanceToDistrict(d,x,z){
  var b=d.bbox,x0=Math.floor(b[0]*SS),x1=Math.ceil(b[2]*SS),y0=Math.floor(b[1]*SS),y1=Math.ceil(b[3]*SS),gx=(x/CELL+W/2)*SS,gy=(z/CELL+H/2)*SS,best=1e18,bx=0,by=0;
  for(var y=y0;y<y1;y++)for(var xx=x0;xx<x1;xx++){
    if(IDS[y*RW+xx]!==d.id)continue;
    // boundary pixels only
    if(IDS[y*RW+xx-1]===d.id&&IDS[y*RW+xx+1]===d.id&&IDS[(y-1)*RW+xx]===d.id&&IDS[(y+1)*RW+xx]===d.id)continue;
    var dx=xx+.5-gx,dy=y+.5-gy,q=dx*dx+dy*dy;if(q<best){best=q;bx=xx+.5;by=y+.5;}
  }
  var cellUnits=CELL/SS;
  return {km:Math.sqrt(best)*cellUnits/10,x:(bx/SS-W/2)*CELL,z:(by/SS-H/2)*CELL};
}
function land(){
  var P0=pkg,m=pkg.mission,d=m.d,lx=pkg.x,lz=pkg.z,id=idAtWorld(lx,lz),hit=id===d.id,near=null,km=0;
  if(!hit){near=distanceToDistrict(d,lx,lz);km=near.km;}
  var hm=hintMult(m.hints)*runMult();
  var s;
  if(hit){streak++;maxStreak=Math.max(maxStreak,streak);s=Math.round(1000*hm*Math.min(2.5,1+.25*(streak-1)));hits++;}
  else{streak=0;s=Math.round(500*Math.pow(Math.max(0,1-km/250),1.6)*hm);}
  score+=s;
  var q=st(d.id);var wasLearned=q.h>0;q.a++;if(hit)q.h++;if(q.b<0||km<q.b)q.b=hit?0:km;if(hit&&!wasLearned)newLearned++;saveStats();
  coinsEarned=Math.min(COINS_MAX,Math.round(score/150));
  var rec={tid:d.id,land:id,hit:hit,km:km,x:lx,z:lz,score:s,hints:m.hints,tx:near?near.x:lx,tz:near?near.z:lz};run.list.push(rec);run.done++;
  pkg.pending=rec;pkg.landed=true;pkg.lt=0;pkg.y=pkg.gy;PK.crate.rotation.set(0,PK.crate.rotation.y,0);startDust(pkg.x,pkg.gy,pkg.z);pkgMesh.scale.setScalar(Math.min(2.4,pkgMesh.scale.x));
  $('away').classList.remove('on');$('ring').classList.remove('on');setDropState('off');tone(120,.2,'sine',.1,0,60);whoosh(.6,400,120,.12);
}
function colorFor(rec){return rec.hit?[.18,.85,.42]:(rec.km<40?[.95,.7,.2]:[.9,.3,.25]);}
function startReveal(rec){
  phase='reveal';revealT=0;revealData=rec;$('hud').classList.add('rv');$('cine').classList.add('on');
  var c=colorFor(rec);common.uFillCol.value.setRGB(c[0],c[1],c[2]);
  common.uLandId.value=rec.land||-1;common.uTgtId.value=rec.tid;
  var d=DBYID[rec.tid],near=!rec.hit&&rec.km<40;
  $('rv-k').textContent='Delivery '+run.done+' of '+MISSIONS_PER_RUN;
  $('rv-h').textContent=rec.hit?'Delivered':(near?'Near miss':'Missed');
  var col='rgb('+(c[0]*255|0)+','+(c[1]*255|0)+','+(c[2]*255|0)+')';$('reveal').style.borderLeftColor=col;$('rv-h').style.color=col;
  var lname=rec.land?dname(DBYID[rec.land]):'outside Nepal';
  var mult=(runMult()>1?' · expert x'+runMult():'')+(streak>1?' · streak x'+Math.min(2.5,1+.25*(streak-1)).toFixed(2).replace(/\.?0+$/,''):'');
  if(rec.hit){$('rv-1').textContent=dname(d);$('rv-2').textContent='+'+rec.score+' points'+mult;}
  else{$('rv-1').textContent='Landed '+(rec.land?'in '+lname:lname);$('rv-2').textContent=rec.km.toFixed(rec.km<10?1:0)+' km from '+dname(d)+' · +'+rec.score+' points'+mult;}
  $('t-pts').textContent=score+' pts';
  $('reveal').classList.add('on');
  beacon.visible=true;beacon.children[0].material.color.setRGB(c[0],c[1],c[2]);beacon.children[0].position.set(rec.x,gY(rec.x,rec.z)+80,rec.z);
  beacon.children[1].position.set(rec.tx,gY(rec.tx,rec.tz)+80,rec.tz);beacon.children[1].visible=!rec.hit;
  if(!rec.hit){buildRibbon(rec.x,rec.z,rec.tx,rec.tz,Math.max(.7,Math.hypot(rec.tx-rec.x,rec.tz-rec.z)*.0035));ribbon.visible=true;}
  var mx=(rec.x+rec.tx)/2,mz=(rec.z+rec.tz)/2,span=Math.hypot(rec.tx-rec.x,rec.tz-rec.z),bb=d.bbox,diag=Math.hypot(bb[2]-bb[0],bb[3]-bb[1])*CELL;
  revealData.cam={mx:mx,mz:mz,span:Math.max(span,diag*.5)};cloudMesh.visible=false;
  if(rec.hit){tone(523,.5,'sine',.12,0);tone(659,.5,'sine',.12,.12);tone(784,.7,'sine',.12,.24);tone(1046,.9,'sine',.08,.4);}
  else{tone(330,.6,'sine',.1,0);tone(262,.9,'sine',.1,.2);}
  post({type:'stats',score:score,coins:coinsEarned,timer:Math.round((performance.now()-runStart)/1000),fuel:100,targets:hits,kills:0,health:100});
}
function buildRibbon(x0,z0,x1,z1,w){
  var n=28,pos=[],idx=[],dx=x1-x0,dz=z1-z0,len=Math.hypot(dx,dz)||1,nx=-dz/len*w,nz=dx/len*w,i;
  for(i=0;i<=n;i++){var t=i/n,x=x0+dx*t,z=z0+dz*t,y=gY(x,z)+3+Math.sin(t*Math.PI)*Math.min(30,len*.05);pos.push(x+nx,y,z+nz,x-nx,y,z-nz);if(i<n){var a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}}
  var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);ribbon.geometry.dispose();ribbon.geometry=g;
}
function endReveal(){
  if(phase!=='reveal')return;
  $('reveal').classList.remove('on');$('hud').classList.remove('rv');$('cine').classList.remove('on');cloudMesh.visible=true;common.uReveal.value=0;beacon.visible=false;ribbon.visible=false;
  if(run.done>=MISSIONS_PER_RUN){finishRun();return;}
  phase='fly';startMission();
}
function finishRun(){
  phase='results';camMode='orbit';$('hud').classList.add('hide');$('cine').classList.add('hide');
  var dur=Math.round(performance.now()-runStart);
  var hh=run.list.filter(function(r){return r.hit;}).length;
  $('res-h').textContent=hh+' of '+run.list.length+' delivered';
  var mm=Math.floor(dur/60000),ss2=Math.floor(dur/1000)%60;
  $('res-sub').textContent=airport.name+' · '+(mm)+' min '+(ss2<10?'0':'')+ss2+' s · '+score+' points'+(runMult()>1?' · expert x'+runMult():'');
  $('log-rows').innerHTML=run.list.map(function(r,i){var c=r.hit?'var(--hit)':(r.km<40?'var(--near)':'var(--far)');var d=DBYID[r.tid];
    return '<div class="lr"><span class="n">'+(i+1)+'</span><span class="d"><i style="background:'+c+'"></i>'+dname(d)+'</span><span class="k">'+(r.hit?'Hit':(r.km.toFixed(r.km<10?1:0)+' km'))+'</span><span class="p">+'+r.score+'</span></div>';}).join('');
  $('res-stats').innerHTML=[['Score',score],['Streak',maxStreak],['New',newLearned],['Learned',learnedCount()+'/77'],['Mastered',masteredCount()+'/77'],['Mana',coinsEarned]].map(function(a){return '<div><b>'+a[1]+'</b><span>'+a[0]+'</span></div>';}).join('');
  $('res').classList.remove('hide');
  drawAtlas();
  post({type:'gameOver',score:score,coins:coinsEarned,combo:maxStreak,duration_ms:dur,hits:hh,missions:run.list.length,districts_mastered:masteredCount(),districts_learned:learnedCount()});
}

/* --- atlas --- */
var atlasBase=null;
function drawAtlas(){
  var minx=1e9,miny=1e9,maxx=0,maxy=0;META.districts.forEach(function(d){minx=Math.min(minx,d.bbox[0]);miny=Math.min(miny,d.bbox[1]);maxx=Math.max(maxx,d.bbox[2]);maxy=Math.max(maxy,d.bbox[3]);});
  var pad=14,x0=Math.floor(minx)-pad,y0=Math.floor(miny)-pad,cw=Math.ceil(maxx-minx)+pad*2,chh=Math.ceil(maxy-miny)+pad*2;
  var cv=$('atlas');cv.width=cw;cv.height=chh;var x=cv.getContext('2d');
  var img=x.createImageData(cw,chh),dd=img.data,tg={};run.list.forEach(function(r){tg[r.tid]=1;});
  function idp(i,j){if(i<0||j<0||i>=W||j>=H)return 0;return IDS[(2*j)*RW+2*i];}
  var bg=[22,32,47],land=[238,235,226],tint=[214,230,222],ln=[190,184,170];
  for(var j=0;j<chh;j++)for(var i=0;i<cw;i++){
    var gi=x0+i,gj=y0+j,id=idp(gi,gj),o=(j*cw+i)*4,c=bg;
    if(id){c=tg[id]?tint:land;var r=idp(gi+1,gj),dn=idp(gi,gj+1);if(r!==id||dn!==id)c=ln;
      if(tg[id]){var edge=false;for(var q=-2;q<=2&&!edge;q+=2)for(var w2=-2;w2<=2;w2+=2)if(idp(gi+q,gj+w2)!==id){edge=true;break;}if(edge)c=[20,24,30];}
    }
    dd[o]=c[0];dd[o+1]=c[1];dd[o+2]=c[2];dd[o+3]=255;
  }
  x.putImageData(img,0,0);
  var fs=Math.round(cw/32);x.font='600 '+fs+'px Helvetica,Arial,sans-serif';x.textBaseline='middle';x.lineJoin='round';
  run.list.forEach(function(r,n){
    var d=DBYID[r.tid],tx=d.ix-x0,ty=d.iy-y0,lx=(r.x/CELL+W/2)-x0,ly=(r.z/CELL+H/2)-y0,col=r.hit?'#2fbf71':(r.km<40?'#f2b233':'#e5544b');
    if(!r.hit){x.strokeStyle=col;x.globalAlpha=.8;x.lineWidth=Math.max(1.5,cw/700);x.setLineDash([cw/120,cw/160]);x.beginPath();x.moveTo(lx,ly);x.lineTo(tx,ty);x.stroke();x.setLineDash([]);x.globalAlpha=1;}
    var rad=cw/70;x.fillStyle=col;x.strokeStyle='#fff';x.lineWidth=rad*.28;x.beginPath();x.arc(lx,ly,rad,0,7);x.fill();x.stroke();
    var label=dname(d);x.lineWidth=fs*.35;x.strokeStyle='rgba(255,255,255,.92)';x.fillStyle='#10151c';
    var tw=x.measureText(label).width,lxp=clamp(tx-tw/2,4,cw-tw-4);x.strokeText(label,lxp,ty+(n%2?fs*.9:-fs*.9));x.fillText(label,lxp,ty+(n%2?fs*.9:-fs*.9));
  });
}

/* --- input --- */
function setPause(v){
  if(v&&(phase!=='fly'&&phase!=='ground'&&phase!=='reveal'))return;
  paused=v;$('pause').classList.toggle('hide',!v);document.body.classList.toggle('paused',v);
  if(AC){try{v?AC.suspend():(soundOn&&AC.resume());}catch(e){}}
}
var idleT=0;function wake(){idleT=0;$('hud').classList.remove('idle');}
function setupInput(){
  var cv=$('c');
  cv.addEventListener('pointerdown',function(e){
    e.preventDefault();initAudio();wake();
    if(phase==='reveal'){endReveal();return;}
    if(phase!=='ground'&&phase!=='fly')return;
    if(steerActive)return;steerActive=true;steerId=e.pointerId;steerOX=e.clientX;steerOY=e.clientY;tDX=steerDX;tDY=steerDY;
    try{cv.setPointerCapture(e.pointerId);}catch(x){}
  });
  cv.addEventListener('pointermove',function(e){
    if(!steerActive||e.pointerId!==steerId)return;
    var DEAD=8,RANGE=90,dx=e.clientX-steerOX,dy=e.clientY-steerOY;
    tDX=clamp((Math.abs(dx)>DEAD?dx-Math.sign(dx)*DEAD:0)/RANGE,-1,1);tDY=clamp((Math.abs(dy)>DEAD?dy-Math.sign(dy)*DEAD:0)/RANGE,-1,1);
  });
  function up(e){if(e.pointerId!==steerId)return;steerActive=false;steerId=null;tDX=0;tDY=0;}
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  $('reveal').addEventListener('pointerdown',function(e){e.preventDefault();endReveal();});
  $('dropBtn').addEventListener('pointerdown',function(e){e.preventDefault();e.stopPropagation();doDrop();});
  $('hintBtn').addEventListener('pointerdown',function(e){e.preventDefault();e.stopPropagation();wake();useHint();});
  $('goBtn').addEventListener('click',takeOff);
  $('bordBtn').addEventListener('click',function(){setBorders(!bordersOn);});$('pBord').addEventListener('click',function(){setBorders(!bordersOn);});
  $('namesBtn').addEventListener('click',function(){setNames(!namesOn);});$('pNames').addEventListener('click',function(){setNames(!namesOn);});
  $('peakBtn').addEventListener('click',function(){setPeaks(!peaksOn);});$('pPeak').addEventListener('click',function(){setPeaks(!peaksOn);});
  $('pSound').addEventListener('click',function(){setSound(!soundOn);});
  $('pauseBtn').addEventListener('pointerdown',function(e){e.preventDefault();e.stopPropagation();setPause(true);});
  $('resumeBtn').addEventListener('click',function(){setPause(false);});
  $('endBtn').addEventListener('click',function(){setPause(false);if(run&&run.list.length&&phase!=='results')finishRun();else showPre();});
  ['hud','pause'].forEach(function(id){});
  $('againBtn').addEventListener('click',function(){showPre();});
  var keys={};
  function kb(){kbX=(keys.ArrowRight||keys.KeyD?1:0)-(keys.ArrowLeft||keys.KeyA?1:0);kbY=(keys.ArrowDown||keys.KeyS?1:0)-(keys.ArrowUp||keys.KeyW?1:0);kbBoost=!!(keys.ShiftLeft||keys.ShiftRight);}
  window.addEventListener('keydown',function(e){
    if(e.code==='Space'){e.preventDefault();if(phase==='reveal')endReveal();else if(phase==='fly')doDrop();else if(phase==='pre')takeOff();return;}
    if(e.code==='Enter'&&phase==='pre'){takeOff();return;}
    if(e.code==='KeyH'&&phase==='fly'){useHint();return;}
    if(e.code==='KeyP'||e.code==='Escape'){setPause(!paused);return;}
    keys[e.code]=true;kb();if(/Arrow/.test(e.code))e.preventDefault();
  });
  window.addEventListener('keyup',function(e){keys[e.code]=false;kb();});
  window.addEventListener('resize',onResize);window.addEventListener('orientationchange',function(){setTimeout(onResize,150);});
}
function onResize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}

/* --- flight update --- */
var GROUND_OFF=2.8*HUMAN_K/100;
var camGoal=new THREE.Vector3(),camLook=new THREE.Vector3(),lookCur=new THREE.Vector3(),warnT=0,orbitA=0,highAlt=0,fovCur=60,beepT=0;
function snapCamera(){
  var fx=-Math.sin(heading),fz=-Math.cos(heading);
  camera.position.set(px-fx*13,py+3.5,pz-fz*13);lookCur.set(px+fx*15,py-1,pz+fz*15);camera.lookAt(lookCur);
}
function flightStep(k){
  var locked=phase==='reveal'||(pkg&&pkg.landed&&phase!=='fly');
  var sdx=steerActive?tDX:kbX,sdy=steerActive?tDY:kbY;
  if(!steerActive&&(kbX||kbY)){sdx=kbX;sdy=kbY;}
  if(airMode==='ground'||locked||phase==='pre'||phase==='results'){sdx=0;sdy=0;}
  var eas=steerActive||kbX||kbY?.18:.035;if(locked)eas=.05;
  steerDX+=(sdx-steerDX)*ease(eas,k);steerDY+=(sdy-steerDY)*ease(eas,k);
  if(!steerActive&&!kbX&&Math.abs(steerDX)<.003)steerDX=0;if(!steerActive&&!kbY&&Math.abs(steerDY)<.003)steerDY=0;
  var boost=(steerActive||kbBoost)&&airMode==='air'&&!locked;
  var fx=-Math.sin(heading),fz=-Math.cos(heading),flapT=0,pitchAng=0,rpm=.85,rolling=false;
  if(phase==='results'||phase==='pre')return;
  var T=performance.now()/1000;
  if(airMode==='ground'){
    var dts=k/60;TO.t+=dts;rolling=true;
    var steerIn=steerActive?tDX:kbX;
    if(TO.stage==='spool'){speed=0;rpm=.18+.6*ss(0,2.2,TO.t);flapT=1;if(TO.t>2.4){TO.stage='roll';TO.t=0;setTip('Rolling',2000);}}
    else if(TO.stage==='roll'){
      speed+=TO.a0*(.5+speed/TO.VR)*k;rpm=.8+.3*speed/TO.VR;flapT=1;
      TO.yaw=clamp(TO.yaw+steerIn*.0007*k*(speed/TO.VR),-.05,.05)*(steerIn?1:Math.pow(.97,k));heading+=TO.yaw*.02*k*0+0;
      if(speed>=TO.VR){TO.stage='rotate';TO.t=0;setTip('Rotate',1800);}
    }
    else if(TO.stage==='rotate'){
      var pr=clamp(TO.t/2.6,0,1),sp=pr*pr*(3-2*pr);pitchAng=sp*.21;TO.pitch=pitchAng;rpm=1.1;flapT=1;
      speed+=(TO.VR*1.32-speed)*ease(.01,k);
      if(pr>.3){vy=Math.min(.14,vy+.0032*k*(sp));}
      if(py-groundSurface(px,pz)>3.6){TO.stage='climb';TO.t=0;}
    }
    else if(TO.stage==='climb'){
      pitchAng=.21;rpm=1.15;flapT=speed>TO.VR*1.45?0:1;
      speed+=(.62-speed)*ease(.012,k);vy+=(.115-vy)*ease(.03,k);
      if(py-groundSurface(px,pz)>13&&TO.t>2.2){airMode='air';phase='fly';TO.stage='idle';TO.pitchBlend=1;setTip('Drag to steer. Hold to boost.',5000);startMission();$('hintBtn').disabled=false;tone(300,.4,'sine',.06,0,600);}
    }
    px+=fx*speed*k;pz+=fz*speed*k;
    if(TO.stage==='roll'||TO.stage==='spool'){py=groundSurface(px,pz)+GROUND_OFF;}
    else{py+=vy*k;var gs=groundSurface(px,pz)+GROUND_OFF;if(py<gs){py=gs;vy=Math.max(0,vy);}}
    heading+=0;
    jet.rotation.set(pitchAng,heading,0);
  }else{
    var inDX=steerDX,inDY=steerDY;
    var tgt=boost?BOOST:CRUISE;
    speed+=(tgt-speed)*ease(.07,k);
    heading-=inDX*.035*k;
    fx=-Math.sin(heading);fz=-Math.cos(heading);
    vy+=(-inDY)*.055*k;
    var g0=gY(px,pz),need=g0,la=[.4,.9,1.6,2.4];
    for(var q=0;q<la.length;q++){var gg=gY(px+fx*speed*60*la[q],pz+fz*speed*60*la[q]);need=Math.max(need,gg-la[q]*4);}
    var clear=py-need,MINC=16;
    if(clear<MINC){var push=(MINC-clear)/MINC;vy+=push*push*.22*k+push*.01*k;warnT=Math.max(warnT,push>.35?1:0);}
    vy*=Math.pow(.9,k);vy=clamp(vy,-.6,.6);
    if(py>470)vy-=(py-470)*.0008*k;
    px+=fx*speed*k;pz+=fz*speed*k;py+=vy*k;
    var gl=gY(px,pz)+2.4;if(py<gl){py=gl;if(vy<0)vy=0;}
    TO.pitchBlend=Math.max(0,TO.pitchBlend-.012*k);
    var pit=vy*1.12*(1-TO.pitchBlend)+.21*TO.pitchBlend;
    jet.rotation.set(pit,heading,clamp(-inDX*.74,-.68,.68));
    rpm=boost?1.5:.85;flapT=0;
  }
  jet.position.set(px,py,pz);
  updateProps(rpm,k);
  updateOtter(k,T,{roll:steerDX,pitch:airMode==='air'?steerDY:0,yaw:-steerDX*.8,flapTarget:flapT,onGround:airMode==='ground'&&TO.stage!=='climb'&&py-groundSurface(px,pz)<1.9,speed:speed/.8,boost:boost});
  AF.doorOpen=(pkg&&pkg.door)?pkg.door:0;
  var wrapX=W*CELL/2+800,wrapZ=H*CELL/2+800;
  px=clamp(px,-wrapX,wrapX);pz=clamp(pz,-wrapZ,wrapZ);
  warnT=Math.max(0,warnT-.03*k);$('warn').classList.toggle('on',warnT>.5);
  beepT-=k;if(warnT>.5&&beepT<=0){beepT=40;tone(880,.1,'square',.05);}
}
function updateEnvironment(k){
  updateLights(nightF,performance.now()/1000,airMode==='ground'&&phase!=='pre'&&phase!=='results');updateLamp(airMode==='ground'&&phase!=='pre'&&phase!=='results');
  highAlt=clamp((py-230)/300,0,1);
  common.uFogK.value=1/(2300-highAlt*500);
  updateSky(k/60);
  terrain.sky.position.copy(camera.position);terrain.stars.position.copy(camera.position);
  sunLight.position.set(px,py,pz).addScaledVector(sunVec,100);sunLight.target.position.set(px,py,pz);
  moonLight.position.set(px,py,pz).addScaledVector(SK.moon,100);moonLight.target.position.set(px,py,pz);
  var kt=lonLatToWorld(85.32,27.70);common.uKtm.value.set(kt.x,kt.z);
}
function cameraStep(k){
  var fx=-Math.sin(heading),fz=-Math.cos(heading),boost=(steerActive||kbBoost)&&airMode==='air';
  var fovT=60;
  if(phase==='reveal'&&revealData&&revealData.cam){
    var c=revealData.cam,span=c.span,h0=gY(c.mx,c.mz);
    var back=Math.max(110,span*1.15+110),up=Math.max(110,span*.85+110);
    camGoal.set(c.mx-0*back,Math.max(h0,gY(revealData.x,revealData.z))+up+30,c.mz+back*.8);
    camLook.set(c.mx,h0,c.mz);fovT=62;
    camera.position.lerp(camGoal,ease(.05,k));lookCur.lerp(camLook,ease(.07,k));
  }else if(camMode==='orbit'){
    orbitA+=.0035*k;var r=phase==='pre'?(innerHeight>innerWidth?42:50):34;
    camGoal.set(px+Math.sin(orbitA)*r,py+(phase==='pre'?12:8)+Math.sin(orbitA*.7)*2,pz+Math.cos(orbitA)*r);camLook.set(px,py-(phase==='pre'?(innerHeight>innerWidth?9:3):0)+2,pz);
    camera.position.lerp(camGoal,ease(.1,k));lookCur.lerp(camLook,ease(.2,k));fovT=52;
  }else{
    camTO+=((airMode==='ground'?(TO.stage==='climb'?.7:(TO.stage==='rotate'?.4:0)):1)-camTO)*ease(.025,k);
    var dist=(12+10*camTO)+highAlt*12,height=(3+7.5*camTO)+highAlt*6;
    camGoal.set(px-fx*dist,py+height,pz-fz*dist);camLook.set(px+fx*15,py-2,pz+fz*15);
    if(pkg){ // wider framing so the parachute stays in view behind and below the jet
      var sep=Math.hypot(pkg.x-px,pkg.y-py,pkg.z-pz),sw=clamp(sep/110,0,1);
      camGoal.set(px-fx*(dist+sw*95),py+height+sw*55,pz-fz*(dist+sw*95));
      camLook.set(px*(1-.6*sw)+pkg.x*.6*sw+fx*15*(1-sw),py*(1-.6*sw)+pkg.y*.6*sw-2,pz*(1-.6*sw)+pkg.z*.6*sw+fz*15*(1-sw));
    }
    camera.position.lerp(camGoal,ease(airMode==='ground'?.08:.14,k));lookCur.lerp(camLook,ease(.5,k));
    fovT=(52+8*camTO)+highAlt*24+(boost?6:0)+(pkg?8:0);
  }
  var gc=gY(camera.position.x,camera.position.z)+4;if(camera.position.y<gc)camera.position.y=gc;
  camera.lookAt(lookCur);
  fovCur+=(fovT-fovCur)*ease(.04,k);if(Math.abs(camera.fov-fovCur)>.05){camera.fov=fovCur;camera.updateProjectionMatrix();}
}
var curId=0,lastCur=-1,tod=7.0,nightF=0;
function clockText(){var h=Math.floor(tod),m=Math.floor((tod-h)*60);return (h<10?'0':'')+h+':'+(m<10?'0':'')+m;}
var lastT=0,fpsAcc=0,fpsN=0,slowT=0,statT=0,hudT=0,FRAME={ms:[],max:0};
function frame(ts){
  requestAnimationFrame(frame);
  if(!lastT){lastT=ts;return;}
  var dtms=Math.min(100,ts-lastT);lastT=ts;var k=dtms/16.6667;
  if(paused){renderer.render(scene,camera);return;}
  if(phase!=='boot'){
    if(phase==='ground'||phase==='fly'||phase==='reveal'||phase==='results'||phase==='pre')flightStep(k);
    if(phase==='pre'||phase==='results')updateProps(.25,k);
    if(pkg)updatePkg(k);
    if(phase==='reveal'){
      revealT+=dtms/1000;common.uReveal.value=Math.min(1,revealT*1.5);
      var rd=revealData;if(rd&&beacon.visible){var pu=.6+.4*Math.sin(revealT*5);beacon.children[0].material.opacity=.35+.3*pu;}
      if(revealT>7.5)endReveal();
    }
    curId=idAtWorld(px,pz);if(curId!==lastCur){lastCur=curId;common.uCur.value=curId||-1;minimapCur(curId);updateLive();}
    common.uPixW.value=2*Math.tan(camera.fov*Math.PI/360)/(innerHeight*qualityPR);
    cameraStep(k);updateEnvironment(k);updateBirds(performance.now()/1000);updateWorld(k,performance.now()/1000,k/60);updateTerrain(camera.position.x,camera.position.z);updateVapor(k);
    updateHintArrow(k/60);updateAirports(performance.now()/1000);updatePeaks(performance.now()/1000);updateOutside();updateDustOnly(k);
    idleT+=dtms;if(idleT>4500&&(phase==='fly')&&!steerActive)$('hud').classList.add('idle');
    hudT+=dtms;if(hudT>120){hudT=0;
      $('i-alt').textContent=(Math.round(py/VEX/10)*10).toLocaleString('en-US')+' m';$('i-spd').textContent=(speed*60/10).toFixed(1)+' km/s';$('i-clock').textContent=clockText();
      var hd=Math.round(((-heading*180/Math.PI)%360+360)%360);$('i-hdg').textContent='HDG '+(hd<10?'00':(hd<100?'0':''))+hd;
      if(MM.ready&&(phase==='fly'||phase==='ground'||phase==='reveal'))drawMap();
    }
    statT+=dtms;if(statT>800){statT=0;if(run&&(phase==='fly'||phase==='reveal'||phase==='ground'))post({type:'stats',score:score,coins:coinsEarned,timer:Math.round((performance.now()-runStart)/1000),fuel:100,targets:hits,kills:0,health:100});audioUpdate();}
  }
  renderer.render(scene,camera);
  // frame-time bookkeeping + adaptive resolution
  if(DEBUG||true){fpsAcc+=dtms;fpsN++;if(FRAME.ms.length<600)FRAME.ms.push(dtms);if(dtms>FRAME.max)FRAME.max=dtms;
    if(fpsAcc>=2000){var avg=fpsAcc/fpsN;fpsAcc=0;fpsN=0;FRAME.avg=avg;
      if(phase!=='boot'){if(avg>36&&qualityPR>.8){qualityPR=Math.max(.8,qualityPR-.15);renderer.setPixelRatio(qualityPR);}
      else if(avg<22&&qualityPR<Math.min(window.devicePixelRatio||1,1.5)-.01){qualityPR=Math.min(Math.min(window.devicePixelRatio||1,1.5),qualityPR+.1);renderer.setPixelRatio(qualityPR);}}
    }}
}

/* --- go --- */
loadStats();
boot().then(function(){
  setupInput();
  showPre();
  $('boot').classList.add('gone');setTimeout(function(){$('boot').style.display='none';},700);
  requestAnimationFrame(frame);
  if(DEBUG)window.__d={
    THREE:THREE,renderer:renderer,scene:scene,camera:camera,common:common,META:META,
    get state(){return {phase:phase,px:px,py:py,pz:pz,speed:speed,heading:heading,airMode:airMode,score:score,mission:mission&&mission.d.name,pkg:!!pkg,qualityPR:qualityPR};},
    tp:function(lon,lat,altM,hdgDeg){var p=lonLatToWorld(lon,lat);px=p.x;pz=p.z;py=altM*VEX;if(hdgDeg!=null)heading=-hdgDeg*Math.PI/180;airMode='air';speed=CRUISE;vy=0;jet.position.set(px,py,pz);camTO=1;snapCamera();},
    fly:function(){if(phase==='pre')takeOff();airMode='air';phase='fly';TO.stage='idle';camTO=1;speed=CRUISE;if(!mission)startMission();else setDropState('armed');$('hud').classList.remove('hide');$('pre').classList.add('hide');$('hintBtn').disabled=false;},
    setMission:function(name){var d=META.districts.filter(function(x){return x.name===name;})[0];mission={d:d,hints:0,err:.2,arrowT:0};$('m-name').textContent=dname(d);},
    dropNow:function(){doDrop();},
    landAt:function(lon,lat){var p=lonLatToWorld(lon,lat);pkg={x:p.x,y:0,z:p.z,vx:0,vz:0,t:0,fall:10,mission:mission,gy:gY(p.x,p.z)};if(phase==='pre'||phase==='ground')this.fly();land();},
    skipReveal:function(){endReveal();},
    idAt:function(lon,lat){var p=lonLatToWorld(lon,lat);return idAtWorld(p.x,p.z);},
    hAt:hAt,gY:gY,lonLatToWorld:lonLatToWorld,worldToLonLat:worldToLonLat,
    finish:function(){if(!run)return;finishRun();},
    airportGroup:function(){return AIR.g;},world:function(){return WORLD;},setTod:function(h){tod=h;updateSky(0);},frame:FRAME,showPre:showPre,birds:BIRDS,sky:SK,get pkgMesh(){return pkgMesh;},
    setSteer:function(x,y){tDX=x;tDY=y;steerActive=true;}, boostOn:function(v){kbBoost=!!v;}, cloudCount:META.cloudCount
  };
}).catch(function(e){
  console.error(e);var t=$('b-txt');if(t)t.textContent='Could not load: '+e.message;
});
})();
