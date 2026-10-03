// Source: PS4 Toolkit app repo, core/provider/src/main/resources/provider-api/ps4toolkit-provider.d.ts
// Provider API version: 1 (IMPLEMENTATION_PLAN.md section 27.2 / 27.3), copied verbatim at app milestone M20a
// (commit 6a8ae9a). Do not edit here: re-copy from the app when the API changes.
//
// PS4 Toolkit provider API v1 - TypeScript typings (IMPLEMENTATION_PLAN.md section 27.2 / 27.3).
//
// Ambient declarations for the globals the app injects into every provider's QuickJS context, plus the
// types a provider bundle exports. Copy this file to types/ps4toolkit-provider.d.ts in a provider repo.
//
// Bundle convention (see docs/provider-api-v1.md): build ONE classic script that assigns a global named
// `provider`, e.g.
//   esbuild src/index.ts --bundle --format=iife --global-name=provider --target=es2020 --outfile=dist/<id>.js
// where src/index.ts has `export const manifest = ...; export async function search(...) ...`.

// ---------------------------------------------------------------------------------------------------------
// Models (what provider functions return; validated strictly by the app)
// ---------------------------------------------------------------------------------------------------------

export type ProviderKind = "catalog" | "extractor";

export interface SettingSpec {
  key: string;
  label?: string;
  /** Used when the user has not set a value. */
  default?: string;
}

export interface Manifest {
  /** Unique within a repo. Must match /^[a-z0-9][a-z0-9._-]{0,63}$/. */
  id: string;
  name: string;
  /** Integer >= 1, bumped on each change. */
  version: number;
  /** Provider API this bundle targets. Must be 1. */
  apiVersion: 1;
  /** "catalog" providers export search + load; "extractor" providers export extract + extractorPatterns. */
  kinds: ProviderKind[];
  /** Network allow-list: "example.com" (exact) or "*.example.com" (any subdomain, NOT the apex). */
  allowedHosts: string[];
  language?: string;
  iconUrl?: string;
  /** User-editable values readable through the global `settings`. */
  settings?: SettingSpec[];
}

export type ReleaseKind = "game" | "update" | "dlc" | "other";

export interface Card {
  url: string;
  title: string;
  coverUrl?: string | null;
  titleId?: string | null;
  region?: string | null;
  badges?: string[] | null;
}

export interface HomeSection {
  name: string;
  cards: Card[];
  hasMore?: boolean;
}

export interface Source {
  host: string;
  label: string;
  /** Host links (non-empty), resolved later by extractor providers. */
  parts: string[];
  archivePassword?: string | null;
  sizeBytes?: number | null;
}

export interface Release {
  label: string;
  kind: ReleaseKind;
  version?: string | null;
  sources: Source[];
}

export interface Details {
  url: string;
  title: string;
  titleId?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  region?: string | null;
  minFirmware?: string | null;
  sizeBytes?: number | null;
  screenshots?: string[] | null;
  releases: Release[];
}

export interface DirectFile {
  /** Must be an http(s) URL. */
  url: string;
  fileName?: string | null;
  sizeBytes?: number | null;
  headers?: Record<string, string> | null;
}

/** The shape of the exported `provider` object. All functions are async and may only use the bridge below. */
export interface Provider {
  manifest: Manifest;
  /** Regexes (Java syntax) of host links `extract` can resolve. Required for "extractor" providers. */
  extractorPatterns?: string[];
  getHome?(page: number): Promise<HomeSection[]>;
  search?(query: string, page: number): Promise<Card[]>;
  load?(url: string): Promise<Details>;
  extract?(url: string): Promise<DirectFile[]>;
}

// ---------------------------------------------------------------------------------------------------------
// Bridge (the only capabilities a provider has). Declared as globals.
// ---------------------------------------------------------------------------------------------------------

export interface HttpOptions {
  headers?: Record<string, string>;
  /** Raw string body. */
  body?: string;
  /** Sent as application/x-www-form-urlencoded (POST). */
  form?: Record<string, string>;
  /** Sent as application/json (POST). */
  json?: unknown;
  /** Default true. When false, a 3xx response is returned as is. */
  followRedirects?: boolean;
  /** Per-request timeout, 1000..20000 ms (default 20000). */
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  /** Lower-cased header names; repeated headers joined with ", " (set-cookie joined with "\n"). */
  headers: Record<string, string>;
  /** Decoded text (charset from Content-Type, default UTF-8). At most 5 MB. */
  body: string;
}

