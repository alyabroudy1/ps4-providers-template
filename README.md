# PS4 Toolkit providers template

A template repository for **provider extensions** of the PS4 Toolkit Android app (CloudStream-style).
You write small TypeScript providers; CI builds them into versioned JS bundles plus a `repo.json` /
`plugins.json` index on an orphan `builds` branch; users add your repo URL in the app and it installs
and auto-updates the providers. Fixing a broken site = edit, bump the version, push.

The app ships **no repositories and no providers**. What a repo contains is the responsibility of its
author. The two samples here are content-neutral: `demo-catalog` reads a fake homebrew-style
`demo/catalog.json` from this repo, and `github-releases` resolves GitHub Releases links.

```
providers/<id>/src/index.ts     one folder per provider (the folder name must equal manifest.id)
providers/<id>/test/*.test.ts   vitest, with recorded fixtures in test/fixtures (no live network)
providers/<id>/meta.json        optional: description, authors, minAppVersion, status, changelog
types/ps4toolkit-provider.d.ts  bridge + model typings (API v1), copied from the app
testing/                        fake bridge + result validators used by the tests
scripts/build.mjs               esbuild -> dist/<id>.js, sha256, plugins.json, repo.json (+ signing)
scripts/check-versions.mjs      fails if a provider changed without a manifest.version bump
scripts/serve.mjs               serves dist/ for on-device testing
demo/catalog.json               the demo catalog read by demo-catalog
repo.config.json                repo name/description (+ default minAppVersion)
versions.lock                   last released {version, sourceHash} per provider
.github/workflows/build.yml     on push to main: ci checks, build, publish to `builds`
```

## Quick start

```
npm install
npm run typecheck
npm test
npm run build            # -> dist/*.js, dist/plugins.json, dist/repo.json
```

Requires Node 20+.

## Writing a provider (API v1)

1. Copy a sample: `providers/demo-catalog` (catalog) or `providers/github-releases` (extractor), and rename
   the folder. The folder name, `manifest.id` and the output file name are the same string
   (`^[a-z0-9][a-z0-9._-]{0,63}$`).
2. Edit `src/index.ts`. A provider is `export const manifest` plus async functions:

```ts
export const manifest: Manifest = {
  id: "my-site", name: "My site", version: 1, apiVersion: 1,
  kinds: ["catalog"],                    // "catalog" and/or "extractor"
  allowedHosts: ["example.com", "*.example.com"],   // "*.x" = subdomains only, list the apex too
  settings: [{ key: "mirror", label: "Mirror", default: "example.com" }],   // user-editable
};
export async function getHome(page: number): Promise<HomeSection[]> {}       // optional
export async function search(query: string, page: number): Promise<Card[]> {}
export async function load(url: string): Promise<Details> {}
// extractor providers:
export const extractorPatterns = ["^https://files\\.example\\.com/.+"];       // Java regexes
export async function extract(url: string): Promise<DirectFile[]> {}
```

Flow in the app: browse/search (`Card`) -> `load` (`Details` with `Release`s, each with `Source`s whose
`parts` are host links) -> each part is resolved by the matching **extractor** (`extract` ->
`DirectFile`s) -> an app download bundle.

Models: `Card{url,title,coverUrl?,titleId?,region?,badges?}`, `HomeSection{name,cards,hasMore?}`,
`Details{url,title,titleId?,coverUrl?,description?,region?,minFirmware?,sizeBytes?,screenshots?,releases}`,
`Release{label,kind: game|update|dlc|other,version?,sources}`,
`Source{host,label,parts[],archivePassword?,sizeBytes?}`, `DirectFile{url,fileName?,sizeBytes?,headers?}`.
Full types: `types/ps4toolkit-provider.d.ts`.

### The bridge (the only capabilities a provider has)

`http.get/post`, `html.parse` (Jsoup selectors), `crypto` (base64/hex/md5/sha*, AES-CBC/GCM decrypt),
`storage`, `settings`, `log`/`console`, `web.render` (JS-rendered pages; not available in the app yet). There is no
`fetch`, `require`, timers or filesystem.

### Limits (section 27.3)

- Network only to `allowedHosts`, checked on every redirect hop. localhost, private IPs and IPv6 literals are refused.
- HTTP: 5 MB response cap, 20 s per request, 4 requests in flight per provider, own cookie jar per provider.
- Memory 32 MB per context, a per-call wall-clock timeout kills runaway scripts, `eval`/`new Function` are disabled.
- `storage`: 64 KB total. Do not call bridge functions at bundle top level.
- Results are validated strictly (non-empty `title`/`url`, non-empty `parts`, `DirectFile.url` is http(s), at most 500
  cards/files per list). Bad data fails with `INVALID_RESULT` naming the path.

