'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function SystemConfig() {
  return (
    <NotInstrumented
      title="Configuração do Sistema"
      sub="Configuração técnica"
      purpose={
        'A configuração técnica em vigor: variáveis de ambiente que mudam comportamento, versão em execução, estado das migrações.'
      }
      needs={[
        'Expor a versão e o commit em execução',
        'Ler o estado das migrações aplicadas e compará-lo com o que está no repositório',
      ]}
      note={
        'Um cuidado que esta página teria de ter: uma parte da configuração técnica são segredos (chave da Anthropic, credenciais de SMS). Mostrar QUE estão definidos é útil; mostrar o VALOR é uma fuga de credenciais num ecrã.'
      }
    />
  );
}
