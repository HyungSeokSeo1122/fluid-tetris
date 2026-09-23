import { config, liveBalance, stageForLines } from './config';
import { COLS, createGrid } from './fluid/grid';
import { findFullRows, clearRows, gravity, hasFloating, seep, settleGrid } from './fluid/sim';
import { createGame, updateGame, type GameState } from './game/engine';
import { isHoldKey, type Frame } from './game/input';
import { canDroop, canGroupFall, createActive, droopOnce, fits, softLanding } from './game/piece';
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
    hold: false,
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
  const [stage1, stage2, stage3] = config.stages;
  assert(stage1.id === 'stage1' && stage2.id === 'stage2' && stage3.id === 'stage3', 'stage ids');
  assert(stage1.colorPoolSize === 3 && stage1.viscosity === 0.85 && stage1.fallSpeed === 0.6, 'stage 1');
  assert(stage2.colorPoolSize === 4 && stage2.viscosity === 0.6 && stage2.fallSpeed === 0.9, 'stage 2');
  assert(stage3.colorPoolSize === 5 && stage3.viscosity === 0.4 && stage3.fallSpeed === 1.2, 'stage 3');
  assert(config.fallSpeed === stage1.fallSpeed, 'fallSpeed knob matches stage 1');
  assert(config.viscosity === stage1.viscosity, 'viscosity knob matches stage 1');
  assert(config.colorPoolSize === stage1.colorPoolSize, 'colorPoolSize knob matches stage 1');
  assert(config.colors.length >= 5, 'palette size');
  assert(config.colors[0] === '#00E5FF', 'cyan');
  assert(config.colors[1] === '#FF2D95', 'magenta');
  assert(config.colors[2] === '#FFB020', 'amber');
  assert(config.colors[3] === '#7CFF3A', 'lime');
  assert(config.colors[4] === '#A78BFA', 'violet');
  assert(config.scoring.rowMultiplier[2] === 1.5, 'double multiplier');
  assert(config.scoring.rowMultiplier[3] === 2.5, 'triple multiplier');
  assert(config.scoring.chainStep === 0.25, 'chain step');
  const first = liveBalance('stage1');
  const second = liveBalance('stage2');
  const third = liveBalance('stage3');
  assert(first.mode === 'stage1' && first.colorPoolSize === 3, 'stage 1 live');
  assert(second.colorPoolSize === 4 && second.fallSpeed === 0.9 && second.viscosity === 0.6, 'stage 2 live');
  assert(third.colorPoolSize === 5 && third.fallSpeed === 1.2 && third.viscosity === 0.4, 'stage 3 live');
  assert(stageForLines(0).id === 'stage1', 'opening stage');
  assert(stageForLines(stage2.afterLines).id === 'stage2', 'stage 2 gate');
  assert(stageForLines(stage3.afterLines).id === 'stage3', 'stage 3 gate');
}

function checkScores(): void {
  assert(lineScore(1, 1) === 100, `single ${lineScore(1, 1)}`);
  assert(lineScore(2, 0) === 450, `double ${lineScore(2, 0)}`);
  assert(lineScore(2, 2) === 563, `double chain ${lineScore(2, 2)}`);
  assert(lineScore(3, 1) === 1500, `triple ${lineScore(3, 1)}`);
  assert(lineScore(3, 3) === 2250, `triple chain ${lineScore(3, 3)}`);
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

  const stage2 = config.stages[1];
  const phase = createGame(0);
  wipe(phase);
  phase.lines = stage2.afterLines - 1;
  for (let x = 0; x < 10; x += 1) phase.grid[21][x] = { color: 3, glow: 0 };
  updateGame(phase, idle(), 0.016);
  assert(phase.mode === 'stage2', 'stage 2 unlocks on its line gate');
  assert(phase.lines === stage2.afterLines, 'line count');

  const stage3 = config.stages[2];
  const late = createGame(0);
  wipe(late);
  late.lines = stage3.afterLines - 1;
  for (let x = 0; x < 10; x += 1) late.grid[21][x] = { color: 4, glow: 0 };
  updateGame(late, idle(), 0.016);
  assert(late.mode === 'stage3', 'stage 3 unlocks on its line gate');
  assert(late.lines === stage3.afterLines, 'stage 3 line count');
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
  const oozeEvery = Math.max(0.05, liveBalance('stage1').viscosity * config.tuning.oozeViscosityScale);
  advance(game, idle(), oozeEvery * 0.65);
  assert(game.active !== null && game.active.droop.every((value) => value === 0), 'high viscosity delays the drip');
  advance(game, idle(), oozeEvery * 0.5);
  assert(game.active !== null && game.active.droop[3] === 1, 'the free mino oozes into the gap');
  assert(game.active.droop[0] === 0 && game.active.droop[2] === 0, 'supported minos stay put');
}

