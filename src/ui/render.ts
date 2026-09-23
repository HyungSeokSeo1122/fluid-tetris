import { liveBalance } from '../config';
import { COLS, VISIBLE_ROWS, VISIBLE_TOP, type Cell } from '../fluid/grid';
import { ghostOf, minos, type Active, type Mino } from '../game/piece';
import { SHAPES } from '../game/tetrominoes';
import type { GameState, Slide } from '../game/engine';
import { drawCluster, drawNeck, rgbFor, rgba, type Rgb } from './liquid';

type Point = { x: number; y: number };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function slideMap(slides: Slide[]): Map<string, Slide> {
  const map = new Map<string, Slide>();
  for (const slide of slides) map.set(`${slide.x},${slide.y}`, slide);
  return map;
}

function displayCell(x: number, y: number, slides: Map<string, Slide>): Point {
  const slide = slides.get(`${x},${y}`);
  if (!slide) return { x, y };
  const t = Math.max(0, Math.min(1, slide.age / slide.dur));
  const ease = 1 - (1 - t) * (1 - t);
  return {
    x: slide.sx + (slide.x - slide.sx) * ease,
    y: slide.sy + (slide.y - slide.sy) * ease,
  };
}

function pull(grid: Cell[][], x: number, y: number, color: number): Point {
  let px = 0;
  let py = 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    const neighbor = grid[ny]?.[nx];
    if (neighbor && neighbor.color === color) {
      px += dx;
      py += dy;
    }
  }
  return { x: px * 0.05, y: py * 0.05 };
}

function stackNearTop(grid: Cell[][]): boolean {
  for (let y = VISIBLE_TOP; y < VISIBLE_TOP + 3; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if ((grid[y]?.[x]?.color ?? -1) >= 0) return true;
    }
  }
  return false;
}

