/**
 * GET /api/storage/:rootHash
 *
 * Server-side proxy to 0G Storage. Browsers cannot use the @0gfoundation
 * indexer SDK directly (Node-only deps), so the resolver page calls this
 * route to fetch a content-addressed blob (provenance envelopes, encrypted
 * manifests, encrypted input contexts) and gets raw bytes back.
 *
 * The route is download-only — no signer, no fees. The Indexer's
 * `downloadToBlob` does not require a wallet.
 *
 * Caching: blobs at a given rootHash are immutable by definition (content-
 * addressed), so we set a long max-age. Bad rootHashes get a 4xx with no
 * caching.
 */

import { NextRequest, NextResponse } from "next/server";
import { Indexer } from "@0gfoundation/0g-ts-sdk";

const INDEXER_URL =
  process.env.NEXT_PUBLIC_ZERO_G_INDEXER_URL ??
  "https://indexer-storage-testnet-turbo.0g.ai";

const ROOT_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

// Don't try to pre-render this route at build time — it talks to a live
// network. Force-dynamic also opts out of any output caching.
export const dynamic = "force-dynamic";

let cachedIndexer: Indexer | null = null;
function getIndexer(): Indexer {
  if (!cachedIndexer) cachedIndexer = new Indexer(INDEXER_URL);
  return cachedIndexer;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { rootHash: string } },
) {
  const rootHash = params.rootHash;
  if (!rootHash || !ROOT_HASH_RE.test(rootHash)) {
    return NextResponse.json(
      { error: `bad rootHash "${rootHash}" — expected 0x + 64 hex chars` },
      { status: 400 },
    );
  }

  try {
    const [blob, err] = await getIndexer().downloadToBlob(rootHash);
    if (err || !blob) {
      return NextResponse.json(
        { error: `download failed: ${err?.message ?? "no blob"}` },
        { status: 502 },
      );
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Length": String(bytes.length),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `download threw: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
