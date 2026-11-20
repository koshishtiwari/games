/* ---- named summit labels (screen space, occlusion-tested, decluttered) and the "outside Nepal" notice ---- */
var PEAKS={list:null,els:[],loading:false,wp:new THREE.Vector3()};
var CNAME={1:'India',2:'China, Tibet Autonomous Region',3:'Bhutan',4:'Bangladesh'},COUNTRY=null,outsideT=0;
function loadPeaks(){
  if(PEAKS.list||PEAKS.loading)return;PEAKS.loading=true;
  fetch('data/peaks.json').then(function(r){return r.json();}).then(function(a){
    a.forEach(function(p){var w=lonLatToWorld(p.lon,p.lat);p.x=w.x;p.z=w.z;p.y=p.hm*VEX;p.a=0;p.w=(p.name.length*7.2+8);});
    PEAKS.list=a;
    var host=$('peaks');for(var i=0;i<14;i++){var e=document.createElement('div');e.className='pk';e.style.opacity=0;e.innerHTML='<div class="ln"></div><div class="tk"></div><div class="tx"><span class="nm"></span><span class="el"></span></div>';host.appendChild(e);PEAKS.els.push({e:e,p:null,nm:e.querySelector('.nm'),el:e.querySelector('.el')});}
  }).catch(function(){PEAKS.loading=false;});
}
function loadCountries(){
  if(COUNTRY)return;fetch('data/countries.png').then(function(r){return r.blob();}).then(blobImg).then(function(im){
    var w=im.naturalWidth,h=im.naturalHeight,c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.drawImage(im,0,0);var d=x.getImageData(0,0,w,h).data,o=new Uint8Array(w*h);for(var i=0;i<w*h;i++)o[i]=d[i*4];COUNTRY={d:o,w:w,h:h};
  }).catch(function(){});
}
function countryAt(x,z){if(!COUNTRY)return 0;var i=Math.floor((x/CELL+W/2)/4),j=Math.floor((z/CELL+H/2)/4);if(i<0||j<0||i>=COUNTRY.w||j>=COUNTRY.h)return 0;return COUNTRY.d[j*COUNTRY.w+i];}
var LH0=46;
function updatePeaks(t){
  var L=PEAKS.list;if(!L||!peaksOn||phase==='pre'||phase==='results'||phase==='reveal'||paused){PEAKS.els.forEach(function(s){s.e.style.opacity=0;s.p=null;});return;}
  var cand=[],W2=innerWidth,H2=innerHeight,cp=camera.position,i;
  if(!PEAKS.top||t-PEAKS.tt>1){var tb=$('topbar').getBoundingClientRect();PEAKS.top=tb.bottom+LH0+14;PEAKS.tt=t;}
  for(i=0;i<L.length;i++){
    var p=L[i],dx=p.x-cp.x,dy=p.y-cp.y,dz=p.z-cp.z,d=Math.sqrt(dx*dx+dy*dy+dz*dz);
    var target=0;
    if(d>70&&d<2700){
      PEAKS.wp.set(p.x,p.y,p.z).project(camera);
      var sx=(PEAKS.wp.x*.5+.5)*W2,sy=(-PEAKS.wp.y*.5+.5)*H2;
      if(PEAKS.wp.z<1&&sx>20&&sx<W2-20&&sy>PEAKS.top&&sy<H2-110){
        // line of sight against the terrain
        var vis=1;for(var s=1;s<=10;s++){var f=s/11,qx=cp.x+dx*f,qy=cp.y+dy*f,qz=cp.z+dz*f;if(gY(qx,qz)>qy+1.5){vis=0;break;}}
        target=vis*ss(70,190,d)*(1-ss(1700,2700,d));
        if(target>0)cand.push({p:p,sx:sx,sy:sy,t:target});
      }
    }
    p.a+=(target-p.a)*.12;
  }
  cand.sort(function(a,b){return b.p.ele-a.p.ele;});
  var placed=[],used=0,LH=46;
  for(i=0;i<cand.length&&used<PEAKS.els.length;i++){
    var c=cand[i],bw=c.p.w+10,box=[c.sx-bw/2,c.sy-LH-34,c.sx+bw/2,c.sy],hit=false;
    for(var q=0;q<placed.length;q++){var b=placed[q];if(box[0]<b[2]+6&&box[2]>b[0]-6&&box[1]<b[3]&&box[3]>b[1]){hit=true;break;}}
    if(hit)continue;placed.push(box);
    var slot=null;for(q=0;q<PEAKS.els.length;q++)if(PEAKS.els[q].p===c.p){slot=PEAKS.els[q];break;}
    if(!slot)for(q=0;q<PEAKS.els.length;q++)if(!PEAKS.els[q].p){slot=PEAKS.els[q];break;}
    if(!slot)continue;
    if(slot.p!==c.p){slot.p=c.p;slot.nm.textContent=c.p.name;slot.el.textContent=c.p.ele.toLocaleString('en-US')+' m';var tx=slot.e.querySelector('.tx');tx.style.bottom=(LH+3)+'px';slot.e.querySelector('.ln').style.height=LH+'px';}
    slot.e.style.transform='translate3d('+c.sx.toFixed(1)+'px,'+c.sy.toFixed(1)+'px,0)';slot.e.style.opacity=clamp(c.p.a*1.2,0,1).toFixed(2);slot.keep=true;used++;
  }
  PEAKS.els.forEach(function(s){if(s.keep){s.keep=false;return;}s.e.style.opacity=0;s.p=null;});
}
function updateOutside(){
  var out=(curId===0)&&(phase==='fly'||phase==='ground')&&!!MM.ready;
  outsideT=out?Math.min(1.2,outsideT+.02):Math.max(0,outsideT-.04);
  var el=$('outside'),on=outsideT>.5&&out;el.classList.toggle('on',on);
  if(outsideT>0){
    var cc=countryAt(px,pz);$('outName').textContent=CNAME[cc]||'';
    PEAKS.wp.set(px,py,pz).project(camera);var sy=(-PEAKS.wp.y*.5+.5)*innerHeight;el.style.top=clamp(sy-(innerWidth>innerHeight?92:120),innerHeight*.16,innerHeight*.5)+'px';
  }
}
