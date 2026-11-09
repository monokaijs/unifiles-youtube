import { browse, resolve, parsePage, parsePlayback, type Host, type MediaPage, type ResolvedMedia } from 'unifiles-youtube';
const host: Host = { apiVersion: 1, http: { async json(request) { return JSON.parse(request.body ?? '{}'); } } };
const page: Promise<MediaPage> = browse({ sourceInstanceId: 'youtube', query: 'Beethoven' });
const session: Promise<ResolvedMedia> = resolve({ sourceInstanceId: 'youtube', itemId: 'jNQXAC9IVRw' });
const parsed: MediaPage = parsePage({ sourceInstanceId: 'youtube', data: {} });
const playback: ResolvedMedia = parsePlayback({ data: {} });
void [host, page, session, parsed, playback];
