// src/index.js
var fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
var videoId = (id) => {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) fail("invalid_path", "YouTube video ID");
};
function text(value) {
  const result = value?.content ?? value?.simpleText ?? value?.runs?.map((r) => r.text ?? "").join("");
  return result || null;
}
function field(value, key) {
  if (!value || typeof value !== "object") return null;
  if (Object.hasOwn(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = field(child, key);
    if (found != null) return found;
  }
  return null;
}
function thumbnail(value) {
  const url = (field(value, "thumbnails") ?? field(value, "sources"))?.at(-1)?.url;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}
function duration(value) {
  if (typeof value !== "string" || !/^\d+(?::\d+)+$/.test(value)) return null;
  const ms = value.split(":").reduce((total, part) => total * 60 + Number(part), 0) * 1e3;
  return Number.isSafeInteger(ms) ? ms : null;
}
function renderer(value, source, index) {
  const modern = value.contentType?.startsWith("LOCKUP_CONTENT_TYPE_");
  const meta = value.metadata?.lockupMetadataViewModel;
  const title = text(modern ? meta?.title : value.title);
  if (!title) return null;
  const video = modern ? value.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" ? value.contentId : null : value.videoId;
  const playlist = modern ? /_(PLAYLIST|STATION)$/.test(value.contentType) ? value.contentId : null : value.playlistId;
  const id = video ?? (playlist ? `VL${playlist}` : value.channelId);
  if (!id) return null;
  const subtitle = modern ? text(meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text) : text(value.ownerText ?? value.shortBylineText ?? value.longBylineText);
  return {
    id: `${id}:${index}`,
    reference: { sourceInstanceId: source, itemId: id },
    title,
    kind: video ? "video" : playlist ? "collection" : "artist",
    playbackModes: video ? ["video", "audio"] : [],
    subtitle: subtitle?.replace(/ - Topic$/, "") ?? null,
    artwork: thumbnail(value),
    playable: !!video,
    resumePositionMs: 0,
    durationMs: duration(text(value.lengthText)) ?? duration(text(field(value, "thumbnailOverlayTimeStatusRenderer")?.text)) ?? duration(field(value, "thumbnailBadgeViewModel")?.text)
  };
}
var rowKeys = ["videoRenderer", "gridVideoRenderer", "compactVideoRenderer", "playlistVideoRenderer", "playlistPanelVideoRenderer", "playlistRenderer", "gridPlaylistRenderer", "channelRenderer", "gridChannelRenderer", "lockupViewModel"];
function collect(value, source, items) {
  if (!value || typeof value !== "object" || items.length >= 500) return;
  for (const key of rowKeys) {
    if (!value[key]) continue;
    const item = renderer(value[key], source, items.length);
    if (item) items.push(item);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!["menu", "trackingParams", "frameworkUpdates", "header"].includes(key)) collect(child, source, items);
  }
}
function collectShelves(value, source, items, sections, offset) {
  if (!value || typeof value !== "object" || items.length >= 500 || sections.length >= 40) return;
  const shelf = value.richShelfRenderer ?? value.shelfRenderer;
  if (shelf) {
    const start = items.length;
    collect(shelf.contents ?? shelf.content, source, items);
    if (items.length > start) sections.push({ title: text(shelf.title) ?? "Explore", itemIds: items.slice(start).map((item, i) => `${item.reference.itemId}:${offset + start + i}`) });
    return;
  }
  for (const child of Object.values(value)) collectShelves(child, source, items, sections, offset);
}
function parsePage({ data, sourceInstanceId, parent = null, query = null, cursor = null, offset = 0 }) {
  if (data.error) fail("connection_failed", `YouTube catalog error ${data.error.code}`);
  const items = [];
  const sections = [];
  if (parent === null && query === null) collectShelves(data, sourceInstanceId, items, sections, offset);
  if (!sections.length) collect(data, sourceInstanceId, items);
  items.forEach((item, i) => {
    item.id = `${item.reference.itemId}:${offset + i}`;
  });
  const token = field(data, "nextContinuationData")?.continuation ?? field(data, "continuationCommand")?.token;
  return { items, sections, nextCursor: token ? JSON.stringify({ parent, query, token, offset: offset + items.length }) : null };
}
async function browse({ sourceInstanceId, parent = null, query = null, cursor = null }) {
  if (!query?.trim()) query = null;
  const endpoint = query !== null ? "search" : parent?.startsWith("related:") ? "next" : "browse";
  let body, offset = 0;
  if (cursor !== null) {
    if (cursor.length > 32768) fail("invalid_path", "YouTube cursor too large");
    let parsed;
    try {
      parsed = JSON.parse(cursor);
    } catch {
      fail("invalid_path", "Invalid YouTube cursor");
    }
    if (!parsed || parsed.parent !== parent || parsed.query !== query) fail("invalid_path", "YouTube cursor belongs to another query");
    offset = parsed.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1e6 || typeof parsed.token !== "string") fail("invalid_path", "YouTube pagination limit");
    body = { continuation: parsed.token };
  } else if (query !== null) {
    if (query.length > 1e3) fail("invalid_path", "Search query too long");
    body = { query };
  } else if (parent?.startsWith("related:")) {
    const id = parent.slice(8);
    videoId(id);
    body = { videoId: id, playlistId: `RD${id}` };
  } else {
    const id = parent ?? "UC-9-kyTW8ZkZNDHQJ6FgpwQ";
    if (id.length > 512 || !/^[A-Za-z0-9_-]*$/.test(id)) fail("invalid_path", "YouTube collection ID");
    body = { browseId: id };
  }
  body.context = { client: { clientName: "WEB", clientVersion: "2.20261028.01.00", hl: "en", gl: "US" } };
  const data = await host.http.json({
    url: `https://www.youtube.com/youtubei/v1/${endpoint}`,
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "https://www.youtube.com" },
    body: JSON.stringify(body)
  });
  return parsePage({ data, sourceInstanceId, parent, query, cursor, offset });
}
function videoFormats(data, options = {}) {
  if (options.videoCodecs?.length && !options.videoCodecs.includes("h264") || options.audioCodecs?.length && !options.audioCodecs.includes("aac") || options.containers?.length && !options.containers.includes("mp4")) return [];
  return (data.streamingData?.formats ?? []).filter((f) => typeof f.url === "string" && typeof f.audioQuality === "string" && f.mimeType?.startsWith("video/mp4") && f.mimeType.includes("avc1.") && f.mimeType.includes("mp4a.") && (!options.maxBitrateKbps || (f.bitrate ?? 0) <= options.maxBitrateKbps * 1e3)).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
}
function parsePlayback({ data, options = {} }) {
  const status = data.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED") fail("authentication_failed", "YouTube requires sign-in for this item or network");
  if (status !== "OK") fail("unsupported", "This YouTube item is unavailable for playback");
  if (options.mode && !["audio", "video"].includes(options.mode)) fail("invalid_path", "Unknown playback mode");
  if (options.mode === "video") {
    const formats = videoFormats(data, options);
    const format2 = options.mediaIndex ? formats.find((f) => f.itag === options.mediaIndex) : formats[0];
    if (!format2) fail("unsupported", "YouTube did not provide a compatible video stream with audio at this quality");
    const seconds2 = Number(data.videoDetails?.lengthSeconds);
    return { url: format2.url, mimeType: "video/mp4", durationMs: Number.isFinite(seconds2) && seconds2 >= 0 ? seconds2 * 1e3 : null, canDownload: false };
  }
  const audio = (data.streamingData?.adaptiveFormats ?? []).filter((f) => f.mimeType?.startsWith("audio/mp4") && typeof f.url === "string" && f.audioTrack?.audioIsDefault !== false);
  let format = audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  if (!format) format = (data.streamingData?.formats ?? []).filter((f) => typeof f.url === "string" && typeof f.audioQuality === "string" && f.mimeType?.startsWith("video/mp4") && f.mimeType.includes("mp4a.")).sort((a, b) => (a.bitrate ?? Number.MAX_SAFE_INTEGER) - (b.bitrate ?? Number.MAX_SAFE_INTEGER))[0];
  if (!format) fail("unsupported", "YouTube did not provide a supported direct audio stream");
  const seconds = data.videoDetails?.lengthSeconds;
  const ms = typeof seconds === "string" && /^\d+$/.test(seconds) ? Number(seconds) * 1e3 : null;
  return {
    url: format.url,
    mimeType: format.mimeType.split(";")[0],
    durationMs: Number.isSafeInteger(ms) ? ms : null,
    canDownload: true
  };
}
async function playerData(itemId) {
  videoId(itemId);
  const data = await host.http.json({
    url: "https://www.youtube.com/youtubei/v1/player",
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip" },
    body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "21.02.35", androidSdkVersion: 30, osName: "Android", osVersion: "11", hl: "en", gl: "US" } }, videoId: itemId, contentCheckOk: true, racyCheckOk: true })
  });
  return data;
}
async function resolve({ itemId, options = {} }) {
  return parsePlayback({ data: await playerData(itemId), options });
}
async function details({ itemId }) {
  const data = await playerData(itemId);
  const seconds = Number(data.videoDetails?.lengthSeconds);
  return {
    title: data.videoDetails?.title ?? "YouTube video",
    summary: data.videoDetails?.shortDescription ?? null,
    durationMs: Number.isFinite(seconds) && seconds >= 0 ? seconds * 1e3 : null,
    versions: videoFormats(data).map((f) => ({ index: f.itag, title: f.qualityLabel ?? `${f.height ?? ""}p`, streams: [] }))
  };
}
async function related({ sourceInstanceId, itemId, cursor = null }) {
  return browse({ sourceInstanceId, parent: `related:${itemId}`, cursor });
}
export {
  browse,
  details,
  parsePage,
  parsePlayback,
  related,
  resolve
};
