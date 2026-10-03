import type { DirectFile, Manifest } from "../../../types/ps4toolkit-provider";

export const manifest: Manifest = {
  id: "github-releases",
  name: "GitHub Releases",
  version: 1,
  apiVersion: 1,
  kinds: ["extractor"],
  // api.github.com for release-page links; github.com for download links (resolved without fetching).
  allowedHosts: ["github.com", "api.github.com"],
  language: "en",
};

/** Java-syntax regexes (the app matches them with java.util.regex). */
export const extractorPatterns: string[] = [
  "^https://github\.com/[^/]+/[^/]+/releases/download/[^/]+/[^/?#]+",
  "^https://github\.com/[^/]+/[^/]+/releases/tag/[^/?#]+",
];

const DOWNLOAD_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)/;
const TAG_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/?#]+)/;

interface ApiAsset {
  name: string;
  size?: number;
  browser_download_url: string;
}

export async function extract(url: string): Promise<DirectFile[]> {
  const dl = DOWNLOAD_RE.exec(url);
  if (dl) {
    // A release download link already is a direct file link (GitHub redirects it to the CDN at download time).
    return [{ url: url.split(/[?#]/)[0], fileName: safeDecode(dl[4]) }];
  }
  const tag = TAG_RE.exec(url);
  if (tag) {
    const [, owner, repo, tagName] = tag;
    const res = await http.get(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tagName}`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (res.status === 404) throw new Error(`release tag not found: ${owner}/${repo}@${safeDecode(tagName)}`);
    if (res.status === 403 || res.status === 429) throw new Error("GitHub API rate limit reached, try again later");
    if (res.status !== 200) throw new Error(`GitHub API returned HTTP ${res.status}`);
    const assets: ApiAsset[] = JSON.parse(res.body).assets ?? [];
    const files = assets
      .filter((a) => a.browser_download_url)
      .map((a): DirectFile => ({ url: a.browser_download_url, fileName: a.name, sizeBytes: a.size ?? null }));
    if (files.length === 0) throw new Error("release has no assets");
    return files;
  }
  throw new Error("not a GitHub release URL: " + url);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
