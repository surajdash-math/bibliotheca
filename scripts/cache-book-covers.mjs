import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = process.cwd();
const manifestPath = path.join(root, 'src/data/bibliotheca-cover-assets.json');
const catalogue = JSON.parse(await fs.readFile(path.join(root, 'src/data/bibliotheca.json'), 'utf8'));
let assets;
try { assets = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; assets = {}; }
const urls = [...new Set(catalogue.entries.flatMap(book => book.cover ? [book.cover.src] : []))];
await fs.mkdir(path.join(root, 'public/book-covers'), { recursive: true });
const digest = value => createHash('sha256').update(value).digest('hex');
const archiveUrl = source => {
  const url = new URL(source);
  if (url.hostname !== 'covers.openlibrary.org') return source;
  const match = url.pathname.match(/^\/b\/id\/(\d+)-M\.jpg$/);
  if (!match) throw new Error('Unsupported cover identifier: ' + source);
  const id = match[1].padStart(10, '0');
  const item = 'm_covers_' + id.slice(0, 4);
  const extension = Number(match[1]) < 8_000_000 ? 'tar' : 'zip';
  return `https://archive.org/download/${item}/${item}_${id.slice(4, 6)}.${extension}/${id}-M.jpg`;
};
let writeQueue = Promise.resolve();
const save = () => {
  const json = JSON.stringify(Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n';
  writeQueue = writeQueue.then(() => fs.writeFile(manifestPath + '.tmp', json)).then(() => fs.rename(manifestPath + '.tmp', manifestPath));
  return writeQueue;
};
let completed = 0;
const failures = [];
async function cache(source) {
  const existing = assets[source];
  if (existing) {
    try {
      const bytes = await fs.readFile(path.join(root, 'public', existing.file));
      if (digest(bytes) === existing.sha256) { completed++; return; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const archive = archiveUrl(source);
  const downloads = [...new Set([archive, source])];
  let lastError;
  for (const download of downloads) {
   for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(download, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'BibliothecaCatalogue/1.0 (static cover assets)' } });
      if (!response.ok) {
        lastError = new Error('HTTP ' + response.status);
        if (response.status === 404) break;
        throw lastError;
      }
      if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Response is not an image');
      const original = Buffer.from(await response.arrayBuffer());
      if (original.length > 8_000_000) throw new Error('Cover exceeds size limit');
      const { data, info } = await sharp(original).rotate().resize({ width: 280, height: 420, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
      const file = 'book-covers/' + digest(source).slice(0, 20) + '.webp';
      await fs.writeFile(path.join(root, 'public', file), data);
      assets[source] = { file, width: info.width, height: info.height, sha256: digest(data), sourceUrl: download };
      await save();
      completed++;
      if (completed % 20 === 0 || completed === urls.length) console.log(JSON.stringify({ cached: completed, total: urls.length }));
      return;
    } catch (error) { lastError = error; }
   }
  }
  failures.push({ source, error: lastError?.message || 'No cover image available' });
  console.error(JSON.stringify(failures.at(-1)));
}
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < urls.length) await cache(urls[next++]);
}));
await writeQueue;
console.log(JSON.stringify({ cached: completed, total: urls.length, failures }));
if (failures.length) process.exitCode = 1;
