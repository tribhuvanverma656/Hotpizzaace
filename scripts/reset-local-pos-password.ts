import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  listLocalUsers,
  localPosDatabasePath,
  openLocalPosDatabase,
} from '../lib/local-pos/database';
import {
  createAdditionalSuperUser,
  disableLocalSuperUser,
  localPosIsConfigured,
  resetLocalAccountsWithSuperUser,
  resetLocalSuperUserPassword,
} from '../lib/local-pos/auth';

async function readSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Run this recovery command in an interactive terminal.');

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Password reset cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function main() {
  const databasePath = localPosDatabasePath();
  if (!existsSync(databasePath)) {
    throw new Error(
      `No local POS database was found at ${databasePath}. Run this on the computer that hosts the POS data.`,
    );
  }

  const database = openLocalPosDatabase(databasePath);
  try {
    if (!localPosIsConfigured(database))
      throw new Error('No Super User is configured in this POS database.');

    const owners = listLocalUsers(database).filter((user) => user.role === 'super_user');
    if (!owners.length) throw new Error('No Super User account was found in this POS database.');

    const terminal = createInterface({ input: stdin, output: stdout });
    stdout.write(
      `Existing Super User accounts: ${owners.map((owner) => owner.username).join(', ')}\n`,
    );
    stdout.write('1. Reset an existing Super User password\n');
    stdout.write('2. Create an additional Super User account\n');
    stdout.write('3. Disable all existing accounts and create a new Super User\n');
    const action = await terminal.question('Choose 1, 2, or 3: ');
    if (action !== '1' && action !== '2' && action !== '3') {
      terminal.close();
      throw new Error('Choose 1, 2, or 3.');
    }

    if (action === '3') {
      const username = await terminal.question('New Super User username: ');
      const displayName = await terminal.question('New Super User name: ');
      terminal.close();
      const normalizedUsername = username.trim().toLowerCase();
      const confirmation = createInterface({ input: stdin, output: stdout });
      const typedConfirmation = await confirmation.question(
        `Type RESET ALL ACCOUNTS AND CREATE ${normalizedUsername} to confirm: `,
      );
      confirmation.close();
      if (typedConfirmation !== `RESET ALL ACCOUNTS AND CREATE ${normalizedUsername}`)
        throw new Error('Confirmation did not match; no account changes were made.');

      const password = await readSecret('New password (12–128 characters): ');
      const passwordConfirmation = await readSecret('Confirm new password: ');
      if (password !== passwordConfirmation)
        throw new Error('The passwords did not match; no account changes were made.');

      const user = await resetLocalAccountsWithSuperUser(
        { username, displayName, password },
        database,
      );
      stdout.write(
        `All previous accounts were disabled and "${user.username}" is the new Super User. Account history and restaurant data were preserved. Sign in at http://localhost:3000/local-pos.\n`,
      );
      return;
    }

    if (action === '2') {
      const username = await terminal.question('New Super User username: ');
      const displayName = await terminal.question('New Super User name: ');
      const oldUsername = await terminal.question(
        `Existing Super User to disable (${owners.map((owner) => owner.username).join(', ')}): `,
      );
      terminal.close();
      const confirmation = createInterface({ input: stdin, output: stdout });
      const typedConfirmation = await confirmation.question(
        `Type CREATE ${username.trim().toLowerCase()} AND DISABLE ${oldUsername.trim().toLowerCase()} to confirm: `,
      );
      confirmation.close();
      if (
        typedConfirmation !==
        `CREATE ${username.trim().toLowerCase()} AND DISABLE ${oldUsername.trim().toLowerCase()}`
      )
        throw new Error('Confirmation did not match; no account was created or disabled.');

      const password = await readSecret('New password (12–128 characters): ');
      const passwordConfirmation = await readSecret('Confirm new password: ');
      if (password !== passwordConfirmation)
        throw new Error('The passwords did not match; no account was created.');

      const user = await createAdditionalSuperUser({ username, displayName, password }, database);
      try {
        disableLocalSuperUser(oldUsername, user.username, database);
      } catch (error) {
        stdout.write(
          `Super User account "${user.username}" was created and remains enabled, but the old account was not disabled.\n`,
        );
        throw error;
      }
      stdout.write(
        `Super User "${user.username}" created; "${oldUsername}" disabled. Sign in at http://localhost:3000/local-pos.\n`,
      );
      return;
    }

    const username = await terminal.question('Username to reset: ');
    terminal.close();
    const owner = owners.find((entry) => entry.username === username.trim().toLowerCase());
    if (!owner) throw new Error('That username is not a Super User account.');
    const confirmation = createInterface({ input: stdin, output: stdout });
    const typedConfirmation = await confirmation.question(
      `Type RESET ${owner.username} to confirm: `,
    );
    confirmation.close();
    if (typedConfirmation !== `RESET ${owner.username}`)
      throw new Error('Confirmation did not match; no changes were made.');

    const password = await readSecret('New password (12–128 characters): ');
    const passwordConfirmation = await readSecret('Confirm new password: ');
    if (password !== passwordConfirmation)
      throw new Error('The passwords did not match; no changes were made.');

    await resetLocalSuperUserPassword(owner.username, password, database);
    stdout.write('Super User password reset. Sign in at http://localhost:3000/local-pos.\n');
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Password reset failed.');
  process.exitCode = 1;
});
