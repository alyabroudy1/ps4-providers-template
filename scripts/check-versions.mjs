#!/usr/bin/env node
// Fails when a provider's source changed without bumping manifest.version.
//
// Works offline against the committed versions.lock, which records {version, sourceHash} per provider as of the
// last release. A provider's sourceHash is the sha256 over every file under providers/<id>/src (Kotlin: kotlin/providers/<id>/src/main
// + manifest.json) (path + LF-normalised
// content), so it does not depend on esbuild or line endings.
//
//   node scripts/check-versions.mjs            check (CI)
//   node scripts/check-versions.mjs --update   record the current state in versions.lock (do this after bumping)
//
// Rules per provider:
//   not in lock                      -> fail: run --update (new provider)
//   same hash, same version          -> ok
//   hash changed, version unchanged  -> FAIL: bump manifest.version
//   version lower than locked        -> FAIL
//   version bumped (any hash)        -> fail until versions.lock is updated and committed (so the next change is
//                                       compared against this release, not an older one)
//   lock entry without a provider    -> fail: run --update (provider removed)

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "versions.lock");
const update = process.argv.includes("--update");

function walk(dir) {
  return readdirSync(dir)
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    })
    .sort();
}

/** Sources of a provider: TS = providers/<id>/src; Kotlin = kotlin/providers/<id>/src/main + manifest.json. */
function sourceHash(id) {
  const h = createHash("sha256");
  const add = (base, f) => {
    h.update(relative(base, f).split("\\").join("/") + "\0");
    h.update(readFileSync(f, "utf8").replace(/\r\n/g, "\n") + "\0");
  };
  if (kotlinIds.includes(id)) {
    const kdir = join(root, "kotlin", "providers", id);
    for (const f of walk(join(kdir, "src", "main"))) add(kdir, f);
    add(kdir, join(kdir, "manifest.json"));
  } else {
    const srcDir = join(root, "providers", id, "src");
    for (const f of walk(srcDir)) add(srcDir, f);
  }
  return h.digest("hex");
}

/** Reads the version: kotlin = manifest.json "version"; TS = `version: N` in the manifest literal of src/index.ts. */
function manifestVersion(id) {
  if (kotlinIds.includes(id)) {
    const v = JSON.parse(readFileSync(join(root, "kotlin", "providers", id, "manifest.json"), "utf8")).version;
    if (!Number.isInteger(v)) throw new Error(`kotlin/providers/${id}/manifest.json: 'version' must be an integer`);
    return v;
  }
  const src = readFileSync(join(root, "providers", id, "src", "index.ts"), "utf8");
  const block = /export\s+const\s+manifest\b[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  const m = block && /\bversion\s*:\s*(\d+)/.exec(block[1]);
  if (!m) throw new Error(`providers/${id}/src/index.ts: cannot find 'version: <integer>' in the manifest`);
  return Number(m[1]);
}

const tsIds = readdirSync(join(root, "providers"))
  .filter((d) => existsSync(join(root, "providers", d, "src", "index.ts")))
  .sort();
const kotlinRoot = join(root, "kotlin", "providers");
const kotlinIds = existsSync(kotlinRoot)
  ? readdirSync(kotlinRoot)
      .filter((d) => existsSync(join(kotlinRoot, d, "manifest.json")) && existsSync(join(kotlinRoot, d, "src", "main")))
      .sort()
  : [];
const ids = [...tsIds, ...kotlinIds].sort();
const current = Object.fromEntries(ids.map((id) => [id, { version: manifestVersion(id), sourceHash: sourceHash(id) }]));

if (update) {
  writeFileSync(lockPath, JSON.stringify(current, null, 2) + "\n");
  console.log(`versions.lock updated for: ${ids.join(", ")}`);
  process.exit(0);
}

const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : {};
const errors = [];
for (const id of ids) {
  const cur = current[id];
  const old = lock[id];
  if (!old) {
    errors.push(`${id}: not in versions.lock (new provider). Run 'npm run check-versions -- --update' and commit versions.lock.`);
  } else if (cur.version < old.version) {
    errors.push(`${id}: version went backwards (${old.version} -> ${cur.version}).`);
  } else if (cur.version === old.version && cur.sourceHash !== old.sourceHash) {
    errors.push(`${id}: source changed but manifest.version is still ${cur.version}. Bump it (then run 'npm run check-versions -- --update').`);
  } else if (cur.version > old.version) {
    errors.push(`${id}: version bumped ${old.version} -> ${cur.version} but versions.lock is stale. Run 'npm run check-versions -- --update' and commit it.`);
  }
}
for (const id of Object.keys(lock)) if (!ids.includes(id)) errors.push(`${id}: in versions.lock but the provider was removed. Run 'npm run check-versions -- --update'.`);

if (errors.length) {
  console.error("check-versions failed:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(`check-versions ok (${ids.length} providers)`);
