const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const esbuild=require('esbuild');
(async()=>{
  const {Field,CAPACITY,RADIUS,DENOMS,NEGATIVE,FREEZE,DOUBLE,EXTRA_MOVE,STAGES,flipOffsets}=await import('../games/flip/src/model.mjs');
  const {reaction}=await import('../games/flip/src/reactions.mjs');
  const {FirstPlayFocus}=await import('../games/flip/src/focus.mjs');
  const {RunWallet,ENTRY_GEMS,POINTS_PER_GEM}=await import('../games/flip/src/wallet.mjs');
  let passed=0;
  function check(name,fn){fn();passed++;console.log('PASS',name);}
  function arrangement(spec){
    const f=new Field(42);
    spec.forEach(([type,x,y,frozen=false,freezeDepth=1],i)=>{
      f.spawn(f.chips[i],x,y);Object.assign(f.chips[i],{type,frozen,freezeDepth});
    });
    return f;
  }
  function complete(f,p){p.events.forEach(e=>f.removeChip(f.chips[e.id]));f.finish(p);}
  check('Wallet waits for the app, charges once, and ignores later zero seeds',()=>{
    const w=new RunWallet();assert(!w.start());assert(w.seed(73));assert(!w.seed(0));
    assert(w.start());assert.equal(w.balance,73-ENTRY_GEMS);assert(!w.start());
    w.update(250);assert.equal(w.payout,2);assert.equal(w.balance,65);
    assert(!w.seed(999));assert.equal(w.balance,65);
  });
  check('Bank losses and move costs reduce only the current run payout',()=>{
    const w=new RunWallet();w.seed(73);w.start();w.update(1496);assert.equal(w.balance,77);
    w.update(897);assert.equal(w.balance,71);w.update(-2000);assert.equal(w.balance,63);
    w.grant(100);assert.equal(w.balance,163);w.update(POINTS_PER_GEM*5+99);assert.equal(w.balance,168);
    assert.equal(w.finish(),5);assert.equal(w.balance,168);assert.equal(w.finish(),0);assert.equal(w.balance,168);
    assert(w.start());assert.equal(w.balance,158);assert.equal(w.payout,0);
  });
  check('Empty wallets cannot start; grants and invalid amounts cannot reset the wallet',()=>{
    const w=new RunWallet();w.seed(NaN);assert(!w.start());w.grant(-5);w.grant(Infinity);assert.equal(w.balance,0);
    w.grant(10);assert(w.start());w.update(Infinity);assert.equal(w.balance,0);w.finish();assert(!w.start());
  });
  check('First-play focus shows each event once and saves only after it is visible',()=>{
    const saved=[],f=new FirstPlayFocus(0,n=>saved.push(n));
    const chips=[{id:2,serial:9,x:1,y:2},{id:3,serial:10,x:2,y:2}];
    assert(f.show('chain',chips,2));assert.equal(f.speed,.2);assert.equal(f.active.source,2);assert.equal(f.show('chain',chips),false);
    f.advance(.1);assert.equal(saved.length,0);f.advance(.3);assert.equal(saved[0],1);
    assert(f.show('freeze',chips,3));assert.equal(f.queue.length,1);f.advance(f.active.duration);assert.equal(f.active.kind,'freeze');
    f.advance(.5);assert.equal(f.seen,3);f.advance(f.active.duration);assert.equal(f.active,null);assert.equal(f.speed,1);
    const reload=new FirstPlayFocus(f.seen);assert.equal(reload.show('chain',chips),false);assert.equal(reload.show('freeze',chips),false);
    assert(reload.show('steal',chips,2));reload.clear();assert.equal(reload.seen,3);assert(reload.show('steal',chips,2));
  });
  check('Chains use physical contact and the selected type, with no random neighbor flips',()=>{
    const f=arrangement([[2,0,0],[2,1.82,0],[1,3.64,0],[2,5.46,0],[2,0,4]]);
    const seed=f.seed;const p=f.plan(0);
    assert.deepEqual(p.ids,[0,1]);assert.equal(p.points,50);assert.equal(f.seed,seed);
    assert.deepEqual(f.plan(0),p);
  });
  check('A chain branches through all touching matching chips and each chip flips once',()=>{
    const f=arrangement([[1,0,0],[1,1.82,0],[1,.91,1.576],[1,2.73,1.576],[0,0,-1.82]]);
    const p=f.plan(0);assert.equal(p.ids.length,4);assert.equal(new Set(p.ids).size,4);assert.equal(p.points,40);
  });
  check('A negative chip turns the entire chain into a vault loss, including below zero',()=>{
    const f=arrangement([[2,0,0],[2,1.82,0],[NEGATIVE,3.64,0],[2,1.82,1.82]]);
    const p=f.begin(0);assert(p.negative);assert.equal(p.value,75);assert.equal(p.points,-150);assert.equal(f.score,-150);
    assert.equal(f.moves,STAGES[0].moves-1);assert.equal(f.begin(3),null);
    complete(f,p);assert(!f.inFlight);
  });
  check('Freeze uses one, two, or three contact hops, even around corners',()=>{
    for(const depth of [1,2,3]){
      const f=arrangement([[FREEZE,0,0,false,depth],[0,1.82,0],[1,1.82,1.82],[2,3.64,1.82],[0,0,6]]);
      const p=f.plan(0);assert.deepEqual(p.frozen,Array.from({length:depth},(_,i)=>i+1));
      assert(!p.frozen.includes(4));
    }
  });
  check('Freeze stops a queued branch before that branch flips',()=>{
    const f=arrangement([[2,0,0],[2,1.82,0],[2,3.64,0],[FREEZE,.91,1.576,false,1],[1,.91,3.396]]);
    const p=f.plan(0);assert(p.ids.includes(3));assert(!p.ids.includes(1));assert(!p.ids.includes(2));
    assert(p.blocked.includes(1));assert(p.frozen.includes(4));assert.equal(p.points,25);
  });
  check('Ice stays frozen on unrelated moves and contact with one frozen chip thaws all ice',()=>{
    const f=arrangement([[0,0,0],[0,1.82,0,true],[0,3.64,0],[1,0,6],[2,5,6,true]]);
    let p=f.begin(3);complete(f,p);assert(f.chips[1].frozen);assert(f.chips[4].frozen);
    p=f.begin(0);assert.deepEqual(p.ids,[0]);assert.deepEqual(p.blocked,[1]);
    complete(f,p);assert(!f.chips[1].frozen);assert(!f.chips[4].frozen);assert(f.chips[2].active);
  });
  check('Tapping ice stops that chain and breaks the ice without flipping through it',()=>{
    const f=arrangement([[0,0,0,true],[0,1.82,0]]);const p=f.begin(0);
    assert(p.thaw);assert.equal(p.points,0);assert.equal(p.ids.length,0);assert.equal(f.moves,11);
    complete(f,p);assert(!f.chips[0].frozen);assert(f.chips[0].active);assert(f.chips[1].active);
  });
  check('The tapped chip starts at once and chain timing has uneven bursts',()=>{
    const times=flipOffsets(30);assert.equal(times[0],0);
    const gaps=times.slice(1).map((t,i)=>t-times[i]);
    assert(gaps.every(g=>g>0));assert(Math.max(...gaps)>Math.min(...gaps)*2);
    assert(gaps.some((g,i)=>i&&g>gaps[i-1]));assert.deepEqual(times,flipOffsets(30));
    const f=arrangement([[0,0,0],[0,1.82,0],[0,3.64,0]]),p=f.begin(0);
    assert.equal(f.chips[0].start,f.time);
    assert(p.events.every(e=>f.chips[e.id].start===f.time+e.offset));
  });
  check('A last-move target wins, while a missed target loses and blocks more input',()=>{
    for(const won of [true,false]){
      const f=arrangement([[4,0,0]]);f.moves=1;f.score=won?STAGES[0].target-500:0;
      const p=f.begin(0);assert.equal(f.state,won?'won':'lost');complete(f,p);assert.equal(f.begin(0),null);
    }
  });
  check('Extra moves cost winnings, restore target distance, and cannot be bought twice',()=>{
    const f=new Field(42);f.score=1000;f.peakScore=1000;f.moves=0;f.state='lost';
    const beforeSeed=f.seed,offer=f.moveOffer();assert.equal(offer.cost,400);assert.equal(offer.remaining,600);
    assert(f.buyMoves());assert.equal(f.score,600);assert.equal(f.moves,2);assert.equal(f.rebuys,1);assert.equal(f.state,'playing');
    assert.equal(f.seed,beforeSeed);assert.equal(f.buyMoves(),null);
    f.moves=0;f.state='lost';assert.equal(f.moveOffer().cost,600);assert.equal(f.buyMoves(),null);
  });
  check('Losses do not discount the offer; low banks, active chains, and the cap block purchases',()=>{
    const f=new Field(42);f.score=300;f.peakScore=1000;f.moves=0;f.state='lost';
    assert.equal(f.moveOffer().cost,400);assert.equal(f.buyMoves(),null);
    for(const balance of [-30,0,1,160]){f.score=balance;f.peakScore=balance;assert.equal(f.buyMoves(),null);}
    f.score=f.peakScore=2000;f.inFlight=true;assert.equal(f.buyMoves(),null);f.inFlight=false;
    f.rebuys=3;assert.equal(f.moveOffer().available,false);assert.equal(f.buyMoves(),null);
    f.rebuys=2;assert.equal(f.moveOffer().cost,1600);assert(f.buyMoves());assert.equal(f.score,400);assert.equal(f.rebuys,3);
  });
  check('Continue prices rise with bank size and purchase count, including the minimum cost',()=>{
    const f=new Field(42);f.moves=0;f.state='lost';let previous=0;
    for(const balance of [200,500,1000,1999]){f.score=f.peakScore=balance;assert(f.moveOffer().cost>previous);previous=f.moveOffer().cost;}
    f.score=f.peakScore=1000;const costs=[];for(let i=0;i<3;i++){f.rebuys=i;costs.push(f.moveOffer().cost);}assert.deepEqual(costs,[400,600,800]);
    assert.equal(new Field(1,2,2).rebuys,2);
  });
  check('Double chips boost a touching chain once, including a stolen chain',()=>{
    for(const stolen of [false,true]){
      const spec=[[2,0,0],[2,1.82,0],[DOUBLE,3.64,0],[DOUBLE,1.82,1.82]];
      if(stolen)spec.push([NEGATIVE,0,-1.82]);
      const f=arrangement(spec),p=f.begin(0);assert(p.double);assert.equal(p.mult,2);assert.equal(p.value,50);assert.equal(p.points,stolen?-100:100);
      assert(Number.isFinite(f.score));assert.equal(new Set(p.ids).size,p.ids.length);
    }
  });
  check('Doubled chain reverse faces show the exact 4x, 6x, and 10x values',()=>{
    for(const [count,mult,tile] of [[3,4,16],[6,6,14],[10,10,15]]){
      const spec=Array.from({length:count},(_,i)=>[1,i*1.82,0]);spec.push([DOUBLE,0,1.82]);
      const f=arrangement(spec),p=f.begin(0);assert.equal(p.mult,mult);assert.equal(f.chips[0].outcome,tile);
    }
  });
  check('Move chips refund one move per safe chain, capped at three per table',()=>{
    const f=arrangement([[1,0,0],[EXTRA_MOVE,1.82,0],[EXTRA_MOVE,-1.82,0]]);
    const p=f.begin(0);assert.equal(p.bonusMoves,1);assert.equal(f.moves,12);assert.equal(f.bonusMovesAwarded,1);assert.equal(p.points,5);
    const capped=arrangement([[1,0,0],[EXTRA_MOVE,1.82,0]]);capped.bonusMovesAwarded=3;assert.equal(capped.begin(0).bonusMoves,0);assert.equal(capped.moves,11);
    const stolen=arrangement([[1,0,0],[EXTRA_MOVE,1.82,0],[NEGATIVE,-1.82,0]]);assert.equal(stolen.begin(0).bonusMoves,0);assert.equal(stolen.moves,11);
    const direct=arrangement([[DOUBLE,0,0],[EXTRA_MOVE,4,0]]);assert.equal(direct.begin(0),null);assert.equal(direct.begin(1),null);assert.equal(direct.moves,12);
  });
  check('Event reactions describe the actual outcome and prioritize theft',()=>{
    const base={ids:[0,1],blocked:[],points:20};
    assert.equal(reaction({...base,negative:true,bonusMoves:1}).title,'STOLEN!');
    assert.equal(reaction({...base,bonusMoves:1}).title,'+1 MOVE!');
    assert.equal(reaction({...base,double:true}).title,'DOUBLE WIN!');
    assert.equal(reaction({...base,ids:Array.from({length:10},(_,i)=>i)}).title,'MEGA CHAIN!');
    assert.equal(reaction(base,{streak:3}).title,'HOT STREAK!');
    assert.equal(reaction(base,{score:950,target:1000,moves:2}).title,'SO CLOSE!');
    assert.equal(reaction(base,{moves:1}).title,'LAST MOVE');
  });
  check('Loose-disc physics remains finite at startup, at zero delta, and during refill',()=>{
    for(const seed of [1,42,319]){
      const f=new Field(seed);f.configure(0,0,6.4,10,true,9.5);
      const before=f.time;f.step(0);assert.equal(f.time,before);
      for(let i=0;i<90;i++){f.step(1/60);if(i%8===0)f.replenish();}
      const active=f.chips.filter(c=>c.active);assert(active.length>40);
      assert(active.every(c=>[c.x,c.y,c.vx,c.vy].every(Number.isFinite)));
      assert(active.some(c=>Math.abs(c.x/RADIUS-Math.round(c.x/RADIUS))>.1));
      assert.equal(new Set(active.map(c=>c.id)).size,active.length);
    }
  });
  check('Same seed makes the same loose pile and hazard reach',()=>{
    const a=new Field(42),b=new Field(42);a.configure(0,0,6,9,true,8.5);b.configure(0,0,6,9,true,8.5);
    assert.deepEqual(a.chips,b.chips);
    assert(a.chips.some(c=>c.active&&c.type===NEGATIVE));
    assert(a.chips.some(c=>c.active&&c.type===FREEZE));
  });
  check('The shipped bundle parses and has no grid or chain-line controller',()=>{
    const html=fs.readFileSync('games/flip/index.html','utf8');
    const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);assert.equal(scripts.length,1);new vm.Script(scripts[0]);
    assert(html.includes('id="auras"'));assert(!html.includes('id="links"'));
    assert(!html.includes('legendModal'));assert(!html.includes('BUST'));assert(html.includes('STOLEN'));assert(!html.includes('Every chip pays'));assert(html.includes('id="moves"'));
  });
  // Controller checks use a render stub. They do not prove WebGL or layout.
  const game=fs.readFileSync('games/flip/src/game.mjs','utf8').replace("import { Renderer, COLORS } from './renderer.mjs';",`
    const COLORS=['white','red','green','black','purple','red','blue'];
    class Renderer{
      resize(w,h){this.width=w;this.height=h;this.halfW=6.4;this.viewHalfHeight=10;this.bottomLimitY=9.5;}
      setCamera(){}
      project(x,y){return {x:(x+7)*25,y:(y+10)*25};}
      paintChip(){}
      draw(field){return {chips:field.chips.filter(c=>c.active).length,drawCalls:3};}
    }
  `);
  const compiled=esbuild.buildSync({stdin:{contents:game,resolveDir:require('node:path').resolve('games/flip/src'),sourcefile:'controller-test.mjs'},bundle:true,format:'iife',platform:'browser',write:false}).outputFiles[0].text;
  function harness(native=false, priorStorage=new Map(), autoJoin=!native) {
    const ids=new Map(),listeners={},messages=[],storage=priorStorage; let queued,now=0;
    const context2d=new Proxy({}, {get:(t,p)=>p==='createRadialGradient'?(()=>({addColorStop(){}})):t[p]||(()=>{}),set:(t,p,v)=>(t[p]=v,true)});
    class Element {
      constructor(){this.dataset={};this.textContent='';this.children=[];this.style={};this.open=false;this.disabled=false;this.events={};this.attrs={};this.classList={add(){},remove(){},toggle(){}};}
      addEventListener(n,f){(this.events[n]||=[]).push(f);}
      appendChild(el){this.children.push(el);}
      setAttribute(k,v){this.attrs[k]=v;}
      getBoundingClientRect(){return {width:365,height:530};}
      getContext(){return context2d;}
      showModal(){this.open=true;}
      close(){this.open=false;}
      setPointerCapture(){}
      animate(){}
      focus(){(this.events.focus||[]).forEach(fn=>fn({}));}
    }
    const document={hidden:false,getElementById:id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);},createElement:()=>new Element(),querySelector:()=>[...ids.values()].find(e=>e.open)||null,addEventListener(n,f){(listeners[n]||=[]).push(f);}};
    const window={addEventListener(n,f){(listeners[n]||=[]).push(f);}};
    if(native)window.ReactNativeWebView={postMessage:s=>messages.push(JSON.parse(s))};
    const ctx=vm.createContext({window,document,URLSearchParams,location:{search:'?seed=42&debug'},matchMedia:()=>({matches:false}),devicePixelRatio:2,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},requestAnimationFrame:fn=>{queued=fn;},MessageEvent:class {constructor(type,data){Object.assign(this,data);}},console});
    vm.runInContext(compiled,ctx);
    function advance(seconds=2){for(let i=0;i<Math.ceil(seconds*60);i++){now+=1000/60;queued(now);}}
    advance();
    if(autoJoin){ids.get('join').onclick();advance();}
    return {debug:window.flipDebug,ids,advance,messages,storage,click:id=>ids.get(id).onclick(),listeners};
  }
  check('Controller starts a chain without a lead-in and ignores duplicate input',()=>{
    const h=harness();const s=h.debug.snapshot(),p=s.legal.filter(p=>p.ids.length>1&&!p.negative).sort((a,b)=>b.ids.length-a.ids.length)[0];
    assert(p);h.debug.play(p.root);h.debug.play(p.root);
    let after=h.debug.snapshot();assert.equal(after.moves,s.moves-1);assert(after.busy);assert(after.sequence.every(e=>!e.revealed));
    h.advance(12);after=h.debug.snapshot();assert(!after.busy);assert.equal(after.score,p.points);assert.equal(after.sessionScore,p.points);
    assert(after.chips.every(c=>Number.isFinite(c.x)&&Number.isFinite(c.y)));
  });
  check('First chain focus follows the actual chips, then stays off after a reload',()=>{
    const h=harness(),p=h.debug.snapshot().legal.find(p=>p.ids.length>1&&!p.hazards.length);
    assert(p);h.debug.play(p.root);let s=h.debug.snapshot();assert.equal(s.focus.kind,'chain');
    assert.deepEqual([...s.focus.ids].sort((a,b)=>a-b),[...p.ids].sort((a,b)=>a-b));
    h.advance(12);s=h.debug.snapshot();assert.equal(s.focus,null);assert(s.seenEvents&1);assert.equal(s.score,p.points);
    const reload=harness(false,h.storage),again=reload.debug.snapshot().legal.find(p=>p.ids.length>1&&!p.hazards.length);
    reload.debug.play(again.root);assert.equal(reload.debug.snapshot().focus,null);
  });
  check('First freeze and steal focus their source and affected chips without changing rewards',()=>{
    const h=harness();let s=h.debug.snapshot(),ice=s.chips.find(c=>c.type===FREEZE);assert(ice);
    const plan=s.legal.find(p=>p.root===ice.id);h.debug.play(ice.id);h.advance(.3);s=h.debug.snapshot();
    assert.equal(s.focus.kind,'freeze');assert(s.focus.ids.includes(ice.id));assert.equal(h.ids.get('focusTitle').textContent,'FREEZE');assert(!h.ids.get('focusCaption').hidden);
    assert(plan.frozen.every(id=>s.focus.ids.includes(id)));h.advance(12);assert.equal(h.debug.snapshot().score,0);
    s=h.debug.snapshot();const thief=s.chips.find(c=>c.type===NEGATIVE&&!c.frozen);assert(thief);
    h.debug.play(thief.id);h.advance(.3);s=h.debug.snapshot();assert.equal(s.focus.kind,'steal');assert(s.focus.ids.includes(thief.id));assert.equal(h.ids.get('focusTitle').textContent,'STOLEN');assert(h.ids.get('actionDetail').textContent.startsWith('−1'));assert(h.ids.get('focusText').textContent.includes('Bank loss'));
    h.advance(12);s=h.debug.snapshot();assert.equal(s.score,-1);assert(s.seenEvents&2);assert(s.seenEvents&4);assert.equal(s.focus,null);
  });
  check('Native pause freezes a chain; wallet refresh preserves gems; settings still work',()=>{
    const h=harness(true);assert(h.messages.some(m=>m.type==='getManaBalance'));assert(!h.messages.some(m=>m.type==='stats'));
    h.debug.receive({type:'pause'});const s=h.debug.snapshot();h.debug.play(s.legal[0].root);h.advance();assert.equal(h.debug.snapshot().score,s.score);
    h.debug.receive({type:'manaBalance',balance:20,gemBalance:73});h.debug.receive({type:'manaBalance',balance:20,gemBalance:0});assert.equal(h.debug.snapshot().gems,73);
    h.debug.receive({type:'resume'});h.click('join');assert.equal(h.debug.snapshot().gems,63);
    h.debug.receive({type:'resume'});h.debug.play(s.legal[0].root);h.debug.receive({type:'pause'});const focusAge=h.debug.snapshot().focus?.age;h.advance();assert(h.debug.snapshot().busy);assert.equal(h.debug.snapshot().focus?.age,focusAge);
    h.debug.receive({type:'resume'});h.advance(12);assert(!h.debug.snapshot().busy);
    h.debug.receive({type:'settings',sound:false,haptics:false});assert.equal(h.ids.get('sound').attrs['aria-label'],'Turn sound on');
  });
  check('The preview cannot spend or play until the player joins; cash out pays once',()=>{
    const h=harness(false,new Map(),false),before=h.debug.snapshot();
    h.debug.play(before.legal[0].root);assert.equal(h.debug.snapshot().moves,12);assert.equal(h.debug.snapshot().gems,150);
    h.click('join');assert.equal(h.debug.snapshot().gems,140);assert(h.debug.snapshot().runActive);
    const p=h.debug.snapshot().legal.filter(p=>p.points>=100 && !p.negative).sort((a,b)=>a.points-b.points)[0];
    assert(p);h.debug.play(p.root);h.advance(12);
    const paid=h.debug.snapshot();assert.equal(paid.gems,140+Math.floor(p.points/100));
    h.click('join');assert.equal(h.debug.snapshot().state,'banked');assert(!h.debug.snapshot().runActive);
    assert.equal(h.debug.snapshot().gems,paid.gems);h.debug.receive({type:'pause'});assert.equal(h.debug.snapshot().gems,paid.gems);
    h.debug.receive({type:'resume'});h.click('continue');h.advance();
    assert.equal(h.debug.snapshot().gems,paid.gems-10);assert.equal(h.debug.snapshot().score,0);
  });
  check('Native low balance blocks entry; gem purchases grant once and preserve the wallet',()=>{
    const h=harness(true);h.click('join');assert(!h.debug.snapshot().runActive);assert(!h.messages.some(m=>m.type==='stats'));
    h.debug.receive({type:'manaBalance',balance:20,gemBalance:4});h.click('join');assert(h.ids.get('shop').open);
    assert.equal(h.debug.snapshot().gems,4);assert(!h.debug.snapshot().runActive);
    h.click('buy');h.click('buy');assert.equal(h.messages.filter(m=>m.type==='buyGems').length,1);
    h.debug.receive({type:'gemsGranted',gems:100,manaBalance:10});h.debug.receive({type:'gemsGranted',gems:100,manaBalance:10});
    assert.equal(h.debug.snapshot().gems,104);h.click('closeShop');h.click('join');
    assert.equal(h.debug.snapshot().gems,94);assert(h.debug.snapshot().runActive);
    assert.equal(h.messages.filter(m=>m.type==='stats').at(-1).coins,94);
    h.debug.receive({type:'manaBalance',balance:10,gemBalance:0});assert.equal(h.debug.snapshot().gems,94);
  });
  check('Loss and retry reset the vault, moves, and frozen state',()=>{
    const h=harness();let turns=0;
    while(h.debug.snapshot().state==='playing'&&turns++<12){
      const p=h.debug.snapshot().legal.sort((a,b)=>a.points-b.points)[0];h.debug.play(p.root);h.advance(12);
    }
    assert.equal(h.debug.snapshot().state,'lost');assert(h.ids.get('result').open);h.click('continue');h.click('continue');h.advance();
    const s=h.debug.snapshot();assert.equal(s.score,0);assert.equal(s.moves,12);assert(!s.chips.some(c=>c.frozen));assert(!h.ids.get('result').open);
  });
  check('Out-of-moves offers charge the bank, resume the same board, and keep the net score',()=>{
    const h=harness();let guard=0;
    while(h.debug.snapshot().state==='playing'&&guard++<12){
      const s=h.debug.snapshot(),plans=s.legal.filter(p=>p.points>0&&p.points<=200);
      const p=(plans.length?plans:s.legal).sort((a,b)=>b.points-a.points)[0];h.debug.play(p.root);h.advance(12);
    }
    const s=h.debug.snapshot();assert.equal(s.state,'lost');assert(s.offer.affordable);
    const chips=JSON.stringify(s.chips),cost=s.offer.cost;h.click('buyMoves');
    const bought=h.debug.snapshot();assert.equal(bought.moves,2);assert.equal(bought.score,s.score-cost);
    assert.equal(bought.gems,140+Math.floor(Math.max(0,bought.score)/100));
    assert.equal(bought.sessionScore,s.sessionScore-cost);assert.equal(bought.rebuys,1);assert.equal(bought.state,'playing');
    assert.equal(JSON.stringify(bought.chips),chips);assert(!h.ids.get('result').open);
    for(let i=0;i<2;i++){const p=h.debug.snapshot().legal.filter(p=>p.points>0).sort((a,b)=>a.points-b.points)[0];h.debug.play(p.root);h.advance(12);}
    assert.equal(h.debug.snapshot().state,'lost');h.click('continue');assert.equal(h.ids.get('resultTitle').textContent,'BANK SECURED');
    assert.equal(h.debug.snapshot().state,'banked');h.click('continue');h.advance();assert.equal(h.debug.snapshot().rebuys,0);assert.equal(h.debug.snapshot().score,0);

  });
  console.log(`${passed} Flip checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
