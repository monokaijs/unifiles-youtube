import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
if (pkg.version !== manifest.version || manifest.apiVersion !== 2 || manifest.id !== 'youtube') {
  throw new Error('Package version and UniFiles API v2 manifest must agree');
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${pkg.version}`) {
  throw new Error('Release tag must match the package and manifest versions');
}
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const [format, file, minify] of [
  ['esm', 'index.esm.js', false],
  ['cjs', 'index.cjs', false],
  ['iife', 'index.iife.min.js', true],
]) {
  const result = await build({
    absWorkingDir: root, entryPoints: ['src/index.js'], bundle: true,
    platform: 'neutral', target: 'es2022', format, minify,
    ...(format === 'iife' ? { globalName: 'UniFilesYouTube' } : {}),
    outfile: path.join(dist, file), sourcemap: false, metafile: true,
    legalComments: 'none', charset: 'utf8', logLevel: 'warning',
  });
  if (Object.values(result.metafile.outputs).some(output => output.imports.length)) {
    throw new Error('Provider bundles must not require external modules');
  }
}
// Preserve the provider source and strict runtime manifest as the canonical pair.
await copyFile(path.join(root, 'src/index.js'), path.join(dist, 'youtube.js'));
await copyFile(path.join(root, 'plugin.json'), path.join(dist, 'youtube.json'));
await copyFile(path.join(root, 'src/index.d.ts'), path.join(dist, 'index.d.ts'));
const installation = {
  ...manifest,
  entry: `https://github.com/monokaijs/unifiles-youtube/releases/download/v${pkg.version}/youtube.js`,
  sha256: createHash('sha256').update(await readFile(path.join(dist, 'youtube.js'))).digest('hex'),
};
const installationJson = `${JSON.stringify(installation, null, 2)}\n`;
await writeFile(path.join(dist, 'manifest.json'), installationJson);
await writeFile(path.join(root, 'manifest.json'), installationJson);
const lines = [];
for (const file of (await readdir(dist)).sort()) {
  const bytes = await readFile(path.join(dist, file));
  if (file.endsWith('.js') && bytes.length > 256 * 1024) throw new Error(`${file} exceeds the host source limit`);
  lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`);
  console.log(`${file}: ${bytes.length} bytes`);
}
await writeFile(path.join(dist, 'SHA256SUMS'), `${lines.join('\n')}\n`);
