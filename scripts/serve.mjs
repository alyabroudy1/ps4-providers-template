#!/usr/bin/env node
// Serves dist/ for on-device testing:  node scripts/serve.mjs [port=8766]
// Build first with:  npm run build -- --base http://<your-LAN-ip>:8766
// (127.0.0.1 only works from the phone via `adb reverse tcp:8766 tcp:8766`.)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.argv[2] ?? 8766);
const types = { ".json": "application/json", ".js": "text/javascript; charset=utf-8" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  const file = join(dist, path || "repo.json");
  if (!file.startsWith(dist)) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf("."));
    res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream" }).end(body);
    console.log("200", req.url);
  } catch {
    res.writeHead(404).end("not found");
    console.log("404", req.url);
  }
}).listen(port, "0.0.0.0", () => console.log(`serving ${dist} on http://0.0.0.0:${port}`));
