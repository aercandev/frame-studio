import assert from 'node:assert/strict';
import test from 'node:test';
import { identifyPlatform, parsePlatformUrl } from '../src/platform-url.js';

test('YouTube watch, Shorts and short links share one validated video canonical URL', () => {
  const id = 'q_WdpYiXXaQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}&list=tracking&t=20#fragment`,
    `https://youtube.com/watch/?v=${id}`,
    `https://m.youtube.com/shorts/${id}?si=tracking`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=tracking`,
    `https://www.youtu.be/${id}/`,
  ]) {
    assert.deepEqual(parsePlatformUrl(url), {
      platform: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}`,
    }, url);
  }
});

test('X/Twitter post aliases and video suffixes normalize without their tracking data', () => {
  for (const domain of ['x.com', 'www.x.com', 'm.x.com', 'mobile.x.com',
    'twitter.com', 'www.twitter.com', 'm.twitter.com', 'mobile.twitter.com']) {
    assert.deepEqual(parsePlatformUrl(`https://${domain}/RealFedeURU/status/2112511582714347954/video/1?s=20`), {
      platform: 'x', id: '2112511582714347954', url: 'https://x.com/RealFedeURU/status/2112511582714347954',
    });
  }
  assert.equal(parsePlatformUrl('https://x.com/i/web/status/123').url, 'https://x.com/i/status/123');
  assert.equal(parsePlatformUrl('https://twitter.com/i/status/123').url, 'https://x.com/i/status/123');
  assert.deepEqual(parsePlatformUrl('https://m.instagram.com/reel/ABC_123-/?igsh=tracking'), {
    platform: 'instagram', id: 'ABC_123-', shortcode: 'ABC_123-', url: 'https://www.instagram.com/reel/ABC_123-/',
  });
});

test('platform URL validation blocks non-video pages, malformed IDs and unsafe URL forms', () => {
  for (const url of [
    'https://youtube.com/watch?v=short',
    'https://youtube.com/watch?v=0rW7Fbm4S7g&v=q_WdpYiXXaQ',
    'https://youtube.com/playlist?list=PLabc',
    'https://youtube.com/@channel',
    'https://youtube.com/embed/0rW7Fbm4S7g',
    'https://youtube.com/live/0rW7Fbm4S7g',
    'https://youtube.com/shorts/0rW7Fbm4S7g/extra',
    'https://youtu.be/0rW7Fbm4S7g/extra',
    'https://studio.youtube.com/watch?v=0rW7Fbm4S7g',
    'https://youtube.com.evil.test/watch?v=0rW7Fbm4S7g',
    'https://youtube.com@evil.test/watch?v=0rW7Fbm4S7g',
    'https://user:password@youtube.com/watch?v=0rW7Fbm4S7g',
    'https://youtube.com:443/watch?v=0rW7Fbm4S7g',
    'https://youtube.com:8080/watch?v=0rW7Fbm4S7g',
    'http://youtube.com/watch?v=0rW7Fbm4S7g',
    'https:\\\\youtube.com\\shorts\\0rW7Fbm4S7g',
    'https://you\ntube.com/watch?v=0rW7Fbm4S7g',
    'https://x.com/RealFedeURU',
    'https://x.com/RealFedeURU/status/not-a-number',
    'https://x.com/RealFedeURU/status/123/video/0',
    'https://x.com/RealFedeURU/status/123/photo/1',
    'https://x.com/thisusernameistoolong/status/123',
    'https://x.com/person/status/12345678901234567890123456',
    'https://api.twitter.com/person/status/123',
    'https://x.com:443/person/status/123',
    'http://twitter.com/person/status/123',
  ]) assert.throws(() => parsePlatformUrl(url), { code: 'INVALID_URL', status: 400 }, url);
});

test('platform families are recognized even when their host/path is unsupported', () => {
  assert.equal(identifyPlatform('https://studio.youtube.com/settings'), 'youtube');
  assert.equal(identifyPlatform('http://mobile.twitter.com/person'), 'x');
  assert.equal(identifyPlatform('https://help.instagram.com/page'), 'instagram');
  assert.equal(identifyPlatform('https://youtube.com.evil.test/movie.mp4'), null);
  assert.equal(identifyPlatform('https://media.example/movie.mp4?token=1'), null);
  assert.equal(identifyPlatform(null), null);
});
