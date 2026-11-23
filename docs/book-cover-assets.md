# Book cover assets

Verified cover choices and source credits remain in `src/data/bibliotheca.json`.
The page resolves each exact cover URL through
`src/data/bibliotheca-cover-assets.json` to a WebP file in
`public/book-covers/`, served under `/bibliotheca/book-covers/`.

After importing new verified covers, run:

```sh
npm run bibliotheca:cache-covers
node --test tests/cover-assets.test.mjs
npm run build
```

The cache command reuses files whose integrity hashes match. It retrieves
known CoverIDs through the Internet Archive image archives where available;
images not present in those archives use their exact existing source URL.
It never searches for a replacement cover or changes catalogue records.
Images retain their proportions, are never enlarged, and are limited to
280 × 420 pixels. The manifest records their download URLs, dimensions and
SHA-256 hashes.

The normal website build is offline. It uses committed image assets and
does not download covers. This command adds no schedule or source refresh.
Future covers without a cached file retain their original image URL until
the cache command is run.
