export const TIERS = ["S", "A", "B", "C", "D", "unranked"] as const;
export function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
export function validateDraft(value: unknown): {
  title: string;
  note: string;
  items: { id: string; label: string; tier: string }[];
} {
  if (!value || typeof value !== "object") throw new Error("Invalid AI draft.");
  const data = value as Record<string, unknown>;
  if (
    typeof data.title !== "string" ||
    !data.title.trim() ||
    data.title.length > 100 ||
    typeof data.note !== "string" ||
    data.note.length > 1000 ||
    !Array.isArray(data.items) ||
    data.items.length < 1 ||
    data.items.length > 40
  )
    throw new Error("Draft must have a title and 1–40 items.");
  const names = new Set<string>(),
    ids = new Set<string>();
  const items = data.items.map((raw: unknown) => {
    const item = raw as Record<string, unknown>;
    if (
      !item ||
      typeof item.id !== "string" ||
      item.id.length > 64 ||
      !item.id ||
      typeof item.label !== "string" ||
      !item.label.trim() ||
      item.label.length > 100 ||
      typeof item.tier !== "string" ||
      !TIERS.includes(item.tier as (typeof TIERS)[number])
    )
      throw new Error("Invalid draft item.");
    const name = normalizeName(item.label);
    if (names.has(name) || ids.has(item.id))
      throw new Error(
        "Draft contains duplicate items. Try a more specific prompt.",
      );
    names.add(name);
    ids.add(item.id);
    return { id: item.id, label: item.label.trim(), tier: item.tier };
  });
  return { title: data.title.trim(), note: data.note, items };
}
export function snapshot(
  room: { title: string; items: unknown[]; tierLabels?: unknown } | null,
) {
  return JSON.stringify(
    room
      ? {
          title: room.title,
          items: room.items,
          tierLabels: room.tierLabels ?? {},
        }
      : null,
  );
}
