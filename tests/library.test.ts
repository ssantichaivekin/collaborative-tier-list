import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { convexToJson } from "convex/values";
import { validateDraft } from "../shared/drafts";
const modules = import.meta.glob("../convex/**/*.ts");
const access = {
  slug: "12345678-1234-1234-1234-123456789012",
  key: "a".repeat(64),
};
const target = {
  slug: "22345678-1234-1234-1234-123456789012",
  key: "b".repeat(64),
};
const add = { ...access, id: "a", label: "Apple", title: "Fruit" };
it("rejects duplicate and oversized AI drafts", () => {
  const item = { id: "a", label: "Apple", tier: "unranked" };
  expect(() =>
    validateDraft({
      title: "Fruit",
      note: "",
      items: [item, { ...item, id: "b", label: " apple " }],
    }),
  ).toThrow(/duplicate/);
  expect(() =>
    validateDraft({
      title: "Fruit",
      note: "",
      items: Array.from({ length: 41 }, (_, i) => ({
        ...item,
        id: String(i),
        label: String(i),
      })),
    }),
  ).toThrow(/40/);
});
it("copies catalog items without sharing mutable room state or deleting shared images", async () => {
  const t = convexTest(schema, modules);
  const assetId = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(["sample-image"], { type: "image/png" }),
    );
    return ctx.db.insert("catalogAssets", {
      storageId,
      sourceUrl: "https://example.com/apple.png",
      attributionUrl: "https://example.com",
      label: "Apple",
      normalizedName: "apple",
      contentType: "image/png",
      bytes: 12,
    });
  });
  const templateId = await t.run((ctx) =>
    ctx.db.insert("templates", {
      slug: "fruit",
      title: "Fruit",
      category: "Food",
      tags: [],
      searchText: "Fruit Apple",
      items: [{ label: "Apple", assetId }],
      coverId: assetId,
      sourceUrl: "https://example.com",
      sourceNote: "Test",
      featured: true,
      rank: 0,
    }),
  );
  await t.mutation(api.catalog.useTemplate, { ...access, templateId });
  await t.mutation(api.catalog.useTemplate, { ...target, templateId });
  await t.mutation(api.catalog.useTemplate, { ...target, templateId });
  expect(await t.run(ctx => ctx.db.query("rooms").collect())).toHaveLength(2);
  await t.mutation(api.rooms.remove, { ...access, id: "template-0" });
  expect(await t.query(api.rooms.get, access)).toBeNull();
  expect(
    (await t.query(api.rooms.get, target))?.items[0].imageUrl,
  ).toBeTruthy();
  expect(
    (await t.query(api.catalog.detail, { id: templateId }))?.items,
  ).toHaveLength(1);
});
it("rejects stale AI drafts and duplicate application", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.rooms.add, add);
  const begin = await t.mutation(internal.ai.begin, {
    ...access,
    mode: "edit",
  });
  const id = await t.mutation(internal.ai.save, {
    ...access,
    mode: "edit",
    title: "Fruit",
    note: "",
    items: [{ id: "a", label: "Apple", tier: "S" }],
    base: begin.base,
  });
  await t.mutation(api.rooms.rename, {
    ...access,
    title: "Someone else's title",
  });
  await expect(
    t.mutation(api.ai.apply, { ...access, id, selectedIds: ["a"] }),
  ).rejects.toThrow(/changed/);
  const fresh = await t.mutation(internal.ai.begin, {
    ...access,
    mode: "edit",
  });
  const next = await t.mutation(internal.ai.save, {
    ...access,
    mode: "edit",
    title: "Fruit",
    note: "",
    items: [{ id: "a", label: "Apple", tier: "S" }],
    base: fresh.base,
  });
  await t.mutation(api.ai.apply, { ...access, id: next, selectedIds: ["a"] });
  expect((await t.query(api.rooms.get, access))?.items[0].tier).toBe("S");
  await expect(
    t.mutation(api.ai.apply, { ...access, id: next, selectedIds: ["a"] }),
  ).rejects.toThrow(/already/);
});
it("checks AI draft access and rate limits", async () => {
  const t = convexTest(schema, modules);
  const begin = await t.mutation(internal.ai.begin, {
    ...access,
    mode: "create",
  });
  const id = await t.mutation(internal.ai.save, {
    ...access,
    mode: "create",
    title: "Fruit",
    note: "",
    items: [{ id: "a", label: "Apple", tier: "unranked" }],
    base: begin.base,
  });
  expect(
    await t.query(api.ai.preview, { ...access, key: "c".repeat(64), id }),
  ).toBeNull();
  await expect(
    t.mutation(api.ai.apply, {
      ...access,
      key: "c".repeat(64),
      id,
      target,
      selectedIds: ["a"],
    }),
  ).rejects.toThrow();
  for (let i = 0; i < 9; i++)
    await t.mutation(internal.ai.begin, { ...access, mode: "create" });
  await expect(
    t.mutation(internal.ai.begin, { ...access, mode: "create" }),
  ).rejects.toThrow(/limit/);
});
it("AI edits cannot commit through an active drag lease", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.rooms.add, add);
  const begin = await t.mutation(internal.ai.begin, {
    ...access,
    mode: "edit",
  });
  const id = await t.mutation(internal.ai.save, {
    ...access,
    mode: "edit",
    title: "Fruit",
    note: "",
    items: [{ id: "a", label: "Apple", tier: "S" }],
    base: begin.base,
  });
  await t.mutation(api.presence.update, {
    ...access,
    session: "person",
    name: "Person",
    color: "#123456",
    pointer: { x: 0.1, y: 0.1 },
  });
  await t.mutation(api.presence.beginDrag, {
    ...access,
    session: "person",
    id: "a",
  });
  await expect(
    t.mutation(api.ai.apply, { ...access, id, selectedIds: ["a"] }),
  ).rejects.toThrow(/dragging/);
});

