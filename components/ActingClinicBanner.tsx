'use client';
import { useState } from 'react';
import { useAuth } from '@/app/providers';

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
        background: 'var(--urgency-soon-bg)',
        borderBottom: `1px solid var(--urgency-soon-border)`,
        color: 'var(--text-primary)',
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
          border: `1px solid var(--urgency-soon-border)`,
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-control)',
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
