"use strict";
var provider = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // providers/gdrive-catalog/src/index.ts
  var index_exports = {};
  __export(index_exports, {
    getHome: () => getHome,
    groupItems: () => groupItems,
    load: () => load,
    manifest: () => manifest,
    parseCatalog: () => parseCatalog,
    parseCsvCatalog: () => parseCsvCatalog,
    parseCsvRows: () => parseCsvRows,
    parseJsonCatalog: () => parseJsonCatalog,
    resolveCatalogFetchUrl: () => resolveCatalogFetchUrl,
    search: () => search
  });
  var manifest = {
    id: "gdrive-catalog",
    name: "Google Drive Catalog",
    version: 1,
    apiVersion: 1,
    kinds: ["catalog"],
    allowedHosts: ["drive.google.com", "drive.usercontent.google.com", "docs.google.com", "*.googleusercontent.com"],
    language: "en",
    settings: [
      { key: "catalogUrl", label: "Catalog file URL (Google Drive share link, Google Sheet, or any https link)" },
      { key: "catalogName", label: "Catalog name (optional)" }
    ]
  };
  var CACHE_KEY = "catalog.v1";
  var CACHE_TTL_MS = 10 * 60 * 1e3;
  var MAX_CARDS = 500;
  var NOT_CONFIGURED = "Set the catalog URL in this provider's settings";
  function resolveCatalogFetchUrl(raw) {
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
  function catalogBase() {
    const raw = (settings.catalogUrl || "").trim();
    if (!raw) throw new Error(NOT_CONFIGURED);
    const gidFrag = /#.*\bgid=(\d+)/.exec(raw);
    const base = raw.split("#")[0];
    if (gidFrag && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(base) && !/[?&]gid=/.test(base)) {
      return base + (base.indexOf("?") >= 0 ? "&" : "?") + "gid=" + gidFrag[1];
    }
    return base;
  }
  var KINDS = ["game", "update", "dlc", "other"];
  function asKind(v) {
    const k = String(v ?? "").trim().toLowerCase();
    return KINDS.indexOf(k) >= 0 ? k : "other";
  }
  var str = (v) => {
    if (v === void 0 || v === null) return void 0;
    const s = String(v).trim();
    return s ? s : void 0;
  };
  function num(v) {
    if (v === void 0 || v === null || v === "") return void 0;
    const n = Number(v);
    return isFinite(n) && n >= 0 ? Math.floor(n) : void 0;
  }
  function buildItem(raw, parts, where) {
    const title = str(raw.title);
    if (!title) {
      log.w(`${where}: skipped, missing title`);
      return null;
    }
    const seen = {};
    const urls = [];
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
      sizeBytes: num(raw.sizeBytes)
    };
  }
  function parseJsonCatalog(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("Catalog is not valid JSON: " + e.message);
    }
    if (!data || !Array.isArray(data.items)) throw new Error("Catalog JSON has no items[]");
    const out = [];
    data.items.forEach((it, i) => {
      if (!it || typeof it !== "object") {
        log.w(`item ${i + 1}: skipped, not an object`);
        return;
      }
      const raw = it;
      const item = buildItem(raw, Array.isArray(raw.parts) ? raw.parts : [], `item ${i + 1}`);
      if (item) out.push(item);
    });
    return out;
  }
  function parseCsvRows(text) {
    const rows = [];
    let row = [];
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
  function parseCsvCatalog(text) {
    const rows = parseCsvRows(text);
    if (rows.length === 0) throw new Error("Catalog CSV is empty");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    if (header.indexOf("title") < 0) {
      throw new Error("Catalog CSV needs a header row: title,titleId,kind,password,part1,part2,...");
    }
    const partCols = [];
    header.forEach((h, idx) => {
      const m = /^part(\d+)$/.exec(h);
      if (m) partCols.push({ idx, n: Number(m[1]) });
    });
    partCols.sort((a, b) => a.n - b.n);
    const field = (cells, name) => {
      const i = header.indexOf(name);
      return i >= 0 ? cells[i] : void 0;
    };
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.every((c) => c.trim() === "")) continue;
      const raw = {
        title: field(cells, "title"),
        titleId: field(cells, "titleid"),
        kind: field(cells, "kind"),
        archivePassword: field(cells, "password") ?? field(cells, "archivepassword"),
        notes: field(cells, "notes"),
        coverUrl: field(cells, "coverurl"),
        description: field(cells, "description"),
        region: field(cells, "region"),
        sizeBytes: field(cells, "sizebytes")
      };
      const item = buildItem(raw, partCols.map((p) => cells[p.idx]), `row ${r + 1}`);
      if (item) out.push(item);
    }
    return out;
  }
  function parseCatalog(text) {
    const t = text.replace(/^﻿/, "").trim();
    if (!t) throw new Error("Catalog file is empty");
    if (t[0] === "<") {
      throw new Error("Catalog link returned a web page, not a file. Share the file as 'Anyone with the link' and paste the share link.");
    }
    return t[0] === "{" || t[0] === "[" ? parseJsonCatalog(t) : parseCsvCatalog(t);
  }
  function slugify(s) {
    const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug.slice(0, 60) || "item";
  }
  function groupItems(items) {
    const groups = [];
    const byTitle = {};
    const slugs = {};
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
  async function loadGroups(base) {
    const now = Date.now();
    try {
      const cached = storage.get(CACHE_KEY);
      if (cached) {
        const c = JSON.parse(cached);
        if (c.url === base && now >= c.ts && now - c.ts < CACHE_TTL_MS) return groupItems(c.items);
      }
    } catch {
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
    }
    return groupItems(items);
  }
  function hostOf(url) {
    const m = /^https?:\/\/(?:[^/@]*@)?([^/:?#]+)/i.exec(url);
    return m ? m[1].toLowerCase() : "unknown";
  }
  function first(items, f) {
    for (const i of items) {
      const v = f(i);
      if (v !== void 0) return v;
    }
    return void 0;
  }
  function toCard(base, g) {
    return {
      url: `${base}#${g.slug}`,
      title: g.title,
      coverUrl: first(g.items, (i) => i.coverUrl) ?? null,
      titleId: first(g.items, (i) => i.titleId) ?? null,
      region: first(g.items, (i) => i.region) ?? null
    };
  }
  async function getHome(page) {
    const name = (settings.catalogName || "").trim() || "Catalog";
    if (!(settings.catalogUrl || "").trim()) return [{ name, cards: [], hasMore: false }];
    if (page > 1) return [];
    const base = catalogBase();
    const groups = await loadGroups(base);
    return [{ name, cards: groups.slice(0, MAX_CARDS).map((g) => toCard(base, g)), hasMore: false }];
  }
  async function search(query, page) {
    if (!(settings.catalogUrl || "").trim() || page > 1) return [];
    const base = catalogBase();
    const q = query.trim().toLowerCase();
    const groups = await loadGroups(base);
    return groups.filter(
      (g) => !q || g.title.toLowerCase().indexOf(q) >= 0 || g.items.some((i) => (i.titleId ?? "").toLowerCase().indexOf(q) >= 0)
    ).slice(0, MAX_CARDS).map((g) => toCard(base, g));
  }
  var KIND_LABEL = { game: "Game", update: "Update", dlc: "DLC", other: "Files" };
  async function load(url) {
    if (!(settings.catalogUrl || "").trim()) throw new Error(NOT_CONFIGURED);
    const hash = url.lastIndexOf("#");
    if (hash < 0) throw new Error("Not a catalog item URL (missing #id): " + url);
    const base = url.slice(0, hash);
    const slug = url.slice(hash + 1);
    const g = (await loadGroups(base)).find((x) => x.slug === slug);
    if (!g) throw new Error(`No catalog entry '${slug}' (the catalog file may have changed)`);
    const releases = [];
    for (const item of g.items) {
      let rel = releases.find((r) => r.kind === item.kind);
      if (!rel) {
        rel = { label: KIND_LABEL[item.kind], kind: item.kind, version: null, sources: [] };
        releases.push(rel);
      }
      const host = hostOf(item.parts[0]);
      const source = {
        host,
        label: item.notes || (item.parts.length > 1 ? `${host} (${item.parts.length} parts)` : host),
        parts: item.parts,
        archivePassword: item.archivePassword ?? null,
        sizeBytes: item.sizeBytes ?? null
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
      releases
    };
  }
  return __toCommonJS(index_exports);
})();
