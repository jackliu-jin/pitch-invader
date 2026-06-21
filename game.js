(function(){
"use strict";

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
function resize(){canvas.width = window.innerWidth; canvas.height = window.innerHeight; ctx.imageSmoothingEnabled=false;}
window.addEventListener('resize', resize); resize();

// ---------- Vector2D ----------
class Vec2{
  constructor(x=0,y=0){this.x=x;this.y=y;}
  add(v){return new Vec2(this.x+v.x,this.y+v.y);}
  sub(v){return new Vec2(this.x-v.x,this.y-v.y);}
  scale(s){return new Vec2(this.x*s,this.y*s);}
  len(){return Math.hypot(this.x,this.y);}
  norm(){const l=this.len(); return l>0.0001? new Vec2(this.x/l,this.y/l): new Vec2(0,0);}
  static dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
}

// ---------- Pixel Sprite System (2D 像素Q版，带跑动腿部动画) ----------
const PIXEL_UNIT = 4;
const BODY_TEMPLATE = [
"  hhhh  ",
" hkkkkh ",
" hkkkkh ",
" kkkkkk ",
"  kkkk  ",
"  1111  ",
" 111111 ",
" 111111 "
];
const LEGS_STAND = [
"  1  1  ",
"  2  2  ",
"  2  2  ",
"  bb bb "
];
const LEGS_RUN_A = [
" 1   1  ",
" 2   2  ",
" 2    2 ",
" bb   bb"
];
const LEGS_RUN_B = [
"  1   1 ",
"  2   2 ",
" 2    2 ",
"bb   bb "
];
function makeSprite(palette, legs){
  const template = BODY_TEMPLATE.concat(legs);
  const cols = template[0].length, rows = template.length;
  const c = document.createElement('canvas');
  c.width = cols*PIXEL_UNIT; c.height = rows*PIXEL_UNIT;
  const cx = c.getContext('2d');
  for(let r=0;r<rows;r++){
    for(let col=0; col<cols; col++){
      const ch = template[r][col];
      if(ch===' ') continue;
      cx.fillStyle = palette[ch] || '#fff';
      cx.fillRect(col*PIXEL_UNIT, r*PIXEL_UNIT, PIXEL_UNIT, PIXEL_UNIT);
    }
  }
  return c;
}
function buildCharacterSprites(palette){
  return { stand: makeSprite(palette, LEGS_STAND), a: makeSprite(palette, LEGS_RUN_A), b: makeSprite(palette, LEGS_RUN_B) };
}
const SPRITES = {
  fan:       buildCharacterSprites({h:'#5d4037', k:'#ffccaa', '1':'#ffd700', '2':'#1565c0', b:'#222'}),
  argCommon: buildCharacterSprites({h:'#3b3b3b', k:'#e0b08c', '1':'#75AADB', '2':'#ffffff', b:'#111'}),
  argStar:   buildCharacterSprites({h:'#222222', k:'#caa07a', '1':'#75AADB', '2':'#ffd700', b:'#111'}),
  porCommon: buildCharacterSprites({h:'#2b2b2b', k:'#e0b08c', '1':'#cc1122', '2':'#0a6e31', b:'#111'}),
  porStar:   buildCharacterSprites({h:'#1a1a1a', k:'#caa07a', '1':'#cc1122', '2':'#ffd700', b:'#111'}),
  guard:     buildCharacterSprites({h:'#000000', k:'#caa07a', '1':'#222831', '2':'#11151a', b:'#000'}),
  guardElite:buildCharacterSprites({h:'#1a0033', k:'#caa07a', '1':'#4a148c', '2':'#7b1fa2', b:'#000'}),
  riot:      buildCharacterSprites({h:'#333333', k:'#ffccaa', '1':'#69f0ae', '2':'#2e7d32', b:'#111'})
};
function drawSprite(sprite, sp, w, h, flip, bob){
  w *= ZOOM; h *= ZOOM;
  ctx.save();
  ctx.translate(sp.x, sp.y + (bob||0));
  if(flip) ctx.scale(-1,1);
  ctx.drawImage(sprite, -w/2, -h*0.62, w, h);
  ctx.restore();
}
const ANIM_STRIDE = 8; // 更短的步频 = 跑动更轻快
function stepWalkAnim(entity, speed, dt){
  if(speed < 0.15){ entity.animFrame = 'stand'; return; }
  entity.animPhase = (entity.animPhase||0) + speed*dt;
  entity.animFrame = Math.floor(entity.animPhase/ANIM_STRIDE)%2===0 ? 'a' : 'b';
}
// 跑动时的轻快上下弹跳偏移（屏幕像素，负=向上）
function hopOffset(entity){
  if(!entity || entity.animFrame==='stand') return 0;
  return -Math.abs(Math.sin((entity.animPhase||0)*0.35))*3.2*ZOOM;
}

// ---------- World ----------
// WORLD = 可走动范围（球场 + 外圈缓冲跑道）；FIELD = 画白线的标准球场，在 WORLD 内缩进 FIELD_MARGIN
const WORLD_W = 2200, WORLD_H = 1400;
const FIELD_MARGIN = 110; // 球场白线到硬边界之间的缓冲跑道宽度（消除“空气墙”观感）
const FIELD_X0 = FIELD_MARGIN, FIELD_Y0 = FIELD_MARGIN;
const FIELD_X1 = WORLD_W - FIELD_MARGIN, FIELD_Y1 = WORLD_H - FIELD_MARGIN;
const FIELD_W = FIELD_X1 - FIELD_X0, FIELD_H = FIELD_Y1 - FIELD_Y0;
let ZOOM = 0.72; // <1 = 镜头拉远，画面可视范围更大，人物相对场地比例更小
let camera = new Vec2(0,0);
const STAND_DEPTH = 260;

// ---------- 可调参数（debug 面板实时调节，正常游戏用默认值）----------
const TUNE = {
  playerAccel: 0.22,        // 主角转向/加速惯性（越大越灵敏）
  securityAccel: 0.045,     // 普通保安惯性（越小越笨重，越容易被假动作骗）
  securityAccelElite: 0.075,// 精英保安惯性
  fbAccel: 0.10,            // 球员（梅西/C罗等）惯性
  playerBaseSpeed: 2.6,
  sprintMult: 1.8,
  secRatio: 0.62,           // 普通保安速度 = 主角速度 × 此比例
  secRatioElite: 0.85,
  starSpeed: 2.5,           // 球星逃跑基准速度
  commonSpeed: 1.9,         // 普通球员逃跑基准速度
  starStamina: 170,         // 球星体力（大，难抓）
  commonStamina: 55         // 普通球员体力（小，容易追到累垮）
};

// crowd pixel dots for stadium stands
let crowdDots = [];
(function buildCrowdDots(){
  const scarfColors = ['#75AADB','#ffffff','#cc1122','#0a6e31','#ffd700','#ff7043'];
  const spacing = 14, rows = 4;
  // top & bottom stands
  for(let row=0; row<rows; row++){
    for(let x=-STAND_DEPTH; x<WORLD_W+STAND_DEPTH; x+=spacing){
      crowdDots.push({x, y: -30-row*16, color: scarfColors[Math.floor(Math.random()*scarfColors.length)], phase: Math.random()*Math.PI*2});
      crowdDots.push({x, y: WORLD_H+30+row*16, color: scarfColors[Math.floor(Math.random()*scarfColors.length)], phase: Math.random()*Math.PI*2});
    }
  }
  // left & right stands
  for(let row=0; row<rows; row++){
    for(let y=0; y<WORLD_H; y+=spacing){
      crowdDots.push({x: -30-row*16, y, color: scarfColors[Math.floor(Math.random()*scarfColors.length)], phase: Math.random()*Math.PI*2});
      crowdDots.push({x: WORLD_W+30+row*16, y, color: scarfColors[Math.floor(Math.random()*scarfColors.length)], phase: Math.random()*Math.PI*2});
    }
  }
})();
let chants = [];
const CHANT_TEXTS = ['OLE OLE!','VAMOS!','一起合影!','PORTUGAL!','ARGENTINA!','MESSI!','加油!','闪光灯准备!'];
let chantTimer = 0;

// ---------- Input ----------
const keys = {};
window.addEventListener('keydown', e=>{keys[e.key.toLowerCase()]=true; if(e.key===' ') e.preventDefault();});
window.addEventListener('keyup', e=>{keys[e.key.toLowerCase()]=false;});

let joyVec = new Vec2(0,0);
let sprintHeld = false;
let rollPressed = false;

(function setupJoystick(){
  const joy = document.getElementById('joystick');
  const knob = document.getElementById('joystickKnob');
  let active=false, startPos=null, id=null;
  const radius = 40;
  function setKnob(dx,dy){knob.style.left = (35+dx)+'px'; knob.style.top=(35+dy)+'px';}
  function handleStart(e){
    active=true;
    const t = e.touches? e.touches[0]: e;
    id = e.touches? e.touches[0].identifier : 'mouse';
    const rect = joy.getBoundingClientRect();
    startPos = new Vec2(rect.left+rect.width/2, rect.top+rect.height/2);
  }
  function handleMove(e){
    if(!active) return;
    let t;
    if(e.touches){ for(const tt of e.touches){ if(tt.identifier===id){t=tt;break;} } if(!t) return;}
    else t = e;
    let dx = t.clientX - startPos.x, dy = t.clientY - startPos.y;
    const d = Math.hypot(dx,dy);
    if(d>radius){dx=dx/d*radius; dy=dy/d*radius;}
    setKnob(dx,dy);
    joyVec = new Vec2(dx/radius, dy/radius);
  }
  function handleEnd(e){
    active=false; joyVec=new Vec2(0,0); setKnob(0,0);
  }
  joy.addEventListener('touchstart', e=>{handleStart(e); handleMove(e); e.preventDefault();});
  joy.addEventListener('touchmove', e=>{handleMove(e); e.preventDefault();});
  joy.addEventListener('touchend', e=>{handleEnd(e); e.preventDefault();});
  joy.addEventListener('mousedown', e=>{handleStart(e); handleMove(e);});
  window.addEventListener('mousemove', e=>{if(active) handleMove(e);});
  window.addEventListener('mouseup', e=>{handleEnd(e);});
})();

(function setupButtons(){
  const sp = document.getElementById('btnSprint');
  const rl = document.getElementById('btnRoll');
  sp.addEventListener('touchstart', e=>{sprintHeld=true; e.preventDefault();});
  sp.addEventListener('touchend', e=>{sprintHeld=false; e.preventDefault();});
  sp.addEventListener('mousedown', ()=>sprintHeld=true);
  sp.addEventListener('mouseup', ()=>sprintHeld=false);
  rl.addEventListener('touchstart', e=>{rollPressed=true; e.preventDefault();});
  rl.addEventListener('mousedown', ()=>rollPressed=true);
})();

// ---------- Game State ----------
let upgrades = {staminaMax:100, speedMult:1, rollCost:5, photoRadiusMult:1};
let upgradeLevels = {staminaMax:0, speedMult:0, rollCost:0, photoRadiusMult:0};

// ---------- 解说旁白 ----------
const OPENING_LINE = '有球迷冲场了！他tm疯了吗！';
const PHOTO_LINES = [
  '观众为你振臂高呼！',
  '比法国超跑还快！',
  '观众里最锋利的剑！',
  '名场面诞生了！！',
  '这画面要刷屏全网了！',
  '保安都看呆了！',
  '今晚的主角是他！',
  '这速度，国足都得连夜集训！'
];
let commentaryHideTimer = null;
function showCommentary(text, duration, color){
  const el = document.getElementById('commentary');
  el.textContent = text;
  el.style.color = color || '#fff';
  el.classList.add('show');
  clearTimeout(commentaryHideTimer);
  commentaryHideTimer = setTimeout(()=>{ el.classList.remove('show'); }, duration || 2600);
}
function updateUpgradeHUD(){
  document.getElementById('upgradeHUD').innerHTML =
    `体力 Lv${upgradeLevels.staminaMax}　移速 Lv${upgradeLevels.speedMult}<br>翻滚 Lv${upgradeLevels.rollCost}　视野 Lv${upgradeLevels.photoRadiusMult}`;
}
let score = 0;
let elapsed = 0;
let gameOver = false;
let paused = false;
let photographed = 0;
// 调试开关（正常游戏中保持默认值，由 debug.html 控制）
let godMode = false;
let timeScale = 1;
let showHitboxes = false;
let nextUpgradeAt = 1000; // 无尽升级：每次达成后阈值递增

// ---------- Particles / FX ----------
let confetti = [];
let flashes = []; // crowd camera flash particles
let screenShake = 0;
let flashAlpha = 0;
let goldFlashAlpha = 0;

function spawnConfettiBurst(x,y){
  for(let i=0;i<24;i++){
    confetti.push({
      x,y, vx:(Math.random()-0.5)*6, vy:(Math.random()-1.5)*6,
      color: ['#ff5252','#ffd740','#69f0ae','#40c4ff','#e040fb'][Math.floor(Math.random()*5)],
      life: 60+Math.random()*30, rot: Math.random()*Math.PI*2, vr:(Math.random()-0.5)*0.3
    });
  }
}

// crowd flash particles around stands periodically
setInterval(()=>{
  if(gameOver||paused) return;
  flashes.push({
    x: Math.random()*WORLD_W, y: Math.random()<0.5? 20+Math.random()*40 : WORLD_H-60+Math.random()*40,
    life: 10
  });
}, 350);

// ---------- Player ----------
// 主角惯性见 TUNE.playerAccel
function getSpawnPos(){ return new Vec2(WORLD_W/2, FIELD_Y1 - 6); } // 从底部边线翻入场内，写实出生点
const player = {
  pos: getSpawnPos(),
  vel: new Vec2(0,0),
  radius: 14,
  baseSpeed: 2.6,
  sprintMult: 1.8,
  stamina: 100,
  staminaMax: 100,
  exhausted: false,
  exhaustTimer: 0,
  rolling: false,
  rollTimer: 0,
  rollDir: new Vec2(1,0),
  rollDuration: 14,
  rollSpeed: 9,
  rollCooldown: 0,
  facing: new Vec2(0,-1),
  combo: 0,
  comboTimer: 0,
  riot: 0,
  animFrame: 'stand',
  animPhase: 0,
  caughtFlag:false
};

// ---------- Football Players (无限补充的球员池，保证球场不空旷) ----------
let players = [];
let playerIdCounter = 1;
const MAX_PLAYERS = 14;   // 场上始终维持的球员数量
const MAX_STARS = 2;      // 同时存在的球星数量上限
let starSpawnCooldown = 0;
const TEAM_DEFS = [
  {name:'ARG', color:'#75AADB', accent:'#fff', starNum:10},
  {name:'POR', color:'#cc1122', accent:'#0a6e31', starNum:7}
];
function randomEdgePos(){
  const edge = Math.floor(Math.random()*4), m=30;
  if(edge===0) return new Vec2(m+Math.random()*(WORLD_W-2*m), m);
  if(edge===1) return new Vec2(m+Math.random()*(WORLD_W-2*m), WORLD_H-m);
  if(edge===2) return new Vec2(m, m+Math.random()*(WORLD_H-2*m));
  return new Vec2(WORLD_W-m, m+Math.random()*(WORLD_H-2*m));
}
// 球员从球场边线跑入（停留在球场白线内）
function randomFieldEdgePos(){
  const edge = Math.floor(Math.random()*4), m=20;
  if(edge===0) return new Vec2(FIELD_X0+m+Math.random()*(FIELD_W-2*m), FIELD_Y0+m);
  if(edge===1) return new Vec2(FIELD_X0+m+Math.random()*(FIELD_W-2*m), FIELD_Y1-m);
  if(edge===2) return new Vec2(FIELD_X0+m, FIELD_Y0+m+Math.random()*(FIELD_H-2*m));
  return new Vec2(FIELD_X1-m, FIELD_Y0+m+Math.random()*(FIELD_H-2*m));
}
function nearestEdgeDir(p){
  const dl=p.x, dr=WORLD_W-p.x, du=p.y, db=WORLD_H-p.y;
  const m=Math.min(dl,dr,du,db);
  if(m===dl) return new Vec2(-1,0);
  if(m===dr) return new Vec2(1,0);
  if(m===du) return new Vec2(0,-1);
  return new Vec2(0,1);
}
function makeFootballPlayer(opts){
  opts = opts || {};
  const team = TEAM_DEFS[Math.floor(Math.random()*TEAM_DEFS.length)];
  const isStar = !!opts.isStar;
  const pos = opts.atEdge ? randomFieldEdgePos()
            : new Vec2(FIELD_X0+60+Math.random()*(FIELD_W-120), FIELD_Y0+60+Math.random()*(FIELD_H-120));
  const staminaMax = isStar ? TUNE.starStamina : TUNE.commonStamina;
  return {
    id: playerIdCounter++,
    team: team.name, color: team.color, accent: team.accent,
    number: isStar ? team.starNum : (2+Math.floor(Math.random()*8)),
    isStar,
    pos, vel:new Vec2(0,0),
    dir: new Vec2(Math.random()-0.5, Math.random()-0.5).norm(),
    wanderTimer: Math.random()*60,
    photographed:false, leaving:false,
    fleeing:false, progress:0, beingPhotographed:false,
    chasedRecently:false, chaseTimer:0,
    fleeRadius: isStar ? 175 : 100,    // 普通球员也会躲避，但触发距离更近
    stamina: staminaMax, fbExhausted:false, fbExhaustTimer:0,
    animFrame:'stand', animPhase:0
  };
}
function countStars(){ let n=0; for(const p of players) if(p.isStar && !p.leaving) n++; return n; }
function spawnFootballPlayers(){
  players = []; playerIdCounter = 1; starSpawnCooldown = 0;
  for(let i=0;i<MAX_PLAYERS;i++) players.push(makeFootballPlayer({isStar: i<MAX_STARS}));
}
function refillPlayers(dt){
  if(starSpawnCooldown>0) starSpawnCooldown -= dt;
  let alive=0; for(const p of players) if(!p.leaving) alive++;
  if(alive < MAX_PLAYERS){
    let asStar = false;
    if(countStars() < MAX_STARS && starSpawnCooldown<=0){ asStar=true; starSpawnCooldown=360; }
    players.push(makeFootballPlayer({isStar:asStar, atEdge:true}));
  }
}
spawnFootballPlayers();

// ---------- Security ----------
let security = [];
let securitySpawnTimer = 0;
let baseSecurityCount = 2;
// 安保惯性参数见 TUNE.securityAccel / securityAccelElite
const LUNGE_RANGE = 70;
const LUNGE_CHARGE_DURATION = 28; // 飞扑前的蓄力时间
const LUNGE_DURATION = 16;
const LUNGE_RECOVER_DURATION = 45; // 扑空后的爬起恢复时间
const LUNGE_SPEED_MULT = 2.4;
const LUNGE_COOLDOWN_AFTER = 80;
function spawnSecurity(elite=false){
  // spawn from border
  const edge = Math.floor(Math.random()*4);
  let pos;
  if(edge===0) pos = new Vec2(Math.random()*WORLD_W, 0);
  else if(edge===1) pos = new Vec2(Math.random()*WORLD_W, WORLD_H);
  else if(edge===2) pos = new Vec2(0, Math.random()*WORLD_H);
  else pos = new Vec2(WORLD_W, Math.random()*WORLD_H);
  security.push({
    pos, vel:new Vec2(0,0),
    speedRatio: elite ? TUNE.secRatioElite : TUNE.secRatio, // 每帧会按 TUNE 重算
    elite,
    distracted:false,
    distractTarget:null,
    radius:13,
    state:'chase', // chase | charge | lunge | recover
    stateTimer:0,
    lungeDir: new Vec2(0,0),
    lungeCooldown:0,
    animFrame:'stand',
    animPhase:0
  });
}
for(let i=0;i<baseSecurityCount;i++) spawnSecurity();

// ---------- Riot NPCs (decoys) ----------
let riotNPCs = [];
let riotActive = false;
let riotTimer = 0;

// ---------- 人声鼎沸：合成观众噪声 ----------
let audioCtx=null, noiseGain=null, crowdFilter=null;
function initAudio(){
  if(audioCtx) return;
  try{
    audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    const bufferSize = 2*audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1);
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer; noise.loop = true;
    crowdFilter = audioCtx.createBiquadFilter();
    crowdFilter.type='bandpass'; crowdFilter.frequency.value=750; crowdFilter.Q.value=0.5;
    noiseGain = audioCtx.createGain(); noiseGain.gain.value=0.07;
    noise.connect(crowdFilter); crowdFilter.connect(noiseGain); noiseGain.connect(audioCtx.destination);
    noise.start();
    setInterval(()=>{
      if(!noiseGain || gameOver) return;
      const target = 0.05+Math.random()*0.06;
      noiseGain.gain.linearRampToValueAtTime(target, audioCtx.currentTime+0.7);
    }, 700);
  }catch(e){ /* 不支持音频时静默忽略 */ }
}
function crowdRoar(intensity, duration){
  if(!noiseGain) return;
  const t0 = audioCtx.currentTime;
  noiseGain.gain.cancelScheduledValues(t0);
  noiseGain.gain.setValueAtTime(noiseGain.gain.value, t0);
  noiseGain.gain.linearRampToValueAtTime(intensity, t0+0.06);
  noiseGain.gain.linearRampToValueAtTime(0.07, t0+duration);
}

function triggerRiot(){
  riotActive = true;
  crowdRoar(0.4, 1.2);
  riotTimer = 480; // ~8s at 60fps
  const n = 3+Math.floor(Math.random()*3);
  for(let i=0;i<n;i++){
    riotNPCs.push({
      pos: new Vec2(Math.random()*WORLD_W, Math.random()*WORLD_H),
      vel: new Vec2(0,0),
      dir: new Vec2(Math.random()-0.5,Math.random()-0.5).norm(),
      wanderTimer: 0,
      life: 480
    });
  }
}

// ---------- Helper: clamp ----------
function clampToWorld(pos, r){
  pos.x = Math.max(r, Math.min(WORLD_W-r, pos.x));
  pos.y = Math.max(r, Math.min(WORLD_H-r, pos.y));
}
function clampToField(pos, r){
  pos.x = Math.max(FIELD_X0+r, Math.min(FIELD_X1-r, pos.x));
  pos.y = Math.max(FIELD_Y0+r, Math.min(FIELD_Y1-r, pos.y));
}

// ---------- Update ----------
let lastTime = performance.now();

function getMoveVector(){
  let v = new Vec2(0,0);
  if(keys['w']||keys['arrowup']) v.y -=1;
  if(keys['s']||keys['arrowdown']) v.y +=1;
  if(keys['a']||keys['arrowleft']) v.x -=1;
  if(keys['d']||keys['arrowright']) v.x +=1;
  if(v.len()>0) v = v.norm();
  else v = joyVec.len()>0.15 ? joyVec : new Vec2(0,0);
  return v;
}

function updatePlayer(dt){
  const move = getMoveVector();
  const wantSprint = (sprintHeld || keys['shift']) && move.len()>0 && !player.exhausted && player.stamina>0;
  const wantRoll = (rollPressed || keys[' ']) && !player.rolling && player.rollCooldown<=0 && player.stamina>=upgrades.rollCost;
  rollPressed = false; // consume

  if(move.len()>0) player.facing = move;

  if(player.rolling){
    player.rollTimer -= dt;
    player.vel = player.rollDir.scale(player.rollSpeed);
    let p2 = player.pos.add(player.vel.scale(dt));
    clampToWorld(p2, player.radius);
    player.pos = p2;
    if(player.rollTimer<=0){ player.rolling=false; player.rollCooldown=20; player.vel = player.vel.scale(0.5); }
  } else if(wantRoll){
    player.rolling = true;
    player.rollTimer = player.rollDuration;
    player.rollDir = move.len()>0? move : player.facing;
    player.stamina -= upgrades.rollCost;
  } else {
    let speed = TUNE.playerBaseSpeed * upgrades.speedMult;
    if(player.exhausted) speed *= 0.4;
    else if(wantSprint){ speed *= TUNE.sprintMult; player.stamina -= 0.4; }

    // 移动带惯性：速度向目标速度平滑过渡，松手或变向时会有滑行感
    const targetVel = move.scale(speed);
    player.vel = player.vel.add(targetVel.sub(player.vel).scale(TUNE.playerAccel*dt));

    let np = player.pos.add(player.vel.scale(dt));
    clampToWorld(np, player.radius);
    player.pos = np;
  }

  stepWalkAnim(player, player.vel.len(), dt);

  if(player.rollCooldown>0) player.rollCooldown -= dt;

  if(player.stamina<=0 && !player.exhausted){
    player.exhausted = true;
    player.exhaustTimer = 120; // 2s
  }
  if(player.exhausted){
    player.exhaustTimer -= dt;
    if(player.exhaustTimer<=0){ player.exhausted=false; player.stamina = 20; }
  }
  if(!wantSprint && !player.rolling && player.stamina < upgrades.staminaMax && !player.exhausted){
    player.stamina = Math.min(upgrades.staminaMax, player.stamina + 0.45);
  }
  player.stamina = Math.max(0, Math.min(upgrades.staminaMax, player.stamina));

  // combo decay
  if(player.comboTimer>0){ player.comboTimer -= dt; if(player.comboTimer<=0){ player.combo=0; } }
}

function updateFootballPlayers(dt){
  const photoRange = 50*upgrades.photoRadiusMult;
  for(let i=players.length-1;i>=0;i--){
    const fp = players[i];

    // 合影完成后跑下场，跑出边界就移除（由 refillPlayers 补充新球员）
    if(fp.leaving){
      fp.vel = fp.vel.add(fp.dir.scale(3.6).sub(fp.vel).scale(0.2*dt));
      fp.pos = fp.pos.add(fp.vel.scale(dt));
      stepWalkAnim(fp, fp.vel.len(), dt);
      if(fp.pos.x<-40||fp.pos.x>WORLD_W+40||fp.pos.y<-40||fp.pos.y>WORLD_H+40) players.splice(i,1);
      continue;
    }

    const staminaMax = fp.isStar ? TUNE.starStamina : TUNE.commonStamina;
    if(fp.stamina > staminaMax) fp.stamina = staminaMax;
    const baseSpeed = fp.isStar ? TUNE.starSpeed : TUNE.commonSpeed;
    const distToPlayer = Vec2.dist(fp.pos, player.pos);
    // 贴脸抓住：任何球员被逼到极近都会被强制定身合影
    const grabbed = distToPlayer < photoRange*0.8 && !player.rolling;
    // 想逃：进入躲避半径、有体力、未累垮、玩家不在翻滚无敌中
    const wantFlee = !grabbed && !player.rolling && distToPlayer < fp.fleeRadius && fp.stamina>0 && !fp.fbExhausted;

    let desiredDir, desiredSpeed;
    if(grabbed){
      fp.fleeing = false;
      desiredDir = new Vec2(0,0); desiredSpeed = 0; // 定身
    } else if(wantFlee){
      fp.fleeing = true;
      fp.chasedRecently = true; fp.chaseTimer = 90;
      desiredDir = fp.pos.sub(player.pos).norm();
      desiredSpeed = baseSpeed * 1.5;
      fp.stamina -= (fp.isStar ? 0.8 : 1.1) * dt; // 逃跑消耗体力，普通球员掉得更快
      if(fp.stamina <= 0){ fp.stamina = 0; fp.fbExhausted = true; fp.fbExhaustTimer = 70; }
    } else {
      fp.fleeing = false;
      fp.wanderTimer -= dt;
      if(fp.wanderTimer<=0){
        fp.dir = new Vec2(Math.random()-0.5, Math.random()-0.5).norm();
        fp.wanderTimer = 60+Math.random()*90;
      }
      desiredDir = fp.dir;
      desiredSpeed = fp.fbExhausted ? baseSpeed*0.18 : baseSpeed*0.45; // 累垮后气喘吁吁地慢走
    }
    if(desiredDir.len()>0) fp.dir = desiredDir;

    // 体力恢复 / 气喘惩罚计时
    if(fp.fbExhausted){
      fp.fbExhaustTimer -= dt;
      if(fp.fbExhaustTimer<=0){ fp.fbExhausted=false; fp.stamina = staminaMax*0.4; }
    } else if(!wantFlee){
      fp.stamina = Math.min(staminaMax, fp.stamina + 0.5*dt);
    }

    // 惯性：速度平滑过渡到目标速度（增加真实感与可被假动作甩开的余地）
    const targetVel = desiredDir.scale(desiredSpeed);
    fp.vel = fp.vel.add(targetVel.sub(fp.vel).scale(TUNE.fbAccel*dt));
    let np = fp.pos.add(fp.vel.scale(dt));
    clampToField(np, 12);
    fp.pos = np;
    stepWalkAnim(fp, fp.vel.len(), dt);

    if(fp.chaseTimer>0){ fp.chaseTimer -= dt; } else { fp.chasedRecently = false; }

    // 合影判定：贴脸抓住，或对方已停下/累垮且在合影半径内
    const inRange = grabbed || (distToPlayer < photoRange && !fp.fleeing);
    if(inRange){
      fp.beingPhotographed = true;
      fp.progress += (grabbed ? 1.3 : 1.0) * dt;
      if(fp.progress >= 60) completePhoto(fp);
    } else {
      fp.beingPhotographed = false;
      fp.progress = Math.max(0, fp.progress - dt*2);
    }
  }
}

function completePhoto(fp){
  fp.photographed = true;
  fp.leaving = true;            // 合影后跑下场
  fp.beingPhotographed = false;
  fp.fleeing = false;
  fp.dir = nearestEdgeDir(fp.pos);
  photographed++;
  let base = fp.isStar ? 400 : 150;
  let mult = 1;
  if(fp.chasedRecently) mult *= 2;
  let gained = Math.round(base*mult);
  score += gained;
  document.getElementById('scoreDisplay').textContent = score;
  spawnConfettiBurst(fp.pos.x, fp.pos.y);
  flashAlpha = fp.isStar ? 1 : 0.7;
  if(fp.isStar) goldFlashAlpha = 1;
  screenShake = 10;
  crowdRoar(fp.isStar?0.35:0.22, fp.isStar?0.9:0.5);
  showCommentary(PHOTO_LINES[Math.floor(Math.random()*PHOTO_LINES.length)], 2200, fp.isStar?'#ffd700':'#fff');
  player.combo++;
  player.comboTimer = 180;
  player.riot = Math.min(100, player.riot + (fp.isStar?35:18));
  if(player.riot>=100 && !riotActive){
    triggerRiot();
    player.riot = 0;
  }
  // 每合影 10 人来一句里程碑解说，烘托“越来越红”的氛围
  if(photographed % 10 === 0){
    showCommentary(`已合影 ${photographed} 人！你已经是全场最靓的仔！`, 2600, '#ffd700');
  }
  checkUpgradeThreshold();
}

function checkUpgradeThreshold(){
  if(score >= nextUpgradeAt){
    showUpgradePanel();
    // 阈值递增 ~1.7 倍，保证无尽模式里持续有升级二选一
    nextUpgradeAt = Math.round(nextUpgradeAt*1.7/100)*100;
  }
}

function updateSecurity(dt){
  securitySpawnTimer -= dt;
  // 安保数量随时间、得分、以及主角的移速升级不断增加（尸海战术），但单体速度始终慢于主角
  const speedBonus = Math.floor((upgrades.speedMult-1)*8);
  const targetCount = baseSecurityCount + Math.floor(elapsed/15) + Math.floor(score/1000) + speedBonus + Math.floor(photographed/6);
  if(security.length < Math.min(targetCount, 32) && securitySpawnTimer<=0){
    spawnSecurity(elapsed>60 && Math.random()<0.3);
    securitySpawnTimer = Math.max(30, 90 - Math.floor(elapsed/10) - Math.floor(photographed/4));
  }

  const playerCurrentSpeed = TUNE.playerBaseSpeed * upgrades.speedMult;
  for(const s of security){
    // 用 TUNE 实时计算速度比例与惯性，使 debug 调节即时生效
    s.speedRatio = s.elite ? TUNE.secRatioElite : TUNE.secRatio;
    if(s.lungeCooldown>0) s.lungeCooldown -= dt;
    let chasingDecoy = false;

    if(s.state==='charge'){
      // 蓄力飞扑：原地几乎不动，靠视觉提示告诉玩家"要扑了"
      s.stateTimer -= dt;
      s.vel = s.vel.scale(0.8);
      if(s.stateTimer<=0){
        s.state = 'lunge';
        s.stateTimer = LUNGE_DURATION;
        const predicted = player.pos.add(player.vel.scale(6));
        s.lungeDir = predicted.sub(s.pos).norm();
      }
    } else if(s.state==='lunge'){
      s.stateTimer -= dt;
      const lungeSpeed = playerCurrentSpeed * s.speedRatio * LUNGE_SPEED_MULT;
      s.vel = s.lungeDir.scale(lungeSpeed);
      if(s.stateTimer<=0){
        s.state = 'recover';
        s.stateTimer = LUNGE_RECOVER_DURATION;
      }
    } else if(s.state==='recover'){
      // 扑空后倒地爬起，移动大幅减速，是玩家反打的窗口
      s.stateTimer -= dt;
      s.vel = s.vel.scale(0.85);
      if(s.stateTimer<=0){
        s.state = 'chase';
        s.lungeCooldown = LUNGE_COOLDOWN_AFTER;
      }
    } else {
      let target = player.pos;
      if(riotActive && riotNPCs.length>0){
        let nearest = null, nd = Infinity;
        for(const r of riotNPCs){
          const d = Vec2.dist(s.pos, r.pos);
          if(d<nd){nd=d; nearest=r;}
        }
        if(nearest && nd < 260){
          target = nearest.pos;
          chasingDecoy = true;
        }
      }
      let dir = target.sub(s.pos).norm();
      if(s.elite && !chasingDecoy){
        // predictive: aim slightly ahead of player's velocity
        const predicted = player.pos.add(player.vel.scale(8));
        dir = predicted.sub(s.pos).norm();
      }
      const targetSpeed = playerCurrentSpeed * s.speedRatio;
      const targetVel = dir.scale(targetSpeed);
      // 安保惯性更大：转向比主角慢得多，玩家可以靠急停变向把他们骗过去
      const accel = s.elite ? TUNE.securityAccelElite : TUNE.securityAccel;
      s.vel = s.vel.add(targetVel.sub(s.vel).scale(accel*dt));

      const distToPlayer = Vec2.dist(s.pos, player.pos);
      if(!chasingDecoy && !player.rolling && distToPlayer < LUNGE_RANGE && s.lungeCooldown<=0){
        s.state = 'charge';
        s.stateTimer = LUNGE_CHARGE_DURATION;
        s.vel = s.vel.scale(0.3);
      }
    }

    let np = s.pos.add(s.vel.scale(dt));
    clampToWorld(np, s.radius);
    s.pos = np;
    stepWalkAnim(s, s.vel.len(), dt);

    if(!chasingDecoy && !player.rolling && !godMode){
      const d = Vec2.dist(s.pos, player.pos);
      if(d < s.radius+player.radius){
        endGame(false);
      }
    }
  }
}

function updateRiot(dt){
  if(!riotActive) return;
  riotTimer -= dt;
  for(const r of riotNPCs){
    r.wanderTimer -= dt;
    if(r.wanderTimer<=0){
      r.dir = new Vec2(Math.random()-0.5, Math.random()-0.5).norm();
      r.wanderTimer = 30+Math.random()*60;
    }
    let np = r.pos.add(r.dir.scale(2.4));
    clampToWorld(np, 10);
    stepWalkAnim(r, 2.4, dt);
    r.pos = np;
  }
  if(riotTimer<=0){
    riotActive = false;
    riotNPCs = [];
  }
}

function updateConfetti(dt){
  for(let i=confetti.length-1;i>=0;i--){
    const c = confetti[i];
    c.x += c.vx; c.y += c.vy; c.vy += 0.15; c.rot += c.vr; c.life -= dt;
    if(c.life<=0) confetti.splice(i,1);
  }
}

function updateFlashesFX(dt){
  for(let i=flashes.length-1;i>=0;i--){
    flashes[i].life -= dt;
    if(flashes[i].life<=0) flashes.splice(i,1);
  }
}

let dangerLevel = 0;
function updateDanger(){
  let minDist = Infinity;
  for(const s of security){
    const d = Vec2.dist(s.pos, player.pos);
    if(d<minDist) minDist = d;
  }
  dangerLevel = Math.max(0, Math.min(1, 1 - (minDist-30)/180));
  document.getElementById('dangerVignette').style.boxShadow = `inset 0 0 ${80+dangerLevel*80}px ${10+dangerLevel*30}px rgba(255,0,0,${dangerLevel*0.6})`;
}

// ---------- Upgrade Panel ----------
function showUpgradePanel(){
  paused = true;
  const panel = document.getElementById('upgradePanel');
  const opts = document.getElementById('upgradeOpts');
  opts.innerHTML = '';
  const choices = [
    {label:'体力上限 +30', key:'staminaMax', toast:'永久强化：体力上限提升！', apply:()=>{upgrades.staminaMax+=30; player.stamina=upgrades.staminaMax;}},
    {label:'移速/冲刺速度 +15%', key:'speedMult', toast:'永久强化：移动与冲刺速度提升！', apply:()=>{upgrades.speedMult+=0.15;}},
    {label:'翻滚消耗 -1', key:'rollCost', toast:'永久强化：翻滚体力消耗降低！', apply:()=>{upgrades.rollCost=Math.max(1,upgrades.rollCost-1);}},
    {label:'合影判定半径 +20%', key:'photoRadiusMult', toast:'永久强化：合影判定范围扩大！', apply:()=>{upgrades.photoRadiusMult+=0.2;}}
  ];
  // pick 2 random distinct
  const shuffled = choices.slice().sort(()=>Math.random()-0.5).slice(0,2);
  shuffled.forEach(c=>{
    const div = document.createElement('div');
    div.className='upgradeOpt';
    div.textContent = c.label;
    div.onclick = ()=>{
      c.apply();
      upgradeLevels[c.key]++;
      updateUpgradeHUD();
      showCommentary(c.toast, 2400, '#ffd700');
      goldFlashAlpha = 0.6;
      panel.style.display='none';
      paused=false;
    };
    opts.appendChild(div);
  });
  panel.style.display='flex';
}

// ---------- End Game ----------
function endGame(won){
  if(gameOver) return;
  gameOver = true;
  const panel = document.getElementById('endPanel');
  document.getElementById('endTitle').textContent = won ? '冲场之王！' : '被保安逮捕了！';
  document.getElementById('endStats').innerHTML = `得分：${score}<br>合影人数：${photographed}<br>存活时间：${formatTime(elapsed)}`;
  panel.style.display='flex';
}

function formatTime(t){
  const totalSec = Math.floor(t/60); // approx since dt~1 per frame at 60fps
  const m = Math.floor(totalSec/60).toString().padStart(2,'0');
  const s = (totalSec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

// ---------- Render ----------
function worldToScreen(p){
  return new Vec2((p.x - camera.x)*ZOOM, (p.y - camera.y)*ZOOM);
}

function drawStands(now){
  // 看台底色（外圈）
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // 看台阶梯渐变条带
  const tl = worldToScreen(new Vec2(-STAND_DEPTH, -STAND_DEPTH));
  ctx.fillStyle = '#33312e';
  ctx.fillRect(tl.x, tl.y, WORLD_W+STAND_DEPTH*2, WORLD_H+STAND_DEPTH*2);
  for(let i=0;i<4;i++){
    const d = STAND_DEPTH - i*(STAND_DEPTH/4);
    const p = worldToScreen(new Vec2(-d, -d));
    ctx.fillStyle = i%2===0 ? 'rgba(70,65,58,0.6)' : 'rgba(50,46,40,0.6)';
    ctx.fillRect(p.x, p.y, WORLD_W+d*2, WORLD_H+d*2);
  }
  // 人声鼎沸的像素观众席：每个点位上下抖动+明暗闪烁模拟欢呼
  const margin = 24;
  for(const dot of crowdDots){
    const sp = worldToScreen(new Vec2(dot.x, dot.y));
    if(sp.x<-margin||sp.x>canvas.width+margin||sp.y<-margin||sp.y>canvas.height+margin) continue;
    const bob = Math.sin(now*0.006 + dot.phase)*2;
    const flicker = 0.65 + 0.35*Math.sin(now*0.012 + dot.phase*1.7);
    ctx.globalAlpha = flicker;
    ctx.fillStyle = dot.color;
    ctx.fillRect(Math.round(sp.x-2), Math.round(sp.y-2+bob), 4, 5);
    ctx.globalAlpha = 1;
  }
  // 偶发助威横幅文字气泡
  for(const c of chants){
    const sp = worldToScreen(new Vec2(c.x, c.y));
    ctx.globalAlpha = Math.max(0, c.life/90);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign='center';
    ctx.strokeStyle='#000'; ctx.lineWidth=3;
    ctx.strokeText(c.text, sp.x, sp.y);
    ctx.fillText(c.text, sp.x, sp.y);
    ctx.globalAlpha = 1;
  }
}

function wpt(x,y){ return worldToScreen(new Vec2(x,y)); }
function wRect(x,y,w,h){ const p=wpt(x,y); ctx.strokeRect(p.x,p.y,w*ZOOM,h*ZOOM); }

function drawFieldLines(){
  const lw = Math.max(1.5, 3*ZOOM);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = lw;
  const cx = WORLD_W/2, cy = WORLD_H/2;
  // 外边界
  wRect(FIELD_X0, FIELD_Y0, FIELD_W, FIELD_H);
  // 中线
  let a=wpt(cx,FIELD_Y0), b=wpt(cx,FIELD_Y1);
  ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  // 中圈 + 中点
  const center = wpt(cx,cy), centerR = Math.min(FIELD_W,FIELD_H)*0.12;
  ctx.beginPath(); ctx.arc(center.x,center.y,centerR*ZOOM,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(center.x,center.y,3*ZOOM,0,Math.PI*2); ctx.fill();
  // 禁区/小禁区/点球点/弧线（左右两侧）
  const pD=FIELD_W*0.13, pH=FIELD_H*0.55;     // 大禁区
  const gD=FIELD_W*0.045, gH=FIELD_H*0.28;    // 小禁区
  const spotDist=FIELD_W*0.085;               // 点球点距门线
  const arcR=FIELD_H*0.10;
  [{gx:FIELD_X0, s:1},{gx:FIELD_X1, s:-1}].forEach(side=>{
    const {gx,s}=side;
    wRect(s>0?gx:gx-pD, cy-pH/2, pD, pH);     // 大禁区
    wRect(s>0?gx:gx-gD, cy-gH/2, gD, gH);     // 小禁区
    const spot = wpt(gx + s*spotDist, cy);
    ctx.beginPath(); ctx.arc(spot.x,spot.y,3*ZOOM,0,Math.PI*2); ctx.fill();  // 点球点
    // 罚球弧（只画禁区外那段）
    ctx.beginPath();
    const a0 = s>0 ? -Math.PI/2.6 : Math.PI - Math.PI/2.6;
    const a1 = s>0 ?  Math.PI/2.6 : Math.PI + Math.PI/2.6;
    ctx.arc(spot.x, spot.y, arcR*ZOOM, a0, a1, s<0);
    ctx.stroke();
    // 球门（门线外的小框）
    const goalD=24, goalH=FIELD_H*0.13;
    ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.95)';
    wRect(s>0?gx-goalD:gx, cy-goalH/2, goalD, goalH);
    ctx.restore();
  });
  // 角球弧
  const cR=24;
  [[FIELD_X0,FIELD_Y0,0,Math.PI/2],[FIELD_X1,FIELD_Y0,Math.PI/2,Math.PI],
   [FIELD_X1,FIELD_Y1,Math.PI,Math.PI*1.5],[FIELD_X0,FIELD_Y1,Math.PI*1.5,Math.PI*2]].forEach(c=>{
    const p=wpt(c[0],c[1]); ctx.beginPath(); ctx.arc(p.x,p.y,cR*ZOOM,c[2],c[3]); ctx.stroke();
  });
}

function drawPitch(now){
  drawStands(now);
  // 缓冲跑道（球场外圈，可走动）——较深的草色
  const wtl = wpt(0,0);
  ctx.fillStyle = '#246627';
  ctx.fillRect(wtl.x, wtl.y, WORLD_W*ZOOM, WORLD_H*ZOOM);
  // 球场草坪 + 条纹（裁剪在球场范围内）
  const ftl = wpt(FIELD_X0, FIELD_Y0);
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(ftl.x, ftl.y, FIELD_W*ZOOM, FIELD_H*ZOOM);
  const stripeW = 100*ZOOM;
  ctx.save();
  ctx.beginPath(); ctx.rect(ftl.x, ftl.y, FIELD_W*ZOOM, FIELD_H*ZOOM); ctx.clip();
  for(let x = ftl.x; x < ftl.x + FIELD_W*ZOOM; x += stripeW*2){
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(x, ftl.y, stripeW, FIELD_H*ZOOM);
  }
  ctx.restore();
  drawFieldLines();

  // crowd flash particles (camera flashes from the stands)
  for(const f of flashes){
    const sp = worldToScreen(new Vec2(f.x,f.y));
    ctx.fillStyle = `rgba(255,255,255,${0.5*(f.life/10)})`;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, Math.PI*2); ctx.fill();
  }
}

function updateChants(dt){
  chantTimer -= dt;
  if(chantTimer<=0){
    chantTimer = 90 + Math.random()*120;
    const onTop = Math.random()<0.5;
    chants.push({
      x: Math.random()*WORLD_W,
      y: onTop ? -40 : WORLD_H+50,
      text: CHANT_TEXTS[Math.floor(Math.random()*CHANT_TEXTS.length)],
      life: 90
    });
  }
  for(let i=chants.length-1;i>=0;i--){
    chants[i].life -= dt;
    chants[i].y -= dt*0.3;
    if(chants[i].life<=0) chants.splice(i,1);
  }
}

function drawStaminaBar(){
  const sp = worldToScreen(player.pos);
  const w = 40*ZOOM, h=5*ZOOM;
  const x = sp.x-w/2, y = sp.y - (player.radius+16)*ZOOM;
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(x,y,w,h);
  ctx.fillStyle = player.exhausted? '#888' : '#4caf50';
  ctx.fillRect(x,y, w*(player.stamina/upgrades.staminaMax), h);
}

function drawPlayer(now){
  const sp = worldToScreen(player.pos);
  ctx.save();
  if(player.rolling) ctx.globalAlpha = 0.55;
  drawSprite(SPRITES.fan[player.animFrame||'stand'], sp, 28, 42, player.facing.x<-0.1, player.rolling?0:hopOffset(player));
  ctx.restore();
  drawStaminaBar();
}

function drawMiniStaminaBar(sp, frac, w, exhausted, topY){
  const h=4*ZOOM; w*=ZOOM;
  const x=sp.x-w/2, y=topY;
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(x,y,w,h);
  ctx.fillStyle = exhausted? '#888' : (frac<0.3? '#ff5252' : (frac<0.6? '#ffc107' : '#4caf50'));
  ctx.fillRect(x,y,w*Math.max(0,frac),h);
}
function drawFootballPlayers(){
  for(const fp of players){
    const sp = worldToScreen(fp.pos);
    if(sp.x<-30||sp.x>canvas.width+30||sp.y<-30||sp.y>canvas.height+30) continue;
    if(fp.leaving) ctx.globalAlpha = 0.7;
    const spriteSet = fp.team==='ARG' ? (fp.isStar?SPRITES.argStar:SPRITES.argCommon) : (fp.isStar?SPRITES.porStar:SPRITES.porCommon);
    const w = fp.isStar?30:24, h = fp.isStar?44:36;
    const bob = hopOffset(fp);
    drawSprite(spriteSet[fp.animFrame||'stand'], sp, w, h, fp.dir && fp.dir.x<-0.1, bob);
    ctx.fillStyle='#fff'; ctx.font='bold 10px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.strokeStyle='#000'; ctx.lineWidth=2;
    ctx.strokeText(fp.number, sp.x, sp.y-2+bob);
    ctx.fillText(fp.number, sp.x, sp.y-2+bob);
    if(fp.isStar){
      ctx.strokeStyle='#ffd700'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(sp.x, sp.y-4*ZOOM+bob, 20*ZOOM, 0, Math.PI*2); ctx.stroke();
    }
    // 体力槽：球星更宽更显眼，普通球员窄；只在被惊动（逃过/未满/累垮）时显示
    if(!fp.leaving){
      const staminaMax = fp.isStar ? TUNE.starStamina : TUNE.commonStamina;
      if(fp.fleeing || fp.fbExhausted || fp.stamina < staminaMax-0.5){
        drawMiniStaminaBar(sp, fp.stamina/staminaMax, fp.isStar?34:20, fp.fbExhausted, sp.y-(fp.isStar?30:24)*ZOOM);
      }
    }
    if(fp.beingPhotographed){
      ctx.strokeStyle='#00e5ff'; ctx.lineWidth=3;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y-4*ZOOM, 25*ZOOM, -Math.PI/2, -Math.PI/2 + (fp.progress/60)*Math.PI*2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function drawSecurity(now){
  for(const s of security){
    const sp = worldToScreen(s.pos);
    if(sp.x<-30||sp.x>canvas.width+30||sp.y<-30||sp.y>canvas.height+30) continue;
    const spriteSet = s.elite ? SPRITES.guardElite : SPRITES.guard;
    let alpha=1, scale=1;
    if(s.state==='charge'){
      // 蓄力飞扑前的红色警示圈，提醒玩家该躲了
      const p = 1 - s.stateTimer/LUNGE_CHARGE_DURATION;
      ctx.save();
      ctx.strokeStyle = `rgba(255,40,40,${0.4+0.4*Math.sin(now*0.02)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sp.x, sp.y-14*ZOOM, (14+p*12)*ZOOM, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
      scale = 0.9; // 下蹲蓄力
    } else if(s.state==='lunge'){
      scale = 1.18; // 飞扑伸展
    } else if(s.state==='recover'){
      alpha = 0.55; // 倒地爬起
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    drawSprite(spriteSet[s.animFrame||'stand'], sp, 26*scale, 38*scale, s.vel.x<-0.1, s.state==='chase'?hopOffset(s):0);
    ctx.restore();
    if(s.elite){
      ctx.fillStyle='#ffd700'; ctx.font='bold 12px Arial'; ctx.textAlign='center';
      ctx.fillText('★', sp.x, sp.y-32*ZOOM);
    }
  }
}

function drawRiotNPCs(){
  for(const r of riotNPCs){
    const sp = worldToScreen(r.pos);
    drawSprite(SPRITES.riot[r.animFrame||'stand'], sp, 22, 34, r.dir && r.dir.x<-0.1, hopOffset(r));
  }
}

function drawConfetti(){
  for(const c of confetti){
    const sp = worldToScreen(new Vec2(c.x,c.y));
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-3,-5,6,10);
    ctx.restore();
  }
}

function render(now){
  ctx.save();
  if(screenShake>0){
    ctx.translate((Math.random()-0.5)*screenShake, (Math.random()-0.5)*screenShake);
  }
  drawPitch(now);
  drawFootballPlayers();
  drawRiotNPCs();
  drawSecurity(now);
  drawPlayer(now);
  drawConfetti();
  if(showHitboxes) drawHitboxes();
  ctx.restore();

  // flash overlays
  document.getElementById('flash').style.opacity = flashAlpha;
  document.getElementById('goldFlash').style.opacity = goldFlashAlpha;

  // progress wrap near nearest target player (only show on whichever is closest & in range)
  updateProgressUI();
}

function drawHitboxes(){
  // 调试：绘制各实体碰撞圈与判定半径
  const ph = (p,r,color)=>{ const sp=worldToScreen(p); ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(sp.x,sp.y,r*ZOOM,0,Math.PI*2); ctx.stroke(); };
  // 可走动边界（WORLD）与球场范围（FIELD）
  ctx.strokeStyle='#ff00ff'; ctx.lineWidth=1.5; let p0=wpt(0,0); ctx.strokeRect(p0.x,p0.y,WORLD_W*ZOOM,WORLD_H*ZOOM);
  ctx.strokeStyle='rgba(0,255,255,0.5)'; let f0=wpt(FIELD_X0,FIELD_Y0); ctx.strokeRect(f0.x,f0.y,FIELD_W*ZOOM,FIELD_H*ZOOM);
  ph(player.pos, player.radius, '#00ff00');
  ph(player.pos, 50*upgrades.photoRadiusMult, 'rgba(0,229,255,0.7)'); // 合影半径
  for(const s of security){ ph(s.pos, s.radius, '#ff3030'); ph(s.pos, LUNGE_RANGE, 'rgba(255,80,80,0.35)'); }
  for(const fp of players){ if(fp.leaving) continue; ph(fp.pos, 12, fp.isStar?'#ffd700':'#ffffff'); ph(fp.pos, fp.fleeRadius, fp.isStar?'rgba(255,215,0,0.25)':'rgba(255,255,255,0.18)'); }
}

function updateProgressUI(){
  let closest = null, cd = Infinity;
  for(const fp of players){
    if(fp.leaving) continue;
    const d = Vec2.dist(fp.pos, player.pos);
    if(d<cd){cd=d; closest=fp;}
  }
  const wrap = document.getElementById('progressWrap');
  if(closest && closest.beingPhotographed){
    const sp = worldToScreen(closest.pos);
    wrap.style.display='block';
    wrap.style.left = (sp.x-30)+'px';
    wrap.style.top = (sp.y-40)+'px';
    document.getElementById('progressBar').style.width = (closest.progress/60*100)+'%';
  } else {
    wrap.style.display='none';
  }
}

// ---------- Main Loop ----------
function loop(now){
  const dt = Math.min(2, (now-lastTime)/16.67 * timeScale);
  lastTime = now;

  if(!gameOver && !paused){
    elapsed += 1;
    updatePlayer(dt);
    updateFootballPlayers(dt);
    refillPlayers(dt);
    updateSecurity(dt);
    updateRiot(dt);
    updateConfetti(dt);
    updateFlashesFX(dt);
    updateChants(dt);
    updateDanger();

    camera.x = player.pos.x - (canvas.width/ZOOM)/2;
    camera.y = player.pos.y - (canvas.height/ZOOM)/2;

    if(flashAlpha>0) flashAlpha -= 0.05;
    if(goldFlashAlpha>0) goldFlashAlpha -= 0.04;
    if(screenShake>0) screenShake -= 0.6;

    document.getElementById('timeDisplay').textContent = `存活 ${formatTime(elapsed)}　已合影 ${photographed}`;
    document.getElementById('stamBar').style.width = (player.stamina/upgrades.staminaMax*100)+'%';
    document.getElementById('stamBar').style.background = player.exhausted? '#888' : (player.stamina<25? '#ff5252':'#4caf50');
    document.getElementById('riotBar').style.width = player.riot+'%';
  }

  render(now);
  requestAnimationFrame(loop);
}

// ---------- Start / Restart ----------
function resetGame(){
  score=0; elapsed=0; gameOver=false; paused=false; photographed=0;
  upgrades = {staminaMax:100, speedMult:1, rollCost:5, photoRadiusMult:1};
  upgradeLevels = {staminaMax:0, speedMult:0, rollCost:0, photoRadiusMult:0};
  updateUpgradeHUD();
  nextUpgradeAt = 1000;
  player.pos = getSpawnPos();
  player.vel = new Vec2(0,0);
  player.facing = new Vec2(0,-1);
  player.animFrame = 'stand'; player.animPhase = 0;
  player.stamina = 100; player.exhausted=false; player.rolling=false; player.rollCooldown=0;
  player.combo=0; player.comboTimer=0; player.riot=0;
  spawnFootballPlayers();
  security = []; for(let i=0;i<baseSecurityCount;i++) spawnSecurity();
  riotNPCs = []; riotActive=false;
  confetti=[]; flashAlpha=0; goldFlashAlpha=0; screenShake=0; chants=[]; chantTimer=0;
  document.getElementById('scoreDisplay').textContent = 0;
  document.getElementById('endPanel').style.display='none';
}

function tryLockLandscape(){
  try{
    const el = document.documentElement;
    if(el.requestFullscreen){ el.requestFullscreen().catch(()=>{}); }
    if(screen.orientation && screen.orientation.lock){ screen.orientation.lock('landscape').catch(()=>{}); }
  }catch(e){ /* 部分浏览器不支持，忽略即可，已用CSS提示横屏 */ }
}

document.getElementById('restartBtn').onclick = ()=>{
  resetGame();
  showCommentary(OPENING_LINE, 3000);
};
document.getElementById('startBtn').onclick = ()=>{
  document.getElementById('startPanel').style.display='none';
  initAudio();
  tryLockLandscape();
  resetGame();
  showCommentary(OPENING_LINE, 3000);
};

requestAnimationFrame((t)=>{lastTime=t; requestAnimationFrame(loop);});

// ---------- 调试 API（供 debug.html 调用，正常游戏不使用）----------
window.GAME_DEBUG = {
  state(){ return {score, photographed, elapsed, security:security.length, players:players.length, riot:Math.round(player.riot), gameOver, paused, godMode, timeScale, zoom:+ZOOM.toFixed(2), nextUpgradeAt}; },
  start(){ document.getElementById('startPanel').style.display='none'; initAudio(); resetGame(); showCommentary(OPENING_LINE, 3000); },
  resetGame(){ resetGame(); },
  setGod(v){ godMode = !!v; return godMode; },
  toggleGod(){ godMode = !godMode; return godMode; },
  setTimeScale(v){ timeScale = Math.max(0.05, +v||1); return timeScale; },
  setZoom(v){ ZOOM = Math.max(0.3, Math.min(1.5, +v||0.72)); return ZOOM; },
  toggleHitboxes(){ showHitboxes = !showHitboxes; return showHitboxes; },
  addScore(n){ score += (+n||1000); document.getElementById('scoreDisplay').textContent = score; checkUpgradeThreshold(); return score; },
  spawnSecurity(n, elite){ for(let i=0;i<(+n||1);i++) spawnSecurity(!!elite); return security.length; },
  clearSecurity(){ security = []; return 0; },
  spawnStar(){ players.push(makeFootballPlayer({isStar:true, atEdge:true})); },
  photographNearest(){ let best=null,bd=Infinity; for(const fp of players){ if(fp.leaving) continue; const d=Vec2.dist(fp.pos,player.pos); if(d<bd){bd=d;best=fp;} } if(best){ best.pos = player.pos.add(new Vec2(8,0)); best.chasedRecently=true; completePhoto(best); } },
  forceUpgrade(){ showUpgradePanel(); },
  triggerRiot(){ if(!riotActive) triggerRiot(); },
  refillNow(){ for(let i=0;i<MAX_PLAYERS;i++) refillPlayers(1); },
  // 可调参数读写
  getTune(){ return Object.assign({}, TUNE); },
  setTune(k, v){ if(k in TUNE){ TUNE[k] = +v; } return TUNE[k]; },
  // 手动推进模拟若干帧（用于无 rAF 环境下测试逻辑）
  step(n){ for(let i=0;i<(n||1);i++){ updatePlayer(1); updateFootballPlayers(1); refillPlayers(1); updateSecurity(1); updateRiot(1); } camera.x=player.pos.x-(canvas.width/ZOOM)/2; camera.y=player.pos.y-(canvas.height/ZOOM)/2; },
  renderOnce(){ camera.x=player.pos.x-(canvas.width/ZOOM)/2; camera.y=player.pos.y-(canvas.height/ZOOM)/2; render(performance.now()); },
  // 在主角附近放置一个球员用于测试
  spawnPlayerNear(dx, dy, isStar){ const fp = makeFootballPlayer({isStar:!!isStar}); fp.pos = player.pos.add(new Vec2(dx||60, dy||0)); players.push(fp); return {id:fp.id, isStar:fp.isStar, stamina:fp.stamina}; },
  movePlayerTo(x, y){ player.pos = new Vec2(x, y); player.vel = new Vec2(0,0); return {x:player.pos.x, y:player.pos.y}; },
  chaseNearest(dist){ let best=null,bd=Infinity; for(const fp of players){ if(fp.leaving)continue; const d=Vec2.dist(fp.pos,player.pos); if(d<bd){bd=d;best=fp;} } if(best){ const back=best.vel.len()>0.1?best.vel.norm():new Vec2(1,0); player.pos = best.pos.sub(back.scale(dist||60)); } },
  inspectNearest(){ let best=null,bd=Infinity; for(const fp of players){ if(fp.leaving)continue; const d=Vec2.dist(fp.pos,player.pos); if(d<bd){bd=d;best=fp;} } if(!best) return null; return {isStar:best.isStar, dist:+bd.toFixed(1), fleeing:best.fleeing, stamina:+best.stamina.toFixed(1), exhausted:best.fbExhausted, vel:+best.vel.len().toFixed(2), beingPhotographed:best.beingPhotographed}; }
};

})();
