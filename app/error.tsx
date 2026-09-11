'use client';

// Fronteira de erro de raiz. Sem ela, uma exceção durante o render deixa o
// utilizador com um ecrã em branco e sem forma de recuperar a não ser recarregar
// à mão — e como quase todo o dashboard é 'use client' e vai buscar os dados
// depois da hidratação, o render é exatamente onde uma resposta inesperada da
// API rebenta. Ver também app/dashboard/error.tsx, que mantém a navegação.
import { useEffect } from 'react';
import { FONTS } from '@/lib/constants';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // O digest é o que permite cruzar este ecrã com o stack trace do servidor,
    // que o Next não expõe ao cliente em produção.
    console.error('[error-boundary]', error.digest ?? '', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg-page)',
        fontFamily: FONTS.body,
        padding: 24,
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: `1px solid var(--border-subtle)`,
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--elev-1)',
          padding: 32,
          maxWidth: 460,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 'var(--text-2xl)', marginBottom: 12 }}>⚠️</div>
        <h1
          style={{
            fontFamily: FONTS.display,
            fontSize: 'var(--text-lg)',
            color: 'var(--text-primary)',
            margin: '0 0 8px',
          }}
        >
          Algo correu mal
        </h1>
        <p
          style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-base)', lineHeight: 1.55, margin: '0 0 20px' }}
        >
          Ocorreu um erro inesperado. Os dados não foram perdidos — pode tentar novamente.
        </p>
        {error.digest && (
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-jetbrains-mono), monospace',
              margin: '0 0 20px',
            }}
          >
            Referência: {error.digest}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={reset}
            style={{
              background: 'var(--accent)',
              color: 'var(--bg-surface)',
              border: 'none',
              borderRadius: 'var(--radius-control)',
              padding: '10px 18px',
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Tentar novamente
          </button>
          <a
            href="/"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: `1px solid var(--border-subtle)`,
              borderRadius: 'var(--radius-control)',
              padding: '10px 18px',
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--weight-semibold)',
              textDecoration: 'none',
              fontFamily: 'inherit',
            }}
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}
