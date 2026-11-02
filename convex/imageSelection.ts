import { internalMutation, mutation } from './_generated/server';
import { v, ConvexError } from 'convex/values';
import { findRoom,keyHash } from './rooms';
import { snapshot } from '../shared/drafts';
const access={slug:v.string(),key:v.string(),itemId:v.string(),draftId:v.optional(v.id('aiDrafts'))};
export const context=internalMutation({args:access,handler:async(ctx,args)=>{
 const room=await findRoom(ctx,args);
 const draft=args.draftId?await ctx.db.get(args.draftId):null;
 if(args.draftId&&(!draft||draft.slug!==args.slug||draft.keyHash!==await keyHash(args.key)))throw new ConvexError('Draft unavailable.');
 const source=draft??room,item=source?.items.find(i=>i.id===args.itemId);
 if(!item)throw new ConvexError('Item unavailable.');
 for(const [bucket,max] of [[`image-options:${args.slug}`,20],['image-options:global',200]] as const){
  const prior=await ctx.db.query('aiLimits').withIndex('by_bucket',q=>q.eq('bucket',bucket)).unique();
  const window=Math.floor(Date.now()/3600000),count=prior?.window===window?prior.count:0;
  if(count>=max)throw new ConvexError('Image search limit reached. You can upload an image.');
  if(prior)await ctx.db.patch(prior._id,{window,count:count+1});else await ctx.db.insert('aiLimits',{bucket,window,count:1});
 }
 return {label:item.label,context:source!.title};
}});
export const apply=mutation({args:{...access,expectedLabel:v.string(),assetId:v.optional(v.id('catalogAssets')),imageId:v.optional(v.id('_storage'))},handler:async(ctx,args)=>{
 const room=await findRoom(ctx,args);
 const draft=args.draftId?await ctx.db.get(args.draftId):null;
 if(args.draftId&&(!draft||draft.applied||draft.slug!==args.slug||draft.keyHash!==await keyHash(args.key)))throw new ConvexError('Draft unavailable.');
 if(draft && snapshot(room)!==draft.base)throw new ConvexError("The board changed. Start a fresh edit.");
 const source=draft??room,item=source?.items.find(i=>i.id===args.itemId);
 if(!source||!item||item.label!==args.expectedLabel)throw new ConvexError('Item changed. Open the image picker again.');
 if(Boolean(args.assetId)===Boolean(args.imageId))throw new ConvexError('Choose one image.');
 if(args.assetId&&!(await ctx.db.get(args.assetId)))throw new ConvexError('Image unavailable.');
 if(args.imageId){
  const file=await ctx.db.system.get(args.imageId);
  if(!file||file.contentType!=='image/webp'||file.size>200000)throw new ConvexError('Invalid image.');
  if(await ctx.db.query('images').withIndex('by_storage',q=>q.eq('storageId',args.imageId!)).first()||await ctx.db.query('catalogAssets').withIndex('by_storage',q=>q.eq('storageId',args.imageId!)).first())throw new ConvexError('Import a new file.');
  await ctx.db.insert('images',{storageId:args.imageId,slug:args.slug});
 }
 const items=source.items.map(i=>{if(i.id!==args.itemId)return i;const {imageId,assetId,...rest}=i;return {...rest,...(args.assetId?{assetId:args.assetId}:{imageId:args.imageId!})};});
 if(draft){await ctx.db.patch(draft._id,{items,...(args.imageId?{uploadedImages:[...(draft.uploadedImages??[]),args.imageId]}:{})});}
 else {await ctx.db.patch(room!._id,{items,updatedAt:Date.now()});if(item.imageId){await ctx.storage.delete(item.imageId);const claim=await ctx.db.query('images').withIndex('by_storage',q=>q.eq('storageId',item.imageId!)).unique();if(claim)await ctx.db.delete(claim._id);}}
}});
