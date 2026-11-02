/**
 * VAULTRY Privacy module — auditable privacy checks (workstream M3).
 *
 * Two checks, both runnable via `privacy-audit.test.ts`:
 *
 * (a) STATIC — scans the wallet source tree for network-call patterns
 *     (`fetch(`, `new XMLHttpRequest`, `new WebSocket`, `navigator.sendBeacon`)
 *     and FAILS if:
 *       - any network call exists in the designated key-management files
 *         (lib/wallet/keys.ts — the module that generates, encrypts and
 *         stores secrets must never touch the network), or
 *       - any network call's URL or request body references secret material
 *         (secretKey / seedPhrase / mnemonic / privateKey).
 *     Comments are stripped before scanning so documentation mentioning
 *     fetch() cannot cause false positives. Read-only RPC calls carrying
 *     only public parameters PASS, and are listed in the report for
 *     transparency.
 *
 * (b) RUNTIME — `auditOutboundRequest(url, body)` inspects an outbound
 *     payload and flags secret fields / secret-shaped values (blocking)
 *     versus identifier-shaped values like addresses (reported, not
 *     blocking — identifiers are legitimate where functionally required,
 *     and each route documents why in its PRIVACY_NOTE).
 *
 * This file is node-only (uses fs/path for the static scan). It is not
 * imported by browser UI code.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/* ------------------------------------------------------------------ */
/* (a) Static source audit                                             */
/* ------------------------------------------------------------------ */

export interface NetworkCallSite {
  file: string;
  line: number;
  kind: "fetch" | "XMLHttpRequest" | "WebSocket" | "sendBeacon";
  /** One-line excerpt of the call site (comments already stripped). */
  excerpt: string;
  /** True when the call's URL or body references secret material. */
  carriesSecrets: boolean;
  secretEvidence?: string;
}

export interface FileAuditResult {
  file: string;
  isKeyManagement: boolean;
  networkCalls: NetworkCallSite[];
  /** FAIL reasons; empty means the file passed. */
  failures: string[];
}

export interface StaticAuditReport {
  scannedDir: string;
  files: FileAuditResult[];
  passed: boolean;
  summary: string;
}

/**
 * Strip // and block comments while preserving line numbers and
 * leaving string/template literals intact (so "https://…" survives).
 * Documented limitation: ${} interpolations inside template literals
 * are treated as literal text, not code.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let quote: string | null = null;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (quote !== null) {
      out += c;
      if (c === "\\" && i + 1 < n) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && i + 1 < n && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Secret material that must never appear in a URL or request body. */
const SECRET_REF = /\b(privateKey|secretKey|seedPhrase|mnemonic)\b|"(privateKey|secretKey|seedPhrase|mnemonic|password|apiKey)"\s*:/i;

