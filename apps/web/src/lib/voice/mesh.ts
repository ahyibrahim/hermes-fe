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

export type VoiceMic = {
  deviceId: string;
  label: string;
};

export type VoiceState = {
  room: string | null;
  joining: boolean;
  muted: boolean;
  peers: VoicePeer[];
  mics: VoiceMic[];
  inputDeviceId: string | null;
  sharing: string | null;
  preview: MediaStream | null;
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
const INPUT_DEVICE_KEY = 'hermes.voice.inputDevice';
const SCREEN_MAX_BITRATE = 2_000_000;

function readStoredInputDevice(): string | null {
  try {
    return localStorage.getItem(INPUT_DEVICE_KEY);
  } catch {
    return null;
  }
}

function writeStoredInputDevice(deviceId: string): void {
  try {
    localStorage.setItem(INPUT_DEVICE_KEY, deviceId);
  } catch {
    // Private-mode quota should not break the call.
  }
}

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
  private screenStream: MediaStream | null = null;
  private remoteScreens = new Map<string, MediaStream>();
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
  private stoppingShare = false;
  private onDeviceChange = (): void => {
    void this.handleDeviceChange();
  };

  state: VoiceState = {
    room: null,
    joining: false,
    muted: false,
    peers: [],
    mics: [],
    inputDeviceId: readStoredInputDevice(),
    sharing: null,
    preview: null,
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

      const stream = await this.captureAudio(this.state.inputDeviceId);
      this.localStream = stream;
      this.applyMute();
      this.watchStream('local', stream);
      this.bindDeviceWatch();
      await this.refreshMics();

      this.setState({ room, inputDeviceId: stream.getAudioTracks()[0]?.getSettings().deviceId || this.state.inputDeviceId });
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
    this.stopScreenTracks();
    this.teardownPeers();
    this.stopLocal();
    this.setState({
      room: null,
      joining: false,
      muted: false,
      peers: [],
      mics: [],
      sharing: null,
      preview: null,
      error: null,
    });
    if (room) {
      try {
        await this.session.leaveCall(room);
      } catch {
        // Socket may already be gone.
      }
    }
  }

  async startShare(): Promise<void> {
    const room = this.state.room;
    const me = this.session.getState().username;
    if (!room || this.state.joining || !me) {
      return;
    }
    if (this.state.sharing && this.state.sharing !== me) {
      this.setState({ error: `${this.state.sharing} is sharing` });
      return;
    }
    if (this.screenStream) {
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      this.setState({
        error:
          'This browser will not expose screen capture on an insecure origin. Use http://127.0.0.1 on this machine, or HTTPS on the tailnet (http://ying-1 is not enough).',
      });
      return;
    }

    let stream: MediaStream;
    try {
      // Firefox rejects width/height/frameRate on getDisplayMedia ("Not supported").
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      const denied = name === 'NotAllowedError' || name === 'NotFoundError';
      const unsupported = name === 'NotSupportedError' || /not supported/i.test(error instanceof Error ? error.message : '');
      this.setState({
        error: denied
          ? 'Screen capture was denied or is not available in this browser.'
          : unsupported
            ? 'This browser cannot start a screen share here. Try Firefox or Chromium on http://127.0.0.1, or HTTPS on the tailnet.'
            : error instanceof Error
              ? error.message
              : String(error),
      });
      return;
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const item of stream.getTracks()) {
        item.stop();
      }
      this.setState({ error: 'That share did not produce a video track.' });
      return;
    }
    track.contentHint = 'detail';
    track.addEventListener('ended', () => {
      void this.stopShare();
    });

    this.screenStream = stream;
    try {
      this.session.startScreenShare(room);
      await this.attachScreenToPeers();
      this.setState({ sharing: me, preview: stream, error: null });
    } catch (error) {
      this.stopScreenTracks();
      this.setState({
        sharing: null,
        preview: this.remotePreview(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async stopShare(): Promise<void> {
    if (this.stoppingShare) {
      return;
    }
    this.stoppingShare = true;
    const room = this.state.room;
    const me = this.session.getState().username;
    try {
      await this.detachScreenFromPeers();
      this.stopScreenTracks();
      if (room && me && this.state.sharing === me) {
        try {
          this.session.stopScreenShare(room);
        } catch {
          // Socket may already be gone.
        }
      }
      this.setState({
        sharing: this.state.sharing === me ? null : this.state.sharing,
        preview: this.remotePreview(),
      });
    } finally {
      this.stoppingShare = false;
    }
  }

  setMuted(muted: boolean): void {
    this.setState({ muted });
    this.applyMute();
  }

  async setInputDevice(deviceId: string): Promise<void> {
    if (!this.state.room || this.state.joining) {
      writeStoredInputDevice(deviceId);
      this.setState({ inputDeviceId: deviceId });
      return;
    }
    try {
      const stream = await this.captureAudio(deviceId, true);
      await this.replaceLocalAudio(stream);
      writeStoredInputDevice(deviceId);
      this.setState({ inputDeviceId: deviceId, error: null });
      await this.refreshMics();
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Could not switch microphone.',
      });
    }
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
      this.session.on('callPeers', ({ room, users, sharing }) => {
        if (room !== this.state.room) {
          return;
        }
        const me = this.session.getState().username;
        for (const user of users) {
          if (user !== me) {
            this.ensurePeer(user);
          }
        }
        this.setState({ sharing, preview: this.previewFor(sharing) });
      }),
      this.session.on('screenShareStarted', ({ room, user }) => {
        if (room !== this.state.room) {
          return;
        }
        this.setState({ sharing: user, preview: this.previewFor(user), error: null });
      }),
      this.session.on('screenShareStopped', ({ room, user }) => {
        if (room !== this.state.room) {
          return;
        }
        this.remoteScreens.delete(user);
        if (user === this.session.getState().username) {
          this.stopScreenTracks();
        }
        const sharing = this.state.sharing === user ? null : this.state.sharing;
        this.setState({ sharing, preview: this.previewFor(sharing) });
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
          this.stopScreenTracks();
          this.teardownPeers();
          this.stopLocal();
          this.setState({
            room: null,
            joining: false,
            muted: false,
            peers: [],
            mics: [],
            sharing: null,
            preview: null,
          });
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
      this.session.on('error', ({ message }) => {
        if (!this.screenStream) {
          return;
        }
        if (!/is sharing|not in that call|only the sharer/i.test(message)) {
          return;
        }
        this.stopScreenTracks();
        this.setState({
          sharing: this.state.sharing === this.session.getState().username ? null : this.state.sharing,
          preview: this.remotePreview(),
          error: message,
        });
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
      this.stopScreenTracks();
      this.teardownPeers();
      this.setState({ sharing: null, preview: null });
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
    if (this.screenStream) {
      for (const track of this.screenStream.getVideoTracks()) {
        const sender = pc.addTrack(track, this.screenStream);
        void this.capScreenSender(sender);
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
      if (event.track.kind === 'audio') {
        const audioOnly = new MediaStream(stream.getAudioTracks().length > 0 ? stream.getAudioTracks() : [event.track]);
        audio.srcObject = audioOnly;
        void audio.play().catch(() => undefined);
        this.watchStream(username, audioOnly);
        return;
      }
      if (event.track.kind === 'video') {
        const video = new MediaStream(stream.getVideoTracks().length > 0 ? stream.getVideoTracks() : [event.track]);
        this.remoteScreens.set(username, video);
        event.track.addEventListener('ended', () => {
          this.remoteScreens.delete(username);
          this.setState({ preview: this.previewFor(this.state.sharing) });
        });
        this.setState({ preview: this.previewFor(this.state.sharing ?? username) });
      }
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
    this.remoteScreens.delete(username);
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

  private async captureAudio(deviceId: string | null, exact = false): Promise<MediaStream> {
    const audio: boolean | MediaTrackConstraints = deviceId
      ? { deviceId: exact ? { exact: deviceId } : { ideal: deviceId } }
      : true;
    return navigator.mediaDevices.getUserMedia({ audio, video: false });
  }

  private async replaceLocalAudio(stream: MediaStream): Promise<void> {
    const nextTrack = stream.getAudioTracks()[0];
    if (!nextTrack) {
      throw new Error('That microphone did not produce an audio track.');
    }
    const previous = this.localStream;
    this.localStream = stream;
    this.applyMute();
    this.watchStream('local', stream);
    for (const slot of this.peers.values()) {
      const audioSender =
        slot.pc.getSenders().find((item) => item.track?.kind === 'audio') ??
        slot.pc.getSenders().find((item) => !item.track);
      if (audioSender) {
        await audioSender.replaceTrack(nextTrack);
      } else {
        slot.pc.addTrack(nextTrack, stream);
      }
    }
    for (const track of previous?.getAudioTracks() ?? []) {
      track.stop();
    }
  }

  private async refreshMics(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      this.setState({ mics: [] });
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label.trim() || 'Microphone',
      }));
    const current = this.localStream?.getAudioTracks()[0]?.getSettings().deviceId ?? this.state.inputDeviceId;
    this.setState({ mics, inputDeviceId: current || this.state.inputDeviceId });
  }

  private bindDeviceWatch(): void {
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
  }

  private unbindDeviceWatch(): void {
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
  }

  private async handleDeviceChange(): Promise<void> {
    if (!this.state.room) {
      return;
    }
    await this.refreshMics();
    const current = this.state.inputDeviceId;
    if (current && this.state.mics.some((mic) => mic.deviceId === current)) {
      return;
    }
    try {
      const stream = await this.captureAudio(null);
      await this.replaceLocalAudio(stream);
      const fallback = stream.getAudioTracks()[0]?.getSettings().deviceId || null;
      if (fallback) {
        writeStoredInputDevice(fallback);
      }
      this.setState({
        inputDeviceId: fallback,
        error: 'That microphone went away. Switched to another input.',
      });
      await this.refreshMics();
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Microphone disappeared.',
      });
    }
  }

  private stopLocal(): void {
    this.unbindDeviceWatch();
    if (this.speakTimer) {
      clearInterval(this.speakTimer);
      this.speakTimer = null;
    }
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.stop();
    }
    this.localStream = null;
    this.stopScreenTracks();
    this.remoteScreens.clear();
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

  private async attachScreenToPeers(): Promise<void> {
    const stream = this.screenStream;
    const track = stream?.getVideoTracks()[0];
    if (!stream || !track) {
      return;
    }
    for (const slot of this.peers.values()) {
      const existing = slot.pc.getSenders().find((item) => item.track?.kind === 'video');
      if (existing) {
        await existing.replaceTrack(track);
        void this.capScreenSender(existing);
      } else {
        const sender = slot.pc.addTrack(track, stream);
        void this.capScreenSender(sender);
      }
    }
  }

  private async detachScreenFromPeers(): Promise<void> {
    for (const slot of this.peers.values()) {
      for (const sender of slot.pc.getSenders()) {
        if (sender.track?.kind === 'video') {
          try {
            await sender.replaceTrack(null);
          } catch {
            slot.pc.removeTrack(sender);
          }
        }
      }
    }
  }

  private async capScreenSender(sender: RTCRtpSender): Promise<void> {
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length
        ? params.encodings.map((encoding) => ({ ...encoding, maxBitrate: SCREEN_MAX_BITRATE, maxFramerate: 30 }))
        : [{ maxBitrate: SCREEN_MAX_BITRATE, maxFramerate: 30 }];
      await sender.setParameters(params);
    } catch {
      // Some browsers reject setParameters before the transceiver is ready.
    }
  }

  private stopScreenTracks(): void {
    for (const track of this.screenStream?.getTracks() ?? []) {
      track.stop();
    }
    this.screenStream = null;
  }

  private remotePreview(): MediaStream | null {
    const sharing = this.state.sharing;
    if (sharing && this.remoteScreens.has(sharing)) {
      return this.remoteScreens.get(sharing) ?? null;
    }
    return this.remoteScreens.values().next().value ?? null;
  }

  private previewFor(sharing: string | null): MediaStream | null {
    const me = this.session.getState().username;
    if (sharing && sharing === me && this.screenStream) {
      return this.screenStream;
    }
    if (sharing && this.remoteScreens.has(sharing)) {
      return this.remoteScreens.get(sharing) ?? null;
    }
    return this.remotePreview();
  }

  private snapshot(): VoiceState {
    return {
      room: this.state.room,
      joining: this.state.joining,
      muted: this.state.muted,
      peers: [...this.state.peers],
      mics: [...this.state.mics],
      inputDeviceId: this.state.inputDeviceId,
      sharing: this.state.sharing,
      preview: this.state.preview,
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
