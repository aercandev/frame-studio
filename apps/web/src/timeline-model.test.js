import assert from 'node:assert/strict';
import test from 'node:test';
import { createClip, clipDuration, timelineDuration, clipLayout, timelinePosition, splitSequence, moveSequenceClip, snapTimelineTime, thumbnailSize } from './timeline-model.js';

test('output positions map through speed, reverse, freezes and silent gaps', () => {
  const clips = [
    { ...createClip(10), start: 2, end: 6, speed: 2 },
    { ...createClip(10), start: 6, end: 10, reverse: true },
    { ...createClip(10), start: 5, end: 5, freezeDuration: 3 },
    { id: 'gap', gapDuration: 2 },
  ];
  assert.equal(timelineDuration(clips), 11);
  assert.deepEqual(clipLayout(clips).map(({ start, end }) => [start, end]), [[0, 2], [2, 6], [6, 9], [9, 11]]);
  assert.equal(timelinePosition(clips, 1).sourceTime, 4);
  assert.equal(timelinePosition(clips, 2).sourceTime, 10);
  assert.equal(timelinePosition(clips, 4).sourceTime, 8);
  assert.equal(timelinePosition(clips, 8).sourceTime, 5);
  assert.equal(timelinePosition(clips, 10).clip.gapDuration, 2);
});

test('split preserves output duration and reversed playback order', () => {
  const clip = { ...createClip(10), start: 2, end: 10, speed: 2, reverse: true };
  const split = splitSequence([clip], 1);
  assert.deepEqual(split.clips.map(({ start, end }) => [start, end]), [[8, 10], [2, 8]]);
  assert.equal(timelineDuration(split.clips), clipDuration(clip));
  assert.equal(split.clips[0].id, clip.id);
  assert.notEqual(split.clips[1].id, clip.id);
  assert.equal(timelinePosition(split.clips, 1.5).sourceTime, 7);
  assert.equal(splitSequence([clip], 0), null);
  assert.equal(splitSequence([clip], 0.01, 1 / 30), null);
});

test('freeze and gap splits preserve their own durations', () => {
  const freeze = { ...createClip(20), start: 7, end: 7, freezeDuration: 3 };
  const frozen = splitSequence([freeze], 1);
  assert.deepEqual(frozen.clips.map((clip) => clip.freezeDuration), [1, 2]);
  assert.ok(frozen.clips.every((clip) => clip.start === 7 && clip.end === 7));
  const gap = splitSequence([{ id: 'gap', gapDuration: 5 }], 3);
  assert.deepEqual(gap.clips.map((clip) => clip.gapDuration), [3, 2]);
});

test('reordering changes sequence without mutating the original clips', () => {
  const clips = [createClip(3), createClip(4), createClip(5)];
  const reordered = moveSequenceClip(clips, clips[0].id, 2);
  assert.deepEqual(reordered.map((clip) => clip.id), [clips[1].id, clips[2].id, clips[0].id]);
  assert.equal(clips[0].end, 3);
  assert.equal(timelineDuration(reordered), 12);
});

test('snapping targets clip boundaries and markers only inside the pixel-equivalent threshold', () => {
  const clips = [createClip(3), createClip(4)];
  assert.equal(snapTimelineTime(3.04, clips, [], 0.1), 3);
  assert.equal(snapTimelineTime(5.97, clips, [{ time: 6 }], 0.1), 6);
  assert.equal(snapTimelineTime(3.2, clips, [], 0.1), 3.2);
  assert.equal(snapTimelineTime(3.04, clips, [], 0.1, false), 3.04);
});

test('thumbnail dimensions retain the entire portrait frame and bound both canvas sides', () => {
  assert.deepEqual(thumbnailSize(1080, 1920), { width: 108, height: 192 });
  assert.deepEqual(thumbnailSize(3840, 2160), { width: 192, height: 108 });
  assert.deepEqual(thumbnailSize(1, 100000), { width: 1, height: 192 });
});
