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

  // providers/demo-catalog/src/index.ts
  var index_exports = {};
  __export(index_exports, {
    getHome: () => getHome,
    load: () => load,
    manifest: () => manifest,
    search: () => search
  });
  var DEFAULT_CATALOG_URL = "https://raw.githubusercontent.com/alyabroudy1/ps4-providers-template/main/demo/catalog.json";
  var manifest = {
    id: "demo-catalog",
    name: "Demo Catalog",
    version: 2,
    apiVersion: 1,
    kinds: ["catalog"],
    allowedHosts: ["raw.githubusercontent.com", "github.com"],
    language: "en",
    settings: [{ key: "catalogUrl", label: "Catalog JSON URL", default: DEFAULT_CATALOG_URL }]
  };
  async function fetchCatalog(url) {
    const res = await http.get(url);
    if (res.status !== 200) throw new Error(`catalog returned HTTP ${res.status} for ${url}`);
    let data;
    try {
      data = JSON.parse(res.body);
    } catch (e) {
      throw new Error(`catalog is not valid JSON: ${e.message}`);
    }
    if (!data || !Array.isArray(data.items)) throw new Error("catalog has no items[]");
    return data.items;
  }
  function catalogUrl() {
    return settings.catalogUrl || DEFAULT_CATALOG_URL;
  }
  function toCard(base, item) {
    return {
      url: `${base}#${encodeURIComponent(item.id)}`,
      title: item.title,
      coverUrl: item.coverUrl ?? null,
      titleId: item.titleId ?? null,
      region: item.region ?? null,
      badges: ["demo"]
    };
  }
  async function getHome(page) {
    if (page > 1) return [];
    const base = catalogUrl().split("#")[0];
    const items = await fetchCatalog(base);
    const byCategory = /* @__PURE__ */ new Map();
    for (const item of items) {
      const key = item.category || "Demo";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(toCard(base, item));
    }
    return [...byCategory.entries()].map(([name, cards]) => ({ name, cards, hasMore: false }));
  }
  async function search(query, page) {
    if (page > 1) return [];
    const base = catalogUrl().split("#")[0];
    const items = await fetchCatalog(base);
    const q = query.trim().toLowerCase();
    return items.filter((i) => !q || i.title.toLowerCase().includes(q) || (i.titleId ?? "").toLowerCase().includes(q)).map((i) => toCard(base, i));
  }
  async function load(url) {
    const hash = url.indexOf("#");
    if (hash < 0) throw new Error("not a demo-catalog URL (missing #id): " + url);
    const base = url.slice(0, hash);
    const id = decodeURIComponent(url.slice(hash + 1));
    const item = (await fetchCatalog(base)).find((i) => i.id === id);
    if (!item) throw new Error(`no catalog entry with id '${id}'`);
    const releases = item.releases.map((r) => ({
      label: r.label,
      kind: r.kind,
      version: r.version ?? null,
      sources: [
        {
          host: r.host || "github.com",
          label: r.parts.length > 1 ? `GitHub Releases (${r.parts.length} parts)` : "GitHub Releases",
          parts: r.parts,
          sizeBytes: r.sizeBytes ?? null
        }
      ]
    }));
    return {
      url,
      title: item.title,
      titleId: item.titleId ?? null,
      coverUrl: item.coverUrl ?? null,
      description: item.description ?? null,
      region: item.region ?? null,
      minFirmware: item.minFirmware ?? null,
      sizeBytes: item.releases[0]?.sizeBytes ?? null,
      releases
    };
  }
  return __toCommonJS(index_exports);
})();
