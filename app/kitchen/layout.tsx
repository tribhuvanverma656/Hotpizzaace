import type { Metadata } from 'next';
import { KitchenProvider } from '@/components/kitchen/provider';
import styles from '@/components/kitchen/kitchen.module.css';
export const metadata: Metadata = { title: 'Kitchen', robots: { index: false, follow: false } };
export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return (
    <KitchenProvider>
      <main className={styles.shell}>{children}</main>
    </KitchenProvider>
  );
}
