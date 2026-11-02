"use node";
import { action } from './_generated/server';
import { api, internal } from './_generated/api';
import { v, ConvexError } from 'convex/values';
import { downloadImage, imageUrl } from './lib/remoteImage';
import sharp from 'sharp';
const access={slug:v.string(),key:v.string(),itemId:v.string(),draftId:v.optional(v.id('aiDrafts'))};
export const search = action({
 args:{...access,query:v.optional(v.string())},
 handler:async(ctx,args):Promise<{title:string;url:string;sourceUrl:string;previewUrl:string}[]>=>{
  const {query,...contextArgs}=args;
  if(query!==undefined&&(!query.trim()||query.length>300))throw new ConvexError("Use a search query between 1 and 300 characters.");
  const item=await ctx.runMutation(internal.imageSelection.context,contextArgs);
  const key=process.env.FIRECRAWL_API_KEY;
  if(!key)throw new ConvexError('Image search is not configured. You can upload an image.');
  const response=await fetch('https://api.firecrawl.dev/v2/search',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({query:query?.trim()??`${item.label} ${item.context}`,sources:[{type:'images'}],limit:6,excludeDomains:['instagram.com','facebook.com','pinterest.com'],safe:true,timeout:15000}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new ConvexError('Image search unavailable. You can upload an image.');
  const body=await response.json();
  const seen=new Set<string>();
  const candidates = (Array.isArray(body.data?.images)?body.data.images:[]).filter((x:any)=>{
   try {imageUrl(x.imageUrl);if(typeof x.title!=='string'||typeof x.url!=='string'||!['https:','http:'].includes(new URL(x.url).protocol)||seen.has(x.imageUrl))return false;seen.add(x.imageUrl);return true;}catch{return false;}
  }).slice(0,6).map((x:any)=>({title:x.title as string,url:x.imageUrl as string,sourceUrl:x.url as string}));
  const choices: {title:string;url:string;sourceUrl:string;previewUrl:string}[] = [];
  for(let offset=0;offset<candidates.length && choices.length<3;offset+=3){
    const verified=await Promise.all(candidates.slice(offset,offset+3).map(async(candidate:{title:string;url:string;sourceUrl:string})=>{
      try {
        const existing=await ctx.runQuery(internal.catalog.findAsset,{sourceUrl:candidate.url});
        let storageId=existing?.optimized?existing.storageId:undefined;
        if(!storageId){
          const buffer=await downloadImage(candidate.url);
          const {data,info}=await sharp(buffer,{limitInputPixels:20000000}).rotate().resize(384,384,{fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
          if(data.length>200000)return null;
          const uploaded=await ctx.storage.store(new Blob([new Uint8Array(data)],{type:'image/webp'}));
          await ctx.runMutation(internal.catalog.finishAssets,{entries:[{sourceUrl:candidate.url,storageId:uploaded,label:item.label,attributionUrl:candidate.sourceUrl,width:info.width,height:info.height}]});
          // A concurrent cache write can replace our upload with its existing file.
          storageId=(await ctx.runQuery(internal.catalog.findAsset,{sourceUrl:candidate.url}))?.storageId;
        }
        const previewUrl=storageId?await ctx.storage.getUrl(storageId):null;
        return previewUrl?{...candidate,previewUrl}:null;
      }catch{return null;}
    }));
    for(const choice of verified)if(choice&&choices.length<3)choices.push(choice);
  }
  return choices;
 }
});
export const select = action({
 args:{...access,url:v.string(),sourceUrl:v.string()},
 handler:async(ctx,args):Promise<null>=>{
  if(!["http:","https:"].includes(new URL(args.sourceUrl).protocol))throw new ConvexError("Invalid source URL.");
  // Recheck access before downloading, and again when committing the image.
  const board= args.draftId ? await ctx.runQuery(api.ai.preview,{slug:args.slug,key:args.key,id:args.draftId}) : await ctx.runQuery(api.rooms.get,{slug:args.slug,key:args.key});
  const item=board?.items.find(i=>i.id===args.itemId);
  if(!item)throw new ConvexError('Item unavailable.');
  const existing=await ctx.runQuery(internal.catalog.findAsset,{sourceUrl:args.url});
  let assetId=existing?.optimized?existing._id:undefined;
  if(!assetId){
   const buffer=await downloadImage(args.url);
   const {data,info}=await sharp(buffer,{limitInputPixels:20000000}).rotate().resize(384,384,{fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
   if(data.length>200000)throw new ConvexError('Image is too large. Choose another result.');
   const storageId=await ctx.storage.store(new Blob([new Uint8Array(data)],{type:'image/webp'}));
   const saved=await ctx.runMutation(internal.catalog.finishAssets,{entries:[{sourceUrl:args.url,storageId,label:item.label,attributionUrl:args.sourceUrl,width:info.width,height:info.height}]});
   assetId=saved[0].assetId;
  }
  await ctx.runMutation(api.imageSelection.apply,{slug:args.slug,key:args.key,itemId:args.itemId,draftId:args.draftId,assetId,expectedLabel:item.label});
  return null;
 }
});
