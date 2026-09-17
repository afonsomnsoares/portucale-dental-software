import GroupView from '@/components/super-admin/pages/GroupView';
import { requirePage } from '@/lib/serverPage';

// Lê TODAS as clínicas, por isso `platform` e não `permission` — o mesmo porteiro das
// outras páginas de plataforma. Ver o cabeçalho de lib/group.ts: este é o único sítio do
// produto que atravessa o isolamento por tenant de propósito.
export default async function Page() {
  await requirePage({ platform: 'tenants:manage', tenant: 'optional' });
  return <GroupView />;
}
