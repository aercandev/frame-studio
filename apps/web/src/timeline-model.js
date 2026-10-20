import { clamp } from './edit-model.js';

let nextClipId = 0;
export const clipId = () => `clip-${Date.now().toString(36)}-${++nextClipId}`;
export const createClip = (duration) => ({ id: clipId(), start: 0, end: duration, speed: 1, reverse: false, volume: 100, muted: false });
export const clipDuration = (clip) => clip.gapDuration || clip.freezeDuration || (clip.end - clip.start) / clip.speed;
export const timelineDuration = (clips) => clips.reduce((total, clip) => total + clipDuration(clip), 0);
export function clipLayout(clips) {
  let time = 0;
  return clips.map((clip, index) => {
    const start = time;
    time += clipDuration(clip);
    return { clip, index, start, end: time, duration: time - start };
  });
}
export function timelinePosition(clips, time) {
  const layout = clipLayout(clips);
  const item = layout.find((entry) => time < entry.end - 0.000001) || layout.at(-1);
  if (!item) return null;
  const local = clamp(time - item.start, 0, item.duration);
  const sourceTime = item.clip.gapDuration ? 0 : item.clip.freezeDuration ? item.clip.start
    : item.clip.reverse ? item.clip.end - local * item.clip.speed : item.clip.start + local * item.clip.speed;
  return { ...item, local, sourceTime };
}
export function splitSequence(clips, time, minimum = 0.001) {
  const item = timelinePosition(clips, time);
  if (!item || item.local < minimum - 0.000001 || item.duration - item.local < minimum - 0.000001) return null;
  const left = { ...item.clip }, right = { ...item.clip, id: clipId() };
  if (left.gapDuration) { left.gapDuration = item.local; right.gapDuration = item.duration - item.local; }
  else if (left.freezeDuration) { left.freezeDuration = item.local; right.freezeDuration = item.duration - item.local; }
  else if (left.reverse) { left.start = item.sourceTime; right.end = item.sourceTime; }
  else { left.end = item.sourceTime; right.start = item.sourceTime; }
  const result = clips.slice();
  result.splice(item.index, 1, left, right);
  return { clips: result, selectedId: right.id };
}
export function moveSequenceClip(clips, id, targetIndex) {
  const result = clips.slice();
  const from = result.findIndex((clip) => clip.id === id);
  if (from < 0) return result;
  const [clip] = result.splice(from, 1);
  result.splice(clamp(targetIndex, 0, result.length), 0, clip);
  return result;
}
export function snapTimelineTime(time, clips, markers, threshold, enabled = true) {
  if (!enabled) return time;
  const candidates = [0, ...clipLayout(clips).map((item) => item.end), ...markers.map((marker) => marker.time)];
  let nearest = time, distance = threshold;
  for (const candidate of candidates) {
    if (Math.abs(candidate - time) <= distance) { nearest = candidate; distance = Math.abs(candidate - time); }
  }
  return nearest;
}
export function thumbnailSize(width, height, maximum = 192) {
  const scale = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
