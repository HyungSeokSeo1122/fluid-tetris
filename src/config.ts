/**
 * Designer balance file.
 *
 * Edit the four primary knobs first. They control the early game:
 * - fallSpeed: how fast the active piece descends (rows per second)
 * - viscosity: how thick the liquid is (higher = slower ooze and seep)
 * - colorPoolSize: how many palette entries can spawn (early game uses 3)
 * - colors: palette order. Early game uses the first colorPoolSize entries.
 *
 * Mid game starts after `midGame.afterLines` same-color clears and swaps in
 * faster fall, thinner viscosity, and a larger color pool.
 */
export type GameMode = 'early' | 'mid';

export const config = {
  fallSpeed: 1.05,
  viscosity: 6,
  colorPoolSize: 3,
  colors: [
    '#00E5FF',
    '#FF2D95',
    '#FFB020',
    '#7CFF3A',
    '#A78BFA',
  ],

  midGame: {
    afterLines: 4,
    fallSpeed: 1.9,
    viscosity: 2.4,
    colorPoolSize: 5,
  },

  scoring: {
    /** Index is the number of rows cleared at once. */
    lineBase: [0, 100, 300, 600, 1000],
    /** Added per row beyond the table above. */
    extraRowBase: 400,
    /** Chain multiplier step: chain 2 => 1.5x, chain 3 => 2x, and so on. */
    chainStep: 0.5,
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
    seepViscosityScale: 0.1,
    oozeViscosityScale: 0.12,
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
  mode: GameMode;
};

function clampPool(size: number): number {
  return Math.max(1, Math.min(size, config.colors.length));
}

export function liveBalance(mode: GameMode): LiveBalance {
  switch (mode) {
    case 'early':
      return {
        fallSpeed: config.fallSpeed,
        viscosity: config.viscosity,
        colorPoolSize: clampPool(config.colorPoolSize),
        mode,
      };
    case 'mid':
      return {
        fallSpeed: config.midGame.fallSpeed,
        viscosity: config.midGame.viscosity,
        colorPoolSize: clampPool(config.midGame.colorPoolSize),
        mode,
      };
    default: {
      const neverMode: never = mode;
      return neverMode;
    }
  }
}

export const COLOR_NAMES = ['Cyan', 'Magenta', 'Amber', 'Lime', 'Violet'] as const;
