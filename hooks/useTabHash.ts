'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Um separador continua a ter endereço ───────────────────────────────────
// Juntar ecrãs em separadores encurtou o menu, mas custava uma coisa que ninguém pediu
// para perder: cada um daqueles ecrãs tinha um URL. Dava para o guardar nos favoritos,
// para o mandar a um colega, e para lhe apontar um link de dentro da aplicação — que é
// exatamente o que components/shared/Reports.tsx faz quando diz «Ver detalhe em
// Recuperação →».
//
// Com o separador em `useState` puro, esse link passaria a aterrar no separador errado e
// a pessoa teria de adivinhar o segundo clique. O teste de links de test/nav.test.ts
// apanhou-o na primeira passagem.
//
// A âncora resolve-o sem nada por baixo: `/dashboard/admin/invoices#recuperacao` abre a
// Faturação já na Recuperação, e clicar num separador reescreve a âncora sem acrescentar
// uma entrada ao histórico — o botão «voltar» continua a sair do ecrã, que é o que se
// espera dele, em vez de percorrer os separadores um a um.
//
// Porquê a âncora e não `?tab=`: a query string obriga a `useSearchParams`, e essa
// obriga a uma fronteira de <Suspense> à volta de cada ecrã sob pena de o build reclamar
// da pré-renderização. A âncora lê-se do `window` depois de montar, e uma página sem
// JavaScript ativo continua a abrir no separador de omissão em vez de rebentar.
export function useTabHash(chaves: readonly string[], omissao: string): [string, (chave: string) => void] {
  const [tab, setTab] = useState(omissao);

  // As chaves chegam quase sempre como um literal declarado no corpo do componente, por
  // isso mudam de identidade a cada render. Numa lista de dependências, isso faria o
  // efeito correr sempre e reescrever a escolha da pessoa a cada pintura.
  const chavesRef = useRef(chaves);
  chavesRef.current = chaves;

  useEffect(() => {
    const alvo = window.location.hash.slice(1);
    if (alvo && chavesRef.current.includes(alvo)) setTab(alvo);
    // Só no arranque. Depois disto quem manda é o clique, e voltar a ler a âncora
    // desfazia-o.
  }, []);

  const escolher = useCallback(
    (chave: string) => {
      setTab(chave);
      // O separador de omissão não deixa âncora: um endereço limpo é o que se copia da
      // barra quando não se andou a navegar dentro do ecrã.
      const url = chave === omissao ? window.location.pathname + window.location.search : `#${chave}`;
      window.history.replaceState(null, '', url);
    },
    [omissao],
  );

  return [tab, escolher];
}