const CALL_PATTERNS: Array<{ kind: NetworkCallSite["kind"]; re: RegExp }> = [
  { kind: "fetch", re: /\bfetch\s*\(/g },
  { kind: "XMLHttpRequest", re: /\bnew\s+XMLHttpRequest\b/g },
  { kind: "WebSocket", re: /\bnew\s+WebSocket\s*\(/g },
  { kind: "sendBeacon", re: /\bnavigator\.sendBeacon\s*\(/g },
];

/** Return the balanced paren/bracket block starting at `openIdx`. */
function balancedBlock(src: string, openIdx: number): string {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const open = src[openIdx];
  const close = pairs[open];
  if (!close) return "";
  let depth = 0;
  let i = openIdx;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (quote !== null) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
    i += 1;
  }
  return src.slice(openIdx);
}

/** Split a call's top-level comma-separated arguments. */
function splitTopLevelArgs(callText: string): string[] {
  // callText starts with the callee name; find the first "("
  const start = callText.indexOf("(");
  if (start < 0) return [];
  const inner = balancedBlock(callText, start).slice(1, -1);
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (quote !== null) {
      cur += c;
      if (c === "\\" && i + 1 < inner.length) {
        cur += inner[i + 1];
        i += 1;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    if (c === "," && depth === 0) {
      args.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  args.push(cur);
  return args;
}

function lineNumberAt(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx; i += 1) if (src[i] === "\n") line += 1;
  return line;
}

function lineTextAt(src: string, idx: number): string {
  const start = src.lastIndexOf("\n", idx - 1) + 1;
  let end = src.indexOf("\n", idx);
  if (end < 0) end = src.length;
  return src.slice(start, end).trim().slice(0, 160);
}

/** Inspect one call site for secret material in its URL / body. */
function inspectCallSite(
  stripped: string,
  matchIdx: number,
  kind: NetworkCallSite["kind"],
): { carriesSecrets: boolean; secretEvidence?: string } {
  if (kind !== "fetch") {
    // XHR/WebSocket/sendBeacon: inspect a ±800-char window conservatively.
    const window = stripped.slice(Math.max(0, matchIdx - 400), matchIdx + 800);
    const m = window.match(SECRET_REF);
    return m
      ? { carriesSecrets: true, secretEvidence: `secret reference near ${kind} call: "${m[0]}"` }
      : { carriesSecrets: false };
  }
  const callText = balancedBlock(stripped, stripped.indexOf("(", matchIdx));
  const args = splitTopLevelArgs(`fetch${callText}`);
  const urlArg = (args[0] ?? "").trim();
  // Find a `body:` value inside the options argument (top-level of arg 2).
  let bodyExpr = "";
  if (args[1]) {
    const optArgs = splitTopLevelArgs(`f(${args[1]})`);
    void optArgs;
    const bodyMatch = args[1].match(/\bbody\s*:/);
    if (bodyMatch && bodyMatch.index !== undefined) {
      const colon = args[1].indexOf(":", bodyMatch.index);
      let j = colon + 1;
      while (j < args[1].length && /\s/.test(args[1][j] ?? "")) j += 1;
      const ch = args[1][j];
      bodyExpr =
        ch === "{" || ch === "[" || ch === "("
          ? balancedBlock(args[1], j)
          : args[1].slice(j, j + 400);
    }
  }
  const haystack = `URL: ${urlArg}\nBODY: ${bodyExpr}`;
  const m = haystack.match(SECRET_REF);
  if (m) {
    return {
      carriesSecrets: true,
      secretEvidence: `secret reference in fetch arguments: "${m[0]}"`,
    };
  }
  return { carriesSecrets: false };
}

function auditSourceFile(
  filePath: string,
  fileName: string,
  isKeyManagement: boolean,
): FileAuditResult {
  const raw = fs.readFileSync(filePath, "utf8");
  const stripped = stripComments(raw);
  const networkCalls: NetworkCallSite[] = [];
  const failures: string[] = [];

  for (const { kind, re } of CALL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      const { carriesSecrets, secretEvidence } = inspectCallSite(stripped, m.index, kind);
      networkCalls.push({
        file: fileName,
        line: lineNumberAt(stripped, m.index),
        kind,
        excerpt: lineTextAt(stripped, m.index),
        carriesSecrets,
        secretEvidence,
      });
      if (carriesSecrets) {
        failures.push(
          `${fileName}:${lineNumberAt(stripped, m.index)} — ${kind} call references secret material (${secretEvidence}). Keys must never leave the device.`,
        );
      }
    }
  }

  if (isKeyManagement && networkCalls.length > 0) {
    failures.push(
      `${fileName} is a designated key-management file but contains ` +
        `${networkCalls.length} network call(s) — key management must be fully offline.`,
    );
  }

  return { file: fileName, isKeyManagement, networkCalls, failures };
}

/**
 * Run the static audit over a wallet source directory.
 * @param walletDir absolute path to apps/web/lib/wallet
 * @param keyManagementFiles basenames that must be fully offline (default: keys.ts)
 */
export function auditWalletSources(
  walletDir: string,
  keyManagementFiles: string[] = ["keys.ts"],
): StaticAuditReport {
  const entries = fs
    .readdirSync(walletDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
  const files = entries.map((f) =>
    auditSourceFile(
      path.join(walletDir, f),
      f,
      keyManagementFiles.includes(f),
    ),
  );
  const failures = files.flatMap((f) => f.failures);
  const passed = failures.length === 0;
  const totalCalls = files.reduce((n, f) => n + f.networkCalls.length, 0);
  return {
    scannedDir: walletDir,
    files,
    passed,
    summary: passed
      ? `PASS — ${files.length} wallet source file(s) scanned, ${totalCalls} network call site(s) found, none in key-management code and none carrying secret material.`
      : `FAIL — ${failures.length} violation(s):\n` + failures.map((f) => `  • ${f}`).join("\n"),
  };
}

/* ------------------------------------------------------------------ */
/* (b) Runtime outbound-request audit                                   */
/* ------------------------------------------------------------------ */

export type OutboundFindingKind = "secret-field" | "secret-value" | "identifier";

export interface OutboundFinding {
  kind: OutboundFindingKind;
  /** Dotted path inside the body, e.g. "body.params[0]" or "<url>". */
  path: string;
  /** Short evidence (values truncated; secrets shown only as shape). */
  evidence: string;
  detail: string;
}

export interface OutboundAuditResult {
  url: string;
  /** False when any secret field/value is present — the request must not be sent. */
  allowed: boolean;
  secrets: OutboundFinding[];
  /** Identifiers (addresses, account IDs, public keys) — reported, not blocking. */
  identifiers: OutboundFinding[];
}

/** Field names (normalized) that must never leave the device. */
const SECRET_FIELD_NAMES = new Set([
  "privatekey",
  "secretkey",
  "seedphrase",
  "mnemonic",
  "password",
  "passwd",
  "apikey",
  "apisecret",
  "clientsecret",
  "bearer",
  "authtoken",
  "secret",
]);

const normalizeField = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Value shapes. */
const RE_EVM_PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const RE_EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RE_NEAR_SECRET = /^ed25519:[1-9A-HJ-NP-Za-km-z]{60,}$/;
const RE_NEAR_PUBLIC = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/;
const RE_NEAR_ACCOUNT = /^[a-z0-9][a-z0-9_-]{1,62}\.(testnet|mainnet|near)$/;
const RE_SOL_SECRET = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const RE_SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RE_SEED_PHRASE = /^([a-z]{3,12}\s+){11}([a-z]{3,12})$|^([a-z]{3,12}\s+){23}([a-z]{3,12})$/;

function classifyStringValue(
  value: string,
  path: string,
): OutboundFinding | null {
  const v = value.trim();
  if (RE_EVM_PRIVATE_KEY.test(v)) {
    return {
      kind: "secret-value",
      path,
      evidence: "0x…(64 hex chars)",
      detail: "Value has the shape of an EVM private key — must never be transmitted.",
    };
  }
  if (RE_NEAR_SECRET.test(v)) {
    return {
      kind: "secret-value",
      path,
      evidence: "ed25519:…(secret-length)",
      detail: "Value has the shape of a NEAR secret key — must never be transmitted.",
    };
  }
  if (RE_SOL_SECRET.test(v)) {
    return {
      kind: "secret-value",
      path,
      evidence: "base58(80–90 chars)",
      detail: "Value has the shape of a Solana secret key — must never be transmitted.",
    };
  }
  if (RE_SEED_PHRASE.test(v.toLowerCase())) {
    return {
      kind: "secret-value",
      path,
      evidence: "(12/24-word phrase — content withheld)",
      detail: "Value has the shape of a BIP39 seed phrase — must never be transmitted.",
    };
  }
  if (
    RE_EVM_ADDRESS.test(v) ||
    RE_NEAR_ACCOUNT.test(v) ||
    RE_NEAR_PUBLIC.test(v) ||
    RE_SOL_ADDRESS.test(v)
  ) {
    return {
      kind: "identifier",
      path,
      evidence: v.length > 24 ? `${v.slice(0, 12)}…${v.slice(-6)}` : v,
      detail:
        "Identifier-shaped value (address / account ID / public key). Legitimate " +
        "only where the destination functionally requires it (see the route's PRIVACY_NOTE).",
    };
  }
  return null;
}

function walkValue(
  value: unknown,
  path: string,
  secrets: OutboundFinding[],
  identifiers: OutboundFinding[],
  depth: number,
): void {
  if (depth > 12) return;
  if (typeof value === "string") {
    const f = classifyStringValue(value, path);
    if (f) (f.kind === "identifier" ? identifiers : secrets).push(f);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkValue(item, `${path}[${i}]`, secrets, identifiers, depth + 1));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${k}` : k;
      if (SECRET_FIELD_NAMES.has(normalizeField(k))) {
        secrets.push({
          kind: "secret-field",
          path: childPath,
          evidence: `field "${k}"`,
          detail: `Field name "${k}" denotes secret material — it must never appear in an outbound payload.`,
        });
        continue; // do not walk the secret's value further
      }
      walkValue(v, childPath, secrets, identifiers, depth + 1);
    }
  }
}

/**
 * Inspect an outbound request before it is sent. Returns allowed=false when
 * secret fields or secret-shaped values are present. Identifiers are
 * reported separately — they do not block, but the caller must have a
 * documented functional reason (PRIVACY_NOTE / DATA_FLOWS).
 */
export function auditOutboundRequest(url: string, body: unknown): OutboundAuditResult {
  const secrets: OutboundFinding[] = [];
  const identifiers: OutboundFinding[] = [];
  // Check the URL itself (addresses in paths / query strings).
  for (const part of url.split(/[/?&=#]/)) {
    const f = classifyStringValue(part, "<url>");
    if (f) (f.kind === "identifier" ? identifiers : secrets).push(f);
  }
  walkValue(body, "body", secrets, identifiers, 0);
  return { url, allowed: secrets.length === 0, secrets, identifiers };
}
