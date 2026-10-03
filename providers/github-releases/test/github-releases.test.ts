import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeBridge, type FakeBridge } from "../../../testing/fakeBridge";
import { validateDirectFiles, validateManifest } from "../../../testing/validate";
import * as provider from "../src/index";

const fx = (n: string) => readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const API = "https://api.github.com/repos/example-org/demo-homebrew-tools/releases/tags/v2.3.0";
const TAG_URL = "https://github.com/example-org/demo-homebrew-tools/releases/tag/v2.3.0";
const DL_URL = "https://github.com/example-org/demo-homebrew-hello/releases/download/v1.0.0/demo-homebrew-hello-1.0.0.pkg";

let bridge: FakeBridge | undefined;
const setup = (routes: Parameters<typeof installFakeBridge>[0]["routes"]) => {
  bridge?.restore();
  bridge = installFakeBridge({ manifest: provider.manifest, routes });
  return bridge;
};
afterEach(() => bridge?.restore());

// The app compiles these with java.util.regex; the syntax used here is identical in JS.
const matches = (url: string) => provider.extractorPatterns.some((p) => new RegExp(p).test(url));

describe("github-releases", () => {
  it("has a valid manifest and patterns", () => {
    expect(validateManifest(provider.manifest, provider.extractorPatterns)).toEqual([]);
    expect(provider.manifest.kinds).toEqual(["extractor"]);
    expect(provider.manifest.allowedHosts).toEqual(["github.com", "api.github.com"]);
  });

  it("patterns match release download/tag links only", () => {
    expect(matches(DL_URL)).toBe(true);
    expect(matches(TAG_URL)).toBe(true);
    expect(matches("https://github.com/example-org/demo/releases")).toBe(false);
    expect(matches("https://github.com/example-org/demo")).toBe(false);
    expect(matches("https://evil.com/github.com/a/b/releases/download/v1/x")).toBe(false);
  });

  it("resolves a download link without any network access", async () => {
    const b = setup({});
    const files = await provider.extract(DL_URL + "?x=1");
    expect(validateDirectFiles(files)).toEqual([]);
    expect(files).toEqual([{ url: DL_URL, fileName: "demo-homebrew-hello-1.0.0.pkg" }]);
    expect(b.requests).toHaveLength(0);
  });

  it("resolves a release tag page through the GitHub API", async () => {
    const b = setup({ [API]: { body: fx("release-tag.json") } });
    const files = await provider.extract(TAG_URL);
    expect(validateDirectFiles(files)).toEqual([]);
    expect(files.map((f) => f.fileName)).toEqual(["demo-homebrew-tools-2.3.0.zip.001", "demo-homebrew-tools-2.3.0.zip.002"]);
    expect(files[0].sizeBytes).toBe(2097152);
    expect(b.requests[0].options?.headers?.Accept).toBe("application/vnd.github+json");
  });

  it("reports missing tags, rate limits and empty releases", async () => {
    setup({ [API]: { status: 404, body: fx("not-found.json") } });
    await expect(provider.extract(TAG_URL)).rejects.toThrow(/not found/);
    setup({ [API]: { status: 403, body: fx("rate-limited.json") } });
    await expect(provider.extract(TAG_URL)).rejects.toThrow(/rate limit/);
    setup({ [API]: { body: JSON.stringify({ assets: [] }) } });
    await expect(provider.extract(TAG_URL)).rejects.toThrow(/no assets/);
  });

  it("rejects foreign URLs", async () => {
    setup({});
    await expect(provider.extract("https://example.com/a")).rejects.toThrow(/not a GitHub release URL/);
  });
});
