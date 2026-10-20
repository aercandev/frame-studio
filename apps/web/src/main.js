import './style.css';
import { clamp, formatTime, cropForRatio, normalizeCrop, normalizeTrim, normalizeTextTiming, outputDimensions, makeEdits } from './edit-model.js';
import { template, icon } from './editor-template.js';
import { clipId, createClip, clipDuration, timelineDuration, clipLayout, timelinePosition, splitSequence, moveSequenceClip, snapTimelineTime, thumbnailSize } from './timeline-model.js';
import { initVoiceover } from './voiceover.js';
import { configureI18n, t, setLanguage, translatePage, subscribe, localizeError } from './i18n.js';
import { config, catalogs } from './catalogs.js';

const $ = (selector) => document.querySelector(selector);
configureI18n({ config, catalogs });
$('#app').innerHTML = template;
translatePage();
const errorBindings = new Map();
const state = { media: null, edits: null, history: [], future: [], selectedId: null, cursor: 0, playing: false, playTimer: null, playbackClip: null, lastTick: 0, tool: 'select', zoom: 1, snapping: true, ripple: true, follow: true, thumbnails: [], previewMuted: false, cropMode: false, tab: 'video', importing: false, importController: null, exportId: null, exporting: false, pollTimer: null, frameToken: 0, releaseExportPromise: null };
const video = $('#video-player');
const frame = $('#video-frame');
const dialog = $('#export-dialog');
const duration = () => timelineDuration(state.edits?.clips || []);
const selectedClip = () => state.edits?.clips.find((clip) => clip.id === state.selectedId);
const voiceovers = initVoiceover({ state, getDuration: duration, getCursor: () => state.cursor, remember, updateEdits, stopPlayback, onChange: syncImportControls, onSelect: () => { state.selectedId = null; setTab('video'); syncInputs(); renderTimeline(); } });
function initialEdits(length) {
  const edits = makeEdits(length);
  edits.text.value = t('editor.defaultText');
  return { ...edits, clips: [createClip(length)], markers: [], voiceovers: [] };
}
function syncHistory() {
  $('#undo-button').disabled = !state.history.length;
  $('#redo-button').disabled = !state.future.length;
}

