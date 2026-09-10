'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function BillingPayments() {
  return (
    <NotInstrumented
      title="Pagamentos"
      sub="Cobranças às clínicas"
      purpose={'As cobranças feitas a cada clínica, o que passou, o que falhou e o que está por tentar de novo.'}
      needs={['Subscrições (a página anterior)', 'Um prestador de pagamentos ligado']}
      note={
        'PRODUCT.md exclui o processamento de pagamentos do âmbito do produto — mas isso é sobre pagamentos de DOENTES às clínicas. Cobrar a subscrição às clínicas é outro assunto e provavelmente resolve-se com um prestador externo, sem esta aplicação tocar em cartões.'
      }
    />
  );
}
