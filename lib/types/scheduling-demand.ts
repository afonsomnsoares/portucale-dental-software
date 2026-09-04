// As fontes de procura do Dynamic Scheduling, num ficheiro sem dependências
// nenhumas para poderem ser importadas tanto pelo módulo puro do servidor
// (lib/demandPoolCalc.ts) como por um componente 'use client'.
export type DemandSource = 'waitlist' | 'treatment_open' | 'recall_due' | 'advance' | 'reactivation';
