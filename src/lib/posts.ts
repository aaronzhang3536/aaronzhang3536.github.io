import {getCollection,type CollectionEntry} from 'astro:content';
import {excerpt,plainText} from './text.mjs';
export type Post=CollectionEntry<'posts'>;
export const categories=['UE 剖析','读渲染','AI 与认知','音乐与生活','基础知识'];
export const kindLabels={all:'全部记录',tech:'技术笔记',life:'生活片段',play:'交互实验'};
export const formatDate=(date:Date)=>date.toISOString().slice(0,10);
export const postUrl=(post:Post)=>`/posts/${encodeURIComponent(post.id)}/`;
export const postCategory=(post:Post)=>post.data.sub?`${post.data.cat} · ${post.data.sub}`:post.data.cat;
export const postKind=(post:Post)=>post.data.cat==='音乐与生活'?'life':post.id==='babel-tower'?'play':'tech';
export const postExcerpt=(post:Post,limit=112)=>excerpt(post.body||'',limit)||`${postCategory(post)}：${post.data.title}`;
export const getPosts=async()=> (await getCollection('posts')).sort((a,b)=>+b.data.date-+a.data.date||a.id.localeCompare(b.id));
export function searchDocument(post:Post){return {id:post.id,title:post.data.title,url:postUrl(post),category:postCategory(post),kind:postKind(post),tags:post.data.tags,date:formatDate(post.data.date),minutes:post.data.mins,description:postExcerpt(post),text:plainText(post.body||'')};}
