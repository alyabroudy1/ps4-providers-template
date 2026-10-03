import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFakeBridge, type FakeBridge } from "../../../testing/fakeBridge";
import { validateCards, validateDetails, validateHome, validateManifest } from "../../../testing/validate";
import * as provider from "../src/index";

const CATALOG_URL = "https://raw.githubusercontent.com/YOUR_USER/ps4-providers-template/main/demo/catalog.json";
const fixture = readFileSync(new URL("./fixtures/catalog.json", import.meta.url), "utf8");

let bridge: FakeBridge;
beforeEach(() => {
  bridge = installFakeBridge({
    manifest: provider.manifest,
    routes: { [CATALOG_URL]: { body: fixture } },
  });
});
afterEach(() => bridge.restore());

describe("demo-catalog", () => {
  it("has a valid manifest", () => {
    expect(validateManifest(provider.manifest)).toEqual([]);
    expect(provider.manifest.kinds).toEqual(["catalog"]);
    expect(provider.manifest.allowedHosts).toEqual(["raw.githubusercontent.com", "github.com"]);
  });

  it("getHome groups cards by category", async () => {
    const home = await provider.getHome(1);
    expect(validateHome(home)).toEqual([]);
    expect(home.map((s) => s.name)).toEqual(["Featured", "Tools"]);
    expect(home[1].cards).toHaveLength(2);
    expect(await provider.getHome(2)).toEqual([]);
  });

  it("search filters by title and titleId, empty query lists everything", async () => {
    expect(await provider.search("", 1)).toHaveLength(3);
    const byTitle = await provider.search("tools", 1);
    expect(validateCards(byTitle)).toEqual([]);
    expect(byTitle.map((c) => c.titleId)).toEqual(["DEMO00002"]);
    expect((await provider.search("demo00003", 1)).map((c) => c.title)).toEqual(["Demo Homebrew Sample Pack"]);
    expect(await provider.search("no-such-thing", 1)).toEqual([]);
  });

  it("load returns releases with GitHub release links", async () => {
    const [card] = await provider.search("tools", 1);
    const d = await provider.load(card.url);
    expect(validateDetails(d)).toEqual([]);
    expect(d.title).toBe("Demo Homebrew Tools");
    expect(d.releases).toHaveLength(2);
    expect(d.releases[0].sources[0].parts).toHaveLength(2);
    for (const r of d.releases) {
      for (const part of r.sources[0].parts) {
        expect(part).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/(download|tag)\//);
      }
    }
  });

  it("load rejects unknown ids and non-demo URLs", async () => {
    await expect(provider.load(CATALOG_URL + "#nope")).rejects.toThrow(/no catalog entry/);
    await expect(provider.load("https://github.com/x")).rejects.toThrow(/missing #id/);
  });

  it("honours the catalogUrl setting", async () => {
    bridge.restore();
    const custom = "https://raw.githubusercontent.com/me/fork/main/demo/catalog.json";
    bridge = installFakeBridge({
      manifest: provider.manifest,
      routes: { [custom]: { body: fixture } },
      settings: { catalogUrl: custom },
    });
    expect(await provider.search("", 1)).toHaveLength(3);
    expect(bridge.requests[0].url).toBe(custom);
  });

  it("surfaces HTTP errors", async () => {
    bridge.restore();
    bridge = installFakeBridge({ manifest: provider.manifest, routes: { [CATALOG_URL]: { status: 404, body: "Not Found" } } });
    await expect(provider.search("", 1)).rejects.toThrow(/HTTP 404/);
  });

  it("only uses allowed hosts", async () => {
    bridge.restore();
    bridge = installFakeBridge({ manifest: provider.manifest, routes: {}, settings: { catalogUrl: "https://evil.example/c.json" } });
    await expect(provider.search("", 1)).rejects.toThrow(/not allowed/);
  });
});

describe("demo/catalog.json (the real file)", () => {
  it("matches the recorded fixture and has valid entries", () => {
    const real = readFileSync(new URL("../../../demo/catalog.json", import.meta.url), "utf8");
    expect(JSON.parse(real)).toEqual(JSON.parse(fixture));
    const items = JSON.parse(real).items as { id: string; releases: { parts: string[] }[] }[];
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
    for (const i of items) for (const r of i.releases) expect(r.parts.length).toBeGreaterThan(0);
  });
});
