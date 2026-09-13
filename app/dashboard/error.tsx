'use client';

// Fronteira de erro do dashboard. Ao contrário de app/error.tsx (que substitui a
// página inteira), esta fica DENTRO do layout: a sidebar mantém-se, por isso um
// erro numa página não tranca o utilizador — pode navegar para outra secção sem
// recarregar. É o comportamento que interessa aqui, já que cada página vai
// buscar os seus próprios dados e falha isoladamente.
import { useEffect } from 'react';
import { FONTS } from '@/lib/constants';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashboard-error-boundary]', error.digest ?? '', error);
  }, [error]);

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid var(--border-subtle)`,
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--elev-1)',
        padding: 28,
        maxWidth: 520,
        fontFamily: FONTS.body,
      }}
    >
      <h2
        style={{
          fontFamily: FONTS.display,
          fontSize: 'var(--text-base)',
          color: 'var(--text-primary)',
          margin: '0 0 8px',
        }}
      >
        Não foi possível carregar esta página
      </h2>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--text-base)',
          lineHeight: 'var(--text-base-leading)',
          margin: '0 0 18px',
        }}
      >
        Ocorreu um erro ao mostrar esta secção. As outras secções continuam acessíveis pelo menu lateral.
      </p>
      {error.digest && (
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            margin: '0 0 18px',
          }}
        >
          Referência: {error.digest}
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        style={{
          background: 'var(--accent)',
          color: 'var(--bg-surface)',
          border: 'none',
          borderRadius: 'var(--radius-control)',
          padding: '9px 16px',
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--weight-semibold)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
