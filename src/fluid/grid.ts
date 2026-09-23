export const COLS = 10;
export const ROWS = 22;
/** Rows above this index are the hidden spawn zone. */
export const VISIBLE_TOP = 2;
export const VISIBLE_ROWS = ROWS - VISIBLE_TOP;

export type Cell = {
  color: number;
  glow: number;
};

export function createGrid(): Cell[][] {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ color: -1, glow: 0 })),
  );
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

export function idx(x: number, y: number): number {
  return x + y * COLS;
}

export function occupiesSpawn(grid: Cell[][]): boolean {
  for (let y = 0; y < VISIBLE_TOP; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (grid[y]?.[x]?.color !== undefined && grid[y][x].color >= 0) return true;
    }
  }
  return false;
}
