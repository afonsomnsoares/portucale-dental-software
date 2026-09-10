'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function PlatformSettings() {
  return (
    <NotInstrumented
      title="Plataforma"
      sub="Definições da plataforma"
      purpose={
        'As definições que valem para toda a rede: identidade do produto, contactos, retenção por omissão, limites por omissão de uma clínica nova.'
      }
      needs={[
        'Uma tabela de definições de plataforma (as que existem hoje são por clínica ou por variável de ambiente)',
      ]}
      note={
        'Os catálogos de /api/settings são por clínica, com uma linha global (tenant_id NULL) por omissão — o mecanismo de «valor global com override por clínica» que isto precisaria já existe e está provado na migração 035.'
      }
    />
  );
}
