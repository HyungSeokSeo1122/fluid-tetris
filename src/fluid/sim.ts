import { COLS, ROWS, VISIBLE_TOP, idx, inBounds, type Cell } from './grid';

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export type Move = {
  x: number;
  y: number;
  nx: number;
  ny: number;
  color: number;
};

export type SimResult = {
  moves: Move[];
  merged: boolean;
};

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function columnHeight(grid: Cell[][], x: number): number {
  let height = 0;
  for (let y = 0; y < ROWS; y += 1) {
    if (grid[y][x].color >= 0) height += 1;
  }
  return height;
}

function components(grid: Cell[][]): Int16Array {
  const ids = new Int16Array(COLS * ROWS);
  ids.fill(-1);
  let nextId = 0;
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const start = idx(x, y);
      if (ids[start] !== -1 || grid[y][x].color < 0) continue;
      const color = grid[y][x].color;
      const id = nextId;
      nextId += 1;
      const stack = [start];
      ids[start] = id;
      while (stack.length > 0) {
        const cur = stack.pop();
        if (cur === undefined) break;
        const cx = cur % COLS;
        const cy = Math.floor(cur / COLS);
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!inBounds(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (ids[ni] !== -1 || grid[ny][nx].color !== color) continue;
          ids[ni] = id;
          stack.push(ni);
        }
      }
    }
  }
  return ids;
}

function supported(
  grid: Cell[][],
  blocked: ReadonlySet<string>,
  frozenRows: ReadonlySet<number>,
  x: number,
  y: number,
): boolean {
  const ny = y + 1;
  if (ny >= ROWS) return true;
  if (frozenRows.has(ny)) return true;
  if (blocked.has(cellKey(x, ny))) return true;
  return grid[ny][x].color >= 0;
}

function commitMoves(grid: Cell[][], moves: Move[]): boolean {
  if (moves.length === 0) return false;
  const before = components(grid);
  const originAtDest = new Map<string, number>();
  for (const move of moves) {
    originAtDest.set(cellKey(move.nx, move.ny), before[idx(move.x, move.y)]);
    grid[move.y][move.x] = { color: -1, glow: 0 };
  }
  for (const move of moves) {
    grid[move.ny][move.nx] = { color: move.color, glow: 0 };
  }

  let merged = false;
  for (const move of moves) {
    const id = before[idx(move.x, move.y)];
    for (const [dx, dy] of DIRS) {
      const nx = move.nx + dx;
      const ny = move.ny + dy;
      if (!inBounds(nx, ny) || grid[ny][nx].color !== move.color) continue;
      const neighborKey = cellKey(nx, ny);
      const neighborId = originAtDest.has(neighborKey)
        ? originAtDest.get(neighborKey) ?? -1
        : before[idx(nx, ny)];
      if (neighborId >= 0 && neighborId !== id) {
        merged = true;
        grid[move.ny][move.nx].glow = 1;
        grid[ny][nx].glow = Math.max(grid[ny][nx].glow, 1);
      }
    }
  }
  return merged;
}

export function gravity(
  grid: Cell[][],
  blocked: ReadonlySet<string>,
  frozenRows: ReadonlySet<number>,
): SimResult {
  const falling: boolean[][] = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
  for (let y = ROWS - 1; y >= 0; y -= 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (grid[y][x].color < 0 || frozenRows.has(y)) continue;
      const ny = y + 1;
      if (ny >= ROWS || frozenRows.has(ny) || blocked.has(cellKey(x, ny))) continue;
      if (grid[ny][x].color < 0 || falling[ny][x]) falling[y][x] = true;
    }
  }

  const moves: Move[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!falling[y][x]) continue;
      moves.push({ x, y, nx: x, ny: y + 1, color: grid[y][x].color });
    }
  }
  return { moves, merged: commitMoves(grid, moves) };
}

/**
 * Viscous slump. A supported cell may drip diagonally into a supported hole,
 * or roll sideways onto a step when that column is shorter by at least two.
 * A one-cell floor layer does not smear, so a finished row stays intact.
 */