function setMessage(target, key, params = {}) {
  const element = typeof target === 'string' ? $(target) : target;
  errorBindings.delete(element);
  element.dataset.i18n = key;
  element.dataset.i18nParams = JSON.stringify(params);
  element.textContent = t(key, params);
}
function localizedError(key, params = {}) {
  const error = new Error(t(key, params));
  error.i18nKey = key; error.i18nParams = params;
  return error;
}
function setErrorMessage(target, error, fallback = 'errors.UNKNOWN', retry = false) {
  const element = typeof target === 'string' ? $(target) : target;
  element.removeAttribute('data-i18n');
  element.removeAttribute('data-i18n-params');
  const render = () => {
    const message = localizeError(error, fallback);
    element.textContent = retry ? t('editor.pollRetry', { message }) : message;
  };
  errorBindings.set(element, render);
  render();
}
function setIconMessage(target, name, key) {
  const element = $(target);
  element.removeAttribute('data-i18n');
  element.innerHTML = icon(name);
  const label = document.createElement('span');
  setMessage(label, key);
  element.append(label);
}
function setProjectStatus(key) {
  const element = $('#project-status');
  element.removeAttribute('data-i18n');
  const dot = document.createElement('span'); dot.className = 'status-dot edited';
  const label = document.createElement('span'); setMessage(label, key);
  element.replaceChildren(dot, label);
}
function setStatus(kind, title, detail) {
  $('#download-status').dataset.state = kind;
  setMessage('#status-title', title);
  if (typeof detail === 'string') setMessage('#status-detail', detail);
  else setErrorMessage('#status-detail', detail);
}
function normalizeImportUrl(value) {
  const raw = value.trim();
  if (value.length > 2048 || raw.includes('\\') || /[\u0000-\u0020\u007f]/.test(raw)) {
    throw localizedError('editor.invalidUrl');
  }
  let url;
  try { url = new URL(raw); } catch { throw localizedError('editor.invalidUrl'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw localizedError('editor.invalidProtocol');
  }
  const belongsTo = (...domains) => domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  const authority = raw.match(/^https:\/\/([^/?#]+)/i)?.[1];
  const platformScheme = url.protocol === 'https:' && authority && !authority.includes(':') && !url.port;
  if (belongsTo('instagram.com')) {
    const match = url.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]{1,80})\/?$/);
    if (!platformScheme || !['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(url.hostname) || !match) {
      throw localizedError('editor.invalidInstagram');
    }
    return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  }
  const youtubeHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'];
  if (belongsTo('youtube.com', 'youtu.be')) {
    let id;
    if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    else if (/^\/watch\/?$/.test(url.pathname) && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    if (!platformScheme || !youtubeHosts.includes(url.hostname) || !/^[A-Za-z0-9_-]{11}$/.test(id || '')) {
      throw localizedError('editor.invalidYoutube');
    }
    return `https://www.youtube.com/watch?v=${id}`;
  }
  const xHosts = ['x.com', 'www.x.com', 'mobile.x.com', 'm.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'm.twitter.com'];
  if (belongsTo('x.com', 'twitter.com')) {
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15}|i\/web)\/status\/([0-9]{1,25})(?:\/video\/[1-9][0-9]*)?\/?$/);
    if (!platformScheme || !xHosts.includes(url.hostname) || !match) {
      throw localizedError('editor.invalidX');
    }
    return `https://x.com/${match[1] === 'i/web' ? 'i' : match[1]}/status/${match[2]}`;
  }
  // Preserve signed CDN query parameters; only known platform URLs are canonicalized.
  return raw;
}
async function request(path, options = {}) {
  let response;
  try { response = await fetch(path, options); }
  catch (error) { if (error.name === 'AbortError') throw error; throw localizedError('editor.networkError'); }
  let body;
  try { body = await response.json(); } catch { /* A proxy error can return HTML. */ }
  if (!response.ok) {
    const error = body?.error?.code ? Object.assign(new Error(), { code: body.error.code }) : localizedError('editor.networkError');
    error.status = response.status;
    throw error;
  }
  return body;
}
function remember() {
  if (!state.edits) return;
  if (JSON.stringify(state.history.at(-1)) !== JSON.stringify(state.edits)) state.history.push(structuredClone(state.edits));
  if (state.history.length > 100) state.history.shift();
  state.future = [];
  syncHistory();
}
function updateEdits(change, { history = true, inputs = true } = {}) {
  if (!state.media) return;
  if (history) remember();
  change(state.edits);
  state.edits.crop = normalizeCrop(state.edits.crop);
  const clip = selectedClip();
  if (clip && !clip.gapDuration && !clip.freezeDuration) {
    const minimum = Math.min(1 / (state.media.fps || 30), state.media.duration);
    clip.start = clamp(Number(clip.start) || 0, 0, state.media.duration - minimum);
    clip.end = clamp(Number(clip.end) || 0, clip.start + minimum, state.media.duration);
  }
  state.edits.trim = clip && !clip.gapDuration ? { start: clip.start, end: clip.end } : { start: 0, end: state.media.duration };
  if (duration() > 0) normalizeTextTiming(state.edits.text, duration());
  state.cursor = clamp(state.cursor, 0, duration());
  if (inputs) syncInputs();
  renderPreview(); renderTimeline(); syncImportControls(); syncHistory();
  if (!state.playing) seekTimeline(state.cursor);
  setProjectStatus('editor.editsReady');
}
function syncInputs() {
  if (!state.edits) return;
  const { crop, text } = state.edits;
  const clip = selectedClip();
  const trim = clip && !clip.gapDuration ? clip : { start: 0, end: 0 };
  ['x', 'y', 'width', 'height'].forEach((key) => { $(`#crop-${key}`).value = Number((crop[key] * 100).toFixed(1)); });
  ['start', 'end'].forEach((key) => {
    $(`#trim-${key}`).value = Number(trim[key].toFixed(2));
    $(`#trim-${key}`).max = state.media.duration;
    $(`#text-${key}`).value = Number(text[key].toFixed(2));
    $(`#text-${key}`).max = duration();
    $(`#trim-${key}`).disabled = !clip || !!clip.gapDuration || !!clip.freezeDuration;
  });
  $('#text-enabled').checked = text.enabled;
  $('#text-fields').disabled = !text.enabled;
  $('#text-value').value = text.value;
  $('#text-size').value = text.size;
  $('#text-color').value = text.color;
  $('#text-color-code').textContent = text.color.toUpperCase();
  $('#text-x').value = Number((text.x * 100).toFixed(1));
  $('#text-y').value = Number((text.y * 100).toFixed(1));
  $('#text-char-count').textContent = `${text.value.length} / 120`;
  $('#selected-duration').textContent = formatTime(clip ? clipDuration(clip) : 0, true);
  $('#mute-button').disabled = !state.media.hasAudio && !(state.edits.voiceovers || []).length;
  setMessage('#timeline-duration', 'editor.clipCount', { count: state.edits.clips.filter((entry) => !entry.gapDuration).length, duration: formatTime(duration(), true) });
  $('#clip-speed').value = clip?.speed || 1;
  $('#clip-volume').value = clip?.volume ?? 100;
  $('#clip-muted').checked = !!clip?.muted;
  $('#clip-reverse').checked = !!clip?.reverse;
  $('#freeze-settings').hidden = !clip?.freezeDuration;
  $('#freeze-duration').value = clip?.freezeDuration || 3;
  for (const id of ['clip-speed', 'clip-volume', 'clip-muted', 'clip-reverse']) $(`#${id}`).disabled = !clip || !!clip.gapDuration || !!clip.freezeDuration;
  document.querySelectorAll('[data-needs-clip]').forEach((button) => { button.disabled = !clip; });
  $('#delete-clip').disabled = !clip && !voiceovers.hasSelection();
  $('#reverse-button').disabled = !clip || !!clip.gapDuration || !!clip.freezeDuration;
  $('#reverse-button').classList.toggle('active', !!clip?.reverse);
  $('#reverse-button').setAttribute('aria-pressed', String(!!clip?.reverse));
  const hint = clip?.reverse ? 'editor.reverseHint' : clip?.freezeDuration ? 'editor.freezeHint' : clip?.gapDuration ? 'editor.gapHint' : null;
  if (hint) setMessage('#clip-playback-hint', hint);
  else { $('#clip-playback-hint').removeAttribute('data-i18n'); $('#clip-playback-hint').textContent = ''; }
  const ratio = (state.media.width * crop.width) / (state.media.height * crop.height);
  let selected = 'custom';
  if (Math.abs(crop.width - 1) < 0.002 && Math.abs(crop.height - 1) < 0.002) selected = 'source';
  else for (const [label, value] of [['9:16', 9 / 16], ['16:9', 16 / 9], ['1:1', 1], ['4:5', 4 / 5]]) if (Math.abs(ratio - value) < 0.005) selected = label;
  document.querySelectorAll('.ratio-option').forEach((button) => {
    button.classList.toggle('selected', button.dataset.ratio === selected);
    button.setAttribute('aria-pressed', String(button.dataset.ratio === selected));
  });
  if (selected === 'source' || selected === 'custom') setMessage('#output-ratio', selected === 'source' ? 'editor.original' : 'editor.custom');
  else { $('#output-ratio').removeAttribute('data-i18n'); $('#output-ratio').textContent = selected; }
}
function renderPreview() {
  if (!state.media) return;
  const { width, height } = state.media;
  const { crop } = state.edits;
  const stage = $('#preview-stage');
  const availableWidth = Math.max(1, stage.clientWidth - 48);
  const availableHeight = Math.max(1, stage.clientHeight - (state.cropMode ? 56 : 32));
  const ratio = state.cropMode ? width / height : (width * crop.width) / (height * crop.height);
  const boxWidth = Math.min(availableWidth, availableHeight * ratio);
  const boxHeight = boxWidth / ratio;
  frame.style.width = `${boxWidth}px`;
  frame.style.height = `${boxHeight}px`;
  video.style.width = `${state.cropMode ? boxWidth : boxWidth / crop.width}px`;
  video.style.height = `${state.cropMode ? boxHeight : boxHeight / crop.height}px`;
  video.style.left = `${state.cropMode ? 0 : -crop.x * boxWidth / crop.width}px`;
  video.style.top = `${state.cropMode ? 0 : -crop.y * boxHeight / crop.height}px`;
  const overlay = $('#crop-overlay');
  overlay.hidden = !state.cropMode;
  overlay.style.left = `${crop.x * 100}%`;
  overlay.style.top = `${crop.y * 100}%`;
  overlay.style.width = `${crop.width * 100}%`;
  overlay.style.height = `${crop.height * 100}%`;
  $('#crop-hint').hidden = !state.cropMode;
  $('#crop-mode').classList.toggle('active', state.cropMode);
  setIconMessage('#crop-mode', state.cropMode ? 'check' : 'crop', state.cropMode ? 'editor.applyCrop' : 'editor.editCrop');
  if (state.cropMode) setMessage('#preview-badge', 'editor.editCrop');
  else { $('#preview-badge').removeAttribute('data-i18n'); $('#preview-badge').textContent = `${Math.round(width * crop.width)} × ${Math.round(height * crop.height)}`; }
  renderText();
}
function renderText() {
  if (!state.edits) return;
  const text = state.edits.text;
  const relativeTime = state.cursor;
  const overlay = $('#text-overlay');
  overlay.hidden = !duration() || state.cropMode || !text.enabled || !text.value.trim() || relativeTime < text.start - 0.02 || relativeTime > text.end;
  overlay.textContent = text.value;
  overlay.style.fontSize = `${frame.clientHeight * text.size / 100}px`;
  overlay.style.color = text.color;
  overlay.style.webkitTextStroke = `${frame.clientHeight * 0.002}px #000c`;
  overlay.style.paintOrder = 'stroke fill';
  const halfWidth = overlay.offsetWidth / 2;
  const halfHeight = overlay.offsetHeight / 2;
  overlay.style.left = `${Math.max(halfWidth, Math.min(frame.clientWidth - halfWidth, frame.clientWidth * text.x))}px`;
  overlay.style.top = `${Math.max(halfHeight, Math.min(frame.clientHeight - halfHeight, frame.clientHeight * text.y))}px`;
  setMessage('#text-hint', overlay.offsetWidth > frame.clientWidth || overlay.offsetHeight > frame.clientHeight
    ? 'editor.textOverflow'
    : 'editor.textHint');
}
function renderTimeline() {
  if (!state.media) return;
  const total = duration() || 1;
  const { text } = state.edits;
  const timeline = $('#timeline');
  const viewport = $('.timeline-scroll').clientWidth - 38;
  timeline.style.width = `${Math.max(380, viewport) * state.zoom}px`;
  $('#timeline-zoom').value = state.zoom;
  $('#zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
  $('#ruler').replaceChildren();
  const tickCount = Math.max(5, Math.round(timeline.clientWidth / 100));
  for (let index = 0; index <= tickCount; index += 1) {
    const tick = document.createElement('span');
    tick.style.left = `${index / tickCount * 100}%`;
    tick.textContent = formatTime(total * index / tickCount, total < 10);
    $('#ruler').append(tick);
  }
  const track = $('#clip-track');
  track.replaceChildren();
  track.hidden = !state.edits.clips.length;
  $('#timeline-empty').hidden = !!state.edits.clips.length;
  for (const item of clipLayout(state.edits.clips)) {
    const { clip } = item;
    const block = document.createElement('div');
    block.className = `sequence-clip${clip.id === state.selectedId ? ' selected' : ''}${clip.gapDuration ? ' gap-clip' : ''}`;
    block.dataset.clipId = clip.id;
    block.style.left = `${item.start / total * 100}%`;
    block.style.width = `${item.duration / total * 100}%`;
    block.tabIndex = 0;
    block.draggable = true;
    block.setAttribute('role', 'button');
    block.setAttribute('aria-label', t('editor.clipDescription', { name: clip.gapDuration ? t('editor.gap') : t('editor.clip', { number: item.index + 1 }), duration: formatTime(item.duration, true) }));
    block.setAttribute('aria-pressed', String(clip.id === state.selectedId));
    const thumbs = document.createElement('div');
    thumbs.className = 'clip-thumbnails';
    if (!clip.gapDuration && state.thumbnails.length) {
      const tileWidth = Math.max(12, 54 * state.media.width / state.media.height);
      const count = Math.min(200, Math.max(1, Math.ceil(timeline.clientWidth * item.duration / total / tileWidth)));
      for (let index = 0; index < count; index += 1) {
        const progress = count > 1 ? index / (count - 1) : 0.5;
        const sourceTime = clip.freezeDuration ? clip.start : clip.reverse ? clip.end - progress * (clip.end - clip.start) : clip.start + progress * (clip.end - clip.start);
        const thumbnail = state.thumbnails.reduce((best, entry) => Math.abs(entry.time - sourceTime) < Math.abs(best.time - sourceTime) ? entry : best);
        const image = document.createElement('img');
        image.src = thumbnail.url; image.alt = ''; image.draggable = false;
        image.style.aspectRatio = `${state.media.width} / ${state.media.height}`;
        thumbs.append(image);
      }
    }
    const label = document.createElement('span');
    label.className = 'clip-label';
    label.textContent = clip.gapDuration ? t('editor.gap') : `${item.index + 1} · ${clip.freezeDuration ? t('editor.freeze') : state.media.filename}${clip.speed !== 1 ? ` · ${clip.speed}×` : ''}${clip.reverse ? ` · ${t('editor.reverse')}` : ''}${clip.muted ? ` · ${t('editor.muted')}` : ''}`;
    block.append(thumbs, label);
    if (clip.id === state.selectedId && !clip.gapDuration && !clip.freezeDuration) {
      for (const edge of ['start', 'end']) {
        const handle = document.createElement('button');
        handle.id = `trim-handle-${edge}`;
        handle.className = `trim-handle ${edge}`;
        handle.dataset.edge = edge;
        handle.setAttribute('aria-label', t(edge === 'start' ? 'editor.trimStart' : 'editor.trimEnd'));
        handle.title = t('editor.trimHint');
        block.append(handle);
      }
    }
    track.append(block);
  }
  $('#marker-track').replaceChildren();
  state.edits.markers.forEach((marker, index) => {
    if (marker.time > total) return;
    const button = document.createElement('button');
    button.className = 'timeline-marker'; button.dataset.markerId = marker.id;
    button.style.left = `${marker.time / total * 100}%`;
    button.title = t('editor.marker', { number: index + 1, time: formatTime(marker.time, true) });
    button.setAttribute('aria-label', button.title);
    button.innerHTML = icon('marker');
    $('#marker-track').append(button);
  });
  $('#text-clip').hidden = !text.enabled || !text.value.trim();
  $('#text-clip').style.left = `${text.start / total * 100}%`;
  $('#text-clip').style.width = `${(text.end - text.start) / total * 100}%`;
  $('#text-clip-label').textContent = text.value;
  $('#total-time').textContent = formatTime(duration(), true);
  $('#play-button').disabled = !state.edits.clips.length;
  $('#playhead').hidden = !state.edits.clips.length;
  voiceovers.render();
  renderPlayback();
}
function renderPlayback() {
  if (!state.media) return;
  $('#current-time').textContent = formatTime(state.cursor, true);
  $('#playhead').style.left = `${clamp(state.cursor / (duration() || 1), 0, 1) * 100}%`;
  if (state.playing && state.follow) {
    const scroll = $('.timeline-scroll');
    const pixel = state.cursor / (duration() || 1) * $('#timeline').clientWidth;
    if (pixel < scroll.scrollLeft || pixel > scroll.scrollLeft + scroll.clientWidth - 60) scroll.scrollLeft = Math.max(0, pixel - scroll.clientWidth * 0.3);
  }
  renderText();
}
function setTab(tab) {
  state.tab = tab;
  for (const name of ['video', 'text']) {
    $(`#${name}-tab`).classList.toggle('active', tab === name);
    $(`#${name}-tab`).setAttribute('aria-selected', String(tab === name));
    $(`#${name}-tab`).tabIndex = tab === name ? 0 : -1;
    $(`#${name}-settings`).hidden = !state.media || tab !== name;
  }
  if (tab === 'text' && state.cropMode) { state.cropMode = false; renderPreview(); }
}
$('#video-tab').addEventListener('click', () => setTab('video'));
$('#text-tab').addEventListener('click', () => setTab('text'));
$('.inspector-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault(); setTab(state.tab === 'video' ? 'text' : 'video'); $(`#${state.tab}-tab`).focus();
});
$('#sample-button').addEventListener('click', () => { $('#video-url').value = 'https://www.instagram.com/reel/DeU6pnasz7F/'; $('#video-url').focus(); });
$('#video-url').addEventListener('input', () => $('#video-url').removeAttribute('aria-invalid'));
function syncImportControls() {
  const busy = state.importing || state.exporting || state.recordingVoiceover;
  $('#download-button').disabled = busy;
  $('#local-import-button').disabled = busy;
  $('#video-file').disabled = busy;
  $('#sample-button').disabled = busy;
  $('#video-url').readOnly = busy;
  $('#open-export').disabled = busy || !state.media || !state.edits?.clips.length;
  $('#import-cancel').hidden = !state.importing;
  $('#import-cancel').disabled = false;
  setMessage('#button-text', state.importing ? 'editor.preparingImport' : state.media ? 'editor.replaceVideo' : 'editor.importVideo');
  if (state.importing) $('#download-form').setAttribute('aria-busy', 'true');
  else $('#download-form').removeAttribute('aria-busy');
}
function useMedia(media) {
  const oldId = state.media?.id;
  stopPlayback();
  voiceovers.dispose();
  state.media = media; state.edits = initialEdits(media.duration); state.history = []; state.future = []; state.cropMode = false; state.frameToken += 1;
  state.selectedId = state.edits.clips[0].id; state.cursor = 0; state.thumbnails = []; state.zoom = 1;
  $('#media-poster').removeAttribute('src'); $('#export-poster').removeAttribute('src');
  video.src = media.url || `/api/media/${media.id}/file`; video.load();
  $('#project-name').removeAttribute('data-i18n');
  $('#project-name').textContent = media.filename.replace(/\.[^.]+$/, '');
  $('#export-name').value = media.filename.replace(/\.[^.]+$/, '').slice(0, 80);
  $('#media-filename').textContent = media.filename;
  $('#media-duration').textContent = formatTime(media.duration);
  $('#media-dimensions').textContent = `${media.width} × ${media.height}`;
  $('#source-download').href = media.url || `/api/media/${media.id}/file`; $('#source-download').download = media.filename;
  $('#library-empty').hidden = true; $('#media-card').hidden = false; $('#media-count').textContent = '1';
  $('#preview-empty').hidden = true; $('#video-frame').hidden = false; $('#inspector-empty').hidden = true;
  $('#timeline-empty').hidden = true; $('#clip-track').hidden = false; $('#playhead').hidden = false;
  $('#play-button').disabled = false; $('#mute-button').disabled = !media.hasAudio; $('#reset-button').disabled = false; $('#undo-button').disabled = true;
  for (const id of ['marker-button', 'frame-previous', 'frame-next', 'append-source']) $(`#${id}`).disabled = false;
  syncHistory();
  setTab('video'); syncInputs(); renderPreview(); renderTimeline();
  setStatus('success', 'editor.readyTitle', 'editor.readyDetail');
  setProjectStatus('editor.videoReady');
  void generateThumbnails(media, state.frameToken);
  if (oldId && oldId !== media.id) fetch(`/api/media/${oldId}`, { method: 'DELETE' }).catch(() => {});
}
async function importMedia(path, options, detail) {
  if (state.importing || state.exporting || state.recordingVoiceover) return;
  stopPlayback(); state.importing = true;
  const controller = new AbortController();
  state.importController = controller;
  syncImportControls();
  $('#video-url').removeAttribute('aria-invalid');
  setStatus('loading', 'editor.importing', detail);
  try {
    const media = await request(path, { ...options, signal: controller.signal });
    if (controller.signal.aborted) {
      fetch(`/api/media/${media.id}`, { method: 'DELETE' }).catch(() => {});
      throw new DOMException(t('editor.importCancelled'), 'AbortError');
    }
    useMedia(media);
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus('idle', 'editor.importCancelled',
        state.media ? 'editor.existingEditsPreserved' : 'editor.tryAnotherVideo');
    } else setStatus('error', 'editor.importFailed', error);
  } finally {
    state.importing = false; state.importController = null;
    $('#video-file').value = '';
    syncImportControls();
  }
}
$('#local-import-button').addEventListener('click', () => {
  if (!state.importing && !state.exporting) $('#video-file').click();
});
$('#video-file').addEventListener('change', async () => {
  const file = $('#video-file').files?.[0];
  $('#video-file').value = '';
  if (!file || state.importing || state.exporting || state.recordingVoiceover) return;
  if (!file.size) {
    setStatus('error', 'editor.checkFile', 'editor.emptyFile');
    return;
  }
  await importMedia('/api/media/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file,
  }, 'editor.uploadingDetail');
});
$('#import-cancel').addEventListener('click', () => {
  if (!state.importController) return;
  $('#import-cancel').disabled = true;
  state.importController.abort();
});
$('#download-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.importing || state.exporting || state.recordingVoiceover) return;
  let url;
  try { url = normalizeImportUrl($('#video-url').value); } catch (error) {
    $('#video-url').setAttribute('aria-invalid', 'true');
    setStatus('error', 'editor.checkLink', error); $('#video-url').focus(); return;
  }
  await importMedia('/api/media', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  }, 'editor.downloadingDetail');
});
function once(target, name, timeout = 12_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(localizedError('editor.previewTimeout')); }, timeout);
    const success = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(localizedError('editor.previewUnreadable')); };
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(name, success); target.removeEventListener('error', error); };
    target.addEventListener(name, success, { once: true }); target.addEventListener('error', error, { once: true });
  });
}
async function generateThumbnails(media, token) {
  const reader = document.createElement('video'); reader.muted = true; reader.preload = 'auto';
  try {
    const loaded = once(reader, 'loadeddata'); reader.src = media.url || `/api/media/${media.id}/file`; await loaded;
    const canvas = document.createElement('canvas');
    Object.assign(canvas, thumbnailSize(media.width, media.height));
    const context = canvas.getContext('2d');
    for (let i = 0; i < 9; i += 1) {
      if (token !== state.frameToken) return;
      const sought = once(reader, 'seeked');
      reader.currentTime = Math.max(0.001, Math.min(media.duration - 0.01, media.duration * (i + 0.2) / 9)); await sought;
      if (token !== state.frameToken) return;
      context.drawImage(reader, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.72);
      if (i === 0) $('#media-poster').src = url;
      state.thumbnails.push({ time: reader.currentTime, url });
      renderTimeline();
    }
  } catch { /* A thumbnail is optional; playback and export remain usable. */ }
  finally { reader.removeAttribute('src'); reader.load(); }
}
video.addEventListener('loadedmetadata', () => { renderPreview(); renderTimeline(); });
video.addEventListener('error', () => { if (state.media) setStatus('error', 'editor.previewFailed', 'editor.previewFailedDetail'); });
video.addEventListener('timeupdate', renderPlayback);
let audioContext;
let previewGain;
function ensurePreviewAudio() {
  if (!audioContext && window.AudioContext) {
    try {
      audioContext = new window.AudioContext();
      previewGain = audioContext.createGain();
      audioContext.createMediaElementSource(video).connect(previewGain);
      previewGain.connect(audioContext.destination);
    } catch { /* Native volume still works when Web Audio is unavailable. */ }
  }
  audioContext?.resume().catch(() => {});
}
function showPlayState() {
  $('#play-button').innerHTML = icon(state.playing ? 'pause' : 'play');
  $('#play-button').setAttribute('aria-label', t(state.playing ? 'editor.pause' : 'editor.play'));
}
function stopPlayback() {
  state.playing = false; clearTimeout(state.playTimer); video.pause(); showPlayState();
  voiceovers.stop();
}
function seekTimeline(time, force = true) {
  state.cursor = clamp(time, 0, duration());
  const position = timelinePosition(state.edits?.clips || [], state.cursor);
  if (!position) { video.pause(); video.style.visibility = 'hidden'; voiceovers.stop(); renderPlayback(); return; }
  const { clip, sourceTime } = position;
  video.style.visibility = clip.gapDuration ? 'hidden' : 'visible';
  const nativePlayback = state.playing && !clip.reverse && !clip.freezeDuration && !clip.gapDuration;
  const changed = state.playbackClip !== clip.id;
  state.playbackClip = clip.id;
  video.muted = state.previewMuted || clip.muted || !!clip.gapDuration || !!clip.freezeDuration || !!clip.reverse;
  if (previewGain) { video.volume = 1; previewGain.gain.value = (clip.volume ?? 100) / 100; }
  else video.volume = Math.min(1, (clip.volume ?? 100) / 100);
  video.playbackRate = clip.speed || 1;
  if (!clip.gapDuration && (force || changed || !nativePlayback || Math.abs(video.currentTime - sourceTime) > 0.25)) {
    video.currentTime = clamp(sourceTime, 0, Math.max(0, state.media.duration - 0.001));
  }
  if (nativePlayback && video.paused) video.play().catch(() => { stopPlayback(); setStatus('error', 'editor.playFailed', 'editor.playFailedDetail'); });
  if (!nativePlayback && !video.paused) video.pause();
  voiceovers.syncPlayback(state.cursor, state.playing);
  renderPlayback();
}
function playbackTick() {
  if (!state.playing) return;
  const now = performance.now();
  const elapsed = (now - state.lastTick) / 1000;
  state.lastTick = now;
  seekTimeline(state.cursor + elapsed, false);
  if (state.cursor >= duration()) { stopPlayback(); return; }
  state.playTimer = setTimeout(playbackTick, 33);
}
function togglePlayback() {
  if (!state.media || !duration()) return;
  if (state.playing) { stopPlayback(); return; }
  ensurePreviewAudio();
  if (state.cursor >= duration() - 0.02) state.cursor = 0;
  state.playing = true; state.lastTick = performance.now();
  seekTimeline(state.cursor); showPlayState(); playbackTick();
}
$('#play-button').addEventListener('click', togglePlayback);
$('#mute-button').addEventListener('click', () => {
  state.previewMuted = !state.previewMuted; $('#mute-button').innerHTML = icon(state.previewMuted ? 'mute' : 'volume');
  syncMuteLabel();
  seekTimeline(state.cursor);
});
function syncMuteLabel() {
  const label = t(state.previewMuted ? 'editor.unmute' : 'editor.mute');
  $('#mute-button').setAttribute('aria-label', label); $('#mute-button').title = label;
}
new ResizeObserver(renderPreview).observe($('#preview-stage'));
new ResizeObserver(() => { if (state.media) renderTimeline(); }).observe($('.timeline-scroll'));
document.fonts.ready.then(renderPreview);
document.querySelectorAll('.ratio-option').forEach((button) => button.addEventListener('click', () => {
  const name = button.dataset.ratio;
  const ratio = name === 'source' ? null : name.split(':').reduce((a, b) => Number(a) / Number(b));
  updateEdits((edits) => { edits.crop = cropForRatio(state.media.width, state.media.height, ratio); });
}));
$('#crop-reset').addEventListener('click', () => updateEdits((edits) => { edits.crop = cropForRatio(1, 1, null); }));
$('#crop-mode').addEventListener('click', () => { stopPlayback(); state.cropMode = !state.cropMode; renderPreview(); });
for (const key of ['x', 'y', 'width', 'height']) $(`#crop-${key}`).addEventListener('change', (event) => updateEdits((edits) => { edits.crop[key] = Number(event.target.value) / 100; }));
for (const key of ['start', 'end']) $(`#trim-${key}`).addEventListener('change', (event) => {
  if (!selectedClip()) return;
  stopPlayback();
  updateEdits(() => { selectedClip()[key] = Number(event.target.value); });
  seekTimeline(clipLayout(state.edits.clips).find((item) => item.clip.id === state.selectedId)?.start || 0);
});
$('#text-enabled').addEventListener('change', (event) => updateEdits((edits) => { edits.text.enabled = event.target.checked; }));
$('#text-value').addEventListener('focus', remember);
$('#text-value').addEventListener('input', (event) => {
  updateEdits((edits) => { edits.text.value = event.target.value; }, { history: false, inputs: false }); $('#text-char-count').textContent = `${event.target.value.length} / 120`;
});
for (const key of ['size', 'x', 'y', 'start', 'end', 'color']) $(`#text-${key}`).addEventListener('change', (event) => {
  updateEdits((edits) => {
    let value = key === 'color' ? event.target.value : Number(event.target.value);
    if (['x', 'y'].includes(key)) value = clamp(value / 100, 0, 1);
    if (key === 'size') value = clamp(value, 2, 20);
    edits.text[key] = value;
  });
});
$('#undo-button').addEventListener('click', undo);
function undo() {
  if (!state.history.length) return;
  stopPlayback(); state.future.push(structuredClone(state.edits)); state.edits = state.history.pop();
  restoreHistory();
}
function redo() {
  if (!state.future.length) return;
  stopPlayback(); state.history.push(structuredClone(state.edits)); state.edits = state.future.pop();
  restoreHistory();
}
function restoreHistory() {
  voiceovers.deselect();
  if (!selectedClip()) state.selectedId = state.edits.clips[0]?.id;
  syncInputs(); renderPreview(); renderTimeline(); syncHistory(); syncImportControls(); seekTimeline(state.cursor);
}
$('#redo-button').addEventListener('click', redo);
$('#reset-button').addEventListener('click', () => {
  stopPlayback();
  updateEdits(() => { state.edits = initialEdits(state.media.duration); state.selectedId = state.edits.clips[0].id; });
  state.cropMode = false; renderPreview(); seekTimeline(0);
});
function drag(element, onStart, onMove) {
  element.addEventListener('pointerdown', (event) => {
    if (!state.media || event.button !== 0) return;
    const context = onStart(event); if (context === false) return;
    event.preventDefault(); event.stopPropagation(); element.setPointerCapture(event.pointerId);
    const move = (next) => onMove(next, context);
    const stop = () => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', stop); element.removeEventListener('pointercancel', stop);
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId); syncInputs();
    };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', stop); element.addEventListener('pointercancel', stop);
  });
}
drag($('#crop-overlay'), (event) => {
  remember(); return { x: event.clientX, y: event.clientY, crop: { ...state.edits.crop }, box: frame.getBoundingClientRect(), corner: event.target.dataset.corner };
}, (event, start) => {
  const dx = (event.clientX - start.x) / start.box.width; const dy = (event.clientY - start.y) / start.box.height; const crop = { ...start.crop };
  if (!start.corner) { crop.x += dx; crop.y += dy; }
  else {
    const right = crop.x + crop.width; const bottom = crop.y + crop.height;
    if (start.corner.includes('w')) { crop.x = clamp(crop.x + dx, 0, right - 0.05); crop.width = right - crop.x; }
    if (start.corner.includes('e')) crop.width = clamp(crop.width + dx, 0.05, 1 - crop.x);
    if (start.corner.includes('n')) { crop.y = clamp(crop.y + dy, 0, bottom - 0.05); crop.height = bottom - crop.y; }
    if (start.corner.includes('s')) crop.height = clamp(crop.height + dy, 0.05, 1 - crop.y);
  }
  updateEdits((edits) => { edits.crop = crop; }, { history: false });
});
drag($('#text-overlay'), (event) => {
  remember(); setTab('text'); return { x: event.clientX, y: event.clientY, text: { ...state.edits.text }, box: frame.getBoundingClientRect() };
}, (event, start) => {
  updateEdits((edits) => {
    edits.text.x = clamp(start.text.x + (event.clientX - start.x) / start.box.width, 0, 1);
    edits.text.y = clamp(start.text.y + (event.clientY - start.y) / start.box.height, 0, 1);
  }, { history: false });
});
function selectClip(id, seek = false) {
  voiceovers.deselect();
  state.selectedId = id;
  syncInputs(); renderTimeline();
  if (seek) seekTimeline(clipLayout(state.edits.clips).find((item) => item.clip.id === id)?.start || 0);
}
function applyClipChange(change) {
  if (!selectedClip()) return;
  stopPlayback(); updateEdits(() => change(selectedClip()));
}
function splitAtCursor() {
  const result = splitSequence(state.edits.clips, state.cursor, 1 / (state.media.fps || 30));
  if (!result) return;
  stopPlayback(); updateEdits((edits) => { edits.clips = result.clips; state.selectedId = result.selectedId; });
}
function removeSelected() {
  const clip = selectedClip(); if (!clip) return;
  stopPlayback();
  updateEdits((edits) => {
    const index = edits.clips.findIndex((item) => item.id === clip.id);
    if (!state.ripple && !clip.gapDuration) edits.clips.splice(index, 1, { id: clipId(), gapDuration: clipDuration(clip) });
    else edits.clips.splice(index, 1);
    state.selectedId = edits.clips[Math.min(index, edits.clips.length - 1)]?.id;
  });
}
function duplicateSelected() {
  const clip = selectedClip(); if (!clip) return;
  stopPlayback();
  updateEdits((edits) => {
    const copy = { ...clip, id: clipId() };
    edits.clips.splice(edits.clips.findIndex((item) => item.id === clip.id) + 1, 0, copy);
    state.selectedId = copy.id;
  });
}
function moveSelected(delta) {
  if (!selectedClip()) return;
  stopPlayback(); updateEdits((edits) => {
    const index = edits.clips.findIndex((clip) => clip.id === state.selectedId);
    edits.clips = moveSequenceClip(edits.clips, state.selectedId, index + delta);
  });
}
function trimAtCursor(side) {
  const position = timelinePosition(state.edits.clips, state.cursor);
  if (!position || position.clip.id !== state.selectedId) return;
  const result = splitSequence(state.edits.clips, state.cursor, 1 / (state.media.fps || 30));
  if (!result) return;
  stopPlayback(); updateEdits((edits) => {
    const left = result.clips[position.index], right = result.clips[position.index + 1];
    const keep = side === 'left' ? right : left;
    const removed = side === 'left' ? left : right;
    const replacements = state.ripple ? [keep] : side === 'left'
      ? [{ id: clipId(), gapDuration: clipDuration(removed) }, keep]
      : [keep, { id: clipId(), gapDuration: clipDuration(removed) }];
    edits.clips.splice(position.index, 1, ...replacements);
    state.selectedId = keep.id;
  });
}
function toggleMarker() {
  if (!state.media) return;
  updateEdits((edits) => {
    const existing = edits.markers.findIndex((marker) => Math.abs(marker.time - state.cursor) < 0.05);
    if (existing >= 0) edits.markers.splice(existing, 1);
    else edits.markers.push({ id: clipId(), time: state.cursor });
    edits.markers.sort((a, b) => a.time - b.time);
  });
}
function insertFreeze() {
  const position = timelinePosition(state.edits.clips, state.cursor);
  if (!position || position.clip.gapDuration) return;
  stopPlayback();
  const fps = state.media.fps || 30;
  const sample = clamp(Math.floor(position.sourceTime * fps) / fps, 0, Math.max(0, state.media.duration - 1 / fps));
  const frozen = { ...createClip(state.media.duration), start: sample, end: sample, freezeDuration: 3, muted: true };
  updateEdits((edits) => {
    const split = splitSequence(edits.clips, state.cursor, 1 / (state.media.fps || 30));
    if (split) { edits.clips = split.clips; edits.clips.splice(position.index + 1, 0, frozen); }
    else edits.clips.splice(position.local < 0.001 ? position.index : position.index + 1, 0, frozen);
    state.selectedId = frozen.id;
  });
}
function setTool(tool) {
  state.tool = tool;
  for (const [id, name] of [['select-tool', 'select'], ['blade-tool', 'blade']]) {
    $(`#${id}`).classList.toggle('active', tool === name);
    $(`#${id}`).setAttribute('aria-pressed', String(tool === name));
  }
  $('#timeline').classList.toggle('blade-mode', tool === 'blade');
}
function setToggle(id, key) {
  state[key] = !state[key];
  $(`#${id}`).classList.toggle('active', state[key]);
  $(`#${id}`).setAttribute('aria-pressed', String(state[key]));
}
function setZoom(value) {
  state.zoom = clamp(Number(value), 1, 20); renderTimeline();
}
function stepFrame(direction) {
  stopPlayback(); seekTimeline(state.cursor + direction / (state.media?.fps || 30));
}
$('#select-tool').addEventListener('click', () => setTool('select'));
$('#blade-tool').addEventListener('click', () => setTool('blade'));
$('#split-button').addEventListener('click', splitAtCursor);
$('#delete-clip').addEventListener('click', () => voiceovers.hasSelection() ? voiceovers.deleteSelected() : removeSelected());
$('#duplicate-clip').addEventListener('click', duplicateSelected);
$('#trim-left-button').addEventListener('click', () => trimAtCursor('left'));
$('#trim-right-button').addEventListener('click', () => trimAtCursor('right'));
$('#marker-button').addEventListener('click', toggleMarker);
$('#freeze-button').addEventListener('click', insertFreeze);
$('#reverse-button').addEventListener('click', () => applyClipChange((clip) => { clip.reverse = !clip.reverse; }));
$('#snap-toggle').addEventListener('click', () => setToggle('snap-toggle', 'snapping'));
$('#follow-toggle').addEventListener('click', () => setToggle('follow-toggle', 'follow'));
$('#ripple-toggle').addEventListener('click', () => {
  setToggle('ripple-toggle', 'ripple');
  if (state.ripple && state.edits?.clips.some((clip) => clip.gapDuration)) updateEdits((edits) => {
    edits.clips = edits.clips.filter((clip) => !clip.gapDuration);
    if (!selectedClip()) state.selectedId = edits.clips[0]?.id;
  });
});
$('#frame-previous').addEventListener('click', () => stepFrame(-1));
$('#frame-next').addEventListener('click', () => stepFrame(1));
$('#timeline-zoom').addEventListener('input', (event) => setZoom(event.target.value));
$('#zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.5));
$('#zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.5));
$('#zoom-fit').addEventListener('click', () => { setZoom(1); $('.timeline-scroll').scrollLeft = 0; });
$('#append-source').addEventListener('click', () => updateEdits((edits) => {
  voiceovers.deselect();
  const clip = createClip(state.media.duration); edits.clips.push(clip); state.selectedId = clip.id;
}));
for (const [id, key] of [['clip-speed', 'speed'], ['clip-volume', 'volume'], ['clip-muted', 'muted'], ['clip-reverse', 'reverse'], ['freeze-duration', 'freezeDuration']]) {
  $(`#${id}`).addEventListener('change', (event) => applyClipChange((clip) => {
    let value = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
    if (key === 'volume') value = clamp(value, 0, 200);
    if (key === 'speed') value = clamp(value, 0.25, 4);
    if (key === 'freezeDuration') value = Math.max(0.1, value || 0.1);
    clip[key] = value;
  }));
}
function pointerTime(event) {
  const box = $('#timeline').getBoundingClientRect();
  const time = clamp((event.clientX - box.left) / Math.max(1, box.width), 0, 1) * duration();
  return snapTimelineTime(time, state.edits.clips, state.edits.markers, duration() * 8 / Math.max(1, box.width), state.snapping && !event.altKey);
}
$('#clip-track').addEventListener('click', (event) => {
  const block = event.target.closest('[data-clip-id]');
  if (!block || event.target.closest('.trim-handle')) return;
  const clickedTime = pointerTime(event);
  stopPlayback(); selectClip(block.dataset.clipId); seekTimeline(clickedTime);
  if (state.tool === 'blade') splitAtCursor();
});
$('#clip-track').addEventListener('keydown', (event) => {
  const block = event.target.closest('[data-clip-id]'); if (!block) return;
  voiceovers.deselect();
  state.selectedId = block.dataset.clipId;
  if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); event.stopPropagation(); moveSelected(event.key === 'ArrowLeft' ? -1 : 1);
    $(`[data-clip-id="${state.selectedId}"]`)?.focus();
  } else if (event.target.dataset.edge && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); event.stopPropagation();
    const clip = selectedClip();
    const edge = clip.reverse ? (event.target.dataset.edge === 'start' ? 'end' : 'start') : event.target.dataset.edge;
    applyClipChange((entry) => { entry[edge] += (event.key === 'ArrowLeft' ? -1 : 1) / state.media.fps * (clip.reverse ? -1 : 1); });
    $(`#trim-handle-${event.target.dataset.edge}`)?.focus();
  } else if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectClip(block.dataset.clipId, true); }
});
$('#clip-track').addEventListener('dragstart', (event) => {
  const block = event.target.closest('[data-clip-id]'); if (!block || event.target.closest('.trim-handle')) { event.preventDefault(); return; }
  voiceovers.deselect();
  stopPlayback(); state.selectedId = block.dataset.clipId;
  event.dataTransfer.setData('text/plain', block.dataset.clipId); event.dataTransfer.effectAllowed = 'move';
  block.classList.add('dragging');
});
$('#clip-track').addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
$('#clip-track').addEventListener('drop', (event) => {
  event.preventDefault(); const id = event.dataTransfer.getData('text/plain');
  if (!state.edits.clips.some((clip) => clip.id === id)) return;
  const target = timelinePosition(state.edits.clips, pointerTime(event));
  if (!target) return;
  const from = state.edits.clips.findIndex((clip) => clip.id === id);
  let index = target.index + (target.local > target.duration / 2 ? 1 : 0);
  if (from < index) index -= 1;
  updateEdits((edits) => { edits.clips = moveSequenceClip(edits.clips, id, index); state.selectedId = id; });
});
$('#clip-track').addEventListener('dragend', () => renderTimeline());
$('#marker-track').addEventListener('click', (event) => {
  const id = event.target.closest('[data-marker-id]')?.dataset.markerId;
  const marker = state.edits?.markers.find((entry) => entry.id === id);
  if (marker) { stopPlayback(); seekTimeline(marker.time); }
});
$('#marker-track').addEventListener('dblclick', (event) => {
  const id = event.target.closest('[data-marker-id]')?.dataset.markerId;
  if (id) updateEdits((edits) => { edits.markers = edits.markers.filter((marker) => marker.id !== id); });
});
drag($('#clip-track'), (event) => {
  const edge = event.target.dataset.edge;
  if (!edge) return false;
  stopPlayback(); remember();
  const item = clipLayout(state.edits.clips).find((entry) => entry.clip.id === state.selectedId);
  return { x: event.clientX, edge, original: structuredClone(item.clip), clips: structuredClone(state.edits.clips), index: item.index, start: item.start, total: duration(), width: $('#timeline').getBoundingClientRect().width };
}, (event, context) => {
  const rawDelta = (event.clientX - context.x) / Math.max(1, context.width) * context.total;
  const edgeTime = context.start + (context.edge === 'end' ? clipDuration(context.original) : 0);
  const snapped = snapTimelineTime(edgeTime + rawDelta, context.clips, state.edits.markers, context.total * 8 / Math.max(1, context.width), state.snapping && !event.altKey);
  const delta = snapped - edgeTime;
  const sourceEdge = context.original.reverse ? (context.edge === 'start' ? 'end' : 'start') : context.edge;
  let next = { ...context.original, [sourceEdge]: context.original[sourceEdge] + delta * context.original.speed * (context.original.reverse ? -1 : 1) };
  const frameLength = 1 / (state.media.fps || 30);
  next.start = clamp(next.start, 0, next.end - frameLength);
  next.end = clamp(next.end, next.start + frameLength, state.media.duration);
  updateEdits((edits) => {
    edits.clips = structuredClone(context.clips); edits.clips[context.index] = next;
    const removed = clipDuration(context.original) - clipDuration(next);
    if (!state.ripple && removed > 0.001) edits.clips.splice(context.index + (context.edge === 'start' ? 0 : 1), 0, { id: clipId(), gapDuration: removed });
  }, { history: false });
  seekTimeline(context.start + (context.edge === 'end' ? clipDuration(next) : 0));
});
drag($('#timeline'), (event) => {
  if (event.target.closest('.sequence-clip, .timeline-marker, .voiceover-clip, button, input')) return false;
  stopPlayback(); seekTimeline(pointerTime(event)); return true;
}, (event) => seekTimeline(pointerTime(event)));
document.addEventListener('keydown', (event) => {
  if (!state.media || dialog.open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  const key = event.key.toLowerCase(); const modifier = event.ctrlKey || event.metaKey;
  if (event.code === 'Space' && event.target.tagName !== 'BUTTON') { event.preventDefault(); togglePlayback(); }
  else if (modifier && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if (modifier && key === 'y') { event.preventDefault(); redo(); }
  else if (modifier && key === 'b') { event.preventDefault(); if (!voiceovers.hasSelection()) splitAtCursor(); }
  else if (modifier && key === 'd') { event.preventDefault(); if (!voiceovers.hasSelection()) duplicateSelected(); }
  else if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); voiceovers.hasSelection() ? voiceovers.deleteSelected() : removeSelected(); }
  else if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); if (!voiceovers.hasSelection()) moveSelected(event.key === 'ArrowLeft' ? -1 : 1); }
  else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); stepFrame(event.key === 'ArrowLeft' ? -1 : 1); }
  else if (!modifier && key === 'q' && !voiceovers.hasSelection()) trimAtCursor('left');
  else if (!modifier && key === 'w' && !voiceovers.hasSelection()) trimAtCursor('right');
  else if (!modifier && key === 'm') toggleMarker();
  else if (!modifier && key === 'n') setToggle('snap-toggle', 'snapping');
  else if (!modifier && key === 'b') setTool('blade');
  else if (!modifier && key === 'v') setTool('select');
});
function setExportBusy(busy) {
  state.exporting = busy;
  document.querySelectorAll('.export-settings input, .export-settings select').forEach((input) => { input.disabled = busy; });
  syncImportControls();
  $('#start-export').disabled = busy; $('#start-export').hidden = busy; $('#close-export').disabled = busy;
  setMessage('#export-cancel', busy ? 'editor.cancelOperation' : 'editor.cancel');
}
function captureExportPoster() {
  if (!state.media || video.readyState < 2) return;
  const { crop, text } = state.edits;
  const canvas = document.createElement('canvas');
  Object.assign(canvas, thumbnailSize(state.media.width * crop.width, state.media.height * crop.height, 1280));
  const context = canvas.getContext('2d');
  context.drawImage(video, crop.x * state.media.width, crop.y * state.media.height, crop.width * state.media.width, crop.height * state.media.height, 0, 0, canvas.width, canvas.height);
  const time = state.cursor;
  if (text.enabled && time >= text.start && time <= text.end) {
    const size = canvas.height * text.size / 100; const lines = text.value.split('\n');
    context.font = `${size}px "Noto Sans"`; context.fillStyle = text.color; context.textAlign = 'left'; context.textBaseline = 'middle';
    context.shadowColor = '#000a'; context.shadowOffsetX = 2; context.shadowOffsetY = 2;
    context.strokeStyle = '#000c'; context.lineWidth = Math.max(1, canvas.height * 0.002) * 2;
    const textWidth = Math.max(...lines.map((line) => context.measureText(line).width));
    const textHeight = lines.length * size * 1.2;
    const x = Math.max(0, Math.min(canvas.width - textWidth, text.x * canvas.width - textWidth / 2));
    const y = Math.max(textHeight / 2, Math.min(canvas.height - textHeight / 2, text.y * canvas.height));
    lines.forEach((line, index) => { const lineY = y + (index - (lines.length - 1) / 2) * size * 1.2; context.strokeText(line, x, lineY); context.fillText(line, x, lineY); });
  }
  $('#export-poster').src = canvas.toDataURL('image/jpeg', 0.8); $('#export-poster').hidden = false; $('#export-preview-empty').hidden = true;
}
async function discardPreviousExport() {
  if (state.releaseExportPromise) return state.releaseExportPromise;
  if (!state.exportId) return;
  const id = state.exportId;
  state.releaseExportPromise = (async () => {
    try { await request(`/api/exports/${id}`, { method: 'DELETE' }); }
    catch (error) { if (error.status !== 404) throw error; }
    if (state.exportId === id) state.exportId = null;
  })();
  try { await state.releaseExportPromise; }
  finally { state.releaseExportPromise = null; }
}
$('#open-export').addEventListener('click', async () => {
  if (!state.media || state.importing || state.recordingVoiceover) return;
  stopPlayback(); setExportBusy(false); $('#export-error').hidden = true; $('#export-progress').hidden = true; $('#export-download').hidden = true; $('#start-export').hidden = false;
  $('#export-duration').textContent = formatTime(duration(), true);
  $('#export-poster').hidden = true; $('#export-preview-empty').hidden = false;
  captureExportPoster(); updateExportSummary(); dialog.showModal();
  try { await discardPreviousExport(); }
  catch (error) { setErrorMessage('#export-error', error); $('#export-error').hidden = false; }
});
$('#close-export').addEventListener('click', () => { if (!state.exporting) dialog.close(); });
dialog.addEventListener('cancel', (event) => { if (state.exporting) event.preventDefault(); });
$('#export-cancel').addEventListener('click', async () => {
  if (!state.exporting) { dialog.close(); return; }
  if (!state.exportId) return;
  $('#export-cancel').disabled = true;
  try {
    await request(`/api/exports/${state.exportId}`, { method: 'DELETE' });
    clearTimeout(state.pollTimer); state.exportId = null; setExportBusy(false);
    setMessage('#export-progress-title', 'editor.exportCancelled');
    setMessage('#export-progress-detail', 'editor.exportCancelledDetail');
  } catch (error) { setErrorMessage('#export-error', error); $('#export-error').hidden = false; }
  finally { $('#export-cancel').disabled = false; }
});
function updateExportSummary() {
  if (!state.media) return;
  const dims = outputDimensions(state.media, state.edits.crop, $('#export-resolution').value);
  const format = $('#export-format').value;
  $('#export-extension').textContent = `.${format}`;
  $('#export-summary').textContent = `${dims.width} × ${dims.height} · ${format.toUpperCase()}`;
}
for (const id of ['export-resolution', 'export-format']) $(`#${id}`).addEventListener('change', updateExportSummary);
$('#export-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.exporting || state.importing || state.recordingVoiceover || !state.media || !state.edits.clips.length) return;
  const { trim, crop, text } = state.edits;
  setExportBusy(true); $('#export-error').hidden = true; $('#export-download').hidden = true; $('#export-progress').hidden = false;
  setMessage('#export-progress-title', 'editor.preparingExport'); $('#export-percent').textContent = '0%'; $('#export-progress-bar').value = 0;
  setMessage('#export-progress-detail', 'editor.exportProcessingDetail'); $('#export-cancel').disabled = true;
  try {
    await discardPreviousExport();
    const job = await request('/api/exports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaId: state.media.id, trim: trim.end > trim.start ? trim : { start: 0, end: state.media.duration }, crop,
        clips: state.edits.clips.map((clip) => clip.gapDuration ? { id: clip.id, gapDuration: clip.gapDuration } : { ...clip, volume: clip.volume / 100 }),
        voiceovers: voiceovers.toExport(),
        text: text.enabled && text.value.trim() ? { value: text.value, x: text.x, y: text.y, size: text.size, color: text.color, start: text.start, end: text.end } : null,
        output: { name: $('#export-name').value.trim() || t('editor.defaultFilename'), resolution: $('#export-resolution').value, fps: $('#export-fps').value === 'source' ? 'source' : Number($('#export-fps').value), quality: $('#export-quality').value, format: $('#export-format').value, codec: $('#export-codec').value },
      }),
    });
    state.exportId = job.id; $('#export-cancel').disabled = false; await pollExport(job.id);
  } catch (error) { exportFailed(error); }
});
function exportFailed(error) {
  setExportBusy(false); $('#export-cancel').disabled = false;
  setErrorMessage('#export-error', typeof error === 'string' ? localizedError(error) : error, 'editor.exportFailureFallback'); $('#export-error').hidden = false;
  setMessage('#export-progress-title', 'editor.exportFailed'); setMessage('#export-progress-detail', 'editor.exportFailedDetail');
}
async function pollExport(id) {
  if (state.exportId !== id) return;
  try {
    const job = await request(`/api/exports/${id}`); if (state.exportId !== id) return;
    $('#export-error').hidden = true;
    const progress = clamp(Math.round(Number(job.progress) || 0), 0, 100);
    $('#export-percent').textContent = `${progress}%`; $('#export-progress-bar').value = progress;
    setMessage('#export-progress-title', job.status === 'queued' ? 'editor.queued' : 'editor.exporting');
    if (job.status === 'completed') {
      setExportBusy(false); $('#start-export').hidden = true; setMessage('#export-progress-title', 'editor.exportReady');
      document.querySelectorAll('.export-settings input, .export-settings select').forEach((input) => { input.disabled = true; });
      setMessage('#export-progress-detail', 'editor.exportReadyDetail'); $('#export-percent').textContent = '100%'; $('#export-progress-bar').value = 100;
      $('#export-download').href = job.downloadUrl || `/api/exports/${id}/file`; $('#export-download').download = job.filename || `${$('#export-name').value}.${$('#export-format').value}`;
      $('#export-download').hidden = false; setMessage('#export-cancel', 'editor.close');
    } else if (job.status === 'failed') exportFailed(job.error || 'editor.exportFailureFallback');
    else if (job.status === 'cancelled') { setExportBusy(false); setMessage('#export-progress-title', 'editor.exportCancelled'); setMessage('#export-progress-detail', 'editor.editsPreserved'); }
    else state.pollTimer = setTimeout(() => { void pollExport(id); }, 700);
  } catch (error) {
    if (state.exportId !== id) return;
    if (error.status === 404) { state.exportId = null; exportFailed('editor.exportExpired'); return; }
    setErrorMessage('#export-error', error, 'editor.networkError', true);
    $('#export-error').hidden = false;
    state.pollTimer = setTimeout(() => { void pollExport(id); }, 2000);
  }
}

// Update text in place: changing language must not replace media elements,
// clear editor history, or recreate the active export/import operation.
document.querySelectorAll('[data-language-select]').forEach((select) => {
  select.addEventListener('change', (event) => setLanguage(event.target.value));
});
subscribe(() => {
  syncImportControls();
  syncInputs(); renderPreview(); renderTimeline();
  showPlayState(); syncMuteLabel();
  voiceovers.render();
  for (const render of errorBindings.values()) render();
});
