import { config, stageTitle } from '../config';

const GATES_KEY = 'fluid-tetris-stage-gates';

export type StageGates = {
  stage2: number;
  stage3: number;
};

export const DEFAULT_GATES: StageGates = { stage2: 4, stage3: 8 };

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function clampGates(stage2: number, stage3: number): StageGates {
  const next2 = clampInt(stage2, 1, 98, DEFAULT_GATES.stage2);
  let next3 = clampInt(stage3, 2, 99, DEFAULT_GATES.stage3);
  if (next3 <= next2) next3 = Math.min(99, next2 + 1);
  return { stage2: next2, stage3: next3 };
}

export function loadGates(): StageGates {
  try {
    const raw = localStorage.getItem(GATES_KEY);
    if (!raw) return { ...DEFAULT_GATES };
    const parsed = JSON.parse(raw) as { stage2?: unknown; stage3?: unknown };
    return clampGates(Number(parsed.stage2), Number(parsed.stage3));
  } catch {
    return { ...DEFAULT_GATES };
  }
}

export function saveGates(gates: StageGates): StageGates {
  const next = clampGates(gates.stage2, gates.stage3);
  try {
    localStorage.setItem(GATES_KEY, JSON.stringify(next));
  } catch {
    /* Ignore private-mode storage failures. */
  }
  return next;
}

/** Writes stage 2 and stage 3 line gates. Speed and viscosity stay in config. */
export function applyGates(gates: StageGates): void {
  const next = clampGates(gates.stage2, gates.stage3);
  config.stages[1].afterLines = next.stage2;
  config.stages[2].afterLines = next.stage3;
}

function required<T extends Element>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node as T;
}

function paint(stage2: HTMLInputElement, stage3: HTMLInputElement, note: HTMLElement, gates: StageGates): void {
  stage2.value = String(gates.stage2);
  stage3.value = String(gates.stage3);
  note.textContent = `${stageTitle('stage2')} at ${gates.stage2} rows · ${stageTitle('stage3')} at ${gates.stage3} rows`;
}

export function bindStageGates(onChange: (gates: StageGates) => void): StageGates {
  const stage2 = required<HTMLInputElement>('#gate-stage2');
  const stage3 = required<HTMLInputElement>('#gate-stage3');
  const reset = required<HTMLButtonElement>('#gate-reset');
  const note = required<HTMLElement>('#gate-note');
  const initial = loadGates();
  applyGates(initial);
  paint(stage2, stage3, note, initial);

  const commit = () => {
    const next = saveGates(clampGates(Number(stage2.value), Number(stage3.value)));
    applyGates(next);
    paint(stage2, stage3, note, next);
    onChange(next);
  };

  stage2.addEventListener('change', commit);
  stage3.addEventListener('change', commit);
  reset.addEventListener('click', () => {
    const next = saveGates({ ...DEFAULT_GATES });
    applyGates(next);
    paint(stage2, stage3, note, next);
    onChange(next);
  });

  return initial;
}
