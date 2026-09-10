'use client';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useAuth } from '@/app/providers';
import ActingClinicBanner from '@/components/ActingClinicBanner';
import Sidebar from '@/components/Sidebar';
import { AppLogo } from '@/components/ui';
import { ROLE_HOME } from '@/lib/constants';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [user, loading, router]);

  useEffect(() => {
    if (loading || !user) return;
    const role = user.role as keyof typeof ROLE_HOME;
    // O super_admin dentro de uma clínica usa a árvore do admin — mesma exceção que o
    // middleware faz do lado do servidor. Sem isto, este espelho expulsava-o de
    // /dashboard/admin no primeiro render e "entrar na clínica" nunca chegava a funcionar.
    const insideClinic = role === 'super_admin' && !!user.actingTenantId;
    // 'admin' e 'super-admin' são árvores separadas, uma por papel — ver o
    // DASHBOARD_ACCESS de middleware.ts, que isto espelha do lado do cliente para
    // redirecionar sem esperar por uma navegação completa ao servidor.
    if (pathname.startsWith('/dashboard/admin') && role !== 'admin' && !insideClinic)
      router.replace(ROLE_HOME[role] || '/');
    if (pathname.startsWith('/dashboard/super-admin') && role !== 'super_admin') router.replace(ROLE_HOME[role] || '/');
    if (pathname.startsWith('/dashboard/dentist') && role !== 'dentist') router.replace(ROLE_HOME[role] || '/');
    if (pathname.startsWith('/dashboard/receptionist') && role !== 'receptionist')
      router.replace(ROLE_HOME[role] || '/');
  }, [user, loading, pathname, router]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-page)',
          fontFamily: '"Plus Jakarta Sans",sans-serif',
          color: 'var(--text-secondary)',
          fontSize: 14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-control)',
              overflow: 'hidden',
              animation: 'pulseDot 2s ease-in-out infinite',
            }}
          >
            <AppLogo size={36} />
          </div>
          <span>Loading…</span>
        </div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-page)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ActingClinicBanner />
        <main style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>{children}</main>
      </div>
    </div>
  );
}
