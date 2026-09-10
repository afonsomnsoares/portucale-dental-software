'use client';
import AuditFeed from '@/components/super-admin/AuditFeed';

export default function SystemEvents() {
  return (
    <AuditFeed
      title="Eventos de Sistema"
      sub="Tudo o que ficou registado, em todas as clínicas"
      actions={undefined}
      emptyMessage="Sem eventos"
      footnote={
        'É o audit_log inteiro e sem recorte. As linhas são encadeadas por hash (ver o trigger em scripts/schema.sql): uma linha alterada à mão quebra a cadeia da seguinte.'
      }
    />
  );
}