export function seep(
  grid: Cell[][],
  blocked: ReadonlySet<string>,
  frozenRows: ReadonlySet<number>,
  biasRight: boolean,
  holeDrop = 1,
): SimResult {
  const heights = Array.from({ length: COLS }, (_, x) => columnHeight(grid, x));
  const prefer = biasRight ? 1 : -1;
  type Candidate = Move & { score: number };
  const bestByColumn = new Map<number, Candidate>();

  for (let y = ROWS - 1; y >= 0; y -= 1) {
    if (frozenRows.has(y)) continue;
    for (let x = 0; x < COLS; x += 1) {
      const color = grid[y][x].color;
      if (color < 0) continue;
      if (!supported(grid, blocked, frozenRows, x, y)) continue;
      for (const dir of [-1, 1]) {
        const nx = x + dir;
        if (nx < 0 || nx >= COLS) continue;
        const options = [
          { tx: nx, ty: y + 1, downward: 2 },
          { tx: nx, ty: y, downward: 1 },
        ];
        for (const option of options) {
          if (!inBounds(option.tx, option.ty)) continue;
          if (frozenRows.has(option.ty)) continue;
          if (grid[option.ty][option.tx].color >= 0) continue;
          if (blocked.has(cellKey(option.tx, option.ty))) continue;
          if (option.ty === y && !supported(grid, blocked, frozenRows, option.tx, option.ty)) continue;
          const columnDrop = heights[x] - heights[option.tx];
          const intoHole =
            option.downward >= 2 && supported(grid, blocked, frozenRows, option.tx, option.ty);
          const minDrop = intoHole ? Math.max(1, holeDrop) : 2;
          if (columnDrop < minDrop) continue;
          const score =
            (heights[x] - heights[option.tx]) * 10 +
            option.downward * 3 +
            (dir === prefer ? 1 : 0);
          const previous = bestByColumn.get(x);
          if (!previous || score > previous.score) {
            bestByColumn.set(x, {
              x,
              y,
              nx: option.tx,
              ny: option.ty,
              color,
              score,
            });
          }
        }
      }
    }
  }

  const ordered = [...bestByColumn.values()].sort((a, b) => b.score - a.score);
  const takenDest = new Set<string>();
  const takenSource = new Set<string>();
  const moves: Move[] = [];
  for (const candidate of ordered) {
    const sourceKey = cellKey(candidate.x, candidate.y);
    const destKey = cellKey(candidate.nx, candidate.ny);
    if (takenSource.has(sourceKey) || takenDest.has(destKey)) continue;
    takenSource.add(sourceKey);
    takenDest.add(destKey);
    moves.push({
      x: candidate.x,
      y: candidate.y,
      nx: candidate.nx,
      ny: candidate.ny,
      color: candidate.color,
    });
  }
  return { moves, merged: commitMoves(grid, moves) };
}

export function findFullRows(grid: Cell[][]): number[] {
  const rows: number[] = [];
  for (let y = VISIBLE_TOP; y < ROWS; y += 1) {
    const color = grid[y][0].color;
    if (color < 0) continue;
    let same = true;
    for (let x = 1; x < COLS; x += 1) {
      if (grid[y][x].color !== color) {
        same = false;
        break;
      }
    }
    if (same) rows.push(y);
  }
  return rows;
}

export function hasFloating(
  grid: Cell[][],
  blocked: ReadonlySet<string>,
  frozenRows: ReadonlySet<number>,
): boolean {
  for (let y = 0; y < ROWS; y += 1) {
    if (frozenRows.has(y)) continue;
    for (let x = 0; x < COLS; x += 1) {
      if (grid[y][x].color < 0) continue;
      if (!supported(grid, blocked, frozenRows, x, y)) return true;
    }
  }
  return false;
}

function gridSignature(grid: Cell[][]): string {
  let signature = '';
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const color = grid[y][x].color;
      signature += color < 0 ? '.' : String(color);
    }
  }
  return signature;
}

/**
 * After a clear, drop every floating cell to the floor and let tall columns
 * slump into the gaps they opened. Stops before smearing a newly completed row.
 */
export function settleGrid(
  grid: Cell[][],
  blocked: ReadonlySet<string>,
  frozenRows: ReadonlySet<number>,
  maxPasses = 28,
  holeDrop = 1,
): SimResult {
  const origin = new Map<string, { x: number; y: number; color: number }>();
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const color = grid[y][x].color;
      if (color >= 0) origin.set(cellKey(x, y), { x, y, color });
    }
  }

  const remap = (moves: readonly Move[]): void => {
    const carried = new Map<string, { x: number; y: number; color: number }>();
    for (const move of moves) {
      const prev = origin.get(cellKey(move.x, move.y));
      origin.delete(cellKey(move.x, move.y));
      if (prev) carried.set(cellKey(move.nx, move.ny), prev);
    }
    for (const [key, prev] of carried) origin.set(key, prev);
  };

  const seen = new Set<string>();
  let merged = false;
  let passes = 0;
  while (passes < maxPasses) {
    passes += 1;
    const signature = gridSignature(grid);
    if (seen.has(signature)) break;
    seen.add(signature);
    if (findFullRows(grid).length > 0) break;
    const fell = gravity(grid, blocked, frozenRows);
    if (fell.moves.length > 0) {
      merged = merged || fell.merged;
      remap(fell.moves);
      continue;
    }
    const slumped = seep(grid, blocked, frozenRows, passes % 2 === 0, holeDrop);
    if (slumped.moves.length === 0) break;
    merged = merged || slumped.merged;
    remap(slumped.moves);
  }

  const moves: Move[] = [];
  for (const [key, from] of origin) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    if (from.x === x && from.y === y) continue;
    moves.push({ x: from.x, y: from.y, nx: x, ny: y, color: from.color });
  }
  return { moves, merged };
}

export function clearRows(grid: Cell[][], rows: readonly number[]): void {
  for (const y of rows) {
    if (y < 0 || y >= ROWS) continue;
    for (let x = 0; x < COLS; x += 1) {
      grid[y][x] = { color: -1, glow: 0 };
    }
  }
}
