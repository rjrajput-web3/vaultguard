#!/usr/bin/env python3
"""VAULTRY agent brain bridge: Zro (MoonMath) connector <-> /api/agent.

Reads JSON from stdin: {"prompt": str, "model": str, "max_tokens": int}
Prints JSON to stdout: {"ok": true, "text": str} | {"ok": false, "error": str}

The credential lives in the custom.zro connector vault and is NEVER
materialized here — the zro.py helper attaches it via the
dynamic_credentials surrogate on approved outbound requests only.

Fails honestly (ok:false) when the connector is unavailable — e.g. on Vercel
where ~/workspace does not exist. The /api/agent route then falls back to
the deterministic intent parser. Never prints any credential.
"""
import json
import os
import subprocess
import sys


def main() -> int:
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except Exception:
        print(json.dumps({"ok": False, "error": "invalid JSON on stdin"}))
        return 0
    prompt = str(req.get("prompt", ""))[:12000]
    model = str(req.get("model", "zro/glm-5.3-flash"))
    max_tokens = str(int(req.get("max_tokens", 900)))
    if not prompt.strip():
        print(json.dumps({"ok": False, "error": "empty prompt"}))
        return 0
    helper = os.path.expanduser("~/workspace/custom-connectors/custom.zro/bin/zro.py")
    if not os.path.exists(helper):
        print(json.dumps({"ok": False, "error": "zro connector not available on this host"}))
        return 0
    try:
        out = subprocess.run(
            ["python3", helper, "chat", "--model", model, "--prompt", prompt,
             "--max-tokens", max_tokens],
            capture_output=True, text=True, timeout=100,
        )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"bridge error: {type(exc).__name__}"}))
        return 0
    if out.returncode != 0:
        err = (out.stderr or out.stdout or "unknown error")[:300]
        print(json.dumps({"ok": False, "error": f"zro helper failed: {err}"}))
        return 0
    print(json.dumps({"ok": True, "text": out.stdout.strip()}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
