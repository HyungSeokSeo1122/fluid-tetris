import { COLS, ROWS, type Cell } from '../fluid/grid';
import { SHAPES, type PieceType } from './tetrominoes';

export type Droop = [number, number, number, number];

export type Active = {
  type: PieceType;
  rot: number;
  x: number;
  y: number;
  color: number;
  droop: Droop;
};

export type Mino = { x: number; y: number; index: number };

const KICKS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-2, 0],
  [2, 0],
  [0, -2],
  [-1, -1],
  [1, -1],
  [0, 1],
];

export function createActive(type: PieceType, color: number): Active {
  // y = 1 puts every classic spawn shape's lower row on the first visible line.
  return { type, rot: 0, x: 3, y: 1, color, droop: [0, 0, 0, 0] };
}

export function cloneActive(active: Active): Active {
  return {
    type: active.type,
    rot: active.rot,
    x: active.x,
    y: active.y,
    color: active.color,
    droop: [active.droop[0], active.droop[1], active.droop[2], active.droop[3]],
  };
}

function copyDroop(droop: Droop): Droop {
  return [droop[0], droop[1], droop[2], droop[3]];
}

export function minos(active: Active): Mino[] {
  const shape = SHAPES[active.type][active.rot & 3];
  if (!shape) return [];
  return shape.map((offset, index) => ({
    x: active.x + offset[0],
    y: active.y + offset[1] + (active.droop[index] ?? 0),
    index,
  }));
}

export function fits(grid: Cell[][], active: Active): boolean {
  const seen = new Set<string>();
  for (const cell of minos(active)) {
    if (cell.x < 0 || cell.x >= COLS || cell.y >= ROWS) return false;
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (cell.y >= 0 && grid[cell.y][cell.x].color >= 0) return false;
  }
  return true;
}

export function tryShift(grid: Cell[][], active: Active, dx: number): boolean {
  active.x += dx;
  if (fits(grid, active)) return true;
  active.x -= dx;
  return false;
}

export function tryRotate(grid: Cell[][], active: Active, dir: -1 | 1): boolean {
  const previousRot = active.rot;
  const previousDroop = copyDroop(active.droop);
  const previousX = active.x;
  const previousY = active.y;
  active.rot = (active.rot + dir + 4) % 4;
  active.droop = [0, 0, 0, 0];
  for (const [kickX, kickY] of KICKS) {
    active.x = previousX + kickX;
    active.y = previousY + kickY;
    if (fits(grid, active)) return true;
  }
  active.rot = previousRot;
  active.droop = previousDroop;
  active.x = previousX;
  active.y = previousY;
  return false;
}

export function canGroupFall(grid: Cell[][], active: Active): boolean {
  active.y += 1;
  const ok = fits(grid, active);
  active.y -= 1;
  return ok;
}

type DroopChoice = { index: number; air: number };

function bestDroop(grid: Cell[][], active: Active): DroopChoice | null {
  const cells = minos(active);
  const occupied = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
  let best: DroopChoice | null = null;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (!cell) continue;
    active.droop[index] += 1;
    const ok = fits(grid, active);
    active.droop[index] -= 1;
    if (!ok) continue;
    let air = 0;
    for (let ny = cell.y + 1; ny < ROWS; ny += 1) {
      if (occupied.has(`${cell.x},${ny}`)) break;
      if ((grid[ny]?.[cell.x]?.color ?? -1) >= 0) break;
      air += 1;
    }
    if (air <= 0) continue;
    const bestY = best ? (cells[best.index]?.y ?? -1) : -1;
    if (!best || air > best.air || (air === best.air && cell.y > bestY)) {
      best = { index, air };
    }
  }
  return best;
}

/** Drip the mino over the deepest gap by one row. Returns true when it moved. */
export function droopOnce(grid: Cell[][], active: Active): boolean {
  const best = bestDroop(grid, active);
  if (!best) return false;
  active.droop[best.index] += 1;
  return true;
}

/** Air under the next mino that can drip. Zero when the piece cannot ooze. */
export function droopAir(grid: Cell[][], active: Active): number {
  return bestDroop(grid, active)?.air ?? 0;
}

export function canDroop(grid: Cell[][], active: Active): boolean {
  const saved = copyDroop(active.droop);
  const moved = droopOnce(grid, active);
  active.droop = saved;
  return moved;
}

export function droopFully(grid: Cell[][], active: Active): void {
  let guard = 0;
  while (droopOnce(grid, active) && guard < ROWS * 4) guard += 1;
}

/** Where the current soft shape would land if it fell as a group, without further ooze. */
export function softLanding(grid: Cell[][], active: Active): Active {
  const ghost = cloneActive(active);
  let guard = 0;
  while (canGroupFall(grid, ghost) && guard < ROWS) {
    ghost.y += 1;
    guard += 1;
  }
  return ghost;
}

export function ghostOf(grid: Cell[][], active: Active): Active {
  const ghost = softLanding(grid, active);
  droopFully(grid, ghost);
  return ghost;
}
