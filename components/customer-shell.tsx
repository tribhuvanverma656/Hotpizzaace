'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ShoppingBag, MapPin, Menu, X, Phone, Clock, UserRound } from 'lucide-react';
import { attachDemoStoreSync, useDemoStore } from '@/lib/store';
import { money } from '@/lib/utils';
import { getCartTotals } from '@/lib/pricing';
import { OrderTrackingShortcut } from '@/components/order-tracking-shortcut';
import { RestaurantLogo } from '@/components/restaurant-logo';
import { SocialLinks } from '@/components/social-links';
import { BranchPicker } from '@/components/branch-picker';
import '@/components/customer-ordering-ux.css';
export function CustomerShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const { cart, products, settings, coupon, persistenceError, customerSession, selectedBranchId } =
    useDemoStore();
  useEffect(() => {
    void useDemoStore.persist.rehydrate();
    setMounted(true);
    return attachDemoStoreSync();
  }, []);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = () =>
      document.documentElement.style.setProperty(
        '--customer-header-height',
        `${header.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => observer.disconnect();
  }, [path]);
  if (path.startsWith('/admin')) return <>{children}</>;
  const count = mounted ? cart.reduce((a, i) => a + i.quantity, 0) : 0;
  let total = 0;
  try {
    total = mounted ? getCartTotals(cart, products, settings, coupon, 'pickup').total : 0;
  } catch {}
  return (
    <>
      <div className="announcement">
        <span>HAND-TOSSED. OVEN-FIRED. ALWAYS A GOOD IDEA.</span>
        <span className="demo-dot">DEMO EXPERIENCE</span>
      </div>
      <header className="site-header" ref={headerRef}>
        <div className="container nav-row">
          <Link href="/" className="brand restaurant-brand" aria-label="Hot Pizza Ace home">
            <RestaurantLogo />
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            <Link href="/" className={path === '/' ? 'active' : ''}>
              Home
            </Link>
            <Link href="/menu" className={path.startsWith('/menu') ? 'active' : ''}>
              Our menu
            </Link>
            <Link href="/#offers">
              Offers <span className="nav-new">HOT</span>
            </Link>
            <Link href="/track-order" className={path === '/track-order' ? 'active' : ''}>
              Track order
            </Link>
          </nav>
          <div className="nav-actions">
            <BranchPicker />
            <Link
              className="account-nav"
              href={customerSession ? '/account/orders' : '/account/login'}
            >
              <UserRound size={18} />
              <span>{customerSession ? 'My orders' : 'Sign in'}</span>
            </Link>
            <Link href="/cart" className="cart-nav">
              <ShoppingBag size={20} />
              <span>Cart</span>
              <b>{count}</b>
            </Link>
            <button
              className="mobile-menu"
              aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        <nav className="mobile-order-links" aria-label="Your orders">
          <Link href="/track-order" onClick={() => setMobileOpen(false)}>
            Track order
          </Link>
          <Link
            href={customerSession ? '/account/orders' : '/account/login'}
            onClick={() => setMobileOpen(false)}
          >
            {customerSession ? 'My orders' : 'Customer sign in'}
          </Link>
        </nav>
        {mobileOpen && (
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {[
              ['/', 'Home'],
              ['/menu', 'Our menu'],
              ['/#offers', 'Offers'],
              ['/track-order', 'Track order'],
              [
                customerSession ? '/account/orders' : '/account/login',
                customerSession ? 'My orders' : 'Customer sign in',
              ],
              ['/account/addresses', 'Saved addresses'],
            ].map(([url, label]) => (
              <Link key={url} href={url} onClick={() => setMobileOpen(false)}>
                {label}
                <ArrowRight size={16} />
              </Link>
            ))}
          </nav>
        )}
      </header>
      {!['/cart', '/track-order', '/order-success'].includes(path) && (
        <OrderTrackingShortcut banner />
      )}
      {!settings.acceptingOrders || settings.temporarilyClosed ? (
        <div className="closure-banner">
          Our ovens are taking a break. You can browse the menu; ordering is currently paused.
        </div>
      ) : null}
      {persistenceError && (
        <div className="closure-banner persistence-banner" role="alert">
          {persistenceError}
        </div>
      )}
      <main key={selectedBranchId}>{children}</main>
      <footer className="site-footer">
        <div className="container footer-top">
          <div>
            <Link
              href="/"
              className="brand footer-brand restaurant-brand"
              aria-label="Hot Pizza Ace home"
            >
              <RestaurantLogo variant="footer" />
            </Link>
            <p>
              Big on flavour. Made with love.
              <br />
              Your neighbourhood pizza obsession.
            </p>
            <span className="footer-tag">GOOD FOOD. GREAT COMPANY.</span>
            <SocialLinks />
          </div>
          <div>
            <h4>Take a slice</h4>
            <Link href="/menu">Our menu</Link>
            <Link href="/cart">Your cart</Link>
            <Link href="/track-order">Track your order</Link>
            <Link href="/account/orders">My orders</Link>
            <Link href="/account/addresses">Saved addresses</Link>
          </div>
          <div>
            <h4>Come say hello</h4>
            <p>
              <MapPin size={15} />
              {settings.address}
            </p>
            <a href={`tel:${settings.phone}`}>
              <Phone size={15} />
              {settings.phone}
            </a>
            <p>
              <Clock size={15} />
              {settings.openingHours}
            </p>
          </div>
          <div className="footer-last">
            <h4>Fresh from our oven</h4>
            <p>
              Delivery or takeaway.
              <br />
              Great pizza, your way.
            </p>
            <Link href="/menu" className="btn btn-primary">
              Let’s eat <ArrowRight size={17} />
            </Link>
          </div>
        </div>
        <nav className="container footer-policy-links" aria-label="Restaurant information">
          <Link href="/about">About us</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/faq">FAQs</Link>
          <Link href="/delivery-policy">Delivery policy</Link>
          <Link href="/refund-cancellation">Cancellations & refunds</Link>
          <Link href="/privacy-policy">Privacy policy</Link>
          <Link href="/terms-and-conditions">Terms & conditions</Link>
        </nav>
        <div className="container footer-bottom">
          <span>© {new Date().getFullYear()} Hot Pizza Ace. All slices reserved.</span>
          <span>Printed menu · Local demo · No real payments</span>
          <Link href="/admin/login">
            Staff login <ArrowRight size={12} />
          </Link>
        </div>
      </footer>
      {count > 0 && !['/cart', '/checkout', '/order-success'].includes(path) && (
        <Link href="/cart" className="floating-cart">
          <span>
            <ShoppingBag size={18} /> {count} {count === 1 ? 'item' : 'items'} <b>{money(total)}</b>
          </span>
          <span>
            View cart <ArrowRight size={18} />
          </span>
        </Link>
      )}
    </>
  );
}
