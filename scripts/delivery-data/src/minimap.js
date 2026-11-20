/* ---- circular moving map: heading-up regional view, tap cycles 3 zooms (last = whole country, north-up) ---- */
var MM={ready:false,zoom:0,radii:[130,300,0],curCv:null,curId:-1};
function initMinimap(){
  var BW=1280,BH=Math.round(BW*H/W),sc=W/BW; // base pixel = 1.5 cells = 750 m
  var base=document.createElement('canvas');base.width=BW;base.height=BH;var bx=base.getContext('2d'),img=bx.createImageData(BW,BH),d=img.data;
  var idm=new Uint8Array(BW*BH),i,j,hv=new Float32Array(BW*BH);
  for(j=0;j<BH;j++)for(i=0;i<BW;i++){var gx=(i+.5)*sc,gy=(j+.5)*sc,ii=Math.floor(gx*SS),jj=Math.floor(gy*SS);idm[j*BW+i]=IDS[jj*RW+ii];hv[j*BW+i]=HF[Math.min(H-1,Math.floor(gy))*W+Math.min(W-1,Math.floor(gx))];}
  for(j=1;j<BH-1;j++)for(i=1;i<BW-1;i++){
    var p=j*BW+i,id=idm[p],o=p*4,inN=id>0;
    var sh=clamp((hv[p-1]-hv[p+1]+hv[p-BW]-hv[p+BW])*.012,-26,26);
    var r=inN?46:15,g=inN?62:23,b=inN?78:36;
    r+=sh;g+=sh;b+=sh*1.1;
    var l=0;
    if(inN){
      var R=idm[p+1],Dn=idm[p+BW],L=idm[p-1],U=idm[p-BW];
      if(!R||!Dn||!L||!U)l=.7;
      else if(DBYID[R].province!==DBYID[id].province||DBYID[Dn].province!==DBYID[id].province||DBYID[L].province!==DBYID[id].province)l=.5;
      else if(R!==id||Dn!==id)l=.16;
    }else if(idm[p+1]||idm[p+BW]||idm[p-1]||idm[p-BW])l=.7;
    var rv=MASK_RIVER?MASK_RIVER[Math.min(H-1,Math.floor((j+.5)*sc))*W+Math.min(W-1,Math.floor((i+.5)*sc))]:0;
    if(rv>150&&rv<250&&inN){r=r*.4+100*.6;g=g*.4+158*.6;b=b*.4+205*.6;}
    r=r*(1-l)+246*l;g=g*(1-l)+243*l;b=b*(1-l)+236*l;
    d[o]=clamp(r,0,255);d[o+1]=clamp(g,0,255);d[o+2]=clamp(b,0,255);d[o+3]=255;
  }
  bx.putImageData(img,0,0);
  var minx=1e9,miny=1e9,maxx=0,maxy=0;META.districts.forEach(function(q){minx=Math.min(minx,q.bbox[0]);miny=Math.min(miny,q.bbox[1]);maxx=Math.max(maxx,q.bbox[2]);maxy=Math.max(maxy,q.bbox[3]);});
  MM={ready:true,zoom:0,radii:[130,300,0],BW:BW,BH:BH,sc:sc,base:base,idm:idm,curCv:null,curId:-1,cx:((minx+maxx)/2)/sc,cy:((miny+maxy)/2)/sc,cw:(maxx-minx)/sc,ch:(maxy-miny)/sc};
  var mini=$('mini');sizeMini();
  $('mapBtn').addEventListener('pointerdown',function(e){e.preventDefault();e.stopPropagation();MM.zoom=(MM.zoom+1)%3;updScale();drawMap();});
  updScale();
}
function sizeMini(){var D=Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mapD'))||120)*2;var m=$('mini');if(m.width!==D){m.width=D;m.height=D;}}
function updScale(){var r=MM.radii[MM.zoom];$('mapScale').textContent=r?(r+' km'):'Nepal';}
function minimapCur(id){
  if(!MM.ready)return;MM.curId=id;
  if(!id||!bordersOn){MM.curCv=null;return;}
  var cv=document.createElement('canvas');cv.width=MM.BW;cv.height=MM.BH;var x=cv.getContext('2d'),img=x.createImageData(MM.BW,MM.BH),dd=img.data,m=MM.idm;
  for(var p=0;p<m.length;p++)if(m[p]===id){dd[p*4]=255;dd[p*4+1]=191;dd[p*4+2]=90;dd[p*4+3]=170;}
  x.putImageData(img,0,0);MM.curCv=cv;
}
var MMN={t:0,hidden:{},decoys:[],boxes:[]};
function mapHidden(id){return id===(mission&&mission.d.id)||MMN.decoys.indexOf(id)>=0;}
function rollDecoys(){MMN.decoys=[];MMN.t=0;}
function updateDecoys(){ // keep 4 to 6 unlabeled decoys in view (never the target's name, never the district under the plane)
  if(!mission||!MM.ready)return;var rk=MM.radii[MM.zoom],R=rk?rk*1.15:1e9,ds=META.districts,i;
  var keep=[];MMN.decoys.forEach(function(id){var d=DBYID[id],dk=Math.hypot((d.ix-(px/CELL+W/2)),(d.iy-(pz/CELL+H/2)))*CELL/10;if(id!==curId&&id!==mission.d.id&&dk<R)keep.push(id);});
  MMN.decoys=keep;
  if(keep.length<4){
    var cand=ds.filter(function(d){var dk=Math.hypot((d.ix-(px/CELL+W/2)),(d.iy-(pz/CELL+H/2)))*CELL/10;return dk<R&&d.id!==curId&&d.id!==mission.d.id&&keep.indexOf(d.id)<0;});
    var want=Math.min(cand.length,4+Math.floor(Math.random()*3)-keep.length);
    for(i=0;i<want&&cand.length;i++){var k=Math.floor(Math.random()*cand.length);keep.push(cand.splice(k,1)[0].id);}
    MMN.decoys=keep;
  }
}
function drawMapNames(x,D,R,s,cx,cy,rot,whole,rk){
  var fs=Math.round(D*.062);x.font='600 '+fs+'px Helvetica,Arial,sans-serif';x.textAlign='center';x.textBaseline='middle';
  var c=Math.cos(rot),sn=Math.sin(rot),items=[],ds=META.districts.slice().sort(function(a,b){return b.area-a.area;}),placed=[],maxN=whole?30:(rk<200?9:12);
  for(var i=0;i<ds.length&&placed.length<maxN;i++){
    var d=ds[i];if(mapHidden(d.id))continue;
    var bx=d.ix/MM.sc-cx,by=d.iy/MM.sc-cy,sx=R+(bx*c-by*sn)*s,sy=R+(bx*sn+by*c)*s;
    var name=dname(d).toUpperCase(),tw=x.measureText(name).width,th=fs;
    if(Math.hypot(sx-R,sy-R)+tw/2*.8>R-5)continue;
    var wpx=(d.bbox[2]-d.bbox[0])/MM.sc*s;
    if(whole&&tw>wpx*1.05)continue;if(!whole&&rk>=200&&tw>wpx*1.7)continue;
    var box=[sx-tw/2-2,sy-th/2-1,sx+tw/2+2,sy+th/2+1],hit=false;
    for(var q=0;q<placed.length;q++){var b=placed[q];if(box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1]){hit=true;break;}}
    if(hit)continue;placed.push(box);
    x.lineWidth=3.2;x.strokeStyle='rgba(8,14,25,.9)';x.strokeText(name,sx,sy);x.fillStyle=d.id===curId?'#ffbf5a':'rgba(246,243,236,.92)';x.fillText(name,sx,sy);
  }
}
function drawMap(){
  if(!MM.ready)return;sizeMini();
  var cv=$('mini'),D=cv.width,x=cv.getContext('2d'),R=D/2;x.clearRect(0,0,D,D);
  var rk=MM.radii[MM.zoom],whole=rk===0,bpx=(px/CELL+W/2)/MM.sc,bpz=(pz/CELL+H/2)/MM.sc;
  x.save();x.beginPath();x.arc(R,R,R-1,0,7);x.clip();x.fillStyle='#0b1420';x.fillRect(0,0,D,D);
  var s,cx,cy,rot;
  if(whole){s=(D*.94)/Math.max(MM.cw,MM.ch*1.55);cx=MM.cx;cy=MM.cy;rot=0;}
  else{s=R/(rk/.75);cx=bpx;cy=bpz;rot=heading;}
  x.translate(R,R);x.rotate(rot);x.scale(s,s);x.translate(-cx,-cy);
  x.imageSmoothingEnabled=true;x.drawImage(MM.base,0,0);if(MM.curCv)x.drawImage(MM.curCv,0,0);
  if(run){run.list.forEach(function(r){var dx=(r.x/CELL+W/2)/MM.sc,dy=(r.z/CELL+H/2)/MM.sc;x.fillStyle=r.hit?'#43c58a':(r.km<40?'#f2b233':'#e5605a');x.strokeStyle='rgba(8,14,25,.9)';x.lineWidth=1.6/s;x.beginPath();x.arc(dx,dy,(whole?4.5:3.6)/s,0,7);x.fill();x.stroke();});}
  if(whole){ // player marker at its true position
    x.save();x.translate(bpx,bpz);x.rotate(heading);var a=6.5/s;x.fillStyle='#fff';x.strokeStyle='rgba(8,14,25,.95)';x.lineWidth=1.6/s;x.beginPath();x.moveTo(0,-a);x.lineTo(a*.7,a*.85);x.lineTo(0,a*.4);x.lineTo(-a*.7,a*.85);x.closePath();x.stroke();x.fill();x.restore();
  }
  x.restore();
  if(namesOn&&phase!=='results'){var t=performance.now();if(t-MMN.t>1200){MMN.t=t;updateDecoys();}drawMapNames(x,D,R,s,cx,cy,rot,whole,rk);}
  // rim, cardinal ticks and the north marker
  x.strokeStyle='rgba(246,243,236,.55)';x.lineWidth=2;x.beginPath();x.arc(R,R,R-1.5,0,7);x.stroke();
  var nr=whole?0:heading;
  x.save();x.translate(R,R);x.rotate(nr);
  for(var k=0;k<4;k++){x.rotate(k?Math.PI/2:0);x.strokeStyle='rgba(246,243,236,.6)';x.lineWidth=2;x.beginPath();x.moveTo(0,-R+2);x.lineTo(0,-R+(k?8:5));x.stroke();}
  x.restore();
  x.save();x.translate(R,R);x.rotate(nr);x.fillStyle='#ffbf5a';x.beginPath();x.moveTo(0,-R+3);x.lineTo(-6,-R+16);x.lineTo(6,-R+16);x.closePath();x.fill();x.restore();
  var nx=R+Math.sin(nr)*(R-28),ny=R-Math.cos(nr)*(R-28);x.fillStyle='#ffbf5a';x.font='700 '+Math.round(D*.1)+'px Helvetica,Arial,sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText('N',nx,ny);
  if(!whole){ // aircraft, fixed in the centre
    var a2=D*.07;x.save();x.translate(R,R);x.fillStyle='#fff';x.strokeStyle='rgba(8,14,25,.95)';x.lineWidth=2.5;x.beginPath();x.moveTo(0,-a2);x.lineTo(a2*.72,a2*.85);x.lineTo(0,a2*.4);x.lineTo(-a2*.72,a2*.85);x.closePath();x.stroke();x.fill();x.restore();
  }
}