it("keeps a board readable if a shared catalog image record is missing", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.rooms.add, add);
  await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["image"], { type: "image/webp" }));
    const assetId = await ctx.db.insert("catalogAssets", { storageId, sourceUrl: "https://example.com/missing", attributionUrl: "https://example.com", label: "Apple", normalizedName: "apple", contentType: "image/webp", bytes: 5 });
    const room = await ctx.db.query("rooms").first();
    await ctx.db.patch(room!._id, { items: [{ ...room!.items[0], assetId }] });
    await ctx.db.delete(assetId);
  });
  const room = await t.query(api.rooms.get, access);
  expect(room?.items[0].label).toBe("Apple");
  expect(room?.items[0].imageUrl).toBeNull();
});

it("uses the hosting deployment even when a build has a development backend configured", async () => {
  const { backendUrl } = await import("../shared/deployment");
  expect(backendUrl("harmless-pigeon-579.convex.site", "https://necessary-lion-569.convex.cloud")).toBe("https://harmless-pigeon-579.convex.cloud");
  expect(backendUrl("localhost", "https://necessary-lion-569.convex.cloud")).toBe("https://necessary-lion-569.convex.cloud");
});

it("serializes category counts containing accented names", async () => {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["image"]));
    const assetId = await ctx.db.insert("catalogAssets", { storageId, sourceUrl: "x", attributionUrl: "x", label: "Pikachu", normalizedName: "pikachu", contentType: "image/webp", bytes: 5 });
    await ctx.db.insert("templates", { slug: "pokemon", title: "Pokémon", category: "Pokémon", tags: [], searchText: "Pokémon", items: [{ label: "Pikachu", assetId }], coverId: assetId, sourceUrl: "x", sourceNote: "", featured: false, rank: 0 });
  });
  const stats = await t.query(api.catalog.stats, {});
  expect(stats.categoryList).toEqual([{ name: "Pokémon", count: 1 }]);
  expect(() => convexToJson(stats)).not.toThrow();
});
it("previews an empty current board without saving it, then confirms into the same room", async () => {
  const t = convexTest(schema, modules);
  const begin = await t.mutation(internal.ai.begin, { ...access, mode: "edit" });
  const id = await t.mutation(internal.ai.save, {
    ...access, mode: "edit", title: "Fruit", note: "", base: begin.base,
    items: [{ id: "apple", label: "Apple", tier: "unranked" }],
  });
  expect(await t.query(api.rooms.get, access)).toBeNull();
  expect((await t.query(api.ai.preview, { ...access, id }))?.stale).toBe(false);
  await t.mutation(api.ai.apply, { ...access, id, selectedIds: ["apple"] });
  expect((await t.query(api.rooms.get, access))?.items[0].label).toBe("Apple");
  expect(await t.run(ctx => ctx.db.query("rooms").collect())).toHaveLength(1);
});
it("fills images after confirmation without overwriting rankings or renamed items", async () => {
  const t = convexTest(schema, modules);
  const begin = await t.mutation(internal.ai.begin, { ...access, mode: "edit" });
  const id = await t.mutation(internal.ai.save, {
    ...access, mode: "edit", title: "Fruit", note: "", base: begin.base,
    items: [{ id: "apple", label: "Apple", tier: "S" }],
  });
  await t.mutation(api.ai.apply, { ...access, id, selectedIds: ["apple"] });
  const assetId = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["image"], { type: "image/webp" }));
    return ctx.db.insert("catalogAssets", { storageId, sourceUrl: "x", attributionUrl: "x", label: "Apple", normalizedName: "apple", contentType: "image/webp", bytes: 5 });
  });
  await t.mutation(internal.ai.attachImage, { id, itemId: "apple", label: "Wrong label", assetId });
  expect((await t.query(api.rooms.get, access))?.items[0].imageUrl).toBeNull();
  await t.mutation(internal.ai.attachImage, { id, itemId: "apple", label: "Apple", assetId });
  const room = await t.query(api.rooms.get, access);
  expect(room?.items[0].imageUrl).toBeTruthy();
  expect(room?.items[0].tier).toBe("S");
  expect((await t.query(api.ai.preview, { ...access, id }))?.items[0].imageUrl).toBeTruthy();
});

