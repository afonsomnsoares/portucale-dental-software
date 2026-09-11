// O esqueleto que o Next mostra enquanto um segmento de /dashboard carrega.
//
// Existe como componente partilhado porque os quatro papéis precisam do mesmo
// ecrã e o Next exige um `loading.tsx` POR SEGMENTO — não há como um layout de
// cima o servir aos de baixo. Sem isto seriam quatro ficheiros idênticos a
// divergir devagar, que foi exatamente o que aconteceu.
//
// Distingue-se do app/dashboard/loading.tsx da raiz de propósito: esse cobre o
// ecrã inteiro (a barra lateral ainda não existe), este vive DENTRO da moldura
// do papel e por isso só ocupa a área de conteúdo.
//
// Sem 'use client' — é marcação estática, não tem estado nem eventos.
export default function PageLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0' }}>
      <div
        style={{
          width: 24,
          height: 24,
          border: '2.5px solid var(--border-subtle)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }}
      />
    </div>
  );
}
