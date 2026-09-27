import type { MessageRecord } from '@hermes/core';
import { tick } from 'svelte';
import { motionMs, prefersReducedMotion } from '$lib/motion';
import type { ScrollPin } from './scroll-pin.svelte';

export type TranscriptPhase = 'idle' | 'leaving' | 'entering';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The rendered transcript. During a room switch it keeps showing the old room
 * until the new room's history is ready, then crossfades.
 */
export class TranscriptBuffer {
  /** Rendered transcript buffer — held across room switches until history is ready. */
  displayMessages = $state<MessageRecord[]>([]);
  transcriptPhase = $state<TranscriptPhase>('idle');
  pendingRoom = $state<string | null>(null);
  roomSwitchGen = 0;
  /** IDs allowed to play enter motion — live appends only, never room-history remounts. */
  readonly liveEnterIds = new Set<number>();

  constructor(private readonly pin: ScrollPin) {}

  clearDisplayTranscript(): void {
    this.pendingRoom = null;
    this.transcriptPhase = 'idle';
    this.liveEnterIds.clear();
    this.displayMessages = [];
  }

  markLiveEnter(id: number): void {
    this.liveEnterIds.add(id);
  }

  pruneLiveEnterIds(messages: MessageRecord[]): void {
    const keep = new Set(messages.map((message) => message.id));
    for (const id of this.liveEnterIds) {
      if (!keep.has(id)) {
        this.liveEnterIds.delete(id);
      }
    }
  }

  shouldAnimateEnter = (id: number): boolean => {
    return this.liveEnterIds.has(id);
  };

  async commitTranscript(next: MessageRecord[], room: string, gen: number): Promise<void> {
    const reduced = prefersReducedMotion();
    const outMs = reduced ? 80 : motionMs.fast;
    const inMs = reduced ? 80 : motionMs.base;

    if (this.displayMessages.length > 0) {
      this.transcriptPhase = 'leaving';
      await sleep(outMs);
    }
    if (gen !== this.roomSwitchGen || (this.pendingRoom && this.pendingRoom !== room)) {
      return;
    }

    this.displayMessages = next;
    this.pendingRoom = null;
    this.pin.stickToBottom = true;
    this.pin.showJump = false;
    this.liveEnterIds.clear();
    this.transcriptPhase = 'entering';
    await tick();
    this.pin.pinToLatest('auto');
    await sleep(inMs);
    if (gen === this.roomSwitchGen && this.transcriptPhase === 'entering') {
      this.transcriptPhase = 'idle';
    }
  }
}