it("keeps template browsing and AI previews readable when an image record disappears", async () => {
  const t = convexTest(schema, modules);
  const { assetId, templateId } = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['image']));
    const assetId = await ctx.db.insert('catalogAssets', {storageId,sourceUrl:'https://example.com/image',attributionUrl:'https://example.com',label:'Apple',normalizedName:'apple',contentType:'image/webp',bytes:5});
    const templateId = await ctx.db.insert('templates', {slug:'fruit',title:'Fruit',category:'Food',tags:[],searchText:'Fruit',items:[{label:'Apple',assetId}],coverId:assetId,sourceUrl:'https://example.com',sourceNote:'',featured:false,rank:0});
    return {assetId,templateId};
  });
  const begin = await t.mutation(internal.ai.begin, {...access,mode:'edit'});
  const id = await t.mutation(internal.ai.save, {...access,mode:'edit',title:'Fruit',note:'',base:begin.base,items:[{id:'apple',label:'Apple',tier:'unranked',assetId}]});
  await t.run(ctx=>ctx.db.delete(assetId));
  expect((await t.query(api.catalog.browse,{search:'',category:'',featured:false,limit:24}))[0].coverUrl).toBeNull();
  expect((await t.query(api.catalog.detail,{id:templateId}))?.items[0].imageUrl).toBeNull();
  expect((await t.query(api.ai.preview,{...access,id}))?.items[0].imageUrl).toBeNull();
});
it("rejects item IDs that would be silently truncated into collisions", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.rooms.add,{...add,id:'x'.repeat(65)})).rejects.toThrow(/Invalid item ID/);
  await expect(t.mutation(api.rooms.add,{...add,id:' '})).rejects.toThrow(/Invalid item ID/);
  expect(await t.query(api.rooms.get,access)).toBeNull();
});

