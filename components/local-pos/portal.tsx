'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowRight,
  ChefHat,
  CircleAlert,
  Clipboard,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  ShieldCheck,
  Users,
  Wifi,
} from 'lucide-react';
import Link from 'next/link';
import { RestaurantLogo } from '@/components/restaurant-logo';
import type { LocalRole, LocalUser } from '@/lib/local-pos/database';
import { LocalPosAccountMenu } from './account-menu';
import styles from './portal.module.css';
import { LocalPosRoleTabs, roleTabLabels } from './role-tabs';

type LocalPosState = 'loading' | 'setup' | 'login' | 'ready' | 'error';
type StaffEntry = { user: LocalUser; action: 'reset' | 'disable' | 'enable' | null };

async function localPosRequest<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'The local POS request failed.');
  return result;
}

const roleName: Record<LocalRole, string> = {
  super_user: 'Super User',
  pos_manager: 'POS Manager',
  kitchen: 'Kitchen Staff',
};

function isLocalUser(value: unknown): value is LocalUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<LocalUser>;
  return (
    typeof user.id === 'string' &&
    typeof user.username === 'string' &&
    typeof user.displayName === 'string' &&
    typeof user.enabled === 'boolean' &&
    ['super_user', 'pos_manager', 'kitchen'].includes(String(user.role))
  );
}

