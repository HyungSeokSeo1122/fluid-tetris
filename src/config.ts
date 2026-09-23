/**
 * Designer balance file.
 *
 * Four knobs sit at the top. They are stage 1, and the checks keep them
 * equal to `stages[0]`:
 * - fallSpeed: rows per second for the active piece
 * - viscosity: thickness dial. Higher = slower ooze and seep
 * - colorPoolSize: how many leading `colors` can spawn
 * - colors: palette order (cyan, magenta, amber, lime, violet)
 *
 * A run does not stay on those knobs. `stages` is the level table. Each
 * later stage replaces fall speed, viscosity, and the color pool after
 * `afterLines` same-color rows have been cleared.
 */
export type StageId = 'stage1' | 'stage2' | 'stage3';

export type StageBalance = {
  id: StageId;
  /** Cleared rows required before this stage becomes active. */
  afterLines: number;
  fallSpeed: number;
  viscosity: number;
  colorPoolSize: number;
};

export const config = {
  fallSpeed: 0.6,
  viscosity: 0.85,
  colorPoolSize: 3,
  colors: [
    '#00E5FF',
    '#FF2D95',
    '#FFB020',
    '#7CFF3A',
    '#A78BFA',
  ],

  stages: [
    { id: 'stage1', afterLines: 0, fallSpeed: 0.6, viscosity: 0.85, colorPoolSize: 3 },
    { id: 'stage2', afterLines: 4, fallSpeed: 0.9, viscosity: 0.6, colorPoolSize: 4 },
    { id: 'stage3', afterLines: 8, fallSpeed: 1.2, viscosity: 0.4, colorPoolSize: 5 },
  ] satisfies [StageBalance, StageBalance, StageBalance],

  scoring: {
    /** Index is the number of rows cleared at once. */
    lineBase: [0, 100, 300, 600, 1000],
    /** Added per row beyond the table above. */
    extraRowBase: 400,
    /**
     * Multiplier for clearing this many rows at once.
     * 2 rows → ×1.5, 3 rows → ×2.5. 4 rows is ×4 so a quad stays above a triple.
     */
    rowMultiplier: [1, 1, 1.5, 2.5, 4],
    /** Each merge after the first adds this much to the clear multiplier. */
    chainStep: 0.25,
    chainWindow: 3.5,
    mergeBonus: 25,
    softDropPoint: 1,
    hardDropPoint: 2,
  },

  tuning: {
    softDropFactor: 10,
    lockDelay: 0.5,
    maxLockResets: 12,
    gravityInterval: 0.1,
    seepBase: 0.06,
    /**
     * Seconds between slumps ≈ seepBase + viscosity × seepViscosityScale.
     * Stage 1 (0.85) seeps about every 0.65s. Stage 3 (0.4) about every 0.34s.
     */
    seepViscosityScale: 0.7,
    /**
     * Seconds between active drips ≈ viscosity × oozeViscosityScale.
     * Stage 1 drips about every 0.72s. Stage 3 about every 0.34s.
     */
    oozeViscosityScale: 0.85,
    clearFlash: 0.22,
    slideDuration: 0.12,
    dasDelay: 0.17,
    dasRepeat: 0.045,
  },
};

export type LiveBalance = {
  fallSpeed: number;
  viscosity: number;
  colorPoolSize: number;
  mode: StageId;
};

function clampPool(size: number): number {
  return Math.max(1, Math.min(size, config.colors.length));
}

export function stageById(id: StageId): StageBalance {
  for (const stage of config.stages) {
    if (stage.id === id) return stage;
  }
  switch (id) {
    case 'stage1':
    case 'stage2':
    case 'stage3':
      throw new Error(`Missing stage ${id}`);
    default: {
      const neverId: never = id;
      return neverId;
    }
  }
}

/** Latest stage whose cleared-row gate has been reached. */
export function stageForLines(lines: number): StageBalance {
  let best = stageById('stage1');
  for (const stage of config.stages) {
    if (lines >= stage.afterLines && stage.afterLines >= best.afterLines) best = stage;
  }
  return best;
}

export function liveBalance(stageId: StageId): LiveBalance {
  const stage = stageById(stageId);
  switch (stageId) {
    case 'stage1':
    case 'stage2':
    case 'stage3':
      return {
        fallSpeed: stage.fallSpeed,
        viscosity: stage.viscosity,
        colorPoolSize: clampPool(stage.colorPoolSize),
        mode: stageId,
      };
    default: {
      const neverId: never = stageId;
      return neverId;
    }
  }
}

export function stageTitle(id: StageId): string {
  switch (id) {
    case 'stage1':
      return 'Stage 1';
    case 'stage2':
      return 'Stage 2';
    case 'stage3':
      return 'Stage 3';
    default: {
      const neverId: never = id;
      return neverId;
    }
  }
}

export const COLOR_NAMES = ['Cyan', 'Magenta', 'Amber', 'Lime', 'Violet'] as const;
