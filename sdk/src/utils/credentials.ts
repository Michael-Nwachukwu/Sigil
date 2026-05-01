/**
 * Sigil Protocol — agent credentials persistence.
 *
 * Stores discoverable agent identity material on the local filesystem so a
 * registered agent can later report "who am I?" back to its operator without
 * any blockchain knowledge embedded in the runtime — it just reads its own
 * credential file.
 *
 * SECURITY MODEL
 *   The credential file holds ONLY public, discoverable identifiers:
 *     passportId, agentAddress, principal, registry/notary addresses, chainId.
 *   The agent PRIVATE KEY is NEVER written here. It must live in:
 *     - the runtime's secrets manager, or
 *     - the SIGIL_AGENT_PRIVATE_KEY env var, or
 *     - the OS keychain.
 *   Sigil refuses to write any field whose name suggests a secret (see
 *   `assertNoSecretFields`).
 *
 * Storage layout: ~/.sigil/credentials/<name>.json (mode 0600).
 *   `name` defaults to the passportId — operators with multiple agents can
 *   pass a friendly handle ("risk-scorer", "auditor", …).
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { logger } from './logger';

export interface SigilCredential {
  /** Friendly handle. Defaults to the passportId if not provided. */
  name: string;
  passportId: `0x${string}`;
  agentAddress: `0x${string}`;
  principal: `0x${string}`;
  registry: `0x${string}`;
  notary: `0x${string}`;
  chainId: number;
  /** Block where the registration tx landed (helpful for explorer links). */
  registeredAtBlock?: number;
  /** ISO-8601 of when this credential was written locally. */
  registeredAt: string;
  /** Tx hash of the SigilRegistry.register call that minted the passport. */
  registerTxHash?: `0x${string}`;
  /** RPC the agent should use to resolve its own state at runtime. */
  rpcUrl?: string;
  /** Free-form, principal-set description. Mirrors what's encrypted on-chain. */
  agentDescription?: string;
}

const SECRET_LIKE = /private[-_]?key|secret|seed|mnemonic|password/i;

function assertNoSecretFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (SECRET_LIKE.test(key)) {
      throw new Error(
        `refusing to write credential field "${key}" — looks like a secret. ` +
          `Credentials files only carry discoverable IDs.`,
      );
    }
  }
}

export function credentialsDir(root = homedir()): string {
  return join(root, '.sigil', 'credentials');
}

export function credentialPath(name: string, root = homedir()): string {
  if (!/^[A-Za-z0-9._@-]+$/.test(name)) {
    throw new Error(
      `invalid credential name "${name}" — allowed: A-Z a-z 0-9 . _ @ -`,
    );
  }
  return join(credentialsDir(root), `${name}.json`);
}

export interface WriteCredentialOptions {
  /** Override $HOME (used by tests). */
  root?: string;
  /** Allow overwriting an existing file. Defaults to false. */
  overwrite?: boolean;
}

/**
 * Persist a credential record. Refuses to overwrite by default. Mode 0600.
 */
export function writeCredential(
  credential: SigilCredential,
  options: WriteCredentialOptions = {},
): string {
  const { root = homedir(), overwrite = false } = options;
  assertNoSecretFields(credential as unknown as Record<string, unknown>);

  const dir = credentialsDir(root);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const path = credentialPath(credential.name, root);
  if (existsSync(path) && !overwrite) {
    throw new Error(
      `credential "${credential.name}" already exists at ${path} — pass { overwrite: true } to replace`,
    );
  }

  const body = JSON.stringify(credential, null, 2) + '\n';
  writeFileSync(path, body, { mode: 0o600 });
  // mode in writeFileSync is honoured on POSIX but ignored if the file already
  // existed — chmod explicitly to be safe.
  chmodSync(path, 0o600);

  logger.info({ name: credential.name, path }, 'credential written');
  return path;
}

export function readCredential(
  name: string,
  root = homedir(),
): SigilCredential {
  const path = credentialPath(name, root);
  if (!existsSync(path)) {
    throw new Error(`no credential found for "${name}" at ${path}`);
  }
  const body = readFileSync(path, 'utf8');
  const parsed = JSON.parse(body) as SigilCredential;
  return parsed;
}

export function listCredentials(root = homedir()): SigilCredential[] {
  const dir = credentialsDir(root);
  if (!existsSync(dir)) {
    return [];
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const out: SigilCredential[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(
        readFileSync(join(dir, file), 'utf8'),
      ) as SigilCredential;
      out.push(parsed);
    } catch (err) {
      logger.warn({ file, err }, 'skipping unreadable credential');
    }
  }
  return out;
}

export function deleteCredential(name: string, root = homedir()): void {
  const path = credentialPath(name, root);
  if (existsSync(path)) {
    unlinkSync(path);
    logger.info({ name, path }, 'credential deleted');
  }
}
