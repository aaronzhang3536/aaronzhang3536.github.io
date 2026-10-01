import type {APIRoute} from 'astro';
import {getPosts,searchDocument} from '../lib/posts';
export const GET:APIRoute=async()=>new Response(JSON.stringify((await getPosts()).map(searchDocument)),{headers:{'Content-Type':'application/json; charset=utf-8'}});
