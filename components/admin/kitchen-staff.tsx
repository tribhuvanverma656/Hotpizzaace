'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ChefHat,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import type { KitchenStaff } from '@/lib/kitchen-staff';
import { KitchenApiError, kitchenErrorMessage, privateRequest } from '@/components/kitchen/client';
import styles from './kitchen-staff.module.css';

type BranchChoice = { id: string; name: string };
type StaffList = { staff: KitchenStaff[]; branches: BranchChoice[] };
type FormMode = 'create' | 'update' | 'reset-password';
const states: Record<KitchenStaff['state'], string> = {
  provisioning: 'Setup incomplete',
  ready: 'Ready',
  reset_pending: 'Password reset incomplete',
  blocked: 'Blocked',
};
function validStaff(member: KitchenStaff): boolean {
  return (
    !!member &&
    typeof member.id === 'string' &&
    typeof member.username === 'string' &&
    typeof member.displayName === 'string' &&
    typeof member.branchId === 'string' &&
    typeof member.branchName === 'string' &&
    typeof member.enabled === 'boolean' &&
    Object.hasOwn(states, member.state) &&
    Number.isSafeInteger(member.version) &&
    member.version > 0
  );
}
function staffError(cause: unknown): string {
  if (cause instanceof KitchenApiError) {
    if (cause.status === 401 || cause.status === 403)
      return 'Your owner authorization could not be confirmed. Sign in again or re-enter your current owner password.';
    return kitchenErrorMessage(cause.code);
  }
  return 'This staff change could not be confirmed. Refresh the list before trying again.';
}
export function KitchenStaffSettings() {
  const [staff, setStaff] = useState<KitchenStaff[]>([]);
  const [branches, setBranches] = useState<BranchChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<FormMode | null>(null);
  const [selected, setSelected] = useState<KitchenStaff | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const lock = useRef(false);
  const active = useRef(true);
  const readVersion = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const clearPasswords = useCallback(() => {
    setOwnerPassword('');
    setPassword('');
    setConfirmPassword('');
  }, []);
  const refresh = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const version = ++readVersion.current;
    setLoading(true);
    try {
      const result = await privateRequest<StaffList>('/api/kitchen-staff', {
        signal: controller.signal,
      });
      if (!active.current || controller.signal.aborted || version !== readVersion.current) return;
      if (
        !Array.isArray(result.staff) ||
        result.staff.some((member) => !validStaff(member)) ||
        !Array.isArray(result.branches) ||
        result.branches.some(
          (branch) => typeof branch.id !== 'string' || typeof branch.name !== 'string',
        )
      )
        throw new KitchenApiError(502, 'invalid_response');
      setStaff(result.staff);
      setBranches(result.branches);
      setAvailable(true);
      setDisabled(false);
      setError('');
    } catch (cause) {
      if (!active.current || controller.signal.aborted || version !== readVersion.current) return;
      setAvailable(false);
      if (cause instanceof KitchenApiError && cause.code === 'kitchen_disabled') {
        setDisabled(true);
        setStaff([]);
        setMode(null);
        clearPasswords();
      } else setError(staffError(cause));
    } finally {
      if (readController.current === controller) readController.current = null;
      if (active.current && version === readVersion.current) setLoading(false);
    }
  }, [clearPasswords]);
  useEffect(() => {
    active.current = true;
    void refresh();
    const clear = () => clearPasswords();
    window.addEventListener('pageshow', clear);
    return () => {
      active.current = false;
      // This is a request generation, not a DOM ref; invalidate its latest value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++readVersion.current;
      readController.current?.abort();
      window.removeEventListener('pageshow', clear);
    };
  }, [clearPasswords, refresh]);
  const openForm = (nextMode: FormMode, member: KitchenStaff | null = null) => {
    setMode(nextMode);
    setSelected(member);
    setUsername(member?.username ?? '');
    setDisplayName(member?.displayName ?? '');
    setBranchId(member?.branchId ?? branches[0]?.id ?? '');
    clearPasswords();
    setError('');
    setNotice('');
  };
  const closeForm = () => {
    setMode(null);
    setSelected(null);
    clearPasswords();
  };
  const mutate = async (body: Record<string, unknown>, member: KitchenStaff | null) => {
    if (lock.current || !available) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    ++readVersion.current;
    readController.current?.abort();
    clearPasswords();
    try {
      const result = await privateRequest<{ staff: KitchenStaff }>(
        member ? `/api/kitchen-staff/${encodeURIComponent(member.id)}` : '/api/kitchen-staff',
        {
          method: member ? 'PATCH' : 'POST',
          body,
        },
      );
      if (!active.current) return;
      if (!validStaff(result.staff) || (member && result.staff.id !== member.id))
        throw new KitchenApiError(502, 'invalid_response');
      setStaff((current) => [
        ...current.filter((item) => item.id !== result.staff.id),
        result.staff,
      ]);
      closeForm();
      const action = body.action;
      setNotice(
        action === 'disable'
          ? `${result.staff.displayName} is disabled. Existing kitchen sessions are revoked.`
          : action === 'enable'
            ? `${result.staff.displayName} is enabled and must sign in again.`
            : action === 'reset-password'
              ? `Password reset completed for ${result.staff.displayName}. Share the new password privately; a fresh sign-in is required.`
              : member
                ? `${result.staff.displayName} was updated. A fresh kitchen sign-in is required.`
                : `${result.staff.displayName} was created. Share their username and password privately.`,
      );
      await refresh();
    } catch (cause) {
      if (!active.current) return;
      const message = staffError(cause);
      await refresh();
      if (active.current) setError(message);
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mode || busy || !available) return;
    if (
      mode !== 'reset-password' &&
      (!/^[a-z][a-z0-9._-]{2,31}$/.test(username.trim().toLowerCase()) ||
        displayName.trim().length < 2 ||
        !branches.some((branch) => branch.id === branchId))
    ) {
      setError('Enter a display name, valid username and an existing branch.');
      return;
    }
    if (
      mode !== 'update' &&
      (password.length < 12 ||
        password.length > 128 ||
        !/\S/.test(password) ||
        password !== confirmPassword ||
        !ownerPassword)
    ) {
      setError(
        password !== confirmPassword
          ? 'The new chef passwords do not match.'
          : 'Enter your current owner password and a new chef password between 12 and 128 characters.',
      );
      return;
    }
    const details = {
      displayName: displayName.trim(),
      username: username.trim().toLowerCase(),
      branchId,
    };
    if (mode === 'create')
      void mutate({ ...details, password, confirmPassword, ownerPassword }, null);
    else if (selected)
      void mutate(
        {
          action: mode,
          expectedVersion: selected.version,
          ...(mode === 'update' ? details : { password, confirmPassword, ownerPassword }),
        },
        selected,
      );
  };
  return (
    <section className={`admin-card ${styles.section}`} aria-labelledby="kitchen-staff-heading">
      <div className={`admin-card-heading ${styles.heading}`}>
        <div>
          <h2 id="kitchen-staff-heading">
            <ChefHat size={19} /> Kitchen staff
          </h2>
          <p>
            Individual chef logins for one assigned branch. Kitchen staff cannot access Admin or
            payments.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} /> Refresh staff
        </button>
      </div>
      <div className="admin-card-padding">
        {loading && <p role="status">Loading kitchen staff…</p>}
        {disabled && (
          <div className={styles.info} role="status">
            <strong>Kitchen staff access is not enabled yet.</strong>
            <p>
              Accounts and chef sign-in stay unavailable until the staff feature is configured and
              tested for this deployment.
            </p>
          </div>
        )}
        {notice && (
          <p className={styles.success} role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {available && (
          <>
            <div className={styles.intro}>
              <p>
                Chef entry point: <code>/kitchen</code>. Passwords are never displayed or retrieved.
                Disabled usernames remain reserved.
              </p>
              <button
                type="button"
                className="btn btn-dark btn-sm"
                disabled={busy || loading || !branches.length}
                onClick={() => openForm('create')}
              >
                <Plus size={16} /> Add chef
              </button>
            </div>
            {!staff.length && !loading && (
              <p className={styles.empty}>
                No kitchen staff have been created for this deployment.
              </p>
            )}
            <ul className={styles.list}>
              {[...staff]
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .map((member) => (
                  <li key={member.id}>
                    <div className={styles.member}>
                      <div>
                        <strong>{member.displayName}</strong>
                        <span>@{member.username}</span>
                      </div>
                      <span
                        className={
                          member.enabled && member.state === 'ready'
                            ? styles.enabled
                            : styles.disabled
                        }
                      >
                        {member.enabled && member.state === 'ready'
                          ? 'Enabled'
                          : member.state === 'ready'
                            ? 'Disabled'
                            : states[member.state]}
                      </span>
                    </div>
                    <p>
                      {member.branchName} <small>({member.branchId})</small>
                    </p>
                    <p className={styles.lastLogin}>
                      Last sign-in:{' '}
                      {member.lastSignInAt
                        ? new Date(member.lastSignInAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                          })
                        : 'Never'}
                    </p>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={busy || loading}
                        onClick={() => openForm('update', member)}
                      >
                        <Pencil size={15} /> Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={busy || loading}
                        onClick={() => openForm('reset-password', member)}
                      >
                        <KeyRound size={15} /> Reset password
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={busy || loading || (!member.enabled && member.state !== 'ready')}
                        onClick={() =>
                          void mutate(
                            {
                              action: member.enabled ? 'disable' : 'enable',
                              expectedVersion: member.version,
                            },
                            member,
                          )
                        }
                      >
                        {member.enabled ? <UserX size={15} /> : <UserCheck size={15} />}
                        {member.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                    {member.state !== 'ready' && (
                      <p className={styles.help}>
                        This account cannot sign in. Complete a password reset before enabling it.
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          </>
        )}
        {available && mode && (
          <form
            className={styles.form}
            onSubmit={submit}
            aria-label={
              mode === 'create'
                ? 'Create chef account'
                : mode === 'update'
                  ? 'Edit chef account'
                  : 'Reset chef password'
            }
          >
            <div className={styles.formHeading}>
              <h3>
                {mode === 'create'
                  ? 'Add chef'
                  : mode === 'update'
                    ? `Edit ${selected?.displayName}`
                    : `Reset password for ${selected?.displayName}`}
              </h3>
              <button
                className="btn btn-outline btn-sm"
                type="button"
                disabled={busy}
                onClick={closeForm}
                aria-label="Close staff form"
              >
                <X size={17} />
              </button>
            </div>
            <fieldset disabled={busy || loading}>
              {mode !== 'reset-password' && (
                <>
                  <div className={styles.formGrid}>
                    <label>
                      Display name
                      <input
                        name="displayName"
                        autoComplete="off"
                        required
                        minLength={2}
                        maxLength={80}
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                      />
                    </label>
                    <label>
                      Username
                      <input
                        name="username"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        required
                        minLength={3}
                        maxLength={32}
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                      />
                      <small>
                        3–32 letters, digits, dots, underscores or hyphens; begin with a letter.
                      </small>
                    </label>
                  </div>
                  <label>
                    Assigned branch
                    <select
                      name="branchId"
                      required
                      value={branchId}
                      onChange={(event) => setBranchId(event.target.value)}
                    >
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name} · {branch.id}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {mode !== 'update' && (
                <>
                  <p className={styles.help}>
                    <ShieldCheck size={16} /> Confirm this change with your current owner password.
                    Enter the chef’s new password privately and share it with them outside this
                    screen.
                  </p>
                  <label>
                    Current owner password
                    <input
                      name="ownerPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                      value={ownerPassword}
                      onChange={(event) => setOwnerPassword(event.target.value)}
                    />
                  </label>
                  <div className={styles.formGrid}>
                    <label>
                      New chef password
                      <input
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                    <label>
                      Confirm new chef password
                      <input
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                      />
                    </label>
                  </div>
                </>
              )}
              {mode === 'update' && (
                <p className={styles.help}>
                  Saving revokes this chef’s current kitchen sessions. They must sign in again.
                </p>
              )}
              {mode === 'reset-password' && (
                <p className={styles.help}>
                  Reset revokes existing kitchen sessions. An incomplete reset leaves the account
                  blocked until a successful retry.
                </p>
              )}
              <button className="btn btn-dark" type="submit" disabled={busy || loading}>
                {busy
                  ? 'Saving…'
                  : mode === 'create'
                    ? 'Create chef account'
                    : mode === 'update'
                      ? 'Save chef details'
                      : 'Reset chef password'}
              </button>
            </fieldset>
          </form>
        )}
      </div>
    </section>
  );
}
