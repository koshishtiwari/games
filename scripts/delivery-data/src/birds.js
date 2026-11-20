/* ---- birds: instanced, vertex-shader flapping, analytic and deterministic per region ---- */
var BIRDS={max:150,n:0};
function hsh(a,b,c){var h=Math.imul(a|0,374761393)+Math.imul(b|0,668265263)+Math.imul(c|0,2147483629)|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296;}
function initBirds(){
  var pos=[-0,0,-.7, -.12,0,.5, .12,0,.5, -1,0,.15, -.1,0,-.2, -.12,0,.35, 1,0,.15, .1,0,-.2, .12,0,.35];
  var wt=[0,0,0, 1,0,0, 1,0,0];
  var idx=[0,1,2, 4,3,5, 7,6,8, 4,5,7, 5,8,7];
  var g=new THREE.InstancedBufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('aWt',new THREE.Float32BufferAttribute(wt,1));g.setIndex(idx);
  var N=BIRDS.max;
  BIRDS.P=new Float32Array(N*4);BIRDS.Hh=new Float32Array(N*4);BIRDS.C=new Float32Array(N*3);
  BIRDS.aP=new THREE.InstancedBufferAttribute(BIRDS.P,4);BIRDS.aH=new THREE.InstancedBufferAttribute(BIRDS.Hh,4);BIRDS.aC=new THREE.InstancedBufferAttribute(BIRDS.C,3);
  BIRDS.aP.setUsage(THREE.DynamicDrawUsage);BIRDS.aH.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aP',BIRDS.aP);g.setAttribute('aH',BIRDS.aH);g.setAttribute('aC',BIRDS.aC);g.instanceCount=0;
  var m=new THREE.ShaderMaterial({uniforms:{uLight:{value:new THREE.Color(1,1,1)},uHaze:common.uHazeCol,uFogK:common.uFogK},side:THREE.DoubleSide,
    vertexShader:['attribute float aWt;attribute vec4 aP;attribute vec4 aH;attribute vec3 aC;varying vec3 vC;varying float vD;',
    'void main(){vec3 p=position;float fl=sin(aH.y)*aWt*(.18+.5*(1.-aH.z));p.y+=fl*1.1+p.x*aH.w*.5;p.z+=abs(fl)*.2;',
    'float c=cos(aH.x),s=sin(aH.x);vec3 r=vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);vec3 w=aP.xyz+r*aP.w*max(1.,length(aP.xyz-cameraPosition)/55.);',
    'vC=aC*(.82+.2*abs(position.x));vec4 mv=viewMatrix*vec4(w,1.);vD=length(mv.xyz);gl_Position=projectionMatrix*mv;}'].join('\n'),
    fragmentShader:['precision highp float;varying vec3 vC;varying float vD;uniform vec3 uLight,uHaze;uniform float uFogK;',
    'void main(){vec3 c=vC*uLight;float f=1.-exp(-pow(vD*uFogK,1.4));c=mix(c,uHaze,f);gl_FragColor=vec4(c,1.);',
    '#include <tonemapping_fragment>','#include <colorspace_fragment>','}'].join('\n')});
  BIRDS.mesh=new THREE.Mesh(g,m);BIRDS.mesh.frustumCulled=false;scene.add(BIRDS.mesh);BIRDS.geo=g;
}
function bput(x,y,z,size,hd,ph,glide,bank,r,g,b){
  var n=BIRDS.n;if(n>=BIRDS.max)return;
  var P=BIRDS.P,H=BIRDS.Hh,C=BIRDS.C;P[n*4]=x;P[n*4+1]=y;P[n*4+2]=z;P[n*4+3]=size;H[n*4]=hd;H[n*4+1]=ph;H[n*4+2]=glide;H[n*4+3]=bank;C[n*3]=r;C[n*3+1]=g;C[n*3+2]=b;BIRDS.n=n+1;
}
function avoidPlane(o){ // gentle push away from the aircraft, never any damage
  var dx=o.x-px,dy=o.y-py,dz=o.z-pz,d=Math.sqrt(dx*dx+dy*dy+dz*dz),R=22;
  if(d<R&&d>.01){var f=(R-d)/R;f=f*f*R*.9/d;o.x+=dx*f;o.y+=dy*f*.6;o.z+=dz*f;}
}
var _bo={x:0,y:0,z:0};
function updateBirds(t){
  BIRDS.n=0;if(!BIRDS.mesh||phase==='pre'||phase==='results'||phase==='reveal'){if(BIRDS.geo)BIRDS.geo.instanceCount=0;return;}
  var dayW=ss(8.5,10.5,tod)*(1-ss(15.5,17.5,tod)),dawn=ss(5,6,tod)*(1-ss(8,9.5,tod))+ss(16.5,17.5,tod)*(1-ss(19.2,20.2,tod)),migW=ss(8,10,tod)*(1-ss(16.5,18.5,tod));
  var vis=1.;BIRDS.mesh.material.uniforms.uLight.value.copy(common.uSkyAmb.value).multiplyScalar(1.6).add(_c1.copy(common.uSunCol.value).multiplyScalar(.22));
  var i,j,ci,cj;
  // (1) raptors circling on thermals over the hills at midday
  if(dayW>.05){var CS=60,cx0=Math.floor(px/CS),cz0=Math.floor(pz/CS);
    for(ci=cx0-2;ci<=cx0+2;ci++)for(cj=cz0-2;cj<=cz0+2;cj++){
      var h0=hsh(ci,cj,11);if(h0>.34)continue;
      var cx=(ci+.15+.7*hsh(ci,cj,12))*CS,cz=(cj+.15+.7*hsh(ci,cj,13))*CS,gm=hAt(cx,cz);if(gm<350||gm>4300)continue;
      var cnt=Math.round((2+Math.floor(hsh(ci,cj,14)*3))*dayW);if(cnt<1)continue;
      var R=5+hsh(ci,cj,15)*4,om=(.28+.12*hsh(ci,cj,16))*(hsh(ci,cj,17)<.5?-1:1),ph=hsh(ci,cj,18)*6.28;
      var wx=cx+Math.sin(t*.05+ph)*6,wz=cz+Math.cos(t*.04+ph)*6;
      for(i=0;i<cnt;i++){
        var a=ph+om*t+i*6.28/cnt+hsh(ci,cj,20+i)*.5,rr=R*(1+.14*Math.sin(t*.3+i*2));
        _bo.x=wx+Math.cos(a)*rr;_bo.z=wz+Math.sin(a)*rr;
        _bo.y=Math.max(gY(_bo.x,_bo.z),gm*VEX)+16+11*(.5+.5*Math.sin(t*.06+ph+i))+i*2;
        avoidPlane(_bo);
        var vx=-Math.sin(a)*om,vz=Math.cos(a)*om,hd=Math.atan2(-vx,-vz);
        bput(_bo.x,_bo.y,_bo.z,1.3,hd,t*5.5+i*1.7,.88,om<0?.55:-.55,.16,.12,.09);
      }
    }
  }
  // (2) small flocks that turn together along river valleys and the Terai at dawn and dusk
  if(dawn>.05){var FS=90,fx0=Math.floor(px/FS),fz0=Math.floor(pz/FS);
    for(ci=fx0-1;ci<=fx0+1;ci++)for(cj=fz0-1;cj<=fz0+1;cj++){
      if(hsh(ci,cj,31)>.55)continue;
      var fcx=(ci+.5)*FS,fcz=(cj+.5)*FS,gm2=hAt(fcx,fcz);if(gm2>900)continue;
      var nb=Math.round((6+Math.floor(hsh(ci,cj,32)*7))*dawn);
      var A=22+hsh(ci,cj,33)*18,B=14+hsh(ci,cj,34)*16,w1=.16+.08*hsh(ci,cj,35),w2=.21+.08*hsh(ci,cj,36),p1=hsh(ci,cj,37)*6.28,p2=hsh(ci,cj,38)*6.28;
      var wr=.85+.15*hsh(ci,cj,39);
      for(i=0;i<nb;i++){
        var tt=t-i*.16-hsh(ci,cj,40+i)*.35;
        var lx=fcx+A*Math.sin(w1*tt+p1),lz=fcz+B*Math.sin(w2*tt+p2);
        var dvx=A*w1*Math.cos(w1*tt+p1),dvz=B*w2*Math.cos(w2*tt+p2);
        _bo.x=lx+Math.sin(tt*1.7+i)*1.6;_bo.z=lz+Math.cos(tt*1.3+i*2)*1.6;
        _bo.y=Math.max(gY(_bo.x,_bo.z),0)+7+3*Math.sin(tt*.5+i)+hsh(ci,cj,60+i)*2;
        avoidPlane(_bo);
        var ddx=A*w1*w1*Math.sin(w1*tt+p1),bank=clamp((dvx*(-B*w2*w2*Math.sin(w2*tt+p2))-dvz*(-A*w1*w1*Math.sin(w1*tt+p1)))*.02,-.6,.6);
        bput(_bo.x,_bo.y,_bo.z,.6,Math.atan2(-dvx,-dvz),t*11+i*2.3,.15,bank,.93*wr,.92*wr,.88*wr);
      }
    }
  }
  // (3) the occasional V formation of migrating birds at altitude
  if(migW>.05){var MS=420,mx0=Math.floor(px/MS),mz0=Math.floor(pz/MS);
    for(ci=mx0-1;ci<=mx0+1;ci++)for(cj=mz0-1;cj<=mz0+1;cj++){
      if(hsh(ci,cj,71)>.5)continue;
      var brg=(225+(hsh(ci,cj,72)-.5)*40)*DEG,dxm=Math.sin(brg),dzm=-Math.cos(brg),L=520,sp=7.5;
      var ox=(ci+.5)*MS,oz=(cj+.5)*MS,s=((t*sp+hsh(ci,cj,73)*L)%L)-L/2,alt=95+hsh(ci,cj,74)*80;
      var lxm=ox+dxm*s,lzm=oz+dzm*s,perpx=-dzm,perpz=dxm,nv=Math.round(9*Math.min(1,migW*1.5));
      for(i=0;i<nv;i++){var k2=Math.ceil(i/2),side=i%2?1:-1;if(i===0){k2=0;side=0;}
        _bo.x=lxm+perpx*side*k2*2.2-dxm*k2*2.6+Math.sin(t*.9+i)*.2;_bo.z=lzm+perpz*side*k2*2.2-dzm*k2*2.6;_bo.y=alt+Math.sin(t*.7+i*.8)*.7;
        avoidPlane(_bo);bput(_bo.x,_bo.y,_bo.z,1.5,Math.atan2(-dxm,-dzm),t*7+i*.9,.35,0,.14,.14,.17);}
    }
  }
  BIRDS.geo.instanceCount=BIRDS.n;BIRDS.aP.needsUpdate=true;BIRDS.aH.needsUpdate=true;BIRDS.aC.needsUpdate=true;
}
