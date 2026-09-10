'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function BillingUsage() {
  return (
    <NotInstrumented
      title="Consumo"
      sub="Consumo faturável por clínica"
      purpose={
        'O que cada clínica consumiu no período faturável, se o preço tiver uma componente variável: SMS enviadas, chamadas atendidas, chamadas ao modelo.'
      }
      needs={['Um modelo de preços que diga o que é faturável e a que preço']}
      note={
        'Metade da matéria-prima já existe e é real: as chamadas ao modelo estão em `ai_calls` (visíveis em Custos de IA) e as mensagens em `notifications`. Falta o preço, não a contagem.'
      }
    />
  );
}
