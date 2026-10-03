import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeBridge, type FakeBridge } from "../../../testing/fakeBridge";
import { validateDirectFiles, validateManifest } from "../../../testing/validate";
import * as provider from "../src/index";

const fx = (n: string) => readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const ID = "EXAMPLEID0000000000000000000000001";
const dl = (id: string) => `https://drive.usercontent.google.com/download?id=${id}&export=download`;
const FOLDER_ID = "FOLDERID0000000000000000000000001";
const FOLDER_VIEW = `https://drive.google.com/embeddedfolderview?id=${FOLDER_ID}`;
const HTML = { "content-type": "text/html; charset=utf-8" };

let bridge: FakeBridge | undefined;
const setup = (routes: Parameters<typeof installFakeBridge>[0]["routes"]) => {
  bridge?.restore();
  bridge = installFakeBridge({ manifest: provider.manifest, routes });
  return bridge;
};
afterEach(() => bridge?.restore());

const matches = (url: string) => provider.extractorPatterns.some((p) => new RegExp(p).test(url));

describe("google-drive: manifest and URL shapes", () => {
  it("has a valid extractor manifest", () => {
    expect(validateManifest(provider.manifest, provider.extractorPatterns)).toEqual([]);
    expect(provider.manifest.kinds).toEqual(["extractor"]);
    expect(provider.manifest.allowedHosts).toEqual([
      "drive.google.com",
      "drive.usercontent.google.com",
      "docs.google.com",
      "*.googleusercontent.com",
    ]);
  });

  it("patterns match file and folder links only", () => {
    expect(matches(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(true);
    expect(matches(`https://drive.google.com/open?id=${ID}`)).toBe(true);
    expect(matches(`https://drive.google.com/uc?export=download&id=${ID}`)).toBe(true);
    expect(matches(`https://drive.google.com/drive/folders/${FOLDER_ID}?usp=sharing`)).toBe(true);
    expect(matches(`https://drive.google.com/drive/u/0/folders/${FOLDER_ID}`)).toBe(true);
    expect(matches("https://drive.google.com/drive/my-drive")).toBe(false);
    expect(matches("https://evil.example/https://drive.google.com/file/d/x")).toBe(false);
  });

  it("classifies links", () => {
    expect(provider.parseDriveUrl(`https://drive.google.com/file/d/${ID}/view`)).toEqual({ kind: "file", id: ID });
    expect(provider.parseDriveUrl(`https://drive.google.com/open?id=${ID}`)).toEqual({ kind: "file", id: ID });
    expect(provider.parseDriveUrl(`https://drive.google.com/uc?export=download&id=${ID}`)).toEqual({ kind: "file", id: ID });
    expect(provider.parseDriveUrl(`https://drive.google.com/drive/folders/${FOLDER_ID}`)).toEqual({ kind: "folder", id: FOLDER_ID });
    expect(provider.parseDriveUrl("https://example.com/x")).toBeNull();
  });
});

describe("google-drive: files", () => {
  it("returns the direct URL when Drive serves the file right away", async () => {
    const b = setup({
      [dl(ID)]: {
        status: 206,
        headers: {
          "content-type": "application/octet-stream",
          "content-range": "bytes 0-1023/2097152",
          "content-disposition": `attachment; filename="demo-homebrew.pkg"; filename*=UTF-8''demo-homebrew.pkg`,
        },
        body: "binary",
      },
    });
    const files = await provider.extract(`https://drive.google.com/file/d/${ID}/view?usp=sharing`);
    expect(validateDirectFiles(files)).toEqual([]);
    expect(files).toEqual([{ url: dl(ID), fileName: "demo-homebrew.pkg", sizeBytes: 2097152, headers: null }]);
    expect(b.requests[0].options?.headers?.Range).toBe("bytes=0-1023");
  });

  it("parses the virus-scan confirm page and returns the confirmed URL (+ cookies as headers)", async () => {
    setup({
      [dl(ID)]: { headers: { ...HTML, "set-cookie": "NID=abc123; Path=/; HttpOnly\nAEC=xyz; Path=/" }, body: fx("confirm.html") },
    });
    const files = await provider.extract(`https://drive.google.com/open?id=${ID}`);
    expect(validateDirectFiles(files)).toEqual([]);
    expect(files).toHaveLength(1);
    const [f] = files;
    expect(f.url.startsWith("https://drive.usercontent.google.com/download?")).toBe(true);
    const q = new URL(f.url).searchParams;
    expect(Object.fromEntries(q)).toEqual({
      id: ID,
      export: "download",
      authuser: "0",
      confirm: "t",
      uuid: "11111111-2222-3333-4444-555555555555",
      at: "DEMO_token:123",
    });
    expect(f.fileName).toBe("demo-homebrew.zip");
    expect(f.sizeBytes).toBe(Math.round(1.2 * 1073741824));
    expect(f.headers).toEqual({ Cookie: "NID=abc123; AEC=xyz" });
  });

  it("reports files that are not shared publicly", async () => {
    setup({ [dl(ID)]: { status: 200, headers: HTML, body: fx("denied.html") } });
    await expect(provider.extract(`https://drive.google.com/file/d/${ID}/view`)).rejects.toThrow("Google Drive: file is not shared publicly");
    setup({ [dl(ID)]: { status: 404, headers: HTML, body: "<html>Not Found</html>" } });
    await expect(provider.extract(`https://drive.google.com/file/d/${ID}/view`)).rejects.toThrow(/not shared publicly/);
  });

  it("maps a sign-in redirect (blocked host) to not-shared-publicly", async () => {
    setup({
      [dl(ID)]: () => {
        throw new Error("host not allowed by manifest.allowedHosts: https://accounts.google.com/ServiceLogin");
      },
    });
    await expect(provider.extract(`https://drive.google.com/file/d/${ID}/view`)).rejects.toThrow(/not shared publicly/);
  });

  it("reports quota-exceeded", async () => {
    setup({ [dl(ID)]: { headers: HTML, body: fx("quota.html") } });
    await expect(provider.extract(`https://drive.google.com/file/d/${ID}/view`)).rejects.toThrow("Google Drive: download quota exceeded, try later");
  });

  it("rejects foreign URLs", async () => {
    setup({});
    await expect(provider.extract("https://example.com/a")).rejects.toThrow(/not a Google Drive/);
  });
});

describe("google-drive: folders", () => {
  it("parses entries (files only) and sorts naturally", () => {
    setup({});
    const entries = provider.parseFolderEntries(fx("folder.html"), FOLDER_VIEW);
    expect(entries.map((e) => e.name)).toEqual(["demo.part10.rar", "demo.part2.rar", "demo.part1.rar"]);
    expect(entries.map((e) => e.id)).toEqual(["FILEID_PART10_000000000000000000", "FILEID_PART2_0000000000000000000", "FILEID_PART1_0000000000000000000"]);
    const sorted = entries.map((e) => e.name).sort(provider.naturalCompare);
    expect(sorted).toEqual(["demo.part1.rar", "demo.part2.rar", "demo.part10.rar"]);
  });

  it("returns one directly downloadable file per entry in natural order", async () => {
    const direct = (name: string) => ({
      status: 206,
      headers: { "content-type": "application/octet-stream", "content-range": "bytes 0-1023/5000", "content-disposition": `attachment; filename="${name}"` },
      body: "x",
    });
    const b = setup({
      [FOLDER_VIEW]: { body: fx("folder.html") },
      [dl("FILEID_PART1_0000000000000000000")]: direct("demo.part1.rar"),
      [dl("FILEID_PART2_0000000000000000000")]: direct("demo.part2.rar"),
      [dl("FILEID_PART10_000000000000000000")]: { headers: HTML, body: fx("confirm.html") },
    });
    const files = await provider.extract(`https://drive.google.com/drive/folders/${FOLDER_ID}?usp=sharing`);
    expect(validateDirectFiles(files)).toEqual([]);
    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({ fileName: "demo.part1.rar", sizeBytes: 5000, url: dl("FILEID_PART1_0000000000000000000") });
    expect(files[1].fileName).toBe("demo.part2.rar");
    // part10 needed the confirm step.
    expect(files[2].url).toContain("confirm=t");
    expect(b.requests[0].url).toBe(FOLDER_VIEW);
  });

  it("errors for empty or private folders and names the failing file", async () => {
    setup({ [FOLDER_VIEW]: { body: "<html><body></body></html>" } });
    await expect(provider.extract(`https://drive.google.com/drive/folders/${FOLDER_ID}`)).rejects.toThrow(/empty or not shared publicly/);
    setup({ [FOLDER_VIEW]: { status: 404, body: "x" } });
    await expect(provider.extract(`https://drive.google.com/drive/folders/${FOLDER_ID}`)).rejects.toThrow(/folder is not shared publicly/);
    setup({
      [FOLDER_VIEW]: { body: fx("folder.html") },
      [dl("FILEID_PART1_0000000000000000000")]: { headers: HTML, body: fx("quota.html") },
    });
    await expect(provider.extract(`https://drive.google.com/drive/folders/${FOLDER_ID}`)).rejects.toThrow(/quota exceeded.*demo\.part1\.rar/);
  });
});
