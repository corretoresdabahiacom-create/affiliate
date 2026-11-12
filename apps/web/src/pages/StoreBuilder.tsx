import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MAX_STORE_BATCH } from "@ai/shared";
import { api, type AttributeValue, type Connection, type Listing, type PublishResult, type SupplierProduct, type SyncProposal } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-sm ${m.ok ? "text-emerald-700" : "text-red-600"}`}>{m.text}</p> : null);
const money = (n: number, cur: string, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(n);

const isLiveEdit = (l: Listing) => l.status === "published";

function Attributes({ l, value, onChange }: { l: Listing; value: AttributeValue[]; onChange: (v: AttributeValue[]) => void }) {
  const { t } = useI18n();
  const schema = l.attributeSchema ?? [];
  if (schema.length === 0) return null;
  const set = (id: number, v: AttributeValue | null) => onChange([...value.filter((a) => a.attributeId !== id), ...(v ? [v] : [])]);
  return (
    <fieldset className="space-y-2 rounded-md bg-slate-50 p-2">
      <legend className="label">{t("store.attrs")}</legend>
      <p className="text-xs text-slate-500">{t("store.attrs.help")}</p>
      {schema.map((a) => {
        const cur = value.find((x) => x.attributeId === a.id);
        const id = `at-${l.id}-${a.id}`;
        return (
          <div key={a.id} className="grid gap-1 sm:grid-cols-2">
            <label className="label" htmlFor={id}>{a.name}{a.mandatory ? " *" : ""}</label>
            {a.values.length > 0 ? (
              <select id={id} className="input" value={cur?.valueId ?? ""} onChange={(e) => set(a.id, e.target.value ? { attributeId: a.id, valueId: Number(e.target.value) } : null)}>
                <option value="">{t("store.attrs.pick")}</option>
                {a.values.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            ) : (
              <input id={id} className="input" maxLength={200} placeholder={t("store.attrs.custom")} value={cur?.customValue ?? ""} onChange={(e) => set(a.id, e.target.value.trim() ? { attributeId: a.id, customValue: e.target.value } : null)} />
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

function ListingCard({ l, checked, onCheck, onChange }: { l: Listing; checked: boolean; onCheck: () => void; onChange: () => void }) {
  const { t, locale } = useI18n();
  const [title, setTitle] = useState(l.title);
  const [description, setDescription] = useState(l.description);
  const [price, setPrice] = useState(String(l.price));
  const [mPrices, setMPrices] = useState<string[]>((l.variants?.models ?? []).map((m) => String(m.price ?? "")));
  const [mStocks, setMStocks] = useState<string[]>((l.variants?.models ?? []).map((m) => String(m.stock ?? "")));
  const [attrs, setAttrs] = useState<AttributeValue[]>(l.attributes ?? []);
  const [msg, setMsg] = useState<Msg>(null);
  const live = isLiveEdit(l);
  const locked = l.status === "publishing" || l.status === "discarded";
  const hasV = !!l.variants;
  const attrsDirty = !live && JSON.stringify([...attrs].sort((a, b) => a.attributeId - b.attributeId)) !== JSON.stringify([...(l.attributes ?? [])].sort((a, b) => a.attributeId - b.attributeId));
  const variantsDirty = hasV && l.variants!.models.some((m, i) => Number(mPrices[i]) !== (m.price ?? 0) || Number(mStocks[i]) !== (m.stock ?? 0));
  const dirty = title !== l.title || description !== l.description || (!hasV && Number(price) !== l.price) || variantsDirty || attrsDirty;
  const save = async () => {
    setMsg(null);
    try {
      await api.listingPatch(l.id, {
        title, description,
        ...(hasV ? (variantsDirty ? { modelPrices: mPrices.map(Number), modelStocks: mStocks.map(Number) } : {}) : { price: Number(price) }),
        ...(attrsDirty ? { attributes: attrs } : {}),
      });
      onChange();
    } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const discard = async () => { try { await api.listingStatus(l.id, "discarded"); onChange(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); } };
  const selectable = !locked && (!live || l.updateStatus === "dirty");
  return (
    <li className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          {selectable && <input type="checkbox" aria-label={l.productName} checked={checked} onChange={onCheck} />}
          {l.productName}
        </label>
        <span className="flex gap-1">
          {live && l.updateStatus && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{t(`store.update.${l.updateStatus}` as MessageKey)}</span>}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(`store.status.${l.status}` as MessageKey)}</span>
        </span>
      </div>
      <p className="text-xs text-slate-500">{t(`store.src.${l.textSource}` as MessageKey)} · {t("store.cost")} {money(l.costPrice, l.currency, locale)}</p>
      {live && <p className="text-xs text-slate-500">{t("store.update.help")}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`ti-${l.id}`}>{t("store.titleField")}</label>
          <input id={`ti-${l.id}`} className="input" maxLength={120} value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {!hasV && (
          <div>
            <label className="label" htmlFor={`pr-${l.id}`}>{t("store.price")}</label>
            <input id={`pr-${l.id}`} className="input" type="number" step="0.01" min="0" value={price} disabled={locked} onChange={(e) => setPrice(e.target.value)} />
          </div>
        )}
      </div>
      <div>
        <label className="label" htmlFor={`de-${l.id}`}>{t("store.descField")}</label>
        <textarea id={`de-${l.id}`} className="input" rows={3} maxLength={3000} value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {l.variants && (
        <div className="overflow-x-auto">
          <h4 className="text-sm font-medium">{t("store.variants")}: {l.variants.tiers.map((x) => x.name).join(" / ")}</h4>
          <table className="w-full text-left text-sm">
            <thead><tr><th className="pr-2">{t("store.variant.model")}</th><th className="pr-2">{t("store.variant.cost")}</th><th className="pr-2">{t("store.variant.price")}</th><th>{t("store.variant.stock")}</th></tr></thead>
            <tbody>
              {l.variants.models.map((m, i) => (
                <tr key={m.tierIndex.join("-")}>
                  <td className="pr-2">{m.tierIndex.map((ix, ti) => l.variants!.tiers[ti]!.options[ix]).join(" / ")}{m.sku ? <span className="text-xs text-slate-500"> ({m.sku})</span> : null}</td>
                  <td className="pr-2">{money(m.costPrice, l.currency, locale)}</td>
                  <td className="pr-2"><input aria-label={`${t("store.variant.price")} ${m.tierIndex.join("-")}`} className="input w-24" type="number" step="0.01" min="0" disabled={locked} value={mPrices[i] ?? ""} onChange={(e) => setMPrices((a) => a.map((v, j) => (j === i ? e.target.value : v)))} /></td>
                  <td><input aria-label={`${t("store.variant.stock")} ${m.tierIndex.join("-")}`} className="input w-20" type="number" step="1" min="0" disabled={locked} value={mStocks[i] ?? ""} onChange={(e) => setMStocks((a) => a.map((v, j) => (j === i ? e.target.value : v)))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!live && !locked && <Attributes l={l} value={attrs} onChange={setAttrs} />}
      <p className="text-xs text-slate-600">{t("store.margin", { m: money(l.margin.amount, l.currency, locale), p: l.margin.percentOfPrice })}</p>
      {(!live || l.updateStatus) && l.issues.length > 0 && (
        <ul className="flex flex-wrap gap-1">{l.issues.map((i) => <li key={i} className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-900">{t(`store.issue.${i}` as MessageKey)}</li>)}</ul>
      )}
      {l.lastError && <p role="alert" className="text-sm text-red-600">{l.lastError}</p>}
      {l.externalItemId && <p className="text-sm text-emerald-700">{t("store.itemId", { id: l.externalItemId })}</p>}
      <Note m={msg} />
      {!locked && (
        <div className="flex gap-2">
          {dirty && <button className="btn-secondary" onClick={save}>{live ? t("store.saveLive") : t("store.save")}</button>}
          {!live && <button className="btn-secondary" onClick={discard}>{t("store.discard")}</button>}
        </div>
      )}
    </li>
  );
}

export function StoreBuilder() {
  const { t, locale } = useI18n();
  const [conns, setConns] = useState<Connection[]>([]);
  const [shopId, setShopId] = useState("");
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [rule, setRule] = useState<"markup" | "fixed">("markup");
  const [markup, setMarkup] = useState("100");
  const [fixed, setFixed] = useState("");
  const [withModel, setWithModel] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  // lote: categoria, canais, peso
  const [catQ, setCatQ] = useState("");
  const [cats, setCats] = useState<Array<{ id: number; name: string }>>([]);
  const [catId, setCatId] = useState<number | null>(null);
  const [channels, setChannels] = useState<Array<{ id: number; name: string; enabled: boolean }>>([]);
  const [chPicked, setChPicked] = useState<number[]>([]);
  const [weight, setWeight] = useState("");
  const [bulkMsg, setBulkMsg] = useState<Msg>(null);
  // autorização e publicação
  const [confirm, setConfirm] = useState("");
  const [authMsg, setAuthMsg] = useState<Msg>(null);
  const [results, setResults] = useState<PublishResult[] | null>(null);
  const [pubBusy, setPubBusy] = useState(false);
  // sincronização com o fornecedor
  const [syncItems, setSyncItems] = useState<Array<{ listingId: string; productName: string; proposal: SyncProposal }> | null>(null);
  const [syncChecked, setSyncChecked] = useState(0);
  const [syncSel, setSyncSel] = useState<string[]>([]);
  const [syncMsg, setSyncMsg] = useState<Msg>(null);

  const shops = conns.filter((c) => c.provider === "shopee" && c.status === "connected");
  useEffect(() => { api.connections().then((r) => { setConns(r.items); const s = r.items.find((c) => c.provider === "shopee" && c.status === "connected"); if (s) setShopId(s.id); }).catch(() => {}); api.supplierProducts().then((r) => setProducts(r.items)).catch(() => {}); }, []);
  const loadListings = useCallback(() => { if (shopId) api.listings(shopId).then((r) => setListings(r.items)).catch(() => {}); }, [shopId]);
  useEffect(loadListings, [loadListings]);

  const taken = useMemo(() => new Set(listings.filter((l) => ["draft", "approved", "publishing", "published"].includes(l.status)).map((l) => l.productId)), [listings]);
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_STORE_BATCH ? p : [...p, id]));
  const toggleSel = (id: string) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const ruleValid = rule === "markup" ? markup !== "" && Number(markup) >= 0 : Number(fixed) > 0;

  const build = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.storeBuild({ connectionId: shopId, productIds: picked, locale, withModel, ...(rule === "markup" ? { markupPercent: Number(markup) } : { fixedPrice: Number(fixed) }) });
      setMsg({ ok: true, text: t("store.built", { n: r.items.length }) + (r.skipped.length ? ` ${t("store.skipped", { n: r.skipped.length })}` : "") });
      setPicked([]);
      loadListings();
    } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); } finally { setBusy(false); }
  };

  const searchCats = async () => {
    setBulkMsg(null);
    const first = listings.find((l) => sel.includes(l.id))?.productName ?? listings[0]?.productName ?? "";
    try { setCats((await api.shopeeCategories(shopId, catQ.trim() || first)).items); } catch (e) { setBulkMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const loadChannels = async () => {
    setBulkMsg(null);
    try { setChannels((await api.shopeeChannels(shopId)).items); } catch (e) { setBulkMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const applyBulk = async () => {
    setBulkMsg(null);
    try {
      const r = await api.listingBulk({ listingIds: sel, ...(catId ? { categoryId: catId } : {}), ...(chPicked.length ? { logisticsChannelIds: chPicked } : {}), ...(Number(weight) > 0 ? { weightKg: Number(weight) } : {}) });
      setBulkMsg({ ok: true, text: t("store.applied", { n: r.updated }) });
      loadListings();
    } catch (e) { setBulkMsg({ ok: false, text: errorMessage(e, t) }); }
  };

  const pendingUpdate = (l: Listing) => l.status === "published" && l.updateStatus === "dirty";
  const reviewable = listings.filter((l) => l.status === "draft" || l.status === "failed" || pendingUpdate(l));
  const approved = listings.filter((l) => l.status === "approved");
  const updatesReady = listings.filter((l) => l.status === "published" && l.updateStatus === "authorized");
  const selEditable = sel.filter((id) => reviewable.some((l) => l.id === id));
  const authorize = async () => {
    setAuthMsg(null);
    try {
      const r = await api.listingAuthorize(selEditable, Number(confirm));
      setAuthMsg({ ok: r.rejected.length === 0, text: t("store.authorized", { a: r.authorized.length, r: r.rejected.length }) });
      setConfirm(""); setSel([]); loadListings();
    } catch (e) { setAuthMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const send = async (ids: string[]) => {
    setPubBusy(true); setResults(null);
    try { setResults((await api.listingPublish(ids)).results); loadListings(); } catch (e) { setAuthMsg({ ok: false, text: errorMessage(e, t) }); } finally { setPubBusy(false); }
  };
  const publish = () => send(approved.map((l) => l.id));
  const sendUpdates = () => send(updatesReady.map((l) => l.id));
  const syncPreview = async () => {
    setSyncMsg(null);
    try {
      const r = await api.syncPreview(shopId);
      setSyncItems(r.items); setSyncChecked(r.checked); setSyncSel(r.items.map((i) => i.listingId));
      if (r.items.length === 0) setSyncMsg({ ok: true, text: t("store.sync.none", { n: r.checked }) });
    } catch (e) { setSyncMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const syncApply = async (kinds: Array<"stock" | "price">) => {
    setSyncMsg(null);
    try {
      const r = await api.syncApply(shopId, syncSel, kinds);
      setSyncMsg({ ok: true, text: t("store.sync.applied", { n: r.applied }) });
      setSyncItems(null); loadListings();
    } catch (e) { setSyncMsg({ ok: false, text: errorMessage(e, t) }); }
  };

  if (shops.length === 0) {
    return <div className="space-y-3"><h1 className="text-xl font-semibold">{t("store.title")}</h1><p className="text-slate-600">{t("store.noShop")} <Link className="text-indigo-700 hover:underline" to="/integrations">{t("nav.integrations")}</Link></p></div>;
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{t("store.title")}</h1>
        <p className="text-sm text-slate-600">{t("store.subtitle")}</p>
        <Link className="text-sm text-indigo-700 hover:underline" to="/orders">{t("store.ordersLink")}</Link>
      </header>

      <section className="card space-y-3" aria-labelledby="st-prod">
        <div>
          <label className="label" htmlFor="shop">{t("store.shop")}</label>
          <select id="shop" className="input" value={shopId} onChange={(e) => setShopId(e.target.value)}>{shops.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </div>
        <h2 id="st-prod" className="font-medium">{t("store.products", { n: picked.length })}</h2>
        {products.length === 0 ? <p className="text-slate-500">{t("store.noProducts")}</p> : (
          <>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setPicked(products.filter((p) => !taken.has(p.id)).slice(0, MAX_STORE_BATCH).map((p) => p.id))}>{t("store.selectAll")}</button>
              <button className="btn-secondary" onClick={() => setPicked([])}>{t("store.clear")}</button>
            </div>
            <ul className="grid max-h-64 gap-1 overflow-auto sm:grid-cols-2">
              {products.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={picked.includes(p.id)} disabled={taken.has(p.id)} onChange={() => togglePick(p.id)} />
                    {p.name} <span className="text-xs text-slate-500">· {t("store.cost")} {money(p.costPrice, p.currency, locale)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <fieldset className="space-y-2">
          <legend className="label">{t("store.rule")}</legend>
          <label className="mr-4 text-sm"><input type="radio" name="rule" checked={rule === "markup"} onChange={() => setRule("markup")} /> {t("store.rule.markup")}</label>
          <label className="text-sm"><input type="radio" name="rule" checked={rule === "fixed"} onChange={() => setRule("fixed")} /> {t("store.rule.fixed")}</label>
          {rule === "markup" ? (
            <div><label className="label" htmlFor="mk">{t("store.markup")}</label><input id="mk" className="input w-40" type="number" min="0" step="1" value={markup} onChange={(e) => setMarkup(e.target.value)} /></div>
          ) : (
            <div><label className="label" htmlFor="fx">{t("store.fixed")}</label><input id="fx" className="input w-40" type="number" min="0" step="0.01" value={fixed} onChange={(e) => setFixed(e.target.value)} /></div>
          )}
          <p className="text-xs text-slate-500">{t("store.priceNote")}</p>
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withModel} onChange={(e) => setWithModel(e.target.checked)} />{t("store.useModel")}</label>
        <Note m={msg} />
        <button className="btn" disabled={busy || picked.length === 0 || !ruleValid} onClick={build}>{busy ? t("store.building") : t("store.build", { n: picked.length })}</button>
      </section>

      <section className="space-y-3" aria-labelledby="st-list">
        <h2 id="st-list" className="font-medium">{t("store.listings")}</h2>
        {listings.length === 0 && <p className="text-slate-500">{t("store.noListings")}</p>}

        {listings.length > 0 && (
          <div className="card space-y-3">
            <h3 className="font-medium">{t("store.shared")}</h3>
            <p className="text-xs text-slate-500">{t("store.shared.help")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div><label className="label" htmlFor="catq">{t("store.catSearch")}</label><input id="catq" className="input" value={catQ} onChange={(e) => setCatQ(e.target.value)} /></div>
              <button className="btn-secondary" onClick={searchCats}>{t("store.catSearch")}</button>
              <button className="btn-secondary" onClick={loadChannels}>{t("store.channels")}</button>
            </div>
            {cats.length > 0 && (
              <fieldset><legend className="label">{t("store.cat")}</legend>
                {cats.map((c) => <label key={c.id} className="block text-sm"><input type="radio" name="cat" checked={catId === c.id} onChange={() => setCatId(c.id)} /> {c.name}</label>)}
              </fieldset>
            )}
            {channels.length > 0 && (
              <fieldset><legend className="label">{t("store.channels")}</legend>
                {channels.map((c) => <label key={c.id} className="block text-sm"><input type="checkbox" checked={chPicked.includes(c.id)} onChange={() => setChPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} /> {c.name}{c.enabled ? "" : " (off)"}</label>)}
              </fieldset>
            )}
            <div><label className="label" htmlFor="wk">{t("store.weight")}</label><input id="wk" className="input w-32" type="number" min="0" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
            <div className="flex items-center gap-3">
              <button className="btn" disabled={sel.length === 0 || (!catId && chPicked.length === 0 && !(Number(weight) > 0))} onClick={applyBulk}>{t("store.applySelected")}</button>
              <span className="text-sm text-slate-600">{t("store.selected", { n: sel.length })}</span>
              <button className="btn-secondary" onClick={() => setSel(reviewable.map((l) => l.id))}>{t("store.selectDrafts")}</button>
            </div>
            <Note m={bulkMsg} />
          </div>
        )}

        {listings.some((l) => l.status === "published") && (
          <div className="card space-y-2">
            <h3 className="font-medium">{t("store.sync.title")}</h3>
            <p className="text-xs text-slate-500">{t("store.sync.help")}</p>
            <button className="btn-secondary" onClick={syncPreview}>{t("store.sync.preview")}</button>
            {syncItems && syncItems.length > 0 && (
              <>
                <p className="text-xs text-slate-500">{syncChecked}</p>
                <ul className="space-y-1 text-sm">
                  {syncItems.map((i) => (
                    <li key={i.listingId}>
                      <label className="flex flex-wrap items-center gap-2">
                        <input type="checkbox" aria-label={i.productName} checked={syncSel.includes(i.listingId)} onChange={() => setSyncSel((p) => (p.includes(i.listingId) ? p.filter((x) => x !== i.listingId) : [...p, i.listingId]))} />
                        <span className="font-medium">{i.productName}</span>
                        {i.proposal.stock && <span>{t("store.sync.stock", { from: i.proposal.stock.from ?? "—", to: i.proposal.stock.to })}</span>}
                        {i.proposal.price && <span>{t("store.sync.price", { from: i.proposal.price.from, to: i.proposal.price.to })}</span>}
                        {i.proposal.models?.map((m) => (
                          <span key={m.key} className="text-xs text-slate-600">[{m.key}] {m.stock ? t("store.sync.stock", { from: m.stock.from ?? "—", to: m.stock.to }) : ""} {m.price ? t("store.sync.price", { from: m.price.from ?? "—", to: m.price.to }) : ""}</span>
                        ))}
                        {i.proposal.costChanged && !i.proposal.price && !i.proposal.models?.some((m) => m.price) && <span className="text-xs text-amber-800">{t("store.sync.costChanged")}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button className="btn-secondary" disabled={syncSel.length === 0} onClick={() => syncApply(["stock"])}>{t("store.sync.applyStock")}</button>
                  <button className="btn" disabled={syncSel.length === 0} onClick={() => syncApply(["stock", "price"])}>{t("store.sync.applyBoth")}</button>
                </div>
              </>
            )}
            <Note m={syncMsg} />
          </div>
        )}

        <ul className="space-y-3">{listings.map((l) => <ListingCard key={`${l.id}-${l.status}-${l.updateStatus}-${l.price}-${l.title}-${JSON.stringify(l.variants)}-${JSON.stringify(l.attributes)}`} l={l} checked={sel.includes(l.id)} onCheck={() => toggleSel(l.id)} onChange={loadListings} />)}</ul>

        {reviewable.length > 0 && (
          <div className="card space-y-2">
            <h3 className="font-medium">{t("store.authTitle")}</h3>
            {reviewable.some(pendingUpdate) && <p className="text-xs text-slate-500">{t("store.update.title")}</p>}
            <p className="text-sm text-slate-600">{t("store.selected", { n: selEditable.length })}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div><label className="label" htmlFor="cc">{t("store.confirmCount", { n: selEditable.length })}</label><input id="cc" className="input w-28" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
              <button className="btn" disabled={selEditable.length === 0 || Number(confirm) !== selEditable.length} onClick={authorize}>{t("store.authorize")}</button>
            </div>
            <Note m={authMsg} />
          </div>
        )}

        {(approved.length > 0 || updatesReady.length > 0) && (
          <div className="card flex flex-wrap gap-2">
            {approved.length > 0 && <button className="btn" disabled={pubBusy} onClick={publish}>{pubBusy ? t("store.publishing") : t("store.publish", { n: approved.length })}</button>}
            {updatesReady.length > 0 && <button className="btn" disabled={pubBusy} onClick={sendUpdates}>{pubBusy ? t("store.publishing") : t("store.update.send", { n: updatesReady.length })}</button>}
          </div>
        )}
        {results && (
          <div className="card space-y-1" role="status">
            <p className="font-medium">{results.some((r) => r.updated) ? t("store.update.sent", { ok: results.filter((r) => r.ok).length, bad: results.filter((r) => !r.ok).length }) : t("store.published", { ok: results.filter((r) => r.ok).length, bad: results.filter((r) => !r.ok).length })}</p>
            <ul className="text-sm">{results.filter((r) => !r.ok).map((r) => <li key={r.id} className="text-red-600">{listings.find((l) => l.id === r.id)?.productName ?? r.id}: {r.error}</li>)}</ul>
          </div>
        )}
      </section>
    </div>
  );
}
