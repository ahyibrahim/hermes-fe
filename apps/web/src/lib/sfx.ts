import { readNotifyMuted } from '$lib/ui';

export const SFX_NAMES = ['send', 'receive', 'join', 'leave', 'mute', 'unmute'] as const;
export type SfxName = (typeof SFX_NAMES)[number];

const SRC: Record<SfxName, string> = {
  send: '/sounds/send.ogg',
  receive: '/sounds/receive.ogg',
  join: '/sounds/join.ogg',
  leave: '/sounds/leave.ogg',
  mute: '/sounds/mute.ogg',
  unmute: '/sounds/unmute.ogg',
};

const cache = new Map<SfxName, HTMLAudioElement>();
let unlocked = false;

function player(name: SfxName): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') {
    return null;
  }
  let el = cache.get(name);
  if (!el) {
    el = new Audio(SRC[name]);
    el.preload = 'auto';
    cache.set(name, el);
  }
  return el;
}

export function unlockSfx(): void {
  if (unlocked || typeof Audio === 'undefined') {
    return;
  }
  unlocked = true;
  const el = player('send');
  if (!el) {
    return;
  }
  const previous = el.volume;
  el.volume = 0;
  void el
    .play()
    .then(() => {
      el.pause();
      el.currentTime = 0;
      el.volume = previous;
    })
    .catch(() => {
      unlocked = false;
    });
}

export function bindSfxUnlock(): () => void {
  if (typeof document === 'undefined') {
    return () => undefined;
  }
  const onFirst = (): void => {
    unlockSfx();
  };
  document.addEventListener('pointerdown', onFirst, { once: true, capture: true });
  document.addEventListener('keydown', onFirst, { once: true, capture: true });
  return () => {
    document.removeEventListener('pointerdown', onFirst, { capture: true });
    document.removeEventListener('keydown', onFirst, { capture: true });
  };
}

export function playSfx(name: SfxName): void {
  if (readNotifyMuted()) {
    return;
  }
  const el = player(name);
  if (!el) {
    return;
  }
  try {
    el.currentTime = 0;
    void el.play().catch(() => undefined);
  } catch {
    // Autoplay until a gesture; the next cue after click will work.
  }
}
