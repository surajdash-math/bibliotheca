import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeCatalogue, safeNotesHtml, safeUrl, textAndLinks } from '../scripts/lib/bibliotheca.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL('../.bibliotheca-source/' + name, import.meta.url), 'utf8'));
const rows = read('notion-rows.json');
const pages = read('page-content.json');
const notes = read('linked-notes.json');
const catalogue = makeCatalogue(rows, pages, notes);
const byId = new Map(catalogue.entries.map(entry => [entry.id, entry]));
const idOf = row => new URL(row.url).pathname.split('/').at(-1).replaceAll('-', '');
const normalized = value => String(value).replace(/\s+/g, ' ').trim();
const decode = value => String(value).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const text = html => normalized(decode(html.replace(/<[^>]*>/g, ' ')));
const fixtureRow = (id = '00000000000000000000000000000001', title = 'A book') => ({
  url: 'https://app.notion.com/p/' + id, Title: title, Author: '["An author"]', Genre: '["Fiction"]'
});
const htmlItems = html => [...String(html).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(match => text(match[1]));
const onlyEmptyParagraphs = body => !String(body || '').replace(/<p\s*\/>|<p>\s*<\/p>/gi, '').trim();
const checkedUrl = value => {
  try { const url = new URL(decode(value)); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; }
  catch { return null; }
};
const embeddedUrls = title => [
  ...String(title).matchAll(/\]\(\s*(?:<(https?:\/\/[^>\r\n]+)>|(https?:\/\/[^\s]+?))\s*\)/g),
  ...String(title).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)
].map(match => checkedUrl(match[1] || match[2])).filter(Boolean);

test('all current Notion entry IDs survive, with every author and genre label unchanged', () => {
  assert.ok(rows.length > 0);
  assert.equal(catalogue.entries.length, rows.length);
  assert.deepEqual(new Set(byId.keys()), new Set(rows.map(idOf)));
  for (const row of rows) {
    const id = idOf(row);
    assert.ok(pages[id], row.Title + ' page source missing');
    const entry = byId.get(id);
    assert.deepEqual(entry.authors, JSON.parse(row.Author || '[]'), row.Title + ' authors');
    assert.deepEqual(entry.genres, JSON.parse(row.Genre || '[]'), row.Title + ' genres');
    if (!/[<\[\*]/.test(row.Title)) assert.equal(entry.title, decode(row.Title).trim(), row.Title + ' title');
  }
  assert.deepEqual(new Set(catalogue.entries.flatMap(entry => entry.genres)), new Set(rows.flatMap(row => JSON.parse(row.Genre || '[]'))));
});

test('catalogue titles sort A-Z while equal source titles remain independent entries', () => {
  const compare = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const titles = catalogue.entries.map(entry => entry.title);
  assert.deepEqual(titles, [...titles].sort(compare.compare));
  const repeated = [fixtureRow(), fixtureRow('00000000000000000000000000000002')];
  const result = makeCatalogue(repeated);
  assert.equal(result.entries.length, repeated.length);
  assert.equal(new Set(result.entries.map(entry => entry.id)).size, repeated.length);
  assert.deepEqual(result.entries.map(entry => entry.title), ['A book', 'A book']);
});

test('formatting is removed from display titles without losing partial-link text or punctuation', () => {
  assert.deepEqual(textAndLinks('<b>Crime and Punishment</b>'), { text: 'Crime and Punishment', links: [] });
  assert.deepEqual(textAndLinks('[<b>E</b>](https://example.com/book)<b>conomical Writing</b>'), {
    text: 'Economical Writing', links: [{ label: 'E', url: 'https://example.com/book' }]
  });
  assert.equal(textAndLinks('A book &amp; another book').text, 'A book & another book');
});

test('angle-delimited Markdown URLs preserve parentheses and do not become HTML tags', () => {
  const destination = 'https://en.wikipedia.org/wiki/The_Flesh_of_the_Orchid_(novel)';
  const source = '[<i>The Flesh of the Orchid</i>](<' + destination + '>)';
  assert.deepEqual(textAndLinks(source), {
    text: 'The Flesh of the Orchid',
    links: [{ label: 'The Flesh of the Orchid', url: destination }]
  });
  const rendered = safeNotesHtml('See ' + source + '.');
  assert.ok(rendered.includes('href="' + destination + '"'));
  assert.ok(rendered.includes('>The Flesh of the Orchid</a>'));
  assert.doesNotMatch(rendered, /\[The Flesh|&lt;https:|\]\(\)/);
  assert.deepEqual(embeddedUrls(source), [destination]);
  const entry = makeCatalogue([fixtureRow(undefined, source)]).entries[0];
  assert.equal(entry.title, 'The Flesh of the Orchid');
  assert.deepEqual(entry.links, [{ label: 'The Flesh of the Orchid', url: destination }]);
});

test('current title and page links retain their destinations, deduplicating only equal URLs', () => {
  for (const row of rows) {
    const id = idOf(row);
    const destinations = [...new Set([
      ...embeddedUrls(row.Title),
      ...(pages[id]?.links || []).map(link => checkedUrl(link.url)).filter(Boolean)
    ])];
    assert.deepEqual(byId.get(id).links.map(link => link.url), destinations, row.Title);
  }
  const row = fixtureRow(undefined, '[A book](https://example.com/book)');
  const result = makeCatalogue([row], { [idOf(row)]: { links: [
    { label: 'Same book', url: 'https://example.com/book' },
    { label: 'New notes', url: 'https://example.com/new-notes' },
    { label: 'Unsafe', url: 'javascript:alert(1)' }
  ] } });
  assert.deepEqual(result.entries[0].links.map(link => link.url), ['https://example.com/book', 'https://example.com/new-notes']);
});

test('all current related quote text and source HTML list items survive edits to the notes', () => {
  for (const row of rows) {
    const id = idOf(row);
    const entry = byId.get(id);
    const related = JSON.parse(row['Reading notes and quotes'] || '[]').map(url => {
      const note = notes[idOf({ url })];
      assert.ok(note, row.Title + ' related note source missing');
      return note;
    });
    const quotes = related.map(note => String(note.properties?.Notes ?? note.title ?? '')).filter(quote => quote.trim());
    const renderedQuotes = [...entry.notesHtml.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)].map(match => text(match[1]));
    for (const quote of quotes) assert.ok(renderedQuotes.includes(normalized(quote)), row.Title + ' quote text changed');
    const sourceItems = [pages[id]?.contentMarkdown || '', ...related.map(note => note.contentMarkdown || '')].flatMap(htmlItems);
    const renderedItems = htmlItems(entry.notesHtml);
    let previous = -1;
    for (const item of sourceItems) {
      const index = renderedItems.indexOf(item, previous + 1);
      assert.ok(index >= 0, row.Title + ' list item missing or moved: ' + item);
      previous = index;
    }
    if (!quotes.length && onlyEmptyParagraphs(pages[id]?.contentMarkdown) && related.every(note => onlyEmptyParagraphs(note.contentMarkdown))) {
      assert.equal(entry.notesHtml, '', row.Title + ' empty source produced a note');
    }
  }
  const row = fixtureRow();
  const result = makeCatalogue([row], { [idOf(row)]: { contentMarkdown: '<p> </p>\n<p />' } });
  assert.equal(result.entries[0].notesHtml, '');
  assert.equal(safeNotesHtml('<database url="https://example.com/private">Reading notes</database>\n<p />'), '');
});

