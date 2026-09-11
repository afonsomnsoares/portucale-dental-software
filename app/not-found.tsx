// 404 da aplicação. Sem este ficheiro o Next serve a sua página por omissão, em
// inglês e sem qualquer relação com o resto da interface (que é toda pt-PT).
import { FONTS } from '@/lib/constants';

export default function NotFound() {
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
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div
          style={{
            fontFamily: FONTS.display,
            fontSize: 'var(--text-3xl)',
            fontWeight: 'var(--weight-bold)',
            color: 'var(--accent)',
            lineHeight: 1,
          }}
        >
          404
        </div>
        <h1
          style={{
            fontFamily: FONTS.display,
            fontSize: 'var(--text-lg)',
            color: 'var(--text-primary)',
            margin: '14px 0 8px',
          }}
        >
          Página não encontrada
        </h1>
        <p
          style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-base)', lineHeight: 1.55, margin: '0 0 20px' }}
        >
          O endereço que abriu não existe ou deixou de estar disponível.
        </p>
        <a
          href="/"
          style={{
            display: 'inline-block',
            background: 'var(--accent)',
            color: 'var(--bg-surface)',
            borderRadius: 'var(--radius-control)',
            padding: '10px 18px',
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--weight-semibold)',
            textDecoration: 'none',
          }}
        >
          Voltar ao início
        </a>
      </div>
    </div>
  );
}
