var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  browse: () => browse,
  parsePage: () => parsePage,
  parsePlayback: () => parsePlayback,
  resolve: () => resolve
});
module.exports = __toCommonJS(index_exports);
var fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
var videoId = (id) => {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) fail("invalid_path", "YouTube video ID");
};
function text(value) {
  const result = value?.simpleText ?? value?.runs?.map((r) => r.text ?? "").join("");
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
  const url = field(value, "thumbnails")?.at(-1)?.url;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}
function duration(value) {
  if (typeof value !== "string" || !/^\d+(?::\d+)+$/.test(value)) return null;
  const ms = value.split(":").reduce((total, part) => total * 60 + Number(part), 0) * 1e3;
  return Number.isSafeInteger(ms) ? ms : null;
}
function renderer(value, source, index) {
  const first = value.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
  const title = text(first) ?? text(value.title);
  if (!title) return null;
  const subtitle = text(value.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text) ?? text(value.subtitle);
  const endpoint = first?.runs?.[0]?.navigationEndpoint ?? value.navigationEndpoint;
  const video = value.playlistItemData?.videoId ?? endpoint?.watchEndpoint?.videoId;
  const browse2 = endpoint?.browseEndpoint?.browseId;
  const id = video ?? browse2;
  if (!id) return null;
  const kind = video ? "track" : id.startsWith("UC") ? "artist" : id.startsWith("MPRE") ? "album" : "collection";
  return {
    id: `${id}:${index}`,
    reference: { sourceInstanceId: source, itemId: id },
    title,
    kind,
    subtitle,
    artwork: thumbnail(value),
    playable: !!video,
    resumePositionMs: 0,
    durationMs: duration(subtitle?.split("•").at(-1)?.trim()) ?? duration(text(value.lengthText)) ?? duration(text(field(value.fixedColumns, "text")))
  };
}
var rowKeys = ["musicResponsiveListItemRenderer", "musicTwoRowItemRenderer", "playlistPanelVideoRenderer"];
function collect(value, source, items, credits = false) {
  if (!value || typeof value !== "object" || items.length >= 500) return;
  for (const key of credits ? rowKeys.slice(0, 2) : rowKeys) {
    const row = value[key];
    if (!row) continue;
    if (!credits) {
      const item = renderer(row, source, items.length);
      if (item) items.push(item);
    } else {
      const byline = row.subtitle ?? row.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text;
      for (const run of byline?.runs ?? []) {
        if (items.length >= 500) break;
        const id = run.navigationEndpoint?.browseEndpoint?.browseId;
        const kind = id?.startsWith("UC") ? "artist" : id?.startsWith("MPRE") ? "album" : null;
        if (!kind || !run.text?.trim() || items.some((i) => i.reference.itemId === id)) continue;
        items.push({
          id,
          reference: { sourceInstanceId: source, itemId: id },
          title: run.text,
          kind,
          subtitle: null,
          artwork: kind === "album" ? thumbnail(row) : null,
          durationMs: null,
          playable: false,
          resumePositionMs: 0
        });
      }
    }
    return;
  }
  for (const child of Object.values(value)) collect(child, source, items, credits);
}
function parsePage({ data, sourceInstanceId, parent = null, query = null, cursor = null, offset = 0 }) {
  if (data.error) fail("connection_failed", `YouTube catalog error ${data.error.code}`);
  const items = [];
  collect(data, sourceInstanceId, items);
  if (parent === null && query === null && cursor === null) collect(data, sourceInstanceId, items, true);
  items.forEach((item, i) => {
    item.id = `${item.reference.itemId}:${offset + i}`;
  });
  const token = field(data, "nextContinuationData")?.continuation ?? field(data, "continuationCommand")?.token;
  return { items, nextCursor: token ? JSON.stringify({ parent, query, token, offset: offset + items.length }) : null };
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
    body = { videoId: id, playlistId: `RDAMVM${id}` };
  } else {
    const id = parent ?? "FEmusic_explore";
    if (id.length > 512 || !/^[A-Za-z0-9_-]*$/.test(id)) fail("invalid_path", "YouTube collection ID");
    body = { browseId: id };
  }
  body.context = { client: { clientName: "WEB_REMIX", clientVersion: "1.20261028.01.00", hl: "en", gl: "US" } };
  const data = await host.http.json({
    url: `https://music.youtube.com/youtubei/v1/${endpoint}`,
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "https://music.youtube.com" },
    body: JSON.stringify(body)
  });
  return parsePage({ data, sourceInstanceId, parent, query, cursor, offset });
}
function parsePlayback({ data }) {
  const status = data.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED") fail("authentication_failed", "YouTube requires sign-in for this item or network");
  if (status !== "OK") fail("unsupported", "This YouTube item is unavailable for playback");
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
async function resolve({ itemId }) {
  videoId(itemId);
  const data = await host.http.json({
    url: "https://www.youtube.com/youtubei/v1/player",
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip" },
    body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "21.02.35", androidSdkVersion: 30, osName: "Android", osVersion: "11", hl: "en", gl: "US" } }, videoId: itemId, contentCheckOk: true, racyCheckOk: true })
  });
  return parsePlayback({ data });
}
