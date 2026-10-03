import type { Card, Details, HomeSection, Manifest, Release } from "../../../types/ps4toolkit-provider";

/**
 * Where demo/catalog.json lives. Replace YOUR_USER with your GitHub user/org (or point the user-editable
 * `catalogUrl` setting in the app at any raw URL on an allowed host). Use the `main` branch so catalog edits go
 * live without a provider version bump; use `builds` only if you also publish demo/ there.
 */
const DEFAULT_CATALOG_URL = "https://raw.githubusercontent.com/YOUR_USER/ps4-providers-template/main/demo/catalog.json";

export const manifest: Manifest = {
  id: "demo-catalog",
  name: "Demo Catalog",
  version: 1,
  apiVersion: 1,
  kinds: ["catalog"],
  allowedHosts: ["raw.githubusercontent.com", "github.com"],
  language: "en",
  settings: [{ key: "catalogUrl", label: "Catalog JSON URL", default: DEFAULT_CATALOG_URL }],
};

interface CatalogRelease {
  label: string;
  kind: Release["kind"];
  version?: string;
  host?: string;
  sizeBytes?: number;
  parts: string[];
}

interface CatalogItem {
  id: string;
  title: string;
  titleId?: string;
  region?: string;
  category?: string;
  description?: string;
  coverUrl?: string;
  minFirmware?: string;
  releases: CatalogRelease[];
}

async function fetchCatalog(url: string): Promise<CatalogItem[]> {
  const res = await http.get(url);
  if (res.status !== 200) throw new Error(`catalog returned HTTP ${res.status} for ${url}`);
  let data: { items?: CatalogItem[] };
  try {
    data = JSON.parse(res.body);
  } catch (e) {
    throw new Error(`catalog is not valid JSON: ${(e as Error).message}`);
  }
  if (!data || !Array.isArray(data.items)) throw new Error("catalog has no items[]");
  return data.items;
}

function catalogUrl(): string {
  return settings.catalogUrl || DEFAULT_CATALOG_URL;
}

/** Card URLs are "<catalog url>#<item id>", so load() needs no state and survives app restarts. */
function toCard(base: string, item: CatalogItem): Card {
  return {
    url: `${base}#${encodeURIComponent(item.id)}`,
    title: item.title,
    coverUrl: item.coverUrl ?? null,
    titleId: item.titleId ?? null,
    region: item.region ?? null,
    badges: ["demo"],
  };
}

export async function getHome(page: number): Promise<HomeSection[]> {
  if (page > 1) return [];
  const base = catalogUrl().split("#")[0];
  const items = await fetchCatalog(base);
  const byCategory = new Map<string, Card[]>();
  for (const item of items) {
    const key = item.category || "Demo";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(toCard(base, item));
  }
  return [...byCategory.entries()].map(([name, cards]) => ({ name, cards, hasMore: false }));
}

export async function search(query: string, page: number): Promise<Card[]> {
  if (page > 1) return [];
  const base = catalogUrl().split("#")[0];
  const items = await fetchCatalog(base);
  const q = query.trim().toLowerCase();
  return items
    .filter((i) => !q || i.title.toLowerCase().includes(q) || (i.titleId ?? "").toLowerCase().includes(q))
    .map((i) => toCard(base, i));
}

export async function load(url: string): Promise<Details> {
  const hash = url.indexOf("#");
  if (hash < 0) throw new Error("not a demo-catalog URL (missing #id): " + url);
  const base = url.slice(0, hash);
  const id = decodeURIComponent(url.slice(hash + 1));
  const item = (await fetchCatalog(base)).find((i) => i.id === id);
  if (!item) throw new Error(`no catalog entry with id '${id}'`);
  const releases: Release[] = item.releases.map((r) => ({
    label: r.label,
    kind: r.kind,
    version: r.version ?? null,
    sources: [
      {
        host: r.host || "github.com",
        label: r.parts.length > 1 ? `GitHub Releases (${r.parts.length} parts)` : "GitHub Releases",
        parts: r.parts,
        sizeBytes: r.sizeBytes ?? null,
      },
    ],
  }));
  return {
    url,
    title: item.title,
    titleId: item.titleId ?? null,
    coverUrl: item.coverUrl ?? null,
    description: item.description ?? null,
    region: item.region ?? null,
    minFirmware: item.minFirmware ?? null,
    sizeBytes: item.releases[0]?.sizeBytes ?? null,
    releases,
  };
}
