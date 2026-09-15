'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * `useEffect` que só corre depois de as dependências ficarem quietas durante `delay`.
 *
 * A limpeza do efeito anterior era chamada DUAS vezes: uma na limpeza do próprio
 * `useEffect` e outra no topo da execução seguinte, porque `cleanupRef.current` nunca
 * era posto a `undefined` depois de correr. Não dava sintoma nenhum enquanto o hook
 * não teve consumidores — mas a primeira limpeza não-idempotente (fechar uma ligação,
 * cancelar um pedido) partia-se aqui.
 */
export function useDebouncedEffect(effect: () => void | (() => void), deps: unknown[], delay = 300) {
  const cleanupRef = useRef<void | (() => void)>(undefined);

  function runCleanup() {
    const fn = cleanupRef.current;
    // Limpar a referência ANTES de chamar: sem isto, a mesma função era chamada
    // outra vez na execução seguinte.
    cleanupRef.current = undefined;
    if (fn) fn();
  }

  useEffect(() => {
    runCleanup();
    const t = setTimeout(() => {
      cleanupRef.current = effect();
    }, delay);
    return () => {
      clearTimeout(t);
      runCleanup();
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: caller controls deps
  }, deps);
}

/**
 * O valor, mas só depois de parar de mudar durante `delay`.
 *
 * Existe para as caixas de pesquisa que alimentam a chave de um `useQuery`. Escrito
 * directamente, cada tecla muda a chave e dispara um pedido — escrever «Ana Silva»
 * eram nove idas a /api/patients, e o `dedupe` da queryCache não ajuda porque cada
 * chave é diferente das outras. Com isto, só a última conta.
 *
 * Devolve o valor imediatamente na primeira renderização, para que o ecrã não comece
 * vazio à espera do temporizador.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
