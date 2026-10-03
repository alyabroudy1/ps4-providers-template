/**
 * A fake of the app's provider bridge (types/ps4toolkit-provider.d.ts) for offline tests.
 * http is served from a route table of recorded fixtures; it enforces the manifest allowedHosts exactly like the
 * app does (exact host, or "*.x" = subdomain only, never the apex) so a wrong allow-list fails tests, not the phone.
 */
import { createDecipheriv, createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { HttpOptions, HttpResponse, Manifest } from "../types/ps4toolkit-provider";

export type Route = Partial<HttpResponse> | ((url: string, options?: HttpOptions) => Partial<HttpResponse>);

export interface FakeBridgeOptions {
  manifest: Manifest;
  /** Exact URL -> response. Unlisted URLs throw (no live network, ever). */
  routes: Record<string, Route>;
  /** Overrides for manifest.settings defaults. */
  settings?: Record<string, string>;
}

export interface FakeBridge {
  requests: { method: string; url: string; options?: HttpOptions }[];
  logs: string[];
  restore(): void;
}

export function hostAllowed(allowed: string[], url: string): boolean {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return allowed.some((p) => {
    p = p.toLowerCase();
    return p.startsWith("*.") ? host.endsWith(p.slice(1)) && host.length > p.length - 1 : host === p;
  });
}

const GLOBALS = ["http", "html", "crypto", "storage", "settings", "log", "web"] as const;

export function installFakeBridge(opts: FakeBridgeOptions): FakeBridge {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const set = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(g, name));
    Object.defineProperty(g, name, { value, configurable: true, writable: true });
  };
  const requests: FakeBridge["requests"] = [];
  const logs: string[] = [];

  const request = async (method: string, url: string, options?: HttpOptions): Promise<HttpResponse> => {
    requests.push({ method, url, options });
    if (!hostAllowed(opts.manifest.allowedHosts, url)) {
      throw new Error(`host not allowed by manifest.allowedHosts: ${url}`);
    }
    const route = opts.routes[url];
    if (!route) throw new Error(`fake bridge: no recorded response for ${method} ${url}`);
    const r = typeof route === "function" ? route(url, options) : route;
    return { status: 200, url, headers: {}, body: "", ...r };
  };
  set("http", {
    get: (url: string, options?: HttpOptions) => request("GET", url, options),
    post: (url: string, options?: HttpOptions) => request("POST", url, options),
  });

  set("html", {
    parse(body: string, baseUrl?: string) {
      const $ = cheerio.load(body);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrap = (el: any): unknown => ({
        text: () => el.text().replace(/\s+/g, " ").trim(),
        attr: (n: string) => el.attr(n) ?? null,
        absUrl: (n: string) => {
          const v = el.attr(n);
          if (!v) return "";
          try {
            return new URL(v, baseUrl).toString();
          } catch {
            return "";
          }
        },
        html: () => el.html() ?? "",
        outerHtml: () => $.html(el),
        select: (css: string) => el.find(css).toArray().map((e: unknown) => wrap($(e as never))),
        selectFirst: (css: string) => {
          const f = el.find(css).first();
          return f.length ? wrap(f) : null;
        },
      });
      return wrap($.root());
    },
  });

  const enc = (s: string, from = "utf8") => Buffer.from(s, from as BufferEncoding);
  const out = (b: Buffer, to = "utf8") => b.toString(to as BufferEncoding);
  const digest = (algo: string) => (data: string, from?: string, to?: string) =>
    createHash(algo).update(enc(data, from)).digest((to ?? "hex") as "hex");
  const aes = (mode: "cbc" | "gcm") => (o: Record<string, string | boolean | undefined>) => {
    const key = enc(o.key as string, (o.keyEncoding as string) ?? "utf8");
    const iv = enc(o.iv as string, (o.ivEncoding as string) ?? "utf8");
    const data = enc(o.data as string, (o.dataEncoding as string) ?? "base64");
    const alg = `aes-${key.length * 8}-${mode}`;
    const outEnc = (o.outputEncoding as string) ?? "utf8";
    if (mode === "cbc") {
      const d = createDecipheriv(alg as "aes-128-cbc", key, iv);
      if (o.noPadding) d.setAutoPadding(false);
      return out(Buffer.concat([d.update(data), d.final()]), outEnc);
    }
    const d = createDecipheriv(alg as "aes-128-gcm", key, iv);
    if (o.aad) d.setAAD(enc(o.aad as string));
    d.setAuthTag(data.subarray(data.length - 16));
    return out(Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]), outEnc);
  };
  set("crypto", {
    convert: (d: string, from: string, to: string) => out(enc(d, from), to),
    base64Encode: (t: string) => Buffer.from(t, "utf8").toString("base64"),
    base64Decode: (b: string) => Buffer.from(b, "base64").toString("utf8"),
    hexEncode: (t: string) => Buffer.from(t, "utf8").toString("hex"),
    hexDecode: (h: string) => Buffer.from(h, "hex").toString("utf8"),
    md5: digest("md5"),
    sha1: digest("sha1"),
    sha256: digest("sha256"),
    sha512: digest("sha512"),
    aesCbcDecrypt: aes("cbc"),
    aesGcmDecrypt: aes("gcm"),
  });

  const store = new Map<string, string>();
  set("storage", {
    get: (k: string) => store.get(k) ?? null,
    set: (k: string, v: string) => void store.set(k, v),
    remove: (k: string) => void store.delete(k),
  });

  const defaults: Record<string, string> = {};
  for (const s of opts.manifest.settings ?? []) if (s.default !== undefined) defaults[s.key] = s.default;
  set("settings", Object.freeze({ ...defaults, ...(opts.settings ?? {}) }));

  const logger = (lvl: string) => (...a: unknown[]) => void logs.push(`${lvl} ${a.map(String).join(" ")}`);
  set("log", { d: logger("D"), w: logger("W"), e: logger("E") });
  set("web", {
    render() {
      throw new Error("web.render is not available in the fake bridge");
    },
  });

  return {
    requests,
    logs,
    restore() {
      for (const name of GLOBALS) {
        const d = saved.get(name);
        if (d) Object.defineProperty(g, name, d);
        else delete g[name];
      }
    },
  };
}
