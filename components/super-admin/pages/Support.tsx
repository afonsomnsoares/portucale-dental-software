'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function Support() {
  return (
    <NotInstrumented
      title="Suporte"
      sub="Pedidos das clínicas"
      purpose={
        'Os pedidos de ajuda que chegam das clínicas, com a clínica, quem pediu, há quanto tempo está aberto e o que já se respondeu.'
      }
      needs={[
        'Um canal por onde um pedido de suporte entre (formulário na app, e-mail, ou integração com uma ferramenta de tickets)',
        'Estado e histórico por pedido',
      ]}
      note={
        'A caixa de entrada que existe (`app/api/conversations`, migração 049) é entre a clínica e os DOENTES dela — outro eixo, e não deve ser reutilizada para isto.'
      }
    />
  );
}
