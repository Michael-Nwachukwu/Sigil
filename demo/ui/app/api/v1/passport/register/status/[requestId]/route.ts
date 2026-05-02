/**
 * GET /api/v1/passport/register/status/:requestId
 *
 * The requesting agent polls this endpoint to learn whether its principal
 * approved the registration. Once approved, the first successful poll that
 * returns status="approved" also delivers the agentPrivateKey — after that
 * keyDelivered=true and the key is never returned again.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  consumeApprovedPrivateKey,
  deleteRegistration,
  getRegistration,
} from "../../../../../../../lib/registration-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { requestId: string } },
) {
  const { requestId } = params;
  const reg = await getRegistration(requestId);

  if (!reg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (reg.expiresAt < Date.now() && reg.status === "pending") {
    await deleteRegistration(requestId, reg.principalAddress);
    return NextResponse.json({ error: "Request expired" }, { status: 410 });
  }

  if (reg.status === "pending") {
    return NextResponse.json({
      status: "pending",
      requestId,
      agentAddress: reg.agentAddress,
      passportId: reg.passportId,
      agentDescription: reg.agentDescription,
      createdAt: reg.createdAt,
      expiresAt: reg.expiresAt,
    });
  }

  // Approved — deliver private key exactly once
  if (reg.status === "approved") {
    if (!reg.keyDelivered) {
      const agentPrivateKey = await consumeApprovedPrivateKey(requestId);
      return NextResponse.json({
        status: "approved",
        requestId,
        passportId: reg.passportId,
        agentAddress: reg.agentAddress,
        ...(agentPrivateKey ? { agentPrivateKey } : {}),
        approvalTxHash: reg.approvalTxHash,
      });
    }
    // Key already delivered — omit it
    return NextResponse.json({
      status: "approved",
      requestId,
      passportId: reg.passportId,
      agentAddress: reg.agentAddress,
      approvalTxHash: reg.approvalTxHash,
    });
  }

  return NextResponse.json({ status: reg.status, requestId });
}
