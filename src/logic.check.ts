import { config, liveBalance } from './config';
import { createGrid } from './fluid/grid';
import { findFullRows, clearRows, gravity, seep } from './fluid/sim';
import { createGame, updateGame, type GameState } from './game/engine';
import type { Frame } from './game/input';
import { canDroop, canGroupFall, createActive, fits } from './game/piece';
import { lineScore } from './game/scoring';
import { PIECE_TYPES, SHAPES } from './game/tetrominoes';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function idle(): Frame {
  return {
    dir: 0,
    shifts: 0,
    rotate: 0,
    soft: false,
    hard: false,
    pausePressed: false,
    restart: false,
  };
}

function wipe(game: GameState): void {
  for (const row of game.grid) {
    for (const cell of row) {
      cell.color = -1;
      cell.glow = 0;
    }
  }
}

function advance(game: GameState, frame: Frame, seconds: number): void {
  let left = seconds;
  while (left > 0) {
    const step = Math.min(0.05, left);
    updateGame(game, frame, step);
    left -= step;
  }
}

function checkPalette(): void {
  assert(config.fallSpeed > 0, 'fallSpeed');
  assert(config.viscosity > config.midGame.viscosity, 'early liquid is thicker');
  assert(config.colorPoolSize === 3, 'early pool');
  assert(config.midGame.colorPoolSize === 5, 'mid pool');
  assert(config.colors.length >= 5, 'palette size');
  assert(config.colors[0] === '#00E5FF', 'cyan');
  assert(config.colors[1] === '#FF2D95', 'magenta');
  assert(config.colors[2] === '#FFB020', 'amber');
  assert(config.colors[3] === '#7CFF3A', 'lime');
  assert(config.colors[4] === '#A78BFA', 'violet');
  const early = liveBalance('early');
  const mid = liveBalance('mid');
  assert(early.colorPoolSize === 3 && early.mode === 'early', 'early balance');
  assert(mid.colorPoolSize === 5 && mid.mode === 'mid', 'mid balance');
  assert(mid.fallSpeed > early.fallSpeed, 'mid falls faster');
  assert(mid.viscosity < early.viscosity, 'mid seeps faster');
}

function checkScores(): void {
  assert(lineScore(1, 1) === 100, `single ${lineScore(1, 1)}`);
  assert(lineScore(2, 1) === 600, `double ${lineScore(2, 1)}`);
  assert(lineScore(2, 2) === 900, `double chain ${lineScore(2, 2)}`);
  assert(lineScore(4, 3) === 8000, `quad chain ${lineScore(4, 3)}`);
  assert(lineScore(0, 4) === 0, 'zero rows');
}

function checkShapes(): void {
  for (const type of PIECE_TYPES) {
    for (let rot = 0; rot < 4; rot += 1) {
      const shape = SHAPES[type][rot];
      assert(shape !== undefined && shape.length === 4, `${type} rot ${rot}`);
      const keys = new Set(shape.map(([x, y]) => `${x},${y}`));
      assert(keys.size === 4, `${type} rot ${rot} unique`);
    }
  }
  const game = createGame(0);
  assert(game.active !== null && fits(game.grid, game.active), 'spawn fits');
}

