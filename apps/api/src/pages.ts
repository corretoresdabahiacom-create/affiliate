import { Hono } from "hono";
import {
  MAX_IMAGES_PER_PAGE,
  MAX_IMAGE_BYTES,
  MAX_PAGES_PER_USER,
  PAGE_TEMPLATES,
  defaultContent,
  imageUploadSchema,
  pageContentSchema,
  pageCreateSchema,
  pageUpdateSchema,
  publishIssues,
  renderPage,
  slugify,
  sniffImage,
  templateById,
  type PageContent,
} from "@ai/shared";
import { audit } from "./audit";
import { requireUser } from "./middleware";
import type { Row } from "./catalog";
import type { AppBindings } from "./types";

/**
 * Páginas de venda. O HTML público é gerado no servidor a partir de blocos validados (tudo escapado, sem script).
 * Publicar exige: sem promessa de ganho, sem texto de exemplo, link de ação definido, identificação do responsável
 * e depoimentos confirmados como reais. Imagens: até ~350 KB, conferidas pelos bytes (SVG nunca).
 */
export const pages = new Hono<AppBindings>();
export const publicPages = new Hono<AppBindings>();

const MAX_IMAGES_PER_USER = 60;
const json = (c: any) => c.req.json().catch(() => null);
const invalid = (c: any, issues: unknown) => c.json({ error: "invalid_input", issues }, 400);
const uid = (c: any) => c.get("user").id as string;
const UUID = /^[0-9a-f-]{36}$/;

function view(r: Row, withContent = false) {
  const content = JSON.parse(r.content as string) as PageContent;
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    templateId: r.template_id as string,
    status: r.status as "draft" | "published",
    updatedAt: r.updated_at as number,
    publishedAt: (r.published_at as number | null) ?? null,
    ...(withContent ? { content, issues: publishIssues(content, r.title as string) } : {}),
  };
}

async function mine(c: any, id: string) {
  return c.env.DB.prepare("SELECT * FROM sales_pages WHERE id = ? AND user_id = ?").bind(id, uid(c)).first() as Promise<Row | null>;
}
async function imageIds(c: any, pageId: string): Promise<string[]> {
  const { results } = (await c.env.DB.prepare("SELECT id FROM page_images WHERE page_id = ?").bind(pageId).all()) as { results: { id: string }[] };
  return results.map((r: { id: string }) => r.id);
}
const referenced = (content: PageContent): string[] =>
  content.blocks.flatMap((b) => (b.type === "hero" ? (b.imageId ? [b.imageId] : []) : b.type === "gallery" ? b.imageIds : []));

pages.use("*", requireUser);

pages.get("/templates", async (c) => c.json({ items: PAGE_TEMPLATES }));

// Imagem para a prévia do dono (a pública é /p/img/:id e só funciona com a página publicada).
pages.get("/img/:imageId", async (c) => {
  const id = c.req.param("imageId");
  if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
  const r = await c.env.DB.prepare("SELECT mime, data FROM page_images WHERE id = ? AND user_id = ?").bind(id, uid(c)).first<{ mime: string; data: string }>();
  if (!r) return c.json({ error: "not_found" }, 404);
  return imageResponse(r.mime, r.data, "private, max-age=300");
});

