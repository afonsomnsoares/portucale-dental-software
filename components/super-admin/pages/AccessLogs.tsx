'use client';
import AuditFeed from '@/components/super-admin/AuditFeed';

export default function AccessLogs() {
  return (
    <AuditFeed
      title="Registos de Acesso"
      sub="Entradas e tentativas falhadas, em toda a rede"
      actions={['AUTH', 'AUTH_FAIL']}
      emptyMessage="Sem entradas registadas"
      footnote={
        'Cada entrada e cada tentativa falhada é escrita por app/api/auth/login/route.ts. O que NÃO está aqui é o IP de origem: só é registado na linha de RATE_LIMIT, e passá-lo a todas as linhas de autenticação é uma alteração a lib/audit.ts.'
      }
    />
  );
}
