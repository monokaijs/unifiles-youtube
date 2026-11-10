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
const track = {videoRenderer:{videoId:'jNQXAC9IVRw',title:{simpleText:'Song'},ownerText:{simpleText:'Artist - Topic'},lengthText:{simpleText:'1:02:03'},thumbnail:{thumbnails:[{url:'https://images.example/small'},{url:'https://images.example/large'}]},menu:{videoId:'wrong-video'}}};
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
  test(`${name}: Explore preserves ordered shelves and search stays flat`, () => {
    const shelf = (title, contents) => ({richShelfRenderer:{title:{simpleText:title},contents}});
    const data = { contents: [shelf('Trending', [track, track]), shelf('New music videos', [track])] };
    const page = provider.parsePage({ sourceInstanceId: 'youtube', data, offset: 10 });
    assert.deepEqual(normalize(page.sections), [
      {title:'Trending',itemIds:['jNQXAC9IVRw:10','jNQXAC9IVRw:11']},
      {title:'New music videos',itemIds:['jNQXAC9IVRw:12']},
    ]);
    assert.equal(page.items.length, 3);
    const search = provider.parsePage({ sourceInstanceId: 'youtube', data, query: 'song' });
    assert.equal(search.items.length, 3);
    assert.equal(search.sections.length, 0);
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
      assert.equal(requests[0].url, 'https://www.youtube.com/youtubei/v1/search');
      const body = JSON.parse(requests[0].body);
      assert.equal(body.query, 'Beethoven');
      assert.equal(body.context.client.clientName, 'WEB');
      const cursor = JSON.stringify({ parent: null, query: 'Beethoven', token: 'continuation', offset: 5 });
      const next = await provider.browse({ sourceInstanceId: 'youtube', query: 'Beethoven', cursor });
      assert.equal(next.items[0].id, 'jNQXAC9IVRw:5');
      assert.equal(JSON.parse(requests[1].body).continuation, 'continuation');
      await provider.browse({ sourceInstanceId: 'youtube', parent: 'related:jNQXAC9IVRw' });
      assert.equal(requests[2].url, 'https://www.youtube.com/youtubei/v1/next');
      assert.equal(JSON.parse(requests[2].body).playlistId, 'RDjNQXAC9IVRw');
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
  assert.equal(await readFile(new URL('plugin.json', root), 'utf8'), await readFile(new URL('dist/youtube.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.deepEqual(normalize(manifest.capabilities), ['http']);
  assert.equal(manifest.apiVersion, 3);
  const sums = (await readFile(new URL('dist/SHA256SUMS', root), 'utf8')).trim().split('\n');
  const files = (await readdir(new URL('dist/', root))).filter(file => file !== 'SHA256SUMS').sort();
  assert.deepEqual(sums.map(line => line.split('  ')[1]), files);
  for (const line of sums) {
    const [expected, file] = line.split('  ');
    assert.equal(createHash('sha256').update(await readFile(new URL(`dist/${file}`, root))).digest('hex'), expected);
  }
});

test('installation manifest pins the published module and verifies its bytes', async () => {
  const root = new URL('../', import.meta.url);
  const document = await readFile(new URL('manifest.json', root), 'utf8');
  assert.equal(document, await readFile(new URL('dist/manifest.json', root), 'utf8'));
  const manifest = JSON.parse(document);
  const { entry, sha256, ...runtime } = manifest;
  assert.deepEqual(runtime, JSON.parse(await readFile(new URL('plugin.json', root), 'utf8')));
  assert.equal(entry, `https://github.com/monokaijs/unifiles-youtube/releases/download/v${runtime.version}/youtube.js`);
  assert.equal(sha256, createHash('sha256').update(await readFile(new URL('dist/youtube.js', root))).digest('hex'));
});

test('regular YouTube modern playlist and video lockups retain artwork, credits and duration', async () => {
  const rows = JSON.parse(await readFile(new URL('./fixtures/web-lockups.json', import.meta.url), 'utf8'));
  const page = canonical.parsePage({sourceInstanceId:'youtube',data:rows.map(lockupViewModel=>({lockupViewModel}))});
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].kind, 'collection');
  assert.match(page.items[0].reference.itemId, /^VLRD/);
  assert.equal(page.items[1].kind, 'video');
  assert.ok(page.items[1].subtitle);
  assert.ok(page.items[1].durationMs > 0);
  assert.ok(page.items.every(item=>item.artwork.startsWith('https://')));
});

test('video mode keeps sound, honors quality and never falls back to audio-only', () => {
  const muxed = {itag:18,height:360,qualityLabel:'360p',bitrate:300000,mimeType:'video/mp4; codecs="avc1.42001E, mp4a.40.2"',audioQuality:'AUDIO_QUALITY_LOW',url:'https://r1.googlevideo.com/360'};
  const hd = {...muxed,itag:22,height:720,bitrate:900000,url:'https://r1.googlevideo.com/720'};
  const data = player({adaptiveFormats:[{mimeType:'audio/mp4',url:'https://r1.googlevideo.com/audio',bitrate:128000}],formats:[muxed,hd,{...hd,itag:137,audioQuality:undefined,url:'https://r1.googlevideo.com/silent'}]});
  for (const [,provider] of variants) {
    assert.equal(provider.parsePlayback({data,options:{mode:'audio'}}).url,'https://r1.googlevideo.com/audio');
    assert.equal(provider.parsePlayback({data,options:{mode:'video'}}).url,hd.url);
    assert.equal(provider.parsePlayback({data,options:{mode:'video',mediaIndex:18}}).url,muxed.url);
    assert.equal(provider.parsePlayback({data,options:{mode:'video',maxBitrateKbps:400}}).url,muxed.url);
    assert.equal(provider.parsePlayback({data,options:{mode:'video'}}).canDownload,false);
    assert.throws(()=>provider.parsePlayback({data,options:{mode:'video',mediaIndex:137}}),{code:'unsupported'});
    assert.throws(()=>provider.parsePlayback({data:player({adaptiveFormats:data.streamingData.adaptiveFormats}),options:{mode:'video'}}),{code:'unsupported'});
    assert.throws(()=>provider.parsePlayback({data,options:{mode:'invalid'}}),{code:'invalid_path'});
  }
});

test('catalog rows carry structured metadata and playback states its expiry and captions', () => {
  const row = { videoRenderer: { videoId: 'jNQXAC9IVRw', title: { simpleText: 'Clip' }, ownerText: { simpleText: 'Channel - Topic' }, thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/x/hq720.jpg' }] } } };
  const item = canonical.parsePage({ sourceInstanceId: 'youtube', data: [row] }).items[0];
  assert.equal(item.subtitle, 'Channel');
  assert.equal(item.artist, 'Channel');
  assert.equal(item.artworkAspect, 'wide');
  const format = { itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', audioQuality: 'LOW', url: 'https://r1.googlevideo.com/v?expire=2000000000&x=1', bitrate: 1 };
  const data = { playabilityStatus: { status: 'OK' }, streamingData: { formats: [format] }, videoDetails: { lengthSeconds: '10' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: 'https://www.youtube.com/api/timedtext?v=x', name: { simpleText: 'English' }, languageCode: 'en' },
      { baseUrl: 'https://www.youtube.com/api/timedtext?v=y', name: { simpleText: 'English' }, languageCode: 'en' },
    ] } } };
  const resolved = canonical.parsePlayback({ data, options: { mode: 'video' } });
  assert.equal(resolved.expiresAt, 2000000000000);
  assert.deepEqual(normalize(resolved.subtitles), [{ title: 'English', language: 'en', url: 'https://www.youtube.com/api/timedtext?v=x&fmt=vtt' }]);
});

test('lockups use the media image rather than the channel avatar', () => {
  const lockupViewModel = { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: 'jNQXAC9IVRw',
    metadata: { lockupMetadataViewModel: { title: { content: 'Clip' }, image: { decoratedAvatarViewModel: { avatar: { avatarViewModel: { image: { sources: [{ url: 'https://yt3.ggpht.com/avatar' }] } } } } } } },
    contentImage: { thumbnailViewModel: { image: { sources: [{ url: 'https://i.ytimg.com/vi/x/hq720.jpg' }] } } } };
  assert.equal(canonical.parsePage({ sourceInstanceId: 'youtube', data: { lockupViewModel } }).items[0].artwork, 'https://i.ytimg.com/vi/x/hq720.jpg');
});
