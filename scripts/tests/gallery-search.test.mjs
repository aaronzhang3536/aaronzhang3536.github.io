import test from 'node:test';
import assert from 'node:assert/strict';
import {excerpt,plainText,searchPosts,searchSnippet} from '../../src/lib/text.mjs';

const entries=[
  {id:'body',title:'Rendering notes',category:'UE',tags:[],description:'Overview',date:'2026-08-01',text:'Intro '.repeat(200)+'Nanite Far Field Trace explained.'},
  {id:'title',title:'Nanite LOD selection',category:'UE',tags:['LOD'],description:'Geometry selection',date:'2026-05-27',text:'Screen error and clusters.'},
];
test('full-text search finds content beyond the previous preview-only index',()=>{
  assert.deepEqual(searchPosts(entries,'Far Field').map(item=>item.id),['body']);
  assert.match(searchSnippet(entries[0],'Far Field'),/Far Field/);
});
test('title matches outrank a newer body-only result',()=>assert.deepEqual(searchPosts(entries,'nanite').map(item=>item.id),['title','body']));
test('multiple search terms must all match and matching is case/width insensitive',()=>{
  assert.deepEqual(searchPosts(entries,'ＮＡＮＩＴＥ lod').map(item=>item.id),['title']);
  assert.equal(searchPosts(entries,'Nanite missing-word').length,0);
  assert.equal(searchPosts(entries,'   ').length,0);
});
test('article cards use prose instead of front-loaded headings and code blocks',()=>{
  const body='# Heading\n\n```cpp\nconst int implementation = 1;\n```\n\n这是正文的第一段，用来说明文章讨论的实际问题。';
  assert.equal(excerpt(body),'这是正文的第一段，用来说明文章讨论的实际问题。');
  assert.ok(plainText(body).includes('implementation'));
});
test('markup-like text remains literal data for the DOM-based search renderer',()=>{
  const post={...entries[0],text:'A literal <script> example is searchable.'};
  assert.equal(searchPosts([post],'<script>')[0],post);
  assert.match(searchSnippet(post,'<script>'),/<script>/);
});
test('search snippets preserve code operators instead of changing their meaning',()=>{
  const text=plainText('```cpp\nweight *= 0.1;\nflags |= 8;\nfloat* pointer;\n```');
  assert.ok(text.includes('weight *= 0.1'));
  assert.ok(text.includes('flags |= 8'));
  assert.ok(text.includes('float* pointer'));
});
