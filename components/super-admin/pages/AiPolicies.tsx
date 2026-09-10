'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function AiPolicies() {
  return (
    <NotInstrumented
      title="Políticas de IA"
      sub="Fronteiras dos agentes"
      purpose={
        'O que os agentes podem decidir sozinhos e o que exige uma pessoa — por clínica e por agente. É a definição mais consequente que existe neste produto.'
      }
      needs={[
        'Uma tabela de políticas por clínica e por agente',
        'Os agentes a lerem essa política em vez de a terem fixa no código',
      ]}
      note={
        'As fronteiras existem HOJE, mas em código e não em definições: cada agente declara a sua em `lib/agents/registry.ts` (campo `boundary`), o envio a leads exige sempre um clique (app/api/leads/[id]/send-reply), e lib/conversationCalc.ts escala sempre para uma pessoa qualquer mensagem com sinais clínicos, em todos os níveis de autonomia. O nível de autonomia da caixa de entrada é, esse sim, configurável (migração 049) — é o único que já é definição e não código.'
      }
    />
  );
}
