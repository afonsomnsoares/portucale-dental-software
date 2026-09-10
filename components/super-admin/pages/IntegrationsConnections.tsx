'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function IntegrationsConnections() {
  return (
    <NotInstrumented
      title="Ligações"
      sub="Credenciais e ligações por clínica"
      purpose={
        'Que clínica tem que ligação ativa, com que credencial, criada por quem e quando. É a página onde se corta o acesso de um fornecedor sem ir à base de dados.'
      }
      needs={[
        'Armazenamento de credenciais por clínica (cifrado, com rotação)',
        'Registo de quem criou e revogou cada ligação, ligado à auditoria',
      ]}
      note={
        'As credenciais de SMS e voz vivem hoje em variáveis de ambiente do processo, iguais para toda a rede — não há nada por clínica para listar.'
      }
    />
  );
}
