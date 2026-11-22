export const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export const sourceUrl = 'https://app.notion.com/p/2ce44a4243d180c9bfc3c25cfb64f631';
export const sourceId = value => (String(value).match(/[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0] || '').replaceAll('-', '').toLowerCase();
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function safeCoverSrc(value) {
  return /^\/book-covers\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp|avif)$/i.test(String(value)) ? value : safeUrl(value);
}
const entities = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&nbsp;':' '};
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, entity => entities[entity]);
const markdownLink = () => /\[([^\]]+)\]\(\s*(?:<(https?:\/\/[^>\r\n]+)>|(https?:\/\/[^\s]+?))\s*\)/g;
export function textAndLinks(value) {
  const links = [];
  let text = String(value || '').replace(/\[([^\]]+)\]\(\s*\)/g, '$1').replace(markdownLink(), (_, label, angleHref, plainHref) => {
    const href = angleHref || plainHref;
    const url = safeUrl(decode(href)); if (url) links.push({label:decode(label.replace(/<[^>]*>/g,'')),url}); return label;
  }).replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const url = safeUrl(decode(href)); if (url) links.push({label:decode(label.replace(/<[^>]*>/g,'')),url}); return label;
  });
  text = decode(text.replace(/<[^>]*>/g, '')).replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\*([^*]+)\*/g,'$1').trim();
  return {text,links};
}
export function safeNotesHtml(markdown) {
  const placeholders = [];
  const keep = html => `RWNOTE${placeholders.push(html)-1}TOKEN`;
  let source = String(markdown || '').replace(/<(database|page|image|file|video|audio|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<(?:empty-block|p)\s*\/>/gi,'').replace(/<p>\s*<\/p>/gi, '');
  source = source.replace(markdownLink(), (_, label, angleHref, plainHref) => {
    const href = angleHref || plainHref;const url=safeUrl(decode(href));return url ? keep(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(textAndLinks(label).text)}</a>`) : label;});
  source = source.replace(/<(\/?)(p|ul|ol|li|blockquote|em|strong|b|i|h[1-6]|br|code|pre)\s*\/?\s*>/gi, (_,close,tag) => keep(`<${close}${tag.toLowerCase()}>`));
  source = escapeHtml(source).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
  source = source.replace(/RWNOTE(\d+)TOKEN/g, (_,index)=>placeholders[Number(index)]);
  const chunks = source.split(/\n\s*\n/).map(chunk=>chunk.trim()).filter(Boolean);
  return chunks.map(chunk=>{
    if (/^<(?:p|ul|ol|li|blockquote|h[1-6]|pre|code)\b/.test(chunk)) return chunk;
    if (/^#{1,6} /.test(chunk)) {const m=chunk.match(/^(#{1,6}) ([\s\S]+)/);const level=Math.min(4,m[1].length+1);return `<h${level}>${m[2]}</h${level}>`;}
    if (/^(?:- |\d+\. )/.test(chunk)) {const ordered=/^\d/.test(chunk),tag=ordered?'ol':'ul';return `<${tag}>`+chunk.split('\n').map(line=>`<li>${line.replace(/^(?:- |\d+\. )/,'')}</li>`).join('')+`</${tag}>`;}
    return `<p>${chunk.replaceAll('\n','<br>')}</p>`;
  }).join('\n').trim();
}
function array(value) { if(Array.isArray(value))return value;try{return JSON.parse(value||'[]');}catch{return [];} }
export function makeCatalogue(rows, pages={}, linkedNotes={}, covers={}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('The source catalogue is empty; the saved catalogue was preserved.');
  const seen = new Set();
  const entries = rows.map(row => {
    const id=sourceId(row.url), title=textAndLinks(row.Title);
    if(!id || seen.has(id) || !title.text) throw new Error('A source row has a missing title, missing ID or duplicate ID.');
    seen.add(id);
    const page=pages[id]||{};
    const notes=[safeNotesHtml(page.contentMarkdown)].filter(Boolean);
    const relations=array(row['Reading notes and quotes']);
    for(const relation of relations){
      const note=linkedNotes[sourceId(relation)];if(!note)continue;
      const quote=note.properties?.Notes ?? note.title ?? '';
      if(quote.trim())notes.push(`<blockquote>${escapeHtml(quote)}</blockquote>`);
      const body=safeNotesHtml(note.contentMarkdown);if(body)notes.push(body);
    }
    const links=[...title.links.map(link=>({...link,label:title.links.length===1?title.text:link.label})),...(page.links||[])].map(link=>({label:link.label||link.title||link.url,url:safeUrl(link.url)})).filter(link=>link.url);
    const uniqueLinks=[...new Map(links.map(link=>[link.url,link])).values()];
    const cover=covers[id]||null;
    return {id,title:title.text,authors:array(row.Author),genres:array(row.Genre),cover:cover&&safeCoverSrc(cover.src)?{src:safeCoverSrc(cover.src),sourceUrl:safeUrl(cover.sourceUrl),alt:cover.alt||`Cover of ${title.text}`}:null,notesHtml:notes.join('\n'),links:uniqueLinks};
  }).sort((a,b)=>collator.compare(a.title,b.title)||a.id.localeCompare(b.id));
  return {updatedAt:new Date().toISOString(),sourceUrl,entries};
}
