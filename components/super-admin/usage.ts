// A linha que /api/platform/usage devolve por clínica. Partilhada pelas quatro páginas
// que a leem (Organizações, Localizações, Onboarding, Utilização, Retenção) para o
// contrato ficar num sítio só.
export interface UsageRow {
  id: string;
  name: string;
  city: string;
  status: string;
  created_at: string;
  operatories: number;
  patients: number;
  active_users: number;
  appts_30d: number;
  appts_prev_30d: number;
  last_appointment: string | null;
  agent_runs_7d: number;
}

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
  if (d === null) return { key: 'never', label: 'NUNCA USOU', color: '#5E6C84', bg: '#F4F7FA' };
  if (d <= 7) return { key: 'active', label: 'ATIVA', color: '#00875A', bg: '#E3FCEF' };
  if (d <= 30) return { key: 'slowing', label: 'A ABRANDAR', color: '#B25000', bg: '#FFF7E6' };
  return { key: 'at-risk', label: 'EM RISCO', color: '#DE350B', bg: '#FFEBE6' };
}