it("does not let an imported item claim and delete shared catalog storage", async () => {
  const t = convexTest(schema, modules);
  const imageId = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['shared'],{type:'image/webp'}));
    await ctx.db.insert('catalogAssets',{storageId,sourceUrl:'shared',attributionUrl:'source',label:'Shared',normalizedName:'shared',contentType:'image/webp',bytes:6,optimized:true});
    return storageId;
  });
  await expect(t.mutation(api.rooms.add,{...add,imageId})).rejects.toThrow(/shared/i);
  expect(await t.run(async ctx=>Boolean(await ctx.storage.get(imageId)))).toBe(true);
});
it("keeps image storage intact when asset finalization is retried", async () => {
  const t = convexTest(schema, modules);
  const storageId = await t.run(ctx=>ctx.storage.store(new Blob(['shared'],{type:'image/webp'})));
  const entries = [{storageId,sourceUrl:'retry',attributionUrl:'source',label:'Retry',width:10,height:10}];
  const first = await t.mutation(internal.catalog.finishAssets,{entries});
  expect(await t.mutation(internal.catalog.finishAssets,{entries})).toEqual(first);
  expect(await t.run(async ctx=>Boolean(await ctx.storage.get(storageId)))).toBe(true);
});
it("keeps enrichment batch positions stable as pictures arrive", async () => {
  const t = convexTest(schema, modules);
  const begin = await t.mutation(internal.ai.begin,{...access,mode:'edit'});
  const id = await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Examples',note:'',base:begin.base,items:Array.from({length:6},(_,i)=>({id:String(i),label:`Example ${i}`,tier:'unranked'}))});
  const assetId = await t.run(async ctx=> {
    const storageId=await ctx.storage.store(new Blob(['image'],{type:'image/webp'}));
    return ctx.db.insert('catalogAssets',{storageId,sourceUrl:'stable',attributionUrl:'source',label:'Example 0',normalizedName:'example 0',contentType:'image/webp',bytes:5});
  });
  await t.mutation(internal.ai.attachImage,{id,itemId:'0',label:'Example 0',assetId});
  const items = await t.query(internal.ai.imageCandidates,{id});
  expect(items).toHaveLength(6);
  expect(items[0].hasImage).toBe(true);
  expect(items.slice(4).map(i=>i.id)).toEqual(['4','5']);
});
it('caches paid image misses by context and expires them', async()=>{
 const t=convexTest(schema,modules);
 const lookupKey=JSON.stringify(['mercury','planets']);
 expect((await t.mutation(internal.imageCache.claim,{lookupKey})).run).toBe(true);
 await t.mutation(internal.imageCache.finish,{lookupKey});
 expect((await t.mutation(internal.imageCache.claim,{lookupKey})).run).toBe(false);
 expect((await t.mutation(internal.imageCache.claim,{lookupKey:JSON.stringify(['mercury','cars'])})).run).toBe(true);
 await t.run(async ctx=>{const row=await ctx.db.query('imageLookups').first();await ctx.db.patch(row!._id,{expiresAt:0});});
 expect((await t.mutation(internal.imageCache.claim,{lookupKey})).run).toBe(true);
});
it('reuses paid image results but retries deleted assets',async()=>{
 const t=convexTest(schema,modules);
 const assetId=await t.run(async ctx=>{
 const storageId=await ctx.storage.store(new Blob(['image']));
 return ctx.db.insert('catalogAssets',{storageId,sourceUrl:'cache',attributionUrl:'source',label:'Hospital',normalizedName:'hospital',contentType:'image/webp',bytes:5});
 });
 await t.mutation(internal.imageCache.finish,{lookupKey:'hospital',assetId});
 expect(await t.mutation(internal.imageCache.claim,{lookupKey:'hospital'})).toMatchObject({run:false,assetId});
 await t.run(ctx=>ctx.db.delete(assetId));
 expect((await t.mutation(internal.imageCache.claim,{lookupKey:'hospital'})).run).toBe(true);
});
it('dispatches every missing image without waiting for earlier searches',async()=>{
 const t=convexTest(schema,modules);
 const begin=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const id=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Parallel',note:'',base:begin.base,items:Array.from({length:9},(_,i)=>({id:String(i),label:`Parallel ${i}`,tier:'unranked'}))});
 await t.action(internal.imageSearch.enrichDraft,{id});
 const jobs=await t.run(ctx=>ctx.db.system.query('_scheduled_functions').collect());
 const imageJobs=jobs.filter(job=>job.name.includes('enrichItem'));
 expect(imageJobs).toHaveLength(9);
 expect(new Set(imageJobs.map(job=>(job.args[0] as {itemId:string}).itemId)).size).toBe(9);
});
it('replaces preview images without changing the board and retains them on confirmation',async()=>{
 const t=convexTest(schema,modules);
 const begin=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const id=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Fruit',note:'',base:begin.base,items:[{id:'apple',label:'Apple',tier:'unranked'}]});
 const imageId=await t.run(ctx=>ctx.storage.store(new Blob(['image'],{type:'image/webp'})));
 await expect(t.mutation(api.ai.replacePreviewImage,{...access,key:'c'.repeat(64),id,itemId:'apple',imageId})).rejects.toThrow('unavailable');
 await t.mutation(api.ai.replacePreviewImage,{...access,id,itemId:'apple',imageId});
 expect(await t.query(api.rooms.get,access)).toBeNull();
 expect((await t.query(api.ai.preview,{...access,id}))?.items[0].imageId).toBe(imageId);
 await t.mutation(api.ai.apply,{...access,id,selectedIds:['apple']});
 await t.mutation(internal.ai.expire,{id});
 expect((await t.query(api.rooms.get,access))?.items[0].imageId).toBe(imageId);
 expect(await t.run(async ctx=>Boolean(await ctx.storage.get(imageId)))).toBe(true);
});
it('cleans uploaded preview images when the draft is abandoned',async()=>{
 const t=convexTest(schema,modules);
 const begin=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const id=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Fruit',note:'',base:begin.base,items:[{id:'apple',label:'Apple',tier:'unranked'}]});
 const imageId=await t.run(ctx=>ctx.storage.store(new Blob(['image'],{type:'image/webp'})));
 await t.mutation(api.ai.replacePreviewImage,{...access,id,itemId:'apple',imageId});
 await t.mutation(internal.ai.expire,{id});
 expect(await t.run(ctx=>ctx.storage.get(imageId))).toBeNull();
});
it('keeps revision prompt history and protects draft context with the room key',async()=>{
 const t=convexTest(schema,modules);
 const begin=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const id=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Fruit',note:'',base:begin.base,promptHistory:['Create a fruit list'],items:[{id:'apple',label:'Apple',tier:'unranked'}]});
 const context=await t.query(internal.ai.revisionContext,{...access,id});
 expect(context.promptHistory).toEqual(['Create a fruit list']);
 expect(context.items[0].label).toBe('Apple');
 await expect(t.query(internal.ai.revisionContext,{...access,key:'c'.repeat(64),id})).rejects.toThrow('unavailable');
 const next=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Fruit',note:'',base:begin.base,previousDraftId:id,promptHistory:[...context.promptHistory,'Add pear'],items:[...context.items,{id:'pear',label:'Pear',tier:'unranked'}]});
 expect((await t.query(internal.ai.revisionContext,{...access,id:next})).promptHistory).toEqual(['Create a fruit list','Add pear']);
 expect(await t.query(api.rooms.get,access)).toBeNull();
});
it('applies all generated items directly and keeps context for later updates',async()=>{
 const t=convexTest(schema,modules);
 const begin=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const id=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Fruit',note:'',base:begin.base,promptHistory:['Create fruit'],items:[{id:'apple',label:'Apple',tier:'unranked'}]});
 await t.mutation(api.ai.apply,{...access,id});
 await t.mutation(api.rooms.move,{...access,id:'apple',tier:'S',session:'test'});
 const context=await t.query(internal.ai.revisionContext,{...access,id});
 expect(context.items[0].tier).toBe('S');
 expect(context.promptHistory).toEqual(['Create fruit']);
});
it('checks access and item identity before changing a board image',async()=>{
 const t=convexTest(schema,modules);
 await t.mutation(api.rooms.add,add);
 const assetId=await t.run(async ctx=>{const storageId=await ctx.storage.store(new Blob(['image']));return ctx.db.insert('catalogAssets',{storageId,sourceUrl:'choice',attributionUrl:'source',label:'Apple',normalizedName:'apple',contentType:'image/webp',bytes:5});});
 await expect(t.mutation(api.imageSelection.apply,{...access,key:'c'.repeat(64),itemId:'a',expectedLabel:'Apple',assetId})).rejects.toThrow();
 await expect(t.mutation(api.imageSelection.apply,{...access,itemId:'a',expectedLabel:'Pear',assetId})).rejects.toThrow('changed');
 await t.mutation(api.imageSelection.apply,{...access,itemId:'a',expectedLabel:'Apple',assetId});
 expect((await t.query(api.rooms.get,access))?.items[0].assetId).toBe(assetId);
});
it('undo restores prior items and refuses to overwrite later board edits',async()=>{
 const t=convexTest(schema,modules);await t.mutation(api.rooms.add,add);
 const begin=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const id=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'New fruit',note:'',base:begin.base,items:[{id:'pear',label:'Pear',tier:'unranked'}]});
 await t.mutation(api.ai.apply,{...access,id});
 expect((await t.query(api.ai.preview,{...access,id}))?.canUndo).toBe(true);
 await t.mutation(api.ai.undo,{...access,id});
 expect((await t.query(api.rooms.get,access))?.items[0].label).toBe('Apple');
 expect((await t.query(api.ai.preview,{...access,id}))?.canUndo).toBe(false);
 const nextBase=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const next=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'New fruit',note:'',base:nextBase.base,items:[{id:'pear',label:'Pear',tier:'unranked'}]});
 await t.mutation(api.ai.apply,{...access,id:next});
 await t.mutation(api.rooms.rename,{...access,title:'Collaborator edit'});
 await expect(t.mutation(api.ai.undo,{...access,id:next})).rejects.toThrow('changed');
});
it('deduplicates running image jobs and authenticates targeted retries',async()=>{
 const t=convexTest(schema,modules);
 const begin=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const id=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Fruit',note:'',base:begin.base,items:[{id:'apple',label:'Apple',tier:'unranked'}]});
 expect(await t.query(api.ai.latest,access)).toBe(id);
 expect(await t.mutation(internal.imageProgress.begin,{id,itemId:'apple'})).toBe(true);
 expect(await t.mutation(internal.imageProgress.begin,{id,itemId:'apple'})).toBe(false);
 await t.mutation(internal.imageProgress.finish,{id,itemId:'apple',found:false,provider:'firecrawl'});
 expect((await t.query(api.imageProgress.list,{...access,id}))[0].state).toBe('unavailable');
 await expect(t.mutation(api.imageProgress.retry,{...access,key:'c'.repeat(64),id,itemId:'apple'})).rejects.toThrow();
 await expect(t.mutation(api.imageProgress.retry,{...access,id,itemId:'apple'})).rejects.toThrow('Wait');
});

