// Biscuit's Great Escape — a Thanksgiving turkey breakout.
// An original side-scrolling runner written for turkey-run-game-01.
// Biscuit the turkey flees Old Bram's farm before Thanksgiving dinner:
// flap-jump the ovens, hay bales and fences, duck the swinging carving
// knives, grab corn on the way, and reach the Freedom Gate at 1500 m.
// No libraries, no network, no external assets: canvas shapes + WebAudio
// synth only. Desktop Chrome, keyboard + mouse.

export const VIEW_W = 1280;
export const VIEW_H = 480;
export const GROUND_Y = 400;
export const GOAL_M = 1500;
export const STEP = 1 / 60;

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_OVER = 'over';

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) so screenshot scenes replay exactly.
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tiny WebAudio synth: every sound is generated, nothing is loaded.
// ---------------------------------------------------------------------------
export function createAudio() {
  const api = {
    enabled: true, ctx: null, master: null,
    ensure() {
      if (this.ctx || typeof window === 'undefined') return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(this.ctx.destination);
      } catch { this.ctx = null; }
    },
    resume() { this.ensure(); if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); },
    tone(freq0, freq1, dur, type, vol, when = 0) {
      if (!this.enabled || !this.ctx) return;
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq0, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    },
    noise(dur, vol, low = 400) {
      if (!this.enabled || !this.ctx) return;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = low;
      const g = this.ctx.createGain(); g.gain.value = vol;
      src.connect(filt); filt.connect(g); g.connect(this.master);
      src.start();
    },
    gobble() {
      // A turkey gobble: a burst of fast descending clucks.
      for (let i = 0; i < 5; i++) this.tone(420 - i * 55, 180, 0.07, 'square', 0.5, i * 0.07);
      this.tone(300, 140, 0.12, 'sawtooth', 0.25, 0.36);
    },
    flap() { this.noise(0.12, 0.5, 900); this.tone(300, 520, 0.1, 'sine', 0.25); },
    pickup() { this.tone(880, 880, 0.07, 'sine', 0.5); this.tone(1318, 1318, 0.1, 'sine', 0.5, 0.07); },
    feather() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.12, 'triangle', 0.45, i * 0.08)); },
    thud() { this.noise(0.22, 0.8, 300); this.tone(160, 55, 0.25, 'sawtooth', 0.6); },
    win() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.5, i * 0.12)); },
    caught() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.94, 0.3, 'sawtooth', 0.4, i * 0.18)); },
    click() { this.tone(660, 520, 0.06, 'sine', 0.4); },
  };
  return api;
}

// ---------------------------------------------------------------------------
// World: one plain state object; step() advances it, render() draws it.
// ---------------------------------------------------------------------------
export function createWorld(seed = 1) {
  const rng = mulberry32(seed);
  return {
    seed, rng,
    screen: SCREEN_TITLE,
    time: 0,
    distance: 0,          // metres run
    score: 0,
    lives: 3,
    best: 0,
    speed: 0,             // px/s of the scrolling world
    spawnIn: 1.1,         // seconds until the next obstacle
    pickupIn: 2.2,
    shake: 0,
    flash: 0,
    overReason: null,     // 'caught' | 'escaped'
    overAt: 0,
    won: false,
    paused: false,
    muted: false,
    shield: false,
    flapCount: 0,         // 0 = grounded, 1 = one flap used, 2 = double flap used
    turkey: { x: 220, y: GROUND_Y - 62, vy: 0, w: 62, h: 62, duck: false, runPhase: 0, blink: 0 },
    farmer: { x: -260, lunge: 0 },
    obstacles: [],        // {kind,x,y,w,h,phase,hit}
    pickups: [],          // {kind,x,y,taken}
    particles: [],        // {x,y,vx,vy,life,maxLife,size,color,grav}
    clouds: Array.from({ length: 7 }, (_, i) => ({ x: rng() * VIEW_W, y: 30 + rng() * 110, s: 0.6 + rng() * 0.9, v: 6 + rng() * 10 })),
    leaves: Array.from({ length: 26 }, () => ({ x: rng() * VIEW_W, y: rng() * VIEW_H, vy: 12 + rng() * 22, ph: rng() * 6.28, c: ['#d97b2f', '#c94f2e', '#e8a13a', '#8a5a2b'][Math.floor(rng() * 4)] })),
    banner: 0,            // seconds left of the "1000 m — almost there!" banner
    events: 0,            // bitmask of what happened this step (for shots / tests)
  };
}

export const EVENT_HIT = 1;
export const EVENT_OVER = 2;
export const EVENT_PICKUP = 4;
export const EVENT_ESCAPED = 8;

const OBSTACLE_DEFS = {
  oven:   { w: 96, h: 104, score: 15 },
  knife:  { w: 34, h: 150, score: 20 },
  hay:    { w: 78, h: 72,  score: 10 },
  fence:  { w: 64, h: 66,  score: 10 },
  pumpkin:{ w: 58, h: 52,  score: 15 },
};

function spawnObstacle(world) {
  const r = world.rng();
  const kind = r < 0.24 ? 'oven' : r < 0.48 ? 'knife' : r < 0.66 ? 'hay' : r < 0.84 ? 'fence' : 'pumpkin';
  const def = OBSTACLE_DEFS[kind];
  const x = VIEW_W + 60 + world.rng() * 120;
  if (kind === 'knife') {
    // A carving knife swings from a wooden frame: its blade hangs at head
    // height, so the turkey must duck under it (jumping into it hurts).
    world.obstacles.push({ kind, x, y: GROUND_Y - def.h, w: def.w, h: def.h, phase: world.rng() * 6.28, hit: false });
  } else if (kind === 'pumpkin') {
    world.obstacles.push({ kind, x, y: GROUND_Y - def.h, w: def.w, h: def.h, phase: world.rng() * 6.28, hit: false, roll: 0 });
  } else {
    world.obstacles.push({ kind, x, y: GROUND_Y - def.h, w: def.w, h: def.h, phase: world.rng() * 6.28, hit: false });
  }
  // Never stack two tall obstacles so close that both are unjumpable.
  world.spawnIn = Math.max(1.0, 1.7 - world.distance / 2200) * (0.85 + world.rng() * 0.5);
}

