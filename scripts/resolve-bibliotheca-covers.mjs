import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2);
const option=(key,fallback)=>{const at=args.indexOf(key);return at<0?fallback:args[at+1]};
const rawFile=option('--source','.bibliotheca-source/notion-rows.json');
const manifestFile=option('--output','src/data/bibliotheca-covers.json');
const cacheFile=option('--cache','.bibliotheca-source/cover-search-cache.json');
const limit=Number(option('--limit','10000'));
const offset=Number(option('--start','0'));
const offline=args.includes('--offline');
const batchFallback=args.includes('--batch-fallback');
const only=option('--only','').toLowerCase();
const readJSON=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}};
const rows=await readJSON(rawFile,[]);
const manifest=await readJSON(manifestFile,{});
const cache=await readJSON(cacheFile,{});
const plain=value=>String(value||'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const norm=value=>plain(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/^(the|a|an) /,'').trim();
const words=value=>new Set(norm(value).split(' ').filter(Boolean));
const similarity=(a,b)=>{a=norm(a);b=norm(b);if(a===b)return 1;const aa=words(a),bb=words(b);const overlap=[...aa].filter(t=>bb.has(t)).length;return overlap/(new Set([...aa,...bb]).size||1)};
const editDistance=(a,b)=>{let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(a[i-1]!==b[j-1]));row=next}return row[b.length]};
const authorPair=(a,b,relaxed)=>{
 const x=norm(a),y=norm(b);if(x===y)return 1;
 const baseline=similarity(x,y);if(!relaxed)return baseline;
 const aa=x.split(' ').filter(Boolean),bb=y.split(' ').filter(Boolean);
 if(!aa.length||!bb.length)return baseline;
 const surnameA=aa.at(-1),surnameB=bb.at(-1);
 const firstA=aa[0],firstB=bb[0];
 const firstCompatible=firstA===firstB||(firstA.length===1&&firstB.startsWith(firstA))||(firstB.length===1&&firstA.startsWith(firstB));
 if(surnameA===surnameB&&(firstCompatible||aa.length===1||bb.length===1))return Math.max(baseline,.9);
 // Only tolerate a spelling/transliteration difference when the work title is
 // already a strong match and given names (or their initials) agree.
 if(firstCompatible&&Math.max(surnameA.length,surnameB.length)>=5&&editDistance(surnameA,surnameB)<=1)return Math.max(baseline,.86);
 return baseline;
};
const authorMatch=(authors,found,relaxed=false)=>!authors.length?1:Math.max(...authors.flatMap(a=>found.map(b=>authorPair(a,b,relaxed))),0);
const sourceMetadata=(title,authors)=>({sourceTitle:title,sourceAuthors:authors,sourceFingerprint:createHash('sha256').update(JSON.stringify({title,authors})).digest('hex')});
const scoreDoc=(title,authors,doc)=>{const titleScore=similarity(title,doc.title);return{doc,titleScore,authorScore:authorMatch(authors,doc.author_name||[],titleScore>=.9)}};
const acceptable=m=>m.titleScore>=.72&&m.authorScore>=.5;
const cachedDocs=()=>[...new Map(Object.values(cache).flatMap(value=>value.docs||[]).filter(doc=>doc.cover_i>0).map(doc=>[doc.key+'|'+doc.cover_i,doc])).values()];
const idFor=row=>row.url.replace(/[?#].*$/,'').split('/').pop().replace(/-/g,'');
const save=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.tmp';await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n');await fs.rename(temporary,file)};
let lastRequest=0,requests=0,matched=0;
async function search(title,authors){
 const key=norm(title)+'|'+authors.map(norm).join('|');
 if(cache[key])return cache[key];
 if(offline)return null;
 await pause(Math.max(0,1100-(Date.now()-lastRequest)));
 lastRequest=Date.now();requests++;
 const url=new URL('https://openlibrary.org/search.json');
 url.searchParams.set('title',title.replace(/\s*:\s*(a novel|a memoir)\b.*$/i,''));
 if(authors.length)url.searchParams.set('author',authors[0]);
 url.searchParams.set('fields','key,title,author_name,cover_i,edition_key');
 url.searchParams.set('limit','5');
 const response=await fetch(url,{headers:{'User-Agent':'BibliothecaCatalogue/1.0 (personal reading catalogue)'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Open Library '+response.status);
 const data=await response.json();cache[key]={docs:data.docs||[],checkedAt:new Date().toISOString()};await save(cacheFile,cache);return cache[key];
}
// Optional second pass: a few title-only queries can recover work records
// omitted by strict author queries, while matching still validates the author.
const rowAuthors=row=>{try{return JSON.parse(row.Author||'[]')}catch{return[]}};
const sourceUnchanged=(row,previous)=>{
 if(!previous?.src)return false;
 const title=plain(row.Title),authors=rowAuthors(row),source=sourceMetadata(title,authors);
 return previous.sourceFingerprint===source.sourceFingerprint||(!previous.sourceFingerprint&&acceptable(scoreDoc(title,authors,{title:previous.matchTitle,author_name:previous.matchedAuthors||[]})));
};
const batchEligible=row=>{
 const title=plain(row.Title);
 let genres=[];try{genres=JSON.parse(row.Genre||'[]')}catch{}
 return Boolean(title)&&!genres.some(g=>['Podcast','TV Series','Film','War documentary','Essay Resource','Academic Journal'].includes(g))&&
  !/^(?:all (?:works|books|short stories)|works of|collected works of|reading notes|notes and quotes)\b/i.test(title)&&
  !/\b(?:complete works|collected works)\b/i.test(title);
};
const coverFromMatch=(title,authors,match)=>{
 const d=match.doc;
 return {src:`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg?default=false`,sourceUrl:'https://openlibrary.org'+(d.key.startsWith('/')?d.key:'/works/'+d.key),alt:'Cover of '+title,matchTitle:d.title,matchedAuthors:d.author_name||[],coverId:d.cover_i,titleMatch:Math.round(match.titleScore*100)/100,authorMatch:Math.round(match.authorScore*100)/100,...sourceMetadata(title,authors)};
};
if(batchFallback&&!offline){
 const pending=rows.slice(offset).filter(row=>!sourceUnchanged(row,manifest[idFor(row)])&&batchEligible(row)&&(!only||plain(row.Title).toLowerCase().includes(only)));
 for(let start=0;start<pending.length;start+=10){
  const chunk=pending.slice(start,start+10);
  const titles=[...new Set(chunk.map(row=>plain(row.Title)))];
  const cacheKey='batch-title:'+titles.map(norm).sort().join('|');
  let result=cache[cacheKey];
  if(!result){
   if(requests>=limit)break;
   await pause(Math.max(0,1100-(Date.now()-lastRequest)));lastRequest=Date.now();requests++;
   const url=new URL('https://openlibrary.org/search.json');
   url.searchParams.set('q',titles.map(title=>'title:"'+title.replace(/[\\"]/g,'\\$&')+'"').join(' OR '));
   url.searchParams.set('fields','key,title,author_name,cover_i,edition_key');url.searchParams.set('limit','100');
   try{
    const response=await fetch(url,{headers:{'User-Agent':'BibliothecaCatalogue/1.0 (personal reading catalogue)'},signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw Error('Open Library '+response.status);
    const json=await response.json();result={docs:json.docs||[],checkedAt:new Date().toISOString(),queryTitles:titles};cache[cacheKey]=result;await save(cacheFile,cache);
   }catch(error){console.error(JSON.stringify({batch:start/10+1,error:error.message}));continue}
  }
  for(const row of chunk){
   const title=plain(row.Title),authors=rowAuthors(row);
   const candidates=result.docs.filter(d=>d.cover_i>0).map(doc=>scoreDoc(title,authors,doc)).filter(m=>m.titleScore>=.9&&m.authorScore>=.5).sort((a,b)=>(b.titleScore*.75+b.authorScore*.25)-(a.titleScore*.75+a.authorScore*.25));
   if(candidates[0]){manifest[idFor(row)]=coverFromMatch(title,authors,candidates[0]);matched++;await save(manifestFile,manifest)}
  }
  console.log(JSON.stringify({batch:start/10+1,batchTitles:titles.length,requests,newMatches:matched,totalCovers:Object.keys(manifest).length}));
 }
}
for(const row of rows.slice(offset)){
 const title=plain(row.Title),id=idFor(row);
 if(only&&!title.toLowerCase().includes(only))continue;
 let authors=[];try{authors=JSON.parse(row.Author||'[]')}catch{}
 const source=sourceMetadata(title,authors);
 const previous=manifest[id];
 if(previous?.src){
  const unchanged=previous.sourceFingerprint===source.sourceFingerprint;
  const legacyStillMatches=!previous.sourceFingerprint&&acceptable(scoreDoc(title,authors,{title:previous.matchTitle,author_name:previous.matchedAuthors||[]}));
  if(unchanged||legacyStillMatches){if(!unchanged)manifest[id]={...previous,...source};continue}
  // Reusing a Notion row for a different work must never keep its old cover.
  delete manifest[id];await save(manifestFile,manifest);
 }
 if(requests>=limit&&!offline&&!batchFallback)break;
 try{
  const response=batchFallback?null:await search(title,authors);
  const ownDocs=response?.docs||[];
  // Offline reprocessing can reuse a work returned for another spelling of
  // the same title/author. Cross-query candidates require stronger evidence.
  const extra=(offline||batchFallback)?cachedDocs().filter(doc=>{const m=scoreDoc(title,authors,doc);return m.titleScore>=.9&&m.authorScore>=.85}):[];
  const docs=[...new Map([...ownDocs,...extra].filter(d=>d.cover_i>0).map(d=>[d.key+'|'+d.cover_i,d])).values()];
  const scored=docs.map(doc=>scoreDoc(title,authors,doc)).filter(acceptable).sort((a,b)=>(b.titleScore*0.75+b.authorScore*0.25)-(a.titleScore*0.75+a.authorScore*0.25));
  const match=scored[0];
  if(match){const d=match.doc;manifest[id]={src:`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg?default=false`,sourceUrl:'https://openlibrary.org'+(d.key.startsWith('/')?d.key:'/works/'+d.key),alt:'Cover of '+title,matchTitle:d.title,matchedAuthors:d.author_name||[],coverId:d.cover_i,titleMatch:Math.round(match.titleScore*100)/100,authorMatch:Math.round(match.authorScore*100)/100,...source};matched++;await save(manifestFile,manifest)}
  if(!offline&&requests&&requests%10===0)console.log(JSON.stringify({requests,newMatches:matched,totalCovers:Object.keys(manifest).length,lastTitle:title}));
 }catch(e){console.error(JSON.stringify({title,error:e.message}));if(/fetch failed|ENOTFOUND/.test(e.message))throw e;}
}
await save(manifestFile,manifest);
console.log(JSON.stringify({entries:rows.length,requests,newMatches:matched,totalCovers:Object.keys(manifest).length,unresolved:rows.filter(r=>!manifest[idFor(r)]).map(r=>plain(r.Title))}));