export function LocalPosPortal() {
  const router = useRouter();
  const [state, setState] = useState<LocalPosState>('loading');
  const [user, setUser] = useState<LocalUser | null>(null);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [staffRole, setStaffRole] = useState<'pos_manager' | 'kitchen'>('kitchen');
  const [staffEntry, setStaffEntry] = useState<StaffEntry | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedRole, setSelectedRole] = useState<LocalRole>('super_user');
  const [recoveryGuide, setRecoveryGuide] = useState(false);
  const [recoveryChoice, setRecoveryChoice] = useState<'reset' | 'replace' | 'all'>('reset');
  const [kitchenLinks, setKitchenLinks] = useState<{ interface: string; url: string }[]>([]);
  const [kitchenLinkError, setKitchenLinkError] = useState('');
  const setup = state === 'setup';
  const authenticated = state === 'ready' && user !== null;

  const loadUsers = useCallback(async (role: LocalRole) => {
    if (role === 'kitchen') return;
    const result = await localPosRequest<{ users: LocalUser[] }>('/api/local-pos/users');
    setUsers(result.users.filter(isLocalUser));
  }, []);

  const load = useCallback(async () => {
    try {
      const [status, session] = await Promise.all([
        localPosRequest<{ configured: boolean }>('/api/local-pos/status'),
        localPosRequest<{ user: LocalUser | null }>('/api/local-pos/session'),
      ]);
      if (session.user && isLocalUser(session.user)) {
        setUser(session.user);
        setSelectedRole(session.user.role);
        await loadUsers(session.user.role);
        setState('ready');
      } else setState(status.configured ? 'login' : 'setup');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The local POS could not be reached.');
      setState('error');
    }
  }, [loadUsers]);

  useEffect(() => {
    const role = new URLSearchParams(window.location.search).get('role');
    if (role === 'kitchen' || role === 'super_user' || role === 'pos_manager')
      setSelectedRole(role);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!authenticated || user?.role === 'kitchen') {
      setKitchenLinks([]);
      setKitchenLinkError('');
      return;
    }

    let active = true;
    void localPosRequest<{ links: { interface: string; url: string }[] }>(
      '/api/local-pos/kitchen-link',
    )
      .then(({ links }) => {
        if (active) {
          setKitchenLinks(links);
          setKitchenLinkError('');
        }
      })
      .catch((cause) => {
        if (active)
          setKitchenLinkError(
            cause instanceof Error ? cause.message : 'Kitchen display links could not be loaded.',
          );
      });

    return () => {
      active = false;
    };
  }, [authenticated, user?.role]);

  async function submitCredentials(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result =
        state === 'setup'
          ? await localPosRequest<{ user: LocalUser }>('/api/local-pos/setup', 'POST', {
              username,
              displayName,
              password,
            })
          : await localPosRequest<{ user: LocalUser }>('/api/local-pos/login', 'POST', {
              username,
              password,
            });
      if (!isLocalUser(result.user)) throw new Error('The local POS returned an invalid account.');
      if (state === 'login' && result.user.role !== selectedRole) {
        await localPosRequest('/api/local-pos/logout', 'POST', {});
        setPassword('');
        throw new Error(
          `Those credentials are for ${roleName[result.user.role]}. Select the ${roleTabLabels[result.user.role]} tab and try again.`,
        );
      }
      setUser(result.user);
      setSelectedRole(result.user.role);
      setPassword('');
      await loadUsers(result.user.role);
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function selectRole(role: LocalRole) {
    setSelectedRole(role);
    if (!authenticated) {
      setUsername('');
      setPassword('');
      setError('');
      router.replace(`/local-pos?role=${role}`, { scroll: false });
      return;
    }
    if (user?.role === role) return;

    setBusy(true);
    setError('');
    try {
      await localPosRequest('/api/local-pos/logout', 'POST', {});
      setUser(null);
      setUsers([]);
      setState('login');
      router.replace(`/local-pos?role=${role}`, { scroll: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change account role.');
      if (user) setSelectedRole(user.role);
    } finally {
      setBusy(false);
    }
  }

  async function createStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await localPosRequest('/api/local-pos/users', 'POST', {
        username: String(data.get('staffUsername') ?? ''),
        displayName: String(data.get('staffDisplayName') ?? ''),
        password: String(data.get('staffPassword') ?? ''),
        role: staffRole,
      });
      form.reset();
      await loadUsers(user.role);
      setNotice(`${roleName[staffRole]} account created.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  async function updateStaff(entry: StaffEntry) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body =
        entry.action === 'reset'
          ? { action: 'reset-password', password: newPassword }
          : { action: entry.action };
      await localPosRequest(
        `/api/local-pos/users/${encodeURIComponent(entry.user.id)}`,
        'PATCH',
        body,
      );
      await loadUsers(user!.role);
      setNotice(
        entry.action === 'reset'
          ? `Password reset for ${entry.user.displayName}.`
          : `${entry.user.displayName} ${entry.action === 'disable' ? 'disabled' : 'enabled'}.`,
      );
      setNewPassword('');
      setStaffEntry(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the account.');
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCommand() {
    try {
      await navigator.clipboard.writeText('npm run reset:local-pos-password');
      setNotice('Recovery command copied.');
      setError('');
    } catch {
      setError('Could not copy the command. Select and copy it manually.');
      setNotice('');
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.wrap}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <RestaurantLogo variant="admin" />
            <div>
              <span>HOT PIZZA ACE</span>
              <small>LOCAL RESTAURANT SYSTEM</small>
            </div>
          </div>
          <div className={styles.headerActions}>
            {authenticated ? (
              <LocalPosRoleTabs
                currentRole={selectedRole}
                onSelect={(role) => void selectRole(role)}
                disabled={busy}
              />
            ) : state === 'login' ? (
              <LocalPosRoleTabs
                currentRole={selectedRole}
                onSelect={(role) => void selectRole(role)}
              />
            ) : (
              <div className={styles.localBadge}>
                <span />
                OFFLINE-READY · ON THIS POS
              </div>
            )}
          </div>
        </header>

        {authenticated ? (
          <section className={styles.workspace}>
            <div className={styles.welcome}>
              <div>
                <p className={styles.eyebrow}>RESTAURANT OPERATIONS</p>
                <h1>Good to see you, {user.displayName.split(' ')[0]}.</h1>
                <p className={styles.intro}>
                  Signed in as <b>{roleName[user.role]}</b>. Local POS account and menu database are
                  ready on this computer.
                </p>
              </div>
              <LocalPosAccountMenu
                user={user}
                onSignedOut={() => {
                  setUser(null);
                  setUsers([]);
                  setState('login');
                }}
              />
            </div>
            <div className={styles.systemStatus}>
              <div className={styles.statusIcon}>
                <Activity size={20} />
              </div>
              <div>
                <strong>Local database connected</strong>
                <span>
                  Menu data is stored on the POS computer; internet is not required for local
                  storage.
                </span>
              </div>
              <span className={styles.statusPill}>LOCAL</span>
            </div>
            <nav className={styles.quickLinks} aria-label="Local POS apps">
              <Link href="/local-pos/dashboard">
                <Activity size={18} />
                <span>
                  <b>Open Dashboard</b>
                  <small>See today’s restaurant activity and orders</small>
                </span>
              </Link>
              {user.role !== 'kitchen' && (
                <Link href="/local-pos/register">
                  <ArrowRight size={17} />
                  <span>
                    <b>Open POS register</b>
                    <small>Create bills and send orders to kitchen</small>
                  </span>
                </Link>
              )}
              <Link href="/local-pos/kitchen">
                <ChefHat size={18} />
                <span>
                  <b>Kitchen Display</b>
                  <small>Kitchen Staff sign-in required</small>
                </span>
              </Link>
            </nav>
            {user.role !== 'kitchen' && (
              <section className={styles.kitchenAccess} aria-labelledby="kitchen-access-title">
                <div>
                  <div className={styles.kitchenAccessTitle}>
                    <ChefHat size={19} />
                    <h2 id="kitchen-access-title">Set up the kitchen computer</h2>
                  </div>
                  <p>
                    Open one of these addresses in the kitchen computer’s browser, then sign in with
                    its Kitchen Staff account. Use the same Wi-Fi or local network as this POS. This
                    cannot open another computer’s browser remotely.
                  </p>
                </div>
                {kitchenLinkError ? (
                  <p className={styles.error} role="alert">
                    {kitchenLinkError}
                  </p>
                ) : kitchenLinks.length ? (
                  <ul className={styles.kitchenAddresses}>
                    {kitchenLinks.map((link) => (
                      <li key={`${link.interface}-${link.url}`}>
                        <span>{link.interface}</span>
                        <a href={link.url} target="_blank" rel="noreferrer">
                          {link.url}
                        </a>
                        <button
                          type="button"
                          className={styles.copyCommand}
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(link.url)
                              .then(() => {
                                setNotice('Kitchen display address copied.');
                                setError('');
                              })
                              .catch(() => {
                                setError(
                                  'Could not copy the address. Select and copy it manually.',
                                );
                                setNotice('');
                              });
                          }}
                        >
                          <Clipboard size={15} /> Copy
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.recoveryLocalOnly}>
                    No private network address was detected. Check that the POS computer is
                    connected to the restaurant Wi-Fi or wired network.
                  </p>
                )}
              </section>
            )}
            {user.role !== 'kitchen' && (
              <section className={styles.panel}>
                <div className={styles.panelHeading}>
                  <div className={styles.panelIcon}>
                    <Users size={19} />
                  </div>
                  <div>
                    <h2>Team access</h2>
                    <p>
                      {user.role === 'super_user'
                        ? 'Create POS Manager and Kitchen accounts. Only you can manage manager accounts.'
                        : 'Create and manage Kitchen accounts for the kitchen display.'}
                    </p>
                  </div>
                </div>
                <form className={styles.createForm} onSubmit={(event) => void createStaff(event)}>
                  <label>
                    Access level
                    <select
                      value={staffRole}
                      onChange={(event) =>
                        setStaffRole(event.target.value as 'pos_manager' | 'kitchen')
                      }
                    >
                      {user.role === 'super_user' && (
                        <option value="pos_manager">POS Manager</option>
                      )}
                      <option value="kitchen">Kitchen Staff</option>
                    </select>
                  </label>
                  <label>
                    Staff name
                    <input name="staffDisplayName" minLength={2} maxLength={80} required />
                  </label>
                  <label>
                    Username
                    <input
                      name="staffUsername"
                      autoCapitalize="none"
                      minLength={3}
                      maxLength={32}
                      required
                    />
                  </label>
                  <label>
                    Temporary password
                    <input
                      name="staffPassword"
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <button className={styles.primaryButton} disabled={busy}>
                    <Plus size={17} /> Create account
                  </button>
                </form>
                <div className={styles.staffList}>
                  {users.map((entry) => (
                    <article className={styles.staffRow} key={entry.id}>
                      <div className={styles.staffAvatar}>
                        {entry.role === 'kitchen' ? (
                          <ChefHat size={17} />
                        ) : (
                          <ShieldCheck size={17} />
                        )}
                      </div>
                      <div className={styles.staffInfo}>
                        <strong>{entry.displayName}</strong>
                        <span>
                          @{entry.username} · {roleName[entry.role]}
                        </span>
                      </div>
                      <span className={entry.enabled ? styles.enabled : styles.disabled}>
                        {entry.enabled ? 'Active' : 'Disabled'}
                      </span>
                      <div className={styles.rowActions}>
                        {(user.role === 'super_user' || entry.role === 'kitchen') && (
                          <>
                            <button
                              className={styles.textButton}
                              onClick={() => {
                                setStaffEntry({ user: entry, action: 'reset' });
                                setNewPassword('');
                              }}
                            >
                              <KeyRound size={15} /> Reset password
                            </button>
                            <button
                              className={styles.textButton}
                              onClick={() =>
                                void updateStaff({
                                  user: entry,
                                  action: entry.enabled ? 'disable' : 'enable',
                                })
                              }
                              disabled={busy}
                            >
                              {entry.enabled ? 'Disable' : 'Enable'}
                            </button>
                          </>
                        )}
                      </div>
                      {staffEntry?.user.id === entry.id && staffEntry.action === 'reset' && (
                        <form
                          className={styles.resetForm}
                          onSubmit={(event) => {
                            event.preventDefault();
                            void updateStaff(staffEntry);
                          }}
                        >
                          <label>
                            New password
                            <input
                              type="password"
                              autoComplete="new-password"
                              minLength={12}
                              maxLength={128}
                              value={newPassword}
                              onChange={(event) => setNewPassword(event.target.value)}
                              required
                            />
                          </label>
                          <button className={styles.primaryButton} disabled={busy}>
                            Reset password
                          </button>
                          <button
                            type="button"
                            className={styles.textButton}
                            onClick={() => setStaffEntry(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      )}
                    </article>
                  ))}
                  {!users.length && (
                    <p className={styles.empty}>
                      No staff accounts yet. Create the first one above.
                    </p>
                  )}
                </div>
              </section>
            )}
            {user.role === 'kitchen' && (
              <div className={styles.kitchenNotice}>
                <ChefHat size={22} />
                <div>
                  <strong>Kitchen account</strong>
                  <span>
                    This account is restricted to kitchen order viewing and status updates.
                  </span>
                </div>
              </div>
            )}
            <footer className={styles.footer}>
              <Wifi size={15} /> POS and kitchen devices use the restaurant’s local network.
            </footer>
          </section>
        ) : (
          <section className={styles.authLayout}>
            <div className={styles.pitch}>
              <p className={styles.eyebrow}>A BETTER SERVICE STARTS HERE</p>
              <h1>
                Your restaurant,
                <br />
                <em>running in sync.</em>
              </h1>
              <p className={styles.intro}>
                Billing at the counter. Clear tickets in the kitchen. Your menu and operations stay
                on your restaurant computer.
              </p>
              <div className={styles.promiseList}>
                <div>
                  <ShieldCheck size={18} />
                  <span>Private staff accounts</span>
                </div>
                <div>
                  <Activity size={18} />
                  <span>Local data, ready for offline service</span>
                </div>
                <div>
                  <ChefHat size={18} />
                  <span>POS and kitchen in one workflow</span>
                </div>
              </div>
            </div>
            <div className={styles.authCard}>
              <div className={styles.authIcon}>
                {setup ? (
                  <ShieldCheck size={23} />
                ) : state === 'error' ? (
                  <CircleAlert size={23} />
                ) : (
                  <KeyRound size={23} />
                )}
              </div>
              <p className={styles.eyebrow}>{setup ? 'FIRST-TIME SETUP' : 'STAFF ACCESS'}</p>
              <h2>
                {state === 'loading'
                  ? 'Connecting to your POS'
                  : state === 'error'
                    ? 'System connection needed'
                    : setup
                      ? 'Create your Super User'
                      : 'Welcome back'}
              </h2>
              <p className={styles.cardCopy}>
                {state === 'loading'
                  ? 'Checking the local database and staff session.'
                  : state === 'error'
                    ? 'The local POS service could not be reached. Check that it is running, then retry.'
                    : setup
                      ? 'This first account has full system access. Save the credentials securely.'
                      : 'Sign in with the account created by your POS administrator.'}
              </p>
              {state === 'error' ? (
                <button className={styles.primaryButton} onClick={() => void load()}>
                  Retry connection <ArrowRight size={17} />
                </button>
              ) : state === 'setup' || state === 'login' ? (
                <>
                  {state === 'login' && (
                    <p className={styles.roleHint}>
                      Choose your account type, then sign in with that role’s username and password.
                    </p>
                  )}
                  {!recoveryGuide && (
                    <>
                      <form
                        className={styles.authForm}
                        onSubmit={(event) => void submitCredentials(event)}
                      >
                        {setup && (
                          <label>
                            Your name
                            <input
                              autoComplete="name"
                              value={displayName}
                              onChange={(event) => setDisplayName(event.target.value)}
                              minLength={2}
                              maxLength={80}
                              required
                            />
                          </label>
                        )}
                        <label>
                          Username
                          <input
                            autoComplete="username"
                            autoCapitalize="none"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            minLength={3}
                            maxLength={32}
                            required
                          />
                        </label>
                        <label>
                          Password
                          <span className={styles.passwordField}>
                            <input
                              type={showPassword ? 'text' : 'password'}
                              autoComplete={setup ? 'new-password' : 'current-password'}
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              minLength={setup ? 12 : undefined}
                              maxLength={128}
                              required
                            />
                            <button
                              type="button"
                              aria-label={showPassword ? 'Hide password' : 'Show password'}
                              onClick={() => setShowPassword((value) => !value)}
                            >
                              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                            </button>
                          </span>
                          {setup && <small>Use at least 12 characters.</small>}
                        </label>
                        {error && (
                          <p className={styles.error} role="alert">
                            {error}
                          </p>
                        )}
                        <button className={styles.primaryButton} disabled={busy}>
                          {busy ? 'Please wait…' : setup ? 'Set up local POS' : 'Sign in'}
                          {!busy && <ArrowRight size={17} />}
                        </button>
                      </form>
                      {state === 'login' && (
                        <button
                          type="button"
                          className={styles.recoveryLink}
                          onClick={() => {
                            setRecoveryGuide(true);
                            setError('');
                            setNotice('');
                          }}
                        >
                          Forgot Super User access?
                        </button>
                      )}
                    </>
                  )}
                  {recoveryGuide && state === 'login' && (
                    <section className={styles.recoveryPanel} aria-labelledby="recovery-title">
                      <h3 id="recovery-title">Recover Super User access</h3>
                      <p>
                        This does not reset the restaurant. Your menu, settings, and orders stay
                        intact.
                      </p>
                      <p>
                        This version guides you through the local terminal recovery tool; it does
                        not change passwords directly in the browser.
                      </p>
                      <div className={styles.recoveryChoices}>
                        <button
                          type="button"
                          className={recoveryChoice === 'reset' ? styles.recoveryChoiceActive : ''}
                          onClick={() => setRecoveryChoice('reset')}
                        >
                          Reset current password
                        </button>
                        <button
                          type="button"
                          className={
                            recoveryChoice === 'replace' ? styles.recoveryChoiceActive : ''
                          }
                          onClick={() => setRecoveryChoice('replace')}
                        >
                          Replace Super User
                        </button>
                        <button
                          type="button"
                          className={recoveryChoice === 'all' ? styles.recoveryChoiceActive : ''}
                          onClick={() => setRecoveryChoice('all')}
                        >
                          Reset all accounts
                        </button>
                      </div>
                      {recoveryChoice === 'all' && (
                        <p className={styles.recoveryWarning}>
                          This disables every existing Super User and staff login and signs out
                          their sessions. Account records stay for history; menu, settings,
                          customers, and orders are not deleted. You will create a new Super User
                          with a username that has not been used before.
                        </p>
                      )}
                      <ol>
                        <li>
                          On the POS computer, open Terminal or PowerShell in the POS project
                          folder.
                        </li>
                        <li>
                          Run <code>npm run reset:local-pos-password</code>, then choose{' '}
                          {recoveryChoice === 'reset'
                            ? '1 to reset the existing password'
                            : recoveryChoice === 'replace'
                              ? '2 to create a new account and disable the selected Super User'
                              : '3 to disable all accounts and create a new Super User'}
                          .
                        </li>
                        <li>
                          Confirm the action, then follow the prompts. Passwords are hidden while
                          typing. Existing account records are kept for history.
                        </li>
                      </ol>
                      <p className={styles.recoveryLocalOnly}>
                        Recovery must be started on the POS computer, not from the kitchen display.
                      </p>
                      {error && (
                        <p className={styles.error} role="alert">
                          {error}
                        </p>
                      )}
                      <button
                        type="button"
                        className={styles.copyCommand}
                        onClick={() => void copyRecoveryCommand()}
                      >
                        <Clipboard size={15} /> Copy recovery command
                      </button>
                      <button
                        type="button"
                        className={styles.recoveryLink}
                        onClick={() => {
                          setRecoveryGuide(false);
                          setError('');
                          setNotice('');
                        }}
                      >
                        Back to sign in
                      </button>
                    </section>
                  )}
                </>
              ) : (
                <div className={styles.loadingLine}>
                  <span /> Securely checking local access…
                </div>
              )}
              {notice && (
                <p className={styles.notice} role="status">
                  {notice}
                </p>
              )}
              <div className={styles.cardFoot}>
                <Wifi size={15} />
                <span>
                  Works on this computer and your restaurant network. No cloud account required.
                </span>
              </div>
            </div>
          </section>
        )}
        {error && authenticated && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && authenticated && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        <p className={styles.copyright}>HOT PIZZA ACE · LOCAL POS SYSTEM</p>
      </div>
    </main>
  );
}