function sameCells(a: Mino[], b: Mino[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((cell) => `${cell.x},${cell.y}`));
  return b.every((cell) => keys.has(`${cell.x},${cell.y}`));
}

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  reducedMotion: boolean,
): void {
  ctx.clearRect(0, 0, width, height);
  const cell = Math.min((width - 12) / COLS, (height - 12) / VISIBLE_ROWS);
  const boardW = cell * COLS;
  const boardH = cell * VISIBLE_ROWS;
  const originX = (width - boardW) / 2;
  const originY = (height - boardH) / 2;
  const slides = slideMap(state.slides);
  const balance = liveBalance(state.mode);

  ctx.save();
  if (!reducedMotion && state.shake > 0) {
    ctx.translate(Math.sin(state.time * 46) * state.shake * 5, Math.cos(state.time * 38) * state.shake * 3.5);
  }

  roundRect(ctx, originX, originY, boardW, boardH, 16);
  const well = ctx.createLinearGradient(originX, originY, originX, originY + boardH);
  well.addColorStop(0, '#121c30');
  well.addColorStop(1, '#0a1220');
  ctx.fillStyle = well;
  ctx.fill();

  ctx.save();
  roundRect(ctx, originX, originY, boardW, boardH, 16);
  ctx.clip();

  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x += 1) {
    ctx.beginPath();
    ctx.moveTo(originX + x * cell, originY);
    ctx.lineTo(originX + x * cell, originY + boardH);
    ctx.stroke();
  }
  for (let y = 1; y < VISIBLE_ROWS; y += 1) {
    ctx.beginPath();
    ctx.moveTo(originX, originY + y * cell);
    ctx.lineTo(originX + boardW, originY + y * cell);
    ctx.stroke();
  }

  const toPixel = (gx: number, gy: number): Point => ({
    x: originX + gx * cell,
    y: originY + (gy - VISIBLE_TOP) * cell,
  });

  const centers = new Map<string, Point>();
  for (let y = 0; y < state.grid.length; y += 1) {
    const row = state.grid[y];
    if (!row) continue;
    for (let x = 0; x < COLS; x += 1) {
      const block = row[x];
      if (!block || block.color < 0) continue;
      const pos = displayCell(x, y, slides);
      centers.set(`${x},${y}`, { x: pos.x + 0.5, y: pos.y + 0.5 });
    }
  }

  for (const [key, center] of centers) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    const block = state.grid[y]?.[x];
    if (!block || block.color < 0) continue;
    const color = rgbFor(block.color);
    const right = centers.get(`${x + 1},${y}`);
    const below = centers.get(`${x},${y + 1}`);
    if (right && state.grid[y]?.[x + 1]?.color === block.color) {
      const a = toPixel(center.x, center.y);
      const b = toPixel(right.x, right.y);
      drawNeck(ctx, a.x, a.y, b.x, b.y, cell * 0.2, color, 0.78);
    }
    if (below && state.grid[y + 1]?.[x]?.color === block.color) {
      const a = toPixel(center.x, center.y);
      const b = toPixel(below.x, below.y);
      drawNeck(ctx, a.x, a.y, b.x, b.y, cell * 0.2, color, 0.78);
    }
  }

  for (const [key, center] of centers) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    const block = state.grid[y]?.[x];
    if (!block || block.color < 0) continue;
    if (center.y + 1 < VISIBLE_TOP - 0.2 || center.y > VISIBLE_TOP + VISIBLE_ROWS + 0.2) continue;
    const pixel = toPixel(center.x - 0.5, center.y - 0.5);
    const offset = pull(state.grid, x, y, block.color);
    const pendingBoost = state.pending?.rows.includes(y) ? 0.75 : 0;
    drawCluster(
      ctx,
      pixel.x,
      pixel.y,
      cell,
      rgbFor(block.color),
      Math.min(1, block.glow + pendingBoost),
      offset.x,
      offset.y,
      0,
      x,
      y,
    );
  }

  if (state.active && state.status !== 'gameover') {
    drawGhost(ctx, state, toPixel, cell);
    drawActive(ctx, state.active, state.fallVisual, state.time, balance.viscosity, toPixel, cell, reducedMotion);
  }

  for (const bit of state.bits) {
    if (bit.y < VISIBLE_TOP - 1 || bit.y > VISIBLE_TOP + VISIBLE_ROWS + 1) continue;
    const pixel = toPixel(bit.x, bit.y);
    const fade = 1 - bit.age / bit.life;
    ctx.beginPath();
    ctx.arc(pixel.x, pixel.y, bit.radius * cell, 0, Math.PI * 2);
    ctx.fillStyle = rgba(rgbFor(bit.color), Math.max(0, fade));
    ctx.fill();
  }

  ctx.font = `700 ${Math.max(14, cell * 0.46)}px "Avenir Next", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const popup of state.popups) {
    const fade = 1 - popup.age / popup.life;
    const pixel = toPixel(popup.x, popup.y - popup.age * 0.8);
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, fade)})`;
    ctx.fillText(popup.text, pixel.x, pixel.y);
  }

  if (state.banner && state.bannerLeft > 0) {
    const fade = Math.min(1, state.bannerLeft);
    ctx.font = `600 ${Math.max(13, cell * 0.38)}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.fillStyle = `rgba(255,255,255,${0.92 * Math.min(1, fade)})`;
    ctx.fillText(state.banner, originX + boardW / 2, originY + cell * 1.3);
  }

  if (state.clearPulse > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.08 * state.clearPulse})`;
    ctx.fillRect(originX, originY, boardW, boardH);
  }

  ctx.restore();

  const danger = stackNearTop(state.grid);
  ctx.setLineDash([5, 6]);
  ctx.strokeStyle = danger ? 'rgba(255, 90, 120, 0.9)' : 'rgba(255, 90, 120, 0.32)';
  ctx.lineWidth = danger ? 2 : 1;
  ctx.beginPath();
  ctx.moveTo(originX + 10, originY + 2);
  ctx.lineTo(originX + boardW - 10, originY + 2);
  ctx.stroke();
  ctx.setLineDash([]);

  roundRect(ctx, originX, originY, boardW, boardH, 16);
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.38)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  toPixel: (x: number, y: number) => Point,
  cell: number,
): void {
  const active = state.active;
  if (!active) return;
  const ghost = ghostOf(state.grid, active);
  const current = minos(active);
  const landed = minos(ghost);
  if (sameCells(current, landed)) return;
  const color = rgbFor(active.color);
  const occupied = new Set(current.map((mino) => `${mino.x},${mino.y}`));
  for (const mino of landed) {
    if (occupied.has(`${mino.x},${mino.y}`)) continue;
    if (mino.y + 1 < VISIBLE_TOP || mino.y > VISIBLE_TOP + VISIBLE_ROWS) continue;
    const pixel = toPixel(mino.x, mino.y);
    ctx.beginPath();
    ctx.arc(pixel.x + cell * 0.5, pixel.y + cell * 0.5, cell * 0.28, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(color, 0.45);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawActive(
  ctx: CanvasRenderingContext2D,
  active: Active,
  fallVisual: number,
  time: number,
  viscosity: number,
  toPixel: (x: number, y: number) => Point,
  cell: number,
  reducedMotion: boolean,
): void {
  const cells = minos(active);
  const keys = new Set(cells.map((mino) => `${mino.x},${mino.y}`));
  const color = rgbFor(active.color);
  connectCells(ctx, cells, color, cell * 0.18, 0.7, (mino) => toPixel(mino.x + 0.5, mino.y + fallVisual + 0.5));
  for (const mino of cells) {
    if (mino.y + fallVisual > VISIBLE_TOP + VISIBLE_ROWS + 0.4) continue;
    if (mino.y + fallVisual + 1 < VISIBLE_TOP - 0.4) continue;
    let px = 0;
    let py = 0;
    for (const other of cells) {
      if (other === mino) continue;
      if (!keys.has(`${other.x},${other.y}`)) continue;
      const dx = other.x - mino.x;
      const dy = other.y - mino.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        px += dx;
        py += dy;
      }
    }
    const pixel = toPixel(mino.x, mino.y + fallVisual);
    const wobble = reducedMotion ? 0 : Math.sin(time * 3.1 + mino.index) * (0.025 + 0.1 / Math.max(0.4, viscosity));
    drawCluster(ctx, pixel.x, pixel.y, cell, color, 0.35, px * 0.05, py * 0.05, wobble, mino.x, mino.y, 0.96);
  }
}

export function renderPreview(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  roundRect(ctx, 0, 0, width, height, 12);
  ctx.fillStyle = '#10192a';
  ctx.fill();
  const shape = SHAPES[state.next.type][0];
  let minX = 4;
  let minY = 4;
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of shape) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const cell = Math.min((width - 24) / spanX, (height - 24) / spanY);
  const originX = (width - spanX * cell) / 2 - minX * cell;
  const originY = (height - spanY * cell) / 2 - minY * cell;
  const color = rgbFor(state.next.color);
  const placed = shape.map(([x, y]) => ({ x, y }));
  connectCells(ctx, placed, color, cell * 0.18, 0.75, (mino) => ({
    x: originX + (mino.x + 0.5) * cell,
    y: originY + (mino.y + 0.5) * cell,
  }));
  for (const [x, y] of shape) {
    let px = 0;
    let py = 0;
    for (const [ox, oy] of shape) {
      if (Math.abs(ox - x) + Math.abs(oy - y) === 1) {
        px += ox - x;
        py += oy - y;
      }
    }
    drawCluster(ctx, originX + x * cell, originY + y * cell, cell, color, 0.2, px * 0.05, py * 0.05, 0, x, y);
  }
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
  roundRect(ctx, 1, 1, width - 2, height - 2, 12);
  ctx.stroke();
}

function connectCells(
  ctx: CanvasRenderingContext2D,
  cells: ReadonlyArray<{ x: number; y: number }>,
  color: Rgb,
  radius: number,
  alpha: number,
  project: (cell: { x: number; y: number }) => Point,
): void {
  for (let i = 0; i < cells.length; i += 1) {
    const a = cells[i];
    if (!a) continue;
    for (let j = i + 1; j < cells.length; j += 1) {
      const b = cells[j];
      if (!b) continue;
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) continue;
      const pa = project(a);
      const pb = project(b);
      drawNeck(ctx, pa.x, pa.y, pb.x, pb.y, radius, color, alpha);
    }
  }
}