declare global {
  /**
   * HTTP through the app. Hosts are checked against manifest.allowedHosts on every hop (including redirects);
   * localhost/private/IPv6-literal targets are always refused. Each provider has its own cookie jar. At most 4
   * requests in flight per provider. Non-2xx responses are returned, not thrown; policy/transport failures throw.
   */
  const http: {
    get(url: string, options?: HttpOptions): Promise<HttpResponse>;
    post(url: string, options?: HttpOptions): Promise<HttpResponse>;
  };

  interface HtmlElement {
    /** Combined, normalised text of the element and its children. */
    text(): string;
    /** Raw attribute value, or null when absent. */
    attr(name: string): string | null;
    /** Absolute URL of an attribute (resolved against the baseUrl given to html.parse), or "". */
    absUrl(name: string): string;
    /** Inner HTML. */
    html(): string;
    outerHtml(): string;
    /** CSS selector query (Jsoup syntax) over descendants. */
    select(css: string): HtmlElement[];
    selectFirst(css: string): HtmlElement | null;
  }

  /** Jsoup-backed HTML parsing. Handles are valid only during the call that created them. */
  const html: {
    parse(body: string, baseUrl?: string): HtmlElement;
  };

  type CryptoEncoding = "utf8" | "hex" | "base64" | "base64url";

  interface AesOptions {
    data: string;
    key: string;
    iv: string;
    /** GCM only: additional authenticated data (utf8). */
    aad?: string;
    /** Default "base64". For GCM, data is ciphertext followed by the 16-byte tag. */
    dataEncoding?: CryptoEncoding;
    /** Default "utf8". Key must be 16, 24 or 32 bytes. */
    keyEncoding?: CryptoEncoding;
    /** Default "utf8". CBC: 16 bytes. GCM: usually 12 bytes. */
    ivEncoding?: CryptoEncoding;
    /** Default "utf8". */
    outputEncoding?: CryptoEncoding;
    /** CBC only: skip PKCS#7 padding removal. */
    noPadding?: boolean;
  }

  const crypto: {
    convert(data: string, from: CryptoEncoding, to: CryptoEncoding): string;
    /** utf8 text -> base64 */
    base64Encode(text: string): string;
    /** base64 (standard or url-safe, padding optional) -> utf8 text */
    base64Decode(b64: string): string;
    hexEncode(text: string): string;
    hexDecode(hex: string): string;
    /** Digests: input encoding default "utf8", output encoding default "hex". */
    md5(data: string, from?: CryptoEncoding, to?: CryptoEncoding): string;
    sha1(data: string, from?: CryptoEncoding, to?: CryptoEncoding): string;
    sha256(data: string, from?: CryptoEncoding, to?: CryptoEncoding): string;
    sha512(data: string, from?: CryptoEncoding, to?: CryptoEncoding): string;
    /** Throws on wrong key/iv/padding. */
    aesCbcDecrypt(options: AesOptions): string;
    /** Throws when the authentication tag does not verify. */
    aesGcmDecrypt(options: AesOptions): string;
  };

  /** Small per-provider key/value store, at most 64 KB in total (keys + values, UTF-8). set() throws over quota. */
  const storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };

  /** Read-only: user values merged over the manifest's declared defaults (only declared keys). */
  const settings: Readonly<Record<string, string>>;

  /** Goes to the provider log screen. Never log secrets. */
  const log: {
    d(...args: unknown[]): void;
    w(...args: unknown[]): void;
    e(...args: unknown[]): void;
  };

  interface WebRenderOptions {
    waitForSelector?: string;
    timeoutMs?: number;
  }

  interface WebRenderResult {
    html: string;
    /** Final URL (also allow-listed). */
    url: string;
    /** Cookie header value ("a=b; c=d"). */
    cookies: string;
  }

  /** Loads a JS-rendered page in the app's offscreen sandboxed WebView. Same allowedHosts rules as http. */
  const web: {
    render(url: string, options?: WebRenderOptions): Promise<WebRenderResult>;
  };

  /** console.log/debug/info -> log.d, console.warn -> log.w, console.error -> log.e. */
  const console: {
    log(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}
