import { Field, CAPACITY, RADIUS, DENOMS, NEGATIVE, FREEZE, DOUBLE, EXTRA_MOVE, STAGES } from './model.mjs';
import { Renderer, COLORS } from './renderer.mjs';
import { reaction } from './reactions.mjs';
import { FirstPlayFocus } from './focus.mjs';
import { RunWallet, ENTRY_GEMS, POINTS_PER_GEM } from './wallet.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let runSeed = (Number(params.get('seed')) >>> 0) || Math.floor(Math.random() * 2147483646) + 1;
const native = !!window.ReactNativeWebView;
$('game').classList.toggle('native', native);
const wallet = new RunWallet();
if (!native) wallet.seed(150);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(key) { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } },
  set(key, value) { try { localStorage.setItem(key, String(value)); } catch {} }
};
const firstPlay = new FirstPlayFocus(params.has('firstPlay') ? 0 : store.get('flip_seen_events_v2'), mask => { if (!params.has('firstPlay')) store.set('flip_seen_events_v2', mask); });
let field, renderer;
let time = 0, lastFrame = 0, busy = false, pending = null, nextRefill = 0, nextTargets = 0;
let paused = false, hidden = document.hidden, muted = false, haptics = true;
let selected = new Set(), activeIndex = -1, inputStart = null;
let particles = [], best = store.get('flip_chain_best');
let runRebuys = 0, runScore = 0, sessionScore = 0, clearedTables = 0, bestGroup = 0;
let mana = 0, buying = false, resultKind = '';
let width = 1, height = 1, ratio = 1, calloutUntil = 0, nextReport = 0;
const auras = $('auras').getContext('2d'), effects = $('effects').getContext('2d');
const metrics = { frames: 0, slowFrames: 0, drawCalls: 0, chips: 0 };
const fmt = value => value.toLocaleString('en-US');
const signed = value => (value < 0 ? '−' : '+') + fmt(Math.abs(value));

function post(payload) { if (native) window.ReactNativeWebView.postMessage(JSON.stringify(payload)); }
function report(end = false) {
  syncWallet();
  if (wallet.ready) post({ type: end ? 'gameOver' : 'stats', score: sessionScore, coins: wallet.balance, combo: bestGroup, duration_ms: Math.round(time * 1000), targets: clearedTables, kills: 0, timer: 0 });
}
function syncWallet() {
  if (field) wallet.update(runScore + field.score);
  $('gemBalance').textContent = fmt(wallet.balance);
  $('join').disabled = busy || !wallet.ready;
  $('join').textContent = wallet.active ? `💎 ${fmt(wallet.payout)} · KEEP` : !wallet.ready ? 'LOADING…' : wallet.canStart ? `PLAY · ${ENTRY_GEMS} 💎` : 'GET GEMS';
  $('join').setAttribute('aria-label', wallet.active ? `Keep ${wallet.payout} gems and end this run` : `Start a run for ${ENTRY_GEMS} gems`);
}
function haptic(style = 'light') { if (haptics) post({ type: 'haptic', style }); }
function announce(text) { $('announcer').textContent = text; }

class Audio {
  init() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!this.ctx && AC) this.ctx = new AC();
      if (!muted && this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {}
  }
  tone(freq, duration = .1, delay = 0, end = freq, gain = .09, type = 'triangle') {
    if (muted || !this.ctx) return;
    const ctx = this.ctx, at = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), amp = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(end, at + duration);
    amp.gain.setValueAtTime(gain, at); amp.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(amp); amp.connect(ctx.destination); osc.start(at); osc.stop(at + duration + .02);
  }
  flip(count) {
    this.init(); this.tone(320, .07, 0, 130, .15);
    for (let i = 0; i < Math.min(6, count); i++) this.tone(440 * Math.pow(1.12, i), .12, .1 + i * .035, 660 * Math.pow(1.12, i), .06);
  }
  blast() { this.tone(110, .25, 0, 35, .19, 'sawtooth'); this.tone(65, .35, .03, 32, .2, 'sine'); }
  star() { [660,880,1100,1320].forEach((n,i) => this.tone(n,.2,i*.045,n*1.1)); }
  win() { [523,659,784,1046].forEach((n,i) => this.tone(n,.35,i*.09)); }
  miss() { this.init(); this.tone(180,.09,0,100,.07); }
  loss() { [294,247,196].forEach((n,i) => this.tone(n,.3,i*.12)); }
}
const sound = new Audio();
try { renderer = new Renderer($('field')); }
catch {
  $('actionTitle').textContent = 'THE VIEW COULD NOT START';
  $('actionDetail').textContent = 'Close Flip and open it again.';
  throw new Error('Flip requires WebGL');
}

