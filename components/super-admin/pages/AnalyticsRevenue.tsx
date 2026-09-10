'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function AnalyticsRevenue() {
  return (
    <NotInstrumented
      title="Receita"
      sub="Receita da Portucale"
      purpose={
        'MRR, ARR, expansão e contração — a receita que a Portucale cobra às clínicas. Não confundir com a receita que cada clínica cobra aos doentes, que já existe e se vê em Análise da Plataforma.'
      }
      needs={[
        'Subscrições: que plano tem cada clínica, por quanto, desde quando',
        'Um histórico de alterações de plano, sem o qual não há expansão nem contração para calcular',
      ]}
      note={
        'A distinção importa mais do que parece: os euros que a aplicação já sabe somar são os das clínicas. Somá-los aqui daria um número grande e errado.'
      }
    />
  );
}
