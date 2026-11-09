import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as esm from '../dist/index.esm.js';
import * as canonical from '../dist/youtube.js';

const require = createRequire(import.meta.url);
const context = vm.createContext({});
vm.runInContext(await readFile(new URL('../dist/index.iife.min.js', import.meta.url), 'utf8'), context);
const variants = [
  ['canonical', canonical, globalThis], ['ESM', esm, globalThis],
  ['CommonJS', require('../dist/index.cjs'), globalThis], ['IIFE', context.UniFilesYouTube, context],
];
const normalize = value => JSON.parse(JSON.stringify(value));
const track = {
  musicResponsiveListItemRenderer: {
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song', navigationEndpoint: { watchEndpoint: { videoId: 'jNQXAC9IVRw' } } }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artist • 1:02:03' }] } } },
    ],
    thumbnail: { thumbnails: [{ url: 'https://images.example/small' }, { url: 'https://images.example/large' }] },
    menu: { watchEndpoint: { videoId: 'wrong-video' } },
  },
};
const player = formats => ({ playabilityStatus: { status: 'OK' }, streamingData: formats, videoDetails: { lengthSeconds: '120' } });

for (const [name, provider, globals] of variants) {
  test(`${name}: rows, pagination, duration and artwork preserve the catalog contract`, () => {
    const result = provider.parsePage({ sourceInstanceId: 'youtube', query: 'song', offset: 12,
      data: { rows: [track, track], nextContinuationData: { continuation: 'opaque' } } });
    assert.equal(result.items[0].id, 'jNQXAC9IVRw:12');
    assert.equal(result.items[1].id, 'jNQXAC9IVRw:13');
    assert.equal(result.items[0].durationMs, 3723000);
    assert.equal(result.items[0].artwork, 'https://images.example/large');
    assert.deepEqual(JSON.parse(result.nextCursor), { parent: null, query: 'song', token: 'opaque', offset: 14 });
    assert.equal(provider.parsePage({ sourceInstanceId: 'youtube', data: Array(510).fill(track) }).items.length, 500);
  });
  test(`${name}: home credits are deduplicated and unrelated menus are ignored`, () => {
    const row = { musicTwoRowItemRenderer: {
      subtitle: { runs: [{ text: 'Artist', navigationEndpoint: { browseEndpoint: { browseId: 'UCartist' } } }] },
      menu: { navigationEndpoint: { browseEndpoint: { browseId: 'UCunrelated' } } },
    } };
    const page = provider.parsePage({ sourceInstanceId: 'youtube', data: [row, row] });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].reference.itemId, 'UCartist');
    assert.equal(page.items[0].playable, false);
  });
  test(`${name}: default adaptive audio wins and progressive fallback includes audio`, () => {
    const low = { mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: 'https://r1.googlevideo.com/low', bitrate: 64000 };
    const high = { ...low, url: 'https://r1.googlevideo.com/high', bitrate: 128000 };
    const alternate = { ...low, bitrate: 256000, audioTrack: { audioIsDefault: false } };
    const resolved = provider.parsePlayback({ data: player({ adaptiveFormats: [low, high, alternate] }) });
    assert.equal(resolved.url, high.url);
    assert.equal(resolved.mimeType, 'audio/mp4');
    assert.equal(resolved.durationMs, 120000);
    assert.equal(resolved.canDownload, true);
    const video = { mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_LOW', url: 'https://r1.googlevideo.com/video', bitrate: 200000 };
    assert.equal(provider.parsePlayback({ data: player({ adaptiveFormats: [{ mimeType: 'audio/mp4' }], formats: [video, { ...video, bitrate: 300000, url: 'https://r1.googlevideo.com/large' }] }) }).url, video.url);
    assert.throws(() => provider.parsePlayback({ data: player({ formats: [{ ...video, audioQuality: undefined }] }) }), { code: 'unsupported' });
  });
  test(`${name}: restricted, unavailable and cipher-only streams stay errors`, () => {
    assert.throws(() => provider.parsePlayback({ data: { playabilityStatus: { status: 'LOGIN_REQUIRED' } } }), { code: 'authentication_failed' });
    assert.throws(() => provider.parsePlayback({ data: { playabilityStatus: { status: 'ERROR' } } }), { code: 'unsupported' });
    assert.throws(() => provider.parsePlayback({ data: player({ adaptiveFormats: [{ mimeType: 'audio/mp4', signatureCipher: 'secret' }] }) }), { code: 'unsupported' });
  });
  test(`${name}: browse and resolve use the native HTTP contract`, async () => {
    const requests = [];
    globals.host = { apiVersion: 1, http: { async json(request) {
      requests.push(request);
      return request.url.endsWith('/player') ? player({ adaptiveFormats: [{ mimeType: 'audio/mp4', url: 'https://r1.googlevideo.com/audio' }] }) : { rows: [track] };
    } } };
    try {
      const page = await provider.browse({ sourceInstanceId: 'youtube', query: 'Beethoven' });
      assert.equal(page.items[0].reference.sourceInstanceId, 'youtube');
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].url, 'https://music.youtube.com/youtubei/v1/search');
      const body = JSON.parse(requests[0].body);
      assert.equal(body.query, 'Beethoven');
      assert.equal(body.context.client.clientName, 'WEB_REMIX');
      const cursor = JSON.stringify({ parent: null, query: 'Beethoven', token: 'continuation', offset: 5 });
      const next = await provider.browse({ sourceInstanceId: 'youtube', query: 'Beethoven', cursor });
      assert.equal(next.items[0].id, 'jNQXAC9IVRw:5');
      assert.equal(JSON.parse(requests[1].body).continuation, 'continuation');
      await provider.browse({ sourceInstanceId: 'youtube', parent: 'related:jNQXAC9IVRw' });
      assert.equal(requests[2].url, 'https://music.youtube.com/youtubei/v1/next');
      assert.equal(JSON.parse(requests[2].body).playlistId, 'RDAMVMjNQXAC9IVRw');
      const result = await provider.resolve({ sourceInstanceId: 'youtube', itemId: 'jNQXAC9IVRw' });
      assert.equal(result.mimeType, 'audio/mp4');
      assert.equal(requests[3].url, 'https://www.youtube.com/youtubei/v1/player');
      assert.equal(JSON.parse(requests[3].body).videoId, 'jNQXAC9IVRw');
    } finally { delete globals.host; }
  });
  test(`${name}: invalid inputs are rejected before native HTTP is called`, async () => {
    let calls = 0;
    globals.host = { http: { async json() { calls++; throw new Error('Unexpected HTTP'); } } };
    try {
      for (const cursor of [JSON.stringify({ parent: null, query: 'old', token: 'x' }), 'invalid', 'x'.repeat(32769), JSON.stringify({ parent: null, query: 'new', token: 'x', offset: -1 })]) {
        await assert.rejects(provider.browse({ sourceInstanceId: 'youtube', query: 'new', cursor }), { code: 'invalid_path' });
      }
      await assert.rejects(provider.browse({ sourceInstanceId: 'youtube', query: 'x'.repeat(1001) }), { code: 'invalid_path' });
      await assert.rejects(provider.resolve({ itemId: '../../invalid' }), { code: 'invalid_path' });
      assert.equal(calls, 0);
    } finally { delete globals.host; }
  });
}

test('native plugin files and checksums match their source', async () => {
  const root = new URL('../', import.meta.url);
  assert.equal(await readFile(new URL('src/index.js', root), 'utf8'), await readFile(new URL('dist/youtube.js', root), 'utf8'));
  assert.equal(await readFile(new URL('manifest.json', root), 'utf8'), await readFile(new URL('dist/youtube.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.deepEqual(normalize(manifest.capabilities), ['http']);
  assert.equal(manifest.apiVersion, 1);
  const sums = (await readFile(new URL('dist/SHA256SUMS', root), 'utf8')).trim().split('\n');
  const files = (await readdir(new URL('dist/', root))).filter(file => file !== 'SHA256SUMS').sort();
  assert.deepEqual(sums.map(line => line.split('  ')[1]), files);
  for (const line of sums) {
    const [expected, file] = line.split('  ');
    assert.equal(createHash('sha256').update(await readFile(new URL(`dist/${file}`, root))).digest('hex'), expected);
  }
});
