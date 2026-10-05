import type { IceCandidatePayload, IceServer, SessionDescriptionPayload } from '@hermes/core';
import type { VoiceHost } from './mesh';

/** Same public STUN default the tailnet app uses when no TURN server is set. */
export const PUBLIC_STUN: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

type Frame = {
  type?: string;
  room?: string;
  user?: string;
  users?: string[];
  guests?: string[];
  guest?: boolean;
  sharing?: string | null;
  from?: string;
  sdp?: SessionDescriptionPayload;
  candidate?: IceCandidatePayload | null;
  message?: string;
  content?: string;
};

/**
 * Call signaling for an admitted guest. The gateway does not serve /ice, so this
 * uses the public STUN server and the guest websocket already on the page.
 */
export class GuestVoiceLink implements VoiceHost {
  private readonly listeners = new Map<string, Set<(payload: never) => void>>();

  constructor(
    private readonly current: () => WebSocket | undefined,
    private readonly username: string
  ) {}

  /** Follow a replacement socket. An already-open socket does not emit status. */
  attach(socket: WebSocket): void {
    socket.addEventListener('message', (event) => {
      this.onMessage(event);
    });
    socket.addEventListener('open', () => {
      this.emit('status', { status: 'open' });
    });
  }

  getState(): { username: string | null } {
    return { username: this.username };
  }

  async getIce(): Promise<{ iceServers: IceServer[] }> {
    return { iceServers: PUBLIC_STUN };
  }

  async joinCall(room: string): Promise<void> {
    const socket = this.current();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected.');
    }
    this.send({ type: 'join_call', room });
  }

  async leaveCall(room: string): Promise<void> {
    this.send({ type: 'leave_call', room });
  }

  sendCallOffer(room: string, to: string, sdp: SessionDescriptionPayload): void {
    this.send({ type: 'call_offer', room, to, sdp });
  }

  sendCallAnswer(room: string, to: string, sdp: SessionDescriptionPayload): void {
    this.send({ type: 'call_answer', room, to, sdp });
  }

  sendIceCandidate(room: string, to: string, candidate: IceCandidatePayload | null): void {
    this.send({ type: 'ice_candidate', room, to, candidate });
  }

  startScreenShare(room: string): void {
    this.send({ type: 'screen_share_start', room });
  }

  stopScreenShare(room: string): void {
    this.send({ type: 'screen_share_stop', room });
  }

  on(event: string, listener: (payload: never) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => {
      set.delete(listener);
    };
  }

  private send(frame: unknown): void {
    const socket = this.current();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  }

  private emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload as never);
    }
  }

  private onMessage(event: MessageEvent): void {
    let frame: Frame;
    try {
      frame = JSON.parse(String(event.data)) as Frame;
    } catch {
      return;
    }
    if (frame.type === 'call_peers' && frame.room && Array.isArray(frame.users)) {
      this.emit('callPeers', {
        room: frame.room,
        users: frame.users,
        sharing: typeof frame.sharing === 'string' ? frame.sharing : null,
        guests: Array.isArray(frame.guests) ? frame.guests : [],
      });
      return;
    }
    if (frame.type === 'user_joined_call' && frame.room && frame.user) {
      this.emit('userJoinedCall', { room: frame.room, user: frame.user, guest: frame.guest === true });
      return;
    }
    if (frame.type === 'user_left_call' && frame.room && frame.user) {
      this.emit('userLeftCall', { room: frame.room, user: frame.user });
      return;
    }
    if (frame.type === 'left_call' && frame.room) {
      this.emit('leftCall', { room: frame.room });
      return;
    }
    if (frame.type === 'screen_share_started' && frame.room && frame.user) {
      this.emit('screenShareStarted', { room: frame.room, user: frame.user });
      return;
    }
    if (frame.type === 'screen_share_stopped' && frame.room && frame.user) {
      this.emit('screenShareStopped', { room: frame.room, user: frame.user });
      return;
    }
    if (frame.type === 'call_offer' && frame.room && frame.from && frame.sdp) {
      this.emit('callOffer', { room: frame.room, from: frame.from, sdp: frame.sdp });
      return;
    }
    if (frame.type === 'call_answer' && frame.room && frame.from && frame.sdp) {
      this.emit('callAnswer', { room: frame.room, from: frame.from, sdp: frame.sdp });
      return;
    }
    if (frame.type === 'ice_candidate' && frame.room && frame.from) {
      this.emit('iceCandidate', {
        room: frame.room,
        from: frame.from,
        candidate: frame.candidate ?? null,
      });
      return;
    }
    if (frame.type === 'error') {
      this.emit('error', { message: frame.message || frame.content || 'invalid message' });
    }
  }
}
