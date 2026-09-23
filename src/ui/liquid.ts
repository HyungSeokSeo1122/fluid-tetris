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
  const flash = Math.max(0, Math.min(1, glow));
  const bodyAlpha = alpha * (0.58 + flash * 0.22);
  const lit = mixWhite(color, 0.2 + flash * 0.65);

  const gel = ctx.createRadialGradient(
    x - radius * 0.32,
    y - radius * 0.36,
    radius * 0.06,
    x,
    y + radius * 0.04,
    radius,
  );
  gel.addColorStop(0, rgba(mixWhite(color, 0.74 + flash * 0.26), Math.min(0.96, bodyAlpha + 0.28)));
  gel.addColorStop(0.38, rgba(lit, bodyAlpha + flash * 0.12));
  gel.addColorStop(0.72, rgba(color, bodyAlpha * 0.82));
  gel.addColorStop(1, rgba(mixWhite(color, 0.62), Math.min(1, bodyAlpha + 0.2)));

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gel;
  ctx.fill();

  const rim = ctx.createRadialGradient(x, y, radius * 0.62, x, y, radius);
  rim.addColorStop(0, rgba(lit, 0));
  rim.addColorStop(0.72, rgba(mixWhite(color, 0.4), 0.05));
  rim.addColorStop(1, rgba(mixWhite(color, 0.86), 0.34 + flash * 0.4));
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = rim;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radius * 0.94, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.28 + flash * 0.5})`;
  ctx.lineWidth = Math.max(1, radius * (0.09 + flash * 0.07));
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x - radius * 0.28, y - radius * 0.36, radius * 0.22, radius * 0.11, -0.65, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 255, 255, ${0.42 + flash * 0.4})`;
  ctx.fill();

  if (flash > 0.05) {
    ctx.beginPath();
    ctx.arc(x, y, radius * (0.42 + flash * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${flash * 0.5})`;
    ctx.fill();
  }
}

export function drawDroplet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: Rgb,
  alpha: number,
): void {
  const fade = Math.max(0, Math.min(1, alpha));
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = rgba(mixWhite(color, 0.35), fade * 0.82);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 255, 255, ${fade * 0.85})`;
  ctx.lineWidth = Math.max(1, radius * 0.32);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - radius * 0.28, y - radius * 0.32, Math.max(0.6, radius * 0.28), 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 255, 255, ${fade * 0.75})`;
  ctx.fill();
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
  alpha = 0.8,
): void {
  const halo = mixWhite(color, 0.28 + glow * 0.45);
  const cx = left + size * 0.5 + pullX * size;
  const cy = top + size * 0.52 + pullY * size;
  ctx.beginPath();
  ctx.arc(cx, cy, size * (0.42 + glow * 0.06), 0, Math.PI * 2);
  ctx.fillStyle = rgba(halo, 0.14 + glow * 0.38);
  ctx.fill();
  if (glow > 0.18) {
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.85, glow * 0.7)})`;
    ctx.lineWidth = Math.max(1.25, size * 0.035);
    ctx.stroke();
  }

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
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return;
  const midX = (x0 + x1) / 2;
  const midY = (y0 + y1) / 2;
  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(Math.atan2(dy, dx));
  const rx = length * 0.42 + radius * 0.35;
  const ry = radius;
  const gel = ctx.createLinearGradient(0, -ry, 0, ry);
  gel.addColorStop(0, rgba(mixWhite(color, 0.7), alpha * 0.55));
  gel.addColorStop(0.45, rgba(color, alpha * 0.78));
  gel.addColorStop(1, rgba(mixWhite(color, 0.25), alpha * 0.4));
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = gel;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -ry * 0.28, rx * 0.55, ry * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 255, 255, ${0.18 + alpha * 0.12})`;
  ctx.fill();
  ctx.restore();
}
