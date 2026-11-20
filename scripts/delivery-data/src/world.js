/* ---- lived-in ground: built-up density (far tier, shader), roads, street lights, traffic. No 3D buildings. ---- */
var WORLD={ready:false,loading:false,dens:null,ori:null,road:null,chunks:new Map(),roadsBy:new Map(),active:[],sig:'',nH:0,nV:0,nI:0,nL:0,R:0,lastBuild:0,veh:[],pieces:[],epMap:new Map()};
var CHK=8,CKU=CHK*CELL,VMAXV=26000,LMAX=800,VEHMAX=150;
var RW_M=[0,6,7,8,9,10]; // road widths in metres (tertiary .. motorway); world width = metres * HUMAN_K / 100
var RW_CLS=RW_M.map(function(m){return m*HUMAN_K/100;});
function vertY(gi,gj){ // terrain mesh vertex height (units): average of the 4 texels around the grid vertex, as the GPU bilinear fetch gives
  var tx=gi+W/2,ty=gj+H/2;tx=clamp(tx,1,W-1);ty=clamp(ty,1,H-1);
  return (HF[(ty-1)*W+tx-1]+HF[(ty-1)*W+tx]+HF[ty*W+tx-1]+HF[ty*W+tx])*.25*VEX;
}
function meshY(x,z){ // exact height of the rendered level-0 terrain triangles
  var gx=x/CELL,gz=z/CELL,gi=Math.floor(gx),gj=Math.floor(gz),fx=gx-gi,fz=gz-gj;
  var ha=vertY(gi,gj),hb=vertY(gi+1,gj),hc=vertY(gi,gj+1),hd=vertY(gi+1,gj+1);
  if(((gi+gj)&1)===0){ if(fx+fz<1)return ha*(1-fx-fz)+hb*fx+hc*fz; return hd*(fx+fz-1)+hb*(1-fz)+hc*(1-fx); }
  if(fx>=fz)return ha*(1-fx)+hb*(fx-fz)+hd*fz; return ha*(1-fz)+hc*(fz-fx)+hd*fx;
}
function loadWorld(){
  if(WORLD.ready||WORLD.loading)return;WORLD.loading=true;
  Promise.all([fetchBlob('data/world.png'),fetchBlob('data/roads.bin')]).then(function(r){
    return blobImg(r[0]).then(function(im){
      var px=new Uint8Array(W*H*4),dens=new Uint8Array(W*H),ori=new Uint8Array(W*H),road=new Uint8Array(W*H);
      readPixels(im,function(y0,n,d){for(var p=0;p<W*n;p++){var o=(y0*W+p)*4,q=y0*W+p;px[o]=d[p*4];px[o+1]=d[p*4+1];px[o+2]=d[p*4+2];px[o+3]=255;dens[q]=d[p*4];ori[q]=d[p*4+1];road[q]=d[p*4+2];}});
      WORLD.dens=dens;WORLD.ori=ori;WORLD.road=road;
      var t=new THREE.DataTexture(px,W,H,THREE.RGBAFormat,THREE.UnsignedByteType);t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;
      common.uWorld.value=t;common.uWorldOn.value=1;
      return r[1].arrayBuffer();
    });
  }).then(function(buf){parseRoads(buf);initWorldMeshes();WORLD.ready=true;WORLD.loading=false;}).catch(function(e){console.warn('world data not loaded',e);WORLD.loading=false;});
}
function parseRoads(buf){
  var dv=new DataView(buf),n=dv.getUint32(4,true),o=8,total=0;
  for(var i=0;i<n;i++){
    var cls=dv.getUint8(o),np=dv.getUint16(o+1,true);o+=3;
    var pts=new Float32Array(np*2);
    for(var k=0;k<np;k++){pts[k*2]=(dv.getUint16(o,true)/16-W/2)*CELL;pts[k*2+1]=(dv.getUint16(o+2,true)/16-H/2)*CELL;o+=4;}
    total+=np;
    // split at chunk boundaries so each chunk owns its pieces
    var cur=[pts[0],pts[1]],ck=ckey(pts[0],pts[1]);
    for(k=1;k<np;k++){
      var ax=pts[k*2-2],az=pts[k*2-1],bx=pts[k*2],bz=pts[k*2+1],nk=ckey(bx,bz);
      if(nk!==ck){ // cut in the middle: assign the crossing point to both pieces
        cur.push(bx,bz);addPiece(ck,cls,cur);cur=[bx,bz];ck=nk;
      }else cur.push(bx,bz);
    }
    if(cur.length>=4)addPiece(ck,cls,cur);
  }
  WORLD.nWays=n;WORLD.nVerts=total;
}
function ckey(x,z){return Math.floor(x/CKU)+','+Math.floor(z/CKU);}
function addPiece(key,cls,arr){var l=WORLD.roadsBy.get(key);if(!l)WORLD.roadsBy.set(key,l=[]);l.push({cls:cls,pts:new Float32Array(arr)});}
function pieceInfo(p){
  if(p.cum)return;var n=p.pts.length/2,c=new Float32Array(n);
  for(var i=1;i<n;i++)c[i]=c[i-1]+Math.hypot(p.pts[i*2]-p.pts[i*2-2],p.pts[i*2+1]-p.pts[i*2-1]);p.cum=c;p.len=c[n-1];
}
var ROAD_VS=['attribute vec3 aUV;varying vec3 vUV;varying float vDist;varying vec3 vW;',
'void main(){vUV=aUV;vW=position;vec4 mv=viewMatrix*vec4(position,1.);vDist=length(mv.xyz);gl_Position=projectionMatrix*mv;}'].join('\n');
var ROAD_FS=['precision highp float;varying vec3 vUV;varying float vDist;varying vec3 vW;uniform vec3 uSunCol,uMoonCol,uSkyAmb,uHazeCol;uniform float uFogK,uNight;',
'void main(){',
'  float cls=vUV.z,v=abs(vUV.y);vec3 asph=mix(vec3(.2,.2,.22),vec3(.26,.26,.27),fract(sin(vUV.x*3.1)*43758.5)*.4);',
'  vec3 col=asph*(uSunCol*.28+uMoonCol*.6+uSkyAmb*1.2);',
'  float dash=step(fract(vUV.x*.9),.55);',
'  if(cls>=3.){col=mix(col,vec3(.9,.78,.3)*(uSunCol*.3+uSkyAmb+.12),(1.-smoothstep(.04,.09,v))*dash*.8);}',
'  col=mix(col,vec3(.85)*(uSunCol*.3+uSkyAmb+.1),smoothstep(.82,.88,v)*.55);',
'  float fd=1.-exp(-pow(vDist*uFogK,1.4));col=mix(col,uHazeCol,fd);',
'  gl_FragColor=vec4(col,1.);',
'  #include <tonemapping_fragment>','  #include <colorspace_fragment>','}'].join('\n');
var PT_VS=['attribute vec3 aCol;varying vec3 vC;uniform float uK;void main(){vC=aCol;vec4 mv=viewMatrix*vec4(position,1.);gl_PointSize=clamp(uK/max(-mv.z,1.),2.,11.);gl_Position=projectionMatrix*mv;}'].join('\n');
var PT_FS=['precision highp float;varying vec3 vC;uniform float uOn;void main(){vec2 d=gl_PointCoord-.5;float a=smoothstep(.5,.0,length(d));gl_FragColor=vec4(vC*uOn*a*1.6,a*uOn);',
'#include <tonemapping_fragment>','#include <colorspace_fragment>','}'].join('\n');
var VEH_VS=['attribute vec4 aA;attribute vec4 aB;varying vec3 vN;varying vec3 vCol;varying float vDist;',
'void main(){vec3 p=position*aB.xyz;float c=cos(aA.w),s=sin(aA.w);vec3 r=vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);vN=vec3(normal.x*c+normal.z*s,normal.y,-normal.x*s+normal.z*c);',
'vec3 w=aA.xyz+r;vCol=vec3(fract(aB.w*.137),fract(aB.w*.071),fract(aB.w*.29))*.8+.15;vec4 mv=viewMatrix*vec4(w,1.);vDist=length(mv.xyz);gl_Position=projectionMatrix*mv;}'].join('\n');
var VEH_FS=['precision highp float;varying vec3 vN;varying vec3 vCol;varying float vDist;uniform vec3 uSun,uSunCol,uMoon,uMoonCol,uSkyAmb,uHazeCol;uniform float uFogK;',
'void main(){vec3 N=normalize(vN);vec3 col=vCol*(uSunCol*max(dot(N,uSun),0.)+uMoonCol*max(dot(N,uMoon),0.)+uSkyAmb*1.4);float fd=1.-exp(-pow(vDist*uFogK,1.4));col=mix(col,uHazeCol,fd);gl_FragColor=vec4(col,1.);',
'#include <tonemapping_fragment>','#include <colorspace_fragment>','}'].join('\n');
function shareU(extra){var u={uSun:common.uSun,uSunCol:common.uSunCol,uMoon:common.uMoon,uMoonCol:common.uMoonCol,uSkyAmb:common.uSkyAmb,uGndAmb:common.uGndAmb,uHazeCol:common.uHazeCol,uFogK:common.uFogK,uNight:common.uNight,uLit:common.uLit};for(var k in extra)u[k]=extra[k];return u;}
function initWorldMeshes(){
  // road ribbons
  var rg=new THREE.BufferGeometry();WORLD.rPos=new Float32Array(VMAXV*3);WORLD.rUV=new Float32Array(VMAXV*3);WORLD.rIdx=new Uint32Array(VMAXV*3);
  WORLD.rpA=new THREE.BufferAttribute(WORLD.rPos,3);WORLD.ruA=new THREE.BufferAttribute(WORLD.rUV,3);WORLD.rpA.setUsage(THREE.DynamicDrawUsage);WORLD.ruA.setUsage(THREE.DynamicDrawUsage);
  rg.setAttribute('position',WORLD.rpA);rg.setAttribute('aUV',WORLD.ruA);rg.setIndex(new THREE.BufferAttribute(WORLD.rIdx,1));rg.setDrawRange(0,0);
  WORLD.roads=new THREE.Mesh(rg,new THREE.ShaderMaterial({uniforms:shareU({}),vertexShader:ROAD_VS,fragmentShader:ROAD_FS,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));WORLD.roads.frustumCulled=false;scene.add(WORLD.roads);WORLD.rg=rg;
  // street lights
  var lg=new THREE.BufferGeometry();WORLD.lPos=new Float32Array(LMAX*3);WORLD.lCol=new Float32Array(LMAX*3);
  WORLD.lpA=new THREE.BufferAttribute(WORLD.lPos,3);WORLD.lcA=new THREE.BufferAttribute(WORLD.lCol,3);WORLD.lpA.setUsage(THREE.DynamicDrawUsage);WORLD.lcA.setUsage(THREE.DynamicDrawUsage);
  lg.setAttribute('position',WORLD.lpA);lg.setAttribute('aCol',WORLD.lcA);lg.setDrawRange(0,0);
  WORLD.lightU={uK:{value:240},uOn:{value:0}};
  WORLD.lights=new THREE.Points(lg,new THREE.ShaderMaterial({uniforms:WORLD.lightU,vertexShader:PT_VS,fragmentShader:PT_FS,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));WORLD.lights.frustumCulled=false;scene.add(WORLD.lights);WORLD.lg=lg;
  // vehicles
  var vb=new THREE.BoxGeometry(1,1,1);vb.translate(0,.5,0);
  var vg=new THREE.InstancedBufferGeometry();vg.index=vb.index;vg.setAttribute('position',vb.attributes.position);vg.setAttribute('normal',vb.attributes.normal);
  WORLD.vA=new Float32Array(VEHMAX*4);WORLD.vB=new Float32Array(VEHMAX*4);WORLD.vaA=new THREE.InstancedBufferAttribute(WORLD.vA,4);WORLD.vaB=new THREE.InstancedBufferAttribute(WORLD.vB,4);
  WORLD.vaA.setUsage(THREE.DynamicDrawUsage);WORLD.vaB.setUsage(THREE.DynamicDrawUsage);vg.setAttribute('aA',WORLD.vaA);vg.setAttribute('aB',WORLD.vaB);vg.instanceCount=0;
  WORLD.vehM=new THREE.Mesh(vg,new THREE.ShaderMaterial({uniforms:shareU({}),vertexShader:VEH_VS,fragmentShader:VEH_FS}));WORLD.vehM.frustumCulled=false;scene.add(WORLD.vehM);WORLD.vg=vg;
  var pg=new THREE.BufferGeometry();WORLD.pPos=new Float32Array(VEHMAX*4*3);WORLD.pCol=new Float32Array(VEHMAX*4*3);
  WORLD.ppA=new THREE.BufferAttribute(WORLD.pPos,3);WORLD.pcA=new THREE.BufferAttribute(WORLD.pCol,3);WORLD.ppA.setUsage(THREE.DynamicDrawUsage);WORLD.pcA.setUsage(THREE.DynamicDrawUsage);
  pg.setAttribute('position',WORLD.ppA);pg.setAttribute('aCol',WORLD.pcA);pg.setDrawRange(0,0);
  WORLD.vlU={uK:{value:200},uOn:{value:0}};
  WORLD.vlights=new THREE.Points(pg,new THREE.ShaderMaterial({uniforms:WORLD.vlU,vertexShader:PT_VS,fragmentShader:PT_FS,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));WORLD.vlights.frustumCulled=false;scene.add(WORLD.vlights);WORLD.pg=pg;
}
/* --- chunk generation (deterministic from the baked cells) --- */
function getChunk(cx,cz){
  var key=cx+','+cz,c=WORLD.chunks.get(key);if(c){c.used=WORLD.frame;return c;}
  c=buildChunk(cx,cz);c.used=WORLD.frame;WORLD.chunks.set(key,c);
  if(WORLD.chunks.size>140){var oldest=null,ok=null;WORLD.chunks.forEach(function(v,k){if(!oldest||v.used<oldest.used){oldest=v;ok=k;}});if(ok!==key)WORLD.chunks.delete(ok);}
  return c;
}
WORLD.frame=0;
function buildChunk(cx,cz){
  var key=cx+','+cz,pieces=WORLD.roadsBy.get(key)||[];
  // road ribbons + lights
  var rv=[],ri=[],lights=[],vb=0;
  for(var pi=0;pi<pieces.length;pi++){
    var pc=pieces[pi],P2=pc.pts,hw=RW_CLS[pc.cls]*.5,u=0,prevL=null,prevR=null,lastLight=-99;
    var dens0=(function(){var gi2=clamp(Math.floor(P2[0]/CELL+W/2),0,W-1),gj2=clamp(Math.floor(P2[1]/CELL+H/2),0,H-1);return WORLD.dens[gj2*W+gi2];})();
    for(var s2=0;s2+3<P2.length;s2+=2){
      var ax2=P2[s2],az2=P2[s2+1],bx2=P2[s2+2],bz2=P2[s2+3],L=Math.hypot(bx2-ax2,bz2-az2);if(L<1e-4)continue;
      var nseg=Math.max(1,Math.ceil(L/1.25)),nx=-(bz2-az2)/L*hw,nz=(bx2-ax2)/L*hw;
      for(var k=(s2===0?0:1);k<=nseg;k++){
        var tt=k/nseg,x2=ax2+(bx2-ax2)*tt,z2=az2+(bz2-az2)*tt,y2=meshY(x2,z2)+.1;
        var lxx=x2+nx,lzz=z2+nz,rxx=x2-nx,rzz=z2-nz;
        rv.push(lxx,meshY(lxx,lzz)+.1,lzz,u,-1,pc.cls, rxx,meshY(rxx,rzz)+.1,rzz,u,1,pc.cls);
        if(rv.length>6*2&&k>=0&&vb>=2){ri.push(vb-2,vb-1,vb,vb-1,vb+1,vb);}
        vb+=2;u+=L/nseg/(hw*2)*.5;
        if((pc.cls>=3||(pc.cls===2&&dens0>110))&&u-lastLight>(pc.cls>=3?2.6:4.5)&&lights.length<90*3){lastLight=u;lights.push(x2+nx*1.25,y2+.9,z2+nz*1.25);}
      }
    }
  }
  // the first strip of a new vertex run must not connect to the previous piece
  var cleanIdx=[];
  // rebuild indices per piece to avoid cross-piece triangles
  vb=0;var base=0;
  for(pi=0;pi<pieces.length;pi++){
    var P3=pieces[pi].pts,cnt=0;for(var s3=0;s3+3<P3.length;s3+=2){var L3=Math.hypot(P3[s3+2]-P3[s3],P3[s3+3]-P3[s3+1]);if(L3<1e-4)continue;cnt+=Math.max(1,Math.ceil(L3/1.25))+(s3===0?1:0)-0;}
    // verts: 2 per sample; samples = cnt
    for(var e=0;e<cnt-1;e++){var a0=base+e*2;cleanIdx.push(a0,a0+1,a0+2,a0+1,a0+3,a0+2);}
    base+=cnt*2;
  }
  return {rv:new Float32Array(rv),ri:new Uint32Array(cleanIdx),nV:rv.length/6,lights:new Float32Array(lights),pieces:pieces,used:0};
}
/* --- streaming --- */
function updateWorld(k,t,dt){
  if(!WORLD.ready){return;}
  WORLD.frame++;
  var agl=py-gY(px,pz),R=52*(1-ss(38,105,agl));
  var show=R>10&&phase!=='results';
  WORLD.roads.visible=WORLD.lights.visible=WORLD.vehM.visible=WORLD.vlights.visible=show;
  if(!show){WORLD.veh.length=0;WORLD.sig='';return;}
  var ccx=Math.floor(px/CKU),ccz=Math.floor(pz/CKU),sig=ccx+','+ccz+','+Math.round(R/6);
  if(sig!==WORLD.sig&&WORLD.frame-WORLD.lastBuild>2){
    WORLD.sig=sig;WORLD.lastBuild=WORLD.frame;assembleWorld(R);
  }
  // lights and shared uniforms
  WORLD.lightU.uOn.value=clamp(SK.night*1.6,0,1);WORLD.vlU.uOn.value=clamp(SK.night*1.7,0,1);
  simVehicles(dt);
}
function assembleWorld(R){
  var cr=Math.ceil(R/CKU)+1,ccx=Math.floor(px/CKU),ccz=Math.floor(pz/CKU),list=[],i,j;
  for(j=-cr;j<=cr;j++)for(i=-cr;i<=cr;i++){var mx=(ccx+i+.5)*CKU,mz=(ccz+j+.5)*CKU,d=Math.hypot(mx-px,mz-pz);if(d<R+CKU*.72)list.push([d,ccx+i,ccz+j]);}
  list.sort(function(a,b){return a[0]-b[0];});
  var nV=0,nI=0,nL=0,built=0,act=[];
  for(i=0;i<list.length;i++){
    var key=list[i][1]+','+list[i][2],c=WORLD.chunks.get(key);
    if(!c){if(built>=3)continue;c=getChunk(list[i][1],list[i][2]);built++;}else c.used=WORLD.frame;
    if(nV+c.nV>VMAXV-200)continue;
    for(var v=0;v<c.nV;v++){var p=(nV+v)*3,s=v*6;WORLD.rPos[p]=c.rv[s];WORLD.rPos[p+1]=c.rv[s+1];WORLD.rPos[p+2]=c.rv[s+2];WORLD.rUV[p]=c.rv[s+3];WORLD.rUV[p+1]=c.rv[s+4];WORLD.rUV[p+2]=c.rv[s+5];}
    for(var x=0;x<c.ri.length;x++)WORLD.rIdx[nI+x]=c.ri[x]+nV;
    nV+=c.nV;nI+=c.ri.length;
    for(var l=0;l<c.lights.length&&nL<LMAX;l+=3){WORLD.lPos[nL*3]=c.lights[l];WORLD.lPos[nL*3+1]=c.lights[l+1];WORLD.lPos[nL*3+2]=c.lights[l+2];WORLD.lCol[nL*3]=1;WORLD.lCol[nL*3+1]=.72;WORLD.lCol[nL*3+2]=.4;nL++;}
    act.push(c);
  }
  WORLD.nH=0;WORLD.nV=nV;WORLD.nI=nI;WORLD.nL=nL;
  WORLD.rg.setDrawRange(0,nI);WORLD.rpA.needsUpdate=WORLD.ruA.needsUpdate=true;WORLD.rg.index.needsUpdate=true;
  WORLD.lg.setDrawRange(0,nL);WORLD.lpA.needsUpdate=WORLD.lcA.needsUpdate=true;
  WORLD.active=act;WORLD.R=R;
  // traffic pieces
  var pcs=[];WORLD.epMap.clear();
  act.forEach(function(c){c.pieces.forEach(function(p){pieceInfo(p);pcs.push(p);
    [0,1].forEach(function(e){var n=p.pts.length,x=p.pts[e?n-2:0],z=p.pts[e?n-1:1],kk=Math.round(x*3)+'_'+Math.round(z*3),l=WORLD.epMap.get(kk);if(!l)WORLD.epMap.set(kk,l=[]);l.push([p,e]);});});});
  WORLD.pieces=pcs;
}
/* --- vehicles --- */
var VM=[[4.5,1.8,1.5],[12,2.5,3.2],[10,2.5,3.5],[2,.8,1.2]],VS=[3.4,2.6,2.4,3.9]; // metres (length, width, height)
var VTYPE=VM.map(function(m,i){var k=HUMAN_K/100;return {l:m[0]*k,w:m[1]*k,h:m[2]*k,sp:VS[i]};});
var WTOT=[0,.5,.8,1.2,1.6,1.8];
function spawnVeh(v){
  var pcs=WORLD.pieces,tot=0,i;for(i=0;i<pcs.length;i++)tot+=pcs[i].len*WTOT[pcs[i].cls];if(tot<=0)return false;
  var r=Math.random()*tot,p=null;for(i=0;i<pcs.length;i++){r-=pcs[i].len*WTOT[pcs[i].cls];if(r<=0){p=pcs[i];break;}}if(!p)p=pcs[pcs.length-1];
  var tr=Math.random(),ty=tr<.55?0:(tr<.7?1:(tr<.82?2:3)),T=VTYPE[ty];
  v.p=p;v.dir=Math.random()<.5?1:-1;v.s=Math.random()*p.len;v.type=ty;v.v=T.sp*(.7+Math.random()*.5)*(p.cls>=3?1.25:1);v.col=Math.random()*100;return true;
}
function posOn(p,s,out){
  var c=p.cum,n=c.length,lo=0,hi=n-1;while(hi-lo>1){var m=(lo+hi)>>1;if(c[m]<=s)lo=m;else hi=m;}
  var sl=c[hi]-c[lo]||1,f=clamp((s-c[lo])/sl,0,1);
  out.x=p.pts[lo*2]+(p.pts[hi*2]-p.pts[lo*2])*f;out.z=p.pts[lo*2+1]+(p.pts[hi*2+1]-p.pts[lo*2+1])*f;out.dx=p.pts[hi*2]-p.pts[lo*2];out.dz=p.pts[hi*2+1]-p.pts[lo*2+1];
}
var _po={x:0,z:0,dx:0,dz:0};
function simVehicles(dt){
  if(!WORLD.pieces.length){WORLD.vg.instanceCount=0;WORLD.pg.setDrawRange(0,0);return;}
  var totLen=0,i;for(i=0;i<WORLD.pieces.length;i++)totLen+=WORLD.pieces[i].len*WTOT[WORLD.pieces[i].cls];
  var target=Math.min(VEHMAX,Math.round(totLen/9));
  while(WORLD.veh.length<target){var v={};if(!spawnVeh(v))break;WORLD.veh.push(v);}
  if(WORLD.veh.length>target)WORLD.veh.length=target;
  var n=0,P=WORLD.pPos,C=WORLD.pCol,night=SK.night,np=0;
  for(i=0;i<WORLD.veh.length;i++){
    var v2=WORLD.veh[i];
    if(WORLD.pieces.indexOf(v2.p)<0&&(i%7)===(WORLD.frame%7)){if(!spawnVeh(v2))continue;}
    else if(WORLD.pieces.indexOf(v2.p)<0)continue;
    v2.s+=v2.dir*v2.v*dt;
    if(v2.s<0||v2.s>v2.p.len){ // junction: continue on a connected road when there is one
      var e=v2.s<0?0:1,pts=v2.p.pts,nn=pts.length,kk=Math.round(pts[e?nn-2:0]*3)+'_'+Math.round(pts[e?nn-1:1]*3),l=WORLD.epMap.get(kk),alt=null;
      if(l){var cands=l.filter(function(a){return a[0]!==v2.p;});if(cands.length)alt=cands[Math.floor(Math.random()*cands.length)];}
      if(alt){v2.p=alt[0];v2.dir=alt[1]===0?1:-1;v2.s=alt[1]===0?0:alt[0].len;}else{spawnVeh(v2);}
    }
    posOn(v2.p,clamp(v2.s,0,v2.p.len),_po);
    var L=Math.hypot(_po.dx,_po.dz)||1,fx=_po.dx/L*v2.dir,fz=_po.dz/L*v2.dir,T=VTYPE[v2.type];
    var side=RW_CLS[v2.p.cls]*.24,x=_po.x+fz*side*-1,z=_po.z+fx*side; // keep left
    var dd=Math.hypot(x-px,z-pz);if(dd>WORLD.R+8)continue;
    var hd=Math.atan2(-fx,-fz),y=meshY(x,z)+.1;
    WORLD.vA[n*4]=x;WORLD.vA[n*4+1]=y;WORLD.vA[n*4+2]=z;WORLD.vA[n*4+3]=hd;WORLD.vB[n*4]=T.w;WORLD.vB[n*4+1]=T.h;WORLD.vB[n*4+2]=T.l;WORLD.vB[n*4+3]=v2.col;
    if(night>.08){
      var hl=T.l*.5,sw=T.w*.32,nxl=-fz,nzl=fx;
      var pts4=[[x+fx*hl+nxl*sw,z+fz*hl+nzl*sw,1,.95,.8],[x+fx*hl-nxl*sw,z+fz*hl-nzl*sw,1,.95,.8],[x-fx*hl+nxl*sw,z-fz*hl+nzl*sw,1,.1,.08],[x-fx*hl-nxl*sw,z-fz*hl-nzl*sw,1,.1,.08]];
      if(v2.type===3){pts4.splice(1,1);pts4.splice(2,1);}
      pts4.forEach(function(q){P[np*3]=q[0];P[np*3+1]=y+T.h*.45;P[np*3+2]=q[1];C[np*3]=q[2];C[np*3+1]=q[3];C[np*3+2]=q[4];np++;});
    }
    n++;
  }
  WORLD.vg.instanceCount=n;WORLD.vaA.needsUpdate=WORLD.vaB.needsUpdate=true;
  WORLD.pg.setDrawRange(0,np);WORLD.ppA.needsUpdate=WORLD.pcA.needsUpdate=true;WORLD.nVeh=n;
}
