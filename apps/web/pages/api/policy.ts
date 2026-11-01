/**
 * VAULTGUARD policy API — reads/writes the guardian's policy JSON.
 *
 * GET  /api/policy -> the current VaultPolicy
 * PUT  /api/policy -> validate + persist (body = VaultPolicy JSON)
 *
 * Uses the Pages Router API format (not App Router route handlers) because
 * Next.js 14.2.18's production minifier drops method detection for App
 * Router handlers that declare a request parameter.
 *
 * The file lives at apps/guardian/config/policy.json (override with
 * VAULTGUARD_POLICY_PATH). The on-chain contract stays the final authority;
 * this is the pre-flight UX layer.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import * as fs from "fs";
import * as path from "path";

const KNOWN_ROUTERS = [
  "nearintents", "lifi", "rango", "1inch", "paraswap", "zerox",
  "okx", "bitget", "binance", "openocean", "cow", "jupiter", "kyber",
];

const DEFAULT_POLICY = {
  vaultId: "vaultguard-demo.near",
  guardian: "guardian.vaultguard-demo.near",
  paused: false,
  maxSpendPerTx: 1000,
  maxSpendPerDay: 5000,
  allowedAssets: [
    "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  ],
  allowedRouters: ["nearintents", "lifi", "1inch", "rango"],
  maxHedgeSlippagePct: 2,
  maxHedgeFeePct: 1,
};

function policyPath(): string {
  const override = process.env.VAULTGUARD_POLICY_PATH;
  if (override) return path.resolve(override);
  return path.resolve(process.cwd(), "..", "guardian", "config", "policy.json");
}

function readPolicy(): Record<string, unknown> {
  const p = policyPath();
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(DEFAULT_POLICY, null, 2) + "\n", "utf8");
    return { ...DEFAULT_POLICY };
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return { ...DEFAULT_POLICY, ...raw };
}

function validate(policy: Record<string, unknown>): string[] {
  const errs: string[] = [];
  const num = (k: string) => Number(policy[k]);
  if (!String(policy.vaultId ?? "").trim()) errs.push("vaultId is required");
  if (!(num("maxSpendPerTx") > 0)) errs.push("maxSpendPerTx must be > 0");
  if (!(num("maxSpendPerDay") > 0)) errs.push("maxSpendPerDay must be > 0");
  if (num("maxSpendPerDay") < num("maxSpendPerTx")) {
    errs.push("maxSpendPerDay should be >= maxSpendPerTx");
  }
  if (num("maxHedgeSlippagePct") < 0 || num("maxHedgeSlippagePct") > 100) {
    errs.push("maxHedgeSlippagePct must be 0–100");
  }
  if (num("maxHedgeFeePct") < 0 || num("maxHedgeFeePct") > 100) {
    errs.push("maxHedgeFeePct must be 0–100");
  }
  for (const a of (policy.allowedAssets as string[]) ?? []) {
    if (!/^[^:]+:[^:]+$/.test(String(a).trim())) {
      errs.push(`allowed asset "${a}" must be "chain:address"`);
    }
  }
  for (const r of (policy.allowedRouters as string[]) ?? []) {
    if (!KNOWN_ROUTERS.includes(String(r).trim().toLowerCase())) {
      errs.push(`unknown router "${r}"`);
    }
  }
  return errs;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({ policy: readPolicy(), knownRouters: KNOWN_ROUTERS });
    }
    if (req.method === "PUT") {
      const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
      const errs = validate(body);
      if (errs.length > 0) return res.status(400).json({ errors: errs });
      const p = policyPath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", "utf8");
      fs.renameSync(tmp, p);
      return res.status(200).json({ ok: true, policy: body });
    }
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
