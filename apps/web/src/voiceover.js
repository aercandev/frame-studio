import { t, localizeError } from './i18n.js';

// A recording belongs to the project; deleting it from the timeline keeps its
// media available for undo until the parent project is released.
export function resolvedVoiceovers(edits, totalDuration) {
  let cursor = 0;
  const anchors = new Map((edits?.clips || []).map((clip) => {
    const start = cursor;
    cursor += clip.gapDuration || clip.freezeDuration || (clip.end - clip.start) / clip.speed;
    return [clip.id, start];
  }));
  return (edits?.voiceovers || []).flatMap((voice) => {
    if (voice.linkedClipId && !anchors.has(voice.linkedClipId)) return [];
    const rawStart = voice.linkedClipId
      ? anchors.get(voice.linkedClipId) + (voice.linkedOffset || 0) : voice.start;
    const cut = Math.max(0, -rawStart);
    const start = Math.max(0, rawStart);
    const offset = (voice.offset || 0) + cut;
    const duration = Math.min(voice.duration - cut, totalDuration - start,
      (voice.sourceDuration ?? Infinity) - offset);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return [];
    return [{ ...voice, start, offset, duration }];
  });
}

export function initVoiceover({
  state, getDuration, getCursor, updateEdits, stopPlayback,
  onChange = () => {}, onSelect = () => {}, getDocument = () => document,
}) {
  const doc = getDocument();
  const win = doc.defaultView;
  const find = (id) => doc.getElementById(id);
  const button = find('voiceover-record');
  const linkButton = find('voiceover-link');
  const track = find('voiceover-track');
  const controls = find('voiceover-controls');
  const status = find('voiceover-status');
  const media = new Map();
  let selectedId = null;
  let recorder = null;
  let stream = null;
  let pending = false;
  let uploading = false;
  let generation = 0;
  let clock = null;
  let uploadController = null;
  let audioContext = null;
  const supported = !!(win.navigator.mediaDevices?.getUserMedia && win.MediaRecorder);
  let statusMessage = null;
  const renderStatus = () => {
    if (status) status.textContent = !statusMessage ? '' : statusMessage.error
      ? localizeError(statusMessage.error, statusMessage.fallbackKey)
      : t(statusMessage.key, statusMessage.params);
  };
  const say = (key, params = {}) => { statusMessage = key ? { key, params } : null; renderStatus(); };
  const sayError = (error, fallbackKey) => { statusMessage = { error, fallbackKey }; renderStatus(); };
  const recordingError = (i18nKey) => Object.assign(new Error(t(i18nKey)), { i18nKey });
  const voices = () => resolvedVoiceovers(state.edits, getDuration());
  const current = () => (state.edits?.voiceovers || []).find((voice) => voice.id === selectedId);
  function syncButton() {
    if (!button) return;
    const recording = recorder?.state === 'recording';
    const activeCapture = !!recording || pending || uploading;
    button.disabled = !activeCapture && (!supported || !state.media || !getDuration() || state.importing || state.exporting);
    button.classList.toggle('recording', !!recording);
    button.setAttribute('aria-pressed', String(!!recording));
    button.title = t(!supported ? 'voiceover.unsupported'
      : recording ? 'voiceover.finish' : uploading ? 'voiceover.cancelUpload'
        : pending ? 'voiceover.cancelPermission' : 'voiceover.record');
    button.setAttribute('aria-label', button.title);
    state.recordingVoiceover = !!recording || pending || uploading;
    if (linkButton) {
      const voice = current();
      linkButton.disabled = !voice;
      linkButton.classList.toggle('active', !!voice?.linkedClipId);
      linkButton.setAttribute('aria-pressed', String(!!voice?.linkedClipId));
    }
    onChange();
  }
  function releaseStream() {
    stream?.getTracks().forEach((item) => item.stop());
    stream = null;
    if (clock !== null) win.clearInterval(clock);
    clock = null;
  }
  function stop() {
    for (const { audio } of media.values()) audio.pause();
  }
  function dispose() {
    generation += 1;
    pending = false; uploading = false;
    uploadController?.abort(); uploadController = null;
    const previous = recorder;
    recorder = null;
    if (previous && previous.state !== 'inactive') previous.stop();
    releaseStream();
    stop();
    for (const { audio } of media.values()) { audio.removeAttribute('src'); audio.load(); }
    media.clear();
    audioContext?.close().catch(() => {}); audioContext = null;
    selectedId = null;
    state.selectedVoiceoverId = null;
    say('');
    syncButton();
  }
  async function finishRecording(instance, chunks, token, mediaId, start) {
    if (token !== generation || state.media?.id !== mediaId) return;
    recorder = null; releaseStream(); uploading = true; syncButton();
    say('voiceover.preparing');
    const controller = new win.AbortController();
    uploadController = controller;
    try {
      const blob = new win.Blob(chunks, { type: instance.mimeType || chunks[0]?.type || 'audio/webm' });
      if (!blob.size) throw recordingError('voiceover.empty');
      const response = await win.fetch(`/api/media/${encodeURIComponent(mediaId)}/voiceovers`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
        body: blob, signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(), { code: result.error?.code });
      if (token !== generation || state.media?.id !== mediaId) return;
      if (!(result.duration > 0) || !result.id) throw recordingError('voiceover.unreadable');
      selectedId = result.id;
      state.selectedVoiceoverId = result.id;
      onSelect();
      updateEdits((edits) => {
        edits.voiceovers ||= [];
        edits.voiceovers.push({
          id: result.id, url: result.url, start: Math.min(start, Math.max(0, getDuration() - 0.01)),
          offset: 0, duration: result.duration, sourceDuration: result.duration, volume: 1, muted: false,
        });
      });
      say('voiceover.added');
    } catch (error) {
      if (token === generation) {
        if (error.name === 'AbortError') say('voiceover.cancelled');
        else sayError(error, 'voiceover.addFailed');
      }
    } finally {
      if (token === generation) { uploading = false; uploadController = null; render(); }
    }
  }
  async function toggleRecording() {
    if (uploading) { dispose(); say('voiceover.cancelled'); return; }
    if (recorder?.state === 'recording') { uploading = true; recorder.stop(); syncButton(); return; }
    if (pending) { dispose(); return; }
    if (!supported || !state.media || !getDuration() || uploading) return;
    const token = ++generation;
    const mediaId = state.media.id;
    const start = Math.min(getCursor(), Math.max(0, getDuration() - 0.01));
    pending = true; stopPlayback(); syncButton(); say('voiceover.permissionPending');
    try {
      const granted = await win.navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, video: false,
      });
      if (token !== generation || state.media?.id !== mediaId) {
        granted.getTracks().forEach((item) => item.stop()); return;
      }
      stream = granted;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
        .find((type) => win.MediaRecorder.isTypeSupported?.(type));
      const instance = new win.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      instance.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
      instance.addEventListener('stop', () => { void finishRecording(instance, chunks, token, mediaId, start); });
      instance.addEventListener('error', () => {
        if (token !== generation) return;
        dispose(); say('voiceover.interrupted');
      });
      recorder = instance;
      pending = false;
      instance.start(1000);
      const started = Date.now();
      say('voiceover.recording', { seconds: 0 });
      clock = win.setInterval(() => say('voiceover.recording', { seconds: Math.floor((Date.now() - started) / 1000) }), 1000);
      syncButton();
    } catch (error) {
      if (token !== generation) return;
      pending = false; recorder = null; releaseStream(); syncButton();
      say(error.name === 'NotAllowedError' ? 'voiceover.permissionDenied'
        : error.name === 'NotFoundError' ? 'voiceover.microphoneMissing' : 'voiceover.startFailed');
    }
  }
  button?.addEventListener('click', () => { void toggleRecording(); });
  function deleteSelected() {
    if (!current()) return false;
    const id = selectedId; selectedId = null; state.selectedVoiceoverId = null;
    updateEdits((edits) => { edits.voiceovers = edits.voiceovers.filter((item) => item.id !== id); });
    render();
    return true;
  }
  function setLinked(voice, enabled) {
    const position = voices().find((item) => item.id === voice.id)?.start ?? voice.start;
    delete voice.linkedClipId; delete voice.linkedOffset;
    voice.start = position;
    if (enabled) {
      let time = 0;
      for (const clip of state.edits.clips) {
        const end = time + (clip.gapDuration || clip.freezeDuration || (clip.end - clip.start) / clip.speed);
        if (position < end) { voice.linkedClipId = clip.id; voice.linkedOffset = position - time; break; }
        time = end;
      }
    }
  }
  function toggleLink() {
    const voice = current();
    if (!voice) return;
    updateEdits(() => setLinked(voice, !voice.linkedClipId));
    render();
  }
  linkButton?.addEventListener('click', toggleLink);
  function field(label, key, value, min, max, step = 0.1) {
    const wrapper = doc.createElement('label');
    wrapper.textContent = label;
    const input = doc.createElement('input');
    input.type = 'number'; input.value = String(value); input.min = String(min); input.max = String(max);
    input.step = String(step); input.dataset.voiceField = key; input.setAttribute('aria-label', label);
    wrapper.append(input);
    controls.append(wrapper);
  }
  function render() {
    syncButton();
    renderStatus();
    if (!track || !controls) return;
    const resolved = voices();
    track.replaceChildren();
    track.hidden = !resolved.length;
    for (const voice of resolved) {
      const item = doc.createElement('button');
      item.type = 'button'; item.className = `voiceover-clip${selectedId === voice.id ? ' selected' : ''}`;
      item.dataset.voiceId = voice.id; item.textContent = `${voice.muted ? '◌' : '♪'} ${t('voiceover.label')}`;
      item.style.left = `${voice.start / getDuration() * 100}%`;
      item.style.width = `${voice.duration / getDuration() * 100}%`;
      item.title = t('voiceover.range', { start: voice.start.toFixed(2), end: (voice.start + voice.duration).toFixed(2) });
      item.setAttribute('aria-label', item.title);
      item.addEventListener('click', () => {
        selectedId = voice.id; state.selectedVoiceoverId = voice.id; onSelect(); render();
      });
      track.append(item);
    }
    controls.replaceChildren();
    const voice = current();
    controls.hidden = !voice;
    if (!voice) return;
    const heading = doc.createElement('strong'); heading.textContent = t('voiceover.label'); controls.append(heading);
    field(t('voiceover.timelineStart'), 'start', voices().find((item) => item.id === voice.id)?.start ?? voice.start, 0, getDuration());
    field(t('voiceover.sourceOffset'), 'offset', voice.offset, 0, voice.sourceDuration - 0.01);
    field(t('voiceover.duration'), 'duration', voice.duration, 0.01, voice.sourceDuration, 0.01);
    field(t('voiceover.volume'), 'volume', Math.round(voice.volume * 100), 0, 200, 1);
    for (const [key, label, checked] of [
      ['muted', t('voiceover.mute'), voice.muted], ['linked', t('voiceover.link'), !!voice.linkedClipId],
    ]) {
      const wrapper = doc.createElement('label'); wrapper.className = 'clip-check';
      const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = checked; input.dataset.voiceField = key;
      wrapper.append(input, doc.createTextNode(label)); controls.append(wrapper);
    }
    const remove = doc.createElement('button');
    remove.type = 'button'; remove.className = 'text-button'; remove.textContent = t('voiceover.remove');
    remove.addEventListener('click', deleteSelected);
    controls.append(remove);
  }
  controls?.addEventListener('change', (event) => {
    const key = event.target.dataset.voiceField;
    const voice = current();
    if (!key || !voice) return;
    const value = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    updateEdits(() => {
      if (key === 'muted') voice.muted = value;
      if (key === 'volume') voice.volume = Math.min(2, Math.max(0, value / 100));
      if (key === 'start') {
        voice.start = Math.min(getDuration(), Math.max(0, value));
        delete voice.linkedClipId; delete voice.linkedOffset;
      }
      if (key === 'offset') {
        voice.offset = Math.min(voice.sourceDuration - 0.01, Math.max(0, value));
        voice.duration = Math.min(voice.duration, voice.sourceDuration - voice.offset);
      }
      if (key === 'duration') voice.duration = Math.min(voice.sourceDuration - voice.offset, Math.max(0.01, value));
      if (key === 'linked') setLinked(voice, value);
    });
    render();
  });
  function syncPlayback(cursor = getCursor(), playing = state.playing) {
    const resolved = voices();
    const activeIds = new Set(resolved.map((voice) => voice.id));
    for (const [id, entry] of media) {
      if (!activeIds.has(id)) { entry.audio.pause(); entry.audio.removeAttribute('src'); entry.audio.load(); media.delete(id); }
    }
    for (const voice of resolved) {
      let entry = media.get(voice.id);
      const active = playing && !state.previewMuted && !voice.muted && cursor >= voice.start && cursor < voice.start + voice.duration;
      if (!entry && !active) continue;
      if (!entry) {
        const audio = doc.createElement('audio');
        audio.preload = 'auto';
        audio.src = voice.url || `/api/media/${encodeURIComponent(state.media.id)}/voiceovers/${encodeURIComponent(voice.id)}/file`;
        entry = { audio }; media.set(voice.id, entry);
        audio.addEventListener('error', () => say('voiceover.previewFailed'));
      }
      if (!active) { entry.audio.pause(); continue; }
      if (!entry.gain && win.AudioContext) {
        try {
          audioContext ||= new win.AudioContext();
          entry.gain = audioContext.createGain();
          audioContext.createMediaElementSource(entry.audio).connect(entry.gain);
          entry.gain.connect(audioContext.destination);
        } catch { /* Native volume is the fallback on older browsers. */ }
      }
      if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
      if (entry.gain) { entry.audio.volume = 1; entry.gain.gain.value = voice.volume; }
      else entry.audio.volume = Math.min(1, voice.volume);
      const target = voice.offset + cursor - voice.start;
      if (Math.abs(entry.audio.currentTime - target) > 0.15) {
        try { entry.audio.currentTime = target; } catch { /* The next tick retries after metadata loads. */ }
      }
      if (entry.audio.paused) entry.audio.play().catch(() => say('voiceover.playAgain'));
    }
  }
  win.addEventListener('pagehide', dispose);
  return {
    render, syncPlayback, stop, dispose,
    hasSelection: () => !!current(), deleteSelected, toggleLink,
    deselect() { selectedId = null; state.selectedVoiceoverId = null; render(); },
    toExport: () => voices().map(({ id, start, offset, duration, volume, muted }) => ({ id, start, offset, duration, volume, muted })),
  };
}
