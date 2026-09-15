'use client';

// Último recurso: um erro lançado no PRÓPRIO app/layout.tsx não é apanhado por
// app/error.tsx nem por app/dashboard/error.tsx — nessa altura já não há layout onde
// os pendurar. Sem este ficheiro, o Next serve a sua página de erro por omissão: em
// inglês, sem relação nenhuma com o resto da interface, e sem dizer o que fazer a
// seguir.
//
// Substitui a raiz inteira, por isso tem de trazer o seu próprio <html> e <body> — é
// a única exceção no App Router, e a razão pela qual não pode usar os componentes de
// components/ui.tsx (que assumem os tokens de app/globals.css, que aqui podem não ter
// chegado a carregar). Daí o CSS estar escrito à mão e literal.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-PT">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#f2f5f4',
          color: '#101f1e',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 10px' }}>A aplicação não conseguiu arrancar</h1>
          <p style={{ color: '#465956', fontSize: 15, lineHeight: 1.6, margin: '0 0 20px' }}>
            Isto não é um problema dos seus dados — nada do que estava a fazer se perdeu. Tente recarregar; se voltar a
            acontecer, avise quem administra a clínica.
          </p>

          {error.digest && (
            <p style={{ color: '#6d817d', fontSize: 13, margin: '0 0 20px' }}>
              Referência para o suporte: <code style={{ fontFamily: 'ui-monospace, monospace' }}>{error.digest}</code>
            </p>
          )}

          <button
            type="button"
            onClick={reset}
            style={{
              border: 'none',
              background: '#0d5a57',
              color: '#fff',
              borderRadius: 6,
              padding: '10px 18px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
