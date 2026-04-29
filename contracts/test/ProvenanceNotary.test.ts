import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { ProvenanceNotary, SigilRegistry } from '../typechain-types';
import { ARTIFACT, derivePassportId, signNotarization } from './helpers';

const SAMPLE_MANIFEST = ethers.id('manifest-v1');
const SAMPLE_URI = 'og-storage://sigil/manifest/v1.json';

async function deployFixture() {
  const [owner, principal, agent, otherAgent, attacker] = await ethers.getSigners();

  const Registry = await ethers.getContractFactory('SigilRegistry');
  const registry = (await Registry.deploy(owner.address)) as unknown as SigilRegistry;
  await registry.waitForDeployment();

  const Notary = await ethers.getContractFactory('ProvenanceNotary');
  const notary = (await Notary.deploy(await registry.getAddress())) as unknown as ProvenanceNotary;
  await notary.waitForDeployment();

  await registry.connect(owner).setProvenanceNotary(await notary.getAddress());

  const blockNumber = await ethers.provider.getBlockNumber();
  const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);

  await registry
    .connect(principal)
    .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

  const { chainId } = await ethers.provider.getNetwork();

  return {
    registry,
    notary,
    notaryAddress: await notary.getAddress(),
    chainId,
    owner,
    principal,
    agent,
    otherAgent,
    attacker,
    passportId,
  };
}

interface NotarizePayload {
  passportId: string;
  modelFingerprintHash: string;
  modelId: string;
  inputContextHash: string;
  inputContextSize: bigint;
  outputHash: string;
  artifactType: number;
  nonce: bigint;
  signedTimestamp: bigint;
  agentSignature: string;
  executionFingerprintRef: string;
}

function buildPayload(overrides: Partial<NotarizePayload>): NotarizePayload {
  return {
    passportId: overrides.passportId!,
    modelFingerprintHash: overrides.modelFingerprintHash ?? ethers.id('model-fp-1'),
    modelId: overrides.modelId ?? 'qwen-2.5-7b-instruct',
    inputContextHash: overrides.inputContextHash ?? ethers.id('input-1'),
    inputContextSize: overrides.inputContextSize ?? 4096n,
    outputHash: overrides.outputHash ?? ethers.id('output-1'),
    artifactType: overrides.artifactType ?? ARTIFACT.CODE_AUDIT,
    nonce: overrides.nonce ?? 0n,
    signedTimestamp: overrides.signedTimestamp ?? 0n,
    agentSignature: overrides.agentSignature ?? '0x',
    executionFingerprintRef: overrides.executionFingerprintRef ?? ethers.ZeroHash,
  };
}

