'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function FeatureFlags() {
  return (
    <NotInstrumented
      title="Funcionalidades"
      sub="Funcionalidades por clínica"
      purpose={
        'Ligar e desligar funcionalidades por clínica, para lançar por fases sem publicar duas versões do produto.'
      }
      needs={[
        'Uma tabela de flags por clínica',
        'Um ponto de leitura no arranque da sessão, para a UI e a API decidirem igual',
      ]}
      note={
        'A UI de permissões (role_permissions) já faz uma coisa parecida ao nível da AÇÃO e por papel, e a sidebar já a respeita através do campo `requires`. Flags de funcionalidade são o eixo que falta: por clínica, independentemente do papel.'
      }
    />
  );
}
