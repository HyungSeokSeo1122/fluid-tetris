import { config, liveBalance, type GameMode } from '../config';
import { clearRows, findFullRows, gravity, seep, type SimResult } from '../fluid/sim';
import { COLS, ROWS, VISIBLE_TOP, createGrid, inBounds, occupiesSpawn, type Cell } from '../fluid/grid';
import { type Frame } from './input';
import {
  canDroop,
  canGroupFall,
  createActive,
  droopFully,
  droopOnce,
  fits,
  minos,
  tryRotate,
  tryShift,
  type Active,
} from './piece';
import { lineScore, mergePoints } from './scoring';
import { shuffleBag, type PieceType } from './tetrominoes';

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export type Status = 'playing' | 'paused' | 'gameover';

export type Slide = {
  x: number;
  y: number;
  sx: number;
  sy: number;
  age: number;
  dur: number;
};

export type Bit = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: number;
  radius: number;
};

export type Popup = {
  x: number;
  y: number;
  text: string;
  age: number;
  life: number;
  color: number;
};

export type Preview = { type: PieceType; color: number };

export type GameEvent =
  | { type: 'move' }
  | { type: 'rotate' }
  | { type: 'lock' }
  | { type: 'hard' }
  | { type: 'merge'; score: number; chain: number }
  | { type: 'clear'; rows: number; score: number }
  | { type: 'phase'; mode: GameMode }
  | { type: 'gameover' };

export type GameState = {
  grid: Cell[][];
  active: Active | null;
  next: Preview;
  bag: PieceType[];
  score: number;
  best: number;
  lines: number;
  chain: number;
  chainLeft: number;
  mode: GameMode;
  status: Status;
  fallAcc: number;
  oozeAcc: number;
  gravAcc: number;
  seepAcc: number;
  lockAcc: number;
  lockResets: number;
  seepBias: boolean;
  fallVisual: number;
  shake: number;
  banner: string;
  bannerLeft: number;
  slides: Slide[];
  bits: Bit[];
  popups: Popup[];
  pending: { rows: number[]; age: number } | null;
  clearPulse: number;
  time: number;
};

function pullType(bag: PieceType[]): PieceType {
  if (bag.length === 0) bag.push(...shuffleBag());
  const next = bag.pop();
  if (!next) return 'T';
  return next;
}

function pullColor(pool: number): number {
  const size = Math.max(1, Math.min(pool, config.colors.length));
  return Math.floor(Math.random() * size);
}

function raiseBest(state: GameState): void {
  if (state.score > state.best) state.best = state.score;
}

export function createGame(best = 0): GameState {
  const bag: PieceType[] = [];
  const early = liveBalance('early');
  return {
    grid: createGrid(),
    active: createActive(pullType(bag), pullColor(early.colorPoolSize)),
    next: { type: pullType(bag), color: pullColor(early.colorPoolSize) },
    bag,
    score: 0,
    best,
    lines: 0,
    chain: 0,
    chainLeft: 0,
    mode: 'early',
    status: 'playing',
    fallAcc: 0,
    oozeAcc: 0,
    gravAcc: 0,
    seepAcc: 0,
    lockAcc: 0,
    lockResets: 0,
    seepBias: false,
    fallVisual: 0,
    shake: 0,
    banner: '',
    bannerLeft: 0,
    slides: [],
    bits: [],
    popups: [],
    pending: null,
    clearPulse: 0,
    time: 0,
  };
}

function activeBlocked(active: Active | null): Set<string> {
  const blocked = new Set<string>();
  if (!active) return blocked;
  for (const cell of minos(active)) {
    if (inBounds(cell.x, cell.y)) blocked.add(`${cell.x},${cell.y}`);
  }
  return blocked;
}

function spawnBurst(state: GameState, x: number, y: number, color: number, count: number, speed: number): void {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const mag = speed * (0.35 + Math.random());
    state.bits.push({
      x,
      y,
      vx: Math.cos(angle) * mag,
      vy: Math.sin(angle) * mag - speed * 0.4,
      age: 0,
      life: 0.4 + Math.random() * 0.35,
      color,
      radius: 0.1 + Math.random() * 0.12,
    });
  }
  if (state.bits.length > 280) state.bits.splice(0, state.bits.length - 280);
}

function addChain(state: GameState, events: GameEvent[]): void {
  state.chain = state.chain <= 0 ? 1 : state.chain + 1;
  state.chainLeft = config.scoring.chainWindow;
  const bonus = mergePoints(state.chain);
  state.score += bonus;
  raiseBest(state);
  events.push({ type: 'merge', score: bonus, chain: state.chain });
}

function refreshMode(state: GameState): GameEvent | null {
  const next: GameMode = state.lines >= config.midGame.afterLines ? 'mid' : 'early';
  if (next === state.mode) return null;
  state.mode = next;
  state.banner = next === 'mid' ? 'Mid game — thinner liquid' : 'Early flow';
  state.bannerLeft = 2.6;
  return { type: 'phase', mode: next };
}

