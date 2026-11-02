import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";

const access = { slug: v.string(), key: v.string() };
const tiers = ["S", "A", "B", "C", "D", "unranked"];
const clean = (value: string, max: number) => value.trim().slice(0, max);
export async function keyHash(key: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function findRoom(
  ctx: QueryCtx | MutationCtx,
  args: { slug: string; key: string },
  allowView = false,
) {
  if (!/^[a-f0-9-]{36}$/.test(args.slug) || !/^[a-f0-9]{64}$/.test(args.key))
    throw new ConvexError(
      "Invalid room link. Ask for the complete share link.",
    );
  const room = await ctx.db
    .query("rooms")
    .withIndex("by_slug", (q) => q.eq("slug", args.slug))
    .unique();
  const hash=await keyHash(args.key);
  const view=await ctx.db.query("viewLinks").withIndex("by_slug",q=>q.eq("slug",args.slug)).unique();
  if(view?.keyHash===hash) {
    if(!allowView)throw new ConvexError("This link is view-only.");
    return room;
  }
  if (room && room.keyHash !== hash)
    throw new ConvexError(
      "This room key is incorrect. Ask for the complete share link.",
    );
  return room;
}
export const get = query({
  args: access,
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args, true);
    if (!room) {
      const view=await ctx.db.query("viewLinks").withIndex("by_slug",q=>q.eq("slug",args.slug)).unique();
      if(view?.keyHash===await keyHash(args.key))return {canEdit:false,title:"Untitled tier list",tierLabels:{},items:[],updatedAt:0};
      return null;
    }
    return {
      canEdit: room.keyHash === await keyHash(args.key),
      title: room.title,
      tierLabels: room.tierLabels ?? {},
      items: await Promise.all(
        room.items.map(async (i) => {
          const asset = i.assetId ? await ctx.db.get(i.assetId) : null;
          const storageId = i.imageId ?? asset?.storageId;
          return { ...i, imageUrl: storageId ? await ctx.storage.getUrl(storageId) : null };
        }),
      ),
      updatedAt: room.updatedAt,
    };
  },
});
export const add = mutation({
  args: {
    ...access,
    id: v.string(),
    label: v.string(),
    imageId: v.optional(v.id("_storage")),
    title: v.string(),
    tierLabels: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args);
    const label = clean(args.label, 100);
    const id = clean(args.id, 64);
    if (!id || id !== args.id) throw new ConvexError("Invalid item ID.");
    if (!label) throw new ConvexError("Give your item a name.");
    if (room?.items.some((i) => i.id === args.id)) return;
    if ((room?.items.length ?? 0) >= 200)
      throw new ConvexError("This board has reached its 200 item limit.");
    if (args.imageId) {
      const shared = await ctx.db.query("catalogAssets")
        .withIndex("by_storage", q => q.eq("storageId", args.imageId!)).first();
      if (shared) throw new ConvexError("This is a shared catalog image. Import your own file instead.");
      const file = await ctx.db.system.get(args.imageId);
      if (
        !file ||
        file.size > 8 * 1024 * 1024 ||
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
          "image/avif",
        ].includes(file.contentType ?? "")
      )
        throw new ConvexError(
          "Choose a PNG, JPG, WebP, GIF, or AVIF image under 8 MB.",
        );
      const claimed = await ctx.db
        .query("images")
        .withIndex("by_storage", (q) => q.eq("storageId", args.imageId!))
        .unique();
      if (claimed)
        throw new ConvexError("This image is already in use. Import it again.");
      await ctx.db.insert("images", {
        storageId: args.imageId,
        slug: args.slug,
      });
    }
    const entry = {
      id,
      label,
      ...(args.imageId ? { imageId: args.imageId } : {}),
      tier: "unranked",
    };
    if (room)
      await ctx.db.patch(room._id, {
        items: [...room.items, entry],
        updatedAt: Date.now(),
      });
    else
      await ctx.db.insert("rooms", {
        slug: args.slug,
        keyHash: await keyHash(args.key),
        title: clean(args.title, 100) || "Untitled tier list",
        tierLabels: Object.fromEntries(
          tiers
            .filter((t) => t !== "unranked")
            .map((t) => [t, clean(args.tierLabels?.[t] ?? t, 40) || t]),
        ),
        items: [entry],
        updatedAt: Date.now(),
      });
  },
});
export const move = mutation({
  args: {
    ...access,
    id: v.string(),
    tier: v.string(),
    beforeId: v.optional(v.string()),
    session: v.string(),
    requireLease: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args);
    if (!room || !tiers.includes(args.tier)) return;
    const people = await ctx.db
      .query("presence")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .collect();
    if (
      people.some(
        (p) =>
          p.keyHash === room.keyHash &&
          p.session !== args.session &&
          p.drag?.id === args.id &&
          p.seenAt > Date.now() - 10000,
      )
    )
      throw new ConvexError(
        "Someone else is moving this item. Try again in a moment.",
      );
    const owner = people.find(
      (p) => p.session === args.session && p.keyHash === room.keyHash,
    );
    if (
      args.requireLease &&
      (owner?.drag?.id !== args.id || owner.seenAt <= Date.now() - 10000)
    )
      throw new ConvexError("Your drag expired. Pick up the item again.");
    const moving = room.items.find((i) => i.id === args.id);
    if (!moving) return;
    const items = room.items.filter((i) => i.id !== args.id);
    const before = items.findIndex(
      (i) => i.id === args.beforeId && i.tier === args.tier,
    );
    let last = -1;
    items.forEach((i, n) => {
      if (i.tier === args.tier) last = n;
    });
    const index = before >= 0 ? before : last >= 0 ? last + 1 : items.length;
    items.splice(index, 0, { ...moving, tier: args.tier });
    await ctx.db.patch(room._id, { items, updatedAt: Date.now() });
    const me = people.find(
      (p) => p.session === args.session && p.keyHash === room.keyHash,
    );
    if (me) await ctx.db.patch(me._id, { drag: null });
  },
});
export const remove = mutation({
  args: { ...access, id: v.string() },
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args);
    if (!room) return;
    const removed = room.items.find((i) => i.id === args.id);
    if (removed?.imageId) {
      await ctx.storage.delete(removed.imageId);
      const asset = await ctx.db
        .query("images")
        .withIndex("by_storage", (q) => q.eq("storageId", removed.imageId!))
        .unique();
      if (asset) await ctx.db.delete(asset._id);
    }
    const items = room.items.filter((i) => i.id !== args.id);
    if (items.length)
      await ctx.db.patch(room._id, { items, updatedAt: Date.now() });
    else {
      await ctx.db.delete(room._id);
    }
  },
});
export const rename = mutation({
  args: { ...access, title: v.string() },
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args);
    if (room)
      await ctx.db.patch(room._id, {
        title: clean(args.title, 100) || "Untitled tier list",
        updatedAt: Date.now(),
      });
  },
});

export const uploadUrl = mutation({
  args: access,
  handler: async (ctx, args) => {
    await findRoom(ctx, args);
    return await ctx.storage.generateUploadUrl();
  },
});

export const renameTier = mutation({
  args: { ...access, tier: v.string(), label: v.string() },
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args);
    if (!tiers.includes(args.tier) || args.tier === "unranked")
      throw new ConvexError("Invalid tier.");
    if (room)
      await ctx.db.patch(room._id, {
        tierLabels: {
          ...room.tierLabels,
          [args.tier]: clean(args.label, 40) || args.tier,
        },
        updatedAt: Date.now(),
      });
  },
});

export const viewKey = mutation({
 args:access,
 handler:async(ctx,args)=>{
  const room=await findRoom(ctx,args);
  if(!room)throw new ConvexError("Add an item before sharing a view-only link.");
  const key=await keyHash("view:"+args.key);
  const hash=await keyHash(key);
  const prior=await ctx.db.query("viewLinks").withIndex("by_slug",q=>q.eq("slug",args.slug)).unique();
  if(prior)await ctx.db.patch(prior._id,{keyHash:hash});
  else await ctx.db.insert("viewLinks",{slug:args.slug,keyHash:hash});
  return key;
 }
});
