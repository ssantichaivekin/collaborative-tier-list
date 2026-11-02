"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import sharp from "sharp";
import { downloadImage } from "./lib/remoteImage";

// Bounded exact-title lookup. Never fetch arbitrary URLs supplied by a model.
export const resolve = internalAction({args:{labels:v.array(v.string()),context:v.optional(v.string())},handler:async(ctx,{labels,context}):Promise<Record<string,Id<"catalogAssets">>>=>{
 const found:Record<string,Id<"catalogAssets">>={};
 const unique=[...new Set(labels)].slice(0,40);
 if(!unique.length)return found;
 try{
  const params=new URLSearchParams({action:"query",format:"json",titles:unique.join("|"),prop:"pageimages|pageprops|extracts",piprop:"thumbnail",pithumbsize:"384",pilicense:"any",ppprop:"disambiguation",redirects:"1",exintro:"1",explaintext:"1",exchars:"600"});
  const response=await fetch("https://en.wikipedia.org/w/api.php?"+params,{headers:{"User-Agent":"MultiplayerTierList/1.0 (image discovery)"},signal:AbortSignal.timeout(8000)});
  if(!response.ok)return found;
  const body=await response.json();
  const pages=Object.values(body.query?.pages??{}) as {title:string;thumbnail?:{source:string};pageprops?:{disambiguation?:string}}[];
  const candidates: {title:string;thumbnail:{source:string};label:string}[] = [];
  for (const label of unique) {
    let page = pages.find(p => p.title.toLowerCase() === label.toLowerCase() && p.thumbnail?.source && p.pageprops?.disambiguation === undefined);
    if (!page) {
      const qualifier = /film|movie|ghibli|cinema/i.test(context ?? "") ? "film" : /novel|book/i.test(context ?? "") ? "novel" : /video game|games/i.test(context ?? "") ? "video game" : /album/i.test(context ?? "") ? "album" : undefined;
      if (qualifier) {
        const p = new URLSearchParams(params); p.set("titles", `${label} (${qualifier})`);
        const r = await fetch("https://en.wikipedia.org/w/api.php?"+p,{signal:AbortSignal.timeout(8000)});
        if(r.ok) {
          const data = await r.json();
          page = (Object.values(data.query?.pages ?? {}) as typeof pages).find(p => p.thumbnail?.source && p.pageprops?.disambiguation === undefined);
        }
      }
      if (!page) {
        const p = new URLSearchParams(params); p.delete("titles");
        p.set("generator","search"); p.set("gsrsearch",`${label} ${qualifier ?? ""}`); p.set("gsrlimit","6");
        const r = await fetch("https://en.wikipedia.org/w/api.php?"+p,{signal:AbortSignal.timeout(8000)});
        if(r.ok) {
          const data = await r.json();
          const options = (Object.values(data.query?.pages ?? {}) as (typeof pages[number] & {extract?:string})[]).filter(p=>p.thumbnail?.source && p.pageprops?.disambiguation === undefined);
          if(options.length) {
            const title = await ctx.runAction(internal.gateway.chooseImagePage, {label,context:context??"",candidates:options.map(p=>({title:p.title,description:p.extract??""}))});
            page = options.find(p=>p.title===title);
          }
        }
      }
    }
    if(page?.thumbnail) candidates.push({title:page.title,thumbnail:page.thumbnail,label});
  }
  for(let start=0;start<candidates.length;start+=4){
   await Promise.allSettled(candidates.slice(start,start+4).map(async page=>{
    const url=page.thumbnail!.source;
    const u=new URL(url);
    if(u.protocol!=="https:"||u.hostname!=="upload.wikimedia.org")return;
    const existing=await ctx.runQuery(internal.catalog.findAsset,{sourceUrl:url});
    if(existing?.optimized){found[encodeURIComponent(page.label.toLowerCase())]=existing._id;return;}
    const buffer=await downloadImage(url);
    const {data,info}=await sharp(buffer,{limitInputPixels:20000000}).rotate().resize(384,384,{fit:"inside",withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});
    if(data.length>200000)return;
    const storageId=await ctx.storage.store(new Blob([new Uint8Array(data)],{type:"image/webp"}));
    const saved=await ctx.runMutation(internal.catalog.finishAssets,{entries:[{sourceUrl:url,storageId,label:page.title,attributionUrl:"https://en.wikipedia.org/wiki/"+encodeURIComponent(page.title.replaceAll(" ","_")),width:info.width,height:info.height}]});
    found[encodeURIComponent(page.label.toLowerCase())]=saved[0].assetId;
   }));
  }
 }catch{ /* A missing image must not prevent reviewing a useful text draft. */ }
 return found;
}});

// Dispatch all missing items without waiting for an earlier batch to finish.
// Slightly stagger starts to avoid a burst against Wikipedia, not completion barriers.
export const enrichDraft = internalAction({
  args: { id: v.id("aiDrafts"), offset: v.optional(v.number()) },
  handler: async (ctx, { id, offset = 0 }) => {
    const items = await ctx.runQuery(internal.ai.imageCandidates, { id });
    await Promise.all(items.slice(offset).filter(item => !item.hasImage).map((item, index) =>
      ctx.scheduler.runAfter(Math.floor(index / 4) * 500, internal.imageSearch.enrichItem, { id, itemId: item.id })
    ));
  },
});

export const enrichItem = internalAction({
  args: { id: v.id("aiDrafts"), itemId: v.string() },
  handler: async (ctx, { id, itemId }) => {
    const items = await ctx.runQuery(internal.ai.imageCandidates, { id });
    const item = items.find(item => item.id === itemId);
    if (!item || item.hasImage) return;
    if (!await ctx.runMutation(internal.imageProgress.begin,{id,itemId})) return;
    let found = false, provider = "wikipedia";
    let error: string | undefined;
    const started=Date.now();
    try {
    const lookupKey=JSON.stringify([item.label.trim().toLowerCase(),item.context.trim().toLowerCase()]);
    let assetId = await ctx.runQuery(internal.imageCache.positive,{lookupKey}) ?? undefined;
    if(assetId) provider="cache";
    const images = assetId ? {} : await ctx.runAction(internal.imageSearch.resolve, { labels: [item.label], context: item.context })
      .catch(() => ({} as Record<string, Id<"catalogAssets">>));
    assetId ??= images[encodeURIComponent(item.label.toLowerCase())];
    if(assetId && provider==="wikipedia") await ctx.runMutation(internal.imageCache.finish,{lookupKey,assetId});
    if (!assetId) {
      // Avoid paying for fallback if another job already filled the item.
      const latest = await ctx.runQuery(internal.ai.imageCandidates, { id });
      if (!latest.some(i => i.id === itemId && !i.hasImage)) return;
      provider = "firecrawl";
      assetId = await ctx.runAction(internal.firecrawl.resolve, { label: item.label, context: item.context }) ?? undefined;
    }
    if (assetId) { await ctx.runMutation(internal.ai.attachImage, { id, itemId, label: item.label, assetId }); found=true; }
    } catch (failure) {
      error = failure instanceof Error && failure.message.startsWith("Image search:") ? failure.message : "Image search failed. Please retry.";
    } finally {
      await ctx.runMutation(internal.imageProgress.finish,{id,itemId,found,provider,...(error?{error}:{})});
      console.info("Image lookup",{draftId:id,itemId,provider,outcome:found?"ready":"unavailable",durationMs:Date.now()-started});
    }
  },
});