function spawnPickup(world) {
  const r = world.rng();
  const kind = r < 0.72 ? 'corn' : r < 0.9 ? 'cranberry' : 'feather';
  const y = kind === 'feather' ? GROUND_Y - 150 - world.rng() * 60 : GROUND_Y - 46 - world.rng() * 90;
  world.pickups.push({ kind, x: VIEW_W + 40, y, taken: false, bob: world.rng() * 6.28 });
  world.pickupIn = 1.6 + world.rng() * 2.2;
}

function burst(world, x, y, n, color, speed = 160) {
  for (let i = 0; i < n; i++) {
    const a = world.rng() * 6.283, v = speed * (0.3 + world.rng() * 0.7);
    world.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
      life: 0.5 + world.rng() * 0.5, maxLife: 1, size: 2 + world.rng() * 4,
      color, grav: 320,
    });
  }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function turkeyBox(world) {
  const t = world.turkey;
  if (t.duck) return { x: t.x + 4, y: t.y + 26, w: t.w - 6, h: t.h - 26 };
  return { x: t.x + 6, y: t.y + 4, w: t.w - 12, h: t.h - 4 };
}

function obstacleBox(ob) {
  if (ob.kind === 'knife') {
    // Only the blade matters: the frame post above it is decoration.
    // The blade hangs low enough to catch a standing turkey but high
    // enough that a ducking turkey slips under it.
    return { x: ob.x + 8, y: ob.y + 50, w: ob.w - 16, h: 56 };
  }
  if (ob.kind === 'oven') return { x: ob.x + 6, y: ob.y + 8, w: ob.w - 12, h: ob.h - 8 };
  if (ob.kind === 'pumpkin') return { x: ob.x + 6, y: ob.y + 8, w: ob.w - 12, h: ob.h - 8 };
  return { x: ob.x + 4, y: ob.y + 4, w: ob.w - 8, h: ob.h - 4 };
}

export function resetWorld(world) {
  const fresh = createWorld(world.seed);
  fresh.best = world.best;
  Object.keys(fresh).forEach((k) => { world[k] = fresh[k]; });
  world.screen = SCREEN_PLAY;
  world.speed = 250;
}

export function startRun(world, audio) {
  resetWorld(world);
  if (audio) { audio.resume(); audio.gobble(); }
}

