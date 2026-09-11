export default function DashboardLoading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-page)',
        fontFamily: '"Plus Jakarta Sans",sans-serif',
        color: 'var(--text-secondary)',
        fontSize: 'var(--text-base)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 28,
            height: 28,
            border: '2.5px solid var(--border-subtle)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
        <span>A carregar…</span>
      </div>
    </div>
  );
}
