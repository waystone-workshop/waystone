import { microphoneConstraints, readAudioPreferences, voiceCaptureFor } from "./audio-quality.mjs";
import { readVideoPreferences, videoCaptureFor } from "./video-quality.mjs";

// A call owns its room, microphone, and playback elements until leave().
export class AudioCall {
  constructor({ createRoom, events, credentials, changed, failed, audioHost, mediaRoot, videoStage, videoCameras, prepareShare, cameraSource, screenSource, createProcessor, microphoneSource }) {
    Object.assign(this, { createRoom, events, credentials, changed, failed, audioHost, mediaRoot, videoStage, videoCameras, prepareShare, cameraSource, screenSource, createProcessor, microphoneSource });
    this.version = 0;
    this.room = null;
    this.state = "idle";
    this.deafened = false;
    this.muted = false;
    this.cameraOn = false;
    this.sharing = false;
    this.playbackBlocked = false;
    this.mounted = new Set();
    this.spotlightPinned = false;
  }

  update() {
    const participants = this.room
      ? [this.room.localParticipant, ...this.room.remoteParticipants.values()]
      : [];
    this.changed({
      processing: this.processing || "Not in a call", state: this.state, muted: this.muted, deafened: this.deafened,
      camera: this.cameraOn, sharing: this.sharing,
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
      room.on(this.events.TrackSubscribed, (track, publication, participant) => {
        if (!current()) return;
        if (track.kind === "audio") {
          const audio = track.attach();
          audio.muted = this.deafened;
          this.audioHost.append(audio);
          this.update();
          return;
        }
        if (track.kind === "video") this.mountVideo(track, publication, participant);
      });
      room.on(this.events.LocalTrackPublished, (publication, participant) => {
        if (!current() || publication.track?.kind !== "video") return;
        this.mountVideo(publication.track, publication, participant);
      });
      const unmount = (track) => { if (current() && track) this.unmount(track); };
      room.on(this.events.TrackUnsubscribed, unmount);
      room.on(this.events.LocalTrackUnpublished, (publication) => unmount(publication?.track));
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
    if (!this.createProcessor) return;
    const track = room.localParticipant.getTrackPublication?.(this.microphoneSource)?.track;
    if (!track?.setProcessor) return;
    const settings = track.getSourceTrackSettings?.() || {};
    const denoise = this.audioPreferences.noiseSuppression && !settings.voiceIsolation;
    try {
      if (denoise) await track.applyConstraints(microphoneConstraints(settings, false, this.audioPreferences));
      if (room !== this.room) return;
      await track.setProcessor(this.createProcessor({ ...this.audioPreferences, noiseSuppression: denoise }));
      this.processing = denoise ? "Waystone noise reduction + voice detection" : settings.voiceIsolation ? "System isolation + voice detection" : "Voice detection · noise reduction off";
    } catch {
      if (room !== this.room) return;
      await track.stopProcessor?.().catch(() => {});
      await track.applyConstraints(microphoneConstraints(settings, this.audioPreferences.noiseSuppression, this.audioPreferences)).catch(() => {});
      this.processing = "Voice detection unavailable · using browser audio. Try rejoining.";
    }
  }

  applyAudio(patch = {}) {
    this.audioChange = (this.audioChange || Promise.resolve()).catch(() => {}).then(async () => {
      const room = this.room;
      if (!room || this.state !== 'connected') return;
      this.audioPreferences = readAudioPreferences();
      const track = room.localParticipant.getTrackPublication?.(this.microphoneSource)?.track;
      if (!track) return;
      const processor = track.getProcessor?.();
      if (Object.keys(patch).length && Object.keys(patch).every(key => ['inputMode', 'inputThreshold'].includes(key)) && processor?.configure) {
        processor.configure(this.audioPreferences);
        return;
      }
      await track.stopProcessor?.();
      await track.restartTrack(voiceCaptureFor(this.audioPreferences));
      if (room !== this.room) return;
      await this.enhanceMicrophone(room);
      this.update();
    });
    return this.audioChange;
  }

  capture() {
    return videoCaptureFor(readVideoPreferences());
  }

  mountVideo(track, publication, participant) {
    if (!this.videoStage || !this.videoCameras || this.mounted.has(track)) return;
    this.mounted.add(track);
    const video = track.attach();
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    const local = participant === this.room?.localParticipant;
    const sharing = publication?.source === this.screenSource;
    const doc = this.videoStage.ownerDocument;
    if (!doc?.createElement) {
      (sharing ? this.videoStage : this.videoCameras).append(video);
      this.refreshMedia();
      return;
    }
    const tile = doc.createElement("div");
    tile.className = local && !sharing ? "call-tile self" : "call-tile";
    tile.dataset.share = sharing ? "1" : "0";
    const who = local ? "You" : (participant?.name || "Friend");
    const label = sharing ? `${who} · sharing` : who;
    const focus = doc.createElement("button");
    focus.type = "button";
    focus.className = "call-focus";
    focus.setAttribute("aria-label", `Show ${label}`);
    const caption = doc.createElement("span");
    caption.textContent = label;
    focus.append(video, caption);
    focus.onclick = () => this.spotlight(tile);
    tile.append(focus);
    if (local && sharing) {
      const stop = doc.createElement("button");
      stop.type = "button";
      stop.textContent = "Stop sharing";
      stop.onclick = (event) => { event.stopPropagation(); this.share(false); };
      tile.append(stop);
    }
    this.placeTile(tile, sharing);
    this.refreshMedia();
  }

  placeTile(tile, sharing) {
    const current = this.videoStage.firstElementChild;
    const currentIsShare = current?.dataset.share === "1";
    const takeStage = sharing && (!current || (!this.spotlightPinned && !currentIsShare));
    if (takeStage && current) this.videoCameras.append(current);
    (takeStage ? this.videoStage : this.videoCameras).append(tile);
    this.markSpotlight();
  }

  spotlight(tile) {
    if (!tile?.dataset) return;
    const current = this.videoStage.firstElementChild;
    if (tile !== current) {
      if (current) this.videoCameras.append(current);
      this.videoStage.append(tile);
    }
    this.spotlightPinned = true;
    this.markSpotlight();
  }

  markSpotlight() {
    const spot = this.videoStage?.firstElementChild;
    for (const tile of [...(this.videoStage?.children || []), ...(this.videoCameras?.children || [])]) {
      const on = tile === spot;
      tile.classList?.toggle("is-spotlight", on);
      tile.querySelector?.(".call-focus")?.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  promoteSpotlight() {
    if (this.videoStage?.firstElementChild) return;
    this.spotlightPinned = false;
    const waiting = [...(this.videoCameras?.children || [])];
    const next = waiting.find((tile) => tile.dataset?.share === "1");
    if (next) this.videoStage.append(next);
    this.markSpotlight();
  }

  unmount(track) {
    this.releaseTrack(track);
    this.refreshMedia();
  }

  releaseTrack(track) {
    if (!track) return;
    this.mounted.delete(track);
    for (const node of track.detach?.() || []) this.releaseElement(node);
    track.mediaStreamTrack?.stop?.();
    track.stop?.();
  }

  releaseElement(node) {
    node.pause?.();
    node.srcObject = null;
    const tile = node.closest?.(".call-tile");
    const removed = tile || node;
    const wasSpotlight = removed?.parentElement === this.videoStage;
    removed.remove?.();
    if (wasSpotlight) this.promoteSpotlight();
  }

  clearStage() {
    for (const root of [this.mediaRoot, this.audioHost]) {
      if (!root?.querySelectorAll) continue;
      for (const node of root.querySelectorAll("video, audio")) this.releaseElement(node);
    }
    this.mounted.clear();
    this.spotlightPinned = false;
    this.audioHost?.replaceChildren?.();
    this.videoStage?.replaceChildren?.();
    this.videoCameras?.replaceChildren?.();
    if (this.mediaRoot) this.mediaRoot.hidden = true;
  }

  refreshMedia() {
    if (!this.mediaRoot) return;
    const tiles = (this.videoStage?.childElementCount || 0) + (this.videoCameras?.childElementCount || 0);
    this.mediaRoot.hidden = tiles === 0;
  }

  async camera(enabled) {
    const room = this.room;
    if (!room || this.state !== "connected" || this.changingCamera) return;
    this.changingCamera = true;
    try {
      if (!enabled) {
        const publication = room.localParticipant.getTrackPublication?.(this.cameraSource);
        const track = publication?.track;
        if (track) await room.localParticipant.unpublishTrack?.(track, true);
        if (room !== this.room) return;
        this.releaseTrack(track);
        this.cameraOn = false;
        this.refreshMedia();
        this.update();
        return;
      }
      const capture = this.capture();
      await room.localParticipant.setCameraEnabled(true, { resolution: capture.resolution }, { videoEncoding: capture.encoding });
      if (room !== this.room) return;
      this.cameraOn = true;
      this.update();
    } catch (error) { this.failed(error); }
    finally { this.changingCamera = false; }
  }

  async share(enabled) {
    const room = this.room;
    if (!room || this.state !== "connected" || this.changingShare) return;
    this.changingShare = true;
    try {
      const capture = this.capture();
      await room.localParticipant.setScreenShareEnabled(enabled, {
        audio: false, contentHint: "detail", resolution: capture.resolution,
      }, { screenShareEncoding: capture.encoding });
      if (room !== this.room) return;
      this.sharing = enabled;
      this.update();
    } catch (error) { this.failed(error); }
    finally { this.changingShare = false; }
  }

  async applyVideo() {
    const room = this.room;
    if (!room || this.state !== "connected") return;
    if (this.cameraOn) {
      const publication = room.localParticipant.getTrackPublication?.(this.cameraSource);
      if (publication?.track) await room.localParticipant.unpublishTrack?.(publication.track, true);
      if (room !== this.room) return;
      this.cameraOn = false;
      await this.camera(true);
    }
    if (room !== this.room || !this.sharing || !this.prepareShare) return;
    await this.share(false);
    if (room !== this.room) return;
    await this.prepareShare();
    if (room !== this.room) return;
    await this.share(true);
  }

  async mute() {
    const room = this.room;
    if (!room || this.state !== "connected" || this.changingMic) return;
    this.changingMic = true;
    try {
      const enabled = this.muted;
      await room.localParticipant.setMicrophoneEnabled(enabled);
      if (room !== this.room) return;
      if (enabled) await this.enhanceMicrophone(room);
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
    this.cameraOn = false;
    this.sharing = false;
    this.playbackBlocked = false;
    for (const participant of room ? [room.localParticipant, ...room.remoteParticipants.values()] : []) {
      const lists = [participant?.videoTrackPublications, participant?.trackPublications];
      for (const list of lists) {
        if (!list?.values) continue;
        for (const publication of list.values()) {
          if (list === participant.videoTrackPublications || publication?.track?.kind === "video" || publication?.kind === "video")
            this.releaseTrack(publication?.track);
        }
      }
    }
    // Clearing the stream before the element leaves the page is what actually
    // takes the picture down. Removing the node alone can leave the last frame up.
    this.clearStage();
    if (room) Promise.resolve(room.disconnect(true)).finally(() => { if (this.state === "idle") this.clearStage(); }).catch(() => {});
    this.update();
  }
}
