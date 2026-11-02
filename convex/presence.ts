import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { pointer } from "./schema";
import { findRoom, keyHash } from "./rooms";

const access = { slug: v.string(), key: v.string() };
const identity = {
  ...access,
  session: v.string(),
  name: v.string(),
  color: v.string(),
  pointer,
};
export const update = mutation({
  args: { ...identity, tier: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await findRoom(ctx, args);
    if (args.session.length > 64) throw new ConvexError("Invalid session");
    const hash = await keyHash(args.key);
    const me = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) =>
        q.eq("slug", args.slug).eq("session", args.session),
      )
      .unique();
    if (me && me.keyHash !== hash) throw new ConvexError("Invalid session key");
    const position = args.pointer
      ? {
          x: Math.max(0, Math.min(1, args.pointer.x)),
          y: Math.max(0, Math.min(1, args.pointer.y)),
          ...(["S", "A", "B", "C", "D", "unranked"].includes(
            args.pointer.zone ?? "",
          )
            ? { zone: args.pointer.zone }
            : {}),
        }
      : null;
    const profile = {
      name: args.name.trim().slice(0, 40) || "Anonymous",
      color: /^#[0-9a-f]{6}$/i.test(args.color) ? args.color : "#7164c4",
      pointer: position,
      seenAt: Date.now(),
    };
    if (me)
      await ctx.db.patch(me._id, {
        ...profile,
        drag:
          args.pointer && me.drag && me.seenAt > Date.now() - 10000
            ? { ...me.drag, tier: args.tier ?? me.drag.tier }
            : null,
      });
    else {
      const people = await ctx.db
        .query("presence")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug))
        .take(100);
      if (people.length >= 50)
        throw new ConvexError(
          "This room has reached its 50 collaborator limit.",
        );
      const id = await ctx.db.insert("presence", {
        ...profile,
        slug: args.slug,
        keyHash: hash,
        session: args.session,
        drag: null,
      });
      await ctx.scheduler.runAfter(45000, internal.presence.expire, { id });
    }
  },
});
export const list = query({
  args: access,
  handler: async (ctx, args) => {
    const room=await findRoom(ctx, args, true);
    const hash = room?.keyHash ?? await keyHash(args.key);
    const people = await ctx.db
      .query("presence")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .collect();
    return people
      .filter((p) => p.keyHash === hash)
      .map(({ session, name, color, pointer, drag, seenAt }) => ({
        session,
        name,
        color,
        pointer,
        drag,
        seenAt,
      }));
  },
});
export const beginDrag = mutation({
  args: { ...access, session: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    const room = await findRoom(ctx, args);
    if (!room?.items.some((i) => i.id === args.id))
      throw new ConvexError("This item is no longer on the board.");
    const people = await ctx.db
      .query("presence")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .collect();
    const other = people.find(
      (p) =>
        p.keyHash === room.keyHash &&
        p.session !== args.session &&
        p.drag?.id === args.id &&
        p.seenAt > Date.now() - 10000,
    );
    if (other)
      throw new ConvexError(
        `${other.name} is moving this item. Try again when they finish.`,
      );
    const me = people.find(
      (p) => p.session === args.session && p.keyHash === room.keyHash,
    );
    if (!me)
      throw new ConvexError("Connecting your cursor. Try again in a moment.");
    await ctx.db.patch(me._id, {
      drag: { id: args.id, tier: "" },
      seenAt: Date.now(),
    });
  },
});
export const endDrag = mutation({
  args: { ...access, session: v.string() },
  handler: async (ctx, args) => {
    await findRoom(ctx, args);
    const me = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) =>
        q.eq("slug", args.slug).eq("session", args.session),
      )
      .unique();
    if (me && me.keyHash === (await keyHash(args.key)))
      await ctx.db.patch(me._id, { drag: null });
  },
});
export const leave = mutation({
  args: { ...access, session: v.string() },
  handler: async (ctx, args) => {
    const me = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) =>
        q.eq("slug", args.slug).eq("session", args.session),
      )
      .unique();
    if (me && me.keyHash === (await keyHash(args.key)))
      await ctx.db.delete(me._id);
  },
});
export const expire = internalMutation({
  args: { id: v.id("presence") },
  handler: async (ctx, { id }) => {
    const person = await ctx.db.get(id);
    if (!person) return;
    const age = Date.now() - person.seenAt;
    if (age >= 45000) await ctx.db.delete(id);
    else
      await ctx.scheduler.runAfter(45000 - age, internal.presence.expire, {
        id,
      });
  },
});
