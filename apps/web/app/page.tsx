/**
 * Root page. Locale routing and the real landing UI land in PR 8 (i18n)
 * and PR 9 (sign-in form + health.me wiring). This placeholder exists so
 * `next build` emits a route and so `/` responds 200 with a human-friendly
 * message during Phase 0 smoke tests.
 */
export default function RootPage() {
  return (
    <main
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div>
        <h1>Forma360</h1>
        <p>Phase 0 foundation running. UI lands in PR 9.</p>
      </div>
    </main>
  );
}
