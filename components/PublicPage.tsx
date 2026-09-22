// Moldura das páginas públicas — as que se abrem sem sessão, a partir do rodapé do
// ecrã de entrada: /privacidade, /termos e /recuperar-palavra-passe.
//
// Existe porque as três eram links no ecrã de entrada que não iam a lado nenhum. O
// «Recuperar acesso» era o pior dos três: quem está trancado fora da conta é
// exatamente quem clica nele, e caía num 404.
//
// Não usa o layout do dashboard de propósito: aqui não há sessão, logo não há barra
// lateral nem clínica. Segue os mesmos tokens de app/not-found.tsx.
import Link from 'next/link';
import { FONTS } from '@/lib/constants';

export function PublicPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro?: string;
  /** Data da última revisão, para as páginas que a devem mostrar. */
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-page)',
        fontFamily: FONTS.body,
        color: 'var(--text-primary)',
      }}
    >
      <main
        style={{
          maxWidth: 760,
          margin: '0 auto',
          paddingInline: 24,
          paddingBlock: '56px 88px',
        }}
      >
        <Link
          href="/"
          style={{
            display: 'inline-block',
            marginBottom: 32,
            color: 'var(--accent)',
            fontSize: 'var(--text-sm)',
            textDecoration: 'none',
          }}
        >
          ← Voltar à entrada
        </Link>

        <h1
          style={{
            fontFamily: FONTS.display,
            fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--weight-bold)',
            lineHeight: 'var(--text-2xl-leading)',
            margin: '0 0 12px',
            textWrap: 'balance',
          }}
        >
          {title}
        </h1>

        {intro && (
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-base)',
              lineHeight: 'var(--text-base-leading)',
              margin: '0 0 8px',
              maxWidth: '62ch',
            }}
          >
            {intro}
          </p>
        )}

        {updated && (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: '0 0 32px' }}>
            Última revisão: {updated}
          </p>
        )}

        <div style={{ maxWidth: '68ch' }}>{children}</div>

        <p
          style={{
            marginTop: 56,
            paddingTop: 20,
            borderTop: '1px solid var(--border-subtle)',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          © 2026 Portucale Software ·{' '}
          <Link href="/privacidade" style={{ color: 'inherit' }}>
            Privacidade
          </Link>{' '}
          ·{' '}
          <Link href="/termos" style={{ color: 'inherit' }}>
            Termos
          </Link>
        </p>
      </main>
    </div>
  );
}

/** Secção com título — a unidade de que as páginas legais são feitas. */
export function PublicSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 34 }}>
      <h2
        style={{
          fontFamily: FONTS.display,
          fontSize: 'var(--text-lg)',
          fontWeight: 'var(--weight-semibold)',
          margin: '0 0 10px',
        }}
      >
        {heading}
      </h2>
      <div
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--text-base)',
          lineHeight: 'var(--text-base-leading)',
        }}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Caixa para o que a operadora do serviço tem mesmo de preencher — identificação da
 * empresa, morada, contacto do encarregado de proteção de dados. Fica visível de
 * propósito: é preferível dizer «isto falta» do que publicar um texto legal inventado
 * que pareça verdadeiro.
 */
export function PorPreencher({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: '12px 0',
        padding: 12,
        borderLeft: '3px solid var(--amber-700)',
        background: 'var(--bg-surface)',
        color: 'var(--text-secondary)',
        fontSize: 'var(--text-sm)',
        lineHeight: 'var(--text-sm-leading)',
      }}
    >
      {children}
    </p>
  );
}
