/** UniFiles media plugin API v2. The application supplies globalThis.host. */
export interface MediaRef { sourceInstanceId: string; itemId: string; }
export interface MediaItem {
  id: string;
  reference: MediaRef;
  title: string;
  kind: string;
  playbackModes?: ("audio" | "video")[];
  subtitle: string | null;
  artwork: string | null;
  durationMs: number | null;
  playable: boolean;
  resumePositionMs: number;
  artist?: string | null;
  album?: string | null;
  artworkAspect?: "square" | "wide" | "poster" | null;
}
export interface MediaSection { title: string; itemIds: string[]; }
export interface MediaPage { items: MediaItem[]; nextCursor: string | null; sections?: MediaSection[]; }
export interface BrowseRequest {
  sourceInstanceId: string;
  parent?: string | null;
  query?: string | null;
  cursor?: string | null;
}
export interface ResolvedMedia {
  url: string;
  mimeType: string;
  durationMs: number | null;
  canDownload: boolean;
  expiresAt: number | null;
  subtitles?: { title: string; language: string | null; url: string }[];
}
export interface HttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}
export interface Host {
  apiVersion: 2;
  http: { json(request: HttpRequest): Promise<unknown> };
}
export function browse(request: BrowseRequest): Promise<MediaPage>;
export interface PlaybackOptions { mode?: "audio" | "video"; mediaIndex?: number; maxBitrateKbps?: number; videoCodecs?: string[]; audioCodecs?: string[]; containers?: string[]; }
export function related(request: { sourceInstanceId: string; itemId: string; cursor?: string | null }): Promise<MediaPage>;
export function resolve(request: { sourceInstanceId: string; itemId: string; options?: PlaybackOptions }): Promise<ResolvedMedia>;
export function parsePage(request: BrowseRequest & { data: unknown; offset?: number }): MediaPage;
export function parsePlayback(request: { data: unknown; options?: PlaybackOptions }): ResolvedMedia;

export function details(request: {sourceInstanceId: string; itemId: string}): Promise<{title: string; summary: string | null; durationMs: number | null; versions: {index: number; title: string; streams: unknown[]}[]}>;