describe('ProvenanceNotary', () => {
  describe('deployment', () => {
    it('exposes domain separator and notarization typehash', async () => {
      const { notary } = await loadFixture(deployFixture);
      const expectedTypehash = ethers.keccak256(
        ethers.toUtf8Bytes(
          'Notarization(bytes32 passportId,bytes32 outputHash,bytes32 inputContextHash,bytes32 modelFingerprintHash,uint256 nonce,uint256 timestamp)',
        ),
      );
      expect(await notary.NOTARIZATION_TYPEHASH()).to.equal(expectedTypehash);
      expect(await notary.DOMAIN_SEPARATOR()).to.not.equal(ethers.ZeroHash);
    });

    it('reverts construction with zero registry', async () => {
      const Notary = await ethers.getContractFactory('ProvenanceNotary');
      await expect(Notary.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        Notary,
        'ZeroAddress',
      );
    });
  });

  describe('notarize — happy path', () => {
    it('emits ArtifactNotarized, increments nonce + provenance count, indexes by output and agent', async () => {
      const { registry, notary, notaryAddress, chainId, agent, principal, passportId } =
        await loadFixture(deployFixture);

      const ts = BigInt(await time.latest());
      const payload = buildPayload({ passportId, signedTimestamp: ts });
      payload.agentSignature = await signNotarization({
        agent,
        notaryAddress,
        chainId,
        passportId,
        outputHash: payload.outputHash,
        inputContextHash: payload.inputContextHash,
        modelFingerprintHash: payload.modelFingerprintHash,
        nonce: payload.nonce,
        timestamp: payload.signedTimestamp,
      });

      const expectedRecordId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'address', 'bytes32', 'uint256', 'uint256'],
          [passportId, agent.address, payload.outputHash, payload.nonce, payload.signedTimestamp],
        ),
      );

      await expect(
        notary
          .connect(agent)
          .notarize(
            payload.passportId,
            payload.modelFingerprintHash,
            payload.modelId,
            payload.inputContextHash,
            payload.inputContextSize,
            payload.outputHash,
            payload.artifactType,
            payload.nonce,
            payload.signedTimestamp,
            payload.agentSignature,
            payload.executionFingerprintRef,
          ),
      )
        .to.emit(notary, 'ArtifactNotarized')
        .withArgs(
          expectedRecordId,
          passportId,
          agent.address,
          principal.address,
          payload.outputHash,
          payload.inputContextHash,
          payload.modelFingerprintHash,
          payload.artifactType,
          payload.nonce,
          payload.signedTimestamp,
        );

      expect(await notary.signerNonces(agent.address)).to.equal(1n);
      expect(await notary.resolveByOutput(payload.outputHash)).to.equal(expectedRecordId);
      expect(await notary.recordCountByAgent(passportId)).to.equal(1n);
      expect((await registry.resolve(passportId)).provenanceRecordCount).to.equal(1n);

      const rec = await notary.resolve(expectedRecordId);
      expect(rec.recordId).to.equal(expectedRecordId);
      expect(rec.passportId).to.equal(passportId);
      expect(rec.agent).to.equal(agent.address);
      expect(rec.principal).to.equal(principal.address);
      expect(rec.modelId).to.equal(payload.modelId);
      expect(rec.outputHash).to.equal(payload.outputHash);
      expect(rec.nonce).to.equal(payload.nonce);
      expect(rec.timestamp).to.equal(payload.signedTimestamp);

      const [valid, reason] = await notary.verify(expectedRecordId);
      expect(valid).to.equal(true);
      expect(reason).to.equal('');
    });

    it('paginates recordsByAgent correctly', async () => {
      const { notary, notaryAddress, chainId, agent, passportId } =
        await loadFixture(deployFixture);

      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const ts = BigInt(await time.latest());
        const payload = buildPayload({
          passportId,
          signedTimestamp: ts,
          nonce: BigInt(i),
          outputHash: ethers.id(`output-${i}`),
        });
        payload.agentSignature = await signNotarization({
          agent,
          notaryAddress,
          chainId,
          passportId,
          outputHash: payload.outputHash,
          inputContextHash: payload.inputContextHash,
          modelFingerprintHash: payload.modelFingerprintHash,
          nonce: payload.nonce,
          timestamp: payload.signedTimestamp,
        });
        await notary
          .connect(agent)
          .notarize(
            payload.passportId,
            payload.modelFingerprintHash,
            payload.modelId,
            payload.inputContextHash,
            payload.inputContextSize,
            payload.outputHash,
            payload.artifactType,
            payload.nonce,
            payload.signedTimestamp,
            payload.agentSignature,
            payload.executionFingerprintRef,
          );
        ids.push(await notary.resolveByOutput(payload.outputHash));
      }

      expect(await notary.recordCountByAgent(passportId)).to.equal(3n);

      const page0 = await notary.recordsByAgent(passportId, 0, 2);
      expect(page0.length).to.equal(2);
      expect(page0[0]).to.equal(ids[0]);
      expect(page0[1]).to.equal(ids[1]);

      const page1 = await notary.recordsByAgent(passportId, 2, 5);
      expect(page1.length).to.equal(1);
      expect(page1[0]).to.equal(ids[2]);

      const overflow = await notary.recordsByAgent(passportId, 10, 5);
      expect(overflow.length).to.equal(0);
    });
  });

  describe('notarize — reverts', () => {
    it('reverts when caller is not authorized signer for the passport', async () => {
      const { notary, notaryAddress, chainId, attacker, passportId } =
        await loadFixture(deployFixture);

      const ts = BigInt(await time.latest());
      const payload = buildPayload({ passportId, signedTimestamp: ts });
      // Sign with attacker wallet (not the registered agent).
      payload.agentSignature = await signNotarization({
        agent: attacker,
        notaryAddress,
        chainId,
        passportId,
        outputHash: payload.outputHash,
        inputContextHash: payload.inputContextHash,
        modelFingerprintHash: payload.modelFingerprintHash,
        nonce: payload.nonce,
        timestamp: payload.signedTimestamp,
      });

      await expect(
        notary
          .connect(attacker)
          .notarize(
            payload.passportId,
            payload.modelFingerprintHash,
            payload.modelId,
            payload.inputContextHash,
            payload.inputContextSize,
            payload.outputHash,
            payload.artifactType,
            payload.nonce,
            payload.signedTimestamp,
            payload.agentSignature,
            payload.executionFingerprintRef,
          ),
      ).to.be.revertedWithCustomError(notary, 'NotAuthorizedSigner');
    });

    it('reverts when nonce does not match signerNonces', async () => {
      const { notary, notaryAddress, chainId, agent, passportId } =
        await loadFixture(deployFixture);

      const ts = BigInt(await time.latest());
      const payload = buildPayload({ passportId, signedTimestamp: ts, nonce: 5n });
      payload.agentSignature = await signNotarization({
        agent,
        notaryAddress,
        chainId,
        passportId,
        outputHash: payload.outputHash,
        inputContextHash: payload.inputContextHash,
        modelFingerprintHash: payload.modelFingerprintHash,
        nonce: payload.nonce,
        timestamp: payload.signedTimestamp,
      });

      await expect(
        notary
          .connect(agent)
          .notarize(
            payload.passportId,
            payload.modelFingerprintHash,
            payload.modelId,
            payload.inputContextHash,
            payload.inputContextSize,
            payload.outputHash,
            payload.artifactType,
            payload.nonce,
            payload.signedTimestamp,
            payload.agentSignature,
            payload.executionFingerprintRef,
          ),
      ).to.be.revertedWithCustomError(notary, 'InvalidNonce');
    });

    it('reverts when signature is from someone other than msg.sender', async () => {
      const { notary, notaryAddress, chainId, agent, attacker, passportId } =
        await loadFixture(deployFixture);

      const ts = BigInt(await time.latest());
      const payload = buildPayload({ passportId, signedTimestamp: ts });
      payload.agentSignature = await signNotarization({
        agent: attacker, // signed by attacker
        notaryAddress,
        chainId,
        passportId,
        outputHash: payload.outputHash,
        inputContextHash: payload.inputContextHash,
        modelFingerprintHash: payload.modelFingerprintHash,
        nonce: payload.nonce,
        timestamp: payload.signedTimestamp,
      });

      // Sent by the registered agent, but signed by attacker → InvalidSignature.
      await expect(
        notary
          .connect(agent)
          .notarize(
            payload.passportId,
            payload.modelFingerprintHash,
            payload.modelId,
            payload.inputContextHash,
            payload.inputContextSize,
            payload.outputHash,
            payload.artifactType,
            payload.nonce,
            payload.signedTimestamp,
            payload.agentSignature,
            payload.executionFingerprintRef,
          ),
      ).to.be.revertedWithCustomError(notary, 'InvalidSignature');
    });

    it('reverts on signedTimestamp out of drift window', async () => {
      const { notary, notaryAddress, chainId, agent, passportId } =
        await loadFixture(deployFixture);

      const future = BigInt(await time.latest()) + 60n * 60n; // +1h
      const payload = buildPayload({ passportId, signedTimestamp: future });
      payload.agentSignature = await signNotarization({
        agent,
        notaryAddress,
        chainId,
        passportId,
        outputHash: payload.outputHash,
        inputContextHash: payload.inputContextHash,
        modelFingerprintHash: payload.modelFingerprintHash,
        nonce: payload.nonce,
        timestamp: payload.signedTimestamp,
      });

      await expect(
        notary
          .connect(agent)
          .notarize(
            payload.passportId,
            payload.modelFingerprintHash,
            payload.modelId,
            payload.inputContextHash,
            payload.inputContextSize,
            payload.outputHash,
            payload.artifactType,
            payload.nonce,
            payload.signedTimestamp,
            payload.agentSignature,
            payload.executionFingerprintRef,
          ),
      ).to.be.revertedWithCustomError(notary, 'TimestampOutOfRange');
    });

    it('rejects replay on the same outputHash', async () => {
      const { notary, notaryAddress, chainId, agent, passportId } =
        await loadFixture(deployFixture);

      const ts = BigInt(await time.latest());
      const payload = buildPayload({ passportId, signedTimestamp: ts });
      payload.agentSignature = await signNotarization({
        agent,
        notaryAddress,
        chainId,
        passportId,
        outputHash: payload.outputHash,
        inputContextHash: payload.inputContextHash,
        modelFingerprintHash: payload.modelFingerprintHash,
        nonce: payload.nonce,
        timestamp: payload.signedTimestamp,
      });

      await notary
        .connect(agent)
        .notarize(
          payload.passportId,
          payload.modelFingerprintHash,
          payload.modelId,
          payload.inputContextHash,
          payload.inputContextSize,
          payload.outputHash,
          payload.artifactType,
          payload.nonce,
          payload.signedTimestamp,
          payload.agentSignature,
          payload.executionFingerprintRef,
        );

      // Resign with the next nonce but the same outputHash → OutputAlreadyNotarized.
      const ts2 = BigInt(await time.latest());
      const replay = buildPayload({
        passportId,
        signedTimestamp: ts2,
        nonce: 1n,
        outputHash: payload.outputHash,
      });
      replay.agentSignature = await signNotarization({
        agent,
        notaryAddress,
        chainId,
        passportId,
        outputHash: replay.outputHash,
        inputContextHash: replay.inputContextHash,
        modelFingerprintHash: replay.modelFingerprintHash,
        nonce: replay.nonce,
        timestamp: replay.signedTimestamp,
      });

      await expect(
        notary
          .connect(agent)
          .notarize(
            replay.passportId,
            replay.modelFingerprintHash,
            replay.modelId,
            replay.inputContextHash,
            replay.inputContextSize,
            replay.outputHash,
            replay.artifactType,
            replay.nonce,
            replay.signedTimestamp,
            replay.agentSignature,
            replay.executionFingerprintRef,
          ),
      ).to.be.revertedWithCustomError(notary, 'OutputAlreadyNotarized');
    });

    it('rejects when the agent has been revoked at the registry', async () => {
      const { registry, notary, notaryAddress, chainId, principal, agent, passportId } =
        await loadFixture(deployFixture);

      await registry.connect(principal).revokeAgent(passportId);

      const ts = BigInt(await time.latest());
      const payload = buildPayload({ passportId, signedTimestamp: ts });
      payload.agentSignature = await signNotarization({
        agent,
        notaryAddress,
        chainId,
        passportId,
        outputHash: payload.outputHash,
        inputContextHash: payload.inputContextHash,
        modelFingerprintHash: payload.modelFingerprintHash,
        nonce: payload.nonce,
        timestamp: payload.signedTimestamp,
      });

      await expect(
        notary
          .connect(agent)
          .notarize(
            payload.passportId,
            payload.modelFingerprintHash,
            payload.modelId,
            payload.inputContextHash,
            payload.inputContextSize,
            payload.outputHash,
            payload.artifactType,
            payload.nonce,
            payload.signedTimestamp,
            payload.agentSignature,
            payload.executionFingerprintRef,
          ),
      ).to.be.revertedWithCustomError(notary, 'NotAuthorizedSigner');
    });

    it('rejects after agent rotation when prior agent tries to sign', async () => {
      const { registry, notary, notaryAddress, chainId, principal, agent, otherAgent, passportId } =
        await loadFixture(deployFixture);

      await registry.connect(principal).rotateAgentAddress(passportId, otherAgent.address);

      const ts = BigInt(await time.latest());
      const payload = buildPayload({ passportId, signedTimestamp: ts });
      payload.agentSignature = await signNotarization({
        agent, // now de-authorized
        notaryAddress,
        chainId,
        passportId,
        outputHash: payload.outputHash,
        inputContextHash: payload.inputContextHash,
        modelFingerprintHash: payload.modelFingerprintHash,
        nonce: payload.nonce,
        timestamp: payload.signedTimestamp,
      });

      await expect(
        notary
          .connect(agent)
          .notarize(
            payload.passportId,
            payload.modelFingerprintHash,
            payload.modelId,
            payload.inputContextHash,
            payload.inputContextSize,
            payload.outputHash,
            payload.artifactType,
            payload.nonce,
            payload.signedTimestamp,
            payload.agentSignature,
            payload.executionFingerprintRef,
          ),
      ).to.be.revertedWithCustomError(notary, 'NotAuthorizedSigner');
    });
  });

  describe('verify', () => {
    it('returns false for unknown record', async () => {
      const { notary } = await loadFixture(deployFixture);
      const [valid, reason] = await notary.verify(ethers.id('nope'));
      expect(valid).to.equal(false);
      expect(reason).to.equal('record-not-found');
    });
  });

  describe('resolve', () => {
    it('reverts on unknown recordId', async () => {
      const { notary } = await loadFixture(deployFixture);
      await expect(notary.resolve(ethers.id('nope'))).to.be.revertedWithCustomError(
        notary,
        'RecordNotFound',
      );
    });
  });
});
