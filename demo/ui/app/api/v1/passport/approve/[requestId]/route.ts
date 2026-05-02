/**
 * POST /api/v1/passport/approve/:requestId
 *
 * Called by the /approve/:requestId page after the principal has submitted
 * the SigilRegistry.register() transaction from their browser wallet.
 *
 * Body: { txHash: string, passportId: string }
 *
 * The caller must prove they are the registered principal by passing a
 * signature over the requestId. We verify: signature recovers to the stored
 * principalAddress. This prevents a third party from marking an arbitrary
 * request as approved.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "ethers";
import {
  deleteRegistration,
  getRegistration,
  setRegistration,
} from "../../../../../../lib/registration-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string } },
) {
  const { requestId } = params;
  const reg = await getRegistration(requestId);

  if (!reg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (reg.status !== "pending") {
    return NextResponse.json(
      { error: `Request is already ${reg.status}` },
      { status: 409 },
    );
  }
  if (reg.expiresAt < Date.now()) {
    await deleteRegistration(requestId, reg.principalAddress);
    return NextResponse.json({ error: "Request expired" }, { status: 410 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { txHash, passportId, principalSignature } = body as {
    txHash?: string;
    passportId?: string;
    principalSignature?: string;
  };

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json(
      { error: "txHash is required (0x + 64 hex chars)" },
      { status: 400 },
    );
  }
  if (!passportId || !/^0x[0-9a-fA-F]{64}$/.test(passportId)) {
    return NextResponse.json(
      { error: "passportId is required (0x + 64 hex chars)" },
      { status: 400 },
    );
  }
  if (!principalSignature) {
    return NextResponse.json({ error: "principalSignature is required" }, { status: 400 });
  }

  // Verify the signature: principal signed `sigil-approve:${requestId}`
  const message = `sigil-approve:${requestId}`;
  let recovered: string;
  try {
    recovered = verifyMessage(message, principalSignature);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (recovered.toLowerCase() !== reg.principalAddress.toLowerCase()) {
    return NextResponse.json(
      {
        error: `Signature recovers to ${recovered}, expected ${reg.principalAddress}`,
      },
      { status: 403 },
    );
  }

  reg.status = "approved";
  reg.approvalTxHash = txHash;
  // Update passportId in case the contract emitted a different one (shouldn't
  // happen when the pre-computed passportId was passed in, but belt+suspenders).
  if (passportId !== reg.passportId) {
    reg.passportId = passportId;
  }
  await setRegistration(reg);

  return NextResponse.json({ ok: true, passportId: reg.passportId });
}
