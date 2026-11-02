import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const access = {
  slug: "12345678-1234-1234-1234-123456789012",
  key: "a".repeat(64),
};
const entry = (id: string) => ({
  ...access,
  id,
  label: id,
  title: "Dinner debate",
});
const person = (session: string) => ({
  ...access,
  session,
  name: session,
  color: "#7463c7",
  pointer: { x: 0.4, y: 0.5 },
});
describe("shared boards", () => {
  it("does not persist empty boards, even with live presence", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.rooms.get, access)).toBeNull();
    await t.mutation(api.presence.update, person("Alice"));
    expect(await t.run((ctx) => ctx.db.query("rooms").collect())).toHaveLength(
      0,
    );
    expect(await t.query(api.presence.list, access)).toHaveLength(1);
  });
  it("keeps simultaneous additions and moves without overwriting unrelated items", async () => {
    const t = convexTest(schema, modules);
    await Promise.all([
      t.mutation(api.rooms.add, entry("Pizza")),
      t.mutation(api.rooms.add, entry("Tacos")),
    ]);
    await Promise.all([
      t.mutation(api.rooms.move, {
        ...access,
        id: "Pizza",
        tier: "S",
        session: "Alice",
      }),
      t.mutation(api.rooms.move, {
        ...access,
        id: "Tacos",
        tier: "A",
        session: "Bob",
      }),
    ]);
    const room = await t.query(api.rooms.get, access);
    expect(room?.items.map((i) => [i.id, i.tier]).sort()).toEqual([
      ["Pizza", "S"],
      ["Tacos", "A"],
    ]);
    await t.mutation(api.rooms.add, entry("Pizza"));
    expect((await t.query(api.rooms.get, access))?.items).toHaveLength(2);
  });
  it("rejects invalid room keys for reads, edits, and presence", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.rooms.add, entry("Pizza"));
    const wrong = { ...access, key: "b".repeat(64) };
    await expect(t.query(api.rooms.get, wrong)).rejects.toThrow("incorrect");
    await expect(
      t.mutation(api.rooms.remove, { ...wrong, id: "Pizza" }),
    ).rejects.toThrow("incorrect");
    await expect(t.query(api.presence.list, wrong)).rejects.toThrow(
      "incorrect",
    );
  });
  it("broadcasts a held item before drop and prevents a second grab or move", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.rooms.add, entry("Pizza"));
    await t.mutation(api.presence.update, person("Alice"));
    await t.mutation(api.presence.update, person("Bob"));
    await t.mutation(api.presence.beginDrag, {
      ...access,
      session: "Alice",
      id: "Pizza",
    });
    await t.mutation(api.presence.update, {
      ...person("Alice"),
      pointer: { x: 0.8, y: 0.2 },
      tier: "S",
    });
    const alice = (await t.query(api.presence.list, access)).find(
      (p) => p.name === "Alice",
    );
    expect(alice?.drag).toEqual({ id: "Pizza", tier: "S" });
    expect(alice?.pointer).toEqual({ x: 0.8, y: 0.2 });
    expect((await t.query(api.rooms.get, access))?.items[0].tier).toBe(
      "unranked",
    );
    await expect(
      t.mutation(api.presence.beginDrag, {
        ...access,
        session: "Bob",
        id: "Pizza",
      }),
    ).rejects.toThrow("Alice is moving");
    await expect(
      t.mutation(api.rooms.move, {
        ...access,
        session: "Bob",
        id: "Pizza",
        tier: "D",
      }),
    ).rejects.toThrow("Someone else");
    await t.mutation(api.rooms.move, {
      ...access,
      session: "Alice",
      id: "Pizza",
      tier: "S",
      requireLease: true,
    });
    expect(
      (await t.query(api.presence.list, access)).find((p) => p.name === "Alice")
        ?.drag,
    ).toBeNull();
    expect((await t.query(api.rooms.get, access))?.items[0].tier).toBe("S");
  });
  it("expires abandoned locks and does not revive an old lease after reconnect", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.rooms.add, entry("Pizza"));
    await t.mutation(api.presence.update, person("Alice"));
    await t.mutation(api.presence.update, person("Bob"));
    await t.mutation(api.presence.beginDrag, {
      ...access,
      session: "Alice",
      id: "Pizza",
    });
    await t.run(async (ctx) => {
      const p = await ctx.db
        .query("presence")
        .filter((q) => q.eq(q.field("session"), "Alice"))
        .unique();
      await ctx.db.patch(p!._id, { seenAt: Date.now() - 11000 });
    });
    await t.mutation(api.presence.beginDrag, {
      ...access,
      session: "Bob",
      id: "Pizza",
    });
    await t.mutation(api.presence.update, person("Alice"));
    expect(
      (await t.query(api.presence.list, access)).find((p) => p.name === "Alice")
        ?.drag,
    ).toBeNull();
    await t.mutation(api.presence.endDrag, { ...access, session: "Bob" });
    await expect(
      t.mutation(api.rooms.move, {
        ...access,
        session: "Alice",
        id: "Pizza",
        tier: "S",
        requireLease: true,
      }),
    ).rejects.toThrow("expired");
  });
  it("cleans expired presence and removes the board when its last item is deleted", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.rooms.add, entry("Pizza"));
    await t.mutation(api.presence.update, person("Alice"));
    const id = await t.run(async (ctx) => {
      const p = await ctx.db.query("presence").unique();
      await ctx.db.patch(p!._id, { seenAt: Date.now() - 46000 });
      return p!._id;
    });
    await t.mutation(internal.presence.expire, { id });
    expect(await t.query(api.presence.list, access)).toHaveLength(0);
    await t.mutation(api.rooms.remove, { ...access, id: "Pizza" });
    expect(await t.query(api.rooms.get, access)).toBeNull();
  });
  it("stores imported images and deletes the file with its item", async () => {
    const t = convexTest(schema, modules);
    const imageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["test image"], { type: "image/png" })),
    );
    await t.mutation(api.rooms.add, { ...entry("Photo"), imageId });
    expect(
      (await t.query(api.rooms.get, access))?.items[0].imageUrl,
    ).toBeTruthy();
    await expect(
      t.mutation(api.rooms.add, { ...entry("Duplicate"), imageId }),
    ).rejects.toThrow("already in use");
    await t.mutation(api.rooms.remove, { ...access, id: "Photo" });
    expect(await t.run((ctx) => ctx.storage.get(imageId))).toBeNull();
  });
  it("rejects unsupported imported files", async () => {
    const t = convexTest(schema, modules);
    const imageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["<svg></svg>"], { type: "image/svg+xml" })),
    );
    await expect(
      t.mutation(api.rooms.add, { ...entry("Invalid"), imageId }),
    ).rejects.toThrow("Choose a PNG");
    expect(await t.query(api.rooms.get, access)).toBeNull();
  });
});

it("shares tier labels without changing ranks or losing concurrent edits", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.rooms.renameTier, {
    ...access,
    tier: "S",
    label: "Best",
  });
  expect(await t.query(api.rooms.get, access)).toBeNull();
  await t.mutation(api.rooms.add, {
    ...entry("Pizza"),
    tierLabels: { S: "Best" },
  });
  await t.mutation(api.rooms.move, {
    ...access,
    id: "Pizza",
    tier: "S",
    session: "Alice",
  });
  await Promise.all([
    t.mutation(api.rooms.renameTier, { ...access, tier: "A", label: "Good" }),
    t.mutation(api.rooms.renameTier, { ...access, tier: "B", label: "Okay" }),
  ]);
  const room = await t.query(api.rooms.get, access);
  expect(room?.tierLabels).toMatchObject({ S: "Best", A: "Good", B: "Okay" });
  expect(room?.items[0].tier).toBe("S");
  await expect(
    t.mutation(api.rooms.renameTier, {
      ...access,
      key: "b".repeat(64),
      tier: "S",
      label: "Wrong",
    }),
  ).rejects.toThrow();
});
