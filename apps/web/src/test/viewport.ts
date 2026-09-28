import { PHONE_MAX_WIDTH_MQ } from '$lib/ui';

type Listener = (event: MediaQueryListEvent) => void;

let phone = false;
const listeners = new Set<Listener>();

function mediaQueryList(query: string): MediaQueryList {
  const isPhoneQuery = query === PHONE_MAX_WIDTH_MQ;
  return {
    media: query,
    get matches() {
      return isPhoneQuery ? phone : false;
    },
    onchange: null,
    addEventListener(_type: string, listener: Listener) {
      if (isPhoneQuery) {
        listeners.add(listener);
      }
    },
    removeEventListener(_type: string, listener: Listener) {
      listeners.delete(listener);
    },
    addListener(listener: Listener) {
      if (isPhoneQuery) {
        listeners.add(listener);
      }
    },
    removeListener(listener: Listener) {
      listeners.delete(listener);
    },
    dispatchEvent() {
      return true;
    },
  } as unknown as MediaQueryList;
}

export function installMatchMedia(): void {
  window.matchMedia = mediaQueryList;
}

/** Flip the phone breakpoint and notify ChatShell's `change` listener. */
export function setPhoneViewport(next: boolean): void {
  if (phone === next) {
    return;
  }
  phone = next;
  const event = { matches: next, media: PHONE_MAX_WIDTH_MQ } as MediaQueryListEvent;
  for (const listener of [...listeners]) {
    listener(event);
  }
}

export function resetViewport(): void {
  phone = false;
  listeners.clear();
}