const hitButtons = Array.from({ length: CAPACITY }, (_, id) => {
  const el = document.createElement('button');
  el.className = 'chip-hit'; el.type = 'button'; el.hidden = true;
  el.addEventListener('pointerdown', e => {
    if (!interactive() || e.button > 0) return;
    e.preventDefault(); sound.init();
    inputStart = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId };
    el.setPointerCapture(e.pointerId); play(id); inputStart = null;
  });
  el.addEventListener('pointerup', e => {
    if (!inputStart || inputStart.pointer !== e.pointerId) return;
    const start = inputStart; inputStart = null;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 22) play(start.id);
    else clearPreview();
  });
  el.addEventListener('pointercancel', () => { inputStart = null; clearPreview(); });
  el.addEventListener('mouseenter', () => { if (!inputStart && interactive() && matchMedia('(hover:hover)').matches) preview(id); });
  el.addEventListener('mouseleave', () => { if (!inputStart && !busy) clearPreview(); });
  el.addEventListener('focus', () => { if (interactive()) preview(id); });
  el.addEventListener('blur', () => { if (!inputStart && !busy) clearPreview(); });
  el.addEventListener('click', e => { if (e.detail === 0) play(id); });
  $('hitTargets').appendChild(el);
  return el;
});
function interactive() { return wallet.active && !busy && !firstPlay.active && !paused && !hidden && !document.querySelector('dialog[open]') && field?.state === 'playing'; }
function action(title, detail, icon = '✦', danger = false) {
  $('actionTitle').textContent = title; $('actionDetail').textContent = detail; $('actionIcon').textContent = icon;
  $('game').classList.toggle('danger', danger);
}
function preview(id) {
  if (!interactive()) return;
  const plan = field.plan(id);
  if (!plan) return;
  activeIndex = id;
  selected = new Set(plan.ids);
  if (plan.thaw) { selected.add(id); action('ICE', '1 move', '❄'); return; }
  const freeze = plan.hazards.some(i => field.chips[i].type === FREEZE);
  action(plan.negative ? 'STOLEN' : `${plan.ids.length} CHAIN`,
    `${signed(plan.points)}${plan.mult > 1 ? ` · ×${plan.mult}` : ''}${freeze ? ' · ❄' : ''}${plan.blocked.length ? ' · ❄' : ''}`,
    plan.negative ? '−' : freeze ? '❄' : '+',plan.negative);
}
function clearPreview() { if (!busy) { selected.clear(); activeIndex = -1; } }
function chipName(chip) {
  return chip.type === DOUBLE ? 'Double chip' : chip.type === EXTRA_MOVE ? 'Extra move chip' : chip.type === NEGATIVE ? 'Steal chip' : chip.type === FREEZE ? `Freeze chip, ${chip.freezeDepth} neighbour steps` : `${DENOMS[chip.type]} chip`;
}
function updateTargets(labels = false) {
  if (!field) return;
  const size = (renderer.project(RADIUS,0).x - renderer.project(-RADIUS,0).x) * 1.04;
  field.chips.forEach(chip => {
    const el = hitButtons[chip.id];
    el.hidden = !chip.active || !!chip.state;
    el.disabled = !wallet.active || busy || field.state !== 'playing';
    if (!chip.active) return;
    const point = renderer.project(chip.x,chip.y);
    el.style.left = `${point.x-size/2}px`; el.style.top = `${point.y-size*.45}px`;
    el.style.width = `${size}px`; el.style.height = `${size*.9}px`;
    if (labels) el.setAttribute('aria-label',`${chipName(chip)}${chip.frozen ? ', frozen. Contact breaks all ice.' : ''}`);
  });
}
function updateHUD(displayScore = field.score) {
  const stage = STAGES[field.stage];
  $('stageName').textContent = stage.name;
  $('score').textContent = fmt(displayScore); $('target').textContent = fmt(stage.target);
  $('score').classList.toggle('negative',displayScore<0);
  $('moves').textContent = field.moves;
  $('movesPanel').classList.toggle('low',field.moves<=3 && field.state!=='won');
  $('fill').style.width = `${Math.max(0,Math.min(100,displayScore/stage.target*100))}%`;
  $('meter').setAttribute('aria-valuemin',Math.min(0,displayScore));
  $('meter').setAttribute('aria-valuenow',displayScore); $('meter').setAttribute('aria-valuemax',stage.target);
  $('best').textContent = fmt(Math.max(best,runScore+displayScore));
  $('stages').innerHTML = STAGES.map((_,i)=>`<span class="stage ${i<field.stage?'done':i===field.stage?'current':''}" aria-label="Table ${i+1}${i<field.stage?' open':i===field.stage?' current':' locked'}">${i<field.stage?'✓':i+1}</span>`).join('');
  syncWallet();
}
function configure(initial = false) {
  field.configure(0,0,Math.max(3,renderer.halfW-.25),Math.max(4,renderer.viewHalfHeight-.3),initial,renderer.bottomLimitY-.3);
}
function resize() {
  const rect = $('board').getBoundingClientRect();
  width=Math.max(1,rect.width-2); height=Math.max(1,rect.height-2); ratio=Math.min(devicePixelRatio||1,2);
  renderer.resize(width,height); renderer.setCamera(0,0);
  for(const id of ['auras','effects','focus']) { $(id).width=Math.round(width*ratio); $(id).height=Math.round(height*ratio); }
  if(field) { configure(); updateTargets(); }
}
function burst(x,y,color,count=12) {
  for(let i=0;i<count;i++) {
    const a=Math.PI*2*i/count;
    particles.push({x,y,vx:Math.cos(a)*(35+Math.random()*65),vy:Math.sin(a)*60-40,life:.5+Math.random()*.3,max:.8,color,size:3+Math.random()*4});
  }
}
function callout(text) {
  const el=$('callout'); el.textContent=text; el.classList.remove('show');
  void el.offsetWidth; el.classList.add('show'); calloutUntil=time+.9;
}
function play(id) {
  if(!interactive()) return;
  const oldScore=field.score, plan=field.begin(id);
  if(!plan) {
    const chip=field.chips[id];
    if(chip?.active && (chip.type===DOUBLE||chip.type===EXTRA_MOVE)) {
      focusEvent(chip.type===DOUBLE?'double':'move',[id],id);
      action(chip.type===DOUBLE?'2× READY':'+1 READY','Join a chain',chip.type===DOUBLE?'×2':'↻');
    }
    return;
  }
  busy=true; activeIndex=-1; bestGroup=Math.max(bestGroup,plan.ids.length);
  selected=new Set(plan.ids);
  if(plan.ids.length>1) focusEvent('chain',plan.ids,id);
  const last=plan.events.at(-1)?.offset || .2;
  pending={...plan,oldScore,at:time,finishAt:time+last+1.08,poisoned:false,collected:0,settled:false,paid:false};
  // Start on contact. The rest of the chain follows in uneven bursts.
  plan.events.forEach(event=>{event.revealed=false;event.removed=false;});
  action(plan.thaw ? 'ICE BREAK' : `${plan.ids.length} CHAIN`,plan.thaw?'All clear':signed(plan.points),plan.thaw?'❄':'✦');
  const origin=field.chips[id]; field.impulse(origin.x,origin.y,1.25);
  const at=renderer.project(origin.x,origin.y); burst(at.x,at.y,COLORS[origin.type],14);
  if(plan.thaw) shatterIce(pending);
  updateHUD(oldScore); updateTargets(true); sound.init(); sound.tone(420,.16,0,720,.09); haptic('light');
  announce(plan.thaw ? 'Frozen chip stops the chain. The ice breaks.' : `${plan.ids.length} chips in the chain.`);
}
function saveBest() { best=Math.max(best,runScore+field.score);store.set('flip_chain_best',best); }
function finishResult() {
  busy=true;
  const won=field.state==='won',complete=won && field.stage===STAGES.length-1;
  const offer=field.moveOffer();
  resultKind=complete?'complete':won?'next':'bank';
  syncWallet();
  const payout=wallet.payout;
  if(complete)wallet.finish();
  if(won) {clearedTables++;sound.win();haptic('success');saveBest();} else {sound.loss();haptic('warning');}
  $('resultArt').textContent=complete?'♛':won?'♠':'♣';
  $('resultTag').textContent=`TABLE ${field.stage+1} OF 3`;
  $('resultTitle').textContent=complete?'YOU WIN':won?'TABLE CLEAR':'OUT OF MOVES';
  $('resultDetail').textContent='';
  $('resultStats').innerHTML=`<span><small>BANK</small>${fmt(complete?runScore+field.score:field.score)}</span><span><small>GEMS</small>💎 ${fmt(payout)}</span>`;
  $('rebuyOffer').hidden=won;
  if(!won) {
    $('moveCost').textContent='−'+fmt(offer.cost);
    $('bankAfter').textContent=offer.affordable?fmt(offer.remaining):'—';
    $('offerTerms').textContent=field.rebuys>=3?'3/3 USED':!offer.affordable?'LOW BANK':`${Math.round(offer.cost/field.score*100)}% BANK · ${offer.number}/3`;
    $('buyMoves').disabled=!offer.affordable;
    $('buyMoves').textContent=field.rebuys>=3?'LIMIT REACHED':!offer.affordable?'NOT ENOUGH':`BUY · ${fmt(offer.cost)}`;
  }
  $('continue').textContent=complete?`PLAY · ${ENTRY_GEMS} 💎`:won?'NEXT →':`KEEP ${fmt(payout)} 💎`;
  $('continue').classList.toggle('secondary-action',!won);
  $('continue').setAttribute('aria-label',!won?'Keep '+fmt(payout)+' gems and end the run':$('continue').textContent);
  $('buyMoves').setAttribute('aria-label','Buy two moves for '+fmt(offer.cost)+' from your Bank');
  $('retry').hidden=!won || complete;
  $('retry').textContent=`KEEP ${fmt(payout)} 💎`;
  $('result').showModal();updateTargets();report();
}
$('buyMoves').onclick=()=>{
  const offer=field.buyMoves();
  if(!offer)return;
  runRebuys=field.rebuys;sessionScore-=offer.cost;
  $('result').close();busy=false;selected.clear();activeIndex=-1;
  updateHUD();updateTargets(true);report();
  action('+2 MOVES',`−${fmt(offer.cost)}`,'♠');
  sound.init();sound.tone(260,.14,0,520,.08);haptic('medium');lastFrame=0;
};
function bankSession() {
  syncWallet(); const payout=wallet.finish();
  saveBest();field.state='banked';resultKind='banked';
  $('rebuyOffer').hidden=true;$('resultArt').textContent='♠';$('resultTag').textContent='FINAL BANK';
  $('resultTitle').textContent='BANK SECURED';$('resultDetail').textContent='';
  $('resultStats').innerHTML=`<span><small>BANK</small>${fmt(runScore+field.score)}</span><span><small>GEMS KEPT</small>💎 ${fmt(payout)}</span>`;
  $('continue').textContent=`PLAY · ${ENTRY_GEMS} 💎`;$('continue').setAttribute('aria-label',`Start a new run for ${ENTRY_GEMS} gems`);$('continue').classList.remove('secondary-action');$('retry').hidden=true;
  report();
}
function startStage(stage,newRun=false) {
  if(newRun) { runSeed=Math.floor(Math.random()*2147483646)+1; runScore=0; runRebuys=0; clearedTables=0; }
  field=new Field((runSeed+stage*2654435761)>>>0 || 42,stage,runRebuys);
  pending=null; busy=false; firstPlay.clear(); clearPreview(); particles=[]; configure(true);
  // A short settle lets the original loose pile form before input starts.
  busy=true; pending={entrance:true,finishAt:time+.35};
  $('callout').classList.remove('show'); action(wallet.active?'READY':native?'FLIP':'DEMO',wallet.active?'':`${POINTS_PER_GEM} BANK = 1 💎`,'♠'); updateHUD(); updateTargets(true);
}
function openShop() { if (!$('shop').open) $('shop').showModal(); shopText(native ? `${mana} Mana available.` : 'Gem purchases are available in Pipal.'); }
function startRun() {
  if((busy && !$('result').open) || paused || hidden || $('shop').open || !wallet.ready || wallet.active)return;
  if(!wallet.canStart){openShop();return;}
  if(!wallet.start())return;
  $('result').close();
  if(field.turn || field.state!=='playing' || field.stage)startStage(0,true);
  else {busy=false;action('READY','','♠');updateHUD();updateTargets(true);}
  report();haptic('selection');
}
$('join').onclick=()=>{sound.init();if(wallet.active){if(!interactive())return;busy=true;bankSession();$('result').showModal();updateTargets();}else startRun();};
$('webWallet').onclick=openShop;
$('continue').onclick=()=>{sound.init();if(resultKind==='bank'){bankSession();return;}if(resultKind==='next'){$('result').close();runScore+=field.score;startStage(field.stage+1);}else startRun();};
$('retry').onclick=()=>bankSession();
$('result').addEventListener('cancel',e=>e.preventDefault());
$('sound').onclick=()=>{muted=!muted;updateSound();sound.init();};
function updateSound() {
  $('sound').textContent=muted?'×':'♪'; $('sound').setAttribute('aria-label',muted?'Turn sound on':'Turn sound off');
  if(muted)sound.ctx?.suspend().catch(()=>{});
}
function shatterIce(plan) {
  plan.iceBroken=true;
  const icy=field.chips.filter(c=>c.active && c.frozen);
  if(icy.length) focusEvent('thaw', [...icy.map(c=>c.id),...plan.ids],plan.root);
  const thawed=field.thawAll();
  for(const chip of thawed) { const pos=renderer.project(chip.x,chip.y); burst(pos.x,pos.y,'#bcefff',8); }
  if(thawed.length) { callout('THAWED!'); sound.tone(1200,.22,0,260,.13); haptic('medium'); }
}
function step(dt) {
  time+=dt;
  field.gx=Math.sin(time*.85)*.09;
  field.step(dt);
  if(pending?.entrance) {
    if(time>=pending.finishAt) {pending=null;busy=false;updateTargets(true);syncWallet();}
  } else if(pending) {
    const p=pending;
    if(p.blocked.length && !p.iceBroken && (!p.frozen.length || p.events.some(e=>e.iceIds && e.revealed)) && time>=p.at+p.thawAt) shatterIce(p);
    for(const e of p.events) {
      const chip=field.chips[e.id],elapsed=(time-p.at-e.offset)*(chip.flipSpeed||1);
      if(!e.revealed && elapsed>=.185) {
        e.revealed=true; chip.revealed=true; selected.delete(e.id);
        field.impulse(chip.x,chip.y,chip.type>=NEGATIVE ? 1.6 : .55);
        if(!reduced) { $('board').animate([{transform:'translate(0,0)'},{transform:`translate(${chip.type>=NEGATIVE?3:1}px,-2px)`},{transform:'translate(0,0)'}],{duration:180}); }

        const point=renderer.project(chip.x,chip.y);
        if(chip.type===NEGATIVE) {
          focusEvent('steal',p.ids,chip.id);
          p.poisoned=true; p.events.forEach(other=>{field.chips[other.id].outcome=7;});
          callout('STOLEN!'); sound.blast(); haptic('warning');
          $('goal').classList.add('loss-flash');
        } else if(chip.type===FREEZE) {
          focusEvent('freeze',[chip.id,...(e.iceIds || []),...p.blocked],chip.id);
          for(const id of e.iceIds || []) field.chips[id].frozen=true;
          callout('FROZEN!'); sound.tone(1400,.3,0,300,.1,'sine');
        } else if(chip.type===DOUBLE) {
          focusEvent('double',p.ids,chip.id);callout(p.negative?'DOUBLE RISK!':'DOUBLE!');sound.star();
        } else if(chip.type===EXTRA_MOVE) {
          focusEvent('move',[chip.id],chip.id);if(p.bonusMoves){callout('+1 MOVE!');sound.star();}
          else if(p.negative)callout('BONUS STOLEN!');
          else callout('MOVE LIMIT');
        } else p.collected+=DENOMS[chip.type];
        const delta=p.poisoned?-Math.max(1,p.collected*p.mult):p.collected*p.mult;
        updateHUD(p.oldScore+delta);
        action(p.poisoned?'STOLEN':`${p.ids.length} CHAIN`,`${signed(delta)}${p.mult>1?` · ×${p.mult}`:''}`,p.poisoned?'−':'+',p.poisoned);
        burst(point.x,point.y,p.poisoned?'#ff436a':chip.type===FREEZE?'#a9efff':'#ffdc72',chip.type>=NEGATIVE?18:5);
        if(!muted) sound.tone(400+Math.min(1100,p.events.indexOf(e)*48),.075,0,600+Math.min(1200,p.events.indexOf(e)*50),.065);
      }
      if(!e.removed && elapsed>=.84) {e.removed=true;field.removeChip(chip);}
    }
    const last=p.events.at(-1)?.offset || .2;
    if(!p.settled && time>=p.at+last+.98) {
      p.settled=true;field.finish(p);selected.clear();
      updateHUD(); sessionScore+=p.points;
      const event=reaction(p,{streak:field.streak,score:field.score,target:STAGES[field.stage].target,moves:field.moves});
      action(event.title,`${signed(p.points)}${p.blocked.length?' · ❄':''}`,event.icon,p.negative);
      if(event.big)callout(event.title);
      announce(`${signed(p.points)} in the Bank. ${field.moves} moves left.`);
    }
    if(time>=p.finishAt && !firstPlay.active) {
      pending=null;busy=false;nextTargets=0;$('goal').classList.remove('loss-flash');updateTargets(true);syncWallet();report();
      if(field.state!=='playing')finishResult();
    }
  }
  if(!inputStart && time>=nextRefill && field.state==='playing') {nextRefill=time+.12;field.replenish();}
  if(time>=nextTargets && !inputStart) {nextTargets=time+.08;updateTargets();}
  for(const p of particles) {p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=160*dt;}
  particles=particles.filter(p=>p.life>0);
  if(time>calloutUntil)$('callout').classList.remove('show');
  if(time>nextReport) {nextReport=time+3;report();}
}
function drawAuras() {
  auras.setTransform(ratio,0,0,ratio,0,0);auras.clearRect(0,0,width,height);
  const rx=(renderer.project(RADIUS,0).x-renderer.project(-RADIUS,0).x)*.62;
  for(const chip of field.chips) {
    if(!chip.active)continue;
    const point=renderer.project(chip.x,chip.y);
    if(chip.frozen && !chip.state) {
      auras.fillStyle='rgba(139,227,255,.21)';auras.strokeStyle='#b7f3ff';auras.lineWidth=1.7;
      auras.beginPath();
      for(let i=0;i<6;i++){const a=i*Math.PI/3-Math.PI/6;auras.lineTo(point.x+Math.cos(a)*rx*.9,point.y+Math.sin(a)*rx*.76);}
      auras.closePath();auras.fill();auras.stroke();
      auras.fillStyle='#e5fcff';auras.font=`bold ${Math.max(11,rx*.55)}px sans-serif`;auras.textAlign='center';auras.fillText('❄',point.x,point.y+rx*.16);
    }
    if(chip.type===FREEZE && !chip.state) {
      auras.fillStyle='#103c58';auras.beginPath();auras.arc(point.x+rx*.65,point.y+rx*.4,rx*.3,0,Math.PI*2);auras.fill();
      auras.fillStyle='#e3faff';auras.font=`bold ${Math.max(10,rx*.36)}px sans-serif`;auras.textAlign='center';auras.fillText(chip.freezeDepth,point.x+rx*.65,point.y+rx*.52);
    }
  }
}
function focusEvent(kind, ids, source) {
  const chips=[...new Set(ids)].map(id=>field.chips[id]).filter(c=>c?.active);
  firstPlay.show(kind,chips,source);
}
let captionEvent=null;
function updateFocusCaption(active) {
  const caption=$('focusCaption');caption.hidden=!active;
  if(!active){captionEvent=null;return;}
  // Put the card on the quieter side of the board, clear of the event.
  const middle=active.chips.reduce((sum,c)=>sum+renderer.project(c.x,c.y).y,0)/Math.max(1,active.chips.length);
  caption.classList.toggle('at-bottom',middle<height*.45);
  if(captionEvent===active)return;
  captionEvent=active;caption.dataset.kind=active.kind;
  $('focusTitle').textContent=active.title;$('focusText').textContent=active.text;
  const source=active.chips.find(c=>c.id===active.source);
  const type=active.kind==='double'?DOUBLE:active.kind==='move'?EXTRA_MOVE:active.kind==='steal'?NEGATIVE:active.kind==='freeze'||active.kind==='thaw'?FREEZE:source?.type??0;
  renderer.paintChip($('focusChip'),type);
}
function drawFocus() {
  const g=$('focus').getContext('2d'),active=firstPlay.active;
  g.setTransform(ratio,0,0,ratio,0,0);g.clearRect(0,0,width,height);
  updateFocusCaption(active);
  $('game').classList.toggle('learning-focus',!!active);
  $('game').classList.toggle('focus-bank',active?.kind==='chain'||active?.kind==='steal');
  $('goal').classList.toggle('focus-loss',active?.kind==='steal');
  if(!active)return;
  const strength=firstPlay.strength;
  g.fillStyle=`rgba(2,5,9,${.8*strength})`;g.fillRect(0,0,width,height);
  g.globalCompositeOperation='destination-out';
  const radius=(renderer.project(RADIUS,0).x-renderer.project(-RADIUS,0).x)*.68;
  for(const target of active.chips) {
    const live=field.chips[target.id];
    const chip=live?.active && live.serial===target.serial?live:target;
    const p=renderer.project(chip.x,chip.y,chip.state?1.05:.42);
    g.save();g.translate(p.x,p.y);g.scale(1,.9);
    const halo=g.createRadialGradient(0,0,radius*.75,0,0,radius*1.5);
    halo.addColorStop(0,'rgba(0,0,0,1)');halo.addColorStop(.45,'rgba(0,0,0,1)');halo.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=halo;g.beginPath();g.arc(0,0,radius*1.5,0,Math.PI*2);g.fill();g.restore();
  }
  g.globalCompositeOperation='source-over';
}
function drawEffects() {
  effects.setTransform(ratio,0,0,ratio,0,0);effects.clearRect(0,0,width,height);
  for(const p of particles) {effects.globalAlpha=Math.min(1,p.life/.2);effects.fillStyle=p.color;effects.save();effects.translate(p.x,p.y);effects.rotate(p.life*7+p.vx);const r=p.size*p.life/p.max;effects.beginPath();effects.moveTo(-r,-r*.5);effects.lineTo(r*1.5,0);effects.lineTo(0,r);effects.closePath();effects.fill();effects.restore();}
  effects.globalAlpha=1;
}
function frame(timestamp) {
  const dt=lastFrame?Math.min(.045,(timestamp-lastFrame)/1000):0;lastFrame=timestamp;
  if(!paused && !hidden && !document.querySelector('dialog[open]')) {
    firstPlay.advance(dt);
    step(dt*firstPlay.speed);metrics.frames++;if(dt>.025)metrics.slowFrames++;
    const result=renderer.draw(field,field.time,activeIndex,reduced,selected,firstPlay.active);metrics.drawCalls=result.drawCalls;metrics.chips=result.chips;
    drawAuras();drawEffects();drawFocus();
  }
  requestAnimationFrame(frame);
}
function shopText(text) { $('shopText').textContent=text; $('buy').disabled=buying || !native || !wallet.ready; }
$('buy').onclick=()=>{ if (buying || !native || !wallet.ready) return; buying=true; shopText('Exchange in progress.'); post({type:'buyGems',mana:10}); };
$('closeShop').onclick=()=>{ $('shop').close(); lastFrame=0; };
const seenEvents=new WeakSet();
function receive(e) {
  if (seenEvents.has(e)) return; seenEvents.add(e);
  let data; try { data=typeof e.data==='string' ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!data) return;
  if (data.type==='manaBalance') {
    mana=data.balance||0;
    wallet.seed(data.gemBalance); syncWallet(); report();
    shopText(`${mana} Mana available. Gems are shared across Pipal games.`);
  } else if (data.type==='gemsGranted' && buying) {
    wallet.grant(data.gems); mana=data.manaBalance||0; buying=false; report(); shopText(`Gems added. ${mana} Mana available.`);
  } else if (data.type==='gemsDenied') { buying=false; shopText('Exchange failed. Check your Mana balance.'); }
  else if (data.type==='openBuyGems') openShop();
  else if (data.type==='pause') { paused=true; inputStart=null; clearPreview(); report(); sound.ctx?.suspend().catch(()=>{}); }
  else if (data.type==='resume') { paused=false; lastFrame=0; if (!muted) sound.ctx?.resume().catch(()=>{}); }
  else if (data.type==='settings') {
    if (typeof data.sound==='boolean') { muted=!data.sound; updateSound(); if (!muted && !paused) sound.ctx?.resume().catch(()=>{}); }
    if (typeof data.haptics==='boolean') haptics=data.haptics;
  }
}
window.addEventListener('message',receive); document.addEventListener('message',receive);
document.addEventListener('visibilitychange',()=>{ hidden=document.hidden; lastFrame=0; inputStart=null; clearPreview(); if (hidden) { report(); sound.ctx?.suspend().catch(()=>{}); } else if (!muted && !paused) sound.ctx?.resume().catch(()=>{}); });
window.addEventListener('pagehide',()=>report(true));
window.addEventListener('resize',resize);
$('field').addEventListener('webglcontextlost',e=>{ e.preventDefault(); paused=true; action('THE VIEW PAUSED','Close Flip and open it again.','!'); });
resize();startStage(0);updateSound();post({type:'getManaBalance'});requestAnimationFrame(frame);
if(params.has('debug'))window.flipDebug={
  metrics,
  snapshot:()=>({seed:runSeed,stage:field.stage,score:field.score,moves:field.moves,state:field.state,busy,paused,hidden,gems:wallet.balance,walletReady:wallet.ready,runActive:wallet.active,payout:wallet.payout,sessionScore,rebuys:field.rebuys,bonusMoves:field.bonusMovesAwarded,streak:field.streak,offer:field.moveOffer(),
    focus:firstPlay.active?{kind:firstPlay.active.kind,ids:firstPlay.active.chips.map(c=>c.id),age:firstPlay.active.age}:null,seenEvents:firstPlay.seen,
    phase:pending?.entrance?'entrance':pending?'chain':'ready',
    sequence:pending?.events?.map(e=>({id:e.id,offset:e.offset,revealed:e.revealed,removed:e.removed})),
    chips:field.chips.filter(c=>c.active).map(c=>({id:c.id,type:c.type,x:c.x,y:c.y,frozen:c.frozen,freezeDepth:c.freezeDepth,state:c.state})),legal:field.legalMoves()}),
  play,receive:data=>receive(new MessageEvent('message',{data}))
};
