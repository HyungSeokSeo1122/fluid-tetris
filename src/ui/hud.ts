import { COLOR_NAMES, config, liveBalance } from '../config';
import type { GameState } from '../game/engine';

export type HudNodes = {
  score: HTMLElement;
  best: HTMLElement;
  phase: HTMLElement;
  chain: HTMLElement;
  lines: HTMLElement;
  nextLabel: HTMLElement;
  swatches: HTMLElement;
  overlay: HTMLElement;
  overlayTitle: HTMLElement;
  overlayBody: HTMLElement;
  overlayButton: HTMLButtonElement;
  mute: HTMLButtonElement;
};

function required<T extends Element>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node as T;
}

export function collectHud(): HudNodes {
  return {
    score: required('#score'),
    best: required('#best'),
    phase: required('#phase'),
    chain: required('#chain'),
    lines: required('#lines'),
    nextLabel: required('#next-label'),
    swatches: required('#swatches'),
    overlay: required('#overlay'),
    overlayTitle: required('#overlay-title'),
    overlayBody: required('#overlay-body'),
    overlayButton: required('#overlay-btn'),
    mute: required('#mute'),
  };
}

export function syncHud(nodes: HudNodes, state: GameState, muted: boolean): void {
  const balance = liveBalance(state.mode);
  nodes.score.textContent = state.score.toLocaleString();
  nodes.best.textContent = state.best.toLocaleString();
  nodes.lines.textContent = `Rows cleared ${state.lines}`;
  nodes.phase.textContent =
    state.mode === 'early'
      ? `Early · viscosity ${balance.viscosity.toFixed(1)} · fall ${balance.fallSpeed.toFixed(2)}`
      : `Mid · viscosity ${balance.viscosity.toFixed(1)} · fall ${balance.fallSpeed.toFixed(2)}`;
  if (state.chain >= 2) nodes.chain.textContent = `Chain ×${state.chain}`;
  else if (state.chain === 1) nodes.chain.textContent = 'Chain started';
  else nodes.chain.textContent = 'No chain';
  nodes.nextLabel.textContent = COLOR_NAMES[state.next.color] ?? 'Next';

  const signature = `${balance.colorPoolSize}:${state.next.color}`;
  if (nodes.swatches.dataset.pool !== signature) {
    nodes.swatches.dataset.pool = signature;
    nodes.swatches.replaceChildren();
    config.colors.forEach((hex, index) => {
      const dot = document.createElement('span');
      dot.className = 'swatch';
      dot.style.background = hex;
      dot.title = COLOR_NAMES[index] ?? hex;
      if (index >= balance.colorPoolSize) dot.classList.add('inactive');
      if (index === state.next.color) dot.classList.add('current');
      nodes.swatches.appendChild(dot);
    });
  }

  nodes.mute.textContent = muted ? 'Sound off' : 'Sound on';
  nodes.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');

  switch (state.status) {
    case 'playing':
      nodes.overlay.classList.add('hidden');
      break;
    case 'paused':
      nodes.overlay.classList.remove('hidden');
      nodes.overlayTitle.textContent = 'Paused';
      nodes.overlayBody.textContent = 'The liquid is holding its shape.';
      nodes.overlayButton.textContent = 'Resume';
      break;
    case 'gameover':
      nodes.overlay.classList.remove('hidden');
      nodes.overlayTitle.textContent = 'Game over';
      nodes.overlayBody.textContent = `Spawn zone flooded. Score ${state.score.toLocaleString()}.`;
      nodes.overlayButton.textContent = 'Play again';
      break;
    default: {
      const neverStatus: never = state.status;
      throw new Error(`Unknown status ${String(neverStatus)}`);
    }
  }
}
