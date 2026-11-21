import Image from 'next/image';
import Link from 'next/link';
import type { ButtonHTMLAttributes } from 'react';
import styles from './google-sign-in-button.module.css';

/** Google's light button uses the official, unmodified gradient G and Google Sans. */
export function GoogleSignInButton({
  children = 'Continue with Google',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={[styles.button, className].filter(Boolean).join(' ')} {...props}>
      <Image
        src="/branding/google-g.png"
        width={20}
        height={20}
        alt=""
        aria-hidden="true"
        unoptimized
      />
      <span>{children}</span>
    </button>
  );
}

export function GoogleSignInLegal() {
  return (
    <p className={styles.legal}>
      Read our <Link href="/privacy-policy">Privacy Policy</Link> and{' '}
      <Link href="/terms-and-conditions">Terms</Link>.
    </p>
  );
}
