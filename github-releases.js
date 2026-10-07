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

  // providers/github-releases/src/index.ts
  var index_exports = {};
  __export(index_exports, {
    extract: () => extract,
    extractorPatterns: () => extractorPatterns,
    manifest: () => manifest
  });
  var manifest = {
    id: "github-releases",
    name: "GitHub Releases",
    version: 1,
    apiVersion: 1,
    kinds: ["extractor"],
    // api.github.com for release-page links; github.com for download links (resolved without fetching).
    allowedHosts: ["github.com", "api.github.com"],
    language: "en"
  };
  var extractorPatterns = [
    "^https://github.com/[^/]+/[^/]+/releases/download/[^/]+/[^/?#]+",
    "^https://github.com/[^/]+/[^/]+/releases/tag/[^/?#]+"
  ];
  var DOWNLOAD_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)/;
  var TAG_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/?#]+)/;
  async function extract(url) {
    const dl = DOWNLOAD_RE.exec(url);
    if (dl) {
      return [{ url: url.split(/[?#]/)[0], fileName: safeDecode(dl[4]) }];
    }
    const tag = TAG_RE.exec(url);
    if (tag) {
      const [, owner, repo, tagName] = tag;
      const res = await http.get(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tagName}`, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
      });
      if (res.status === 404) throw new Error(`release tag not found: ${owner}/${repo}@${safeDecode(tagName)}`);
      if (res.status === 403 || res.status === 429) throw new Error("GitHub API rate limit reached, try again later");
      if (res.status !== 200) throw new Error(`GitHub API returned HTTP ${res.status}`);
      const assets = JSON.parse(res.body).assets ?? [];
      const files = assets.filter((a) => a.browser_download_url).map((a) => ({ url: a.browser_download_url, fileName: a.name, sizeBytes: a.size ?? null }));
      if (files.length === 0) throw new Error("release has no assets");
      return files;
    }
    throw new Error("not a GitHub release URL: " + url);
  }
  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }
  return __toCommonJS(index_exports);
})();
