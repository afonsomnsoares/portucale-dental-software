// Shared by RiskTab/HeatmapTab/WaitlistEntriesTable/WaitlistCreateModal — weekday labels,
// heatmap time buckets, waitlist status labels, and the heatmap color scale all come from
// the same small vocabulary, so they live together instead of duplicated per component.
export const WEEKDAYS = [
  { key: 1, label: 'Seg' },
  { key: 2, label: 'Ter' },
  { key: 3, label: 'Qua' },
  { key: 4, label: 'Qui' },
  { key: 5, label: 'Sex' },
  { key: 6, label: 'Sáb' },
  { key: 0, label: 'Dom' },
];

export const BUCKETS = [
  { key: 'morning', label: 'Manhã (8-12h)' },
  { key: 'afternoon', label: 'Tarde (12-17h)' },
  { key: 'evening', label: 'Final do dia (17-20h)' },
];

export const WAITLIST_STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  offered: 'Oferta enviada',
  fulfilled: 'Concluído',
  expired: 'Expirado',
  cancelled: 'Cancelado',
};

export function heatColor(rate: number) {
  if (rate >= 0.4) return { bg: 'var(--red-bg)', color: 'var(--red)' };
  if (rate >= 0.2) return { bg: 'var(--amber-bg)', color: 'var(--amber)' };
  if (rate > 0) return { bg: 'var(--green-bg)', color: 'var(--green)' };
  return { bg: 'var(--surface-2)', color: 'var(--ink-3)' };
}