### Bundle convention

`scripts/build.mjs` runs `esbuild --bundle --format=iife --global-name=provider --target=es2020`, so each
bundle is a classic script that assigns a global `provider`. Everything must be bundled (no imports at runtime).

## Testing

`npm test` runs vitest. Tests install `testing/fakeBridge.ts`, which implements the typings with recorded
fixtures (`installFakeBridge({ manifest, routes })`). It enforces `allowedHosts` and throws on any URL without a
recorded route, so tests never touch the network. Save real responses into `test/fixtures/` when a site changes and
add a test for the fix. `testing/validate.ts` checks results the way the app does.

## Versioning

Every change to a provider's `src/` must bump `manifest.version` (integer), otherwise the app never sees the
update. `npm run check-versions` enforces it offline against `versions.lock`:

```
# edit providers/my-site/src/index.ts, bump version: 2 -> 3, then:
npm run check-versions -- --update     # records the new version + source hash in versions.lock
git add -A && git commit && git push
```

CI fails if the source changed without a bump, or if `versions.lock` was not updated.

## Publishing

1. Push this repo to GitHub (any name; the sample default catalog URL has a `YOUR_USER` placeholder in
   `providers/demo-catalog/src/index.ts` - set it to your user/repo, bump the version, or override the
   `catalogUrl` setting in the app).
2. On every push to `main`, `.github/workflows/build.yml` runs typecheck, tests, check-versions and the build, then
   force-pushes `dist/` to the orphan `builds` branch (peaceiris/actions-gh-pages). It sets
   `REPO_RAW_BASE=https://raw.githubusercontent.com/<user>/<repo>/builds`.
3. Your repo URL is `https://raw.githubusercontent.com/<user>/<repo>/builds/repo.json`.

`demo-catalog` reads `demo/catalog.json` from the **`main`** branch (raw URL), so catalog edits go live without a
provider release. Point the `catalogUrl` setting at the `builds` branch instead only if you publish `demo/` there.

## Adding the repo in the app

Settings -> Extensions -> Add repository: paste the raw `repo.json` URL, scan a QR code, or open the deep link

```
ps4toolkit://add-repo?url=https%3A%2F%2Fraw.githubusercontent.com%2F<user>%2F<repo>%2Fbuilds%2Frepo.json
```

(the `url` value should be URL-encoded). The app shows the name/description, the provider count and a third-party
code warning; confirm, then install providers individually or all at once. With auto-update on (default), the app
checks on start (at most hourly) and daily, and installs newer `version`s after verifying `fileSize` + `sha256`
(+ signature).

### How a fix ships

A site changed and a provider broke: edit `providers/<id>/src`, update the fixture and test, bump
`manifest.version`, run `npm run check-versions -- --update`, push to `main`. CI publishes the new build; the next
app start finds the higher version, downloads, verifies and swaps it. No app release.

## Testing on a device before publishing

```
npm run build -- --base http://127.0.0.1:8766
npm run serve                      # serves dist/ on :8766
adb reverse tcp:8766 tcp:8766      # phone's 127.0.0.1:8766 -> this computer
```

Add `http://127.0.0.1:8766/repo.json` in the app (the app allows cleartext/loopback for repo fetches only if its
repo fetcher is configured to; otherwise use `--base http://<lan-ip>:8766`). Bump a provider version, rebuild and
trigger "Check for updates" to see the auto-update. Note that the providers' own network access (allowedHosts)
is separate and always real.

## Signing (optional)

Signed repos let the app pin your key on first add (TOFU) and verify every bundle against it.

```
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out provider-signing.pem
```

Store the PEM contents as the GitHub Actions secret `PROVIDER_SIGNING_KEY` (never commit it; `*.pem` is gitignored).
Locally: `PROVIDER_SIGNING_KEY="$(cat provider-signing.pem)" npm run build`.

When set, the build:

- puts `"signingKey"` in `repo.json`: base64 of the public key as X.509 SubjectPublicKeyInfo DER (Java
  `X509EncodedKeySpec` / `KeyFactory("EC")`);
- adds `"signature"` to every `plugins.json` entry: base64 of the DER-encoded ECDSA P-256 / SHA-256 signature over the
  **UTF-8 bytes of the lowercase hex `sha256` string** of the bundle (Java `Signature("SHA256withECDSA")`, the same
  scheme as the app's `ManifestSignatureVerifier`).

Keep the key stable: a changed key makes users re-confirm.

## Content policy

Repositories are entirely the author's responsibility; the app ships none and does not endorse any. Only
reference content you have the right to distribute. The samples in this template use fictional homebrew-style
entries and public GitHub Releases.
