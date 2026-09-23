import { config } from '../config';

export function lineScore(rows: number, chain: number): number {
  if (rows <= 0) return 0;
  const bases = config.scoring.lineBase;
  const listed = bases[rows];
  const base =
    listed !== undefined
      ? listed
      : (bases[bases.length - 1] ?? 0) + (rows - (bases.length - 1)) * config.scoring.extraRowBase;
  const rowMultiplier = rows >= 2 ? rows : 1;
  const chainMultiplier = chain >= 2 ? 1 + config.scoring.chainStep * (chain - 1) : 1;
  return Math.round(base * rowMultiplier * chainMultiplier);
}

export function mergePoints(chain: number): number {
  return config.scoring.mergeBonus * Math.max(1, chain);
}
