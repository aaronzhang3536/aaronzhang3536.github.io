import {searchPosts,searchSnippet} from '../lib/text.mjs';
const input=document.querySelector('[data-search-input]');
const results=document.querySelector('[data-search-results]');
const status=document.querySelector('[data-search-status]');
const retry=document.querySelector('[data-search-retry]');
let documents=[];let ready=false;let failed=false;let timer;

function highlighted(parent,text,query){
  const terms=query.trim().split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length);
  if(!terms.length){parent.textContent=text;return;}
  const expression=new RegExp(terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gi');
  let from=0;
  for(const match of text.matchAll(expression)){parent.append(document.createTextNode(text.slice(from,match.index)));const mark=document.createElement('mark');mark.textContent=match[0];parent.append(mark);from=match.index+match[0].length;}
  parent.append(document.createTextNode(text.slice(from)));
}

function run(){
  const query=input.value.trim();
  const url=new URL(location.href);if(query)url.searchParams.set('q',query);else url.searchParams.delete('q');history.replaceState(null,'',url);
  if(!ready){status.textContent=failed?'搜索索引暂时未能加载，请重试。':'正在准备搜索…';return;}
  const matched=query?searchPosts(documents,query):documents.slice(0,6);
  results.replaceChildren();
  status.textContent=query?(matched.length?`找到 ${matched.length} 篇相关文章`:'没有找到相关文章，试试标题、标签或其他关键词。'):'可以搜索标题、标签与正文；先看看最近的文章。';
  for(const post of matched){
    const link=document.createElement('a');link.className='studio-search-result';link.href=post.url;
    const heading=document.createElement('h2');highlighted(heading,post.title,query);
    const meta=document.createElement('span');meta.className='studio-search-meta';meta.textContent=`${post.category} · ${post.date} · ${post.minutes} min`;
    const snippet=document.createElement('p');highlighted(snippet,query?searchSnippet(post,query):post.description,query);
    link.append(meta,heading,snippet);results.append(link);
  }
}

async function load(){
  ready=false;failed=false;retry.hidden=true;run();
  try{const response=await fetch('/search-index.json');if(!response.ok)throw new Error('index unavailable');const data=await response.json();if(!Array.isArray(data))throw new Error('invalid index');documents=data;ready=true;run();}
  catch{failed=true;retry.hidden=false;run();}
}

if(input&&results&&status){
  input.value=new URL(location.href).searchParams.get('q')||'';
  input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,100);});
  input.closest('form')?.addEventListener('submit',event=>{event.preventDefault();run();});
  retry.addEventListener('click',load);
  load();
}
