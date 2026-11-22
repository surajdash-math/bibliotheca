# Bibliotheca maintenance

Bibliotheca is a standalone catalogue. Its hosted address and source repository remain independent of Suraj's academic website. Suraj approved one link from the Misc page, labelled “A collection of my favorite literature”, opening Bibliotheca in a new tab. Daily catalogue refreshes must not edit the academic website.

## Accepted presentation

Preserve the approved Reading Room: a plain paper background, all titles in one alphabetical grid by default, and an alphabetical genre sidebar with entry counts. Selecting a genre shows its complete shelf. On phones, use the genre selector. Missing or unavailable cover images use visible title-and-author cards. Do not restore the rejected collage watermark or the long stack of sparse genre sections.

Preserve the footer copied from Suraj's academic website, including its copyright wording and links. Its Copyright and Miscellaneous links use absolute academic-site URLs so they work from this independent origin. Do not replace it with the former minimal Bibliotheca footer.

Keep the ReadingQuotes card immediately above the footer. It contains the exact two quotations, edition credits and original-source links copied from the academic website's HomeQuotes component, in a blue-grey colour suitable for the Reading Room. Preserve the visible Next and Pause/Play controls, manual navigation, and pause behavior.

Show all active records from the Notion Bibliotheca All view, including series, author collections, duplicate titles with distinct page IDs, and other media already present. Preserve exact source Genre tags in the catalogue data. Apply the user-approved presentation mappings in src/data/bibliotheca-shelves.json: (Auto)Biography and Biographical Fiction share the Biography shelf; Brain Science appears as Neuroscience. Autobiographical fiction remains separate. Feminism maps to Women writers, moving its book there and removing the Feminism shelf. Preserve all other tags and deduplicate the book on a merged shelf. Deduplicate a record within a merged shelf and show it on every other applicable shelf. Preserve these mappings on every refresh, including for newly added books. Sort shelves and titles A–Z using the English collator. Keep untagged records on the alphabetically placed Without a genre shelf. Never show reading/finished/ownership/date/status fields. Preserve all user notes, quotations and external links. Add no invented summaries or commentary. Use actual verified cover images where available; retain titles without pretending a missing cover is an illustration of the book.

## Notion sources

- Bibliotheca: https://app.notion.com/p/2ce44a4243d180c9bfc3c25cfb64f631
- Data source: collection://2ce44a42-43d1-8128-9981-000b77fcd1bd
- All view: view://2ce44a42-43d1-81df-a984-000cf6c763bd
- Related notes data source: collection://2ce44a42-43d1-8003-9124-000b7cbd4b6c

Use the authenticated Notion connection to read the schema and query the All view with mode=view and page_size=100, following every cursor. No SQL or rows mode. A failed or partial read must preserve the last published catalogue.

Stage exports in the ignored .bibliotheca-source directory, writing temporary files and renaming only after each export is complete:

- notion-rows.json: a JSON array containing the concatenated `results` arrays from every view-query page, not the query response wrapper. Preserve exact original fields and URLs, including JSON-encoded Author, Genre and Reading notes and quotes arrays. Do not write the final export until `has_more` is false.
- page-content.json: keyed by dashless page ID, with {notionUrl,title,contentMarkdown,cover,links,linkedNotes,blank,metadata}. Fetch book page content, keeping only the content region (not ancestor schemas). metadata contains truncated, unknownBlockCount and lastEditedAt. If any page is inaccessible, truncated or has unknown blocks, stop before publication. links holds {label,url} for authored external links. Ignore book-file downloads. Do not convert arbitrary Notion page cover images into book covers.
- linked-notes.json: keyed by dashless related-note page ID. The same page structure, plus properties containing the exact Notes title property and book relation. A quote may be stored as the note TITLE while its body is blank. Follow current book relations. Preserve exact wording; omit empty note records.

Every exported page object must include `notionUrl` (matching its dashless map key), `title` (a string, possibly empty for an empty note), `contentMarkdown` (a string), `links` and `linkedNotes` (arrays), `blank` (a boolean), and `metadata` with explicit boolean `truncated` and integer `unknownBlockCount`. A truly blank fetched page has `contentMarkdown: ""` and `blank: true`; a failed read is never an empty page. Preserve `lastEditedAt` when available. Related-note `properties` must contain the exact string `Notes` and the `📘 Book` URL array. The importer rejects missing files, missing current pages or related notes, missing metadata flags, truncation and unknown blocks before changing the saved catalogue.

Pace source fetches and respect Notion rate-limit retry guidance. Never edit Notion source pages, statuses, tags, notes or reading progress.

## Import and covers

Run from the current standalone source checkout:

1. npm run bibliotheca:import
2. npm run bibliotheca:covers (queries Open Library at the resolver's polite rate; existing source fingerprints and cache avoid unnecessary requests).
3. If useful for unresolved individual titles, node scripts/resolve-bibliotheca-covers.mjs --batch-fallback. Do not invent covers for an author's complete oeuvre, helper records or unavailable media. The public CoverID URLs and source attribution are intentional; do not bulk-download the cover service.
4. npm run bibliotheca:import again, then npm run bibliotheca:check.

Keep src/data/bibliotheca-cover-overrides.json for verified manual cover choices. Both automatic and manual cover records must carry `sourceTitle`, `sourceAuthors` and `sourceFingerprint`, using the resolver's exact cleaned title and author array. The fingerprint is the SHA-256 hex digest of UTF-8 `JSON.stringify({title,authors})`. The importer omits and reports a cover whose fingerprint or source metadata no longer matches the current Notion record. A stale manual choice does not replace a still-valid automatic match. Do not restamp an old override merely because a record was renamed; verify the cover against the changed work first. The public catalogue contains only id, title, authors, genres, cover, notesHtml and links. It excludes private statuses, ownership and reading dates. The importer escapes note content and keeps only safe links/formatting. Preserve its safety and fidelity tests.

## Save and publish

The public website is hosted by GitHub Pages at https://surajdash-math.github.io/bibliotheca/, in surajdash-math/bibliotheca. Preserve this GitHub Pages host and the /bibliotheca base path. The former Site is used only for the existing authenticated Notion refresh and a public catalogue JSON feed; visitors must open the GitHub Pages address.

Use the current Site ID from .openai/hosting.json, preserving its audience. Open the source repository with a fresh native write credential and the Sites source helper. Build/check the current source, save its exact commit/archive as a new Site version, and deploy with the audience-appropriate native tool. Follow the Sites skill. Do not create a second Site or change its audience. Do not access, edit or push the separate academic website repository.

Publish only complete, validated imports. On failure keep the prior published page and report the specific issue. When data and covers are unchanged, avoid a needless version/deployment. Verify a changed deployment reached success. Never report a stored schedule as a verified completed update.
