export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function formatTime(value, fraction = false) {
  const seconds = Math.max(0, Number(value) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}${fraction ? `.${Math.floor((seconds % 1) * 10)}` : ''}`;
}
export function cropForRatio(sourceWidth, sourceHeight, ratio) {
  if (!ratio) return { x: 0, y: 0, width: 1, height: 1 };
  const sourceRatio = sourceWidth / sourceHeight;
  const width = Math.min(1, ratio / sourceRatio);
  const height = Math.min(1, sourceRatio / ratio);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}
export function normalizeCrop(crop) {
  const width = clamp(Number(crop.width) || 0.05, 0.05, 1);
  const height = clamp(Number(crop.height) || 0.05, 0.05, 1);
  return { x: clamp(Number(crop.x) || 0, 0, 1 - width), y: clamp(Number(crop.y) || 0, 0, 1 - height), width, height };
}
export function normalizeTrim(trim, duration) {
  const minimum = Math.min(0.1, duration);
  const start = clamp(Number(trim.start) || 0, 0, duration - minimum);
  const end = clamp(finiteOr(trim.end, duration), start + minimum, duration);
  return { start, end };
}
export function normalizeTextTiming(text, duration) {
  const minimum = Math.min(0.1, duration);
  text.start = clamp(Number(text.start) || 0, 0, Math.max(0, duration - minimum));
  text.end = clamp(finiteOr(text.end, duration), text.start + minimum, duration);
  return text;
}
export function outputDimensions(media, crop, resolution) {
  const width = media.width * crop.width;
  const height = media.height * crop.height;
  const even = (value) => Math.max(2, Math.floor(value / 2) * 2);
  if (resolution === 'source') return { width: even(width), height: even(height) };
  const short = Number(resolution);
  const long = Math.round(short * 16 / 9);
  const boxWidth = width > height ? long : short;
  const boxHeight = height > width ? long : short;
  const scale = Math.min(boxWidth / width, boxHeight / height);
  // Preserve the requested crop aspect before the encoder rounds its source
  // rectangle. A 607.5px-wide 9:16 crop must still export at 1080 × 1920.
  const scaledEven = (value) => even(value + Number.EPSILON * Math.max(1, value) * 8);
  return { width: scaledEven(width * scale), height: scaledEven(height * scale) };
}
export function makeEdits(duration) {
  return {
    trim: { start: 0, end: duration },
    crop: { x: 0, y: 0, width: 1, height: 1 },
    text: { enabled: false, value: 'Hikâyeni anlat.', x: 0.5, y: 0.8, size: 5, color: '#ffffff', start: 0, end: duration },
  };
}
