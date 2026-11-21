'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ChefHat } from 'lucide-react';
import { KitchenApiError, kitchenErrorMessage } from './client';
import { useKitchen } from './provider';
import styles from './kitchen.module.css';

export function KitchenAccessMessage() {
  const kitchen = useKitchen();
  return (
    <section className={styles.loginCard} aria-labelledby="kitchen-access-heading">
      <ChefHat size={32} />
      <h1 id="kitchen-access-heading">Kitchen access</h1>
      <p role="status">
        {kitchen.status === 'checking' ? 'Checking kitchen access…' : kitchen.notice}
      </p>
      {kitchen.status === 'disabled' && (
        <p>The owner will let you know when your kitchen login is ready.</p>
      )}
      {kitchen.status === 'unavailable' && (
        <button
          className={styles.primary}
          onClick={() =>
            void (kitchen.logoutUnconfirmed ? kitchen.signOut() : kitchen.checkSession())
          }
        >
          {kitchen.logoutUnconfirmed ? 'Retry sign out' : 'Retry connection'}
        </button>
      )}
    </section>
  );
}
export function KitchenLogin() {
  const kitchen = useKitchen();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (kitchen.status === 'ready') router.replace('/kitchen');
  }, [kitchen.status, router]);
  useEffect(() => {
    const clear = () => setPassword('');
    window.addEventListener('pageshow', clear);
    return () => window.removeEventListener('pageshow', clear);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || kitchen.status !== 'signed_out') return;
    lock.current = true;
    setBusy(true);
    setError('');
    const submitted = password;
    setPassword('');
    try {
      await kitchen.signIn(username, submitted);
      router.replace('/kitchen');
    } catch (cause) {
      if (cause instanceof KitchenApiError && cause.code === 'kitchen_disabled')
        kitchen.endSession(true);
      else
        setError(
          cause instanceof KitchenApiError && cause.status === 401
            ? 'The username or password is incorrect, or this account is unavailable.'
            : cause instanceof KitchenApiError
              ? kitchenErrorMessage(cause.code)
              : 'Sign in could not be confirmed. Please try again.',
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (kitchen.status !== 'signed_out') return <KitchenAccessMessage />;
  return (
    <section className={styles.loginCard} aria-labelledby="kitchen-login-heading">
      <ChefHat size={34} />
      <p className={styles.eyebrow}>HOT PIZZA ACE · KITCHEN</p>
      <h1 id="kitchen-login-heading">Kitchen sign in</h1>
      <p>Use the username and password provided by the owner.</p>
      {kitchen.notice && <p role="status">{kitchen.notice}</p>}
      <form onSubmit={submit} className={styles.form}>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={3}
            maxLength={32}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
        </label>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <button className={styles.primary} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className={styles.help}>Forgot your details? Ask the owner.</p>
    </section>
  );
}
