import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { findRoom, keyHash } from "./rooms";
import { normalizeName } from "../shared/drafts";

const inputItem = v.object({
  label: v.string(),
  imageUrl: v.string(),
  sourceUrl: v.string(),
});
const inputTemplate = v.object({
  slug: v.string(),
  title: v.string(),
  category: v.string(),
  tags: v.array(v.string()),
  items: v.array(inputItem),
  sourceUrl: v.string(),
  sourceNote: v.string(),
  score: v.number(),
  coverUrl: v.string(),
  featured: v.boolean(),
  rank: v.number(),
});
export const browse = query({
  args: {
    search: v.string(),
    category: v.string(),
    featured: v.boolean(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(1000, args.limit));
    let rows;
    if (args.search.trim())
      rows = await ctx.db
        .query("templates")
        .withSearchIndex("search", (q) => {
          let search = q.search("searchText", args.search.trim().slice(0, 100));
          if (args.category) search = search.eq("category", args.category);
          if (args.featured) search = search.eq("featured", true);
          return search;
        })
        .take(limit);
    else if (args.category)
      rows = await ctx.db
        .query("templates")
        .withIndex("by_category", (q) => q.eq("category", args.category))
        .filter((q) => (args.featured ? q.eq(q.field("featured"), true) : true))
        .take(limit);
    else if (args.featured)
      rows = await ctx.db
        .query("templates")
        .withIndex("by_featured", (q) => q.eq("featured", true))
        .take(limit);
    else
      rows = await ctx.db.query("templates").withIndex("by_rank").take(limit);
    return await Promise.all(
      rows.map(async (t) => ({
        id: t._id,
        title: t.title,
        category: t.category,
        count: t.items.length,
        featured: t.featured,
        coverUrl: await (async () => {
          const asset = await ctx.db.get(t.coverId);
          return asset ? ctx.storage.getUrl(asset.storageId) : null;
        })(),
      })),
    );
  },
});
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db.query("templates").take(1200);
    const categories: Record<string, number> = {};
    for (const t of templates)
      categories[t.category] = (categories[t.category] || 0) + 1;
    return {
      total: templates.length,
      categories: Object.fromEntries(Object.entries(categories).map(([name, count]) => [encodeURIComponent(name), count])),
      categoryList: Object.entries(categories).map(([name, count]) => ({ name, count })),
    };
  },
});
export const detail = query({
  args: { id: v.id("templates") },
  handler: async (ctx, { id }) => {
    const template = await ctx.db.get(id);
    if (!template) return null;
    const items = await Promise.all(
      template.items.map(async (item) => {
        const asset = await ctx.db.get(item.assetId);
        return {
          ...item,
          imageUrl: asset ? await ctx.storage.getUrl(asset.storageId) : null,
          sourceUrl: asset?.attributionUrl ?? template.sourceUrl,
        };
      }),
    );
    return { ...template, items };
  },
});
export const useTemplate = mutation({
  args: { slug: v.string(), key: v.string(), templateId: v.id("templates") },
  handler: async (ctx, args) => {
    const exists = await findRoom(ctx, args);
    if (exists) return exists._id; // A retry with the same authorized room key is idempotent.
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new ConvexError("Template unavailable.");
    return await ctx.db.insert("rooms", {
      slug: args.slug,
      keyHash: await keyHash(args.key),
      title: template.title,
      items: template.items.map((i, n) => ({
        ...i,
        id: `template-${n}`,
        tier: "unranked",
      })),
      updatedAt: Date.now(),
    });
  },
});
export const findAsset = internalQuery({
  args: { sourceUrl: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("catalogAssets")
      .withIndex("by_source", (q) => q.eq("sourceUrl", args.sourceUrl))
      .unique(),
});
export const putAsset = internalMutation({
  args: {
    sourceUrl: v.string(),
    storageId: v.id("_storage"),
    label: v.string(),
    attributionUrl: v.string(),
    contentType: v.string(),
    bytes: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("catalogAssets")
      .withIndex("by_source", (q) => q.eq("sourceUrl", args.sourceUrl))
      .unique();
    if (existing) {
      if (existing.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
      return existing._id;
    }
    return await ctx.db.insert("catalogAssets", {
      ...args,
      normalizedName: normalizeName(args.label),
    });
  },
});
export const putTemplate = internalMutation({
  args: { template: inputTemplate, assets: v.array(v.id("catalogAssets")) },
  handler: async (ctx, { template, assets }) => {
    if (
      template.items.length < 5 ||
      template.items.length > 40 ||
      assets.length !== template.items.length
    )
      throw new Error("Invalid template size");
    const existing = await ctx.db
      .query("templates")
      .withIndex("by_slug", (q) => q.eq("slug", template.slug))
      .unique();
    const record = {
      slug: template.slug,
      title: template.title,
      category: template.category,
      tags: template.tags,
      searchText: [
        template.title,
        ...template.tags,
        ...template.items.map((i) => i.label),
      ].join(" "),
      items: template.items.map((i, n) => ({
        label: i.label,
        assetId: assets[n],
      })),
      coverId: assets[0],
      sourceUrl: template.sourceUrl,
      sourceNote: template.sourceNote,
      featured: template.featured,
      rank: template.rank,
    };
    if (existing) await ctx.db.replace(existing._id, record);
    else await ctx.db.insert("templates", record);
  },
});
// Admin-only ingestion. Every published item has a successfully stored image.
export const ingest = internalAction({
  args: { templates: v.array(inputTemplate) },
  handler: async (
    ctx,
    { templates },
  ): Promise<{ saved: number; failed: string[] }> => {
    let saved = 0;
    const failed: string[] = [];
    for (const template of templates) {
      try {
        const assets: Id<"catalogAssets">[] = [];
        for (let start = 0; start < template.items.length; start += 5) {
          const settled = await Promise.allSettled(
            template.items.slice(start, start + 5).map(async (item) => {
              const existing = await ctx.runQuery(internal.catalog.findAsset, {
                sourceUrl: item.imageUrl,
              });
              if (existing) return existing._id;
              const u = new URL(item.imageUrl);
              if (
                u.protocol !== "https:" ||
                (![
                  "static.tvmaze.com",
                  "raw.githubusercontent.com",
                  "www.themealdb.com",
                  "www.thecocktaildb.com",
                  "cdn.myanimelist.net",
                  "upload.wikimedia.org",
                ].includes(u.hostname) &&
                  !u.hostname.endsWith(".mzstatic.com"))
              )
                throw new Error("Unapproved image host");
              const response = await fetch(item.imageUrl, {
                signal: AbortSignal.timeout(20000),
                redirect: "error",
              });
              if (!response.ok)
                throw new Error(`Image HTTP ${response.status}`);
              const blob = await response.blob();
              if (
                ![
                  "image/jpeg",
                  "image/png",
                  "image/webp",
                  "image/gif",
                  "image/avif",
                ].includes(blob.type) ||
                blob.size > 2 * 1024 * 1024 ||
                blob.size < 50
              )
                throw new Error("Invalid image");
              const storageId = await ctx.storage.store(blob);
              return await ctx.runMutation(internal.catalog.putAsset, {
                sourceUrl: item.imageUrl,
                storageId,
                label: item.label,
                attributionUrl: item.sourceUrl,
                contentType: blob.type,
                bytes: blob.size,
              });
            }),
          );
          for (const result of settled) {
            if (result.status === "fulfilled") assets.push(result.value);
          }
          const failure = settled.find(
            (result) => result.status === "rejected",
          );
          if (failure?.status === "rejected") throw failure.reason;
        }
        await ctx.runMutation(internal.catalog.putTemplate, {
          template,
          assets,
        });
        saved++;
      } catch (e) {
        failed.push(
          template.slug +
            ": " +
            (e instanceof Error ? e.message : "Import failed"),
        );
      }
    }
    return { saved, failed };
  },
});

export const prepareAssets = internalMutation({
 args:{entries:v.array(v.object({sourceUrl:v.string()}))},handler:async(ctx,{entries})=>{
  if(entries.length>50)throw new Error("Batch too large");
  return await Promise.all(entries.map(async({sourceUrl})=>{
   const asset=await ctx.db.query("catalogAssets").withIndex("by_source",q=>q.eq("sourceUrl",sourceUrl)).unique();
   if(asset?.optimized)return {sourceUrl,assetId:asset._id,uploadUrl:null};
   return {sourceUrl,assetId:asset?._id??null,uploadUrl:await ctx.storage.generateUploadUrl()};
  }));
 }
});
export const finishAssets = internalMutation({args:{entries:v.array(v.object({sourceUrl:v.string(),storageId:v.id("_storage"),label:v.string(),attributionUrl:v.string(),width:v.number(),height:v.number()}))},handler:async(ctx,{entries})=>{
 const result=[];
 for(const entry of entries){
  const file=await ctx.db.system.get(entry.storageId);
  if(!file||file.contentType!=="image/webp"||file.size>200000||entry.width>384||entry.height>384||entry.width<1||entry.height<1)throw new Error("Image must be optimized WebP, <=384px and <=200KB.");
  const existing=await ctx.db.query("catalogAssets").withIndex("by_source",q=>q.eq("sourceUrl",entry.sourceUrl)).unique();
  if(existing?.optimized){if(existing.storageId!==entry.storageId)await ctx.storage.delete(entry.storageId);result.push({sourceUrl:entry.sourceUrl,assetId:existing._id});continue;}
  const data={...entry,normalizedName:normalizeName(entry.label),contentType:"image/webp",bytes:file.size,optimized:true};
  let assetId;
  if(existing){await ctx.db.patch(existing._id,data);if(existing.storageId!==entry.storageId)await ctx.storage.delete(existing.storageId);assetId=existing._id;}
  else assetId=await ctx.db.insert("catalogAssets",data);
  result.push({sourceUrl:entry.sourceUrl,assetId});
 }
 return result;
}});
export const putBatch = internalMutation({args:{entries:v.array(v.object({template:inputTemplate,assets:v.array(v.id("catalogAssets"))}))},handler:async(ctx,{entries})=>{
 for(const {template,assets} of entries){
  if(template.items.length<5||template.items.length>40||assets.length!==template.items.length)throw new Error("Invalid template size");
  for(const id of assets){const asset=await ctx.db.get(id);if(!asset?.optimized)throw new Error("Image is not ready");}
  const existing=await ctx.db.query("templates").withIndex("by_slug",q=>q.eq("slug",template.slug)).unique();
  const data={slug:template.slug,title:template.title,category:template.category,tags:template.tags,searchText:[template.title,...template.tags,...template.items.map(i=>i.label)].join(" "),items:template.items.map((i,n)=>({label:i.label,assetId:assets[n]})),coverId:assets[0],sourceUrl:template.sourceUrl,sourceNote:template.sourceNote,featured:template.featured,rank:template.rank};
  if(existing)await ctx.db.replace(existing._id,data);else await ctx.db.insert("templates",data);
 }
 return entries.length;
}});
export const finalize = internalMutation({args:{slugs:v.array(v.string())},handler:async(ctx,{slugs})=>{
 const keep=new Set(slugs);
 const templates=await ctx.db.query("templates").collect();
 let removed=0;
 for(const t of templates)if(!keep.has(t.slug)){await ctx.db.delete(t._id);removed++;}
 return {kept:templates.length-removed,removed};
}});

// Bounded admin audit: verify stored bytes as well as the asset metadata.
export const auditBatch = internalQuery({
  args: { slugs: v.array(v.string()) },
  handler: async (ctx, { slugs }) => {
    if (slugs.length > 20) throw new Error("Batch too large");
    const issues: string[] = [];
    let items = 0;
    for (const slug of slugs) {
      const t = await ctx.db.query("templates").withIndex("by_slug", q => q.eq("slug", slug)).unique();
      if (!t) { issues.push(`${slug}: missing template`); continue; }
      if (t.items.length < 5 || t.items.length > 40) issues.push(`${slug}: item count`);
      if (new Set(t.items.map(i => normalizeName(i.label))).size !== t.items.length) issues.push(`${slug}: duplicate labels`);
      for (const item of t.items) {
        items++;
        const asset = await ctx.db.get(item.assetId);
        const file = asset ? await ctx.db.system.get(asset.storageId) : null;
        if (!asset?.optimized || !file || file.contentType !== "image/webp" || file.size > 200000 || !asset.width || !asset.height || asset.width > 384 || asset.height > 384)
          issues.push(`${slug}: invalid image for ${item.label}`);
      }
    }
    return { issues, items };
  },
});
