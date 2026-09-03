'use client';

// Fronteira de erro do dashboard. Ao contrário de app/error.tsx (que substitui a
// página inteira), esta fica DENTRO do layout: a sidebar mantém-se, por isso um
// erro numa página não tranca o utilizador — pode navegar para outra secção sem
// recarregar. É o comportamento que interessa aqui, já que cada página vai
// buscar os seus próprios dados e falha isoladamente.
import { useEffect } from 'react';
import { C, FONTS } from '@/lib/constants';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashboard-error-boundary]', error.digest ?? '', error);
  }, [error]);

  return (
    <div
      style={{
        background: C.W,
        border: `1px solid ${C.BDR}`,
        borderRadius: 12,
        boxShadow: C.SH,
        padding: 28,
        maxWidth: 520,
        fontFamily: FONTS.body,
      }}
    >
      <h2 style={{ fontFamily: FONTS.display, fontSize: 17, color: C.T, margin: '0 0 8px' }}>
        Não foi possível carregar esta página
      </h2>
      <p style={{ color: C.TM, fontSize: 14, lineHeight: 1.6, margin: '0 0 18px' }}>
        Ocorreu um erro ao mostrar esta secção. As outras secções continuam acessíveis pelo menu lateral.
      </p>
      {error.digest && (
        <p
          style={{
            color: C.TL,
            fontSize: 12,
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
          background: C.P,
          color: C.W,
          border: 'none',
          borderRadius: 8,
          padding: '9px 16px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
