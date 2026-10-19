"use strict";
var provider = (() => {
  const manifest = {
    id: "pspkg",
    name: "PSPKG",
    version: 1,
    apiVersion: 1,
    kinds: ["catalog"],
    allowedHosts: ["pspkg.com", "*.pspkg.com"],
    language: "en"
  };
  const BASE = "https://pspkg.com";

  function toCard(el) {
    const titleEl = el.selectFirst(".hm-card-title");
    const img = el.selectFirst("img");
    const badge = el.selectFirst(".hm-card-badge");
    return {
      url: el.absUrl("href"),
      title: titleEl ? titleEl.text() : null,
      coverUrl: img ? img.absUrl("src") : null,
      titleId: null,
      region: null,
      badges: badge ? [badge.text()] : []
    };
  }

  async function getHome(page) {
    if (page > 1) return [];
    const res = await http.get(BASE + "/ps4/");
    const root = html.parse(res.body, res.url);
    const cards = [];
    for (const el of root.select("a.hm-card")) cards.push(toCard(el));
    return [{ name: "Games", cards: cards, hasMore: true }];
  }

  async function search(query, page) {
    const res = await http.get(BASE + "/ps4/?search=" + encodeURIComponent(query));
    const root = html.parse(res.body, res.url);
    const cards = [];
    for (const el of root.select("a.hm-card")) cards.push(toCard(el));
    return cards;
  }

  async function load(url) {
    const res = await http.get(url);
    const root = html.parse(res.body, res.url);
    const text = root.text();

    const titleEl = root.selectFirst("h1");
    const title = titleEl ? titleEl.text() : null;

    const coverImg = root.selectFirst("img[src*='/gallery/']");
    const coverUrl = coverImg ? coverImg.absUrl("src") : null;

    const mId = text.match(/CUSA\d{5}/);
    const titleId = mId ? mId[0] : null;

    const mEd = text.match(/CUSA\d{5}\s*\u2013\s*([A-Z]{3})\s*\((\d+(?:\.\d+)?)\)/);
    const region = mEd ? mEd[1] : null;
    const version = mEd ? mEd[2] : null;

    const mFw = text.match(/Firmware[^\d]{0,40}(\d{2}\.\d{2})/i);
    const minFirmware = mFw ? mFw[1] : null;

    const mSize = text.match(/(\d+)\s*GB/i);
    const sizeBytes = mSize ? parseInt(mSize[1], 10) * 1024 * 1024 * 1024 : null;

    const descEl = root.selectFirst(".comment-content-wrapper");
    const description = descEl ? descEl.text() : null;

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
      screenshots: [],
      trailerUrl: null,
      releases: releases
    };
  }

  return { manifest: manifest, getHome: getHome, search: search, load: load };
})();
