import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeCatalogue, sourceId } from './lib/bibliotheca.mjs';
const root=process.cwd();
const read=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(path.join(root,file),'utf8'));}catch(error){if(error.code==='ENOENT'&&fallback!==undefined)return fallback;throw error;}};
const rows=await read('.bibliotheca-source/notion-rows.json');
const pages=await read('.bibliotheca-source/page-content.json');
const notes=await read('.bibliotheca-source/linked-notes.json');
const covers=await read('src/data/bibliotheca-covers.json',{});
const overrides=await read('src/data/bibliotheca-cover-overrides.json',{});
// Source completeness is checked before writing any public catalogue.
function completePage(page,id,kind) {
  const metadata=page?.metadata;
  if(!page || typeof page.title!=='string' || typeof page.contentMarkdown!=='string' ||
      !Array.isArray(page.links) || !Array.isArray(page.linkedNotes) || typeof page.blank!=='boolean' || sourceId(page.notionUrl)!==id ||
      typeof metadata?.truncated!=='boolean' || !Number.isInteger(metadata?.unknownBlockCount) ||
      metadata.truncated || metadata.unknownBlockCount!==0) {
    throw new Error(`The ${kind} source ${id} is missing or incomplete; the saved catalogue was preserved.`);
  }
}
if(!Array.isArray(rows)||!rows.length)throw new Error('The source catalogue is empty; the saved catalogue was preserved.');
for(const row of rows) {
  const id=sourceId(row.url);
  completePage(pages[id],id,'book page');
  let related;
  try { related=Array.isArray(row['Reading notes and quotes'])?row['Reading notes and quotes']:JSON.parse(row['Reading notes and quotes']||'[]'); }
  catch { throw new Error(`The note relations for ${id} are invalid; the saved catalogue was preserved.`); }
  if(!Array.isArray(related))throw new Error(`The note relations for ${id} are invalid; the saved catalogue was preserved.`);
  for(const url of related) {
    const noteId=sourceId(url);
    completePage(notes[noteId],noteId,'related note');
    if(typeof notes[noteId].properties?.Notes!=='string')throw new Error(`The related note title ${noteId} is missing; the saved catalogue was preserved.`);
  }
}
// Match the resolver's exact source-title cleaning and fingerprint format.
const coverTitle=value=>String(value||'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const verifiedCovers={},ignoredCovers=[];
for(const row of rows) {
  const id=sourceId(row.url),title=coverTitle(row.Title);
  const authors=Array.isArray(row.Author)?row.Author:JSON.parse(row.Author||'[]');
  const fingerprint=createHash('sha256').update(JSON.stringify({title,authors})).digest('hex');
  for(const [kind,source] of [['automatic',covers.entries||covers],['manual',overrides]]) {
    const candidate=source[id];if(!candidate)continue;
    if(candidate.sourceFingerprint===fingerprint && candidate.sourceTitle===title &&
        JSON.stringify(candidate.sourceAuthors)===JSON.stringify(authors))verifiedCovers[id]=candidate;
    else ignoredCovers.push({id,kind,reason:'source title or authors changed, or fingerprint missing'});
  }
}
if(ignoredCovers.length)console.warn(JSON.stringify({ignoredCovers}));
const catalogue=makeCatalogue(rows,pages,notes,verifiedCovers);
const destination=path.join(root,'src/data/bibliotheca.json');
let previous;
try { previous=JSON.parse(await fs.readFile(destination,'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
const unchanged=previous && JSON.stringify(previous.entries)===JSON.stringify(catalogue.entries);
if(unchanged)catalogue.updatedAt=previous.updatedAt;
await fs.mkdir(path.dirname(destination),{recursive:true});
await fs.writeFile(destination+'.tmp',JSON.stringify(catalogue,null,2)+'\n');
await fs.rename(destination+'.tmp',destination);
const genres=new Set(catalogue.entries.flatMap(entry=>entry.genres));
console.log(JSON.stringify({entries:catalogue.entries.length,genres:genres.size,covers:catalogue.entries.filter(entry=>entry.cover).length,notes:catalogue.entries.filter(entry=>entry.notesHtml).length,links:catalogue.entries.filter(entry=>entry.links.length).length}));