function columnHeights(grid: GameState['grid']): number[] {
  const heights = Array<number>(COLS).fill(0);
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y];
    if (!row) continue;
    for (let x = 0; x < COLS; x += 1) {
      if ((row[x]?.color ?? -1) >= 0) heights[x] += 1;
    }
  }
  return heights;
}

function assertSettled(grid: GameState['grid'], label: string): void {
  assert(!hasFloating(grid, new Set(), new Set()), `${label} leaves a floating cell`);
  const heights = columnHeights(grid);
  for (let x = 0; x < COLS - 1; x += 1) {
    const left = heights[x] ?? 0;
    const right = heights[x + 1] ?? 0;
    assert(Math.abs(left - right) < 2, `${label} leaves a stuck step at column ${x}`);
  }
}

function checkGapOoze(): void {
  const grid = createGrid();
  const active = createActive('I', 0);
  active.x = 3;
  active.y = 18;
  grid[20][4] = { color: 1, glow: 0 };
  grid[20][5] = { color: 1, glow: 0 };
  grid[21][3] = { color: 1, glow: 0 };
  assert(droopOnce(grid, active), 'a mino can reach a gap');
  assert(active.droop[3] === 1, 'ooze prefers the deeper gap');
  assert(active.droop[0] === 0, 'the shallow pocket waits');
}

function checkGhost(): void {
  const grid = createGrid();
  for (let x = 0; x < COLS; x += 1) grid[21][x] = { color: 1, glow: 0 };
  const active = createActive('T', 0);
  active.y = 4;
  const droop = active.droop.reduce((sum, value) => sum + value, 0);
  const ghost = softLanding(grid, active);
  const ghostDroop = ghost.droop.reduce((sum, value) => sum + value, 0);
  assert(ghost.y > active.y, 'ghost shows the landing row');
  assert(ghostDroop === droop, 'ghost keeps the soft shape');
  assert(!canGroupFall(grid, ghost), 'ghost rests on the stack');
  assert(canGroupFall(grid, active), 'the live piece is still above its ghost');
}

function requireActive(game: GameState) {
  const active = game.active;
  if (!active) throw new Error('expected an active piece');
  return active;
}

function requireHold(game: GameState) {
  const held = game.hold;
  if (!held) throw new Error('expected a held piece');
  return held;
}

function checkHold(): void {
  const game = createGame(0);
  wipe(game);
  const opening = createActive('T', 2);
  opening.rot = 2;
  opening.x = 4;
  opening.droop = [1, 0, 0, 0];
  game.active = opening;
  game.next = { type: 'L', color: 4 };
  game.holdSpent = false;
  const score = game.score;
  const frame = idle();
  frame.hold = true;
  updateGame(game, frame, 0.016);
  const held = requireHold(game);
  const incoming = requireActive(game);
  assert(held.type === 'T' && held.color === 2, 'held piece keeps type and color');
  assert(incoming.type === 'L' && incoming.color === 4, 'empty hold pulls next');
  assert(incoming.rot === 0, 'incoming piece spawns upright');
  assert(incoming.droop.every((value) => value === 0), 'swap respawns soft');
  assert(game.holdSpent, 'hold is spent');
  assert(game.score === score, 'hold does not score');
  assert(
    game.grid.every((row) => row.every((cell) => cell.color < 0)),
    'hold does not lock the piece',
  );

  const spent = idle();
  spent.hold = true;
  const activeType = incoming.type;
  const nextType = game.next.type;
  updateGame(game, spent, 0.016);
  assert(requireActive(game).type === activeType, 'second hold ignored');
  assert(requireHold(game).type === 'T', 'hold box unchanged');
  assert(game.next.type === nextType, 'next unchanged while hold is spent');

  const hard = idle();
  hard.hard = true;
  updateGame(game, hard, 0.016);
  assert(game.status === 'playing', 'lock after hold still playing');
  assert(!game.holdSpent, 'lock rearms hold');
  const returning = requireHold(game).type;
  const outgoing = requireActive(game).type;
  const swap = idle();
  swap.hold = true;
  updateGame(game, swap, 0.016);
  const returned = requireActive(game);
  assert(returned.type === returning && returned.color === 2, 'swap brings the held piece back');
  assert(requireHold(game).type === outgoing, 'active piece enters hold');
  assert(returned.rot === 0, 'returned piece uses spawn orientation');
  assert(isHoldKey('KeyC') && isHoldKey('ShiftLeft') && isHoldKey('ShiftRight'), 'hold keys');
  assert(!isHoldKey('KeyX'), 'rotate is not hold');
}