it('uses a shared positive image cache without searching and preserves it after a late miss',async()=>{
 const t=convexTest(schema,modules);
 const begin=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const id=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Places',note:'',base:begin.base,items:[{id:'hospital',label:'Hospital',tier:'unranked'}]});
 const assetId=await t.run(async ctx=>{
   const storageId=await ctx.storage.store(new Blob(['image']));
   return ctx.db.insert('catalogAssets',{storageId,sourceUrl:'cached-hospital',attributionUrl:'source',label:'Hospital',normalizedName:'hospital',contentType:'image/webp',bytes:5,optimized:true});
 });
 const lookupKey=JSON.stringify(['hospital','places']);
 await t.mutation(internal.imageCache.finish,{lookupKey,assetId});
 await t.mutation(internal.imageCache.finish,{lookupKey});
 expect(await t.query(internal.imageCache.positive,{lookupKey})).toBe(assetId);
 await t.action(internal.imageSearch.enrichItem,{id,itemId:'hospital'});
 const draft=await t.run(ctx=>ctx.db.get(id));
 expect(draft?.items[0].assetId).toBe(assetId);
 const job=await t.run(ctx=>ctx.db.query('imageJobs').first());
 expect(job).toMatchObject({state:'ready',provider:'cache'});
 await t.run(ctx=>ctx.db.delete(assetId));
 expect(await t.query(internal.imageCache.positive,{lookupKey})).toBeNull();
});