test('public records omit status, ownership, reading-date fields and do not promote page covers', () => {
  const allowed = ['id', 'title', 'authors', 'genres', 'cover', 'notesHtml', 'links'].sort();
  for (const entry of catalogue.entries) {
    assert.deepEqual(Object.keys(entry).sort(), allowed);
    assert.equal(entry.cover, null, 'Original page cover must not become a book cover');
  }
});

test('only verified cover metadata is used, including safe local cover images', () => {
  const row = fixtureRow();
  const id = idOf(row);
  const originalCover = { [id]: { cover: { type: 'external', external: { url: 'https://example.com/personal.png' } } } };
  assert.equal(makeCatalogue([row], originalCover).entries[0].cover, null);
  const cover = { src: '/book-covers/verified-edition.jpg', sourceUrl: 'https://openlibrary.org/works/OL1W', alt: 'Book cover' };
  assert.deepEqual(makeCatalogue([row], {}, {}, { [id]: cover }).entries[0].cover, cover);
  for (const src of ['javascript:alert(1)', 'data:image/svg+xml,bad', '/book-covers/../../private.png', '//untrusted.example/cover.jpg']) {
    assert.equal(makeCatalogue([row], {}, {}, { [id]: { ...cover, src } }).entries[0].cover, null, src);
  }
});

test('note text cannot add executable HTML, unsafe links, or embedded Notion databases', () => {
  const rendered = safeNotesHtml('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[Safe](https://example.com/notes?q=1&b=2)\n\n<database url="https://example.com/private">Private database</database>');
  assert.doesNotMatch(rendered, /<script|<img|<database|onclick=|<a[^>]*javascript:/i);
  assert.match(rendered, /&lt;script&gt;/);
  assert.match(rendered, /href="https:\/\/example.com\/notes\?q=1&amp;b=2"/);
  assert.doesNotMatch(rendered, /Private database/);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('file:///private/notes'), null);
  assert.equal(safeUrl('https://example.com/notes'), 'https://example.com/notes');
});

