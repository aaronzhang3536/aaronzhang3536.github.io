const storage={get(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}};
const viewKey='wof:browse-mode';
const bookmarkKey='wof:bookmarks';
const sizeKey='wof:reading-size';

document.querySelectorAll('[data-collection]').forEach(collection=>{
  const cards=Array.from(collection.querySelectorAll('[data-post-card]'));
  const count=collection.querySelector('[data-collection-count]');
  const empty=collection.querySelector('[data-collection-empty]');
  const list=collection.querySelector('[data-post-list]');
  function filter(kind){
    if(!['all','tech','life','play'].includes(kind))kind='all';
    let shown=0;
    for(const card of cards){card.hidden=kind!=='all'&&card.dataset.kind!==kind;if(!card.hidden)shown++;}
    collection.querySelectorAll('[data-filter-kind]').forEach(button=>{const active=button.dataset.filterKind===kind;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));});
    if(count)count.textContent=shown+' 篇文章';
    if(empty)empty.hidden=shown!==0;
    if(list)list.hidden=shown===0;
    collection.dataset.filter=kind;
  }
  function browse(mode){
    if(!['gallery','list'].includes(mode))mode='gallery';
    collection.dataset.browse=mode;
    collection.querySelectorAll('[data-browse-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.browseMode===mode)));
  }
  collection.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.filterKind){filter(button.dataset.filterKind);const url=new URL(location.href);if(button.dataset.filterKind==='all')url.searchParams.delete('kind');else url.searchParams.set('kind',button.dataset.filterKind);history.replaceState(null,'',url);}
    if(button.dataset.browseMode){browse(button.dataset.browseMode);storage.set(viewKey,button.dataset.browseMode);}
  });
  browse(storage.get(viewKey,'gallery'));
  filter(new URL(location.href).searchParams.get('kind')||'all');
});

document.querySelectorAll('[data-bookmark]').forEach(button=>{
  const id=button.dataset.bookmark;
  const raw=storage.get(bookmarkKey,[]);
  let saved=Array.isArray(raw)?raw.filter(item=>typeof item==='string'):[];
  function paint(){const active=saved.includes(id);button.setAttribute('aria-pressed',String(active));const label=button.querySelector('[data-bookmark-label]');if(label)label.textContent=active?'已放入稍后读':'稍后读';}
  button.addEventListener('click',()=>{saved=saved.includes(id)?saved.filter(item=>item!==id):[...saved,id];storage.set(bookmarkKey,saved);paint();});
  paint();
});

const reader=document.querySelector('[data-reader]');
if(reader){
  const shortcuts=reader.querySelector('[data-reading-shortcuts]');
  if(shortcuts){
    const showShortcuts=()=>{shortcuts.hidden=window.scrollY<650;};
    window.addEventListener('scroll',showShortcuts,{passive:true});showShortcuts();
    reader.querySelector('[data-show-outline]')?.addEventListener('click',()=>{const outline=reader.querySelector('.toc-disclosure');if(outline)outline.open=true;});
  }
  const sizes=[16,18,20];let size=storage.get(sizeKey,16);if(!sizes.includes(size))size=16;
  const sizeButton=reader.querySelector('[data-text-size]');
  function setSize(){reader.style.setProperty('--reader-font-size',size+'px');if(sizeButton)sizeButton.setAttribute('aria-label',`调整正文字号，当前 ${size} 像素`);}
  sizeButton?.addEventListener('click',()=>{size=sizes[(sizes.indexOf(size)+1)%sizes.length];storage.set(sizeKey,size);setSize();});
  setSize();
  reader.querySelectorAll('.md-body pre').forEach(pre=>{
    const text=pre.querySelector('code')?.textContent||pre.textContent;
    const button=document.createElement('button');button.type='button';button.className='studio-copy';button.textContent='复制';button.setAttribute('aria-label','复制代码');
    button.addEventListener('click',async()=>{
      let copied=false;
      try{await navigator.clipboard.writeText(text);copied=true;}catch{
        const input=document.createElement('textarea');input.value=text;input.className='studio-clipboard-helper';document.body.append(input);input.select();try{copied=document.execCommand('copy');}catch{}input.remove();button.focus();
      }
      button.textContent=copied?'已复制':'请选择文本复制';setTimeout(()=>button.textContent='复制',1800);
    });
    pre.append(button);
  });
  reader.querySelectorAll('.md-body a[href^="http"]').forEach(link=>{if(link.origin!==location.origin&&!link.hasAttribute('target')){link.target='_blank';link.rel='noopener noreferrer';}});
}

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){document.querySelectorAll('.studio-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary')?.focus();});}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();location.href='/search/';}
});
document.addEventListener('click',event=>document.querySelectorAll('.studio-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;}));
