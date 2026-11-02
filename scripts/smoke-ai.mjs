import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';
import { randomUUID,randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const url=process.env.CONVEX_URL;
if(!url)throw new Error('Set CONVEX_URL to your test deployment. This script writes data and may incur provider costs.');
const client=new ConvexHttpClient(url);
const access={slug:randomUUID(),key:randomBytes(32).toString('hex')};
const target={slug:randomUUID(),key:randomBytes(32).toString('hex')};
try{
 const id=await client.action(api.ai.generate,{...access,mode:'create',prompt:'Create a list of exactly five familiar fruits. No rankings.'});
 const draft=await client.query(api.ai.preview,{...access,id});
 assert.equal(draft.items.length,5);assert(draft.items.every(i=>i.tier==='unranked'));
 await client.mutation(api.ai.apply,{...access,id,target,selectedIds:draft.items.map(i=>i.id)});
 let board=await client.query(api.rooms.get,target);assert.equal(board.items.length,5);
 const item=board.items[0];await client.mutation(api.rooms.move,{...target,id:item.id,tier:'S',session:'test'});
 const editId=await client.action(api.ai.generate,{...target,mode:'edit',prompt:'Add Dragon fruit as one extra fruit. Keep all existing items and their tiers.'});
 const edit=await client.query(api.ai.preview,{...target,id:editId});
 assert.equal(edit.items.length,6);assert.equal(edit.items.find(i=>i.id===item.id).tier,'S');
 await client.mutation(api.ai.apply,{...target,id:editId,selectedIds:edit.items.map(i=>i.id)});
 console.log('PASS: live gateway generation, draft preview, create, edit, preservation of ranked item, apply.');
}finally{
 const board=await client.query(api.rooms.get,target);
 for(const item of board?.items??[])await client.mutation(api.rooms.remove,{...target,id:item.id});
 console.log('Cleaned up smoke-test board.');
}
