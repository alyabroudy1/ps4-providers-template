import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeBridge, type FakeBridge } from "../../../testing/fakeBridge";
import { validateCards, validateDetails, validateHome, validateManifest } from "../../../testing/validate";
import * as provider from "../src/index";

const fx = (n: string) => readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const FILE_ID = "EXAMPLEID0000000000000000000000001";
const SHARE = `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`;
const DL = `https://drive.usercontent.google.com/download?id=${FILE_ID}&export=download&confirm=t`;
const SHEET = "https://docs.google.com/spreadsheets/d/SHEETID0000000000000000000000001/edit?usp=sharing";
const SHEET_CSV = "https://docs.google.com/spreadsheets/d/SHEETID0000000000000000000000001/export?format=csv";

let bridge: FakeBridge | undefined;
const setup = (routes: Parameters<typeof installFakeBridge>[0]["routes"], settings: Record<string, string> = {}) => {
  bridge?.restore();
  bridge = installFakeBridge({ manifest: provider.manifest, routes, settings });
  return bridge;
};
afterEach(() => bridge?.restore());

describe("gdrive-catalog: manifest and URL shapes", () => {
  it("has a valid manifest with no default catalog", () => {
    expect(validateManifest(provider.manifest)).toEqual([]);
    expect(provider.manifest.kinds).toEqual(["catalog"]);
    expect(provider.manifest.settings?.find((s) => s.key === "catalogUrl")?.default).toBeUndefined();
    expect(provider.manifest.allowedHosts).toEqual([
      "drive.google.com",
      "drive.usercontent.google.com",
      "docs.google.com",
      "*.googleusercontent.com",
    ]);
  });

  it("maps Drive share link shapes to the direct-download endpoint", () => {
    for (const u of [
      SHARE,
      `https://drive.google.com/file/d/${FILE_ID}/view`,
      `https://drive.google.com/open?id=${FILE_ID}`,
      `https://drive.google.com/open?usp=sharing&id=${FILE_ID}`,
      `https://drive.google.com/uc?id=${FILE_ID}&export=download`,
    ]) {
      expect(provider.resolveCatalogFetchUrl(u), u).toBe(DL);
    }
  });

  it("maps Google Sheets links to CSV export, with optional gid", () => {
    expect(provider.resolveCatalogFetchUrl(SHEET)).toBe(SHEET_CSV);
    expect(provider.resolveCatalogFetchUrl(SHEET + "#gid=123")).toBe(SHEET_CSV + "&gid=123");
    expect(provider.resolveCatalogFetchUrl("https://docs.google.com/spreadsheets/d/SHEETID0000000000000000000000001/edit?gid=77#gid=77")).toBe(
      SHEET_CSV + "&gid=77",
    );
  });

  it("fetches any other https URL as-is and rejects non-https", () => {
    expect(provider.resolveCatalogFetchUrl("https://lh3.googleusercontent.com/demo/catalog.json")).toBe(
      "https://lh3.googleusercontent.com/demo/catalog.json",
    );
    expect(() => provider.resolveCatalogFetchUrl("http://example.com/c.json")).toThrow(/https/);
  });
});

describe("gdrive-catalog: parsing", () => {
  it("parses JSON, skipping items without title or valid parts (with a log)", () => {
    const b = setup({});
    const items = provider.parseJsonCatalog(fx("catalog.json"));
    expect(items.map((i) => i.title)).toEqual(["Demo Homebrew", "demo homebrew", "Demo Homebrew", "Other Sample"]);
    expect(items[0]).toMatchObject({ kind: "game", archivePassword: "demo-pass", region: "EU", sizeBytes: 2097152, notes: "Main mirror" });
    expect(items[3].kind).toBe("other");
    expect(b.logs.some((l) => /missing title/.test(l))).toBe(true);
    expect(b.logs.some((l) => /No Parts/.test(l))).toBe(true);
    expect(b.logs.some((l) => /Bad Parts/.test(l))).toBe(true);
  });

  it("parses CSV with RFC 4180 quoting, empty cells and missing titles", () => {
    const b = setup({});
    const items = provider.parseCsvCatalog(fx("catalog.csv"));
    expect(items.map((i) => i.title)).toEqual(["Demo Homebrew", "Sample, Pack", "Empty Row Below", "Demo Homebrew"]);
    expect(items[0].parts).toEqual(["https://example.com/a.part1.rar", "https://example.com/a.part2.rar"]);
    expect(items[0].archivePassword).toBe("demo-pass");
    expect(items[0].description).toBe('A "quoted", comma-containing\nmulti-line description');
    expect(items[1]).toMatchObject({ kind: "dlc", parts: ["https://example.com/pack.pkg"] });
    expect(items[1].titleId).toBeUndefined();
    expect(b.logs.some((l) => /missing title/.test(l))).toBe(true);
  });

  it("handles CRLF line endings and a BOM", () => {
    setup({});
    const csv = "﻿title,kind,part1\r\nDemo A,game,https://example.com/a\r\n";
    expect(provider.parseCatalog(csv).map((i) => i.title)).toEqual(["Demo A"]);
  });

  it("rejects HTML responses and CSV without a title header", () => {
    setup({});
    expect(() => provider.parseCatalog("<html>sign in</html>")).toThrow(/web page/);
    expect(() => provider.parseCatalog("name,part1\nx,https://example.com/a")).toThrow(/header/);
  });
});

