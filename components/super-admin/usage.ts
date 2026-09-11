// A forma da linha mudou-se para lib/types/platform.ts — é o contrato da consulta
// que a produz. Fica reexportada daqui porque é daqui que as cinco páginas que a
// desenham (Organizações, Localizações, Onboarding, Utilização, Retenção) a leem,
// a par das funções puras abaixo.
export type { UsageRow } from '@/lib/types/platform';
import type { UsageRow } from '@/lib/types/platform';

/** Dias desde a última marcação. null quando a clínica nunca teve nenhuma. */
export function daysSinceActivity(r: UsageRow): number | null {
  if (!r.last_appointment) return null;
  return Math.floor((Date.now() - new Date(r.last_appointment).getTime()) / 86_400_000);
}

// A classificação de retenção que esta aplicação consegue defender com o que grava.
// Não é um modelo: é a leitura direta de "há quanto tempo é que esta clínica não
// marca nada". Uma clínica dentária sem marcações há um mês não está a usar isto.
export function retentionBand(r: UsageRow): { key: string; label: string; color: string; bg: string } {
  const d = daysSinceActivity(r);
  if (d === null) return { key: 'never', label: 'NUNCA USOU', color: 'var(--text-secondary)', bg: 'var(--bg-page)' };
  if (d <= 7) return { key: 'active', label: 'ATIVA', color: 'var(--urgency-ok)', bg: 'var(--urgency-ok-bg)' };
  if (d <= 30) return { key: 'slowing', label: 'A ABRANDAR', color: 'var(--urgency-soon)', bg: 'var(--urgency-soon-bg)' };
  return { key: 'at-risk', label: 'EM RISCO', color: 'var(--urgency-critical)', bg: 'var(--urgency-critical-bg)' };
}
