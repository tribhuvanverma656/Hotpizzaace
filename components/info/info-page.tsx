import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';
import styles from './info-page.module.css';

type InfoSection = { id: string; title: string; content: ReactNode };

const helpPages = [
  ['/about', 'About us'],
  ['/contact', 'Contact'],
  ['/faq', 'FAQs'],
  ['/delivery-policy', 'Delivery & pickup'],
  ['/refund-cancellation', 'Refunds & cancellations'],
  ['/privacy-policy', 'Privacy policy'],
  ['/terms-and-conditions', 'Terms & conditions'],
] as const;

export function InfoPage({
  title,
  intro,
  currentPath,
  sections,
  updated,
  children,
}: {
  title: string;
  intro: string;
  currentPath: string;
  sections?: InfoSection[];
  updated?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`container ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span aria-current="page">{title}</span>
      </nav>
      <header className={styles.heading}>
        <span className={styles.eyebrow}>HOT PIZZA ACE · GOOD TO KNOW</span>
        <h1>{title}</h1>
        <p>{intro}</p>
        {updated && <small>Updated {updated}</small>}
      </header>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <nav aria-label="Help and restaurant information">
            <p>Here to help</p>
            {helpPages.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={href === currentPath ? styles.current : undefined}
                aria-current={href === currentPath ? 'page' : undefined}
              >
                {label}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </aside>
        <article className={styles.content}>
          {children}
          {sections?.map((section) => (
            <section className={styles.section} key={section.id} id={section.id}>
              <h2>{section.title}</h2>
              {section.content}
            </section>
          ))}
          <div className={styles.backToMenu}>
            <span>A little hungry after all that reading?</span>
            <Link href="/menu">
              Explore the menu <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return <div className={styles.note}>{children}</div>;
}

export function FaqItem({ question, children }: { question: string; children: ReactNode }) {
  return (
    <details className={styles.faq}>
      <summary>{question}</summary>
      <div>{children}</div>
    </details>
  );
}
