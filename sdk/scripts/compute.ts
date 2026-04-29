/**
 * Sigil Phase 2 — real 0G Compute sealed-inference exercise.
 *
 * Phase 2's `integration.ts` uses a synthetic receipt to skip the 3 OG ledger
 * funding requirement; this script is the missing real-path test. It:
 *   1. Verifies the principal wallet has enough OG.
 *   2. Creates a 0G Compute ledger if one doesn't exist (idempotent — running
 *      twice just confirms the existing balance).
 *   3. Acknowledges the qwen-2.5-7b-instruct provider.
 *   4. Runs one small chat completion through the broker.
 *   5. Logs the full SealedInferenceReceipt + TEE-verification result.
 *   6. Re-verifies the receipt locally (outputHash recomputation).
 *   7. Round-trips the proof envelope through 0G Storage so we know the
 *      Phase 3 demo agents' notarize() path will work end-to-end with a real
 *      receipt instead of a synthetic one.
 *
 *   pnpm --filter sigil-protocol exec tsx scripts/compute.ts
 *
 * Env (read from repo-root .env):
 *   ZERO_G_RPC_URL, ZERO_G_PRIVATE_KEY, ZERO_G_COMPUTE_DEFAULT_MODEL.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
});

import { ethers, keccak256, toUtf8Bytes } from 'ethers';
import { ZeroGComputeAdapter } from '../src/adapters/ZeroGComputeAdapter';
import { ZeroGStorageAdapter } from '../src/adapters/ZeroGStorageAdapter';

const STORAGE_INDEXER_URL = 'https://indexer-storage-testnet-turbo.0g.ai';

function header(t: string) {
  console.log(`\n=== ${t} ===`);
}
function pass(t: string) {
  console.log(`  PASS ${t}`);
}
function info(t: string) {
  console.log(`  · ${t}`);
}
function fail(t: string, err?: unknown): never {
  console.log(`  FAIL ${t}`);
  if (err) console.log('  ', err);
  process.exit(1);
}

async function main() {
  const rpc = process.env.ZERO_G_RPC_URL ?? fail('ZERO_G_RPC_URL not set');
  const principalKey = process.env.ZERO_G_PRIVATE_KEY ?? fail('ZERO_G_PRIVATE_KEY not set');
  const model = process.env.ZERO_G_COMPUTE_DEFAULT_MODEL ?? 'qwen/qwen-2.5-7b-instruct';

  const fetchReq = new ethers.FetchRequest(rpc as string);
  fetchReq.timeout = 60_000;
  const provider = new ethers.JsonRpcProvider(fetchReq, {
    chainId: Number(process.env.ZERO_G_CHAIN_ID ?? '16602'),
    name: '0g-galileo-testnet',
  });
  const signer = new ethers.Wallet(principalKey as string, provider);

  header('Setup');
  info(`signer:  ${signer.address}`);
  const balance = await provider.getBalance(signer.address);
  info(`balance: ${ethers.formatEther(balance)} OG`);
  info(`model:   ${model}`);
  // Broker enforces 3 OG minimum on addLedger; need a buffer for gas too.
  if (balance < ethers.parseEther('3.5')) {
    fail(`signer needs ≥ 3.5 OG (has ${ethers.formatEther(balance)} — fund via https://faucet.0g.ai)`);
  }

  const compute = new ZeroGComputeAdapter({
    signer,
    defaultModel: model,
  });

  header('1. Run sealed inference');
  // Tiny prompt — keep token usage cheap. Output is JSON so the demo agent
  // hash computation matches what RiskScorerAgent will eventually produce.
  const messages = [
    {
      role: 'system' as const,
      content:
        'You are a deterministic risk scoring oracle. Always respond with a single JSON object containing exactly the keys {riskScore, reasoning, confidence}. riskScore is a number in [0,1], confidence is a number in [0,1].',
    },
    {
      role: 'user' as const,
      content:
        'Score the risk of the following synthetic test target: address=0x0000000000000000000000000000000000000001, tvl=$0, utilization=0%, age_days=0. Be terse.',
    },
  ];

  const start = Date.now();
  const result = await compute.runSealedInference({
    model,
    messages,
    maxTokens: 120,
    temperature: 0,
  });
  const elapsedMs = Date.now() - start;
  pass(`inference completed in ${elapsedMs}ms`);
  pass(`provider     = ${result.providerAddress}`);
  pass(`chatID       = ${result.chatID || '(none)'}`);
  pass(`verified     = ${String(result.verified)}`);
  info(`output       = ${result.output.slice(0, 200)}${result.output.length > 200 ? '…' : ''}`);

  header('2. Inspect SealedInferenceReceipt');
  const receipt = result.receipt;
  pass(`modelId            = ${receipt.modelId}`);
  pass(`modelVersionHash   = ${receipt.modelVersionHash}`);
  pass(`inputHash          = ${receipt.inputHash}`);
  pass(`outputHash         = ${receipt.outputHash}`);
  pass(`timestamp          = ${receipt.timestamp}`);
  const envelope = JSON.parse(receipt.proof) as {
    schema: string;
    provider: string;
    providerModel: string;
    chatID: string;
    verified: boolean | null;
    inputHash: string;
    outputHash: string;
    timestamp: number;
  };
  if (envelope.schema !== 'sigil.sealed-inference/1') {
    fail(`unexpected envelope schema: ${envelope.schema}`);
  }
  if (envelope.outputHash !== receipt.outputHash) {
    fail(`envelope.outputHash != receipt.outputHash`);
  }
  pass(`envelope.schema    = ${envelope.schema}`);
  pass(`envelope.provider  = ${envelope.provider}`);

  header('3. Local re-verification');
  const localOk = await compute.verifyReceipt(receipt, result.output);
  if (!localOk) fail('verifyReceipt(receipt, output) returned false');
  pass('outputHash recomputed and matches receipt');

  // Sanity: tampered output must NOT verify.
  const tamperedOk = await compute.verifyReceipt(receipt, result.output + ' tampered');
  if (tamperedOk) fail('verifyReceipt accepted tampered output (security bug)');
  pass('tampered-output rejection works');

  header('4. Round-trip proof envelope through 0G Storage');
  const storage = new ZeroGStorageAdapter({
    indexerUrl: STORAGE_INDEXER_URL,
    evmRpc: rpc as string,
    signer,
  });
  const proofBytes = toUtf8Bytes(receipt.proof);
  const modelFingerprintHash = keccak256(proofBytes);
  const upload = await storage.uploadBytes(proofBytes);
  pass(`proof rootHash         = ${upload.rootHash}`);
  pass(`modelFingerprintHash   = ${modelFingerprintHash}`);
  if (upload.txHash) info(`storage tx             = ${upload.txHash}`);

  const fetched = await storage.downloadBytes(upload.rootHash);
  const fetchedString = Buffer.from(fetched).toString('utf8');
  if (keccak256(toUtf8Bytes(fetchedString)) !== modelFingerprintHash) {
    fail('downloaded proof envelope does not match modelFingerprintHash');
  }
  pass('proof envelope round-trip verified (download keccak == on-chain hash)');

  header('5. Persist receipt to disk');
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.fixtures');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'compute-receipt.json');
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        signer: signer.address,
        provider: result.providerAddress,
        chatID: result.chatID,
        verified: result.verified,
        elapsedMs,
        receipt,
        proofRootHash: upload.rootHash,
        modelFingerprintHash,
        output: result.output,
      },
      null,
      2,
    ),
  );
  pass(`fixture written: ${path.relative(process.cwd(), outFile)}`);

  console.log('\n=== ALL PASS ===');
  console.log('  Use this receipt as a real fixture in Phase 3 demo agents.');
  console.log('  proofRootHash    :', upload.rootHash);
  console.log('  modelFingerprint :', modelFingerprintHash);
  console.log('  verified         :', String(result.verified));
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
