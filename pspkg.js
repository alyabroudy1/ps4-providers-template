"use strict";
var provider = (() => {
  const manifest = {
    id: "pspkg",
    name: "PSPKG",
    version: 3,
    apiVersion: 1,
    kinds: ["catalog"],
    allowedHosts: ["pspkg.com", "*.pspkg.com"],
    language: "en"
  };
  const BASE = "https://pspkg.com";

  /* ---------- small helpers ---------- */
  function clean(str) {
    if (str === null || str === undefined) return null;
    return String(str).replace(/\s+/g, " ").trim() || null;
  }
  function fmtDownloads(n) {
    if (n == null) return null;
    const v = Number(n.replace(/,/g, ""));
    if (!Number.isFinite(v)) return n;
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
    if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
    return String(v);
  }
  function regionFromPlat(plat) {
    if (!plat) return null;
    const m = plat.match(/\b(AR|EUR|USA|JPN)\b/);
    return m ? m[1] : null;
  }

  /* ---------- card ---------- */
  function toCard(el) {
    const titleEl = el.selectFirst(".hm-card-title");
    const img = el.selectFirst("img");
    const badgeEl = el.selectFirst(".hm-card-badge");
    const platEl = el.selectFirst(".hm-card-plat");
    const dlEl = el.selectFirst('span.tr-no:has(i.fa-download)');
    const rtEl = el.selectFirst('span.tr-no:has(i.fa-star)');

    const title = clean(titleEl ? titleEl.text() : null);
    const coverUrl = img ? img.absUrl("src") : null;
    const plat = clean(platEl ? platEl.text() : null);
    const downloadsRaw = clean(dlEl ? dlEl.text() : null);
    const ratingRaw = clean(rtEl ? rtEl.text() : null);

    const badges = [];
    if (plat && plat !== "") badges.push(plat);
    const rating = ratingRaw && ratingRaw !== "0.0" ? ratingRaw : null;
    if (rating) badges.push("\u2605 " + rating);
    if (downloadsRaw) badges.push(fmtDownloads(downloadsRaw) + " downloads");

    return {
      url: el.absUrl("href"),
      title: title,
      coverUrl: coverUrl,
      titleId: null,
      region: regionFromPlat(plat),
      badges: badges,
    };
  }

  async function fetchHomePage() {
    const res = await http.get(BASE + "/ps4/");
    return html.parse(res.body, res.url);
  }

  async function getHome(page) {
    if (page === 1) {
      const root = await fetchHomePage();
      const sections = [];
      for (const sec of root.select("div.hm-section")) {
        const titleEl = sec.selectFirst("div.hm-section-title");
        const title = clean(titleEl ? titleEl.text() : null) || "Games";
        const cards = [];
        for (const el of sec.select("a.hm-card")) cards.push(toCard(el));
        if (cards.length === 0) continue;
        sections.push({ name: title, cards: cards, hasMore: true });
      }
      if (sections.length === 0) {
        // fallback: any cards anywhere on the page
        const cards = [];
        for (const el of root.select("a.hm-card")) cards.push(toCard(el));
        if (cards.length > 0) sections.push({ name: "Games", cards: cards, hasMore: true });
      }
      return sections;
    }

    // page >= 2: paginated listing
    const res = await http.get(BASE + "/ps4/?page=" + page);
    const root = html.parse(res.body, res.url);
    const cards = [];
    for (const el of root.select("a.hm-card")) cards.push(toCard(el));
    return cards.length > 0
      ? [{ name: "Page " + page, cards: cards, hasMore: cards.length >= 12 }]
      : [];
  }

  async function search(query, page) {
    const res = await http.get(BASE + "/ps4/?search=" + encodeURIComponent(query) + "&page=" + page);
    const root = html.parse(res.body, res.url);
    const cards = [];
    for (const el of root.select("a.hm-card")) cards.push(toCard(el));
    return cards;
  }

  /* ---------- details ---------- */
  async function load(url) {
    const res = await http.get(url);
    const root = html.parse(res.body, res.url);
    const text = root.text();

    let title = null;
    const titleRow = root.selectFirst("span.info-value.tr-no");
    if (titleRow) title = clean(titleRow.text());
    if (!title) {
      const h1 = root.selectFirst("h1");
      title = h1 ? clean(h1.text().replace(/\s*\(\d{4}\).*$/, "")) : null;
    }

    const coverImg = root.selectFirst("img[src*='/ps4/image/']:not([src*='/gallery/'])");
    const coverUrl = coverImg ? coverImg.absUrl("src") : null;

    const gallery = root.select("img[src*='/gallery/']");
    const screenshots = [];
    for (const el of gallery) {
      const s = el.absUrl("src");
      if (s && !screenshots.includes(s)) screenshots.push(s);
    }

    const mId = text.match(/CUSA\d{5}/);
    const titleId = mId ? mId[0] : null;

    const mEd = text.match(/CUSA\d{5}\s*\u2013\s*([A-Z]{3})\s*\((\d+(?:\.\d+)?)\)/);
    const region = mEd ? mEd[1] : null;
    const version = mEd ? mEd[2] : null;

    const mFw = text.match(/إصدار\s*النظام[^\d]{0,60}(\d{2}\.\d{2})/);
    const minFirmware = mFw ? mFw[1] : null;

    const mSize = text.match(/(\d+)\s*GB/i);
    const sizeBytes = mSize ? parseInt(mSize[1], 10) * 1024 * 1024 * 1024 : null;

    let description = null;
    const descDiv = root.selectFirst("div.description-content");
    if (descDiv) {
      description = clean(descDiv.text());
      if (description && description.length > 4000) description = description.slice(0, 4000) + "\u2026";
    }

    const trailerEl = root.selectFirst("iframe[src*='youtube.com/embed/']");
    let trailerUrl = null;
    if (trailerEl) {
      const m = trailerEl.attr("src").match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/);
      if (m) trailerUrl = "https://www.youtube.com/watch?v=" + m[1];
    }

    const dlLink = root.selectFirst("a[href*='/download-']");
    const downloadUrl = dlLink ? dlLink.absUrl("href") : null;

    const editionLabel = (titleId && region && version)
      ? titleId + "\u2013" + region + " (" + version + ")"
      : (title ? title : null);

    const releases = downloadUrl
      ? [{
          label: editionLabel,
          kind: "game",
          version: version,
          sources: [{
            host: "pspkg.com",
            label: "PSPKG",
            parts: [downloadUrl],
            sizeBytes: sizeBytes,
            archivePassword: null
          }]
        }]
      : [];

    return {
      url: url,
      title: title,
      titleId: titleId,
      coverUrl: coverUrl,
      description: description,
      region: region,
      minFirmware: minFirmware,
      sizeBytes: sizeBytes,
      screenshots: screenshots,
      trailerUrl: trailerUrl,
      releases: releases
    };
  }

  return { manifest: manifest, getHome: getHome, search: search, load: load };
})();
