import {ImageCropper} from './ImageCropper';
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import {
  Check,
  ChevronDown,
  Copy,
  ImagePlus,
  Link,
  MousePointer2,
  Plus,
  Share2,
  Settings,
  X,
} from "lucide-react";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";

import { ImagePicker } from "./ImagePicker";
import { optimizeImage } from "./images";
import { TemplateLibrary, AIPanel } from "./Library";

const TIERS = ["S", "A", "B", "C", "D"];
const COLORS = [
  "#7463c7",
  "#d26e47",
  "#337e7b",
  "#c35883",
  "#4778b9",
  "#90802c",
];
type Item = {
  id: string;
  label: string;
  imageUrl?: string | null;
  tier: string;
};
type DragState = { id: string; x: number; y: number; tier: string };
function readName() {
  try {
    return (
      localStorage.getItem("tier-party-name") ||
      `Guest ${Math.floor(Math.random() * 900 + 100)}`
    );
  } catch {
    return "Guest";
  }
}
function roomLink() {
  if (location.pathname === "/") {
    const slug = crypto.randomUUID();
    const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    history.replaceState(null, "", `/r/${slug}#key=${key}`);
  }
  return {
    slug: location.pathname.split("/")[2] || "",
    key: new URLSearchParams(location.hash.slice(1)).get("key") || "",
  };
}

