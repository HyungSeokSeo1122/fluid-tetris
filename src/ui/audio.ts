export type SoundKind = 'move' | 'rotate' | 'lock' | 'merge' | 'clear' | 'gameover' | 'phase' | 'hard';

export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  toggle(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  resume(): void {
    if (this.muted) return;
    const ctx = this.context();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  play(kind: SoundKind): void {
    if (this.muted) return;
    try {
      const ctx = this.context();
      if (ctx.state === 'suspended') void ctx.resume();
      this.voice(ctx, kind);
    } catch {
      this.muted = true;
    }
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private voice(ctx: AudioContext, kind: SoundKind): void {
    switch (kind) {
      case 'move':
        this.tone(ctx, 210, 0.035, 'square', 0.025);
        break;
      case 'rotate':
        this.tone(ctx, 340, 0.05, 'triangle', 0.03);
        break;
      case 'hard':
        this.tone(ctx, 160, 0.09, 'sawtooth', 0.03, 0, 70);
        break;
      case 'lock':
        this.tone(ctx, 90, 0.08, 'sine', 0.05);
        break;
      case 'merge':
        this.tone(ctx, 420, 0.09, 'sine', 0.04, 0, 720);
        break;
      case 'clear':
        this.tone(ctx, 523, 0.14, 'triangle', 0.05);
        this.tone(ctx, 659, 0.16, 'triangle', 0.04, 0.04);
        this.tone(ctx, 784, 0.18, 'sine', 0.04, 0.08);
        break;
      case 'phase':
        this.tone(ctx, 520, 0.12, 'sine', 0.04, 0, 880);
        break;
      case 'gameover':
        this.tone(ctx, 220, 0.35, 'sawtooth', 0.04, 0, 55);
        break;
      default: {
        const neverKind: never = kind;
        throw new Error(`Unknown sound ${String(neverKind)}`);
      }
    }
  }

  private tone(
    ctx: AudioContext,
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
    slideTo?: number,
  ): void {
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + dur);
    }
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}