// input: {jump:boolean (edge), duck:boolean (held), }
// audio: the synth api, or null in headless staging.
export function stepWorld(world, dt, input, audio) {
  let events = 0;
  world.time += dt;
  if (world.flash > 0) world.flash = Math.max(0, world.flash - dt * 2.2);
  if (world.shake > 0) world.shake = Math.max(0, world.shake - dt * 26);
  if (world.banner > 0) world.banner -= dt;

  // Ambient motion always runs, even on the title screen.
  for (const c of world.clouds) { c.x -= c.v * dt; if (c.x < -160) { c.x = VIEW_W + 40; c.y = 30 + world.rng() * 110; } }
  for (const l of world.leaves) {
    l.y += l.vy * dt; l.x += Math.sin(world.time * 1.4 + l.ph) * 22 * dt; l.ph += dt;
    if (l.y > VIEW_H) { l.y = -8; l.x = world.rng() * VIEW_W; }
  }
  for (let i = world.particles.length - 1; i >= 0; i--) {
    const p = world.particles[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
    if (p.life <= 0 || p.y > VIEW_H + 10) world.particles.splice(i, 1);
  }

  if (world.screen !== SCREEN_PLAY || world.paused) return events;

  const t = world.turkey;
  // Speed ramps with distance: 250 -> ~560 px/s by the Freedom Gate.
  world.speed = Math.min(560, 250 + world.distance * 0.21);
  world.distance += (world.speed * dt) / 14; // ~14 px per metre
  world.score += world.speed * dt * 0.06;

  // Milestone banners.
  if (world.distance >= 1000 && world.banner <= 0 && !world.bannerShown1000) { world.banner = 2.4; world.bannerShown1000 = true; }
  if (world.distance >= 500 && !world.bannerShown500) { world.banner = 2.0; world.bannerShown500 = true; }

  // Jump / double-flap.
  if (input.jump) {
    if (t.y >= GROUND_Y - t.h - 1) { t.vy = -700; world.flapCount = 1; if (audio) audio.flap(); burst(world, t.x + 10, t.y + t.h - 4, 6, '#e8dcc8', 90); }
    else if (world.flapCount < 2) { t.vy = -560; world.flapCount = 2; if (audio) audio.flap(); burst(world, t.x + 10, t.y + t.h - 4, 8, '#ffffff', 110); }
  }
  t.vy += 1400 * dt;
  t.y += t.vy * dt;
  if (t.y >= GROUND_Y - t.h) { t.y = GROUND_Y - t.h; t.vy = 0; world.flapCount = 0; }
  if (t.y < 30) { t.y = 30; t.vy = Math.max(0, t.vy); }
  t.duck = !!input.duck && t.y >= GROUND_Y - t.h - 1;
  t.runPhase += dt * (world.speed / 34);
  t.blink = (t.blink + dt) % 3.4;

  // The farmer closes in whenever the turkey stumbles; he hangs back a
  // little while the turkey runs clean. His x is purely visual tension:
  // lives decide when the run ends. 3 lives: lurking off-screen left;
  // 2 lives: visible at the edge; 1 life: right on the turkey's tail.
  const targetFarmerX = 140 - (world.lives - 1) * 90 + world.farmer.lunge;
  world.farmer.x += (targetFarmerX - world.farmer.x) * Math.min(1, dt * 3.5);
  world.farmer.lunge = Math.max(0, world.farmer.lunge - dt * 60);

  // Spawning.
  world.spawnIn -= dt;
  if (world.spawnIn <= 0) spawnObstacle(world);
  world.pickupIn -= dt;
  if (world.pickupIn <= 0) spawnPickup(world);

  // Move obstacles / pickups with the world.
  for (const ob of world.obstacles) {
    ob.x -= world.speed * dt;
    if (ob.kind === 'pumpkin') { ob.roll += dt * 9; ob.x -= 60 * dt; }
    if (ob.kind === 'knife') ob.phase += dt * 2.4;
  }
  for (const p of world.pickups) { p.x -= world.speed * dt; p.bob += dt * 3; }

  // Pickups.
  const tb = turkeyBox(world);
  for (const p of world.pickups) {
    if (p.taken || p.x < -40) continue;
    const box = { x: p.x - 14, y: p.y - 14 + Math.sin(p.bob) * 4, w: 28, h: 28 };
    if (rectsOverlap(tb, box)) {
      p.taken = true; events |= EVENT_PICKUP;
      if (p.kind === 'corn') { world.score += 10; if (audio) audio.pickup(); burst(world, p.x, p.y, 8, '#f2c230', 120); }
      else if (p.kind === 'cranberry') { world.score += 25; if (audio) audio.pickup(); burst(world, p.x, p.y, 10, '#b3233a', 130); }
      else { world.shield = true; world.score += 50; if (audio) audio.feather(); burst(world, p.x, p.y, 14, '#ffd76a', 150); }
    }
  }

  // Obstacle collisions.
  for (const ob of world.obstacles) {
    if (ob.hit || ob.x < -160) continue;
    // The swinging knife's blade sweeps sideways; use its swung position.
    let box = obstacleBox(ob);
    if (ob.kind === 'knife') {
      const swing = Math.sin(ob.phase) * 26;
      box = { x: box.x + swing, y: box.y, w: box.w, h: box.h };
    }
    if (rectsOverlap(tb, box)) {
      ob.hit = true; events |= EVENT_HIT;
      if (world.shield) {
        world.shield = false; world.flash = 0.6;
        if (audio) audio.thud();
        burst(world, t.x + 30, t.y + 20, 16, '#ffd76a', 200);
      } else {
        world.lives -= 1; world.shake = 14; world.flash = 0.8; world.farmer.lunge = 90;
        if (audio) audio.thud();
        burst(world, t.x + 30, t.y + 30, 18, '#ffffff', 220);
        burst(world, t.x + 30, t.y + 30, 10, '#8a5a2b', 160);
        if (world.lives <= 0) {
          world.screen = SCREEN_OVER; world.overReason = 'caught'; world.overAt = world.time;
          events |= EVENT_OVER;
          if (audio) audio.caught();
          if (world.score > world.best) world.best = Math.floor(world.score);
        }
      }
    }
  }

  // Clean up off-screen entities.
  world.obstacles = world.obstacles.filter((o) => o.x > -180);
  world.pickups = world.pickups.filter((p) => p.x > -60 && !p.taken);

  // Escape!
  if (world.distance >= GOAL_M) {
    world.screen = SCREEN_OVER; world.overReason = 'escaped'; world.overAt = world.time; world.won = true;
    events |= EVENT_OVER | EVENT_ESCAPED;
    world.score += 500;
    if (world.score > world.best) world.best = Math.floor(world.score);
    if (audio) audio.win();
  }
  world.events = events;
  return events;
}

// ---------------------------------------------------------------------------
// Rendering — all art is drawn with canvas paths, nothing is loaded.
// ---------------------------------------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTurkey(ctx, x, y, scale, phase, duck, shield) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (duck) ctx.scale(1.25, 0.62);
  const bob = Math.sin(phase * 2) * 2;
  // Tail fan.
  for (let i = -2; i <= 2; i++) {
    const a = -Math.PI / 2 + i * 0.42;
    ctx.save();
    ctx.translate(-14, -8 + bob * 0.4);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = i % 2 === 0 ? '#8a5a2b' : '#a06a35';
    ctx.beginPath(); ctx.ellipse(0, -26, 9, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c98a3f';
    ctx.beginPath(); ctx.ellipse(0, -30, 5, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // Legs (alternating while running).
  const legSwing = Math.sin(phase) * 7;
  ctx.strokeStyle = '#e8a13a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4, 22); ctx.lineTo(-4 + legSwing, 34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, 22); ctx.lineTo(8 - legSwing, 34); ctx.stroke();
  // Body.
  ctx.fillStyle = '#6e4520';
  ctx.beginPath(); ctx.ellipse(0, 0, 26, 24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath(); ctx.ellipse(-2, 2, 20, 18, 0, 0, Math.PI * 2); ctx.fill();
  // Wing.
  ctx.fillStyle = '#5a3a1c';
  ctx.beginPath(); ctx.ellipse(-4, -2, 14, 10, -0.5 + Math.sin(phase * 2) * 0.12, 0, Math.PI * 2); ctx.fill();
  // Neck + head.
  ctx.fillStyle = '#7a4a22';
  ctx.beginPath(); ctx.ellipse(20, -22, 8, 14, 0.25, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath(); ctx.arc(24, -34, 11, 0, Math.PI * 2); ctx.fill();
  // Wattle + beak.
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.ellipse(28, -26, 4, 7, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8a13a';
  ctx.beginPath(); ctx.moveTo(32, -36); ctx.lineTo(44, -32); ctx.lineTo(32, -29); ctx.closePath(); ctx.fill();
  // Eye (blinks).
  ctx.fillStyle = '#1d1208';
  ctx.beginPath(); ctx.arc(27, -37, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(28, -38, 0.9, 0, Math.PI * 2); ctx.fill();
  if (shield) {
    ctx.strokeStyle = 'rgba(255, 215, 106, 0.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -6, 46, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawFarmer(ctx, x, y, phase, lunge) {
  ctx.save();
  ctx.translate(x, y);
  const bob = Math.abs(Math.sin(phase)) * 4;
  ctx.translate(0, -bob);
  // Legs.
  const swing = Math.sin(phase) * 9;
  ctx.strokeStyle = '#2c3e6b'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6, -34); ctx.lineTo(-6 + swing, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, -34); ctx.lineTo(8 - swing, 0); ctx.stroke();
  // Body: overalls + shirt.
  ctx.fillStyle = '#b03a2e';
  ctx.beginPath(); ctx.ellipse(0, -58, 20, 20, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2c4a7a';
  roundRect(ctx, -17, -58, 34, 30, 6); ctx.fill();
  ctx.fillStyle = '#d8c9a0';
  ctx.fillRect(-17, -58, 34, 5);
  // Arms reaching forward, pitchfork in hand.
  ctx.strokeStyle = '#b03a2e'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(10, -62); ctx.lineTo(34, -46 + Math.sin(phase * 2) * 3); ctx.stroke();
  ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(30, -78); ctx.lineTo(44, -30); ctx.stroke();
  ctx.strokeStyle = '#c9c9c9'; ctx.lineWidth = 3;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.moveTo(30 + i * 6, -78); ctx.lineTo(34 + i * 6, -92); ctx.stroke();
  }
  // Head + beard + straw hat.
  ctx.fillStyle = '#e8b98a';
  ctx.beginPath(); ctx.arc(4, -88, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8e8e8';
  ctx.beginPath(); ctx.ellipse(6, -78, 10, 7, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = '#d9b64a';
  ctx.beginPath(); ctx.ellipse(4, -96, 22, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(4, -99, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
  // Angry brows.
  ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, -92); ctx.lineTo(8, -90); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(16, -92); ctx.lineTo(10, -90); ctx.stroke();
  if (lunge > 20) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('COME BACK HERE!', x + 40, y - 128);
  }
  ctx.restore();
}

function drawOven(ctx, ob, time) {
  ctx.save();
  ctx.translate(ob.x, ob.y);
  // Body.
  ctx.fillStyle = '#2b2b2b'; roundRect(ctx, 0, 0, ob.w, ob.h, 8); ctx.fill();
  ctx.fillStyle = '#3d3d3d'; roundRect(ctx, 6, 6, ob.w - 12, 26, 5); ctx.fill();
  // Fire door with glow.
  const flick = 0.75 + Math.sin(time * 9 + ob.phase) * 0.25;
  ctx.fillStyle = `rgba(255, ${Math.floor(120 + 60 * flick)}, 20, ${0.85})`;
  roundRect(ctx, 18, 52, 60, 44, 6); ctx.fill();
  ctx.fillStyle = '#1d1d1d';
  ctx.fillRect(18, 52, 60, 8);
  ctx.fillStyle = '#ff5a1f';
  ctx.beginPath(); ctx.moveTo(28, 92); ctx.quadraticCurveTo(38, 66, 48, 92); ctx.quadraticCurveTo(58, 70, 68, 92); ctx.closePath(); ctx.fill();
  // Chimney + smoke.
  ctx.fillStyle = '#1d1d1d'; ctx.fillRect(64, -26, 18, 28);
  ctx.fillStyle = 'rgba(220, 220, 220, 0.55)';
  for (let i = 0; i < 3; i++) {
    const s = ((time * 0.5 + ob.phase + i * 0.33) % 1);
    ctx.beginPath(); ctx.arc(73 + Math.sin(s * 9) * 6, -30 - s * 44, 5 + s * 9, 0, Math.PI * 2); ctx.fill();
  }
  // Warning sign.
  ctx.fillStyle = '#f2c230'; roundRect(ctx, 26, ob.h - 16, 44, 12, 3); ctx.fill();
  ctx.fillStyle = '#2b2b2b'; ctx.font = 'bold 9px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('HOT!', 48, ob.h - 7);
  ctx.restore();
}

function drawKnife(ctx, ob) {
  ctx.save();
  ctx.translate(ob.x, ob.y);
  const swing = Math.sin(ob.phase) * 26;
  // Wooden frame.
  ctx.fillStyle = '#6b4a26'; ctx.fillRect(-6, 0, 10, ob.h);
  ctx.fillStyle = '#7a5a30'; ctx.fillRect(-6, 0, ob.w + 12, 10);
  // Rope + blade, swinging. The blade hangs to y=106 (absolute 356):
  // low enough to catch a standing turkey, high enough to duck under.
  ctx.save();
  ctx.translate(ob.w / 2 + swing * 0.4, 10);
  ctx.rotate(Math.sin(ob.phase) * 0.16);
  ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 24); ctx.stroke();
  ctx.fillStyle = '#5a3a1c'; roundRect(ctx, -9, 24, 18, 20, 4); ctx.fill();
  ctx.fillStyle = '#dfe6ea';
  ctx.beginPath(); ctx.moveTo(-8, 42); ctx.lineTo(8, 42); ctx.lineTo(2, 96); ctx.lineTo(-2, 96); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b9c4cb';
  ctx.beginPath(); ctx.moveTo(-8, 42); ctx.lineTo(-2, 96); ctx.lineTo(2, 96); ctx.lineTo(8, 42); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#8f9aa1'; ctx.beginPath(); ctx.moveTo(-2, 96); ctx.lineTo(2, 96); ctx.lineTo(0, 106); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawObstacle(ctx, ob, time) {
  if (ob.kind === 'oven') { drawOven(ctx, ob, time); return; }
  if (ob.kind === 'knife') { drawKnife(ctx, ob); return; }
  ctx.save();
  ctx.translate(ob.x, ob.y);
  if (ob.kind === 'hay') {
    ctx.fillStyle = '#c98a3f';
    ctx.beginPath(); ctx.arc(ob.w / 2, ob.h / 2, ob.h / 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a06a35'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ob.w / 2, ob.h / 2, ob.h / 2 - 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(ob.w / 2, ob.h / 2, ob.h / 2 - 18, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#e8c25a'; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + ob.phase;
      ctx.beginPath(); ctx.moveTo(ob.w / 2 + Math.cos(a) * 12, ob.h / 2 + Math.sin(a) * 12);
      ctx.lineTo(ob.w / 2 + Math.cos(a) * (ob.h / 2 - 2), ob.h / 2 + Math.sin(a) * (ob.h / 2 - 2)); ctx.stroke();
    }
  } else if (ob.kind === 'fence') {
    ctx.fillStyle = '#7a5a30';
    ctx.fillRect(0, 8, 6, ob.h - 8); ctx.fillRect(ob.w - 6, 8, 6, ob.h - 8);
    ctx.fillRect(0, 14, ob.w, 9); ctx.fillRect(0, 38, ob.w, 9);
    ctx.fillStyle = '#8a6a3a';
    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(3, 0); ctx.lineTo(6, 8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(ob.w - 6, 8); ctx.lineTo(ob.w - 3, 0); ctx.lineTo(ob.w, 8); ctx.closePath(); ctx.fill();
  } else if (ob.kind === 'pumpkin') {
    ctx.save();
    ctx.translate(ob.w / 2, ob.h / 2); ctx.rotate(ob.roll);
    ctx.fillStyle = '#d97b2f';
    ctx.beginPath(); ctx.ellipse(0, 0, ob.w / 2, ob.h / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a85a1c'; ctx.lineWidth = 3;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.ellipse(i * 7, 0, 7, ob.h / 2 - 3, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#3f7a2e'; ctx.fillRect(ob.w / 2 - 3, -6, 6, 10);
  }
  ctx.restore();
}

function drawPickup(ctx, p, time) {
  const bobY = Math.sin(p.bob) * 4;
  ctx.save();
  ctx.translate(p.x, p.y + bobY);
  if (p.kind === 'corn') {
    ctx.fillStyle = '#f2c230';
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 9, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d9a41c';
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i * 6, -1, 2.4, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#3f7a2e';
    ctx.beginPath(); ctx.moveTo(-12, 4); ctx.lineTo(-20, 10); ctx.lineTo(-11, 9); ctx.closePath(); ctx.fill();
  } else if (p.kind === 'cranberry') {
    ctx.fillStyle = '#b3233a';
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d94a5e';
    ctx.beginPath(); ctx.arc(-3, -3, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3f7a2e'; ctx.fillRect(-1, -14, 3, 5);
  } else {
    // Golden feather: a shield.
    const pulse = 1 + Math.sin(time * 5 + p.bob) * 0.12;
    ctx.scale(pulse, pulse);
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.ellipse(0, 0, 8, 16, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c9962e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4, 12); ctx.lineTo(4, -14); ctx.stroke();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.ellipse(1, -6, 3, 7, 0.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawBackground(ctx, world) {
  const t = world.time;
  // Sky: dawn amber that deepens as the run goes on.
  const dusk = Math.min(1, world.distance / GOAL_M);
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, dusk < 0.5 ? '#f7b267' : '#e88a4f');
  sky.addColorStop(0.55, dusk < 0.5 ? '#f9cf8e' : '#d96a4f');
  sky.addColorStop(1, dusk < 0.5 ? '#fbe3b0' : '#7a4a5a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // Sun.
  const sunX = VIEW_W - 180, sunY = 92;
  ctx.fillStyle = 'rgba(255, 236, 170, 0.9)';
  ctx.beginPath(); ctx.arc(sunX, sunY, 44, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffdf8a';
  ctx.beginPath(); ctx.arc(sunX, sunY, 34, 0, Math.PI * 2); ctx.fill();
  // Clouds.
  ctx.fillStyle = 'rgba(255, 244, 224, 0.85)';
  for (const c of world.clouds) {
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 52 * c.s, 15 * c.s, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x + 34 * c.s, c.y + 4, 34 * c.s, 12 * c.s, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x - 36 * c.s, c.y + 5, 30 * c.s, 11 * c.s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Distant hills.
  ctx.fillStyle = '#b07a3e';
  ctx.beginPath(); ctx.moveTo(0, GROUND_Y);
  for (let x = 0; x <= VIEW_W; x += 40) ctx.lineTo(x, GROUND_Y - 52 - Math.sin(x * 0.006 + 1.2) * 26);
  ctx.lineTo(VIEW_W, GROUND_Y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#9a6a34';
  ctx.beginPath(); ctx.moveTo(0, GROUND_Y);
  for (let x = 0; x <= VIEW_W; x += 40) ctx.lineTo(x, GROUND_Y - 26 - Math.sin(x * 0.009 + 4) * 18);
  ctx.lineTo(VIEW_W, GROUND_Y); ctx.closePath(); ctx.fill();
  // Barn + windmill silhouettes, parallax-scrolled.
  const par = (world.distance * 14 * 0.25) % 1400;
  ctx.save(); ctx.globalAlpha = 0.85;
  const barnX = 900 - par;
  ctx.fillStyle = '#8a3a28';
  ctx.fillRect(barnX, GROUND_Y - 96, 130, 96);
  ctx.fillStyle = '#6e2c1e';
  ctx.beginPath(); ctx.moveTo(barnX - 10, GROUND_Y - 96); ctx.lineTo(barnX + 65, GROUND_Y - 138); ctx.lineTo(barnX + 140, GROUND_Y - 96); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f2e3c0'; ctx.fillRect(barnX + 52, GROUND_Y - 52, 26, 52);
  ctx.fillStyle = '#5a4a34'; ctx.fillRect(barnX + 12, GROUND_Y - 84, 16, 16); ctx.fillRect(barnX + 102, GROUND_Y - 84, 16, 16);
  const millX = 220 - par; if (millX < -80) { /* wraps with par */ }
  ctx.fillStyle = '#7a5a30'; ctx.fillRect(millX, GROUND_Y - 150, 26, 150);
  ctx.strokeStyle = '#5a3a1c'; ctx.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const a = t * 0.7 + (i * Math.PI) / 2;
    ctx.beginPath(); ctx.moveTo(millX + 13, GROUND_Y - 152);
    ctx.lineTo(millX + 13 + Math.cos(a) * 46, GROUND_Y - 152 + Math.sin(a) * 46); ctx.stroke();
  }
  ctx.restore();
  // Fence posts scrolling with the world.
  const fenceOff = (world.distance * 14) % 90;
  ctx.fillStyle = '#6b4a26';
  for (let x = -fenceOff; x < VIEW_W; x += 90) {
    ctx.fillRect(x, GROUND_Y - 34, 7, 34);
  }
  ctx.fillRect(0, GROUND_Y - 30, VIEW_W, 5);
  ctx.fillRect(0, GROUND_Y - 16, VIEW_W, 4);
  // Ground.
  ctx.fillStyle = '#7a5a30'; ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);
  ctx.fillStyle = '#8f6c3a'; ctx.fillRect(0, GROUND_Y, VIEW_W, 8);
  ctx.fillStyle = '#6b4a26';
  for (let x = 0; x < VIEW_W; x += 46) {
    const gx = x - ((world.distance * 14) % 46);
    ctx.fillRect(gx, GROUND_Y + 26, 18, 4);
    ctx.fillRect(gx + 8, GROUND_Y + 52, 12, 4);
  }
  // Grass tufts.
  ctx.strokeStyle = '#5d8a3a'; ctx.lineWidth = 3;
  for (let x = 0; x < VIEW_W; x += 70) {
    const gx = x - ((world.distance * 14) % 70);
    ctx.beginPath(); ctx.moveTo(gx, GROUND_Y); ctx.lineTo(gx - 4, GROUND_Y - 10); ctx.moveTo(gx + 5, GROUND_Y); ctx.lineTo(gx + 8, GROUND_Y - 12); ctx.stroke();
  }
  // Falling leaves.
  for (const l of world.leaves) {
    ctx.fillStyle = l.c;
    ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.ph);
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }
}

function drawHud(ctx, world) {
  // Top bar.
  ctx.fillStyle = 'rgba(43, 26, 18, 0.72)';
  roundRect(ctx, 12, 10, VIEW_W - 24, 52, 12); ctx.fill();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 22px "Trebuchet MS", sans-serif';
  ctx.fillText(`SCORE ${Math.floor(world.score)}`, 28, 37);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px "Trebuchet MS", sans-serif';
  ctx.fillText(`${Math.floor(world.distance)} m / ${GOAL_M} m`, 250, 37);
  // Lives as hearts.
  for (let i = 0; i < 3; i++) {
    const hx = 520 + i * 34, hy = 36;
    ctx.fillStyle = i < world.lives ? '#e84545' : 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(hx, hy + 8);
    ctx.bezierCurveTo(hx - 12, hy - 4, hx - 5, hy - 12, hx, hy - 5);
    ctx.bezierCurveTo(hx + 5, hy - 12, hx + 12, hy - 4, hx, hy + 8);
    ctx.fill();
  }
  if (world.shield) {
    ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
    ctx.fillText('SHIELD UP', 632, 37);
  }
  // Farmer-gap bar: how close Old Bram is.
  const gapFrac = (world.lives - 1) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  roundRect(ctx, 820, 24, 180, 12, 6); ctx.fill();
  ctx.fillStyle = gapFrac > 0.5 ? '#7ac74f' : gapFrac > 0 ? '#f2a230' : '#e84545';
  roundRect(ctx, 820, 24, 180 * Math.max(0.06, gapFrac), 12, 6); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.fillText('FARMER', 820, 50);
  ctx.fillText('ESCAPE', 940, 50);
  // Goal progress.
  const prog = Math.min(1, world.distance / GOAL_M);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  roundRect(ctx, 1020, 24, 180, 12, 6); ctx.fill();
  ctx.fillStyle = '#7ac74f';
  roundRect(ctx, 1020, 24, 180 * prog, 12, 6); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.fillText('FREEDOM GATE', 1020, 50);
  // Milestone banner.
  if (world.banner > 0) {
    const label = world.distance >= 1000 ? '1000 m — THE GATE IS CLOSE!' : '500 m — KEEP RUNNING, BISCUIT!';
    ctx.save();
    ctx.globalAlpha = Math.min(1, world.banner);
    ctx.fillStyle = 'rgba(43, 26, 18, 0.8)';
    roundRect(ctx, VIEW_W / 2 - 260, 84, 520, 44, 10); ctx.fill();
    ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 24px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, VIEW_W / 2, 107);
    ctx.restore();
  }
}

function drawTitle(ctx, world) {
  ctx.fillStyle = 'rgba(43, 26, 18, 0.45)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // Big title card.
  ctx.fillStyle = 'rgba(43, 26, 18, 0.82)';
  roundRect(ctx, 190, 56, 900, 368, 18); ctx.fill();
  ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 3;
  roundRect(ctx, 190, 56, 900, 368, 18); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 64px "Trebuchet MS", sans-serif';
  ctx.fillText("BISCUIT'S GREAT ESCAPE", VIEW_W / 2, 118);
  ctx.fillStyle = '#ffffff'; ctx.font = 'italic 24px "Trebuchet MS", sans-serif';
  ctx.fillText('A Thanksgiving turkey breakout', VIEW_W / 2, 160);
  ctx.fillStyle = '#e8c9a0'; ctx.font = '18px "Trebuchet MS", sans-serif';
  ctx.fillText('Old Bram has the oven hot and the carving knife out.', VIEW_W / 2, 196);
  ctx.fillText('Run 1500 m to the Freedom Gate — and never become dinner.', VIEW_W / 2, 222);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 19px "Trebuchet MS", sans-serif';
  ctx.fillText('SPACE / CLICK — flap-jump (twice in the air)      ↓ — duck under knives', VIEW_W / 2, 262);
  ctx.fillText('Corn +10 · Cranberry +25 · Golden feather = shield', VIEW_W / 2, 290);
  if (world.best > 0) {
    ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.fillText(`BEST SCORE: ${world.best}`, VIEW_W / 2, 322);
  }
  // Start button.
  const pulse = 1 + Math.sin(world.time * 4) * 0.04;
  ctx.save();
  ctx.translate(VIEW_W / 2, 372); ctx.scale(pulse, pulse);
  ctx.fillStyle = '#e84545'; roundRect(ctx, -130, -26, 260, 52, 12); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; roundRect(ctx, -130, -26, 260, 52, 12); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
  ctx.fillText('▶  START RUN', 0, 1);
  ctx.restore();
  ctx.fillStyle = '#c9a06a'; ctx.font = '14px "Trebuchet MS", sans-serif';
  ctx.fillText('An original game — drawn and sounded with code, no turkeys were harmed.', VIEW_W / 2, 442);
}

function drawOver(ctx, world) {
  const escaped = world.overReason === 'escaped';
  ctx.fillStyle = escaped ? 'rgba(20, 60, 20, 0.55)' : 'rgba(30, 8, 8, 0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = escaped ? 'rgba(24, 68, 28, 0.92)' : 'rgba(43, 16, 12, 0.92)';
  roundRect(ctx, 240, 72, 800, 336, 18); ctx.fill();
  ctx.strokeStyle = escaped ? '#7ac74f' : '#e84545'; ctx.lineWidth = 3;
  roundRect(ctx, 240, 72, 800, 336, 18); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = escaped ? '#8ae06a' : '#ff7a6a';
  ctx.font = 'bold 58px "Trebuchet MS", sans-serif';
  ctx.fillText(escaped ? 'PARDONED!' : 'CAUGHT!', VIEW_W / 2, 132);
  ctx.fillStyle = '#ffffff'; ctx.font = '22px "Trebuchet MS", sans-serif';
  ctx.fillText(
    escaped ? 'Biscuit burst through the Freedom Gate — Thanksgiving is cancelled!' : 'Old Bram got you… dinner is served. The oven was already hot.',
    VIEW_W / 2, 178,
  );
  ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 24px "Trebuchet MS", sans-serif';
  ctx.fillText(
    `SCORE ${Math.floor(world.score)}    ·    DISTANCE ${Math.floor(world.distance)} m    ·    BEST ${Math.max(world.best, Math.floor(world.score))}`,
    VIEW_W / 2, 226,
  );
  ctx.fillStyle = '#e8c9a0'; ctx.font = '18px "Trebuchet MS", sans-serif';
  ctx.fillText(escaped ? 'The farm is behind you now. Gobble freely, Biscuit.' : 'Tip: duck the swinging knives, flap twice over the ovens.', VIEW_W / 2, 262);
  const pulse = 1 + Math.sin(world.time * 4) * 0.04;
  ctx.save();
  ctx.translate(VIEW_W / 2, 322); ctx.scale(pulse, pulse);
  ctx.fillStyle = '#e84545'; roundRect(ctx, -150, -26, 300, 52, 12); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; roundRect(ctx, -150, -26, 300, 52, 12); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 24px "Trebuchet MS", sans-serif';
  ctx.fillText('↻  RUN AGAIN  (R)', 0, 1);
  ctx.restore();
  ctx.fillStyle = '#c9a06a'; ctx.font = '15px "Trebuchet MS", sans-serif';
  ctx.fillText('Press R, SPACE or click the button to run again.', VIEW_W / 2, 380);
}

export function renderWorld(ctx, world) {
  ctx.save();
  if (world.shake > 0) ctx.translate((Math.random() - 0.5) * world.shake, (Math.random() - 0.5) * world.shake);
  drawBackground(ctx, world);
  // Freedom Gate at the end of the run: fades in during the last 100 m.
  if (world.screen === SCREEN_PLAY && world.distance > GOAL_M - 120) {
    const gateX = VIEW_W - 120 + (GOAL_M - world.distance) * 2;
    ctx.save();
    ctx.fillStyle = '#7ac74f';
    ctx.fillRect(gateX, GROUND_Y - 170, 14, 170);
    ctx.fillRect(gateX + 130, GROUND_Y - 170, 14, 170);
    ctx.fillStyle = '#ffd76a';
    ctx.fillRect(gateX, GROUND_Y - 178, 158, 16);
    ctx.font = 'bold 20px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#2b1a12';
    ctx.fillText('FREEDOM', gateX + 79, GROUND_Y - 186);
    ctx.restore();
  }
  for (const p of world.pickups) if (!p.taken) drawPickup(ctx, p, world.time);
  for (const ob of world.obstacles) drawObstacle(ctx, ob, world.time);
  // The farmer chases from the left; the turkey runs ahead of him.
  if (world.screen !== SCREEN_TITLE) {
    drawFarmer(ctx, world.farmer.x, GROUND_Y, world.turkey.runPhase, world.farmer.lunge);
  }
  const t = world.turkey;
  drawTurkey(ctx, t.x + 31, t.y + 31, 1, t.runPhase, t.duck, world.shield);
  // Dust puffs while running on the ground.
  if (world.screen === SCREEN_PLAY && t.y >= GROUND_Y - t.h - 1 && Math.random() < 0.35) {
    ctx.fillStyle = 'rgba(214, 196, 160, 0.5)';
    ctx.beginPath(); ctx.arc(t.x + 6, GROUND_Y + 4, 3 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
  }
  for (const p of world.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (world.screen === SCREEN_PLAY || world.screen === SCREEN_OVER) drawHud(ctx, world);
  if (world.paused && world.screen === SCREEN_PLAY) {
    ctx.fillStyle = 'rgba(43, 26, 18, 0.6)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 48px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('PAUSED — press P to resume', VIEW_W / 2, VIEW_H / 2);
  }
  if (world.screen === SCREEN_TITLE) drawTitle(ctx, world);
  if (world.screen === SCREEN_OVER) drawOver(ctx, world);
  if (world.flash > 0) {
    ctx.fillStyle = `rgba(255, 60, 40, ${world.flash * 0.25})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Browser boot: input, loop, pause/mute, buttons. Skipped in shot staging
// (shots.js imports the pure parts above and drives the world itself).
// ---------------------------------------------------------------------------
export function bootGame(canvas) {
  const ctx = canvas.getContext('2d');
  const audio = createAudio();
  const world = createWorld(20261127);
  try { world.best = Number(window.localStorage.getItem('biscuit-best') || 0) || 0; } catch { world.best = 0; }

  const input = { jump: false, duck: false };
  const keys = new Set();
  let jumpQueued = false;

  function pressStart() {
    if (world.screen === SCREEN_TITLE) { startRun(world, audio); return; }
    if (world.screen === SCREEN_OVER) { startRun(world, audio); return; }
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      audio.resume();
      if (world.screen !== SCREEN_PLAY) pressStart();
      else jumpQueued = true;
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault(); keys.add('duck'); input.duck = true;
    } else if (e.code === 'KeyP') {
      if (world.screen === SCREEN_PLAY) world.paused = !world.paused;
    } else if (e.code === 'KeyM') {
      audio.enabled = !audio.enabled; world.muted = !audio.enabled;
    } else if (e.code === 'KeyR') {
      if (world.screen === SCREEN_OVER) startRun(world, audio);
    } else if (e.code === 'Enter') {
      if (world.screen !== SCREEN_PLAY) pressStart();
    }
  }
  function onKeyUp(e) {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { keys.delete('duck'); input.duck = keys.has('duck'); }
  }

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (VIEW_W / r.width), y: (e.clientY - r.top) * (VIEW_H / r.height) };
  }
  function onClick(e) {
    audio.resume();
    const p = canvasPos(e);
    if (world.screen === SCREEN_TITLE) {
      if (p.x > 510 && p.x < 770 && p.y > 346 && p.y < 398) { audio.click(); pressStart(); return; }
      pressStart(); return;
    }
    if (world.screen === SCREEN_OVER) {
      if (p.x > 490 && p.x < 790 && p.y > 296 && p.y < 348) { audio.click(); pressStart(); return; }
      pressStart(); return;
    }
    jumpQueued = true;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onClick);
  // The HUD pause/mute buttons live in the top bar; the canvas click above
  // also jumps, so these are keyboard-first (P / M) by design.

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!world.paused) {
      acc += dt;
      while (acc >= STEP) {
        input.jump = jumpQueued; jumpQueued = false;
        stepWorld(world, STEP, input, audio);
        input.jump = false;
        acc -= STEP;
        if (world.screen === SCREEN_OVER && world.best < Math.floor(world.score)) {
          world.best = Math.floor(world.score);
          try { window.localStorage.setItem('biscuit-best', String(world.best)); } catch { /* offline-safe */ }
        }
      }
    }
    renderWorld(ctx, world);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (typeof window !== 'undefined') window.__game = { world, audio };
  return { world, audio };
}

// Normal browser entry: start the game when this module loads in a page
// that is not staging a screenshot (?shot= is handled by shots.js).
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  const canvas = document.getElementById('game');
  if (canvas && !params.has('shot')) {
    bootGame(canvas);
  } else if (canvas && params.has('shot')) {
    import('./shots.js').then((m) => m.stageAndRender(canvas, params.get('shot') || 'start', Number(params.get('seed') || 1)));
  }
}
