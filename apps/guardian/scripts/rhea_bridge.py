#!/usr/bin/env python3
"""Local bridge: official RHEA SDK <-> authenticated API, honest auth edition.

The official @rhea-finance/cross-chain-aggregation-dex SDK speaks HTTP to
https://api.rhea.finance with `Authorization: Bearer <token>`. The API JWT
lives in the custom.rhea connector vault and is NEVER materialized on this VM
(real credentials are swapped in by the runtime only on approved outbound
requests). So the guardian's TypeScript SDK client does NOT call the API
directly — it calls THIS script through a custom `fetch` shim
(src/rhea-fetch.ts), and this script performs the real HTTP via the
connector helper rhea.py, which attaches the credential through the
dynamic_credentials surrogate.

Commands (all read-only; the bridge has NO build/submit/execute path):
  from-tokens <chain_id>     -> prints full /get_chain_prices envelope JSON
  to-tokens <chain_id>       -> prints full /api/swap/supported_to_tokens envelope JSON
  quote                      -> reads the SDK-serialized quote body from stdin,
                                prints the full /api/v2/swap/quote envelope JSON

Exit 0 on transport success (even when the API envelope carries code != 0 —
the SDK's ApiClient raises API_ERROR for those itself). Exit non-zero only on
transport failure or bad input. Never prints any credential.
"""
import json
import os
import sys

sys.path.insert(0, os.path.expanduser("~/workspace/custom-connectors/custom.rhea/bin"))
import rhea  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: rhea_bridge.py from-tokens|to-tokens|quote ...", file=sys.stderr)
        return 2
    cmd = sys.argv[1]
    try:
        if cmd == "from-tokens":
            data = rhea.from_tokens(sys.argv[2])
        elif cmd == "to-tokens":
            data = rhea.to_tokens(sys.argv[2])
        elif cmd == "quote":
            body = json.loads(sys.stdin.read() or "{}")
            data = rhea.quote(
                body["fromChain"],
                body["toChain"],
                body["tokenIn"],
                body["tokenOut"],
                body["amountIn"],
                slippage_bps=int(body.get("slippage", 50)),
                sender=body.get("sender"),
                recipient=body.get("recipient"),
                quote_waiting_time_ms=body.get("quoteWaitingTimeMs"),
                same_chain_timeout_ms=body.get("sameChainTimeoutMs"),
                cross_chain_timeout_ms=body.get("crossChainTimeoutMs"),
            )
        else:
            print(f"unknown command: {cmd}", file=sys.stderr)
            return 2
    except Exception as exc:  # transport failure -> non-zero, no credential leak
        print(f"rhea_bridge error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(data))
    return 0


if __name__ == "__main__":
    sys.exit(main())
