import { describe, it, expect } from 'vitest';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';
import {
  encryptBytes,
  decryptBytes,
  encryptJson,
  decryptJson,
  deriveSymmetricKey,
  deriveSymmetricKeyWithSigner,
  keyDerivationMessage,
} from '../src/utils/crypto';
import { CryptoError } from '../src/utils/errors';
import { derivePassportId, manifestKvKey, logStreamId } from '../src/passport/PassportTypes';
import { mintAgentKeypair } from '../src/utils/mintAgentKeypair';
import { redactSensitiveFields } from '../src/utils/logger';

describe('derivePassportId', () => {
  it('produces a deterministic 32-byte id', () => {
    const principal = '0x1111111111111111111111111111111111111111';
    const agent = '0x2222222222222222222222222222222222222222';
    const id1 = derivePassportId({ principal, agentAddress: agent, blockNumber: 100, nonce: 0 });
    const id2 = derivePassportId({ principal, agentAddress: agent, blockNumber: 100, nonce: 0 });
    expect(id1).toEqual(id2);
    expect(id1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes when any input changes', () => {
    const principal = '0x1111111111111111111111111111111111111111';
    const agent = '0x2222222222222222222222222222222222222222';
    const base = derivePassportId({ principal, agentAddress: agent, blockNumber: 100, nonce: 0 });
    expect(
      derivePassportId({ principal, agentAddress: agent, blockNumber: 101, nonce: 0 }),
    ).not.toEqual(base);
    expect(
      derivePassportId({ principal, agentAddress: agent, blockNumber: 100, nonce: 1 }),
    ).not.toEqual(base);
  });
});

describe('KV key namespacing', () => {
  it('lowercases the passportId and includes the manifest tag', () => {
    const id = '0xABCDEF0123456789';
    expect(manifestKvKey(id as `0x${string}`)).toBe('sigil::0xabcdef0123456789::manifest');
  });

  it('logStreamId uses the sigil-log- prefix', () => {
    const id = '0xABCDEF0123456789';
    expect(logStreamId(id as `0x${string}`)).toBe('sigil-log-0xabcdef0123456789');
  });
});

describe('mintAgentKeypair', () => {
  it('produces a fresh wallet whose address matches the private key', () => {
    const kp = mintAgentKeypair();
    const recovered = new Wallet(kp.agentPrivateKey).address;
    expect(recovered).toBe(kp.agentAddress);
    expect(kp.agentPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('produces a different keypair every call', () => {
    const a = mintAgentKeypair();
    const b = mintAgentKeypair();
    expect(a.agentPrivateKey).not.toBe(b.agentPrivateKey);
    expect(a.agentAddress).not.toBe(b.agentAddress);
  });
});

describe('symmetric key derivation', () => {
  it('keyDerivationMessage is deterministic and includes the passportId', () => {
    const id = '0xABCDEF';
    expect(keyDerivationMessage(id)).toBe(`sigil-key-derivation:${id.toLowerCase()}`);
  });

  it('signing the deterministic message yields the same key twice', async () => {
    const wallet = Wallet.createRandom();
    const passportId = keccak256(toUtf8Bytes('passport-1'));
    const k1 = await deriveSymmetricKeyWithSigner(wallet, passportId);
    const k2 = await deriveSymmetricKeyWithSigner(wallet, passportId);
    expect(k1.equals(k2)).toBe(true);
    expect(k1.length).toBe(32);
  });

  it('different passports produce different keys for the same wallet', async () => {
    const wallet = Wallet.createRandom();
    const a = await deriveSymmetricKeyWithSigner(wallet, keccak256(toUtf8Bytes('a')));
    const b = await deriveSymmetricKeyWithSigner(wallet, keccak256(toUtf8Bytes('b')));
    expect(a.equals(b)).toBe(false);
  });

  it('deriveSymmetricKey throws on missing inputs', () => {
    expect(() => deriveSymmetricKey('', '0x00')).toThrow(CryptoError);
  });
});

describe('AES-256-GCM round-trip', () => {
  it('encryptBytes / decryptBytes round-trips and contentHash matches keccak256(sealed)', async () => {
    const wallet = Wallet.createRandom();
    const passportId = keccak256(toUtf8Bytes('passport'));
    const key = await deriveSymmetricKeyWithSigner(wallet, passportId);

    const plaintext = Buffer.from('hello sigil', 'utf8');
    const sealed = encryptBytes(plaintext, key);
    expect(sealed.ciphertextHex).toMatch(/^0x[0-9a-f]+$/);
    expect(sealed.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sealed.contentHash).toBe(keccak256(sealed.ciphertextHex));

    const decrypted = decryptBytes(sealed.ciphertextHex, key);
    expect(Buffer.from(decrypted).toString('utf8')).toBe('hello sigil');
  });

  it('encryptJson / decryptJson round-trips object structure', async () => {
    const wallet = Wallet.createRandom();
    const passportId = keccak256(toUtf8Bytes('passport'));
    const key = await deriveSymmetricKeyWithSigner(wallet, passportId);

    const manifest = {
      version: '1' as const,
      agentDescription: 'test agent',
      whitelistedContracts: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      maxTxValuePerWindow: { USDC: 5000 },
      authorizedApis: ['uniswap.api'],
      allowedTokens: ['USDC', 'ETH'],
      timeWindowSeconds: 3600,
    };
    const sealed = encryptJson(manifest, key);
    const recovered = decryptJson<typeof manifest>(sealed.ciphertextHex, key);
    expect(recovered).toEqual(manifest);
  });

  it('decrypt with wrong key throws CryptoError (auth failure)', async () => {
    const k1 = await deriveSymmetricKeyWithSigner(
      Wallet.createRandom(),
      keccak256(toUtf8Bytes('a')),
    );
    const k2 = await deriveSymmetricKeyWithSigner(
      Wallet.createRandom(),
      keccak256(toUtf8Bytes('b')),
    );
    const sealed = encryptBytes(Buffer.from('secret'), k1);
    expect(() => decryptBytes(sealed.ciphertextHex, k2)).toThrow(CryptoError);
  });
});

describe('redactSensitiveFields', () => {
  it('redacts known-sensitive keys at any depth', () => {
    const input = {
      passportId: '0xabc',
      agentPrivateKey: '0xdeadbeef',
      nested: {
        privateKey: '0xfeed',
        permissionManifest: { allowedTokens: ['ETH'] },
        safe: 'hello',
      },
      arr: [{ mnemonic: 'word word word', visible: 1 }],
    };
    const out = redactSensitiveFields(input) as typeof input;
    expect(out.agentPrivateKey).toBe('[REDACTED]');
    expect(out.nested.privateKey).toBe('[REDACTED]');
    expect(out.nested.permissionManifest).toBe('[REDACTED]');
    expect(out.nested.safe).toBe('hello');
    expect(out.arr[0].mnemonic).toBe('[REDACTED]');
    expect(out.arr[0].visible).toBe(1);
    expect(out.passportId).toBe('0xabc');
  });

  it('passes primitives through unchanged', () => {
    expect(redactSensitiveFields(null)).toBe(null);
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields('hello')).toBe('hello');
  });
});
