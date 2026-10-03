#!/usr/bin/env node
// Builds every provider in providers/<id>/ into dist/<id>.js and generates dist/plugins.json + dist/repo.json
// (IMPLEMENTATION_PLAN.md section 27.4).
//
//   node scripts/build.mjs [--base <url>] [--out dist]
//
// Base URL (where dist/ will be served; used for plugin urls and repo.json pluginLists), in priority order:
//   --base <url>              e.g. --base http://127.0.0.1:8766 for on-device testing (serve dist/ locally)
//   env REPO_RAW_BASE         e.g. https://raw.githubusercontent.com/<user>/<repo>/builds
//   fallback placeholder      (warns)
//
// Signing (optional): env PROVIDER_SIGNING_KEY = PEM of an EC P-256 private key (PKCS#8 or SEC1).
//   signature = base64( DER ECDSA/SHA-256 over the UTF-8 bytes of the lowercase hex sha256 string of the bundle )
//   repo.json.signingKey = base64 of the public key's X.509 SubjectPublicKeyInfo DER.
//   This is the java.security "SHA256withECDSA" + X509EncodedKeySpec wire format the app's
//   ManifestSignatureVerifier uses.

import { build } from "esbuild";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const PLACEHOLDER_BASE = "https://raw.githubusercontent.com/alyabroudy1/ps4-providers-template/builds";
let base = arg("--base") ?? process.env.REPO_RAW_BASE;
if (!base) {
  console.warn(`warning: no --base / REPO_RAW_BASE given, using placeholder ${PLACEHOLDER_BASE}`);
  base = PLACEHOLDER_BASE;
}
base = base.replace(/\/+$/, "");
const outDir = resolve(root, arg("--out") ?? "dist");

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const config = readJson(join(root, "repo.config.json"), {});

// --- signing key -----------------------------------------------------------------------------------------------
let signer = null;
if (process.env.PROVIDER_SIGNING_KEY) {
  const privateKey = createPrivateKey(process.env.PROVIDER_SIGNING_KEY);
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("PROVIDER_SIGNING_KEY must be an EC P-256 (prime256v1) private key");
  }
  const publicKey = createPublicKey(privateKey);
  signer = {
    signingKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    sign(sha256Hex) {
      const message = Buffer.from(sha256Hex, "utf8");
      const sig = sign("sha256", message, privateKey); // DER-encoded, as java.security.Signature expects
      if (!verify("sha256", message, publicKey, sig)) throw new Error("self-check of the signature failed");
      return sig.toString("base64");
    },
  };
}

// --- discover + build ------------------------------------------------------------------------------------------
const providersDir = join(root, "providers");
const ids = readdirSync(providersDir)
  .filter((d) => statSync(join(providersDir, d)).isDirectory() && existsSync(join(providersDir, d, "src", "index.ts")))
  .sort();
// Listing order in plugins.json: repo.config.json "providerOrder" first (in that order), the rest alphabetically.
const order = Array.isArray(config.providerOrder) ? config.providerOrder : [];
const rank = (id) => (order.indexOf(id) >= 0 ? order.indexOf(id) : order.length);
ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
if (ids.length === 0) throw new Error("no providers found in providers/*/src/index.ts");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/** Evaluates a bundle (classic script assigning global `provider`) with no bridge, like the app's manifest read. */
function readProvider(code, file) {
  const sandbox = vm.createContext({});
  new vm.Script(code, { filename: file }).runInContext(sandbox, { timeout: 5000 });
  const p = sandbox.provider;
  if (!p || typeof p !== "object" || !p.manifest) throw new Error(`${file}: bundle does not assign a global 'provider' with a manifest`);
  // Re-parse to leave the vm realm (and drop functions).
  return { manifest: JSON.parse(JSON.stringify(p.manifest)), patterns: JSON.parse(JSON.stringify(p.extractorPatterns ?? [])), fns: Object.keys(p) };
}

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const plugins = [];
for (const id of ids) {
  const outfile = join(outDir, `${id}.js`);
  await build({
    entryPoints: [join(providersDir, id, "src", "index.ts")],
    bundle: true,
    format: "iife",
    globalName: "provider",
    target: "es2020",
    outfile,
    legalComments: "none",
    logLevel: "warning",
  });
  const bytes = readFileSync(outfile);
  const { manifest: m, patterns, fns } = readProvider(bytes.toString("utf8"), `${id}.js`);

  const problems = [];
  if (m.id !== id) problems.push(`manifest.id '${m.id}' must equal the folder name '${id}'`);
  if (!ID_RE.test(m.id)) problems.push("manifest.id has invalid characters");
  if (!Number.isInteger(m.version) || m.version < 1) problems.push("manifest.version must be an integer >= 1");
  if (m.apiVersion !== 1) problems.push("manifest.apiVersion must be 1");
  if (!Array.isArray(m.kinds) || m.kinds.length === 0) problems.push("manifest.kinds must be non-empty");
  if (m.kinds?.includes("catalog") && !(fns.includes("search") && fns.includes("load"))) problems.push("catalog providers must export search and load");
  if (m.kinds?.includes("extractor") && !(fns.includes("extract") && patterns.length > 0)) problems.push("extractor providers must export extract and extractorPatterns");
  if (problems.length) throw new Error(`providers/${id}: ${problems.join("; ")}`);

  const meta = readJson(join(providersDir, id, "meta.json"), {});
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entry = {
    id: m.id,
    name: m.name,
    version: m.version,
    apiVersion: m.apiVersion,
    runtime: "js",
    kinds: m.kinds,
    url: `${base}/${id}.js`,
    sha256,
    fileSize: bytes.length,
    status: meta.status ?? "ok",
    minAppVersion: meta.minAppVersion ?? config.minAppVersion ?? 1,
  };
  if (m.language) entry.language = m.language;
  if (m.iconUrl) entry.iconUrl = m.iconUrl;
  if (meta.authors) entry.authors = meta.authors;
  if (meta.description) entry.description = meta.description;
  if (meta.changelog) entry.changelog = meta.changelog;
  if (signer) entry.signature = signer.sign(sha256);
  plugins.push(entry);
  console.log(`built ${id}.js  v${m.version}  ${bytes.length} bytes  sha256=${sha256.slice(0, 12)}...${signer ? "  signed" : ""}`);
}

const repo = {
  name: config.name ?? "Provider repository",
  description: config.description ?? "",
  manifestVersion: 1,
  pluginLists: [`${base}/plugins.json`],
};
if (signer) repo.signingKey = signer.signingKey;

writeFileSync(join(outDir, "plugins.json"), JSON.stringify(plugins, null, 2) + "\n");
writeFileSync(join(outDir, "repo.json"), JSON.stringify(repo, null, 2) + "\n");
console.log(`wrote ${plugins.length} plugin(s) to ${outDir}`);
console.log(`repo URL: ${base}/repo.json${signer ? "  (signed repo)" : "  (unsigned)"}`);