function beginClear(state: GameState, rows: number[], events: GameEvent[]): void {
  if (rows.length === 0 || state.pending) return;
  const gained = lineScore(rows.length, state.chain);
  state.score += gained;
  state.lines += rows.length;
  raiseBest(state);
  state.pending = { rows: [...rows], age: 0 };
  state.clearPulse = 1;
  state.shake = Math.min(1, 0.22 + rows.length * 0.2);
  const mid = rows[Math.floor(rows.length / 2)] ?? rows[0] ?? VISIBLE_TOP;
  const popupColor = state.grid[mid]?.[0]?.color ?? 0;
  state.popups.push({
    x: COLS / 2,
    y: mid,
    text: rows.length >= 2 ? `+${gained}  ×${rows.length}` : `+${gained}`,
    age: 0,
    life: 0.95,
    color: popupColor,
  });
  if (state.popups.length > 8) state.popups.splice(0, state.popups.length - 8);
  for (const y of rows) {
    for (let x = 0; x < COLS; x += 1) {
      const cell = state.grid[y]?.[x];
      if (!cell || cell.color < 0) continue;
      cell.glow = 1;
      spawnBurst(state, x + 0.5, y + 0.5, cell.color, 4, 6.5);
    }
  }
  events.push({ type: 'clear', rows: rows.length, score: gained });
  const phase = refreshMode(state);
  if (phase) events.push(phase);
}

function endGame(state: GameState, events: GameEvent[]): void {
  if (state.status === 'gameover') return;
  state.status = 'gameover';
  state.active = null;
  state.fallVisual = 0;
  events.push({ type: 'gameover' });
}

function writePiece(state: GameState, active: Active, events: GameEvent[]): boolean {
  const cells = minos(active);
  const pieceKeys = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
  let topped = false;
  let merged = false;
  for (const cell of cells) {
    if (cell.y < VISIBLE_TOP) topped = true;
    if (!inBounds(cell.x, cell.y)) continue;
    state.grid[cell.y][cell.x] = { color: active.color, glow: 0 };
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!inBounds(nx, ny) || pieceKeys.has(`${nx},${ny}`)) continue;
      if (state.grid[ny][nx].color === active.color) merged = true;
    }
  }
  if (merged) {
    for (const cell of cells) {
      if (!inBounds(cell.x, cell.y)) continue;
      state.grid[cell.y][cell.x].glow = 1;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (!inBounds(nx, ny)) continue;
        if (state.grid[ny][nx].color === active.color) {
          state.grid[ny][nx].glow = 1;
        }
      }
    }
    addChain(state, events);
  }
  return topped;
}

function spawnNext(state: GameState): void {
  const balance = liveBalance(state.mode);
  const spawned = createActive(state.next.type, state.next.color);
  state.next = {
    type: pullType(state.bag),
    color: pullColor(balance.colorPoolSize),
  };
  state.active = spawned;
}

function lockPiece(state: GameState, events: GameEvent[], hard: boolean): void {
  const active = state.active;
  if (!active) return;
  const topped = writePiece(state, active, events);
  const landed = minos(active);
  for (const cell of landed) {
    spawnBurst(state, cell.x + 0.5, cell.y + 0.5, active.color, hard ? 3 : 2, hard ? 4.5 : 2.2);
  }
  state.active = null;
  state.lockAcc = 0;
  state.lockResets = 0;
  state.fallAcc = 0;
  state.oozeAcc = 0;
  state.fallVisual = 0;
  events.push({ type: 'lock' });
  const rows = findFullRows(state.grid);
  if (rows.length > 0) beginClear(state, rows, events);
  if (topped || occupiesSpawn(state.grid)) {
    endGame(state, events);
    return;
  }
  spawnNext(state);
  if (!state.active || !fits(state.grid, state.active)) {
    state.active = null;
    endGame(state, events);
  }
}

function noteLockReset(state: GameState): void {
  if (state.lockAcc <= 0) return;
  if (state.lockResets >= config.tuning.maxLockResets) return;
  state.lockAcc = 0;
  state.lockResets += 1;
}

function hardDrop(state: GameState, events: GameEvent[]): void {
  const active = state.active;
  if (!active) return;
  let dropped = 0;
  while (canGroupFall(state.grid, active)) {
    active.y += 1;
    dropped += 1;
  }
  droopFully(state.grid, active);
  if (dropped > 0) state.score += dropped * config.scoring.hardDropPoint;
  raiseBest(state);
  events.push({ type: 'hard' });
  lockPiece(state, events, true);
}