test('failed imports preserve the previously saved catalogue', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bibliotheca-invalid-import-'));
  try {
    fs.mkdirSync(path.join(temporary, '.bibliotheca-source'));
    fs.mkdirSync(path.join(temporary, 'src/data'), { recursive: true });
    fs.writeFileSync(path.join(temporary, '.bibliotheca-source/notion-rows.json'), '[]');
    const destination = path.join(temporary, 'src/data/bibliotheca.json');
    const saved = '{"preserved":"previous catalogue"}\n';
    fs.writeFileSync(destination, saved);
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/import-bibliotheca.mjs', import.meta.url))], { cwd: temporary, stdio: 'pipe' }));
    assert.equal(fs.readFileSync(destination, 'utf8'), saved);
    assert.throws(() => makeCatalogue([fixtureRow(), fixtureRow()]), /duplicate ID/);
    assert.throws(() => makeCatalogue([fixtureRow(undefined, '')]), /missing title/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});


const importer = fileURLToPath(new URL('../scripts/import-bibliotheca.mjs', import.meta.url));
const fixturePage = (url, title = 'A book') => ({notionUrl:url,title,contentMarkdown:'',cover:null,links:[],linkedNotes:[],blank:true,metadata:{truncated:false,unknownBlockCount:0,lastEditedAt:null}});
function importFixture(row = fixtureRow()) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bibliotheca-source-check-'));
  fs.mkdirSync(path.join(root,'.bibliotheca-source'));
  fs.mkdirSync(path.join(root,'src/data'),{recursive:true});
  const write=(file,data)=>fs.writeFileSync(path.join(root,file),JSON.stringify(data));
  write('.bibliotheca-source/notion-rows.json',[row]);
  write('.bibliotheca-source/page-content.json',{[idOf(row)]:fixturePage(row.url)});
  write('.bibliotheca-source/linked-notes.json',{});
  return {root,write,run:()=>execFileSync(process.execPath,[importer],{cwd:root,stdio:'pipe'}),read:()=>JSON.parse(fs.readFileSync(path.join(root,'src/data/bibliotheca.json'),'utf8'))};
}

test('partial book pages and related notes cannot overwrite a saved catalogue', () => {
  const noteUrl='https://app.notion.com/p/00000000000000000000000000000003';
  const cases=[
    ['missing page',pages=>{delete pages[Object.keys(pages)[0]]}],
    ['truncated page',pages=>{Object.values(pages)[0].metadata.truncated=true}],
    ['unknown page blocks',pages=>{Object.values(pages)[0].metadata.unknownBlockCount=1}],
    ['missing body',pages=>{delete Object.values(pages)[0].contentMarkdown}],
    ['missing metadata flags',pages=>{delete Object.values(pages)[0].metadata.truncated}],
    ['missing related note',(_,notes)=>{delete notes[Object.keys(notes)[0]]}],
    ['truncated related note',(_,notes)=>{Object.values(notes)[0].metadata.truncated=true}],
    ['unknown note blocks',(_,notes)=>{Object.values(notes)[0].metadata.unknownBlockCount=1}],
    ['missing note title',(_,notes)=>{delete Object.values(notes)[0].properties.Notes}]
  ];
  for(const [name,change] of cases){
    const row={...fixtureRow(),'Reading notes and quotes':JSON.stringify([noteUrl])};
    const fixture=importFixture(row);
    try{
      const pages={[idOf(row)]:fixturePage(row.url)};
      const notes={[idOf({url:noteUrl})]:{...fixturePage(noteUrl,'An exact quote'),properties:{Notes:'An exact quote'}}};
      change(pages,notes);
      fixture.write('.bibliotheca-source/page-content.json',pages);
      fixture.write('.bibliotheca-source/linked-notes.json',notes);
      const destination=path.join(fixture.root,'src/data/bibliotheca.json');
      const previous='{"preserved":"existing catalogue"}\n';
      fs.writeFileSync(destination,previous);
      assert.throws(fixture.run,undefined,name);
      assert.equal(fs.readFileSync(destination,'utf8'),previous,name);
    }finally{fs.rmSync(fixture.root,{recursive:true,force:true})}
  }
});

test('stale manual and automatic covers are omitted after a source title or author changes', () => {
  const row=fixtureRow();
  const fixture=importFixture(row);
  try{
    const source={sourceTitle:'A book',sourceAuthors:['An author'],sourceFingerprint:createHash('sha256').update(JSON.stringify({title:'A book',authors:['An author']})).digest('hex')};
    const cover={src:'https://example.com/cover.jpg',sourceUrl:'https://example.com/book',alt:'A book',...source};
    fixture.write('src/data/bibliotheca-cover-overrides.json',{[idOf(row)]:cover});
    fixture.run();assert.equal(fixture.read().entries[0].cover.src,cover.src);
    const automatic={...cover,src:'https://example.com/automatic.jpg'};
    fixture.write('src/data/bibliotheca-covers.json',{[idOf(row)]:automatic});
    fixture.write('src/data/bibliotheca-cover-overrides.json',{[idOf(row)]:{...cover,sourceFingerprint:'stale'}});
    fixture.run();assert.equal(fixture.read().entries[0].cover.src,automatic.src,'A stale override must not hide a valid automatic match');
    fixture.write('src/data/bibliotheca-cover-overrides.json',{[idOf(row)]:cover});
    for(const changed of [{...row,Title:'A different book'},{...row,Author:'["A different author"]'}]){
      fixture.write('.bibliotheca-source/notion-rows.json',[changed]);
      fixture.write('.bibliotheca-source/page-content.json',{[idOf(changed)]:fixturePage(changed.url,changed.Title)});
      fixture.run();assert.equal(fixture.read().entries[0].cover,null,'Old source fingerprints must not survive a renamed or reused record');
    }
  }finally{fs.rmSync(fixture.root,{recursive:true,force:true})}
});
