import type { DirectFile, Manifest } from "../../../types/ps4toolkit-provider";

/**
 * Resolves PUBLIC Google Drive links ("Anyone with the link") to directly downloadable URLs.
 *
 * File: GET https://drive.usercontent.google.com/download?id=<id>&export=download
 *   - binary / non-HTML response  -> that URL is the direct download.
 *   - "can't scan for viruses" HTML page (large files) -> its #download-form is parsed (action + hidden inputs
 *     id/export/confirm/uuid ...) and the confirmed URL is returned. Any cookies Google set on the confirm page
 *     are returned as a `Cookie` header on the DirectFile, so the app's downloader must send DirectFile.headers.
 *   - quota / permission pages -> a clear error.
 *   The probe request sends `Range: bytes=0-1023` so a direct file is not downloaded into the 5 MB http cap.
 * Folder: GET https://drive.google.com/embeddedfolderview?id=<id>, entries sorted naturally by name
 *   (part1 < part2 < part10), each file resolved like a single file. Sub-folders are skipped.
 *
 * Note: the QuickJS runtime has no `URL` class, so URLs are handled with regexes only.
 */
export const manifest: Manifest = {
  id: "google-drive",
  name: "Google Drive",
  version: 1,
  apiVersion: 1,
  kinds: ["extractor"],
  allowedHosts: ["drive.google.com", "drive.usercontent.google.com", "docs.google.com", "*.googleusercontent.com"],
  language: "en",
};

/** Java-syntax regexes (the app matches them with java.util.regex). */
export const extractorPatterns: string[] = [
  "^https://drive\\.google\\.com/file/d/[A-Za-z0-9_-]+",
  "^https://drive\\.google\\.com/(?:open|uc)\\?(?:[^#]*&)?id=[A-Za-z0-9_-]+",
  "^https://drive\\.google\\.com/drive/(?:u/\\d+/)?folders/[A-Za-z0-9_-]+",
  "^https://drive\\.usercontent\\.google\\.com/download\\?(?:[^#]*&)?id=[A-Za-z0-9_-]+",
];

const MAX_FILES = 500;

export type DriveRef = { kind: "file" | "folder"; id: string };

