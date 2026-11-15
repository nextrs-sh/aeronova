'use client';

// Last-resort boundary for failures in the root layout; it must render its own document.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          margin: 0,
          background: '#f5f7fb',
          color: '#101E38',
        }}
      >
        <main style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 32 }}>Velasia Airways is temporarily unavailable</h1>
          <p style={{ color: '#4a5875' }}>Please try again in a moment.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: '12px 24px',
              borderRadius: 999,
              border: 0,
              background: '#b5430b',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