function checkSettle(): void {
  const gap = createGrid();
  gap[19][0] = { color: 4, glow: 0 };
  gap[19][1] = { color: 1, glow: 0 };
  gap[20][0] = { color: 4, glow: 0 };
  gap[21][0] = { color: 4, glow: 0 };
  gap[21][1] = { color: 4, glow: 0 };
  seep(gap, new Set(), new Set(), true, config.tuning.seepHoleDrop);
  assert(gap[20][1].color === 4, 'lip drips into the one-deep gap');
  assert(gap[19][0].color < 0, 'lip source cleared');
  assert(gap[19][1].color === 1, 'neighbor cap stays');
  assert(gap[20][0].color === 4, 'support under the lip stays');

  const pile = createGrid();
  for (let y = 18; y <= 21; y += 1) pile[y][0] = { color: 2, glow: 0 };
  settleGrid(pile, new Set(), new Set(), config.tuning.settlePasses, config.tuning.seepHoleDrop);
  assertSettled(pile, 'tall column');
  let piled = 0;
  for (const row of pile) {
    for (const cell of row) if (cell.color === 2) piled += 1;
  }
  assert(piled === 4, `settle keeps every cell (${piled})`);

  const cleared = createGrid();
  for (let x = 0; x < COLS; x += 1) cleared[21][x] = { color: 0, glow: 0 };
  cleared[18][4] = { color: 3, glow: 0 };
  cleared[19][3] = { color: 3, glow: 0 };
  cleared[19][4] = { color: 3, glow: 0 };
  cleared[19][5] = { color: 3, glow: 0 };
  cleared[20][3] = { color: 3, glow: 0 };
  cleared[20][5] = { color: 3, glow: 0 };
  clearRows(cleared, [21]);
  settleGrid(cleared, new Set(), new Set(), config.tuning.settlePasses, config.tuning.seepHoleDrop);
  assertSettled(cleared, 'post-clear island');
  assert(cleared[21][4].color === 3, 'the hole under the island fills');

  const game = createGame(0);
  wipe(game);
  for (let x = 0; x < COLS; x += 1) game.grid[21][x] = { color: 0, glow: 0 };
  game.grid[20][0] = { color: 3, glow: 0 };
  game.grid[18][0] = { color: 3, glow: 0 };
  updateGame(game, idle(), 0.016);
  assert(game.pending !== null, 'clear waits out the flash');
  let guard = 0;
  while (game.pending && guard < 20) {
    updateGame(game, idle(), 0.05);
    guard += 1;
  }
  assert(game.pending === null, 'clear finishes');
  assertSettled(game.grid, 'engine settle');
  let fallen = 0;
  for (const row of game.grid) {
    for (const cell of row) if (cell.color === 3) fallen += 1;
  }
  assert(fallen === 2, `both cells settle (${fallen})`);
  assert(game.grid[21][0].color === 3, 'a settled cell rests on the floor');
}

export function runChecks(): void {
  checkPalette();
  checkScores();
  checkShapes();
  checkFluid();
  checkClearAndPhase();
  checkGameOver();
  checkOoze();
  checkGapOoze();
  checkGhost();
  checkHold();
  checkSettle();
}