function imageResponse(mime: string, data: string, cache: string) {
  const bin = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  return new Response(bin, { headers: { "content-type": mime, "cache-control": cache, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
}

pages.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM sales_pages WHERE user_id = ? ORDER BY updated_at DESC").bind(uid(c)).all<Row>();
  return c.json({ items: results.map((r: Row) => view(r)), max: MAX_PAGES_PER_USER });
});

pages.post("/", async (c) => {
  const parsed = pageCreateSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const { title, templateId } = parsed.data;
  if (!templateById(templateId)) return c.json({ error: "unknown_template" }, 400);
  const cnt = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM sales_pages WHERE user_id = ?").bind(uid(c)).first<{ n: number }>();
  if ((cnt?.n ?? 0) >= MAX_PAGES_PER_USER) return c.json({ error: "page_limit", max: MAX_PAGES_PER_USER }, 409);
  const id = crypto.randomUUID();
  const slug = `${slugify(title)}-${id.slice(0, 5)}`;
  const t = Date.now();
  await c.env.DB.prepare("INSERT INTO sales_pages (id, user_id, slug, title, template_id, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)")
    .bind(id, uid(c), slug, title, templateId, JSON.stringify(defaultContent(templateId)), t, t)
    .run();
  await audit(c.env.DB, uid(c), "page.created", id);
  return c.json({ ok: true, id }, 201);
});

pages.get("/:id", async (c) => {
  const r = await mine(c, c.req.param("id"));
  if (!r) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare("SELECT id, mime, bytes FROM page_images WHERE page_id = ? ORDER BY created_at").bind(r.id).all<{ id: string; mime: string; bytes: number }>();
  return c.json({ ...view(r, true), images: results, limits: { maxImages: MAX_IMAGES_PER_PAGE, maxImageBytes: MAX_IMAGE_BYTES } });
});

pages.put("/:id", async (c) => {
  const parsed = pageUpdateSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  const cur = await mine(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => (sets.push(`${col} = ?`), vals.push(v));
  if (b.slug !== undefined && b.slug !== cur.slug) {
    const taken = await c.env.DB.prepare("SELECT 1 AS x FROM sales_pages WHERE slug = ? AND id != ?").bind(b.slug, cur.id).first();
    if (taken) return c.json({ error: "slug_taken" }, 409);
    add("slug", b.slug);
  }
  const title = b.title ?? (cur.title as string);
  if (b.title !== undefined) add("title", b.title);
  let content = JSON.parse(cur.content as string) as PageContent;
  if (b.content) {
    const own = new Set(await imageIds(c, cur.id as string));
    if (referenced(b.content).some((id) => !own.has(id))) return c.json({ error: "invalid_image" }, 400);
    content = b.content;
    add("content", JSON.stringify(content));
  }
  // Página publicada que deixou de cumprir as regras volta para rascunho: o público nunca vê uma versão fora das regras.
  let unpublished = false;
  if (cur.status === "published" && (b.content || b.title !== undefined) && publishIssues(content, title).length > 0) {
    add("status", "draft");
    unpublished = true;
  }
  if (sets.length === 0) return c.json({ ok: true, unpublished: false });
  add("updated_at", Date.now());
  await c.env.DB.prepare(`UPDATE sales_pages SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals, cur.id, uid(c)).run();
  return c.json({ ok: true, unpublished, issues: publishIssues(content, title) });
});

pages.post("/:id/publish", async (c) => {
  const cur = await mine(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  const content = JSON.parse(cur.content as string) as PageContent;
  const issues = publishIssues(content, cur.title as string);
  if (issues.length) return c.json({ error: "publish_blocked", issues }, 409);
  const t = Date.now();
  await c.env.DB.prepare("UPDATE sales_pages SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ? AND user_id = ?").bind(t, t, cur.id, uid(c)).run();
  await audit(c.env.DB, uid(c), "page.published", cur.id as string);
  return c.json({ ok: true, path: `/p/${cur.slug}` });
});

pages.post("/:id/unpublish", async (c) => {
  const cur = await mine(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("UPDATE sales_pages SET status = 'draft', updated_at = ? WHERE id = ? AND user_id = ?").bind(Date.now(), cur.id, uid(c)).run();
  await audit(c.env.DB, uid(c), "page.unpublished", cur.id as string);
  return c.json({ ok: true });
});

pages.delete("/:id", async (c) => {
  const cur = await mine(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM sales_pages WHERE id = ? AND user_id = ?").bind(cur.id, uid(c)).run(); // imagens saem em cascata
  await audit(c.env.DB, uid(c), "page.deleted", cur.id as string);
  return c.json({ ok: true });
});

pages.post("/:id/images", async (c) => {
  const parsed = imageUploadSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const cur = await mine(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  let bin: Uint8Array;
  try {
    bin = Uint8Array.from(atob(parsed.data.data), (ch) => ch.charCodeAt(0));
  } catch {
    return c.json({ error: "invalid_image" }, 400);
  }
  if (bin.length > MAX_IMAGE_BYTES) return c.json({ error: "image_too_large", max: MAX_IMAGE_BYTES }, 413);
  const real = sniffImage(bin);
  if (!real || real !== parsed.data.mime) return c.json({ error: "invalid_image" }, 400);
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS page, (SELECT COUNT(*) FROM page_images WHERE user_id = ?) AS total FROM page_images WHERE page_id = ?")
    .bind(uid(c), cur.id)
    .first<{ page: number; total: number }>();
  if ((n?.page ?? 0) >= MAX_IMAGES_PER_PAGE) return c.json({ error: "image_limit", max: MAX_IMAGES_PER_PAGE }, 409);
  if ((n?.total ?? 0) >= MAX_IMAGES_PER_USER) return c.json({ error: "image_limit_user", max: MAX_IMAGES_PER_USER }, 409);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO page_images (id, user_id, page_id, mime, bytes, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, uid(c), cur.id, real, bin.length, parsed.data.data, Date.now())
    .run();
  return c.json({ ok: true, id, mime: real, bytes: bin.length }, 201);
});

pages.delete("/:id/images/:imageId", async (c) => {
  const cur = await mine(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  const imageId = c.req.param("imageId");
  await c.env.DB.prepare("DELETE FROM page_images WHERE id = ? AND page_id = ? AND user_id = ?").bind(imageId, cur.id, uid(c)).run();
  // Tira a referência dos blocos, para a página não apontar para imagem que não existe mais.
  const content = JSON.parse(cur.content as string) as PageContent;
  let changed = false;
  for (const b of content.blocks) {
    if (b.type === "hero" && b.imageId === imageId) (b.imageId = null), (changed = true);
    if (b.type === "gallery" && b.imageIds.includes(imageId)) (b.imageIds = b.imageIds.filter((x) => x !== imageId)), (changed = true);
  }
  if (changed) await c.env.DB.prepare("UPDATE sales_pages SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify(content), Date.now(), cur.id, uid(c)).run();
  return c.json({ ok: true });
});

// ---------- Público ----------
const PAGE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const publicHeaders = (cache: string): Record<string, string> => ({
  "content-security-policy": PAGE_CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "cache-control": cache,
});

publicPages.get("/img/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.text("Not found", 404, publicHeaders("no-store"));
  const r = await c.env.DB.prepare("SELECT i.mime, i.data FROM page_images i JOIN sales_pages p ON p.id = i.page_id WHERE i.id = ? AND p.status = 'published'")
    .bind(id)
    .first<{ mime: string; data: string }>();
  if (!r) return c.text("Not found", 404, publicHeaders("no-store"));
  return imageResponse(r.mime, r.data, "public, max-age=3600");
});

publicPages.get("/:slug", async (c) => {
  const r = await c.env.DB.prepare("SELECT title, content FROM sales_pages WHERE slug = ? AND status = 'published'").bind(c.req.param("slug")).first<{ title: string; content: string }>();
  if (!r) return c.text("Not found", 404, publicHeaders("no-store"));
  const parsed = pageContentSchema.safeParse(JSON.parse(r.content));
  if (!parsed.success) return c.text("Not found", 404, publicHeaders("no-store"));
  const html = renderPage({ title: r.title, content: parsed.data }, { imgSrc: (id) => `/p/img/${id}` });
  return c.html(html, 200, { ...publicHeaders("public, max-age=60"), "x-robots-tag": "index, follow" });
});
