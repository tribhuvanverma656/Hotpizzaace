import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="container empty-state">
      <span style={{ fontSize: 64 }}>🍕</span>
      <h1>This slice is missing.</h1>
      <p>Let’s get you back to something delicious.</p>
      <Link href="/menu" className="btn btn-primary">
        Explore the menu
      </Link>
    </div>
  );
}
