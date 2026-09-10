'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function AiEvaluations() {
  return (
    <NotInstrumented
      title="Avaliações"
      sub="Qualidade das decisões dos agentes"
      purpose={
        'Se um agente decide sozinho, alguém tem de conseguir dizer se decidiu bem. Esta página compararia a decisão do agente com o que uma pessoa teria feito, por agente e por clínica, ao longo do tempo — a diferença entre confiar num agente e confiar que ele está a correr.'
      }
      needs={[
        'Um conjunto de casos de referência com a decisão correta anotada por uma pessoa',
        'Guardar a decisão do agente de forma comparável (hoje `ai_calls` guarda a conta da chamada, não a decisão)',
        'Um mecanismo de correção: quando alguém desfaz o que o agente propôs, isso é o sinal mais barato que há e ainda não é gravado',
      ]}
      note={
        "Os agentes com `ai: 'wired'` (Lead e Operações) são os únicos onde isto morde hoje — os restantes correm por regra fixa, e uma regra fixa avalia-se lendo o código."
      }
    />
  );
}
