import type { Card, Details, HomeSection, Manifest, Release, ReleaseKind, Source } from "../../../types/ps4toolkit-provider";

/**
 * Generic catalog provider: all content comes from ONE user-configured catalog file (the `catalogUrl` setting),
 * typically hosted on Google Drive or in a Google Sheet. The provider ships no content and no default URL.
 *
 * File format = the app's link-list import format (IMPLEMENTATION_PLAN.md 25.2):
 *   JSON  {"format":"ps4toolkit-links","version":1,"items":[{title,titleId?,kind?,archivePassword?,parts[],notes?}]}
 *   CSV   header `title,titleId,kind,password,part1,part2,...` (RFC 4180 quoting, empty cells ignored)
 * Optional extra fields for catalog display: coverUrl, description, region, sizeBytes (CSV: same column names).
 *
 * Merge rule: items whose `title` is equal (trimmed, case-insensitive) become ONE card / ONE Details. Inside that
 * Details there is one Release per distinct `kind` (in order of first appearance) and one Source per item. The first
 * non-empty titleId/coverUrl/description/region/sizeBytes among the merged items is used for the card/details.
 * An unmerged item is simply a Details with one Release holding one Source.
 *
 * Note: the QuickJS runtime has no `URL` class, so URLs are handled with regexes only.
 */
export const manifest: Manifest = {
  id: "gdrive-catalog",
  name: "Google Drive Catalog",
  version: 1,
  apiVersion: 1,
  kinds: ["catalog"],
  allowedHosts: ["drive.google.com", "drive.usercontent.google.com", "docs.google.com", "*.googleusercontent.com"],
  language: "en",
  settings: [
    { key: "catalogUrl", label: "Catalog file URL (Google Drive share link, Google Sheet, or any https link)" },
    { key: "catalogName", label: "Catalog name (optional)" },
  ],
};

const CACHE_KEY = "catalog.v1";
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CARDS = 500;
const NOT_CONFIGURED = "Set the catalog URL in this provider's settings";

export interface Item {
  title: string;
  titleId?: string;
  kind: ReleaseKind;
  archivePassword?: string;
  parts: string[];
  notes?: string;
  coverUrl?: string;
  description?: string;
  region?: string;
  sizeBytes?: number;
}

export interface Group {
  slug: string;
  title: string;
  items: Item[];
}

// ---------------------------------------------------------------------------------------------------------
// URL handling
// ---------------------------------------------------------------------------------------------------------

