import { config } from '../config';

export type Rgb = { r: number; g: number; b: number };

const CLUSTER = [
  { x: 0.34, y: 0.32 },
  { x: 0.68, y: 0.34 },
  { x: 0.32, y: 0.68 },
  { x: 0.66, y: 0.7 },
] as const;

export function hexToRgb(hex: string): Rgb {
  const cleaned = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return { r: 255, g: 45, b: 149 };
  const value = Number.parseInt(cleaned, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export const PALETTE: Rgb[] = config.colors.map((hex) => hexToRgb(hex));

export function rgbFor(index: number): Rgb {
  return PALETTE[index] ?? { r: 180, g: 180, b: 180 };
}

export function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

export function mixWhite(color: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: Math.round(color.r + (255 - color.r) * t),
    g: Math.round(color.g + (255 - color.g) * t),
    b: Math.round(color.b + (255 - color.b) * t),
  };
}

export function hash01(x: number, y: number, n: number): number {
  let h = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 3, 668265263) ^ Math.imul(n + 7, 1440662689)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function drawOrb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: Rgb,
  glow: number,
  alpha: number,
): void {
  const body = mixWhite(color, glow * 0.18);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = rgba(body, alpha);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x + radius * 0.12, y + radius * 0.32, radius * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0, 0, 0, ${0.16 + (1 - alpha) * 0.1})`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x - radius * 0.04, y - radius * 0.06, radius * 0.74, 0, Math.PI * 2);
  ctx.fillStyle = rgba(body, alpha * 0.95);
  ctx.fill();

  const gloss = mixWhite(color, 0.62 + glow * 0.3);
  ctx.beginPath();
  ctx.arc(x - radius * 0.28, y - radius * 0.32, radius * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = rgba(gloss, 0.48 + glow * 0.28);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(x - radius * 0.32, y - radius * 0.4, radius * 0.2, radius * 0.11, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 255, 255, ${0.42 + glow * 0.35})`;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radius * 0.86, Math.PI * 1.08, Math.PI * 1.92);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 + glow * 0.3})`;
  ctx.lineWidth = Math.max(1, radius * 0.13);
  ctx.stroke();
}

export function drawCluster(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  color: Rgb,
  glow: number,
  pullX: number,
  pullY: number,
  wobble: number,
  seedX: number,
  seedY: number,
  alpha = 0.93,
): void {
  const halo = mixWhite(color, 0.2);
  ctx.beginPath();
  ctx.arc(left + size * 0.5 + pullX * size, top + size * 0.52 + pullY * size, size * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = rgba(halo, 0.16 + glow * 0.18);
  ctx.fill();

  for (let i = 0; i < CLUSTER.length; i += 1) {
    const spot = CLUSTER[i];
    if (!spot) continue;
    const jx = (hash01(seedX, seedY, i) - 0.5) * size * 0.07;
    const jy = (hash01(seedX, seedY, i + 5) - 0.5) * size * 0.07;
    const radius = size * (0.2 + hash01(seedX, seedY, i + 9) * 0.045);
    drawOrb(
      ctx,
      left + spot.x * size + pullX * size + jx,
      top + spot.y * size + pullY * size + jy + wobble * size,
      radius,
      color,
      glow,
      alpha,
    );
  }
}

export function drawNeck(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  color: Rgb,
  alpha: number,
): void {
  ctx.beginPath();
  ctx.arc((x0 + x1) / 2, (y0 + y1) / 2, radius, 0, Math.PI * 2);
  ctx.fillStyle = rgba(color, alpha);
  ctx.fill();
}
