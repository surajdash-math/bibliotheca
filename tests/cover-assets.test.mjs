import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const readJson = async path => JSON.parse(await fs.readFile(new URL(path, import.meta.url), 'utf8'));

test('every current verified cover has a bundled asset without changing its source URL', async () => {
  const catalogue = await readJson('../src/data/bibliotheca.json');
  const assets = await readJson('../src/data/bibliotheca-cover-assets.json');
  const covers = catalogue.entries.filter(book => book.cover);
  assert.ok(covers.length > 0, 'The saved catalogue must contain verified covers');

  for (const book of covers) {
    const original = new URL(book.cover.src);
    const asset = assets[book.cover.src];
    assert.ok(asset, `${book.title}: cover has not been bundled`);
    assert.match(asset.file, /^book-covers\/[a-f0-9]{12,64}\.webp$/, `${book.title}: unsafe asset path`);
    const download = new URL(asset.sourceUrl);
    assert.equal(download.protocol, 'https:');

    if (original.hostname === 'covers.openlibrary.org' && download.href !== original.href) {
      assert.ok(download.hostname === 'archive.org' || download.hostname.endsWith('.archive.org'),
        `${book.title}: Open Library image must come from its archive download`);
      const match = original.pathname.match(/^\/b\/id\/(\d+)-M\.jpg$/);
      assert.ok(match, `${book.title}: unexpected original CoverID URL`);
      const filename = `${match[1].padStart(10, '0')}-M.jpg`;
      assert.ok(decodeURIComponent(download.pathname).endsWith('/' + filename) ||
        download.searchParams.get('file') === filename,
      `${book.title}: archive file must match the original CoverID`);
    } else {
      assert.equal(download.href, original.href, `${book.title}: download must use the verified cover`);
    }
  }
});

test('bundled covers are valid WebP images with matching dimensions and integrity hashes', async () => {
  const assets = await readJson('../src/data/bibliotheca-cover-assets.json');
  assert.ok(Object.keys(assets).length > 0, 'The asset manifest must not be empty');

  for (const [source, asset] of Object.entries(assets)) {
    assert.match(asset.file, /^book-covers\/[a-f0-9]{12,64}\.webp$/);
    assert.ok(Number.isInteger(asset.width) && asset.width > 0, source + ': invalid width');
    assert.ok(Number.isInteger(asset.height) && asset.height > 0, source + ': invalid height');
    assert.match(asset.sha256, /^[a-f0-9]{64}$/, source + ': invalid integrity hash');
    const bytes = await fs.readFile(new URL('../public/' + asset.file, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF', source + ': not a WebP container');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', source + ': not a WebP image');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256,
      source + ': saved image differs from its manifest');
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'webp', source + ': invalid image format');
    assert.equal(metadata.width, asset.width, source + ': incorrect width');
    assert.equal(metadata.height, asset.height, source + ': incorrect height');
  }
});
