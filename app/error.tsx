'use client';

// Fronteira de erro de raiz. Sem ela, uma exceção durante o render deixa o
// utilizador com um ecrã em branco e sem forma de recuperar a não ser recarregar
// à mão — e como quase todo o dashboard é 'use client' e vai buscar os dados
// depois da hidratação, o render é exatamente onde uma resposta inesperada da
// API rebenta. Ver também app/dashboard/error.tsx, que mantém a navegação.
import { useEffect } from 'react';
import { C, FONTS } from '@/lib/constants';

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
        background: C.BG,
        fontFamily: FONTS.body,
        padding: 24,
      }}
    >
      <div
        style={{
          background: C.W,
          border: `1px solid ${C.BDR}`,
          borderRadius: 12,
          boxShadow: C.SH,
          padding: 32,
          maxWidth: 460,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <h1 style={{ fontFamily: FONTS.display, fontSize: 20, color: C.T, margin: '0 0 8px' }}>Algo correu mal</h1>
        <p style={{ color: C.TM, fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
          Ocorreu um erro inesperado. Os dados não foram perdidos — pode tentar novamente.
        </p>
        {error.digest && (
          <p
            style={{
              color: C.TL,
              fontSize: 12,
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
              background: C.P,
              color: C.W,
              border: 'none',
              borderRadius: 8,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Tentar novamente
          </button>
          <a
            href="/"
            style={{
              background: C.W,
              color: C.T,
              border: `1px solid ${C.BDR}`,
              borderRadius: 8,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
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
