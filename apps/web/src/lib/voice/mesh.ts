import type {
  IceCandidatePayload,
  IceServer,
  SessionController,
  SessionDescriptionPayload,
} from '@hermes/core';

export type VoicePeer = {
  username: string;
  speaking: boolean;
  connectionState: RTCPeerConnectionState;
};

export type VoiceState = {
  room: string | null;
  joining: boolean;
  muted: boolean;
  peers: VoicePeer[];
  error: string | null;
};

type PeerSlot = {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audio: HTMLAudioElement;
};

const SPEAKING_THRESHOLD = 18;
const SPEAK_POLL_MS = 120;

function asDescription(sdp: SessionDescriptionPayload): RTCSessionDescriptionInit {
  return { type: sdp.type, sdp: sdp.sdp };
}

function asCandidate(candidate: IceCandidatePayload | null): RTCIceCandidateInit | null {
  if (!candidate) {
    return null;
  }
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? undefined,
    sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
    usernameFragment: candidate.usernameFragment ?? undefined,
  };
}

export class VoiceMesh {
  private localStream: MediaStream | null = null;
  private iceServers: IceServer[] = [];
  private peers = new Map<string, PeerSlot>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private speaking = new Set<string>();
  private analysers = new Map<string, AnalyserNode>();
  private audioCtx: AudioContext | null = null;
  private speakTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: Array<() => void> = [];
  private listeners = new Set<(state: VoiceState) => void>();
  private reconnecting = false;

  state: VoiceState = {
    room: null,
    joining: false,
    muted: false,
    peers: [],
    error: null,
  };

  constructor(private readonly session: SessionController) {
    this.bindSession();
  }