const session = crypto.randomUUID();
const color = COLORS[parseInt(session.slice(0, 2), 16) % COLORS.length];
function readable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/^.*?Uncaught ConvexError: /s, "")
      .split("\n")[0]
      .replace(/^\[CONVEX[^\]]*\]\s*/, "") ||
    "Something went wrong. Please try again."
  );
}
class ErrorBoundary extends Component<
  { children: ReactNode; panel?: boolean },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: readable(error) };
  }
  render() {
    if (this.state.error && this.props.panel) return (
      <div role="alert" className="panel-error">
        <p>This panel couldn’t load. You can still edit your board.</p>
        <button className="secondary" onClick={() => this.setState({ error: null })}>Retry panel</button>
      </div>
    );
    return this.state.error ? (
      <main className="setup">
        <div className="logo">Collaborative Tier List</div>
        <h1>We couldn’t open this room.</h1>
        <p>{this.state.error}</p>
        <p>
          {/key|share link/i.test(this.state.error)
            ? "Ask the room owner for the complete share link, including its key."
            : "Please reload to reconnect. Your saved list is unchanged."}
        </p>
        <button className="primary" onClick={() => location.reload()}>
          Reload
        </button>
        <a className="secondary" href="/">
          Start a new board{" "}
        </a>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const [access, setAccess] = useState(roomLink);
  useEffect(() => {
    const update = () => setAccess(roomLink());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);
  const valid = /^[a-f0-9-]{36}$/.test(access.slug) && /^[a-f0-9]{64}$/.test(access.key);
  return valid ? (
    <ErrorBoundary key={access.slug + access.key}>
      <Board access={access} />
    </ErrorBoundary>
  ) : (
    <main className="setup">
      <div className="logo">Collaborative Tier List</div>
      <h1>This link is missing its key.</h1>
      <p>Ask for the full share link to join this board.</p>
      <a className="primary" href="/">
        Create a new board{" "}
      </a>
    </main>
  );
}

function Board({ access }: { access: { slug: string; key: string } }) {
  const room = useQuery(api.rooms.get, access);
  const readOnly=room?.canEdit===false;
  const getViewKey=useMutation(api.rooms.viewKey);
  const [allowEdits,setAllowEdits]=useState(true);
  const [viewKey,setViewKey]=useState("");
  const [sharingBusy,setSharingBusy]=useState(false);
  const shareUrl=readOnly||allowEdits?location.href:viewKey?`${location.origin}/r/${access.slug}#key=${viewKey}`:"";

  const people = useQuery(api.presence.list, access) || [];
  const add = useMutation(api.rooms.add),
    move = useMutation(api.rooms.move).withOptimisticUpdate((store, args) => {
      const board = store.getQuery(api.rooms.get, access);
      if (!board) return;
      const moving = board.items.find((i) => i.id === args.id);
      if (!moving) return;
      const rest = board.items.filter((i) => i.id !== args.id);
      const before = rest.findIndex(
        (i) => i.id === args.beforeId && i.tier === args.tier,
      );
      let last = -1;
      rest.forEach((i, n) => {
        if (i.tier === args.tier) last = n;
      });
      rest.splice(
        before >= 0 ? before : last >= 0 ? last + 1 : rest.length,
        0,
        { ...moving, tier: args.tier },
      );
      store.setQuery(api.rooms.get, access, { ...board, items: rest });
    }),
    remove = useMutation(api.rooms.remove),
    rename = useMutation(api.rooms.rename),
    renameTier = useMutation(api.rooms.renameTier);
  const updatePresence = useMutation(api.presence.update),
    beginDrag = useMutation(api.presence.beginDrag),
    endDrag = useMutation(api.presence.endDrag),
    leave = useMutation(api.presence.leave);
  const getUploadUrl = useMutation(api.rooms.uploadUrl);
  const [pickerItem,setPickerItem] = useState<Item | null>(null);
  const suppressImageClick = useRef(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [cropImage,setCropImage]=useState<File|null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  useEffect(() => {
    if (!selectedImage) { setImagePreview(""); return; }
    const url = URL.createObjectURL(selectedImage);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);
  const connection = useConvexConnectionState();
  const [panelTab, setPanelTab] = useState<"items" | "templates" | "ai">(
    "templates",
  );
  const [name, setName] = useState(readName),
    [profile, setProfile] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [share, setShare] = useState(false),
    [copied, setCopied] = useState(false);
  const [title, setTitle] = useState("Untitled tier list"),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [localDrag, setLocalDrag] = useState<DragState | null>(null),
    [clock, setClock] = useState(Date.now());
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>({});
  const tierLabels = room?.tierLabels ?? draftLabels;
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("tier-list-theme") === "dark";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("tier-list-theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);
  const [showNames, setShowNames] = useState(() => {
    try { return localStorage.getItem("tier-list-show-names") === "true"; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("tier-list-show-names", String(showNames)); } catch {}
  }, [showNames]);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(event.target as Node)
      )
        settingsRef.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const titleFocused = useRef(false);
  const finishing = useRef(false);
  const grabOffset = useRef({ x: 0, y: 0 });
  const items = room?.items || [];
  const live = useRef({
    pointer: null as null | { x: number; y: number; zone?: string },
    tier: "",
    dirty: true,
  });
  const candidate = useRef<null | {
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    tier: string;
    requested: boolean;
    locked: boolean;
    cancelled?: boolean;
    promise?: Promise<boolean>;
  }>(null);
  const online = people.filter((p) => p.seenAt > clock - 45000);
  const others = online.filter((p) => p.session !== session);
  const count = Math.max(1, online.length);
  useEffect(() => {
    if (room && !titleFocused.current) setTitle(room.title);
  }, [room?.title]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if(readOnly || room===undefined)return;
    let sending = false,
      last = 0,
      lastPointer = 0,
      active = true;
    live.current.dirty = true;
    const flush = () => {
      if (
        live.current.pointer &&
        !candidate.current &&
        Date.now() - lastPointer > 10000
      ) {
        live.current.pointer = null;
        live.current.dirty = true;
      }
      if (
        sending ||
        !active ||
        (!live.current.dirty &&
          Date.now() - last < (candidate.current?.locked ? 2500 : 12000))
      )
        return;
      sending = true;
      live.current.dirty = false;
      last = Date.now();
      updatePresence({
        ...access,
        session,
        name,
        color,
        pointer: live.current.pointer,
        tier: live.current.tier,
      })
        .catch(() => {
          live.current.dirty = true;
        })
        .finally(() => {
          sending = false;
        });
    };
    const track = (event: PointerEvent) => {
      if (document.hidden || !document.hasFocus()) return;
      lastPointer = Date.now();
      const zone = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-drop-tier]");
      const rect = zone?.getBoundingClientRect();
      live.current.pointer =
        zone && rect
          ? {
              x: (event.clientX - rect.left) / rect.width,
              y: (event.clientY - rect.top) / rect.height,
              zone: zone.dataset.dropTier,
            }
          : {
              x: event.clientX / innerWidth,
              y: event.clientY / innerHeight,
            };
      live.current.dirty = true;
    };
    const hide = () => {
      live.current.pointer = null;
      live.current.dirty = true;
      flush();
    };
    const out = (event: PointerEvent) => {
      if (!event.relatedTarget) hide();
    };
    const visibility = () => {
      if (document.hidden) hide();
      else {
        live.current.dirty = true;
        flush();
      }
    };
    window.addEventListener("pointermove", track);
    document.addEventListener("pointerout", out);
    window.addEventListener("blur", hide);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(flush, 80);
    flush();
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("pointermove", track);
      document.removeEventListener("pointerout", out);
      window.removeEventListener("blur", hide);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
      void leave({ ...access, session }).catch(() => {});
    };
  }, [name, updatePresence, leave, readOnly, room===undefined]);
  const report = useCallback(
    (error: unknown) => setNotice(readable(error)),
    [],
  );
  useEffect(() => {
    const target = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y);
      return {
        tier:
          element?.closest<HTMLElement>("[data-drop-tier]")?.dataset.dropTier ||
          "",
        beforeId:
          element?.closest<HTMLElement>("[data-item-id]")?.dataset.itemId,
      };
    };
    const track = (event: PointerEvent) => {
      const current = candidate.current;
      if (!current) return;
      current.x = event.clientX;
      current.y = event.clientY;
      current.tier = target(current.x, current.y).tier;
      live.current.tier = current.tier;
      live.current.dirty = true;
      if (
        !current.requested &&
        Math.hypot(current.x - current.startX, current.y - current.startY) > 6
      ) {
        current.requested = true;
        current.promise = beginDrag({ ...access, session, id: current.id })
          .then(() => {
            if (current.cancelled) {
              void endDrag({ ...access, session });
              return false;
            }
            current.locked = true;
            if (candidate.current === current)
              setLocalDrag({
                id: current.id,
                x: current.x,
                y: current.y,
                tier: current.tier,
              });
            return true;
          })
          .catch((error) => {
            if (candidate.current === current) candidate.current = null;
            setLocalDrag(null);
            report(error);
            return false;
          });
      }
      if (current.requested)
        setLocalDrag({
          id: current.id,
          x: current.x,
          y: current.y,
          tier: current.tier,
        });
    };
    const finish = (event: PointerEvent) => {
      const current = candidate.current;
      candidate.current = null;
      setLocalDrag(null);
      live.current.tier = "";
      live.current.dirty = true;
      suppressImageClick.current = Boolean(current?.requested);
      if (!current?.requested) return;
      const drop = target(event.clientX, event.clientY);
      finishing.current = true;
      void Promise.resolve(current.promise)
        .then((acquired) => {
          if (!acquired) return;
          return drop.tier
            ? move({
                ...access,
                session,
                id: current.id,
                tier: drop.tier,
                requireLease: true,
                beforeId:
                  drop.beforeId === current.id ? undefined : drop.beforeId,
              })
            : Promise.resolve();
        })
        .catch(report)
        .finally(async () => {
          try {
            await endDrag({ ...access, session });
          } catch (error) {
            report(error);
          }
          finishing.current = false;
        });
    };
    const cancel = () => {
      if (candidate.current) candidate.current.cancelled = true;
      candidate.current = null;
      setLocalDrag(null);
      live.current.tier = "";
      void endDrag({ ...access, session }).catch(() => {});
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", track);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [beginDrag, endDrag, move, report]);
  function startDrag(event: ReactPointerEvent, id: string) {
    if(readOnly)return;
    if (
      finishing.current ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button,select")
    )
      return;
    event.preventDefault();
    suppressImageClick.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    grabOffset.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    candidate.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      tier: "",
      requested: false,
      locked: false,
    };
  }
  async function addItem() {
    if (busy || !text.trim()) return;
    if (items.length >= 200) { setNotice("A board can hold up to 200 items."); return; }
    setBusy(true);
    try {
      let imageId: Id<"_storage"> | undefined;
      if (selectedImage) {
        const optimized = await optimizeImage(selectedImage);
        const url = await getUploadUrl(access);
        const response = await fetch(url, {
          method: "POST", headers: { "Content-Type": optimized.type }, body: optimized,
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error("Image upload failed. Please try again.");
        imageId = (await response.json()).storageId;
      }
      await add({ ...access, id: crypto.randomUUID(), label: text.trim(), title, tierLabels, ...(imageId ? { imageId } : {}) });
      setText(""); setSelectedImage(null);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setNotice("Select and copy the room link below.");
    }
  }
  async function updateTitle() {
    titleFocused.current = false;
    if(readOnly)return;
    const value = title.trim() || "Untitled tier list";
    setTitle(value);
    if (room && value !== room.title)
      try {
        await rename({ ...access, title: value });
      } catch (error) {
        report(error);
      }
  }
  const ranked = items.filter((i) => i.tier !== "unranked").length;
  function selectImage(file: File | undefined) {
    if (!file || busy) return;
    if (file.size > 8 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(file.type)) {
      setNotice("Choose a PNG, JPG, WebP, GIF, or AVIF image under 8 MB.");
      return;
    }
    setCropImage(file);
    if (!text.trim()) setText(file.name.replace(/\.[^.]+$/, "").slice(0, 100));
  }
  function card(item: Item) {
    const collaborator = others.find(
      (p) => p.drag?.id === item.id && p.seenAt > clock - 10000,
    );
    return (
      <div
        className={`item ${localDrag?.id === item.id ? "drag-source" : ""} ${collaborator ? "held" : ""}`}
        key={item.id}
        data-item-id={item.id}
        onPointerDown={(e) => startDrag(e, item.id)}
        onClick={e=>{if(!readOnly&&!(e.target as HTMLElement).closest('button')&&!suppressImageClick.current)setPickerItem(item);}}
        onKeyDown={e=>{if(!readOnly&&e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setPickerItem(item);}}}
        tabIndex={0}
        aria-label={readOnly?item.label:`${item.label}. Click to change image`}
        style={collaborator ? { borderColor: collaborator.color } : undefined}
      >
        {collaborator && (
          <span className="held-by" style={{ background: collaborator.color }}>
            {collaborator.name}
          </span>
        )}
        {tileContent(item)}
        {item.imageUrl && <span className="item-tooltip" aria-hidden="true">{item.label}</span>}
        <div className="item-tools" hidden={readOnly}>
          <button
            title={`Delete ${item.label}`}
            aria-label={`Delete ${item.label}`}
            onClick={() =>
              void remove({ ...access, id: item.id }).catch(report)
            }
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }
  function tileContent(item: Item) {
    return (
      <>
        {" "}
        {item.imageUrl ? (
          <img
            className={`item-image ${showNames ? "" : "image-only"}`}
            src={item.imageUrl}
            alt={item.label}
            draggable={false}
          />
        ) : (
          <div className="item-text">{item.label}</div>
        )}
        {item.imageUrl && showNames && (
          <span className="item-label">
            {item.label}
          </span>
        )}
      </>
    );
  }
  function ghost(id: string) {
    const item = items.find((i) => i.id === id);
    return item ? tileContent(item) : null;
  }
  return (
    <>
      <header className="topbar">
        <a className="logo" href="/">
          Collaborative Tier List
        </a>
        <div className="top-actions">
          <div className="people-wrap">
            <button
              className="presence-button"
              onClick={() => setProfile(!profile)}
              aria-expanded={profile}
              aria-label="People online and your name"
            >
              <span className="avatar-stack">
                {[
                  ...online.filter((p) => p.session !== session).slice(0, 2),
                  { session, name, color },
                ].map((p) => (
                  <span
                    key={p.session}
                    className="avatar"
                    style={{ background: p.color }}
                    title={p.name}
                  >
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                ))}
              </span>
              <span>{count} online</span>
              <ChevronDown size={13} />
            </button>
            {profile && (
              <div className="profile popover">
                <strong>Online</strong>
                {online
                  .filter((p) => p.session !== session)
                  .map((p) => (
                    <div className="person" key={p.session}>
                      <span
                        className="person-dot"
                        style={{ background: p.color }}
                      />
                      {p.name}
                    </div>
                  ))}
                <label htmlFor="your-name">Your name</label>
                <input
                  id="your-name"
                  value={name}
                  maxLength={40}
                  onChange={(e) => {
                    setName(e.target.value);
                    try {
                      localStorage.setItem("tier-party-name", e.target.value);
                    } catch {}
                  }}
                  onBlur={() => {
                    if (!name.trim()) setName("Guest");
                  }}
                />
              </div>
            )}
          </div>
          <details
            className="settings"
            ref={settingsRef}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.open = false;
                e.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label="Settings" title="Settings">
              <Settings size={17} />
              <ChevronDown size={12} />
            </summary>
            <div className="popover settings-popover">
              <label>
                <span>Enable name</span>
                <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
              </label>
              <label>
                <span>Dark mode</span>
                <input
                  type="checkbox"
                  checked={dark}
                  onChange={(e) => setDark(e.target.checked)}
                />
              </label>
            </div>
          </details>
          <button className="primary" onClick={() => {setAllowEdits(true);setCopied(false);setShare(true);}}>
            <Share2 size={15} /> Share
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="heading-row">
          <input
            readOnly={readOnly}
            aria-label="Board title"
            className="board-title"
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => (titleFocused.current = true)}
            onBlur={() => void updateTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <div className="board-actions">
            <span className="room-status">
              <span
                className={`status-dot ${connection.isWebSocketConnected ? "" : "offline"}`}
              />
              {!connection.isWebSocketConnected
                ? "Reconnecting"
                : room
                  ? "Saved"
                  : "Empty"}
            </span>
            <a className="secondary" href="/">
              <Plus size={14} /> New list
            </a>
          </div>
        </div>
        <div className={`editor-layout ${sidebar && !readOnly ? "" : "panel-hidden"}`}>
          <section className="board-column" aria-label="Tier list editor">
            <div className="tier-board">
              {TIERS.map((tier) => {
                const here = items.filter((i) => i.tier === tier),
                  remote = others.find(
                    (p) => p.drag?.tier === tier && p.seenAt > clock - 10000,
                  );
                return (
                  <div
                    key={tier}
                    className={`tier-row tier-${tier} ${localDrag?.tier === tier || remote ? "drop-active" : ""}`}
                    data-drop-tier={tier}
                    style={
                      remote
                        ? ({
                            "--drop-color": remote.color,
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    <div className="tier-label">
                      {readOnly ? <strong>{tierLabels[tier] || tier}</strong> : <TierLabel
                        tier={tier}
                        label={tierLabels[tier] || tier}
                        onSave={(label) => {
                          setDraftLabels((current) => ({
                            ...current,
                            [tier]: label,
                          }));
                          if (room)
                            void renameTier({ ...access, tier, label }).catch(
                              report,
                            );
                        }}
                      />}
                    </div>
                    <div className="tier-content">{here.map(card)}</div>
                  </div>
                );
              })}
            </div>
            <div className="unranked-heading">
              <strong>
                Unranked <span>{items.length - ranked}</span>
              </strong>

            </div>
            <div
              className={`unranked ${localDrag?.tier === "unranked" ? "drop-active" : ""}`}
              data-drop-tier="unranked"
            >
              {items.filter((i) => i.tier === "unranked").map(card)}
              {!items.length && !readOnly && (
                <button
                  className="empty-add"
                  onClick={() => {
                    setSidebar(true);
                    setPanelTab("items");
                    setTimeout(
                      () => document.getElementById("item-input")?.focus(),
                      0,
                    );
                  }}
                >
                  <Plus size={16} /> Add items
                </button>
              )}
            </div>
          </section>
          {sidebar && !readOnly && (
            <aside className="item-panel">
              <div className="panel-heading">
                <h2>
                  {panelTab === "templates"
                    ? "Templates"
                    : panelTab === "ai"
                      ? "Auto Edit"
                      : "Add Items"}
                </h2>
                <button
                  aria-label="Hide item panel"
                  className="icon-button"
                  onClick={() => setSidebar(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="panel-tabs" aria-label="Item tools">
                {(["items", "templates", "ai"] as const).map((tab) => (
                  <button
                    key={tab}
                    aria-pressed={panelTab === tab}
                    className={panelTab === tab ? "selected" : ""}
                    onClick={() => setPanelTab(tab)}
                  >
                    {tab === "ai"
                      ? "Auto Edit"
                      : tab === "items"
                        ? "Add Items"
                        : "Templates"}
                  </button>
                ))}
              </div>
              {panelTab === "templates" ? (
                <ErrorBoundary panel><TemplateLibrary /></ErrorBoundary>
              ) : panelTab === "ai" ? (
                <ErrorBoundary panel><AIPanel access={access} items={items} title={title} showNames={showNames} /></ErrorBoundary>
              ) : (
                <>
                  <form onSubmit={(e) => { e.preventDefault(); void addItem(); }}>
                    <div className="item-composer">
                      <div className="image-picker">
                        <button type="button" className="image-picker-preview" disabled={busy}
                          aria-label={selectedImage ? "Change image" : "Choose image"}
                          onClick={() => uploadInput.current?.click()}>
                          {imagePreview ? <img src={imagePreview} alt="Selected item" /> : <><ImagePlus size={26} /><span>Choose image</span></>}
                        </button>
                        {selectedImage && <button type="button" className="quiet" disabled={busy} onClick={()=>setCropImage(selectedImage)}>Crop</button>}
                        {selectedImage && <button type="button" className="image-picker-remove" aria-label="Remove selected image" disabled={busy} onClick={() => setSelectedImage(null)}><X size={14} /></button>}
                      </div>
                      <input id="item-input" aria-label="Item name" placeholder="e.g. Spirited Away"
                        value={text} onChange={(e) => setText(e.target.value)} maxLength={100} disabled={busy} />
                    </div>
                    <input ref={uploadInput} className="visually-hidden" type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                      onChange={(e) => { selectImage(e.target.files?.[0]); e.target.value = ""; }} aria-label="Choose item image" />
                    <button className="primary add-button" type="submit" disabled={!text.trim() || busy}>
                      <Plus size={15} />{busy ? "Adding…" : "Add"}
                    </button>
                  </form>
                </>
              )}
            </aside>
          )}
        </div>
      </main>
      {others
        .filter((p) => p.pointer && p.seenAt > clock - 15000)
        .map((person) => {
          const held =
            person.drag && person.seenAt > clock - 10000
              ? items.find((i) => i.id === person.drag?.id)
              : null;
          return (
            <RemoteCursor
              key={person.session}
              pointer={person.pointer!}
              name={person.name}
              color={person.color}
            >
              {held && (
                <div className="item drag-ghost remote-ghost">
                  {ghost(held.id)}
                </div>
              )}
            </RemoteCursor>
          );
        })}
      {localDrag && (
        <div
          className="item drag-ghost local-ghost"
          style={{
            left: localDrag.x - grabOffset.current.x,
            top: localDrag.y - grabOffset.current.y,
          }}
        >
          {ghost(localDrag.id)}
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {room === undefined && (
        <div className="loading-strip" role="status">
          Connecting…
        </div>
      )}
      {cropImage && <ImageCropper source={cropImage} onCancel={()=>setCropImage(null)} onSave={file=>{setSelectedImage(file);setCropImage(null);}}/>}
      {pickerItem && <ImagePicker access={access} item={pickerItem} close={()=>setPickerItem(null)} />}
      {share && (
        <div className="modal-backdrop" onClick={() => setShare(false)}>
          <section
            className="share-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShare(false);
            }}
          >
            <div className="modal-top">
              <h2 id="share-title">Share list</h2>
              <button
                className="icon-button"
                aria-label="Close sharing"
                onClick={() => setShare(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label><input type="checkbox" checked={!readOnly && allowEdits} disabled={readOnly||sharingBusy||!room} onChange={async e=>{
                const checked=e.target.checked;setAllowEdits(checked);setCopied(false);
                if(!checked&&!viewKey){setSharingBusy(true);try{setViewKey(await getViewKey(access));}catch(error){setAllowEdits(true);report(error);}finally{setSharingBusy(false);}}
              }}/> Allow edits</label>
            {!room && <p>Add an item to enable view-only sharing.</p>}
            <div className="share-link">
              <Link size={16} />
              <input
                aria-label="Room link"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
              />
            </div>
            <button
              autoFocus
              className="primary add-button"
              disabled={sharingBusy||!shareUrl}
              onClick={() => void copy()}
            >
              {copied ? (
                <>
                  <Check size={16} /> Copied
                </>
              ) : (
                <>
                  <Copy size={16} /> Copy link
                </>
              )}
            </button>
          </section>
        </div>
      )}
    </>
  );
}

function RemoteCursor({
  pointer,
  name,
  color,
  children,
}: {
  pointer: { x: number; y: number; zone?: string };
  name: string;
  color: string;
  children: ReactNode;
}) {
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const positionCursor = () => {
      const zone = pointer.zone
        ? document.querySelector<HTMLElement>(
            `[data-drop-tier="${CSS.escape(pointer.zone)}"]`,
          )
        : null;
      const rect = zone?.getBoundingClientRect();
      setPosition(
        rect
          ? {
              left: rect.left + rect.width * pointer.x,
              top: rect.top + rect.height * pointer.y,
            }
          : { left: innerWidth * pointer.x, top: innerHeight * pointer.y },
      );
    };
    positionCursor();
    const observer = new ResizeObserver(positionCursor);
    observer.observe(document.body);
    window.addEventListener("scroll", positionCursor, true);
    window.addEventListener("resize", positionCursor);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", positionCursor, true);
      window.removeEventListener("resize", positionCursor);
    };
  }, [pointer.x, pointer.y, pointer.zone]);
  return (
    <div className="remote-cursor" style={{ ...position, color }}>
      <MousePointer2 size={22} fill={color} stroke="white" strokeWidth={1.5} />
      <span className="cursor-name" style={{ background: color }}>
        {name}
      </span>
      {children}
    </div>
  );
}

function TierLabel({
  tier,
  label,
  onSave,
}: {
  tier: string;
  label: string;
  onSave: (label: string) => void;
}) {
  const [value, setValue] = useState(label);
  const focused = useRef(false);
  const cancel = useRef(false);
  useEffect(() => {
    if (!focused.current) setValue(label);
  }, [label]);
  return (
    <textarea
      aria-label={`Edit tier ${tier}`}
      title="Edit tier name"
      rows={2}
      maxLength={40}
      value={value}
      onFocus={() => {
        focused.current = true;
        cancel.current = false;
      }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        focused.current = false;
        const next = cancel.current ? label : value.trim() || tier;
        setValue(next);
        if (next !== label) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          cancel.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
