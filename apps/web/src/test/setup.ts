import { afterEach, vi } from 'vitest';
import { installMatchMedia, resetViewport } from './viewport';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => undefined) }));

vi.mock('$lib/sfx', () => ({
  bindSfxUnlock: () => () => undefined,
  playSfx: () => undefined,
  unlockSfx: () => undefined,
}));

vi.mock('$lib/client', async () => {
  const harness = await import('./harness');
  return {
    getSession: () => harness.currentSession(),
    getFileIO: () => harness.currentFileIO(),
    getTokens: () => harness.currentTokens(),
    resetClient: () => undefined,
    signOut: async () => undefined,
    downloadAttachment: async () => undefined,
  };
});

installMatchMedia();

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

// jsdom has no Web Animations API; Svelte transitions only need onfinish/cancel.
Element.prototype.animate ??= function animate(): Animation {
  const animation = {
    onfinish: null as null | (() => void),
    currentTime: 0,
    cancel() {},
    play() {},
    pause() {},
    finish() {},
  };
  setTimeout(() => animation.onfinish?.(), 0);
  return animation as unknown as Animation;
};
Element.prototype.getAnimations ??= () => [];
Element.prototype.scrollTo ??= function scrollTo(): void {};

afterEach(() => {
  resetViewport();
  localStorage.clear();
});
