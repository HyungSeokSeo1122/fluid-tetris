export type HoldName = 'left' | 'right' | 'soft';
export type TapName = 'cw' | 'ccw' | 'hard' | 'pause' | 'restart';

export type Frame = {
  dir: -1 | 0 | 1;
  shifts: number;
  rotate: -1 | 0 | 1;
  soft: boolean;
  hard: boolean;
  pausePressed: boolean;
  restart: boolean;
};

type QueuedShift = { dir: -1 | 1; count: number };

const GAME_CODES = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowDown',
  'ArrowUp',
  'KeyX',
  'KeyZ',
  'Space',
  'KeyP',
  'Escape',
  'KeyR',
  'KeyM',
]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export class InputController {
  private readonly held = new Set<HoldName>();
  private readonly pending: TapName[] = [];
  private readonly queuedShifts: QueuedShift[] = [];
  private dasDir: -1 | 0 | 1 = 0;
  private dasTimer = 0;
  private dasCharged = false;
  private tappedDir: -1 | 0 | 1 = 0;
  private clock = 0;
  private softUntil = 0;
  private muteHandler: (() => void) | null = null;
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onKeyUp: (event: KeyboardEvent) => void;
  private readonly onBlur: () => void;

  constructor(
    private readonly dasDelay: number,
    private readonly dasRepeat: number,
  ) {
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onKeyUp = (event) => this.handleKeyUp(event);
    this.onBlur = () => {
      this.held.clear();
      this.dasDir = 0;
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  setMuteHandler(handler: () => void): void {
    this.muteHandler = handler;
  }

  setHold(name: HoldName, down: boolean): void {
    if (down) {
      this.held.add(name);
      if (name === 'left') this.tappedDir = -1;
      else if (name === 'right') this.tappedDir = 1;
      else this.softUntil = this.clock + 0.14;
    } else {
      this.held.delete(name);
    }
  }

  tap(name: TapName): void {
    this.pending.push(name);
  }

  nudge(dir: -1 | 1, count: number): void {
    this.queuedShifts.push({ dir, count: Math.max(1, count) });
  }

  attachCanvas(canvas: HTMLCanvasElement): void {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      tracking = true;
      startX = event.clientX;
      startY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });

    const finish = (event: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (adx < 14 && ady < 14) {
        this.tap('cw');
        return;
      }
      if (ady > adx && dy > 28) {
        if (dy > 88) this.tap('hard');
        else this.setHold('soft', true);
        window.setTimeout(() => this.setHold('soft', false), 90);
        return;
      }
      if (adx > ady && adx > 20) {
        const dir: -1 | 1 = dx > 0 ? 1 : -1;
        const steps = Math.max(1, Math.min(6, Math.round(adx / 36)));
        this.nudge(dir, steps);
      }
    };

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', () => {
      tracking = false;
    });
  }

  poll(dt: number): Frame {
    this.clock += dt;
    const left = this.held.has('left');
    const right = this.held.has('right');
    let dir: -1 | 0 | 1 = 0;
    if (left && !right) dir = -1;
    else if (right && !left) dir = 1;

    let shifts = 0;
    if (dir === 0) {
      this.dasDir = 0;
      this.dasTimer = 0;
      this.dasCharged = false;
    } else if (dir !== this.dasDir) {
      this.dasDir = dir;
      this.dasTimer = 0;
      this.dasCharged = false;
      shifts = 1;
    } else {
      this.dasTimer += dt;
      const wait = this.dasCharged ? this.dasRepeat : this.dasDelay;
      if (this.dasTimer >= wait) {
        this.dasTimer = 0;
        this.dasCharged = true;
        shifts = 1;
      }
    }

    if (shifts === 0 && this.tappedDir !== 0) {
      dir = this.tappedDir;
      shifts = 1;
    }
    this.tappedDir = 0;

    if (this.queuedShifts.length > 0) {
      const next = this.queuedShifts.shift();
      if (next) {
        dir = next.dir;
        shifts += next.count;
      }
    }

    let rotate: -1 | 0 | 1 = 0;
    let hard = false;
    let pausePressed = false;
    let restart = false;
    for (const tap of this.pending) {
      switch (tap) {
        case 'cw':
          rotate = 1;
          break;
        case 'ccw':
          rotate = -1;
          break;
        case 'hard':
          hard = true;
          break;
        case 'pause':
          pausePressed = true;
          break;
        case 'restart':
          restart = true;
          break;
        default: {
          const neverTap: never = tap;
          throw new Error(`Unknown tap ${String(neverTap)}`);
        }
      }
    }
    this.pending.length = 0;

    return {
      dir,
      shifts,
      rotate,
      soft: this.held.has('soft') || this.clock < this.softUntil,
      hard,
      pausePressed,
      restart,
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return;
    if (!GAME_CODES.has(event.code)) return;
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    switch (event.code) {
      case 'ArrowLeft':
        this.setHold('left', true);
        break;
      case 'ArrowRight':
        this.setHold('right', true);
        break;
      case 'ArrowDown':
        this.setHold('soft', true);
        break;
      case 'ArrowUp':
      case 'KeyX':
        this.tap('cw');
        break;
      case 'KeyZ':
        this.tap('ccw');
        break;
      case 'Space':
        this.tap('hard');
        break;
      case 'KeyP':
      case 'Escape':
        this.tap('pause');
        break;
      case 'KeyR':
        this.tap('restart');
        break;
      case 'KeyM':
        this.muteHandler?.();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private handleKeyUp(event: KeyboardEvent): void {
    switch (event.code) {
      case 'ArrowLeft':
        this.setHold('left', false);
        break;
      case 'ArrowRight':
        this.setHold('right', false);
        break;
      case 'ArrowDown':
        this.setHold('soft', false);
        break;
      default:
        break;
    }
  }
}