function checkFluid(): void {
  const empty = createGrid();
  empty[10][3] = { color: 0, glow: 0 };
  const fallen = gravity(empty, new Set(), new Set());
  assert(empty[11][3].color === 0 && empty[10][3].color < 0, 'gravity drops one row');
  assert(!fallen.merged, 'lone fall is not a merge');

  const stack = createGrid();
  stack[10][3] = { color: 2, glow: 0 };
  stack[11][3] = { color: 2, glow: 0 };
  const stacked = gravity(stack, new Set(), new Set());
  assert(stack[11][3].color === 2 && stack[12][3].color === 2, 'stack falls together');
  assert(stack[10][3].color < 0, 'stack source cleared');
  assert(!stacked.merged, 'a connected stack falling is not a new merge');

  const blocked = createGrid();
  blocked[20][0] = { color: 1, glow: 0 };
  gravity(blocked, new Set(['0,21']), new Set());
  assert(blocked[20][0].color === 1, 'active piece blocks the drip');

  const hole = createGrid();
  hole[20][0] = { color: 0, glow: 0 };
  hole[21][0] = { color: 0, glow: 0 };
  seep(hole, new Set(), new Set(), false);
  assert(hole[21][0].color === 0 && hole[21][1].color === 0, 'stack slumps into the hole');
  assert(hole[20][0].color < 0, 'source cell left the stack');

  const floor = createGrid();
  floor[21][0] = { color: 0, glow: 0 };
  seep(floor, new Set(), new Set(), true);
  assert(floor[21][0].color === 0 && floor[21][1].color < 0, 'a single floor cell does not smear');

  const join = createGrid();
  join[21][0] = { color: 0, glow: 0 };
  join[20][2] = { color: 0, glow: 0 };
  join[21][2] = { color: 0, glow: 0 };
  join[21][3] = { color: 1, glow: 0 };
  const joined = seep(join, new Set(), new Set(), false);
  assert(joined.merged, 'touching a separate blob counts as a merge');
  assert(join[21][1].color === 0, 'the drip lands in the gap');

  const mixed = createGrid();
  for (let x = 0; x < 10; x += 1) mixed[21][x] = { color: x === 4 ? 1 : 0, glow: 0 };
  assert(findFullRows(mixed).length === 0, 'mixed row stays');

  const same = createGrid();
  for (let x = 0; x < 10; x += 1) same[21][x] = { color: 3, glow: 0 };
  assert(findFullRows(same).join(',') === '21', 'same-color row clears');
  clearRows(same, [21]);
  assert(same[21].every((cell) => cell.color < 0), 'cleared row is empty');
}

function checkClearAndPhase(): void {
  const game = createGame(0);
  wipe(game);
  for (let x = 0; x < 6; x += 1) game.grid[21][x] = { color: 0, glow: 0 };
  game.active = createActive('I', 0);
  game.active.x = 6;
  game.active.y = 20;
  const hard = idle();
  hard.hard = true;
  updateGame(game, hard, 0.016);
  assert(game.lines === 1, `lines ${game.lines}`);
  assert(game.score === 125, `clear score ${game.score}`);
  assert(game.pending !== null, 'clear flashes before removal');
  let guard = 0;
  while (game.pending && guard < 20) {
    updateGame(game, idle(), 0.05);
    guard += 1;
  }
  assert(game.pending === null, 'flash ends');
  assert(game.grid[21].every((cell) => cell.color < 0), 'row removed and not refilled');

  const multi = createGame(0);
  wipe(multi);
  for (const y of [20, 21]) {
    for (let x = 0; x < 10; x += 1) multi.grid[y][x] = { color: 2, glow: 0 };
  }
  updateGame(multi, idle(), 0.016);
  assert(multi.lines === 2, `multi lines ${multi.lines}`);
  assert(multi.score === lineScore(2, 0), `multi score ${multi.score}`);

  const phase = createGame(0);
  wipe(phase);
  phase.lines = config.midGame.afterLines - 1;
  for (let x = 0; x < 10; x += 1) phase.grid[21][x] = { color: 4, glow: 0 };
  updateGame(phase, idle(), 0.016);
  assert(phase.mode === 'mid', 'mid game unlocks on the line threshold');
  assert(phase.lines === config.midGame.afterLines, 'line count');
}

function checkGameOver(): void {
  const game = createGame(0);
  wipe(game);
  game.grid[0][4] = { color: 2, glow: 0 };
  updateGame(game, idle(), 0.016);
  assert(game.status === 'gameover', `spawn fluid ends the run (${game.status})`);
  assert(game.active === null, 'active piece cleared');
}

function checkOoze(): void {
  const game = createGame(0);
  wipe(game);
  game.grid[21][4] = { color: 1, glow: 0 };
  game.active = createActive('O', 0);
  game.active.x = 3;
  game.active.y = 19;
  assert(game.active !== null, 'piece');
  assert(!canGroupFall(game.grid, game.active), 'group is supported');
  assert(canDroop(game.grid, game.active), 'a mino can drip');
  const oozeEvery = Math.max(0.05, liveBalance('early').viscosity * config.tuning.oozeViscosityScale);
  advance(game, idle(), oozeEvery * 0.65);
  assert(game.active !== null && game.active.droop.every((value) => value === 0), 'high viscosity delays the drip');
  advance(game, idle(), oozeEvery * 0.5);
  assert(game.active !== null && game.active.droop[3] === 1, 'the free mino oozes into the gap');
  assert(game.active.droop[0] === 0 && game.active.droop[2] === 0, 'supported minos stay put');
}

export function runChecks(): void {
  checkPalette();
  checkScores();
  checkShapes();
  checkFluid();
  checkClearAndPhase();
  checkGameOver();
  checkOoze();
}
