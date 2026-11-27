import { BLOCK_TYPES, MAX_BLOCKS, renderPage, type Block, type BlockType, type PageContent, type PublishIssue } from "@ai/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type PageDetail } from "../api";
import { Icon } from "../components/Icon";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

type AnyBlock = Block & Record<string, any>;
type Img = { id: string; mime: string; bytes: number };
const imgUrl = (id: string) => `/api/pages/img/${id}`;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reduz a foto no navegador (lado maior 1400 px, WebP ou JPEG) até caber no limite do servidor. */
export async function shrinkImage(file: File, maxBytes: number): Promise<{ mime: string; data: string }> {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  for (let round = 0; round < 4; round++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.72, 0.58, 0.45]) {
      for (const type of ["image/webp", "image/jpeg"]) {
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
        if (blob && blob.type === type && blob.size <= maxBytes) {
          const data = await new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
            fr.onerror = () => rej(fr.error);
            fr.readAsDataURL(blob);
          });
          return { mime: type, data };
        }
      }
    }
    scale *= 0.7;
  }
  throw new Error("too_large");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function ImagePicker({ images, value, multi, onChange }: { images: Img[]; value: string[]; multi?: boolean; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  if (images.length === 0) return <p className="text-xs text-slate-500">{t("pages.ed.noImages")}</p>;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("pages.ed.chooseImage")}>
      {images.map((im) => {
        const on = value.includes(im.id);
        return (
          <li key={im.id}>
            <button type="button" aria-pressed={on} onClick={() => onChange(multi ? (on ? value.filter((x) => x !== im.id) : [...value, im.id]) : on ? [] : [im.id])}
              className={`h-16 w-16 overflow-hidden rounded-lg ring-2 transition ${on ? "ring-indigo-500" : "ring-transparent hover:ring-slate-300"}`}>
              <img src={imgUrl(im.id)} alt="" className="h-full w-full object-cover" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ItemsEditor({ items, fields, max, onChange }: { items: Record<string, string>[]; fields: [string, MessageKey, boolean?][]; max: number; onChange: (v: Record<string, string>[]) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          {fields.map(([k, label, long]) => (
            <Field key={k} label={t(label)}>
              {long ? (
                <textarea className="input min-h-16" value={it[k] ?? ""} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
              ) : (
                <input className="input" value={it[k] ?? ""} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
              )}
            </Field>
          ))}
          {items.length > 1 && <button type="button" className="text-xs font-semibold text-rose-700 hover:underline" onClick={() => onChange(items.filter((_, j) => j !== i))}>{t("pages.ed.removeItem")}</button>}
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="btn-secondary" onClick={() => onChange([...items, Object.fromEntries(fields.map(([k]) => [k, ""]))])}>
          <Icon name="plus" /> {t("pages.ed.addItem")}
        </button>
      )}
    </div>
  );
}

function BlockForm({ b, images, set }: { b: AnyBlock; images: Img[]; set: (patch: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const text = (k: string, label: MessageKey, long = false, hint?: MessageKey) => (
    <Field label={t(label)} key={k}>
      {long ? <textarea className="input min-h-24" value={b[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} /> : <input className="input" value={b[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} />}
      {hint && <span className="mt-1 block text-xs text-slate-500">{t(hint)}</span>}
    </Field>
  );
  const cta = [text("ctaLabel", "pages.f.ctaLabel"), text("ctaUrl", "pages.f.ctaUrl", false, "pages.f.ctaUrlHint")];
  switch (b.type) {
    case "hero":
      return (
        <div className="space-y-3">
          {text("badge", "pages.f.badge")}{text("headline", "pages.f.headline")}{text("subheadline", "pages.f.subheadline", true)}{cta}
          <div><span className="label">{t("pages.f.image")}</span><ImagePicker images={images} value={b.imageId ? [b.imageId] : []} onChange={(v) => set({ imageId: v[0] ?? null })} /></div>
        </div>
      );
    case "benefits": case "steps":
      return (
        <div className="space-y-3">
          {text("title", "pages.f.blockTitle")}
          <ItemsEditor items={b.items} max={b.type === "steps" ? 5 : 6} fields={[["title", "pages.f.itemTitle"], ["text", "pages.f.itemText", true]]} onChange={(items) => set({ items })} />
        </div>
      );
    case "gallery":
      return (
        <div className="space-y-3">
          {text("title", "pages.f.blockTitle")}
          <ImagePicker images={images} multi value={b.imageIds} onChange={(v) => set({ imageIds: v.slice(0, 6) })} />
        </div>
      );
    case "text":
      return <div className="space-y-3">{text("title", "pages.f.blockTitle")}{text("body", "pages.f.body", true)}</div>;
    case "price":
      return (
        <div className="space-y-3">
          {text("title", "pages.f.blockTitle")}{text("productName", "pages.f.productName")}{text("price", "pages.f.price")}{text("note", "pages.f.note")}
          <Field label={t("pages.f.bullets")}>
            <textarea className="input min-h-20" value={(b.bullets as string[]).join("\n")} onChange={(e) => set({ bullets: e.target.value.split("\n").slice(0, 8) })} />
          </Field>
          {cta}
        </div>
      );
    case "testimonials":
      return (
        <div className="space-y-3">
          {text("title", "pages.f.blockTitle")}
          <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <input type="checkbox" className="mt-1" checked={!!b.confirmedReal} onChange={(e) => set({ confirmedReal: e.target.checked })} />
            <span>{t("pages.f.confirmedReal")}</span>
          </label>
          <ItemsEditor items={b.items} max={6} fields={[["name", "pages.f.personName"], ["text", "pages.f.quote", true]]} onChange={(items) => set({ items })} />
        </div>
      );
    case "faq":
      return (
        <div className="space-y-3">
          {text("title", "pages.f.blockTitle")}
          <ItemsEditor items={b.items} max={8} fields={[["q", "pages.f.question"], ["a", "pages.f.answer", true]]} onChange={(items) => set({ items })} />
        </div>
      );
    case "cta":
      return <div className="space-y-3">{text("headline", "pages.f.headline")}{text("text", "pages.f.body", true)}{cta}</div>;
  }
}

const newId = () => `b${Math.random().toString(36).slice(2, 8)}`;
function blank(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "hero": return { id, type, badge: "", headline: "", subheadline: "", ctaLabel: "", ctaUrl: "", imageId: null };
    case "benefits": return { id, type, title: "", items: [{ title: "", text: "" }] };
    case "steps": return { id, type, title: "", items: [{ title: "", text: "" }] };
    case "gallery": return { id, type, title: "", imageIds: [] };
    case "text": return { id, type, title: "", body: "" };
    case "price": return { id, type, title: "", productName: "", price: "", note: "", bullets: [], ctaLabel: "", ctaUrl: "" };
    case "testimonials": return { id, type, title: "", confirmedReal: false, items: [{ name: "", text: "" }] };
    case "faq": return { id, type, title: "", items: [{ q: "", a: "" }] };
    case "cta": return { id, type, headline: "", text: "", ctaLabel: "", ctaUrl: "" };
  }
}

export function PageEditor() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [page, setPage] = useState<PageDetail | null>(null);
  const [content, setContent] = useState<PageContent | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [images, setImages] = useState<Img[]>([]);
  const [issues, setIssues] = useState<PublishIssue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<BlockType>("text");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);

  const load = useCallback(async () => {
    try {
      const p = await api.pageGet(id);
      setPage(p);
      setContent(p.content);
      setTitle(p.title);
      setSlug(p.slug);
      setImages(p.images);
      setIssues(p.issues);
      setOpen(p.content.blocks[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? t("pages.ed.notFound") : errorMessage(e, t));
    }
  }, [id, t]);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const touch = () => { setDirty(true); setMsg(""); };
  const edit = (fn: (c: PageContent) => PageContent) => { setContent((c) => (c ? fn(c) : c)); touch(); };
  const setBlock = (i: number, patch: Record<string, unknown>) => edit((c) => ({ ...c, blocks: c.blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as Block) : b)) }));
  const move = (i: number, d: -1 | 1) => edit((c) => {
    const bl = [...c.blocks];
    const j = i + d;
    if (j < 0 || j >= bl.length) return c;
    [bl[i], bl[j]] = [bl[j]!, bl[i]!];
    return { ...c, blocks: bl };
  });

  const save = useCallback(async (): Promise<boolean> => {
    if (!content || !page) return false;
    if (!SLUG_RE.test(slug) || slug.length < 3 || slug === "img") { setError(t("pages.ed.slugInvalid")); return false; }
    setSaving(true);
    setError("");
    try {
      const r = await api.pageSave(page.id, { title, ...(slug !== page.slug ? { slug } : {}), content });
      setIssues(r.issues ?? []);
      setPage((p) => (p ? { ...p, title, slug, status: r.unpublished ? "draft" : p.status } : p));
      setDirty(false);
      setMsg(r.unpublished ? t("pages.ed.autoUnpublished") : t("pages.ed.saved"));
      return true;
    } catch (e) {
      setError(e instanceof ApiError && e.code === "slug_taken" ? t("pages.ed.slugTaken") : errorMessage(e, t));
      return false;
    } finally {
      setSaving(false);
    }
  }, [content, page, slug, title, t]);
  saveRef.current = save;

  // Salva sozinho 1,5 s depois da última alteração.
  useEffect(() => {
    if (!dirty) return;
    const h = setTimeout(() => { saveRef.current().catch(() => undefined); }, 1500);
    return () => clearTimeout(h);
  }, [dirty, content, title, slug]);

  async function upload(files: FileList | null) {
    if (!files || !page) return;
    setUploading(true);
    setError("");
    try {
      for (const f of Array.from(files)) {
        if (!/^image\/(jpeg|png|webp|gif|heic|avif)$/.test(f.type)) { setError(t("pages.ed.notImage")); continue; }
        const small = await shrinkImage(f, page.limits.maxImageBytes - 20_000);
        const r = await api.pageImageUpload(page.id, small.mime, small.data);
        setImages((cur) => [...cur, { id: r.id, mime: r.mime, bytes: r.bytes }]);
      }
    } catch (e) {
      setError(e instanceof Error && e.message === "too_large" ? t("err.image_too_large") : errorMessage(e, t));
    } finally {
      setUploading(false);
    }
  }
  async function removeImage(imId: string) {
    if (!page) return;
    try {
      await api.pageImageDelete(page.id, imId);
      setImages((cur) => cur.filter((x) => x.id !== imId));
      setContent((c) => c && { ...c, blocks: c.blocks.map((b) => (b.type === "hero" && b.imageId === imId ? { ...b, imageId: null } : b.type === "gallery" ? { ...b, imageIds: b.imageIds.filter((x) => x !== imId) } : b)) });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }
  async function publish() {
    if (!page) return;
    setError("");
    if (dirty && !(await save())) return;
    try {
      await api.pagePublish(page.id);
      setPage({ ...page, status: "published" });
      setMsg(t("pages.ed.nowLive"));
    } catch (e) {
      if (e instanceof ApiError && e.code === "publish_blocked") setIssues(e.data.issues as PublishIssue[]);
      setError(e instanceof ApiError && e.code === "publish_blocked" ? t("pages.ed.fixFirst") : errorMessage(e, t));
    }
  }
  async function unpublish() {
    if (!page) return;
    try {
      await api.pageUnpublish(page.id);
      setPage({ ...page, status: "draft" });
      setMsg(t("pages.ed.nowDraft"));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }

  const srcDoc = useMemo(() => (content ? renderPage({ title, content }, { imgSrc: imgUrl }) : ""), [content, title]);
  const fullUrl = page ? `${window.location.origin}/p/${page.slug}` : "";

  if (!page || !content) {
    return error ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p> : <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/pages" className="btn-secondary"><Icon name="arrowLeft" />{t("pages.ed.back")}</Link>
        <input aria-label={t("pages.ed.title")} className="input min-w-0 flex-1 text-base font-semibold" maxLength={100} value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} />
        <span className="text-xs text-slate-500" role="status">{saving ? t("pages.ed.saving") : dirty ? t("pages.ed.unsaved") : msg}</span>
        <button className="btn-secondary" disabled={saving || !dirty} onClick={() => { save().catch(() => undefined); }}>{t("pages.ed.save")}</button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,34rem)_1fr]">
        <div className="space-y-5">
          <section className="card space-y-3" aria-labelledby="pub-h">
            <div className="flex items-center justify-between gap-2">
              <h2 id="pub-h" className="font-semibold text-slate-900">{t("pages.ed.publishTitle")}</h2>
              <span className={`chip ${page.status === "published" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>{t(`pages.status.${page.status}` as MessageKey)}</span>
            </div>
            {issues.length === 0 ? <p className="text-sm text-emerald-700">{t("pages.ed.ready")}</p> : (
              <ul className="space-y-1 text-sm text-amber-900">
                {issues.map((i) => <li key={i} className="flex gap-2"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />{t(`pages.issue.${i}` as MessageKey)}</li>)}
              </ul>
            )}
            <Field label={t("pages.ed.slug")}>
              <div className="flex items-center gap-1 text-sm text-slate-500"><span className="shrink-0">/p/</span><input className="input" value={slug} maxLength={60} onChange={(e) => { setSlug(e.target.value.toLowerCase()); touch(); }} /></div>
            </Field>
            <div className="flex flex-wrap gap-2">
              {page.status === "published" ? (
                <>
                  <button className="btn-secondary" onClick={unpublish}>{t("pages.ed.unpublish")}</button>
                  <a className="btn-secondary" href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer"><Icon name="external" />{t("pages.ed.openLive")}</a>
                  <button className="btn-secondary" onClick={() => { navigator.clipboard?.writeText(fullUrl).then(() => setCopied(true)).catch(() => undefined); }}><Icon name="copy" />{copied ? t("pages.ed.copied") : t("pages.ed.copy")}</button>
                </>
              ) : (
                <button className="btn" disabled={saving} onClick={publish}>{t("pages.ed.publish")}</button>
              )}
            </div>
          </section>

          <section className="card space-y-3" aria-labelledby="set-h">
            <h2 id="set-h" className="font-semibold text-slate-900">{t("pages.ed.settings")}</h2>
            <Field label={t("pages.f.ownerName")}><input className="input" maxLength={80} value={content.settings.ownerName} onChange={(e) => edit((c) => ({ ...c, settings: { ...c.settings, ownerName: e.target.value } }))} /></Field>
            <Field label={t("pages.f.contactEmail")}><input type="email" className="input" maxLength={120} value={content.settings.contactEmail} onChange={(e) => edit((c) => ({ ...c, settings: { ...c.settings, contactEmail: e.target.value } }))} /></Field>
            <Field label={t("pages.f.description")}><input className="input" maxLength={200} value={content.settings.description} onChange={(e) => edit((c) => ({ ...c, settings: { ...c.settings, description: e.target.value } }))} /></Field>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={content.settings.usesAffiliateLinks} onChange={(e) => edit((c) => ({ ...c, settings: { ...c.settings, usesAffiliateLinks: e.target.checked } }))} />
              <span>{t("pages.f.usesAffiliate")}</span>
            </label>
          </section>

          <section className="card space-y-3" aria-labelledby="img-h">
            <h2 id="img-h" className="font-semibold text-slate-900">{t("pages.ed.imagesTitle")} <span className="text-sm font-normal text-slate-500">({images.length}/{page.limits.maxImages})</span></h2>
            <p className="text-xs text-slate-500">{t("pages.ed.imagesHint")}</p>
            <label className={`btn-secondary cursor-pointer ${uploading || images.length >= page.limits.maxImages ? "pointer-events-none opacity-50" : ""}`}>
              <Icon name="upload" />{uploading ? t("pages.ed.uploading") : t("pages.ed.upload")}
              <input type="file" accept="image/*" multiple className="sr-only" aria-label={t("pages.ed.upload")} onChange={(e) => { upload(e.target.files).catch(() => undefined); e.target.value = ""; }} />
            </label>
            {images.length > 0 && (
              <ul className="grid grid-cols-4 gap-2">
                {images.map((im) => (
                  <li key={im.id} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                    <img src={imgUrl(im.id)} alt="" className="h-full w-full object-cover" />
                    <button className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-rose-700 shadow hover:bg-white" aria-label={t("pages.ed.deleteImage")} onClick={() => { removeImage(im.id).catch(() => undefined); }}><Icon name="trash" className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3" aria-labelledby="blk-h">
            <h2 id="blk-h" className="font-semibold text-slate-900">{t("pages.ed.blocks")}</h2>
            {content.blocks.map((b, i) => (
              <div key={b.id} className="card space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-xs text-slate-600">{i + 1}</span>
                    <span className="truncate font-medium text-slate-900">{t(`pages.block.${b.type}` as MessageKey)}</span>
                  </button>
                  <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label={t("pages.ed.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrowUp" className="h-4 w-4" /></button>
                  <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label={t("pages.ed.moveDown")} disabled={i === content.blocks.length - 1} onClick={() => move(i, 1)}><Icon name="arrowDown" className="h-4 w-4" /></button>
                  <button className="rounded-lg p-1.5 text-rose-700 hover:bg-rose-50" aria-label={t("pages.ed.removeBlock")} onClick={() => { edit((c) => ({ ...c, blocks: c.blocks.filter((_, j) => j !== i) })); }}><Icon name="trash" className="h-4 w-4" /></button>
                </div>
                {open === b.id && <BlockForm b={b as AnyBlock} images={images} set={(patch) => setBlock(i, patch)} />}
              </div>
            ))}
            {content.blocks.length < MAX_BLOCKS && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <label className="label" htmlFor="add-block">{t("pages.ed.addBlock")}</label>
                  <select id="add-block" className="input" value={adding} onChange={(e) => setAdding(e.target.value as BlockType)}>
                    {BLOCK_TYPES.map((bt) => <option key={bt} value={bt}>{t(`pages.block.${bt}` as MessageKey)}</option>)}
                  </select>
                </div>
                <button className="btn" onClick={() => { const nb = blank(adding); edit((c) => ({ ...c, blocks: [...c.blocks, nb] })); setOpen(nb.id); }}><Icon name="plus" />{t("pages.ed.add")}</button>
              </div>
            )}
          </section>
        </div>

        <section aria-labelledby="prev-h" className="xl:sticky xl:top-4 xl:self-start">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="prev-h" className="font-semibold text-slate-900">{t("pages.ed.preview")}</h2>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label={t("pages.ed.preview")}>
              {([false, true] as const).map((m) => (
                <button key={String(m)} aria-pressed={mobile === m} onClick={() => setMobile(m)} className={`rounded-lg px-3 py-1 text-xs font-semibold ${mobile === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>{t(m ? "pages.ed.mobile" : "pages.ed.desktop")}</button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-200/60 p-2">
            <iframe title={t("pages.ed.preview")} sandbox="allow-same-origin" srcDoc={srcDoc} className={`mx-auto block h-[70vh] min-h-[28rem] rounded-xl bg-white transition-all ${mobile ? "w-[390px] max-w-full" : "w-full"}`} />
          </div>
        </section>
      </div>
    </div>
  );
}