it('reports missing jobs and stalled searches instead of loading forever',async()=>{
 const t=convexTest(schema,modules);
 const begin=await t.mutation(internal.ai.begin,{...access,mode:'edit'});
 const id=await t.mutation(internal.ai.save,{...access,mode:'edit',title:'Places',note:'',base:begin.base,items:[{id:'place',label:'Place',tier:'unranked'}]});
 expect((await t.query(api.imageProgress.list,{...access,id}))[0]).toMatchObject({state:'unavailable',error:'No completed image search. Retry to search again.'});
 await t.mutation(internal.imageProgress.begin,{id,itemId:'place'});
 const job=await t.run(ctx=>ctx.db.query('imageJobs').first());
 await t.mutation(internal.imageProgress.timeout,{id,itemId:'place',startedAt:job!.startedAt-1});
 expect((await t.query(api.imageProgress.list,{...access,id}))[0].state).toBe('searching');
 await t.mutation(internal.imageProgress.timeout,{id,itemId:'place',startedAt:job!.startedAt});
 expect((await t.query(api.imageProgress.list,{...access,id}))[0]).toMatchObject({state:'unavailable',error:'Image search timed out. Please retry.'});
 await t.mutation(internal.imageProgress.finish,{id,itemId:'place',found:false,provider:'firecrawl',error:'Image search: Firecrawl credits exhausted.'});
 expect((await t.query(api.imageProgress.list,{...access,id}))[0].error).toContain('credits exhausted');
});

