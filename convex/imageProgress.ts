import {internalMutation,mutation,query} from './_generated/server';
import {v,ConvexError} from 'convex/values';
import {internal} from './_generated/api';
import {keyHash,findRoom} from './rooms';
const jobArgs={id:v.id('aiDrafts'),itemId:v.string()};
export const begin=internalMutation({args:jobArgs,handler:async(ctx,args)=>{
 const draft=await ctx.db.get(args.id);
 if(!draft||draft.undone)return false;
 const prior=await ctx.db.query('imageJobs').withIndex('by_item',q=>q.eq('draftId',args.id).eq('itemId',args.itemId)).unique();
 if(prior?.state==='searching'&&prior.startedAt>Date.now()-180000)return false;
 const data={draftId:args.id,itemId:args.itemId,state:'searching',startedAt:Date.now()};
 if(prior)await ctx.db.replace(prior._id,data);else await ctx.db.insert('imageJobs',data);
 await ctx.scheduler.runAfter(180000,internal.imageProgress.timeout,{...args,startedAt:data.startedAt});
 return true;
}});
export const finish=internalMutation({args:{...jobArgs,found:v.boolean(),provider:v.string(),error:v.optional(v.string())},handler:async(ctx,args)=>{
 const prior=await ctx.db.query('imageJobs').withIndex('by_item',q=>q.eq('draftId',args.id).eq('itemId',args.itemId)).unique();
 if(prior)await ctx.db.patch(prior._id,{state:args.found?'ready':'unavailable',finishedAt:Date.now(),provider:args.provider,error:args.error});
}});
export const list=query({args:{slug:v.string(),key:v.string(),id:v.id('aiDrafts')},handler:async(ctx,args)=>{
 await findRoom(ctx,args);const draft=await ctx.db.get(args.id);
 if(!draft||draft.slug!==args.slug||draft.keyHash!==await keyHash(args.key)||draft.undone)return [];
 const jobs=await ctx.db.query('imageJobs').withIndex('by_draft',q=>q.eq('draftId',args.id)).collect();
 return draft.items.filter(i=>!i.assetId&&!i.imageId).map(i=>{const job=jobs.find(j=>j.itemId===i.id);const unavailable=!job||job.state==='unavailable'||Date.now()-job.startedAt>180000;return {id:i.id,label:i.label,state:unavailable?'unavailable':'searching',error:unavailable?(job?.error??(job?'Image not found.':'No completed image search. Retry to search again.')):undefined};});
}});
export const retry=mutation({args:{slug:v.string(),key:v.string(),...jobArgs},handler:async(ctx,args)=>{
 await findRoom(ctx,args);const draft=await ctx.db.get(args.id);
 if(!draft||draft.slug!==args.slug||draft.keyHash!==await keyHash(args.key)||draft.undone)throw new ConvexError('Draft unavailable.');
 const item=draft.items.find(i=>i.id===args.itemId);if(!item||item.assetId||item.imageId)return;
 const job=await ctx.db.query('imageJobs').withIndex('by_item',q=>q.eq('draftId',args.id).eq('itemId',args.itemId)).unique();
 if(job&&Date.now()-job.startedAt<30000)throw new ConvexError('Wait a moment before retrying.');
 if(job?.state==='searching'&&Date.now()-job.startedAt<180000)return;
 const bucket='image-retry:'+args.slug,window=Math.floor(Date.now()/3600000);
 const limit=await ctx.db.query('aiLimits').withIndex('by_bucket',q=>q.eq('bucket',bucket)).unique();
 const count=limit?.window===window?limit.count:0;
 if(count>=20)throw new ConvexError('Retry limit reached. Try later or upload an image.');
 if(limit)await ctx.db.patch(limit._id,{window,count:count+1});else await ctx.db.insert('aiLimits',{bucket,window,count:1});
 const lookupKey=JSON.stringify([item.label.trim().toLowerCase(),draft.title.trim().toLowerCase()]);
 const cached=await ctx.db.query('imageLookups').withIndex('by_key',q=>q.eq('lookupKey',lookupKey)).unique();
 if(cached&&!cached.assetId)await ctx.db.delete(cached._id);
 if(job)await ctx.db.patch(job._id,{state:'queued',startedAt:Date.now()});
 await ctx.scheduler.runAfter(0,internal.imageSearch.enrichItem,{id:args.id,itemId:args.itemId});
}});

export const timeout=internalMutation({
 args:{...jobArgs,startedAt:v.number()},
 handler:async(ctx,args)=>{
  const job=await ctx.db.query('imageJobs').withIndex('by_item',q=>q.eq('draftId',args.id).eq('itemId',args.itemId)).unique();
  if(job?.startedAt===args.startedAt && ['searching','queued'].includes(job.state))
   await ctx.db.patch(job._id,{state:'unavailable',finishedAt:Date.now(),error:'Image search timed out. Please retry.'});
 }
});
