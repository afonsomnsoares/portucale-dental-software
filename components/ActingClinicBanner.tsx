'use client';
import { useState } from 'react';
import { useAuth } from '@/app/providers';
import { C } from '@/lib/constants';

// Faixa permanente enquanto o super_admin está dentro de uma clínica. Sem ela não haveria
// nada a distinguir "estou a ver a Clínica do Porto" de "esta é a minha clínica" — e as
// páginas são exatamente as mesmas do admin, de propósito.
export default function ActingClinicBanner() {
  const { user, api } = useAuth();
  const [leaving, setLeaving] = useState(false);

  if (!user?.actingTenantName) return null;

  async function leave() {
    setLeaving(true);
    try {
      await api('/tenants/enter', { method: 'DELETE' });
      // Recarrega em vez de router.push: a sessão do lado do servidor mudou de âmbito e
      // todos os dados já carregados são da clínica de onde se está a sair.
      window.location.href = '/dashboard/super-admin/tenants';
    } catch {
      setLeaving(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 20px',
        background: C.AMB,
        borderBottom: `1px solid ${C.AMBD}`,
        color: C.T,
        fontSize: 13,
      }}
    >
      <span>
        A ver a plataforma como <strong>{user.actingTenantName}</strong>. Tudo o que fizeres aqui fica registado na
        auditoria desta clínica.
      </span>
      <button
        type="button"
        onClick={leave}
        disabled={leaving}
        style={{
          border: `1px solid ${C.AMBD}`,
          background: C.W,
          borderRadius: 6,
          padding: '5px 12px',
          fontSize: 13,
          cursor: leaving ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {leaving ? 'A sair…' : 'Sair da clínica'}
      </button>
    </div>
  );
}
