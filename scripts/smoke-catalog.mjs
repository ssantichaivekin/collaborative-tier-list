import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const url=process.env.CONVEX_URL;
if(!url)throw new Error('Set CONVEX_URL to your test deployment. This script writes data.');
const client = new ConvexHttpClient(url);
const access = {slug:randomUUID(), key:randomBytes(32).toString('hex')};
try {
 const results = await client.query(api.catalog.browse,{search:'Pokémon',category:'',featured:false,limit:24});
 assert(results.length > 0);
 const template = await client.query(api.catalog.detail,{id:results[0].id});
 assert(template.items.every(i=>i.imageUrl && i.sourceUrl));
 const response = await fetch(template.items[0].imageUrl);
 assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'image/webp');
 await client.mutation(api.catalog.useTemplate,{...access,templateId:template._id});
 const room=await client.query(api.rooms.get,access);
 assert.equal(room.items.length,template.items.length);
 assert(room.items.every(i=>i.imageUrl && i.tier==='unranked'));
 console.log('PASS: catalog search, image serving, template copy, independent room load.');
} finally {
 const room=await client.query(api.rooms.get,access);
 for(const item of room?.items??[])await client.mutation(api.rooms.remove,{...access,id:item.id});
}
