'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function IntegrationsApi() {
  return (
    <NotInstrumented
      title="API"
      sub="Acesso programático à plataforma"
      purpose={
        'Chaves de API por clínica, o que cada uma pode fazer, e o consumo de cada uma. É o que permitiria a uma clínica ou a um parceiro construir por cima desta camada.'
      }
      needs={[
        'Autenticação por chave de API (hoje só existe sessão por cookie JWT — ver lib/auth.ts)',
        'Âmbitos por chave, reaproveitando as ações de lib/permissions.ts',
        'Contagem de consumo por chave, para limites e para faturação',
      ]}
      note={
        'O travão de tráfego já existe e funcionaria por chave sem grande mudança: proxy.ts limita por IP e lib/route.ts tem um teto de escrita partilhado em Postgres.'
      }
    />
  );
}