it('shares read-only links without granting mutation access, even after the board becomes empty',async()=>{
 const t=convexTest(schema,modules);
 await t.mutation(api.rooms.add,add);
 const key=await t.mutation(api.rooms.viewKey,access);
 const viewer={...access,key};
 expect(key).not.toBe(access.key);
 expect(await t.mutation(api.rooms.viewKey,access)).toBe(key);
 expect((await t.query(api.rooms.get,viewer))?.canEdit).toBe(false);
 expect((await t.query(api.rooms.get,access))?.canEdit).toBe(true);
 await t.query(api.presence.list,viewer);
 await expect(t.mutation(api.rooms.rename,{...viewer,title:'Forbidden'})).rejects.toThrow('view-only');
 await expect(t.mutation(api.rooms.add,{...add,...viewer,id:'other'})).rejects.toThrow('view-only');
 await expect(t.mutation(api.rooms.uploadUrl,viewer)).rejects.toThrow('view-only');
 await expect(t.mutation(api.rooms.viewKey,viewer)).rejects.toThrow('view-only');
 await expect(t.mutation(internal.ai.begin,{...viewer,mode:'edit'})).rejects.toThrow('view-only');
 await t.mutation(api.rooms.rename,{...access,title:'Live title'});
 expect((await t.query(api.rooms.get,viewer))?.title).toBe('Live title');
 await t.mutation(api.rooms.remove,{...access,id:'a'});
 await expect(t.mutation(api.rooms.add,{...add,...viewer})).rejects.toThrow('view-only');
});
