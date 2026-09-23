import { COLS } from '../fluid/grid';
import type { GameState } from '../game/engine';

export type SplashRing = {
  x: number;
  y: number;
  color: number;
  age: number;
  life: number;
  stamp: string;
};

export function captureClearRings(rings: SplashRing[], state: GameState): void {
  const pending = state.pending;
  if (!pending || pending.age > 0.06) return;
  const stamp = pending.rows.join(',');
  if (rings.some((ring) => ring.stamp === stamp && ring.age < 0.25)) return;
  for (const y of pending.rows) {
    const color = state.grid[y]?.[0]?.color ?? 0;
    rings.push({
      x: COLS / 2,
      y: y + 0.5,
      color,
      age: 0,
      life: 0.46,
      stamp,
    });
  }
}

export function advanceRings(rings: SplashRing[], dt: number): void {
  for (const ring of rings) ring.age += dt;
  const alive = rings.filter((ring) => ring.age < ring.life);
  rings.length = 0;
  rings.push(...alive);
}
