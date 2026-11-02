/**
 * POST /api/chains/evm-params — read-only tx parameters for client-side signing.
 *
 * Returns { nonce, maxFeePerGas, maxPriorityFeePerGas, gasLimit, chainId } so
 * the browser can build + sign the transaction LOCALLY (keys never leave the
 * device) and then relay the signed bytes via /api/chains/broadcast.
 *
 * Body: { chain: "sepolia"|"base-sepolia", address: "0x…", to: "0x…", value: "<wei decimal string>" }
 */
import { NextRequest, NextResponse } from "next/server";
import { JsonRpcProvider, isAddress } from "ethers";
import { getChain } from "../../../../lib/wallet/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { chain?: string; address?: string; to?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const chain = getChain(String(body.chain ?? ""));
  const address = String(body.address ?? "").trim();
  const to = String(body.to ?? "").trim();
  const value = String(body.value ?? "").trim();
  if (!chain || chain.kind !== "evm" || !chain.chainId) {
    return NextResponse.json({ ok: false, error: `Unsupported EVM chain "${body.chain}"` }, { status: 400 });
  }
  if (!isAddress(address) || !isAddress(to)) {
    return NextResponse.json({ ok: false, error: "Invalid address" }, { status: 400 });
  }
  let valueWei: bigint;
  try {
    valueWei = BigInt(value);
    if (valueWei <= BigInt(0)) throw new Error("non-positive");
  } catch {
    return NextResponse.json({ ok: false, error: "value must be a positive wei amount" }, { status: 400 });
  }
  try {
    const provider = new JsonRpcProvider(chain.rpcUrl, undefined, { staticNetwork: true });
    const [nonce, feeData, net] = await Promise.all([
      provider.getTransactionCount(address, "pending"),
      provider.getFeeData(),
      provider.getNetwork(),
    ]);
    if (Number(net.chainId) !== chain.chainId) {
      return NextResponse.json(
        { ok: false, error: `RPC chain mismatch: expected ${chain.chainId}, got ${net.chainId}` },
        { status: 502 }
      );
    }
    const gasLimit = await provider.estimateGas({ from: address, to, value: valueWei }).catch(() => BigInt(21000));
    return NextResponse.json({
      ok: true,
      nonce,
      chainId: chain.chainId,
      gasLimit: gasLimit.toString(),
      maxFeePerGas: (feeData.maxFeePerGas ?? feeData.gasPrice ?? BigInt(0)).toString(),
      maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? BigInt(0)).toString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Param lookup failed" },
      { status: 502 }
    );
  }
}
