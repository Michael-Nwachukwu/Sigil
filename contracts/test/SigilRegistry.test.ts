import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { SigilRegistry } from '../typechain-types';
import { ATTESTATION, derivePassportId } from './helpers';

const ZERO_BYTES32 = ethers.ZeroHash;
const ZERO_ADDRESS = ethers.ZeroAddress;

const SAMPLE_MANIFEST = ethers.id('manifest-v1');
const SAMPLE_URI = 'og-storage://sigil/manifest/v1.json';

async function deployFixture() {
  const [owner, principal, agent, otherPrincipal, otherAgent, relay, notary, attacker] =
    await ethers.getSigners();

  const Registry = await ethers.getContractFactory('SigilRegistry');
  const registry = (await Registry.deploy(owner.address)) as unknown as SigilRegistry;
  await registry.waitForDeployment();

  return {
    registry,
    owner,
    principal,
    agent,
    otherPrincipal,
    otherAgent,
    relay,
    notary,
    attacker,
  };
}

describe('SigilRegistry', () => {
  describe('deployment', () => {
    it('initializes with the configured owner', async () => {
      const { registry, owner } = await loadFixture(deployFixture);
      expect(await registry.owner()).to.equal(owner.address);
    });

    it('starts with no provenance notary set', async () => {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.provenanceNotary()).to.equal(ZERO_ADDRESS);
    });

    it('reports correct ERC-721 metadata', async () => {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.name()).to.equal('Sigil AgentPassport');
      expect(await registry.symbol()).to.equal('SIGIL');
    });
  });

  describe('setProvenanceNotary', () => {
    it('owner can set once', async () => {
      const { registry, owner, notary } = await loadFixture(deployFixture);
      await registry.connect(owner).setProvenanceNotary(notary.address);
      expect(await registry.provenanceNotary()).to.equal(notary.address);
    });

    it('reverts if non-owner tries to set', async () => {
      const { registry, attacker, notary } = await loadFixture(deployFixture);
      await expect(
        registry.connect(attacker).setProvenanceNotary(notary.address),
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');
    });

    it('reverts on zero address', async () => {
      const { registry, owner } = await loadFixture(deployFixture);
      await expect(
        registry.connect(owner).setProvenanceNotary(ZERO_ADDRESS),
      ).to.be.revertedWithCustomError(registry, 'ZeroAddress');
    });

    it('reverts when set twice', async () => {
      const { registry, owner, notary, attacker } = await loadFixture(deployFixture);
      await registry.connect(owner).setProvenanceNotary(notary.address);
      await expect(
        registry.connect(owner).setProvenanceNotary(attacker.address),
      ).to.be.revertedWithCustomError(registry, 'ProvenanceNotaryAlreadySet');
    });
  });

  describe('register', () => {
    it('mints a soulbound passport, sets reverse lookup, and emits AgentRegistered', async () => {
      const { registry, principal, agent } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);

      await expect(
        registry
          .connect(principal)
          .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI),
      )
        .to.emit(registry, 'AgentRegistered')
        .withArgs(passportId, 1n, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      const rec = await registry.resolve(passportId);
      expect(rec.passportId).to.equal(passportId);
      expect(rec.tokenId).to.equal(1n);
      expect(rec.principal).to.equal(principal.address);
      expect(rec.agentAddress).to.equal(agent.address);
      expect(rec.permissionManifestHash).to.equal(SAMPLE_MANIFEST);
      expect(rec.active).to.equal(true);
      expect(rec.taskCount).to.equal(0n);
      expect(rec.failureCount).to.equal(0n);
      expect(rec.reputationScore).to.equal(0n);

      expect(await registry.passportOfAgent(agent.address)).to.equal(passportId);
      expect(await registry.isAuthorizedSigner(passportId, agent.address)).to.equal(true);
      expect(await registry.ownerOf(1n)).to.equal(principal.address);
      expect(await registry.tokenURI(1n)).to.equal(SAMPLE_URI);
      expect(await registry.passportIdOfTokenId(1n)).to.equal(passportId);
    });

    it('reverts if passportId is zero', async () => {
      const { registry, principal, agent } = await loadFixture(deployFixture);
      await expect(
        registry
          .connect(principal)
          .register(ZERO_BYTES32, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI),
      ).to.be.revertedWithCustomError(registry, 'PassportNotFound');
    });

    it('reverts if msg.sender != principal', async () => {
      const { registry, principal, agent, attacker } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);

      await expect(
        registry
          .connect(attacker)
          .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI),
      ).to.be.revertedWithCustomError(registry, 'NotPrincipal');
    });

    it('reverts on duplicate passportId', async () => {
      const { registry, principal, agent, otherAgent } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);

      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      await expect(
        registry
          .connect(principal)
          .register(passportId, principal.address, otherAgent.address, SAMPLE_MANIFEST, SAMPLE_URI),
      ).to.be.revertedWithCustomError(registry, 'PassportAlreadyExists');
    });

    it('reverts if agent address already bound', async () => {
      const { registry, principal, agent, otherPrincipal } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportIdA = derivePassportId(principal.address, agent.address, blockNumber, 0);
      const passportIdB = derivePassportId(otherPrincipal.address, agent.address, blockNumber, 1);

      await registry
        .connect(principal)
        .register(passportIdA, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      await expect(
        registry
          .connect(otherPrincipal)
          .register(
            passportIdB,
            otherPrincipal.address,
            agent.address,
            SAMPLE_MANIFEST,
            SAMPLE_URI,
          ),
      ).to.be.revertedWithCustomError(registry, 'AgentAlreadyBound');
    });

    it('reverts on zero principal or agent address', async () => {
      const { registry, principal, agent } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);

      // Zero-address principal fails the ZeroAddress check before NotPrincipal
      // (zero check is first in register()).
      await expect(
        registry
          .connect(principal)
          .register(passportId, ZERO_ADDRESS, agent.address, SAMPLE_MANIFEST, SAMPLE_URI),
      ).to.be.revertedWithCustomError(registry, 'ZeroAddress');

      await expect(
        registry
          .connect(principal)
          .register(passportId, principal.address, ZERO_ADDRESS, SAMPLE_MANIFEST, SAMPLE_URI),
      ).to.be.revertedWithCustomError(registry, 'ZeroAddress');
    });

    it('increments tokenId for each new passport', async () => {
      const { registry, principal, agent, otherPrincipal, otherAgent } =
        await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const idA = derivePassportId(principal.address, agent.address, blockNumber, 0);
      const idB = derivePassportId(otherPrincipal.address, otherAgent.address, blockNumber, 1);

      await registry
        .connect(principal)
        .register(idA, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);
      await registry
        .connect(otherPrincipal)
        .register(idB, otherPrincipal.address, otherAgent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      expect((await registry.resolve(idA)).tokenId).to.equal(1n);
      expect((await registry.resolve(idB)).tokenId).to.equal(2n);
    });
  });

  describe('soulbound enforcement', () => {
    it('reverts on transferFrom', async () => {
      const { registry, principal, agent, attacker } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);

      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      await expect(
        registry.connect(principal).transferFrom(principal.address, attacker.address, 1n),
      ).to.be.revertedWithCustomError(registry, 'Soulbound');
    });

    it('reverts on safeTransferFrom', async () => {
      const { registry, principal, agent, attacker } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);

      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      await expect(
        registry
          .connect(principal)
          ['safeTransferFrom(address,address,uint256)'](principal.address, attacker.address, 1n),
      ).to.be.revertedWithCustomError(registry, 'Soulbound');
    });
  });

  describe('rotateAgentAddress', () => {
    async function registered() {
      const fx = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(
        fx.principal.address,
        fx.agent.address,
        blockNumber,
        0,
      );
      await fx.registry
        .connect(fx.principal)
        .register(passportId, fx.principal.address, fx.agent.address, SAMPLE_MANIFEST, SAMPLE_URI);
      return { ...fx, passportId };
    }

    it('clears old reverse lookup, sets new, emits AgentRotated', async () => {
      const { registry, principal, agent, otherAgent, passportId } = await registered();
      await expect(registry.connect(principal).rotateAgentAddress(passportId, otherAgent.address))
        .to.emit(registry, 'AgentRotated')
        .withArgs(passportId, agent.address, otherAgent.address);

      expect(await registry.passportOfAgent(agent.address)).to.equal(ZERO_BYTES32);
      expect(await registry.passportOfAgent(otherAgent.address)).to.equal(passportId);
      expect(await registry.isAuthorizedSigner(passportId, agent.address)).to.equal(false);
      expect(await registry.isAuthorizedSigner(passportId, otherAgent.address)).to.equal(true);
    });

    it('reverts if caller is not principal', async () => {
      const { registry, attacker, otherAgent, passportId } = await registered();
      await expect(
        registry.connect(attacker).rotateAgentAddress(passportId, otherAgent.address),
      ).to.be.revertedWithCustomError(registry, 'NotPrincipal');
    });

    it('reverts if new agent already bound', async () => {
      const { registry, principal, otherPrincipal, agent, otherAgent, passportId } =
        await registered();
      const blockNumber = await ethers.provider.getBlockNumber();
      const otherPassportId = derivePassportId(
        otherPrincipal.address,
        otherAgent.address,
        blockNumber,
        1,
      );
      await registry
        .connect(otherPrincipal)
        .register(
          otherPassportId,
          otherPrincipal.address,
          otherAgent.address,
          SAMPLE_MANIFEST,
          SAMPLE_URI,
        );

      await expect(
        registry.connect(principal).rotateAgentAddress(passportId, otherAgent.address),
      ).to.be.revertedWithCustomError(registry, 'AgentAlreadyBound');
      // Sanity: agent param above was not used in revert; ensure it's still bound
      expect(await registry.passportOfAgent(agent.address)).to.equal(passportId);
    });

    it('reverts on zero new address', async () => {
      const { registry, principal, passportId } = await registered();
      await expect(
        registry.connect(principal).rotateAgentAddress(passportId, ZERO_ADDRESS),
      ).to.be.revertedWithCustomError(registry, 'ZeroAddress');
    });
  });

  describe('revokeAgent', () => {
    it('sets active=false, clears reverse lookup, emits AgentRevoked', async () => {
      const { registry, principal, agent } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      await expect(registry.connect(principal).revokeAgent(passportId))
        .to.emit(registry, 'AgentRevoked')
        .withArgs(passportId, agent.address);

      expect((await registry.resolve(passportId)).active).to.equal(false);
      expect(await registry.passportOfAgent(agent.address)).to.equal(ZERO_BYTES32);
      expect(await registry.isAuthorizedSigner(passportId, agent.address)).to.equal(false);
    });

    it('reverts if non-principal calls', async () => {
      const { registry, principal, agent, attacker } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      await expect(
        registry.connect(attacker).revokeAgent(passportId),
      ).to.be.revertedWithCustomError(registry, 'NotPrincipal');
    });
  });

  describe('updatePermissions', () => {
    it('updates the manifest hash and emits PermissionsUpdated', async () => {
      const { registry, principal, agent } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      const newHash = ethers.id('manifest-v2');
      await expect(registry.connect(principal).updatePermissions(passportId, newHash))
        .to.emit(registry, 'PermissionsUpdated')
        .withArgs(passportId, SAMPLE_MANIFEST, newHash);

      expect((await registry.resolve(passportId)).permissionManifestHash).to.equal(newHash);
    });

    it('reverts when called by non-principal', async () => {
      const { registry, principal, agent, attacker } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      await expect(
        registry.connect(attacker).updatePermissions(passportId, ethers.id('x')),
      ).to.be.revertedWithCustomError(registry, 'NotPrincipal');
    });
  });

  describe('relay management & gated mutators', () => {
    it('owner can add/remove relays; non-owner cannot', async () => {
      const { registry, owner, relay, attacker } = await loadFixture(deployFixture);
      await expect(registry.connect(owner).addRelay(relay.address))
        .to.emit(registry, 'RelayAdded')
        .withArgs(relay.address);
      expect(await registry.isRelay(relay.address)).to.equal(true);

      await expect(
        registry.connect(attacker).removeRelay(relay.address),
      ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');

      await expect(registry.connect(owner).removeRelay(relay.address))
        .to.emit(registry, 'RelayRemoved')
        .withArgs(relay.address);
      expect(await registry.isRelay(relay.address)).to.equal(false);
    });

    it('addRelay reverts on zero address', async () => {
      const { registry, owner } = await loadFixture(deployFixture);
      await expect(registry.connect(owner).addRelay(ZERO_ADDRESS)).to.be.revertedWithCustomError(
        registry,
        'ZeroAddress',
      );
    });

    it('appendFingerprint requires relay', async () => {
      const { registry, owner, principal, agent, relay, attacker } =
        await loadFixture(deployFixture);
      await registry.connect(owner).addRelay(relay.address);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      const fp = ethers.id('fp-1');
      const tx = ethers.id('tx-1');

      await expect(
        registry.connect(attacker).appendFingerprint(passportId, fp, tx),
      ).to.be.revertedWithCustomError(registry, 'NotRelay');

      await expect(registry.connect(relay).appendFingerprint(passportId, fp, tx))
        .to.emit(registry, 'FingerprintAppended')
        .withArgs(passportId, fp, tx, 0n);

      expect((await registry.resolve(passportId)).executionFingerprintCount).to.equal(1n);
    });

    it('appendFingerprint reverts on revoked passport', async () => {
      const { registry, owner, principal, agent, relay } = await loadFixture(deployFixture);
      await registry.connect(owner).addRelay(relay.address);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);
      await registry.connect(principal).revokeAgent(passportId);

      await expect(
        registry.connect(relay).appendFingerprint(passportId, ethers.id('fp'), ethers.id('tx')),
      ).to.be.revertedWithCustomError(registry, 'AgentInactive');
    });

    it('appendAttestation updates reputation per the formula', async () => {
      const { registry, owner, principal, agent, relay } = await loadFixture(deployFixture);
      await registry.connect(owner).addRelay(relay.address);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      // 1 pass → score = 1000 * (1 - 0) / 1 = 1000
      await registry
        .connect(relay)
        .appendAttestation(passportId, ATTESTATION.GENERIC_TASK, true, ethers.id('a1'));
      let rep = await registry.reputationScore(passportId);
      expect(rep.score).to.equal(1000n);
      expect(rep.taskCount).to.equal(1n);
      expect(rep.failureCount).to.equal(0n);

      // 1 pass + 1 fail → score = 1000 * (2 - 2) / 2 = 0
      await registry
        .connect(relay)
        .appendAttestation(passportId, ATTESTATION.GENERIC_TASK, false, ethers.id('a2'));
      rep = await registry.reputationScore(passportId);
      expect(rep.score).to.equal(0n);
      expect(rep.taskCount).to.equal(2n);
      expect(rep.failureCount).to.equal(1n);

      // +3 passes → 5 tasks, 1 fail → 1000 * (5 - 2) / 5 = 600
      for (let i = 0; i < 3; i++) {
        await registry
          .connect(relay)
          .appendAttestation(passportId, ATTESTATION.GENERIC_TASK, true, ethers.id(`p${i}`));
      }
      rep = await registry.reputationScore(passportId);
      expect(rep.score).to.equal(600n);
      expect(rep.taskCount).to.equal(5n);
      expect(rep.failureCount).to.equal(1n);
    });

    it('appendAttestation emits AttestationAppended with new score', async () => {
      const { registry, owner, principal, agent, relay } = await loadFixture(deployFixture);
      await registry.connect(owner).addRelay(relay.address);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      const dataHash = ethers.id('data-1');
      await expect(
        registry
          .connect(relay)
          .appendAttestation(passportId, ATTESTATION.CODE_AUDIT, true, dataHash),
      )
        .to.emit(registry, 'AttestationAppended')
        .withArgs(passportId, ATTESTATION.CODE_AUDIT, true, dataHash, 1000n, 1n, 0n);
    });

    it('appendAttestation reverts on revoked passport', async () => {
      const { registry, owner, principal, agent, relay } = await loadFixture(deployFixture);
      await registry.connect(owner).addRelay(relay.address);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);
      await registry.connect(principal).revokeAgent(passportId);

      await expect(
        registry
          .connect(relay)
          .appendAttestation(passportId, ATTESTATION.GENERIC_TASK, true, ethers.id('x')),
      ).to.be.revertedWithCustomError(registry, 'AgentInactive');
    });
  });

  describe('incrementProvenanceCount', () => {
    it('only the configured ProvenanceNotary may call', async () => {
      const { registry, owner, principal, agent, notary, attacker } =
        await loadFixture(deployFixture);
      await registry.connect(owner).setProvenanceNotary(notary.address);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);

      await expect(
        registry.connect(attacker).incrementProvenanceCount(passportId),
      ).to.be.revertedWithCustomError(registry, 'NotProvenanceNotary');

      await expect(registry.connect(notary).incrementProvenanceCount(passportId))
        .to.emit(registry, 'ProvenanceCounted')
        .withArgs(passportId, 1n);

      expect((await registry.resolve(passportId)).provenanceRecordCount).to.equal(1n);
    });
  });

  describe('view helpers', () => {
    it('exists() returns false for unregistered, true after register', async () => {
      const { registry, principal, agent } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      expect(await registry.exists(passportId)).to.equal(false);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);
      expect(await registry.exists(passportId)).to.equal(true);
    });

    it('resolve() reverts for unknown passportId', async () => {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.resolve(ethers.id('nope'))).to.be.revertedWithCustomError(
        registry,
        'PassportNotFound',
      );
    });

    it('isAuthorizedSigner returns false for zero address', async () => {
      const { registry, principal, agent } = await loadFixture(deployFixture);
      const blockNumber = await ethers.provider.getBlockNumber();
      const passportId = derivePassportId(principal.address, agent.address, blockNumber, 0);
      await registry
        .connect(principal)
        .register(passportId, principal.address, agent.address, SAMPLE_MANIFEST, SAMPLE_URI);
      expect(await registry.isAuthorizedSigner(passportId, ZERO_ADDRESS)).to.equal(false);
    });
  });
});
