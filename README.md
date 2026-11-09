# UniFiles YouTube

[![Build and release](https://github.com/monokaijs/unifiles-youtube/actions/workflows/build.yml/badge.svg)](https://github.com/monokaijs/unifiles-youtube/actions/workflows/build.yml)

YouTube Music catalog and audio resolution for **UniFiles plugin API v1**.
The provider runs in the app's QuickJS interpreter and uses native HTTP through
`host.http.json`. It has no JavaScript runtime dependencies.

This repository publishes the YouTube source extracted from UniFiles. It follows
the build layout of [minip-ytb-music-source](https://github.com/monokaijs/minip-ytb-music-source):
ESM, CommonJS, a minified IIFE, and TypeScript declarations under `dist/`. The
exports implement the current UniFiles API; they are not a drop-in MiniP API adapter.

## Download

Use a [tagged release](https://github.com/monokaijs/unifiles-youtube/releases) for a
fixed version, or the committed `dist/` files on `main` for the current build.

| File | Purpose |
| --- | --- |
| [`dist/youtube.js`](dist/youtube.js) | Canonical ES module, identical to `src/index.js`; use with the native host |
| [`dist/youtube.json`](dist/youtube.json) | Strict UniFiles API v1 manifest; identical to `manifest.json` |
| [`dist/index.esm.js`](dist/index.esm.js) | Bundled ESM build |
| [`dist/index.cjs`](dist/index.cjs) | CommonJS build, preserving the original distribution filename |
| [`dist/index.iife.min.js`](dist/index.iife.min.js) | Minified bundle exposing `globalThis.UniFilesYouTube` |
| [`dist/index.d.ts`](dist/index.d.ts) | Provider and host TypeScript interfaces |
| [`dist/SHA256SUMS`](dist/SHA256SUMS) | SHA-256 checksums for all six files above |

Latest release asset URLs:

```text
https://github.com/monokaijs/unifiles-youtube/releases/latest/download/youtube.js
https://github.com/monokaijs/unifiles-youtube/releases/latest/download/youtube.json
https://github.com/monokaijs/unifiles-youtube/releases/latest/download/index.cjs
https://github.com/monokaijs/unifiles-youtube/releases/latest/download/SHA256SUMS
```

For a pinned version, replace `latest/download` with `download/v1.1.0`.
The original-style raw CommonJS URL is:

```text
https://raw.githubusercontent.com/monokaijs/unifiles-youtube/main/dist/index.cjs
```

Checksums verify file integrity; they are not publisher signatures.

UniFiles loads this provider only after explicit installation. In the app, open
**Media → Media sources → + → Install plugin** and enter
`monokaijs/unifiles-youtube`. Installation uses the latest published release,
verifies its checksums and saves the package locally. Use **Update plugin** in
media sources to install a newer release; **Remove** unregisters it. A fresh app
has no YouTube source. Updates are explicit rather than automatic.

## API

```js
const page = await browse({
  sourceInstanceId: 'youtube',
  query: 'Beethoven',
  parent: null,
  cursor: null
});

const playback = await resolve({
  sourceInstanceId: 'youtube',
  itemId: page.items.find(item => item.playable).reference.itemId
});
```

- `browse` returns `{items, nextCursor, sections}` for search, home shelves, collections,
  related songs, and continuation pages. Explore sections preserve YouTube’s shelf
  titles and ordered `itemIds` referencing the same page’s items; search stays flat.
- `resolve` returns `{url, mimeType, durationMs, canDownload}`. The native host
  validates the URL and creates the playback session. Resolve fresh URLs for each
  playback; signed media URLs should not be persisted.
- `parsePage` and `parsePlayback` are also exported for fixture-based tests.

The host must provide `globalThis.host.http.json({url, method, headers, body})`,
returning a promise for parsed JSON. The native host enforces HTTPS, domain grants,
response size limits, cancellation, and interpreter resource limits. Media bytes,
downloads and playback remain native. This plugin needs only the `http` capability;
it does not require access to files, credentials, cookies, or native crypto.

The manifest allows requests to `music.youtube.com` and `www.youtube.com`, and
playback on `*.googlevideo.com`. InnerTube is an unofficial API; availability can
change. Sign-in requirements and unsupported/cipher-only streams are returned as
errors. The source does not bypass content or network restrictions.

## Development

Use Node.js 24 or newer and Rust 1.88 or newer for the compatibility test.

```sh
npm ci
npm run check
```

`npm run build` produces deterministic bundles and checksums. `npm test` tests all
four JavaScript formats against catalog/player fixtures. `npm run test:types`
checks the published declarations. `npm run test:quickjs` executes both ES module
artifacts using `rquickjs 0.14.0`, matching the UniFiles host's interpreter binding.
These are deterministic offline tests; they do not claim to test YouTube's current
network behavior or duplicate the app's native HTTP implementation.

Edit `src/index.js`, `src/index.d.ts`, or `manifest.json`, run the checks, and commit
the regenerated `dist/` files. The canonical module remains directly usable by the
app without a Node.js bundler at app build time.

## CI and releases

Pushes to `main`, pull requests, and manual runs build and test the source, check
that committed `dist/` matches a fresh build, and upload a downloadable Actions
artifact. CI uses Node.js 24 and Rust 1.88.0 with locked dependencies.

To release, update the version in both `package.json` and `manifest.json`, refresh
the npm lockfile, rebuild and commit, then push a matching `vX.Y.Z` tag. The release
job runs only after the checks pass and uploads every `dist/` file to GitHub Releases.
The build rejects tags that do not match the package/manifest version. Release tags
should be immutable; use a new version for corrections.

```sh
npm version 1.0.1 --no-git-tag-version
# Update manifest.json to the same version.
npm run check
git add package.json package-lock.json manifest.json dist
git commit -m "chore(release): prepare v1.0.1"
git tag -a v1.0.1 -m "YouTube source v1.0.1"
git push origin main v1.0.1
```

This repository publishes GitHub source and release assets, not an npm package.

## License

MIT. See [LICENSE](LICENSE).
