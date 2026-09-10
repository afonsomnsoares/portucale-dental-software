'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function IntegrationsSync() {
  return (
    <NotInstrumented
      title="Estado de Sincronização"
      sub="Última sincronização por clínica"
      purpose={
        'Quando é que cada integração sincronizou pela última vez, o que trouxe, e o que falhou. Numa camada que decide sobre dados que vêm de fora, uma sincronização parada há três dias é a causa mais provável de uma decisão errada.'
      }
      needs={['Uma integração que sincronize alguma coisa', 'Um registo de sincronizações com contagens e erros']}
      note={
        'Nada nesta aplicação importa dados de sistemas externos hoje. Os dados entram por escrita direta na UI, por lead público e pelos webhooks de SMS/voz.'
      }
    />
  );
}
