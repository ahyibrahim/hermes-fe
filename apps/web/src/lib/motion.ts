import { cubicOut } from 'svelte/easing';
import { fade, fly, scale } from 'svelte/transition';
import type { FadeParams, FlyParams, ScaleParams, TransitionConfig } from 'svelte/transition';

/** Mirrors CSS --motion-* tokens in app.css */
export const motionMs = {
  fast: 120,
  base: 200,
  slow: 320,
  scene: 480
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function duration(full: number, reduced = 80): number {
  return prefersReducedMotion() ? reduced : full;
}

/** Menus, nested popups, hover cards — slight rise. */
export function popup(node: Element, params?: FlyParams): TransitionConfig {
  if (prefersReducedMotion()) {
    return fade(node, { duration: duration(motionMs.fast), ...params });
  }
  return fly(node, {
    y: -6,
    duration: duration(motionMs.base),
    easing: cubicOut,
    ...params
  });
}

/** Full-screen / dimmed backdrops. */
export function backdrop(node: Element, params?: FadeParams): TransitionConfig {
  return fade(node, { duration: duration(motionMs.base), ...params });
}

/** Modal / overlay panels over a backdrop. */
export function panel(node: Element, params?: ScaleParams): TransitionConfig {
  if (prefersReducedMotion()) {
    return fade(node, { duration: duration(motionMs.fast) });
  }
  return scale(node, {
    start: 0.96,
    duration: duration(motionMs.slow),
    easing: cubicOut,
    ...params
  });
}

/** Soft fade for rail bodies, typing, jump chip, settings blocks. */
export function soft(node: Element, params?: FadeParams): TransitionConfig {
  return fade(node, { duration: duration(motionMs.base), ...params });
}

/** Toasts — rise from below. */
export function toast(node: Element, params?: FlyParams): TransitionConfig {
  if (prefersReducedMotion()) {
    return fade(node, { duration: duration(motionMs.fast) });
  }
  return fly(node, {
    y: 14,
    duration: duration(motionMs.slow),
    easing: cubicOut,
    ...params
  });
}

/** Call drawer / vertical sections. */
export function drawer(node: Element, params?: FlyParams): TransitionConfig {
  if (prefersReducedMotion()) {
    return fade(node, { duration: duration(motionMs.fast) });
  }
  return fly(node, {
    y: -10,
    duration: duration(motionMs.base),
    easing: cubicOut,
    ...params
  });
}
