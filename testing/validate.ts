/**
 * Mirrors the app's strict result validation (ProviderResultParser) closely enough to catch INVALID_RESULT
 * problems in tests. Each function returns a list of problems; empty means valid.
 */
import type { Card, Details, DirectFile, HomeSection, Manifest } from "../types/ps4toolkit-provider";

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_URL = 4 * 1024;
const KINDS = ["game", "update", "dlc", "other"];

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const optStr = (v: unknown) => v === undefined || v === null || typeof v === "string";
const optNum = (v: unknown) => v === undefined || v === null || typeof v === "number";
const isHttp = (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v) && v.length <= MAX_URL;

export function validateManifest(m: Manifest, extractorPatterns?: string[]): string[] {
  const p: string[] = [];
  if (!ID_RE.test(m.id)) p.push("manifest.id must match " + ID_RE);
  if (!isStr(m.name)) p.push("manifest.name must be a non-empty string");
  if (!Number.isInteger(m.version) || m.version < 1) p.push("manifest.version must be an integer >= 1");
  if (m.apiVersion !== 1) p.push("manifest.apiVersion must be 1");
  if (!Array.isArray(m.kinds) || m.kinds.length === 0) p.push("manifest.kinds must be non-empty");
  for (const k of m.kinds ?? []) if (k !== "catalog" && k !== "extractor") p.push(`unknown kind ${k}`);
  if (!Array.isArray(m.allowedHosts)) p.push("manifest.allowedHosts must be an array");
  if (m.kinds?.includes("extractor") && !(extractorPatterns && extractorPatterns.length > 0)) {
    p.push("extractor providers need a non-empty extractorPatterns");
  }
  return p;
}

export function validateCards(cards: Card[], path = "cards"): string[] {
  if (!Array.isArray(cards)) return [`${path} must be an array`];
  const p: string[] = [];
  cards.forEach((c, i) => {
    if (!isStr(c.url)) p.push(`${path}[${i}].url must be a non-empty string`);
    if (!isStr(c.title)) p.push(`${path}[${i}].title must be a non-empty string`);
    if (!optStr(c.coverUrl) || !optStr(c.titleId) || !optStr(c.region)) p.push(`${path}[${i}] has a non-string optional field`);
  });
  return p;
}

export function validateHome(sections: HomeSection[]): string[] {
  if (!Array.isArray(sections)) return ["home must be an array"];
  const p: string[] = [];
  sections.forEach((s, i) => {
    if (!isStr(s.name)) p.push(`home[${i}].name must be a non-empty string`);
    p.push(...validateCards(s.cards, `home[${i}].cards`));
  });
  return p;
}

export function validateDetails(d: Details): string[] {
  const p: string[] = [];
  if (!isStr(d.url)) p.push("details.url must be a non-empty string");
  if (!isStr(d.title)) p.push("details.title must be a non-empty string");
  if (!optNum(d.sizeBytes)) p.push("details.sizeBytes must be a number");
  if (!Array.isArray(d.releases)) return [...p, "details.releases must be an array"];
  d.releases.forEach((r, i) => {
    if (!isStr(r.label)) p.push(`releases[${i}].label must be a non-empty string`);
    if (!KINDS.includes(r.kind)) p.push(`releases[${i}].kind must be one of ${KINDS.join("|")}`);
    if (!Array.isArray(r.sources)) {
      p.push(`releases[${i}].sources must be an array`);
      return;
    }
    r.sources.forEach((s, j) => {
      const at = `releases[${i}].sources[${j}]`;
      if (!isStr(s.host) || !isStr(s.label)) p.push(`${at}.host/label must be non-empty strings`);
      if (!Array.isArray(s.parts) || s.parts.length === 0) p.push(`${at}.parts must be non-empty`);
      else s.parts.forEach((u, k) => isStr(u) || p.push(`${at}.parts[${k}] must be a non-empty string`));
    });
  });
  return p;
}

export function validateDirectFiles(files: DirectFile[]): string[] {
  if (!Array.isArray(files)) return ["files must be an array"];
  const p: string[] = [];
  files.forEach((f, i) => {
    if (!isHttp(f.url)) p.push(`files[${i}].url must be an http(s) URL`);
    if (!optStr(f.fileName) || !optNum(f.sizeBytes)) p.push(`files[${i}] has a wrongly typed optional field`);
  });
  return p;
}
