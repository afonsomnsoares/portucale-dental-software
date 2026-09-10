'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function BillingSubscriptions() {
  return (
    <NotInstrumented
      title="Subscrições"
      sub="Plano de cada clínica"
      purpose={'O plano contratado por cada clínica, o preço, o ciclo, e o estado — ativa, em atraso, cancelada.'}
      needs={['Uma tabela de subscrições ligada a `tenants`', 'Um catálogo de planos com preço e limites']}
      note={
        "`tenants.status` já distingue 'active' de 'provisioning', mas é o estado do PROVISIONAMENTO técnico, não o do contrato. Uma clínica pode estar tecnicamente ativa e com a subscrição por pagar."
      }
    />
  );
}
