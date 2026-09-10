'use client';
import AuditFeed from '@/components/super-admin/AuditFeed';

export default function SecurityEvents() {
  return (
    <AuditFeed
      title="Eventos de Segurança"
      sub="Acessos negados, limites atingidos e apagamentos"
      actions={['AUTH_FAIL', 'FORBIDDEN', 'RATE_LIMIT', 'DELETE']}
      emptyMessage="Nenhum evento de segurança"
      footnote={
        'FORBIDDEN vem de logBlockedAccess (lib/audit.ts), que é chamado sempre que alguém tenta uma ação acima do seu papel — incluindo as leituras de plataforma. DELETE está aqui de propósito: é a ação irreversível.'
      }
    />
  );
}
