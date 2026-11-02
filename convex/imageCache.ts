import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
export const claim = internalMutation({
  args: {lookupKey:v.string()},
  handler: async(ctx,{lookupKey})=>{
    const row=await ctx.db.query('imageLookups').withIndex('by_key',q=>q.eq('lookupKey',lookupKey)).unique();
    if(row && row.expiresAt>Date.now()) {
      if(!row.assetId || await ctx.db.get(row.assetId))return {run:false,assetId:row.assetId};
    }
    return {run:true};
  },
});
export const finish = internalMutation({
  args:{lookupKey:v.string(),assetId:v.optional(v.id('catalogAssets'))},
  handler:async(ctx,args)=>{
    const row=await ctx.db.query('imageLookups').withIndex('by_key',q=>q.eq('lookupKey',args.lookupKey)).unique();
    // A slower failed request must not replace a concurrent success.
    if(!args.assetId && row?.assetId && row.expiresAt>Date.now() && await ctx.db.get(row.assetId))return;
    const data={...args,expiresAt:Date.now()+(args.assetId?7*86400000:15*60000)};
    if(row)await ctx.db.replace(row._id,data);else await ctx.db.insert('imageLookups',data);
  },
});

// Positive cache is shared by discovery providers. Negative entries remain
// specific to the paid fallback, so a previous miss never skips Wikipedia.
export const positive = internalQuery({
  args: {lookupKey:v.string()},
  handler: async(ctx,{lookupKey})=>{
    const row=await ctx.db.query('imageLookups').withIndex('by_key',q=>q.eq('lookupKey',lookupKey)).unique();
    if(!row?.assetId || row.expiresAt<=Date.now())return null;
    const asset=await ctx.db.get(row.assetId);
    return asset?.optimized ? row.assetId : null;
  },
});
