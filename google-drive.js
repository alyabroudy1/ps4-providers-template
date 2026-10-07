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

  // providers/google-drive/src/index.ts
  var index_exports = {};
  __export(index_exports, {
    extract: () => extract,
    extractorPatterns: () => extractorPatterns,
    manifest: () => manifest,
    naturalCompare: () => naturalCompare,
    parseDriveUrl: () => parseDriveUrl,
    parseFolderEntries: () => parseFolderEntries
  });
  var manifest = {
    id: "google-drive",
    name: "Google Drive",
    version: 1,
    apiVersion: 1,
    kinds: ["extractor"],
    allowedHosts: ["drive.google.com", "drive.usercontent.google.com", "docs.google.com", "*.googleusercontent.com"],
    language: "en"
  };
  var extractorPatterns = [
    "^https://drive\\.google\\.com/file/d/[A-Za-z0-9_-]+",
    "^https://drive\\.google\\.com/(?:open|uc)\\?(?:[^#]*&)?id=[A-Za-z0-9_-]+",
    "^https://drive\\.google\\.com/drive/(?:u/\\d+/)?folders/[A-Za-z0-9_-]+",
    "^https://drive\\.usercontent\\.google\\.com/download\\?(?:[^#]*&)?id=[A-Za-z0-9_-]+"
  ];
  var MAX_FILES = 500;
  function parseDriveUrl(url) {
    const u = url.trim().split("#")[0];
    let m = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/.exec(u);
    if (m) return { kind: "folder", id: m[1] };
    m = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/.exec(u);
    if (m) return { kind: "file", id: m[1] };
    m = /^https:\/\/drive\.(?:google|usercontent\.google)\.com\/(?:open|uc|download)\?(?:[^#]*&)?id=([A-Za-z0-9_-]+)/.exec(u);
    if (m) return { kind: "file", id: m[1] };
    return null;
  }
  var NOT_PUBLIC = "Google Drive: file is not shared publicly";
  var QUOTA = "Google Drive: download quota exceeded, try later";
  function decodeEntities(s) {
    return s.replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  function cookieHeader(setCookie) {
    if (!setCookie) return void 0;
    const pairs = [];
    for (const line of setCookie.split("\n")) {
      const nv = line.split(";")[0].trim();
      if (/^[^=\s]+=.+/.test(nv)) pairs.push(nv);
    }
    return pairs.length ? pairs.join("; ") : void 0;
  }
  function fileNameFromDisposition(cd) {
    if (!cd) return void 0;
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
    if (star) {
      try {
        return decodeURIComponent(star[1].trim());
      } catch {
      }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/.exec(cd);
    return plain ? plain[1].trim() : void 0;
  }
  function parseSize(text) {
    const m = /\(\s*([\d.,]+)\s*([KMGT]?)B?\s*\)/i.exec(text);
    if (!m) return void 0;
    const n = Number(m[1].replace(/,/g, ""));
    if (!isFinite(n)) return void 0;
    const mult = { "": 1, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 };
    return Math.round(n * mult[m[2].toUpperCase()]);
  }
  var looksHtml = (ct) => !!ct && /text\/html/i.test(ct);
  function assertAccessible(status, body) {
    if (/quota exceeded|too many users have (?:viewed|downloaded)|download quota/i.test(body)) throw new Error(QUOTA);
    if (status === 401 || status === 403 || status === 404 || /you need access|request access|sign in to continue|file you have requested does not exist|can't be accessed|Permission denied/i.test(body)) {
      throw new Error(NOT_PUBLIC);
    }
  }
  async function resolveFile(id, knownName) {
    const downloadUrl = `https://drive.usercontent.google.com/download?id=${id}&export=download`;
    let res;
    try {
      res = await http.get(downloadUrl, { headers: { Range: "bytes=0-1023" } });
    } catch (e) {
      if (/accounts\.google|not allowed|allowedHosts|denied/i.test(String(e.message))) throw new Error(NOT_PUBLIC);
      throw e;
    }
    if (!looksHtml(res.headers["content-type"])) {
      if (res.status !== 200 && res.status !== 206) throw new Error(`Google Drive returned HTTP ${res.status}`);
      const total = /\/(\d+)\s*$/.exec(res.headers["content-range"] ?? "");
      const length = res.status === 200 ? res.headers["content-length"] : void 0;
      const size = total ? Number(total[1]) : length ? Number(length) : void 0;
      const cookie2 = cookieHeader(res.headers["set-cookie"]);
      return {
        url: downloadUrl,
        fileName: fileNameFromDisposition(res.headers["content-disposition"]) ?? knownName ?? null,
        sizeBytes: size ?? null,
        headers: cookie2 ? { Cookie: cookie2 } : null
      };
    }
    const body = res.body;
    assertAccessible(res.status, body);
    const doc = html.parse(body, res.url || downloadUrl);
    const form = doc.selectFirst("form#download-form") ?? doc.selectFirst("form[action*=download]");
    if (!form) throw new Error("Google Drive: unexpected response (no download link found); the file may be unavailable");
    const action = decodeEntities(form.absUrl("action") || form.attr("action") || "");
    if (!/^https:\/\//.test(action)) throw new Error("Google Drive: unexpected confirm form");
    const params = [];
    for (const input of form.select("input")) {
      const name = input.attr("name");
      if (!name) continue;
      params.push(encodeURIComponent(name) + "=" + encodeURIComponent(input.attr("value") ?? ""));
    }
    const confirmedUrl = action + (action.indexOf("?") >= 0 ? "&" : "?") + params.join("&");
    const link = doc.selectFirst(".uc-name-size a");
    const nameSize = doc.selectFirst(".uc-name-size");
    const cookie = cookieHeader(res.headers["set-cookie"]);
    return {
      url: confirmedUrl,
      fileName: (link ? link.text() : "") || knownName || null,
      sizeBytes: (nameSize ? parseSize(nameSize.text()) : void 0) ?? null,
      headers: cookie ? { Cookie: cookie } : null
    };
  }
  function naturalCompare(a, b) {
    const ax = a.toLowerCase().match(/\d+|\D+/g) ?? [];
    const bx = b.toLowerCase().match(/\d+|\D+/g) ?? [];
    for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
      const x = ax[i];
      const y = bx[i];
      if (x === y) continue;
      if (/^\d/.test(x) && /^\d/.test(y)) {
        const d = Number(x) - Number(y);
        if (d !== 0) return d;
      } else return x < y ? -1 : 1;
    }
    return ax.length - bx.length;
  }
  function parseFolderEntries(body, baseUrl) {
    const doc = html.parse(body, baseUrl);
    const out = [];
    for (const entry of doc.select(".flip-entry")) {
      const href = entry.selectFirst("a")?.attr("href") ?? "";
      if (/\/folders\//.test(href)) continue;
      const idFromAttr = /^entry-(.+)$/.exec(entry.attr("id") ?? "");
      const idFromHref = /\/file\/d\/([A-Za-z0-9_-]+)/.exec(href) ?? /[?&]id=([A-Za-z0-9_-]+)/.exec(href);
      const id = idFromHref ? idFromHref[1] : idFromAttr ? idFromAttr[1] : "";
      const name = entry.selectFirst(".flip-entry-title")?.text() ?? "";
      if (!id || !name) continue;
      out.push({ id, name });
    }
    return out;
  }
  async function resolveFolder(id) {
    const url = `https://drive.google.com/embeddedfolderview?id=${id}`;
    let res;
    try {
      res = await http.get(url);
    } catch (e) {
      if (/accounts\.google|not allowed|allowedHosts|denied/i.test(String(e.message))) {
        throw new Error("Google Drive: folder is not shared publicly");
      }
      throw e;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error("Google Drive: folder is not shared publicly");
    if (res.status !== 200) throw new Error(`Google Drive returned HTTP ${res.status}`);
    const entries = parseFolderEntries(res.body, url).sort((a, b) => naturalCompare(a.name, b.name));
    if (entries.length === 0) throw new Error("Google Drive: folder is empty or not shared publicly");
    const files = [];
    for (const e of entries.slice(0, MAX_FILES)) {
      try {
        files.push(await resolveFile(e.id, e.name));
      } catch (err) {
        throw new Error(`${err.message} (file '${e.name}')`);
      }
    }
    return files;
  }
  async function extract(url) {
    const ref = parseDriveUrl(url);
    if (!ref) throw new Error("not a Google Drive file or folder URL: " + url);
    return ref.kind === "folder" ? resolveFolder(ref.id) : [await resolveFile(ref.id)];
  }
  return __toCommonJS(index_exports);
})();