  subscribe(listener: (state: VoiceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async join(room: string): Promise<void> {
    if (this.state.joining) {
      return;
    }
    if (this.state.room === room) {
      return;
    }

    this.setState({ joining: true, error: null });

    try {
      if (this.state.room && this.state.room !== room) {
        await this.leave();
        this.setState({ joining: true, error: null });
      }

      const ice = await this.session.getIce();
      this.iceServers = ice.iceServers ?? [];

      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'This browser will not expose the microphone on an insecure origin. Use http://127.0.0.1 on this machine, or HTTPS on the tailnet (http://ying-1 is not enough).'
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.localStream = stream;
      this.applyMute();
      this.watchStream('local', stream);

      this.setState({ room });
      await this.session.joinCall(room);
      this.startSpeakPoll();
    } catch (error) {
      this.stopLocal();
      const message =
        error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'NotFoundError')
          ? 'Microphone permission was denied. Stay out of the call until it is allowed.'
          : error instanceof Error
            ? error.message
            : String(error);
      this.setState({ room: null, joining: false, error: message });
      return;
    }

    this.setState({ joining: false });
  }

  async leave(): Promise<void> {
    const room = this.state.room;
    this.teardownPeers();
    this.stopLocal();
    this.setState({ room: null, joining: false, muted: false, peers: [], error: null });
    if (room) {
      try {
        await this.session.leaveCall(room);
      } catch {
        // Socket may already be gone.
      }
    }
  }

  setMuted(muted: boolean): void {
    this.setState({ muted });
    this.applyMute();
  }

  async destroy(): Promise<void> {
    for (const off of this.unsubscribers) {
      off();
    }
    this.unsubscribers = [];
    await this.leave();
    this.listeners.clear();
  }

  private bindSession(): void {
    this.unsubscribers.push(
      this.session.on('callPeers', ({ room, users }) => {
        if (room !== this.state.room) {
          return;
        }
        const me = this.session.getState().username;
        for (const user of users) {
          if (user !== me) {
            this.ensurePeer(user);
          }
        }
      }),
      this.session.on('userJoinedCall', ({ room, user }) => {
        if (room !== this.state.room) {
          return;
        }
        if (user !== this.session.getState().username) {
          this.ensurePeer(user);
        }
      }),
      this.session.on('userLeftCall', ({ room, user }) => {
        if (room !== this.state.room) {
          return;
        }
        this.dropPeer(user);
      }),
      this.session.on('leftCall', ({ room }) => {
        if (room === this.state.room && !this.state.joining) {
          this.teardownPeers();
          this.stopLocal();
          this.setState({ room: null, joining: false, muted: false, peers: [] });
        }
      }),
      this.session.on('callOffer', ({ room, from, sdp }) => {
        if (room !== this.state.room) {
          return;
        }
        void this.onRemoteOffer(from, sdp);
      }),
      this.session.on('callAnswer', ({ room, from, sdp }) => {
        if (room !== this.state.room) {
          return;
        }
        void this.onRemoteAnswer(from, sdp);
      }),
      this.session.on('iceCandidate', ({ room, from, candidate }) => {
        if (room !== this.state.room) {
          return;
        }
        void this.onRemoteIce(from, candidate);
      }),
      this.session.on('status', ({ status }) => {
        if (status === 'open' && this.state.room && !this.state.joining) {
          void this.rejoin();
        }
      })
    );
  }

  private async rejoin(): Promise<void> {
    if (this.reconnecting || !this.state.room) {
      return;
    }
    this.reconnecting = true;
    const room = this.state.room;
    try {
      this.teardownPeers();
      await this.session.joinCall(room);
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.reconnecting = false;
    }
  }

  private polite(remote: string): boolean {
    const local = this.session.getState().username ?? '';
    return local.localeCompare(remote) > 0;
  }

  private ensurePeer(username: string): PeerSlot {
    const existing = this.peers.get(username);
    if (existing) {
      return existing;
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    const slot: PeerSlot = { pc, makingOffer: false, ignoreOffer: false, audio };
    this.peers.set(username, slot);
    this.publishPeers();

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (event) => {
      const room = this.state.room;
      if (!room) {
        return;
      }
      const candidate = event.candidate
        ? {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment,
          }
        : null;
      try {
        this.session.sendIceCandidate(room, username, candidate);
      } catch {
        // Not connected.
      }
    };

    pc.onnegotiationneeded = () => {
      void this.makeOffer(username, slot);
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      this.watchStream(username, stream);
    };

    pc.onconnectionstatechange = () => {
      this.publishPeers();
    };

    return slot;
  }

  private async makeOffer(username: string, slot: PeerSlot): Promise<void> {
    const room = this.state.room;
    if (!room) {
      return;
    }

    try {
      slot.makingOffer = true;
      await slot.pc.setLocalDescription(await slot.pc.createOffer());
      const local = slot.pc.localDescription;
      if (local?.sdp && (local.type === 'offer' || local.type === 'answer')) {
        this.session.sendCallOffer(room, username, { type: local.type, sdp: local.sdp });
      }
    } catch (error) {
      if (slot.pc.signalingState !== 'closed' && slot.pc.signalingState !== 'have-remote-offer') {
        this.setState({ error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      slot.makingOffer = false;
    }
  }

  private async onRemoteOffer(from: string, sdp: SessionDescriptionPayload): Promise<void> {
    const slot = this.ensurePeer(from);
    const offerCollision = slot.makingOffer || slot.pc.signalingState !== 'stable';
    slot.ignoreOffer = !this.polite(from) && offerCollision;
    if (slot.ignoreOffer) {
      return;
    }

    try {
      await slot.pc.setRemoteDescription(asDescription(sdp));
      await this.flushIce(from);
      await slot.pc.setLocalDescription(await slot.pc.createAnswer());
      const local = slot.pc.localDescription;
      const room = this.state.room;
      if (room && local?.sdp && (local.type === 'offer' || local.type === 'answer')) {
        this.session.sendCallAnswer(room, from, { type: local.type, sdp: local.sdp });
      }
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async onRemoteAnswer(from: string, sdp: SessionDescriptionPayload): Promise<void> {
    const slot = this.peers.get(from);
    if (!slot) {
      return;
    }
    try {
      await slot.pc.setRemoteDescription(asDescription(sdp));
      await this.flushIce(from);
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async onRemoteIce(from: string, candidate: IceCandidatePayload | null): Promise<void> {
    const init = asCandidate(candidate);
    const slot = this.peers.get(from);
    if (!slot || !slot.pc.remoteDescription) {
      if (init) {
        const queued = this.pendingIce.get(from) ?? [];
        queued.push(init);
        this.pendingIce.set(from, queued);
      }
      return;
    }

    try {
      await slot.pc.addIceCandidate(init ?? undefined);
    } catch {
      // Stale candidate after a renegotiation.
    }
  }

  private async flushIce(from: string): Promise<void> {
    const slot = this.peers.get(from);
    const queued = this.pendingIce.get(from) ?? [];
    this.pendingIce.delete(from);
    if (!slot) {
      return;
    }
    for (const candidate of queued) {
      try {
        await slot.pc.addIceCandidate(candidate);
      } catch {
        // ignore
      }
    }
  }

  private dropPeer(username: string): void {
    const slot = this.peers.get(username);
    if (slot) {
      slot.pc.close();
      slot.audio.pause();
      slot.audio.srcObject = null;
      this.peers.delete(username);
    }
    this.pendingIce.delete(username);
    this.analysers.delete(username);
    this.speaking.delete(username);
    this.publishPeers();
  }

  private teardownPeers(): void {
    for (const username of [...this.peers.keys()]) {
      this.dropPeer(username);
    }
  }

  private applyMute(): void {
    const enabled = !this.state.muted;
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
  }

  private stopLocal(): void {
    if (this.speakTimer) {
      clearInterval(this.speakTimer);
      this.speakTimer = null;
    }
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.stop();
    }
    this.localStream = null;
    this.analysers.clear();
    this.speaking.clear();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
  }

  private watchStream(id: string, stream: MediaStream): void {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return;
    }
    this.audioCtx ??= new Ctor();
    void this.audioCtx.resume().catch(() => undefined);
    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.analysers.set(id, analyser);
    } catch {
      // A clone of the same stream can throw if the context is closing.
    }
  }

  private startSpeakPoll(): void {
    if (this.speakTimer) {
      return;
    }
    this.speakTimer = setInterval(() => {
      let changed = false;
      const me = this.session.getState().username;
      for (const [id, analyser] of this.analysers) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const value of data) {
          sum += value;
        }
        const level = data.length === 0 ? 0 : sum / data.length;
        const name = id === 'local' ? me : id;
        if (!name) {
          continue;
        }
        const was = this.speaking.has(name);
        const now = level > SPEAKING_THRESHOLD;
        if (now && !was) {
          this.speaking.add(name);
          changed = true;
        } else if (!now && was) {
          this.speaking.delete(name);
          changed = true;
        }
      }
      if (changed) {
        this.publishPeers();
      }
    }, SPEAK_POLL_MS);
  }

  private publishPeers(): void {
    const me = this.session.getState().username;
    const peers: VoicePeer[] = [...this.peers.entries()].map(([username, slot]) => ({
      username,
      speaking: this.speaking.has(username),
      connectionState: slot.pc.connectionState,
    }));
    if (me) {
      peers.unshift({
        username: me,
        speaking: this.speaking.has(me),
        connectionState: 'connected',
      });
    }
    this.setState({ peers });
  }

  private snapshot(): VoiceState {
    return {
      room: this.state.room,
      joining: this.state.joining,
      muted: this.state.muted,
      peers: [...this.state.peers],
      error: this.state.error,
    };
  }

  private setState(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    const snap = this.snapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }
}
