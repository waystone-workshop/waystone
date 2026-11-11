import { microphoneConstraints, readAudioPreferences } from "./audio-quality.mjs";

// A call owns its room, microphone, and playback elements until leave().
export class AudioCall {
  constructor({ createRoom, events, credentials, changed, failed, audioHost }) {
    Object.assign(this, { createRoom, events, credentials, changed, failed, audioHost });
    this.version = 0;
    this.room = null;
    this.state = "idle";
    this.deafened = false;
    this.muted = false;
    this.playbackBlocked = false;
  }

  update() {
    const participants = this.room
      ? [this.room.localParticipant, ...this.room.remoteParticipants.values()]
      : [];
    this.changed({
      state: this.state, muted: this.muted, deafened: this.deafened,
      playbackBlocked: this.playbackBlocked,
      participants: participants.map((p) => ({
        user_id: this.participantUserId(p),
        id: p.identity, name: p.name || "Friend", muted: !p.isMicrophoneEnabled,
        speaking: p.isSpeaking, self: p === this.room.localParticipant,
      })),
    });
  }

  participantUserId(participant) {
    try { const id = JSON.parse(participant.metadata || "{}").user_id; return Number.isInteger(id) ? id : null; }
    catch { return null; }
  }

  async join(channelId) {
    if (this.state !== "idle") return;
    this.audioPreferences = readAudioPreferences();
    const version = ++this.version;
    this.state = "joining";
    this.update();
    let room;
    try {
      const { url, token } = await this.credentials(channelId);
      if (version !== this.version) return;
      const endpoint = new URL(url);
      if (endpoint.protocol !== "wss:" && !(endpoint.protocol === "ws:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)))
        throw new Error("Audio requires a secure voice server.");
      room = this.createRoom();
      this.room = room;
      const current = () => version === this.version;
      for (const event of ["ParticipantConnected", "ParticipantDisconnected", "TrackMuted",
        "TrackUnmuted", "TrackPublished", "TrackUnpublished", "LocalTrackPublished",
        "LocalTrackUnpublished", "ActiveSpeakersChanged"])
        room.on(this.events[event], () => { if (current()) this.update(); });
      room.on(this.events.TrackSubscribed, (track) => {
        if (!current() || track.kind !== "audio") return;
        const audio = track.attach();
        audio.muted = this.deafened;
        this.audioHost.append(audio);
        this.update();
      });
      room.on(this.events.TrackUnsubscribed, (track) => track.detach().forEach((node) => node.remove()));
      room.on(this.events.AudioPlaybackStatusChanged, () => {
        if (!current()) return;
        this.playbackBlocked = !room.canPlaybackAudio;
        this.update();
      });
      room.on(this.events.Reconnecting, () => {
        if (current()) { this.state = "reconnecting"; this.update(); }
      });
      room.on(this.events.Reconnected, () => {
        if (current()) { this.state = "connected"; this.update(); }
      });
      room.on(this.events.Disconnected, () => {
        if (current()) {
          this.leave();
          this.failed(new Error("Audio disconnected. Join again when you're ready."));
        }
      });
      await room.connect(url, token);
      if (!current()) { await room.disconnect(); return; }
      await room.startAudio().catch(() => {
        if (current()) { this.playbackBlocked = true; this.update(); }
      });
      if (!current()) { await room.disconnect(); return; }
      await room.localParticipant.setMicrophoneEnabled(true);
      if (!current()) { await room.disconnect(); return; }
      await this.enhanceMicrophone(room);
      if (!current()) { await room.disconnect(); return; }
      this.state = "connected";
      this.update();
    } catch (error) {
      // A canceled acquisition may still finish after leave; release it too.
      if (version !== this.version) { await room?.disconnect(); return; }
      this.leave();
      this.failed(new Error("Could not join audio. Check the voice service and microphone permission. " + error.message));
    }
  }

  async enhanceMicrophone(room) {
    if (this.audioPreferences?.noiseSuppression === false || !this.createProcessor) return;
    const publication = room.localParticipant.getTrackPublication?.(this.microphoneSource);
    const track = publication?.track;
    if (!track?.setProcessor) return;
    const settings = track.getSourceTrackSettings?.() || {};
    // The platform model already replaced browser suppression. A second model
    // removes consonants instead of noise.
    if (settings.voiceIsolation) return;
    try {
      await track.applyConstraints(microphoneConstraints(settings, false, this.audioPreferences));
      if (room !== this.room) return;
      await track.setProcessor(this.createProcessor());
    } catch {
      if (room === this.room) await track.applyConstraints(microphoneConstraints(settings, true, this.audioPreferences)).catch(() => {});
    }
  }

  async mute() {
    const room = this.room;
    if (!room || this.state !== "connected" || this.changingMic) return;
    this.changingMic = true;
    try {
      const enabled = this.muted;
      await room.localParticipant.setMicrophoneEnabled(enabled);
      if (room !== this.room) return;
      this.muted = !enabled;
      this.update();
    } catch (error) { this.failed(error); }
    finally { this.changingMic = false; }
  }

  deafen() {
    if (!this.room) return;
    this.deafened = !this.deafened;
    for (const audio of this.audioHost.querySelectorAll("audio")) audio.muted = this.deafened;
    this.update();
  }

  async resume() {
    try { await this.room?.startAudio(); } catch (error) { this.failed(error); }
  }

  leave() {
    ++this.version;
    const room = this.room;
    this.room = null;
    this.state = "idle";
    this.muted = false;
    this.deafened = false;
    this.playbackBlocked = false;
    this.audioHost.replaceChildren();
    // disconnect(true) stops all local microphone tracks as well as transports.
    if (room) Promise.resolve(room.disconnect(true)).catch(() => {});
    this.update();
  }
}
