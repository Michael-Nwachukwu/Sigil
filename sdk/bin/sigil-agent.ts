/**
 * sigil-agent — tiny CLI that lets a registered agent (or its operator)
 * report its own identity from the local credential file. Designed to be
 * shelled out from inside an agent runtime so the operator can ask
 * "who are you?" without the agent embedding any chain knowledge.
 *
 *   sigil-agent whoami                   # all credentials, summary
 *   sigil-agent whoami <name>            # one credential, full
 *   sigil-agent list                     # short list
 *   sigil-agent path <name>              # absolute path to the file
 *   sigil-agent delete <name>            # remove the file (no chain action)
 *
 * Never prints, accepts, or touches private keys.
 */

import {
  credentialPath,
  deleteCredential,
  listCredentials,
  readCredential,
} from '../src/utils/credentials';

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function printSummary(name: string, full = false): void {
  const cred = readCredential(name);
  if (full) {
    process.stdout.write(`${JSON.stringify(cred, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `name:         ${cred.name}`,
      `passportId:   ${cred.passportId}`,
      `agent:        ${cred.agentAddress}`,
      `principal:    ${cred.principal}`,
      `chainId:      ${cred.chainId}`,
      `registeredAt: ${cred.registeredAt}`,
      cred.agentDescription ? `description:  ${cred.agentDescription}` : null,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

function main(): void {
  const [, , subcommand, arg] = process.argv;

  switch (subcommand) {
    case undefined:
    case 'help':
    case '-h':
    case '--help': {
      process.stdout.write(
        `sigil-agent — local Sigil credential reader\n\n` +
          `Usage:\n` +
          `  sigil-agent whoami [name]   show one or all credentials\n` +
          `  sigil-agent list            short list of stored credentials\n` +
          `  sigil-agent path <name>     print absolute path of a credential file\n` +
          `  sigil-agent delete <name>   remove a credential file (no chain action)\n` +
          `\nCredentials live in ~/.sigil/credentials/. Private keys are NEVER stored here.\n`,
      );
      return;
    }

    case 'whoami': {
      if (arg) {
        printSummary(arg, true);
        return;
      }
      const all = listCredentials();
      if (all.length === 0) {
        process.stdout.write(
          `no credentials found in ~/.sigil/credentials/.\n` +
            `register an agent with sigil.passport.register({ persistAs: "<name>", … }) ` +
            `to populate this directory.\n`,
        );
        return;
      }
      for (const cred of all) {
        printSummary(cred.name, false);
        process.stdout.write('---\n');
      }
      return;
    }

    case 'list': {
      const all = listCredentials();
      if (all.length === 0) {
        process.stdout.write('(no credentials)\n');
        return;
      }
      for (const cred of all) {
        process.stdout.write(`${cred.name}\t${cred.passportId}\t${cred.agentAddress}\n`);
      }
      return;
    }

    case 'path': {
      if (!arg) fail('usage: sigil-agent path <name>');
      process.stdout.write(`${credentialPath(arg)}\n`);
      return;
    }

    case 'delete': {
      if (!arg) fail('usage: sigil-agent delete <name>');
      deleteCredential(arg);
      process.stdout.write(`deleted ${arg}\n`);
      return;
    }

    default:
      fail(`unknown subcommand: ${subcommand}\n(run sigil-agent help for usage)`);
  }
}

try {
  main();
} catch (err) {
  fail(`sigil-agent: ${(err as Error).message}`);
}
