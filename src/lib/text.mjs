export function plainText(markdown='') {
  return markdown
    .replace(/^```[^\n]*$/gm,' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
    .replace(/<\/?(?:div|span|p|br|details|summary|figure|figcaption|img|iframe|table|thead|tbody|tr|td|th|a)\b[^>]*>/gi,' ')
    .replace(/^[#>\s]+/gm,' ')
    .replace(/\*\*([^*]+)\*\*/g,'$1')
    .replace(/`/g,'')
    .replace(/\s+/g,' ').trim();
}

export function excerpt(markdown='',limit=112) {
  const prose=markdown.replace(/```[\s\S]*?```/g,'').split(/\n\s*\n/)
    .map(block=>block.trim()).find(block=>block.length>18&&!/^(?:#|\||<|!\[|\$\$|[-*]\s|\d+[.)]\s)/.test(block));
  const text=plainText(prose||markdown);
  const chars=Array.from(text);
  return chars.length>limit?chars.slice(0,limit).join('').replace(/[，、；：\s]+$/,'')+'…':text;
}

export function normalize(value='') { return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim(); }

export function searchPosts(posts,query) {
  const tokens=normalize(query).split(' ').filter(Boolean);
  if(!tokens.length)return [];
  return posts.map(post=>{
    const fields=[[post.title,12],[(post.tags||[]).join(' '),8],[post.category,5],[post.description,3],[post.text,1]];
    let score=0;
    for(const token of tokens){
      let tokenScore=0;
      for(const [text,weight] of fields)if(normalize(text||'').includes(token))tokenScore+=weight;
      if(!tokenScore)return null;
      score+=tokenScore;
    }
    return {post,score};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||b.post.date.localeCompare(a.post.date)).map(result=>result.post);
}

export function searchSnippet(post,query,limit=150) {
  const terms=normalize(query).split(' ').filter(Boolean);
  const text=post.text||post.description||'';
  const folded=normalize(text);
  const hits=terms.map(term=>folded.indexOf(term)).filter(index=>index>=0);
  const index=hits.length?Math.min(...hits):0;
  const start=Math.max(0,index-35);
  return (start?'…':'')+text.slice(start,start+limit)+(text.length>start+limit?'…':'');
}
