'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container empty-state">
      <h1>Something interrupted your pizza plans.</h1>
      <p>Please try again. Your saved cart will still be here.</p>
      <button className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
