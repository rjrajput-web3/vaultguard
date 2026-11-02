#!/usr/bin/env python3
"""VAULTRY network matrix — REAL RPC verification (2026-11-02).
Calls each candidate testnet's public RPC and records: chain id, block height,
latency, faucet URL, explorer. Never assumes — every row is a live call.
Output: JSON printed to stdout.
"""
import json
import time
import urllib.request

# (name, rpc_url, kind, chain_id_expected, faucet, explorer_tx)
CANDIDATES = [
    ("Ethereum Sepolia", "https://ethereum-sepolia-rpc.publicnode.com", "evm", 11155111,
     "https://sepoliafaucet.com | https://stakely.io/faucet",
     "https://sepolia.etherscan.io/tx/{hash}"),
    ("Base Sepolia", "https://base-sepolia-rpc.publicnode.com", "evm", 84532,
     "https://www.alchemy.com/faucets/base-sepolia | https://stakely.io/faucet",
     "https://sepolia.basescan.org/tx/{hash}"),
    ("Arbitrum Sepolia", "https://arbitrum-sepolia-rpc.publicnode.com", "evm", 421614,
     "https://faucet.quicknode.com/arbitrum/sepolia",
     "https://sepolia.arbiscan.io/tx/{hash}"),
    ("Optimism Sepolia", "https://optimism-sepolia-rpc.publicnode.com", "evm", 11155420,
     "https://www.alchemy.com/faucets/optimism-sepolia",
     "https://sepolia-optimism.etherscan.io/tx/{hash}"),
    ("Polygon Amoy", "https://polygon-amoy-bor-rpc.publicnode.com", "evm", 80002,
     "https://faucet.polygon.technology",
     "https://amoy.polygonscan.com/tx/{hash}"),
    ("BNB Chain Testnet", "https://bsc-testnet-rpc.publicnode.com", "evm", 97,
     "https://testnet.bnbchain.org/faucet-smart",
     "https://testnet.bscscan.com/tx/{hash}"),
    ("Avalanche Fuji", "https://avalanche-fuji-c-chain-rpc.publicnode.com", "evm", 43113,
     "https://faucet.avax.network",
     "https://testnet.snowtrace.io/tx/{hash}"),
    ("Solana Devnet", "https://api.devnet.solana.com", "solana", None,
     "https://faucet.solana.com",
     "https://explorer.solana.com/tx/{sig}?cluster=devnet"),
    ("NEAR Testnet", "https://rpc.testnet.fastnear.com", "near", None,
     "https://near-faucet.io | TidePool /api/tidepool/faucet",
     "https://testnet.nearblocks.io/txns/{hash}"),
    # evaluated extras
    ("Sui Testnet", "https://fullnode.testnet.sui.io:443", "sui", None,
     "https://faucet.testnet.sui.io",
     "https://suiscan.xyz/testnet/tx/{hash}"),
    ("Tron Shasta", "https://api.shasta.trongrid.io", "tron", None,
     "https://shasta.tronex.io",
     "https://shasta.tronscan.org/#/transaction/{hash}"),
    ("Bitcoin Testnet", "https://blockstream.info/testnet/api", "bitcoin", None,
     "https://testnet-faucet.mempool.co",
     "https://blockstream.info/testnet/tx/{hash}"),
    ("TON Testnet", "https://testnet.toncenter.com/api/v2/jsonRPC", "ton", None,
     "https://t.me/testgiver_ton_bot",
     "https://testnet.tonscan.org/tx/{hash}"),
]

results = []
for name, rpc, kind, chain_id_exp, faucet, explorer in CANDIDATES:
    row = {"chain": name, "rpc": rpc, "kind": kind,
           "faucet": faucet, "explorer_tx": explorer}
    t0 = time.time()
    try:
        if kind == "evm":
            body = json.dumps({"jsonrpc": "2.0", "id": 1,
                               "method": "eth_chainId", "params": []}).encode()
            req = urllib.request.Request(rpc, data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            got = int(data["result"], 16)
            row["rpc_status"] = "OK" if got == chain_id_exp else f"MISMATCH got={got}"
            row["chain_id"] = got
            # block height
            body2 = json.dumps({"jsonrpc": "2.0", "id": 2,
                                "method": "eth_blockNumber", "params": []}).encode()
            req2 = urllib.request.Request(rpc, data=body2,
                                          headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req2, timeout=20) as r2:
                h = json.loads(r2.read())["result"]
            row["block_height"] = int(h, 16)
        elif kind == "solana":
            body = json.dumps({"jsonrpc": "2.0", "id": 1,
                               "method": "getHealth", "params": []}).encode()
            req = urllib.request.Request(rpc, data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            row["rpc_status"] = "OK" if data.get("result") == "ok" else f"UNHEALTHY {data}"
            body2 = json.dumps({"jsonrpc": "2.0", "id": 2,
                                "method": "getSlot", "params": []}).encode()
            req2 = urllib.request.Request(rpc, data=body2,
                                          headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req2, timeout=20) as r2:
                row["slot"] = json.loads(r2.read())["result"]
        elif kind == "near":
            body = json.dumps({"jsonrpc": "2.0", "id": 1,
                               "method": "status", "params": []}).encode()
            req = urllib.request.Request(rpc, data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            row["rpc_status"] = "OK"
            row["block_height"] = data["result"]["sync_info"]["latest_block_height"]
            row["chain_id"] = data["result"]["chain_id"]
        elif kind == "sui":
            body = json.dumps({"jsonrpc": "2.0", "id": 1,
                               "method": "sui_getLatestCheckpointSequenceNumber",
                               "params": []}).encode()
            req = urllib.request.Request(rpc, data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            row["rpc_status"] = "OK" if "result" in data else f"ERR {data}"
            row["checkpoint"] = data.get("result")
        elif kind == "tron":
            req = urllib.request.Request(
                rpc + "/wallet/getnowblock",
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            blk = data.get("block_header", {}).get("raw_data", {}).get("number")
            row["rpc_status"] = "OK" if blk else "ERR"
            row["block_height"] = blk
        elif kind == "bitcoin":
            req = urllib.request.Request(rpc + "/blocks/tip/height")
            with urllib.request.urlopen(req, timeout=20) as r:
                row["block_height"] = int(r.read().decode().strip())
            row["rpc_status"] = "OK"
        elif kind == "ton":
            body = json.dumps({"id": "1", "jsonrpc": "2.0",
                               "method": "getMasterchainInfo", "params": {}}).encode()
            req = urllib.request.Request(rpc, data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=25) as r:
                data = json.loads(r.read())
            ok = "result" in data
            row["rpc_status"] = "OK" if ok else f"ERR {str(data)[:120]}"
        row["latency_ms"] = int((time.time() - t0) * 1000)
    except Exception as e:
        row["rpc_status"] = f"FAIL: {type(e).__name__}: {str(e)[:120]}"
        row["latency_ms"] = int((time.time() - t0) * 1000)
    results.append(row)

print(json.dumps(results, indent=2))
