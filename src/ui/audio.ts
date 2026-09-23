const MUTE_KEY = 'fluid-tetris-muted';

export type SoundKind = 'move' | 'rotate' | 'lock' | 'merge' | 'clear' | 'gameover' | 'phase' | 'hard' | 'tick';

export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  toggle(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* Ignore private-mode storage failures. */
    }
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
      case 'tick':
        this.tone(ctx, 920, 0.028, 'sine', 0.016);
        break;
      case 'merge':
        this.tone(ctx, 760, 0.07, 'sine', 0.05, 0, 1240);
        this.tone(ctx, 1520, 0.045, 'triangle', 0.018, 0.03);
        break;
      case 'clear':
        this.splash(ctx, 0.2, 0.055);
        this.tone(ctx, 523, 0.12, 'sine', 0.04, 0, 880);
        this.tone(ctx, 784, 0.14, 'triangle', 0.03, 0.045);
        break;
      case 'phase':
        this.tone(ctx, 520, 0.12, 'sine', 0.04, 0, 880);
        break;
      case 'gameover':
        this.tone(ctx, 311, 0.26, 'triangle', 0.045, 0, 196);
        this.tone(ctx, 233, 0.34, 'sine', 0.04, 0.12, 110);
        this.tone(ctx, 92, 0.42, 'sine', 0.05, 0.26);
        break;
      default: {
        const neverKind: never = kind;
        throw new Error(`Unknown sound ${String(neverKind)}`);
      }
    }
  }

  private splash(ctx: AudioContext, dur: number, gain: number): void {
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const env = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * env * env;
    }
    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, start);
    filter.frequency.exponentialRampToValueAtTime(420, start + dur);
    filter.Q.value = 0.7;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(ctx.destination);
    source.start(start);
    source.stop(start + dur + 0.02);
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
