import { config } from '../config';

/** ×1, ×1.5 for 2 rows, ×2.5 for 3 rows. Counts past the table keep the last value. */
export function rowClearMultiplier(rows: number): number {
  if (rows <= 1) return 1;
  const table = config.scoring.rowMultiplier;
  const listed = table[rows];
  if (listed !== undefined) return listed;
  return table[table.length - 1] ?? 1;
}

/** First contact is ×1. Each later merge adds `chainStep` (0.25). */
export function chainMultiplier(chain: number): number {
  if (chain < 2) return 1;
  return 1 + config.scoring.chainStep * (chain - 1);
}

export function lineScore(rows: number, chain: number): number {
  if (rows <= 0) return 0;
  const bases = config.scoring.lineBase;
  const listed = bases[rows];
  const base =
    listed !== undefined
      ? listed
      : (bases[bases.length - 1] ?? 0) + (rows - (bases.length - 1)) * config.scoring.extraRowBase;
  return Math.round(base * rowClearMultiplier(rows) * chainMultiplier(chain));
}

export function mergePoints(chain: number): number {
  return config.scoring.mergeBonus * Math.max(1, chain);
}
