import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const item = v.object({
  id: v.string(),
  label: v.string(),
  emoji: v.optional(v.string()),
  imageId: v.optional(v.id("_storage")),
  assetId: v.optional(v.id("catalogAssets")),
  tier: v.string(),
});
export const pointer = v.union(
  v.null(),
  v.object({ x: v.number(), y: v.number(), zone: v.optional(v.string()) }),
);
export const drag = v.union(
  v.null(),
  v.object({ id: v.string(), tier: v.string() }),
);
export const catalogItem = v.object({
  label: v.string(),
  assetId: v.id("catalogAssets"),
});
export default defineSchema({
  viewLinks: defineTable({slug:v.string(),keyHash:v.string()}).index("by_slug",["slug"]),
  imageJobs: defineTable({draftId:v.id("aiDrafts"),itemId:v.string(),state:v.string(),startedAt:v.number(),finishedAt:v.optional(v.number()),provider:v.optional(v.string()),error:v.optional(v.string())}).index("by_item",["draftId","itemId"]).index("by_draft",["draftId"]),
  imageLookups: defineTable({
    lookupKey: v.string(), assetId: v.optional(v.id("catalogAssets")), expiresAt: v.number(),
  }).index("by_key", ["lookupKey"]),
  catalogAssets: defineTable({
    sourceUrl: v.string(),
    storageId: v.id("_storage"),
    label: v.string(),
    normalizedName: v.string(),
    attributionUrl: v.string(),
    contentType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    optimized: v.optional(v.boolean()),
  })
    .index("by_source", ["sourceUrl"])
    .index("by_storage", ["storageId"])
    .index("by_name", ["normalizedName"]),
  templates: defineTable({
    slug: v.string(),
    title: v.string(),
    category: v.string(),
    tags: v.array(v.string()),
    searchText: v.string(),
    items: v.array(catalogItem),
    coverId: v.id("catalogAssets"),
    sourceUrl: v.string(),
    sourceNote: v.string(),
    featured: v.boolean(),
    rank: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_rank", ["rank"])
    .index("by_category", ["category", "rank"])
    .index("by_featured", ["featured", "rank"])
    .searchIndex("search", {
      searchField: "searchText",
      filterFields: ["category", "featured"],
    }),
  aiDrafts: defineTable({
    slug: v.string(),
    keyHash: v.string(),
    mode: v.union(v.literal("create"), v.literal("edit")),
    title: v.string(),
    note: v.string(),
    items: v.array(item),
    base: v.string(),
    createdAt: v.number(),
    applied: v.boolean(),
    undone: v.optional(v.boolean()),
    appliedSnapshot: v.optional(v.string()),
    promptHistory: v.optional(v.array(v.string())),
    uploadedImages: v.optional(v.array(v.id("_storage"))),
  }).index("by_room", ["slug"]),
  aiLimits: defineTable({
    bucket: v.string(),
    window: v.number(),
    count: v.number(),
  }).index("by_bucket", ["bucket"]),
  images: defineTable({ storageId: v.id("_storage"), slug: v.string() }).index(
    "by_storage",
    ["storageId"],
  ),
  rooms: defineTable({
    slug: v.string(),
    keyHash: v.string(),
    title: v.string(),
    tierLabels: v.optional(v.record(v.string(), v.string())),
    items: v.array(item),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),
  presence: defineTable({
    slug: v.string(),
    keyHash: v.string(),
    session: v.string(),
    name: v.string(),
    color: v.string(),
    pointer,
    drag,
    seenAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_session", ["slug", "session"]),
});
