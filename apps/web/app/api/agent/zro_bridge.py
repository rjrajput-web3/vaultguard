#!/usr/bin/env python3
"""VAULTRY agent brain bridge: LLM connectors <-> /api/agent.

Tries Zro (MoonMath) first, then Gemini as fallback. Reads JSON from stdin:
  {"prompt": str, "model": str, "max_tokens": int}
Prints JSON to stdout:
  {"ok": true, "text": str, "provider": "zro"|"gemini"} |
  {"ok": false, "error": str}

Credentials live in the connector vaults and are NEVER materialized here —
the helpers attach them via the dynamic_credentials surrogate on approved
outbound requests only.

Fails honestly (ok:false) when no connector is available — e.g. on Vercel
where ~/workspace does not exist, or when free-tier budgets are exhausted.
The /api/agent route then serves the deterministic parser. Never prints any
credential.
"""
import json
import os
import subprocess
import sys


def try_helper(helper: str, args: list, prompt: str, model: str, max_tokens: str):
    """Run one connector helper. Returns (ok, text_or_error)."""
    try:
        out = subprocess.run(
            ["python3", helper] + args,
            capture_output=True, text=True, timeout=100,
        )
    except Exception as exc:
        return False, f"bridge error: {type(exc).__name__}"
    if out.returncode != 0:
        err = (out.stderr or out.stdout or "unknown error")[:200]
        return False, f"helper failed: {err}"
    text = out.stdout.strip()
    # detect budget/quota exhaustion inside a 200 response
    low = text.lower()
    if "budget_exceeded" in low or "used all your included credits" in low or "top up" in low:
        return False, "free-tier budget exhausted"
    if "quota" in low and "exceeded" in low:
        return False, "quota exceeded"
    return True, text


def main() -> int:
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except Exception:
        print(json.dumps({"ok": False, "error": "invalid JSON on stdin"}))
        return 0
    prompt = str(req.get("prompt", ""))[:12000]
    max_tokens = str(int(req.get("max_tokens", 900)))
    if not prompt.strip():
        print(json.dumps({"ok": False, "error": "empty prompt"}))
        return 0

    zro = os.path.expanduser("~/workspace/custom-connectors/custom.zro/bin/zro.py")
    gemini = os.path.expanduser("~/workspace/custom-connectors/custom.gemini/bin/gemini.py")
    errors = []

    if os.path.exists(zro):
        ok, res = try_helper(
            zro, ["chat", "--model", "zro/glm-5.3-flash", "--prompt", prompt,
                  "--max-tokens", max_tokens],
            prompt, "zro/glm-5.3-flash", max_tokens,
        )
        if ok:
            print(json.dumps({"ok": True, "text": res, "provider": "zro"}))
            return 0
        errors.append(f"zro: {res}")
    else:
        errors.append("zro: connector not available on this host")

    if os.path.exists(gemini):
        ok, res = try_helper(
            gemini, ["generate", "--model", "gemma-4-26b-a4b-it", "--prompt", prompt,
                     "--max-tokens", max_tokens],
            prompt, "gemma-4-26b-a4b-it", max_tokens,
        )
        if ok:
            print(json.dumps({"ok": True, "text": res, "provider": "gemini"}))
            return 0
        errors.append(f"gemini: {res}")
    else:
        errors.append("gemini: connector not available on this host")

    print(json.dumps({"ok": False, "error": "no LLM available — " + " | ".join(errors)[:300]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
