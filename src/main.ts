import { config } from './config';
import { createGame, updateGame, type GameEvent, type GameState } from './game/engine';
import { InputController, type Frame, type TapName } from './game/input';
import { createActive } from './game/piece';
import { Sfx, type SoundKind } from './ui/audio';
import { collectHud, syncHud } from './ui/hud';
import { renderBoard, renderPreview } from './ui/render';

const BEST_KEY = 'fluid-tetris-best';

function loadBest(): number {
  try {
    const value = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    /* Ignore private-mode storage failures. */
  }
}

function soundFor(event: GameEvent): SoundKind {
  switch (event.type) {
    case 'move':
      return 'move';
    case 'rotate':
      return 'rotate';
    case 'lock':
      return 'lock';
    case 'hard':
      return 'hard';
    case 'merge':
      return 'merge';
    case 'clear':
      return 'clear';
    case 'phase':
      return 'phase';
    case 'gameover':
      return 'gameover';
    default: {
      const neverEvent: never = event;
      return neverEvent;
    }
  }
}

function bindPad(input: InputController): void {
  document.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((button) => {
    const name = button.dataset.hold;
    if (name !== 'left' && name !== 'right' && name !== 'soft') return;
    const press = (event: PointerEvent) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      input.setHold(name, true);
    };
    const release = (event: PointerEvent) => {
      input.setHold(name, false);
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  });

  document.querySelectorAll<HTMLButtonElement>('[data-tap]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const tap = button.dataset.tap;
      if (tap === 'cw' || tap === 'ccw' || tap === 'hard' || tap === 'pause' || tap === 'restart') {
        input.tap(tap);
      }
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  });
}

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function boot(): void {
  const board = document.querySelector<HTMLCanvasElement>('#board');
  const next = document.querySelector<HTMLCanvasElement>('#next');
  if (!board || !next) throw new Error('Canvas missing');
  const hud = collectHud();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const input = new InputController(config.tuning.dasDelay, config.tuning.dasRepeat);
  const sfx = new Sfx();
  let game = createGame(loadBest());
  let savedBest = game.best;

  input.setMuteHandler(() => {
    const muted = sfx.toggle();
    syncHud(hud, game, muted);
  });
  input.attachCanvas(board);
  bindPad(input);
  board.addEventListener('pointerdown', () => {
    board.focus();
    sfx.resume();
  });

  hud.mute.addEventListener('click', () => {
    sfx.toggle();
    syncHud(hud, game, sfx.muted);
  });
  hud.overlayButton.addEventListener('click', () => {
    const action: TapName = game.status === 'paused' ? 'pause' : 'restart';
    input.tap(action);
    board.focus();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.status === 'playing') game.status = 'paused';
    syncHud(hud, game, sfx.muted);
  });

  const resize = () => {
    const boardCtx = fitCanvas(board);
    const nextCtx = fitCanvas(next);
    const boardRect = board.getBoundingClientRect();
    const nextRect = next.getBoundingClientRect();
    renderBoard(boardCtx, game, boardRect.width, boardRect.height, reducedMotion);
    renderPreview(nextCtx, game, nextRect.width, nextRect.height);
  };
  const observer = new ResizeObserver(() => resize());
  observer.observe(board);
  observer.observe(next);
  window.addEventListener('resize', resize);

  if (import.meta.env.DEV) {
    window.__fluid = {
      get state() {
        return game;
      },
      restart() {
        game = createGame(game.best);
      },
      demoClear() {
        const row = game.grid.length - 1;
        for (const line of game.grid) {
          for (const cell of line) {
            cell.color = -1;
            cell.glow = 0;
          }
        }
        for (let x = 0; x < 6; x += 1) {
          const cell = game.grid[row]?.[x];
          if (cell) cell.color = 0;
        }
        game.active = createActive('I', 0);
        game.active.x = 6;
        game.active.y = row - 1;
        game.chain = 0;
        game.pending = null;
        game.status = 'playing';
        this.step({ hard: true });
        return { score: game.score, lines: game.lines, pending: game.pending !== null };
      },
      step(partial: Partial<Frame>) {
        const frame: Frame = {
          dir: 0,
          shifts: 0,
          rotate: 0,
          soft: false,
          hard: false,
          pausePressed: false,
          restart: false,
          ...partial,
        };
        updateGame(game, frame, 0.016);
      },
    };
  }

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const polled = input.poll(dt);
    if (polled.restart) {
      game = createGame(game.best);
    } else {
      const events = updateGame(game, polled, dt);
      const played = new Set<SoundKind>();
      for (const event of events) {
        const kind = soundFor(event);
        if (played.has(kind)) continue;
        played.add(kind);
        sfx.play(kind);
      }
    }
    if (game.best !== savedBest) {
      savedBest = game.best;
      saveBest(game.best);
    }
    const boardCtx = fitCanvas(board);
    const nextCtx = fitCanvas(next);
    const boardRect = board.getBoundingClientRect();
    const nextRect = next.getBoundingClientRect();
    renderBoard(boardCtx, game, boardRect.width, boardRect.height, reducedMotion);
    renderPreview(nextCtx, game, nextRect.width, nextRect.height);
    syncHud(hud, game, sfx.muted);
    requestAnimationFrame(frame);
  };

  board.focus();
  requestAnimationFrame(frame);
}

declare global {
  interface Window {
    __fluid?: {
      readonly state: GameState;
      restart: () => void;
      demoClear: () => { score: number; lines: number; pending: boolean };
      step: (partial: Partial<Frame>) => void;
    };
  }
}

boot();
