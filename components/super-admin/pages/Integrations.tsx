'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function Integrations() {
  return (
    <NotInstrumented
      title="Integrações"
      sub="Sistemas ligados às clínicas"
      purpose={
        'O catálogo dos sistemas com que esta plataforma fala — a PMS de cada clínica, o gateway de SMS, o gateway de voz — com o estado de cada ligação por clínica.'
      }
      needs={[
        'Um registo de integrações (que tipos existem, que credenciais precisam, que clínicas as têm)',
        'Uma tabela de ligações por clínica com estado e última verificação',
      ]}
      note={
        'O que existe hoje aproxima-se disto por outro lado: `app/api/webhooks/[channel]` recebe SMS e voz, e a política de canais está fechada em SMS e chamadas por decisão de produto (PRODUCT.md). Uma PMS externa nunca foi ligada.'
      }
    />
  );
}
