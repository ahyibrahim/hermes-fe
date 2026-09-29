import { tick } from 'svelte';
import { motionMs, prefersReducedMotion } from '$lib/motion';

/** Keeps the transcript pinned to the latest message while the reader is caught up. */
export class ScrollPin {
  scroller = $state<HTMLDivElement | undefined>();
  stickToBottom = $state(true);
  showJump = $state(false);
  private ignoreScroll = false;
  private pinScrollTimer: ReturnType<typeof setTimeout> | null = null;

  /** `onCaughtUp` runs when the reader returns to the bottom. */
  constructor(private readonly onCaughtUp: () => void) {}

  atBottom(): boolean {
    if (!this.scroller) {
      return true;
    }
    return this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight < 80;
  }

  onTranscriptScroll = (): void => {
    if (!this.scroller || this.ignoreScroll) {
      return;
    }
    const wasCaughtUp = this.stickToBottom;
    this.stickToBottom = this.atBottom();
    this.showJump = !this.stickToBottom;
    if (!wasCaughtUp && this.stickToBottom) {
      this.onCaughtUp();
    }
  };

  pinToLatest(behavior: ScrollBehavior = 'auto'): void {
    if (!this.scroller || !this.stickToBottom) {
      return;
    }
    this.ignoreScroll = true;
    if (this.pinScrollTimer) {
      clearTimeout(this.pinScrollTimer);
      this.pinScrollTimer = null;
    }

    const finish = (): void => {
      this.ignoreScroll = false;
      this.showJump = false;
      this.pinScrollTimer = null;
    };

    const useSmooth = behavior === 'smooth' && !prefersReducedMotion();
    if (useSmooth) {
      const apply = (): void => {
        if (this.scroller && this.stickToBottom) {
          this.scroller.scrollTo({ top: this.scroller.scrollHeight, behavior: 'smooth' });
        }
      };
      apply();
      requestAnimationFrame(apply);
      this.pinScrollTimer = setTimeout(finish, motionMs.slow + 80);
      return;
    }

    const apply = (): void => {
      if (this.scroller && this.stickToBottom) {
        this.scroller.scrollTop = this.scroller.scrollHeight;
      }
    };
    apply();
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(() => {
        apply();
        finish();
      });
    });
  }

  jumpToLatest = (): void => {
    this.stickToBottom = true;
    this.showJump = false;
    this.pinToLatest('smooth');
    this.onCaughtUp();
  };

  /**
   * Pin on transcript changes and on resize. Call during component init.
   * `messages` is read only so the effect re-runs when the transcript changes.
   */
  track(messages: () => unknown, phase: () => 'idle' | 'leaving' | 'entering'): void {
    $effect(() => {
      messages();
      if (!this.scroller) {
        return;
      }
      if (this.stickToBottom) {
        const behavior: ScrollBehavior =
          phase() === 'idle' ? 'smooth' : 'auto';
        void tick().then(() => this.pinToLatest(behavior));
      } else {
        this.showJump = true;
      }
    });

    $effect(() => {
      const root = this.scroller;
      if (!root) {
        return;
      }
      const inner = root.firstElementChild;
      if (!(inner instanceof HTMLElement)) {
        return;
      }
      const ro = new ResizeObserver(() => {
        if (!this.stickToBottom || !this.scroller) {
          return;
        }
        // A smooth pin is already moving. Keep it smooth so a resize does not snap over it.
        if (this.pinScrollTimer) {
          this.scroller.scrollTo({ top: this.scroller.scrollHeight, behavior: 'smooth' });
          return;
        }
        this.pinToLatest('auto');
      });
      ro.observe(inner);
      ro.observe(root);
      return () => ro.disconnect();
    });

    $effect(() => {
      const viewport = window.visualViewport;
      if (!viewport) {
        return;
      }
      let lastHeight = viewport.height;
      const apply = (): void => {
        const height = `${viewport.height}px`;
        document.documentElement.style.height = height;
        document.body.style.height = height;
        document.body.style.transform = viewport.offsetTop ? `translateY(${viewport.offsetTop}px)` : '';
        if (viewport.height !== lastHeight && this.stickToBottom) {
          lastHeight = viewport.height;
          this.pinToLatest('auto');
        } else {
          lastHeight = viewport.height;
        }
      };
      apply();
      viewport.addEventListener('resize', apply);
      viewport.addEventListener('scroll', apply);
      return () => {
        viewport.removeEventListener('resize', apply);
        viewport.removeEventListener('scroll', apply);
        document.documentElement.style.height = '';
        document.body.style.height = '';
        document.body.style.transform = '';
      };
    });
  }
}
