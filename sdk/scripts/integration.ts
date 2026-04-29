/**
 * Sigil Phase 2 — full register → notarize → resolve integration test.
 *
 * Runs the protocol end-to-end against real 0G Galileo testnet. Skips the
 * 0G Compute step (requires a funded ledger; see scripts/compute.ts) and
 * uses a synthetic SealedInferenceReceipt instead — the goal here is to
 * prove the contracts + storage + crypto + EIP-712 + dual-wallet flow.
 *
 *   pnpm --filter sigil-protocol exec tsx scripts/integration.ts
 *
 * Env (read from repo-root .env):
 *   ZERO_G_RPC_URL, ZERO_G_CHAIN_ID, ZERO_G_PRIVATE_KEY (principal),
 *   SIGIL_REGISTRY_ADDRESS, PROVENANCE_NOTARY_ADDRESS,
 *   ZERO_G_COMPUTE_DEFAULT_MODEL.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
});

import { ethers, keccak256, toUtf8Bytes } from 'ethers';
import { SigilClient } from '../src/SigilClient';
import { ArtifactType } from '../src/types/index';
import type { SealedInferenceReceipt } from '../src/types/index';
import { awaitTx } from '../src/utils/waitForReceipt';

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

function syntheticReceipt(model: string, input: string, output: string): SealedInferenceReceipt {
  const inputHash = keccak256(toUtf8Bytes(input));
  const outputHash = keccak256(toUtf8Bytes(output));
  const proofEnvelope = {
    schema: 'sigil.sealed-inference/1',
    provider: '0xSyntheticProviderForIntegrationTest',
    providerModel: model,
    chatID: 'synthetic-' + Date.now(),
    verified: null,
    inputHash,
    outputHash,
    timestamp: Math.floor(Date.now() / 1000),
    note: 'synthetic receipt — integration test only; real receipts come from 0G Compute',
  };
  return {
    modelId: model,
    modelVersionHash: keccak256(toUtf8Bytes(`${model}@synthetic`)),
    inputHash,
    outputHash,
    proof: JSON.stringify(proofEnvelope),
    timestamp: proofEnvelope.timestamp,
  };
}

async function main() {
  const rpc = process.env.ZERO_G_RPC_URL ?? fail('ZERO_G_RPC_URL not set');
  const chainId = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');
  const principalKey = process.env.ZERO_G_PRIVATE_KEY ?? fail('ZERO_G_PRIVATE_KEY not set');
  const registryAddress = process.env.SIGIL_REGISTRY_ADDRESS ?? fail('SIGIL_REGISTRY_ADDRESS not set');
  const notaryAddress = process.env.PROVENANCE_NOTARY_ADDRESS ?? fail('PROVENANCE_NOTARY_ADDRESS not set');
  const model = process.env.ZERO_G_COMPUTE_DEFAULT_MODEL ?? 'qwen/qwen-2.5-7b-instruct';

  // Galileo RPC nodes are flaky — bump per-request timeout from ethers' 5s
  // default so submissions don't fail mid-flight when nodes lag.
  const fetchReq = new ethers.FetchRequest(rpc as string);
  fetchReq.timeout = 60_000;
  const provider = new ethers.JsonRpcProvider(fetchReq, {
    chainId,
    name: '0g-galileo-testnet',
  });
  const principal = new ethers.Wallet(principalKey as string, provider);

  header('Setup');
  info(`principal: ${principal.address}`);
  info(`balance:   ${ethers.formatEther(await provider.getBalance(principal.address))} OG`);
  info(`registry:  ${registryAddress}`);
  info(`notary:    ${notaryAddress}`);

  // 1. Register agent passport (principal-side).
  header('1. Register agent passport');
  const principalSigil = new SigilClient({
    rpcUrl: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    signer: principal,
    computeDefaultModel: model,
  });

  const registration = await principalSigil.passport.register({
    agentDescription: 'Sigil Phase 2 integration-test agent — synthetic-receipt flow',
    permissions: {
      whitelistedContracts: [],
      maxTxValuePerWindow: { OG: 0 },
      authorizedApis: ['0g.compute'],
      allowedTokens: ['OG'],
      timeWindowSeconds: 3600,
    },
  });
  pass(`passportId      = ${registration.passportId}`);
  pass(`agentAddress    = ${registration.agentAddress}`);
  pass(`manifestRootHash= ${registration.manifestRootHash}`);
  pass(`registerTx      = ${registration.txHash}`);

  // 2. Resolve the on-chain record.
  header('2. Resolve passport on-chain');
  const record = await principalSigil.passport.resolve(registration.passportId);
  if (record.principal.toLowerCase() !== principal.address.toLowerCase()) {
    fail(`principal mismatch: ${record.principal} vs ${principal.address}`);
  }
  if (record.agentAddress.toLowerCase() !== registration.agentAddress.toLowerCase()) {
    fail(`agentAddress mismatch: ${record.agentAddress} vs ${registration.agentAddress}`);
  }
  if (!record.active) fail('record.active is false');
  pass(`record.principal    = ${record.principal}`);
  pass(`record.agentAddress = ${record.agentAddress}`);
  pass(`record.tokenId      = ${record.tokenId}`);
  pass(`record.active       = ${record.active}`);

  // 3. Decrypt + verify manifest.
  header('3. Decrypt permission manifest');
  const manifest = await principalSigil.passport.getManifest(registration.passportId);
  if (manifest.version !== '1') fail(`manifest.version != 1`);
  if (!manifest.agentDescription.includes('integration-test')) {
    fail('agentDescription not round-tripped correctly');
  }
  pass(`manifest.version          = ${manifest.version}`);
  pass(`manifest.agentDescription = ${manifest.agentDescription.slice(0, 50)}…`);

  // 4. Fund the agent so it can broadcast notarize.
  header('4. Fund agent wallet');
  const agent = new ethers.Wallet(registration.agentPrivateKey, provider);
  const fundAmount = ethers.parseEther('0.05');
  const fundTx = await principal.sendTransaction({ to: agent.address, value: fundAmount });
  await awaitTx(fundTx, provider, { label: 'fund-agent' });
  const agentBalance = await provider.getBalance(agent.address);
  pass(`agent ${agent.address} funded with ${ethers.formatEther(agentBalance)} OG`);

  // 5. Notarize a synthetic AI artifact.
  header('5. Notarize artifact (agent-signed)');
  const agentSigil = new SigilClient({
    rpcUrl: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    signer: agent,
    computeDefaultModel: model,
  });

  const inputContext = JSON.stringify({
    task: 'integration-test risk score',
    target: '0x0000000000000000000000000000000000000000',
    timestamp: Date.now(),
  });
  const output = JSON.stringify({
    riskScore: 0.42,
    reasoning: 'synthetic deterministic output for integration test',
    confidence: 0.95,
  });
  const receipt = syntheticReceipt(model, inputContext, output);

  const notarized = await agentSigil.provenance.notarize({
    passportId: registration.passportId,
    inferenceReceipt: receipt,
    inputContext,
    output,
    artifactType: ArtifactType.RISK_ASSESSMENT,
  });
  pass(`recordId             = ${notarized.recordId}`);
  pass(`notarizeTx           = ${notarized.txHash}`);
  pass(`outputHash           = ${notarized.outputHash}`);
  pass(`inputContextHash     = ${notarized.inputContextHash}`);
  pass(`modelFingerprintHash = ${notarized.modelFingerprintHash}`);
  pass(`inputContextRootHash = ${notarized.inputContextRootHash}`);
  pass(`proofRootHash        = ${notarized.proofRootHash}`);

  // 6. Resolve provenance record.
  header('6. Resolve provenance record on-chain');
  const prov = await agentSigil.provenance.resolve(notarized.recordId);
  if (prov.passportId !== registration.passportId) {
    fail(`prov.passportId mismatch: ${prov.passportId} vs ${registration.passportId}`);
  }
  if (prov.principal.toLowerCase() !== principal.address.toLowerCase()) {
    fail(`prov.principal mismatch: ${prov.principal} vs ${principal.address}`);
  }
  if (prov.agent.toLowerCase() !== agent.address.toLowerCase()) {
    fail(`prov.agent mismatch: ${prov.agent} vs ${agent.address}`);
  }
  if (prov.outputHash !== notarized.outputHash) {
    fail(`prov.outputHash mismatch`);
  }
  pass(`prov.passportId  = ${prov.passportId}`);
  pass(`prov.principal   = ${prov.principal}`);
  pass(`prov.agent       = ${prov.agent}`);
  pass(`prov.modelId     = ${prov.modelId}`);
  pass(`prov.blockNumber = ${prov.blockNumber}`);

  // 7. On-chain signature verification.
  header('7. Verify on-chain signature');
  const verification = await agentSigil.provenance.verify(notarized.recordId);
  if (!verification.valid) fail(`verify failed: ${verification.reason}`);
  pass(`verify.valid  = ${verification.valid}`);
  pass(`verify.reason = "${verification.reason}"`);

  // 8. Re-download proof envelope from 0G Storage and confirm fingerprint.
  header('8. Round-trip proof envelope from 0G Storage');
  const fetchedProof = await principalSigil.storage.downloadBytes(notarized.proofRootHash);
  const fetchedString = Buffer.from(fetchedProof).toString('utf8');
  const fetchedHash = keccak256(toUtf8Bytes(fetchedString));
  if (fetchedHash !== notarized.modelFingerprintHash) {
    fail(`proof tampered: fetched=${fetchedHash} vs onChain=${notarized.modelFingerprintHash}`);
  }
  pass(`proof envelope round-tripped; keccak256 matches modelFingerprintHash`);

  console.log('\n=== ALL PASS ===');
  console.log('  passportId :', registration.passportId);
  console.log('  recordId   :', notarized.recordId);
  console.log('  registerTx :', registration.txHash);
  console.log('  notarizeTx :', notarized.txHash);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
