// Screenshot staging for Biscuit's Great Escape.
// Each scene plays the REAL rules forward from a fresh world with a fixed
// seed, steered by a simple autopilot, and renders one frame — so every
// screenshot is what a short game really looks like, and the same seed
// always gives the same scene.
//
//   ?shot=start  — title screen after a few seconds of ambient motion
//   ?shot=play   — mid-run with the HUD, dodging well
//   ?shot=chase  — mid-run with one life left and the farmer right behind
//   ?shot=end    — caught by Old Bram (end screen with restart)
import {
  VIEW_W, VIEW_H, GROUND_Y, STEP,
  createWorld, stepWorld, renderWorld, resetWorld,
  SCREEN_TITLE, SCREEN_PLAY, SCREEN_OVER,
} from './main.js';

const SAMPLE = STEP;

function nearestObstacle(world) {
  let best = null;
  for (const ob of world.obstacles) {
    if (ob.x + ob.w < world.turkey.x - 10) continue;
    if (!best || ob.x < best.x) best = ob;
  }
  return best;
}

// Jump the ground obstacles in time, duck the swinging knives.
// Timing is by time-to-impact so it holds at every speed: jump when the
// obstacle is ~0.5 s away (near the apex while crossing it), second flap
// only while descending just before it.
function goodPilot(world) {
  const t = world.turkey;
  const ob = nearestObstacle(world);
  if (!ob) return { jump: false, duck: false };
  const gap = ob.x - (t.x + t.w);
  const tti = gap / Math.max(1, world.speed);
  if (ob.kind === 'knife') {
    // Keep ducking until the whole swinging blade has passed overhead.
    if (tti < 0.55 && gap > -110 && t.y >= GROUND_Y - t.h - 1) return { jump: false, duck: true };
    return { jump: false, duck: false };
  }
  if (t.y >= GROUND_Y - t.h - 1) {
    if (tti < 0.42 && tti > -0.05) return { jump: true, duck: false };
  } else if (world.flapCount < 2 && t.vy > 150 && gap < 90 && gap > -140) {
    // Second flap while descending over (or just past) the obstacle.
    return { jump: true, duck: false };
  }
  return { jump: false, duck: false };
}

// Brave against everything except the knives: runs straight into every
// carving knife, so the farmer closes in and only one life is left.
function chasePilot(world) {
  const t = world.turkey;
  const ob = nearestObstacle(world);
  if (!ob) return { jump: false, duck: false };
  if (ob.kind === 'knife') return { jump: false, duck: false };
  const gap = ob.x - (t.x + t.w);
  const tti = gap / Math.max(1, world.speed);
  if (t.y >= GROUND_Y - t.h - 1) {
    if (tti < 0.42 && tti > -0.05) return { jump: true, duck: false };
  } else if (world.flapCount < 2 && t.vy > 150 && gap < 90 && gap > -140) {
    return { jump: true, duck: false };
  }
  return { jump: false, duck: false };
}

// Never jumps, never ducks: caught after three stumbles, like a hurried player.
function doomedPilot() {
  return { jump: false, duck: false };
}

export function stageShot(name, seed = 1) {
  const world = createWorld(seed);
  if (name === 'start') {
    for (let i = 0; i < 5 / STEP; i++) stepWorld(world, STEP, { jump: false, duck: false }, null);
    world.screen = SCREEN_TITLE;
    return { world, screen: SCREEN_TITLE };
  }
  resetWorld(world);
  const pilot = name === 'end' ? doomedPilot : name === 'chase' ? chasePilot : goodPilot;
  const seconds = name === 'play' ? 40 : name === 'chase' ? 26 : 600;
  for (let i = 0; i < seconds / STEP; i++) {
    stepWorld(world, STEP, pilot(world), null);
    if (world.screen === SCREEN_OVER) break;
    if (name === 'chase' && world.lives <= 1 && world.time > 14) {
      // Let the farmer close in on the turkey before freezing the frame.
      let extra = 0;
      while (world.farmer.x < 120 && extra < 2.5 && world.screen === SCREEN_PLAY) {
        stepWorld(world, STEP, goodPilot(world), null);
        extra += STEP;
      }
      break;
    }
    // Play scene: catch the turkey mid-flap over a tall obstacle, with
    // the obstacle right underneath it — the most readable action frame.
    if (name === 'play' && world.time > 12 && world.turkey.y < 300) {
      const under = world.obstacles.some((ob) =>
        (ob.kind === 'oven' || ob.kind === 'hay' || ob.kind === 'fence') &&
        ob.x < world.turkey.x + world.turkey.w && ob.x + ob.w > world.turkey.x);
      if (under) break;
    }
  }
  return { world, screen: world.screen };
}

export function stageAndRender(canvas, name, seed = 1) {
  const ctx = canvas.getContext('2d');
  const { world, screen } = stageShot(name, seed);
  // Draw a couple of ambient frames so leaves/clouds settle naturally.
  renderWorld(ctx, world);
  if (typeof document !== 'undefined') {
    document.title = `shot-ready:${screen}:${Math.floor(world.score)}:${world.lives}:${Math.floor(world.distance)}`;
  }
  if (typeof window !== 'undefined') {
    window.__shotReady = true;
    window.__shotWorld = world;
  }
  return { world, screen };
}