function fallAndOoze(state: GameState, soft: boolean, dt: number, events: GameEvent[]): void {
  const active = state.active;
  if (!active) return;
  const balance = liveBalance(state.mode);
  const speed = Math.max(0.05, balance.fallSpeed);
  const interval = 1 / speed / (soft ? config.tuning.softDropFactor : 1);
  state.fallAcc += dt;
  while (state.active && state.fallAcc >= interval && canGroupFall(state.grid, state.active)) {
    state.fallAcc -= interval;
    state.active.y += 1;
    state.lockAcc = 0;
    if (soft) state.score += config.scoring.softDropPoint;
  }
  if (state.active && canGroupFall(state.grid, state.active)) {
    state.fallVisual = Math.max(0, Math.min(1, state.fallAcc / interval));
    state.oozeAcc = 0;
    state.lockAcc = 0;
    return;
  }
  state.fallVisual = 0;
  if (!state.active) return;
  const oozeEvery = Math.max(0.05, balance.viscosity * config.tuning.oozeViscosityScale);
  state.oozeAcc += dt;
  if (state.oozeAcc >= oozeEvery) {
    state.oozeAcc = 0;
    if (droopOnce(state.grid, state.active)) state.lockAcc = 0;
  }
  if (!state.active) return;
  if (canGroupFall(state.grid, state.active) || canDroop(state.grid, state.active)) {
    state.lockAcc = 0;
    return;
  }
  state.lockAcc += dt;
  if (state.lockAcc >= config.tuning.lockDelay) lockPiece(state, events, false);
}

function absorb(state: GameState, result: SimResult, events: GameEvent[]): void {
  for (const move of result.moves) {
    state.slides = state.slides.filter((slide) => slide.x !== move.nx || slide.y !== move.ny);
    state.slides.push({
      x: move.nx,
      y: move.ny,
      sx: move.x,
      sy: move.y,
      age: 0,
      dur: config.tuning.slideDuration,
    });
  }
  if (state.slides.length > 100) state.slides.splice(0, state.slides.length - 100);
  if (result.merged) addChain(state, events);
}

function fluidStep(state: GameState, dt: number, events: GameEvent[]): void {
  if (state.pending) {
    state.pending.age += dt;
    if (state.pending.age < config.tuning.clearFlash) return;
    clearRows(state.grid, state.pending.rows);
    state.pending = null;
  }
  if (state.status !== 'playing') return;

  const ready = findFullRows(state.grid);
  if (ready.length > 0) {
    beginClear(state, ready, events);
    return;
  }

  const balance = liveBalance(state.mode);
  const blocked = activeBlocked(state.active);
  const frozen = new Set<number>();
  const seepEvery = config.tuning.seepBase + balance.viscosity * config.tuning.seepViscosityScale;
  state.gravAcc += dt;
  state.seepAcc += dt;

  if (state.gravAcc >= config.tuning.gravityInterval) {
    state.gravAcc = 0;
    absorb(state, gravity(state.grid, blocked, frozen), events);
  } else if (state.seepAcc >= seepEvery) {
    state.seepAcc = 0;
    absorb(state, seep(state.grid, blocked, frozen, state.seepBias), events);
    state.seepBias = !state.seepBias;
  }

  if (state.pending) return;
  const rows = findFullRows(state.grid);
  if (rows.length > 0) beginClear(state, rows, events);
  if (occupiesSpawn(state.grid)) endGame(state, events);
}

function decay(state: GameState, dt: number): void {
  state.shake = Math.max(0, state.shake - dt * 2.1);
  state.clearPulse = Math.max(0, state.clearPulse - dt * 3.2);
  state.bannerLeft = Math.max(0, state.bannerLeft - dt);
  if (state.bannerLeft <= 0) state.banner = '';
  if (state.chain > 0) {
    state.chainLeft -= dt;
    if (state.chainLeft <= 0) {
      state.chain = 0;
      state.chainLeft = 0;
    }
  }
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const cell = state.grid[y][x];
      if (cell.glow > 0) cell.glow = Math.max(0, cell.glow - dt * 1.7);
    }
  }
  for (const bit of state.bits) {
    bit.age += dt;
    bit.vy += 16 * dt;
    bit.x += bit.vx * dt;
    bit.y += bit.vy * dt;
  }
  state.bits = state.bits.filter((bit) => bit.age < bit.life);
  for (const popup of state.popups) popup.age += dt;
  state.popups = state.popups.filter((popup) => popup.age < popup.life);
  for (const slide of state.slides) slide.age += dt;
  state.slides = state.slides.filter((slide) => slide.age < slide.dur);
}

function stepPlay(state: GameState, frame: Frame, dt: number, events: GameEvent[]): void {
  if (!state.active) return;
  if (frame.shifts > 0 && frame.dir !== 0) {
    for (let i = 0; i < frame.shifts; i += 1) {
      if (!state.active) break;
      if (tryShift(state.grid, state.active, frame.dir)) {
        events.push({ type: 'move' });
        noteLockReset(state);
      }
    }
  }
  if (frame.rotate !== 0 && state.active && tryRotate(state.grid, state.active, frame.rotate)) {
    events.push({ type: 'rotate' });
    noteLockReset(state);
  }
  if (frame.hard && state.active) hardDrop(state, events);
  else fallAndOoze(state, frame.soft, dt, events);
  if (state.status === 'playing') fluidStep(state, dt, events);
}

export function updateGame(state: GameState, frame: Frame, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  const step = Math.max(0, Math.min(dt, 0.05));
  state.time += step;
  if (frame.pausePressed) {
    if (state.status === 'playing') state.status = 'paused';
    else if (state.status === 'paused') state.status = 'playing';
  }
  if (state.status === 'playing') stepPlay(state, frame, step, events);
  decay(state, step);
  return events;
}
