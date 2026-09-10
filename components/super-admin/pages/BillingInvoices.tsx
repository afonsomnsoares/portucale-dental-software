'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function BillingInvoices() {
  return (
    <NotInstrumented
      title="Faturas"
      sub="Faturas emitidas às clínicas"
      purpose={'As faturas que a Portucale emite às clínicas, por período e por clínica.'}
      needs={[
        'Subscrições e consumo faturável',
        'Emissão de documento — que para faturas portuguesas exige software certificado',
      ]}
      note={
        'Cuidado com o nome: /dashboard/admin/invoices já existe e é outra coisa — as faturas que a CLÍNICA emite aos doentes. Estas são as que a Portucale emite às clínicas.'
      }
    />
  );
}