/** Classifies a Drive link; null when it is not a recognised Drive file/folder link. */
export function parseDriveUrl(url: string): DriveRef | null {
  const u = url.trim().split("#")[0];
  let m = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/.exec(u);
  if (m) return { kind: "folder", id: m[1] };
  m = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/.exec(u);
  if (m) return { kind: "file", id: m[1] };
  m = /^https:\/\/drive\.(?:google|usercontent\.google)\.com\/(?:open|uc|download)\?(?:[^#]*&)?id=([A-Za-z0-9_-]+)/.exec(u);
  if (m) return { kind: "file", id: m[1] };
  return null;
}

const NOT_PUBLIC = "Google Drive: file is not shared publicly";
const QUOTA = "Google Drive: download quota exceeded, try later";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Cookie request header from a (newline-joined) set-cookie response header; undefined when none. */
function cookieHeader(setCookie: string | undefined): string | undefined {
  if (!setCookie) return undefined;
  const pairs: string[] = [];
  for (const line of setCookie.split("\n")) {
    const nv = line.split(";")[0].trim();
    if (/^[^=\s]+=.+/.test(nv)) pairs.push(nv);
  }
  return pairs.length ? pairs.join("; ") : undefined;
}

function fileNameFromDisposition(cd: string | undefined): string | undefined {
  if (!cd) return undefined;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(cd);
  return plain ? plain[1].trim() : undefined;
}

function parseSize(text: string): number | undefined {
  const m = /\(\s*([\d.,]+)\s*([KMGT]?)B?\s*\)/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return undefined;
  const mult: Record<string, number> = { "": 1, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 };
  return Math.round(n * mult[m[2].toUpperCase()]);
}

const looksHtml = (ct: string | undefined) => !!ct && /text\/html/i.test(ct);

function assertAccessible(status: number, body: string): void {
  if (/quota exceeded|too many users have (?:viewed|downloaded)|download quota/i.test(body)) throw new Error(QUOTA);
  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    /you need access|request access|sign in to continue|file you have requested does not exist|can't be accessed|Permission denied/i.test(body)
  ) {
    throw new Error(NOT_PUBLIC);
  }
}

async function resolveFile(id: string, knownName?: string): Promise<DirectFile> {
  const downloadUrl = `https://drive.usercontent.google.com/download?id=${id}&export=download`;
  let res;
  try {
    res = await http.get(downloadUrl, { headers: { Range: "bytes=0-1023" } });
  } catch (e) {
    // A private file redirects to the sign-in page (accounts.google.com), which is not an allowed host.
    if (/accounts\.google|not allowed|allowedHosts|denied/i.test(String((e as Error).message))) throw new Error(NOT_PUBLIC);
    throw e;
  }

  if (!looksHtml(res.headers["content-type"])) {
    if (res.status !== 200 && res.status !== 206) throw new Error(`Google Drive returned HTTP ${res.status}`);
    const total = /\/(\d+)\s*$/.exec(res.headers["content-range"] ?? "");
    const length = res.status === 200 ? res.headers["content-length"] : undefined;
    const size = total ? Number(total[1]) : length ? Number(length) : undefined;
    const cookie = cookieHeader(res.headers["set-cookie"]);
    return {
      url: downloadUrl,
      fileName: fileNameFromDisposition(res.headers["content-disposition"]) ?? knownName ?? null,
      sizeBytes: size ?? null,
      headers: cookie ? { Cookie: cookie } : null,
    };
  }

  const body = res.body;
  assertAccessible(res.status, body);

  const doc = html.parse(body, res.url || downloadUrl);
  const form = doc.selectFirst("form#download-form") ?? doc.selectFirst("form[action*=download]");
  if (!form) throw new Error("Google Drive: unexpected response (no download link found); the file may be unavailable");
  const action = decodeEntities(form.absUrl("action") || form.attr("action") || "");
  if (!/^https:\/\//.test(action)) throw new Error("Google Drive: unexpected confirm form");
  const params: string[] = [];
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
    sizeBytes: (nameSize ? parseSize(nameSize.text()) : undefined) ?? null,
    headers: cookie ? { Cookie: cookie } : null,
  };
}

/** Natural, case-insensitive compare: "part2" < "part10". */
export function naturalCompare(a: string, b: string): number {
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

export interface FolderEntry {
  id: string;
  name: string;
}

export function parseFolderEntries(body: string, baseUrl: string): FolderEntry[] {
  const doc = html.parse(body, baseUrl);
  const out: FolderEntry[] = [];
  for (const entry of doc.select(".flip-entry")) {
    const href = entry.selectFirst("a")?.attr("href") ?? "";
    if (/\/folders\//.test(href)) continue; // sub-folders are not followed
    const idFromAttr = /^entry-(.+)$/.exec(entry.attr("id") ?? "");
    const idFromHref = /\/file\/d\/([A-Za-z0-9_-]+)/.exec(href) ?? /[?&]id=([A-Za-z0-9_-]+)/.exec(href);
    const id = idFromHref ? idFromHref[1] : idFromAttr ? idFromAttr[1] : "";
    const name = entry.selectFirst(".flip-entry-title")?.text() ?? "";
    if (!id || !name) continue;
    out.push({ id, name });
  }
  return out;
}

async function resolveFolder(id: string): Promise<DirectFile[]> {
  const url = `https://drive.google.com/embeddedfolderview?id=${id}`;
  let res;
  try {
    res = await http.get(url);
  } catch (e) {
    if (/accounts\.google|not allowed|allowedHosts|denied/i.test(String((e as Error).message))) {
      throw new Error("Google Drive: folder is not shared publicly");
    }
    throw e;
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error("Google Drive: folder is not shared publicly");
  if (res.status !== 200) throw new Error(`Google Drive returned HTTP ${res.status}`);
  const entries = parseFolderEntries(res.body, url).sort((a, b) => naturalCompare(a.name, b.name));
  if (entries.length === 0) throw new Error("Google Drive: folder is empty or not shared publicly");
  const files: DirectFile[] = [];
  for (const e of entries.slice(0, MAX_FILES)) {
    try {
      files.push(await resolveFile(e.id, e.name));
    } catch (err) {
      throw new Error(`${(err as Error).message} (file '${e.name}')`);
    }
  }
  return files;
}

export async function extract(url: string): Promise<DirectFile[]> {
  const ref = parseDriveUrl(url);
  if (!ref) throw new Error("not a Google Drive file or folder URL: " + url);
  return ref.kind === "folder" ? resolveFolder(ref.id) : [await resolveFile(ref.id)];
}