describe("gdrive-catalog: provider behaviour", () => {
  it("empty settings: getHome has one empty section, search is [], load errors clearly, no network", async () => {
    const b = setup({});
    const home = await provider.getHome(1);
    expect(validateHome(home)).toEqual([]);
    expect(home).toHaveLength(1);
    expect(home[0].cards).toEqual([]);
    expect(await provider.search("demo", 1)).toEqual([]);
    await expect(provider.load("https://drive.google.com/file/d/x/view#demo")).rejects.toThrow(/Set the catalog URL in this provider's settings/);
    expect(b.requests).toHaveLength(0);
  });

  it("getHome/search/load from a Drive-hosted JSON catalog, merging by title", async () => {
    const b = setup({ [DL]: { body: fx("catalog.json") } }, { catalogUrl: SHARE, catalogName: "My Demo Catalog" });
    const home = await provider.getHome(1);
    expect(validateHome(home)).toEqual([]);
    expect(home[0].name).toBe("My Demo Catalog");
    expect(home[0].cards.map((c) => c.title)).toEqual(["Demo Homebrew", "Other Sample"]);
    expect(home[0].cards[0]).toMatchObject({ url: SHARE + "#demo-homebrew", titleId: "DEMO00001", region: "EU" });
    expect(await provider.getHome(2)).toEqual([]);

    const found = await provider.search("demo00002", 1);
    expect(validateCards(found)).toEqual([]);
    expect(found.map((c) => c.title)).toEqual(["Other Sample"]);
    expect(await provider.search("nothing", 1)).toEqual([]);
    expect((await provider.search("", 1)).length).toBe(2);

    const d = await provider.load(home[0].cards[0].url);
    expect(validateDetails(d)).toEqual([]);
    // Three items share the title: game x2 + update x1 -> 2 releases (game with 2 sources, update with 1).
    expect(d.releases.map((r) => [r.kind, r.sources.length])).toEqual([
      ["game", 2],
      ["update", 1],
    ]);
    const s0 = d.releases[0].sources[0];
    expect(s0).toMatchObject({ host: "github.com", label: "Main mirror", archivePassword: "demo-pass", sizeBytes: 2097152 });
    expect(s0.parts).toHaveLength(2);
    expect(d.releases[0].sources[1]).toMatchObject({ host: "example.com", label: "example.com" });
    expect(d.releases[1].sources[0].host).toBe("drive.google.com");
    expect(d).toMatchObject({ titleId: "DEMO00001", description: "A fictional demo entry.", coverUrl: "https://lh3.googleusercontent.com/demo-cover" });

    // The catalog was fetched once thanks to the storage cache (all calls above).
    expect(b.requests.filter((r) => r.url === DL)).toHaveLength(1);
  });

  it("reads a Google Sheet as CSV", async () => {
    setup({ [SHEET_CSV]: { body: fx("catalog.csv") } }, { catalogUrl: SHEET });
    const cards = await provider.search("", 1);
    expect(cards.map((c) => c.title)).toEqual(["Demo Homebrew", "Sample, Pack", "Empty Row Below"]);
    const d = await provider.load(cards[0].url);
    expect(d.releases.map((r) => r.kind)).toEqual(["game", "update"]);
    expect(d.releases[0].sources[0].parts).toHaveLength(2);
    expect(cards[1].url).toBe(SHEET + "#sample-pack");
  });

  it("cache expires after the TTL and is keyed by URL", async () => {
    const b = setup({ [DL]: { body: fx("catalog.json") } }, { catalogUrl: SHARE });
    const realNow = Date.now;
    try {
      await provider.search("", 1);
      Date.now = () => realNow() + 11 * 60 * 1000;
      await provider.search("", 1);
    } finally {
      Date.now = realNow;
    }
    expect(b.requests.filter((r) => r.url === DL)).toHaveLength(2);
  });

  it("errors clearly on inaccessible catalogs and unknown entries", async () => {
    setup({ [DL]: { status: 404, body: "nope" } }, { catalogUrl: SHARE });
    await expect(provider.search("", 1)).rejects.toThrow(/not accessible.*Anyone with the link/);
    setup({ [DL]: { body: fx("catalog.json") } }, { catalogUrl: SHARE });
    await expect(provider.load(SHARE + "#missing")).rejects.toThrow(/No catalog entry/);
    await expect(provider.load(SHARE)).rejects.toThrow(/missing #id/);
  });
});
