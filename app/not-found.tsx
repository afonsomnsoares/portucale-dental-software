// 404 da aplicação. Sem este ficheiro o Next serve a sua página por omissão, em
// inglês e sem qualquer relação com o resto da interface (que é toda pt-PT).
import { C, FONTS } from '@/lib/constants';

export default function NotFound() {
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
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontFamily: FONTS.display, fontSize: 48, fontWeight: 800, color: C.PBDR, lineHeight: 1 }}>
          404
        </div>
        <h1 style={{ fontFamily: FONTS.display, fontSize: 20, color: C.T, margin: '14px 0 8px' }}>
          Página não encontrada
        </h1>
        <p style={{ color: C.TM, fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
          O endereço que abriu não existe ou deixou de estar disponível.
        </p>
        <a
          href="/"
          style={{
            display: 'inline-block',
            background: C.P,
            color: C.W,
            borderRadius: 8,
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Voltar ao início
        </a>
      </div>
    </div>
  );
}