/** Maps a user-facing catalog link to the URL that returns the raw file. */
export function resolveCatalogFetchUrl(raw: string): string {
  const url = raw.trim();
  const noHash = url.split("#")[0];
  const drive = /^https:\/\/drive\.google\.com\/(?:file\/d\/([A-Za-z0-9_-]+)|(?:open|uc)\?(?:[^#]*&)?id=([A-Za-z0-9_-]+))/.exec(noHash);
  if (drive) {
    const id = drive[1] || drive[2];
    return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  }
  const sheet = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(noHash);
  if (sheet) {
    const gid = /[?&#]gid=(\d+)/.exec(url);
    return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv` + (gid ? `&gid=${gid[1]}` : "");
  }
  if (!/^https:\/\//i.test(noHash)) throw new Error("Catalog URL must be an https link");
  return noHash;
}

/** The configured URL without its #fragment (card URLs append "#<slug>"); a Sheets "#gid=N" becomes "?gid=N". */
function catalogBase(): string {
  const raw = (settings.catalogUrl || "").trim();
  if (!raw) throw new Error(NOT_CONFIGURED);
  const gidFrag = /#.*\bgid=(\d+)/.exec(raw);
  const base = raw.split("#")[0];
  if (gidFrag && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(base) && !/[?&]gid=/.test(base)) {
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + "gid=" + gidFrag[1];
  }
  return base;
}

// ---------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------

const KINDS: ReleaseKind[] = ["game", "update", "dlc", "other"];

function asKind(v: unknown): ReleaseKind {
  const k = String(v ?? "").trim().toLowerCase();
  return (KINDS as string[]).indexOf(k) >= 0 ? (k as ReleaseKind) : "other";
}

const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
};

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function buildItem(raw: Record<string, unknown>, parts: unknown[], where: string): Item | null {
  const title = str(raw.title);
  if (!title) {
    log.w(`${where}: skipped, missing title`);
    return null;
  }
  const seen: Record<string, true> = {};
  const urls: string[] = [];
  for (const p of parts) {
    const u = str(p);
    if (u && /^https?:\/\//i.test(u) && !seen[u]) {
      seen[u] = true;
      urls.push(u);
    }
  }
  if (urls.length === 0) {
    log.w(`${where}: skipped '${title}', no http(s) parts`);
    return null;
  }
  return {
    title,
    titleId: str(raw.titleId),
    kind: asKind(raw.kind),
    archivePassword: str(raw.archivePassword ?? raw.password),
    parts: urls,
    notes: str(raw.notes),
    coverUrl: str(raw.coverUrl),
    description: str(raw.description),
    region: str(raw.region),
    sizeBytes: num(raw.sizeBytes),
  };
}

export function parseJsonCatalog(text: string): Item[] {
  let data: { items?: unknown };
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("Catalog is not valid JSON: " + (e as Error).message);
  }
  if (!data || !Array.isArray(data.items)) throw new Error("Catalog JSON has no items[]");
  const out: Item[] = [];
  data.items.forEach((it: unknown, i: number) => {
    if (!it || typeof it !== "object") {
      log.w(`item ${i + 1}: skipped, not an object`);
      return;
    }
    const raw = it as Record<string, unknown>;
    const item = buildItem(raw, Array.isArray(raw.parts) ? raw.parts : [], `item ${i + 1}`);
    if (item) out.push(item);
  });
  return out;
}

/** RFC 4180: quoted fields, "" escapes, CR/LF/CRLF row ends, newlines inside quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      any = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      any = true;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (any || field !== "") {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = "";
      any = false;
    } else {
      field += c;
      any = true;
    }
  }
  if (any || field !== "") {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsvCatalog(text: string): Item[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new Error("Catalog CSV is empty");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (header.indexOf("title") < 0) {
    throw new Error("Catalog CSV needs a header row: title,titleId,kind,password,part1,part2,...");
  }
  const partCols: { idx: number; n: number }[] = [];
  header.forEach((h, idx) => {
    const m = /^part(\d+)$/.exec(h);
    if (m) partCols.push({ idx, n: Number(m[1]) });
  });
  partCols.sort((a, b) => a.n - b.n);
  const field = (cells: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? cells[i] : undefined;
  };
  const out: Item[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const raw: Record<string, unknown> = {
      title: field(cells, "title"),
      titleId: field(cells, "titleid"),
      kind: field(cells, "kind"),
      archivePassword: field(cells, "password") ?? field(cells, "archivepassword"),
      notes: field(cells, "notes"),
      coverUrl: field(cells, "coverurl"),
      description: field(cells, "description"),
      region: field(cells, "region"),
      sizeBytes: field(cells, "sizebytes"),
    };
    const item = buildItem(raw, partCols.map((p) => cells[p.idx]), `row ${r + 1}`);
    if (item) out.push(item);
  }
  return out;
}

export function parseCatalog(text: string): Item[] {
  const t = text.replace(/^﻿/, "").trim();
  if (!t) throw new Error("Catalog file is empty");
  if (t[0] === "<") {
    throw new Error("Catalog link returned a web page, not a file. Share the file as 'Anyone with the link' and paste the share link.");
  }
  return t[0] === "{" || t[0] === "[" ? parseJsonCatalog(t) : parseCsvCatalog(t);
}

// ---------------------------------------------------------------------------------------------------------
// Grouping (merge by title) and cache
// ---------------------------------------------------------------------------------------------------------

function slugify(s: string): string {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 60) || "item";
}

export function groupItems(items: Item[]): Group[] {
  const groups: Group[] = [];
  const byTitle: Record<string, Group> = {};
  const slugs: Record<string, true> = {};
  for (const item of items) {
    const key = item.title.trim().toLowerCase();
    let g = byTitle[key];
    if (!g) {
      const baseSlug = slugify(item.title);
      let slug = baseSlug;
      for (let n = 2; slugs[slug]; n++) slug = baseSlug + "-" + n;
      slugs[slug] = true;
      g = { slug, title: item.title, items: [] };
      byTitle[key] = g;
      groups.push(g);
    }
    g.items.push(item);
  }
  return groups;
}

async function loadGroups(base: string): Promise<Group[]> {
  const now = Date.now();
  try {
    const cached = storage.get(CACHE_KEY);
    if (cached) {
      const c = JSON.parse(cached) as { url: string; ts: number; items: Item[] };
      if (c.url === base && now >= c.ts && now - c.ts < CACHE_TTL_MS) return groupItems(c.items);
    }
  } catch {
    /* ignore a corrupt cache */
  }
  const res = await http.get(resolveCatalogFetchUrl(base));
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new Error(`Catalog is not accessible (HTTP ${res.status}). Share the file as 'Anyone with the link'.`);
  }
  if (res.status !== 200) throw new Error(`Catalog returned HTTP ${res.status}`);
  const items = parseCatalog(res.body);
  try {
    storage.set(CACHE_KEY, JSON.stringify({ url: base, ts: now, items }));
  } catch {
    /* over the 64 KB storage quota: just do not cache */
  }
  return groupItems(items);
}

// ---------------------------------------------------------------------------------------------------------
// Provider functions
// ---------------------------------------------------------------------------------------------------------

function hostOf(url: string): string {
  const m = /^https?:\/\/(?:[^/@]*@)?([^/:?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : "unknown";
}

function first<T>(items: Item[], f: (i: Item) => T | undefined): T | undefined {
  for (const i of items) {
    const v = f(i);
    if (v !== undefined) return v;
  }
  return undefined;
}

function toCard(base: string, g: Group): Card {
  return {
    url: `${base}#${g.slug}`,
    title: g.title,
    coverUrl: first(g.items, (i) => i.coverUrl) ?? null,
    titleId: first(g.items, (i) => i.titleId) ?? null,
    region: first(g.items, (i) => i.region) ?? null,
  };
}

export async function getHome(page: number): Promise<HomeSection[]> {
  const name = (settings.catalogName || "").trim() || "Catalog";
  if (!(settings.catalogUrl || "").trim()) return [{ name, cards: [], hasMore: false }];
  if (page > 1) return [];
  const base = catalogBase();
  const groups = await loadGroups(base);
  return [{ name, cards: groups.slice(0, MAX_CARDS).map((g) => toCard(base, g)), hasMore: false }];
}

export async function search(query: string, page: number): Promise<Card[]> {
  if (!(settings.catalogUrl || "").trim() || page > 1) return [];
  const base = catalogBase();
  const q = query.trim().toLowerCase();
  const groups = await loadGroups(base);
  return groups
    .filter(
      (g) =>
        !q ||
        g.title.toLowerCase().indexOf(q) >= 0 ||
        g.items.some((i) => (i.titleId ?? "").toLowerCase().indexOf(q) >= 0),
    )
    .slice(0, MAX_CARDS)
    .map((g) => toCard(base, g));
}

const KIND_LABEL: Record<ReleaseKind, string> = { game: "Game", update: "Update", dlc: "DLC", other: "Files" };

export async function load(url: string): Promise<Details> {
  if (!(settings.catalogUrl || "").trim()) throw new Error(NOT_CONFIGURED);
  const hash = url.lastIndexOf("#");
  if (hash < 0) throw new Error("Not a catalog item URL (missing #id): " + url);
  const base = url.slice(0, hash);
  const slug = url.slice(hash + 1);
  const g = (await loadGroups(base)).find((x) => x.slug === slug);
  if (!g) throw new Error(`No catalog entry '${slug}' (the catalog file may have changed)`);

  const releases: Release[] = [];
  for (const item of g.items) {
    let rel = releases.find((r) => r.kind === item.kind);
    if (!rel) {
      rel = { label: KIND_LABEL[item.kind], kind: item.kind, version: null, sources: [] };
      releases.push(rel);
    }
    const host = hostOf(item.parts[0]);
    const source: Source = {
      host,
      label: item.notes || (item.parts.length > 1 ? `${host} (${item.parts.length} parts)` : host),
      parts: item.parts,
      archivePassword: item.archivePassword ?? null,
      sizeBytes: item.sizeBytes ?? null,
    };
    rel.sources.push(source);
  }
  return {
    url,
    title: g.title,
    titleId: first(g.items, (i) => i.titleId) ?? null,
    coverUrl: first(g.items, (i) => i.coverUrl) ?? null,
    description: first(g.items, (i) => i.description) ?? null,
    region: first(g.items, (i) => i.region) ?? null,
    sizeBytes: first(g.items, (i) => i.sizeBytes) ?? null,
    releases,
  };
}
