import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('local POS setup, role boundaries, password reset, and sessions work with SQLite', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { initialCategories, initialProducts } from './lib/data.ts';
    import { openLocalPosDatabase, listLocalUsers } from './lib/local-pos/database.ts';
    import {
      authenticateLocalUser,
      createAdditionalSuperUser,
      createFirstSuperUser,
      createLocalSession,
      createLocalStaffUser,
      disableLocalSuperUser,
      localPosIsConfigured,
      readLocalSession,
      resetLocalStaffPassword,
      resetLocalSuperUserPassword,
      resetLocalAccountsWithSuperUser,
      setLocalStaffEnabled,
    } from './lib/local-pos/auth.ts';

    const database = openLocalPosDatabase(':memory:');
    const superUser = await createFirstSuperUser({
      username: 'owner',
      displayName: 'Restaurant Owner',
      password: 'LocalPOS-Owner-Strong-1',
    }, database);
    assert.equal(localPosIsConfigured(database), true);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM local_products').get().count,
      initialProducts.length,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM local_categories').get().count,
      initialCategories.length,
    );
    const settings = JSON.parse(database.prepare('SELECT data_json FROM local_settings').get().data_json);
    assert.equal(settings.billing.cgstRate, 2.5);
    assert.equal(settings.billing.sgstRate, 2.5);
    assert.equal(settings.billing.gstin, '09ANCPV1491R1Z3');
    assert.equal(
      database.prepare('SELECT business_day_start_minute AS cutoff FROM local_settings').get().cutoff,
      180,
    );
    await assert.rejects(createFirstSuperUser({
      username: 'anotherowner',
      displayName: 'Another Owner',
      password: 'LocalPOS-Owner-Strong-2',
    }, database), /already been created/);

    const manager = await createLocalStaffUser(superUser, {
      username: 'manager1',
      displayName: 'POS Manager',
      password: 'LocalPOS-Manager-Strong-1',
      role: 'pos_manager',
    }, database);
    const kitchen = await createLocalStaffUser(manager, {
      username: 'kitchen1',
      displayName: 'Kitchen Staff',
      password: 'LocalPOS-Kitchen-Strong-1',
      role: 'kitchen',
    }, database);
    await assert.rejects(createLocalStaffUser(manager, {
      username: 'manager2',
      displayName: 'Another Manager',
      password: 'LocalPOS-Manager-Strong-2',
      role: 'pos_manager',
    }, database), /cannot create that role/);
    await assert.rejects(createLocalStaffUser(kitchen, {
      username: 'kitchen2',
      displayName: 'Another Kitchen Staff',
      password: 'LocalPOS-Kitchen-Strong-2',
      role: 'kitchen',
    }, database), /cannot create that role/);

    assert.equal((await authenticateLocalUser('manager1', 'LocalPOS-Manager-Strong-1', database))?.id, manager.id);
    assert.equal(await authenticateLocalUser('manager1', 'wrong-password', database), null);
    const session = createLocalSession(manager.id, database);
    assert.equal(readLocalSession(session.token, database)?.role, 'pos_manager');
    await assert.rejects(resetLocalStaffPassword(manager, manager.id, 'LocalPOS-Manager-Reset-1', database), /cannot reset that password/);
    await resetLocalStaffPassword(superUser, manager.id, 'LocalPOS-Manager-Reset-1', database);
    assert.equal(readLocalSession(session.token, database), null);
    assert.equal(await authenticateLocalUser('manager1', 'LocalPOS-Manager-Strong-1', database), null);
    assert.equal((await authenticateLocalUser('manager1', 'LocalPOS-Manager-Reset-1', database))?.id, manager.id);
    const ownerSession = createLocalSession(superUser.id, database);
    await assert.rejects(
      resetLocalSuperUserPassword('unknown', 'LocalPOS-Owner-Reset-1', database),
      /No Super User account matches/,
    );
    await resetLocalSuperUserPassword('OWNER', 'LocalPOS-Owner-Reset-1', database);
    assert.equal(readLocalSession(ownerSession.token, database), null);
    assert.equal(await authenticateLocalUser('owner', 'LocalPOS-Owner-Strong-1', database), null);
    assert.equal((await authenticateLocalUser('owner', 'LocalPOS-Owner-Reset-1', database))?.id, superUser.id);
    await assert.rejects(
      createAdditionalSuperUser(
        {
          username: 'owner',
          displayName: 'Duplicate Owner',
          password: 'LocalPOS-Additional-Strong-1',
        },
        database,
      ),
      /already in use/,
    );
    const secondOwner = await createAdditionalSuperUser(
      {
        username: 'secondowner',
        displayName: 'Second Owner',
        password: 'LocalPOS-Additional-Strong-1',
      },
      database,
    );
    assert.equal(secondOwner.role, 'super_user');
    assert.equal(
      (await authenticateLocalUser('secondowner', 'LocalPOS-Additional-Strong-1', database))?.id,
      secondOwner.id,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM local_users WHERE role = ?').get('super_user').count,
      2,
    );
    assert.throws(
      () => disableLocalSuperUser('owner', 'owner', database),
      /different Super User/,
    );
    disableLocalSuperUser('owner', 'secondowner', database);
    assert.equal(listLocalUsers(database).find((user) => user.username === 'owner')?.enabled, false);
    assert.equal(await authenticateLocalUser('owner', 'LocalPOS-Owner-Reset-1', database), null);
    assert.equal((await authenticateLocalUser('secondowner', 'LocalPOS-Additional-Strong-1', database))?.id, secondOwner.id);
    assert.throws(
      () => disableLocalSuperUser('secondowner', 'owner', database),
      /replacement Super User must be enabled/,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM local_products').get().count,
      initialProducts.length,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM local_categories').get().count,
      initialCategories.length,
    );
    setLocalStaffEnabled(manager, kitchen.id, false, database);
    assert.equal(listLocalUsers(database).find((user) => user.id === kitchen.id)?.enabled, false);
    assert.equal(await authenticateLocalUser('kitchen1', 'LocalPOS-Kitchen-Strong-1', database), null);
    const managerSession = createLocalSession(manager.id, database);
    const secondOwnerSession = createLocalSession(secondOwner.id, database);
    await assert.rejects(
      resetLocalAccountsWithSuperUser({
        username: 'manager1',
        displayName: 'Duplicate Owner',
        password: 'LocalPOS-Duplicate-Owner-Strong-1',
      }, database),
      /already in use/,
    );
    assert.equal(readLocalSession(managerSession.token, database)?.id, manager.id);
    const newOwner = await resetLocalAccountsWithSuperUser({
      username: 'freshowner',
      displayName: 'New Restaurant Owner',
      password: 'LocalPOS-Fresh-Owner-Strong-1',
    }, database);
    const accounts = listLocalUsers(database);
    assert.equal(accounts.length, 5);
    assert.equal(accounts.find((user) => user.id === newOwner.id)?.enabled, true);
    assert.equal(accounts.filter((user) => user.id !== newOwner.id).every((user) => !user.enabled), true);
    assert.equal(readLocalSession(managerSession.token, database), null);
    assert.equal(readLocalSession(secondOwnerSession.token, database), null);
    assert.equal(
      (await authenticateLocalUser('freshowner', 'LocalPOS-Fresh-Owner-Strong-1', database))?.id,
      newOwner.id,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM local_login_limits').get().count,
      0,
    );
    assert.equal(await authenticateLocalUser('manager1', 'LocalPOS-Manager-Reset-1', database), null);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM local_products').get().count,
      initialProducts.length,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM local_categories').get().count,
      initialCategories.length,
    );
    database.close();
  `;
  execFileSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
});
