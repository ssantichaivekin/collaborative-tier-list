import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

import { ImagePicker } from "./ImagePicker";
import { optimizeImage } from "./images";

type Access = { slug: string; key: string };
function newRoom(): Access {
  return {
    slug: crypto.randomUUID(),
    key: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
function openRoom(room: Access) {
  history.pushState(null, "", `/r/${room.slug}#key=${room.key}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
function message(e: unknown) {
  return (e instanceof Error ? e.message : String(e))
    .replace(/^.*?Uncaught ConvexError: /s, "")
    .split("\n")[0];
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.focus();
    return () => old?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="library-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Tab") {
            const nodes = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),textarea,select,a[href]",
              ),
            );
            const first = nodes[0],
              last = nodes[nodes.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === ref.current)
            ) {
              e.preventDefault();
              last?.focus();
            } else if (
              !e.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === ref.current)
            ) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="modal-top">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close preview"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function TemplateLibrary() {
  const [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [category, setCategory] = useState(""),
    [limit, setLimit] = useState(24),
    [selected, setSelected] = useState<Id<"templates"> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(id);
  }, [search]);
  const stats = useQuery(api.catalog.stats, {});
  const templates = useQuery(api.catalog.browse, {
    search: debounced,
    featured: false,
    category,
    limit,
  });
  const detail = useQuery(
    api.catalog.detail,
    selected ? { id: selected } : "skip",
  );
  const useTemplate = useMutation(api.catalog.useTemplate);
  const pendingRoom = useRef<{ templateId: string; room: Access } | null>(null);
  return (
    <>
      <div className="library-search">
        <Search size={15} />
        <input
          aria-label="Search templates"
          placeholder="Search templates"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(24);
          }}
        />
      </div>
      <div className="library-filters">
        <select
          aria-label="Template interest"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLimit(24);
          }}
        >
          <option value="">All interests</option>
          {[...(stats?.categoryList ?? [])]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({name, count}) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
        </select>
      </div>
      <p className="library-count">
        {stats?.total.toLocaleString() ?? "…"} templates
      </p>
      <div className="template-results">
        {templates === undefined ? (
          <p className="panel-note">Loading templates…</p>
        ) : templates.length === 0 ? (
          <p className="panel-note">No templates found.</p>
        ) : (
          templates.map((t) => (
            <button
              className="template-result"
              key={t.id}
              onClick={() => {
                setSelected(t.id);
                setError("");
              }}
            >
              <img src={t.coverUrl ?? undefined} alt="" loading="lazy" />
              <span>
                <strong>{t.title}</strong>
                <small>
                  {t.category} · {t.count} items
                </small>
              </span>
            </button>
          ))
        )}
      </div>
      {templates?.length === limit && limit < 1000 && (
        <button
          className="secondary add-button"
          onClick={() => setLimit((n) => Math.min(1000, n + 24))}
        >
          Show more
        </button>
      )}
      {selected && (
        <Modal
          title={detail?.title ?? "Template"}
          close={() => {
            if (!busy) setSelected(null);
          }}
        >
          {detail === undefined ? (
            <p>Loading…</p>
          ) : detail === null ? (
            <p className="panel-error">Template unavailable.</p>
          ) : (
            <>
              <p className="panel-note">
                {detail.title.replace(/ selection$/i, "")} to rank.{' '}
                <a
                  className="source-link"
                  href={detail.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  (Source)
                </a>
              </p>
              {error && (
                <p role="alert" className="panel-error">
                  {error}
                </p>
              )}
              <button
                className="primary add-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    if (pendingRoom.current?.templateId !== selected)
                      pendingRoom.current = { templateId: selected, room: newRoom() };
                    const target = pendingRoom.current.room;
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    try {
                      await Promise.race([
                        useTemplate({ ...target, templateId: selected }),
                        new Promise<never>((_, reject) => {
                          timer = setTimeout(() => reject(new Error("Connection is taking too long. Retry to open the same board.")), 12000);
                        }),
                      ]);
                    } finally { clearTimeout(timer); }
                    setBusy(false);
                    openRoom(target);
                  } catch (e) {
                    setError(message(e));
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Creating…" : "Use template"}
              </button>
              <div className="preview-grid">
                {detail.items.map((item, i) => (
                  <a
                    key={i}
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={`${item.label} — image source`}
                  >
                    <img src={item.imageUrl ?? undefined} alt={item.label} />
                    <span>{item.label}</span>
                  </a>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
export function AIPanel({ access, items, title, showNames }: {
  access: Access;
  items: { id: string; label: string; tier: string; imageUrl?: string | null }[];
  title: string;
  showNames: boolean;
}) {
  const promptKey = `tier-auto-prompt:${access.slug}`;
  const [prompt, setPrompt] = useState(() => {try{return localStorage.getItem(promptKey)??"";}catch{return "";}});
  useEffect(()=>{try{localStorage.setItem(promptKey,prompt);}catch{}},[promptKey,prompt]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draftId, setDraftId] = useState<Id<"aiDrafts"> | null>(null);
  const latest = useQuery(api.ai.latest,access);
  useEffect(()=>{if(latest && !draftId)setDraftId(latest);},[latest,draftId]);
  const progress = useQuery(api.imageProgress.list,draftId?{...access,id:draftId}:"skip");
  const undo=useMutation(api.ai.undo);
  const generate = useAction(api.ai.generate), apply = useMutation(api.ai.apply);
  const uploadUrl = useMutation(api.rooms.uploadUrl);
  const replaceImage = useMutation(api.ai.replacePreviewImage);
  const imageInput = useRef<HTMLInputElement>(null);
  const editingItem = useRef<string | null>(null);
  const [pickerItem,setPickerItem] = useState<string | null>(null);
  const chooseImage = (itemId: string) => {
    if (busy || draft?.applied || draft?.stale) return;
    editingItem.current = itemId;
    setPickerItem(itemId);
  };
  const draft = useQuery(api.ai.preview, draftId ? { ...access, id: draftId } : "skip");
  const added = draft?.items.filter(i => !items.some(old => old.id === i.id)) ?? [];
  const removed = draft ? items.filter(i => !draft.items.some(next => next.id === i.id)) : [];
  const changed = draft?.items.filter(i => {
    const old = items.find(old => old.id === i.id);
    return old && (old.label !== i.label || old.tier !== i.tier || old.imageUrl !== i.imageUrl);
  }) ?? [];
  const row = (i: typeof items[number], kind: string, previous?: typeof items[number]) => (
    <div className={`change-row change-${kind}`} key={`${kind}-${i.id}`}>
      {i.imageUrl && <button type="button" className="change-image-button" aria-label={`Change image for ${i.label}`} disabled={busy || draft?.stale || draft?.applied} onClick={() => chooseImage(i.id)}><img src={i.imageUrl} alt={i.label} /></button>}
      <div><strong>{i.label}</strong><small>{kind === "added" ? "Added" : kind === "removed" ? "Removed" : "Changed"}
        {previous && ` · ${previous.label}${previous.tier === "unranked" ? "" : ` (${previous.tier})`} → ${i.label}${i.tier === "unranked" ? "" : ` (${i.tier})`}`}
      </small></div>
    </div>
  );
  const tileGroup = (entries: typeof items, kind: "added" | "removed") => entries.length > 0 && (
    <section className={`change-tray change-${kind}`} aria-label={kind === "added" ? "Added items" : "Removed items"}>
      <div className="change-tray-heading">{kind === "added" ? "Added" : "Removed"} <span>{entries.length}</span></div>
      <div className="change-tiles">
        {entries.map(i => <div className="item change-tile" key={i.id} aria-label={i.label}
          role={kind === "added" ? "button" : undefined} tabIndex={kind === "added" ? 0 : undefined}
          onClick={() => { if (kind === "added") chooseImage(i.id); }}
          onKeyDown={e => { if (kind === "added" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); chooseImage(i.id); } }}>
          {i.imageUrl ? <img className={`item-image ${showNames ? "" : "image-only"}`} src={i.imageUrl} alt={i.label} draggable={false} /> : <div className="item-text">{i.label}</div>}
          {i.imageUrl && showNames && <span className="item-label">{i.label}</span>}
          <span className="item-tooltip" aria-hidden="true">{i.label}{kind === "added" ? " · Click to change image" : ""}</span>
        </div>)}
      </div>
    </section>
  );
  const imageProgress = !!progress?.length && <div className="image-progress" aria-label="Image search progress">{progress.map(i=><div key={i.id}><span>{i.label}</span>{i.state==='searching'?<small>Finding image…</small>:<><small role="status">{i.error ?? "Image not found."}</small><button className="quiet" onClick={()=>setPickerItem(i.id)}>Find images</button></>}</div>)}</div>;
  return <>
    {pickerItem && draft && <ImagePicker access={access} item={draft.items.find(i=>i.id===pickerItem)!} draftId={draft.applied ? undefined : draft.id} close={()=>setPickerItem(null)} />}
    <input ref={imageInput} type="file" className="visually-hidden" aria-label="Replace preview image" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
      onChange={async e => {
        const file=e.target.files?.[0], itemId=editingItem.current;
        e.target.value="";
        if(!file || !itemId || !draftId || busy)return;
        setBusy(true); setError("");
        try {
          if(file.size>8*1024*1024)throw new Error("Choose an image under 8 MB.");
          const blob=await optimizeImage(file);
          const response=await fetch(await uploadUrl(access),{method:"POST",headers:{"Content-Type":blob.type},body:blob,signal:AbortSignal.timeout(30000)});
          if(!response.ok)throw new Error("Image upload failed. Try again.");
          const {storageId}=await response.json();
          await replaceImage({...access,id:draftId,itemId,imageId:storageId});
        } catch(e) {setError(message(e));} finally {setBusy(false);}
      }} />
    <form onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError("");
      try {
        const id = await generate({ ...access, mode: "edit", prompt, ...(draftId ? {previousDraftId:draftId} : {}) });
        setDraftId(id);
        await apply({ ...access, id });
        setPrompt("");
      }
      catch (e) { setError(message(e)); }
      finally { setBusy(false); }
    }}>
      <textarea aria-label="Auto Edit prompt" placeholder={draftId ? "e.g. Add five more films, or remove the sequels" : "e.g. Create a tier list of 20 Studio Ghibli films, 30 popular anime, or Slay the Spire relics"}
        value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={2000} rows={5} />
      <button className="primary add-button" disabled={busy || !prompt.trim()}>
        {busy ? "Working…" : draftId ? "Update" : "Create list"}
      </button>
    </form>
    {draft?.canUndo && <button className="secondary add-button" disabled={busy} onClick={async()=>{try{await undo({...access,id:draft.id});}catch(e){setError(message(e));}}}>Undo last Auto Edit</button>}
    {error && <p role="alert" className="panel-error">{error}</p>}
    {draftId && draft === undefined && <p className="panel-note">Loading changes…</p>}
    {draftId && draft === null && <p className="panel-error">Draft unavailable. Preview again.</p>}
    {draft && !draft.applied && <section className="change-list" aria-label="Proposed changes">
      {draft.stale && <p role="alert" className="panel-error">The board changed. Preview a fresh draft before confirming.</p>}
      {draft.title !== title && <div className="change-row change-changed"><div><strong>Title</strong><small>{title} → {draft.title}</small></div></div>}
      {tileGroup(added, "added")}
      {imageProgress}
      {tileGroup(removed, "removed")}
      {changed.map(i => row(i, "changed", items.find(old => old.id === i.id)))}
      {!added.length && !removed.length && !changed.length && draft.title === title && <p className="panel-note">No changes proposed.</p>}
    </section>}
    {draft?.applied && imageProgress}
  </>;
}
