'use client';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useAuth } from '@/app/providers';
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
    // 'admin' e 'super-admin' são árvores separadas, uma por papel — ver o
    // DASHBOARD_ACCESS de middleware.ts, que isto espelha do lado do cliente para
    // redirecionar sem esperar por uma navegação completa ao servidor.
    if (pathname.startsWith('/dashboard/admin') && role !== 'admin') router.replace(ROLE_HOME[role] || '/');
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
          background: '#F4F7FA',
          fontFamily: '"Plus Jakarta Sans",sans-serif',
          color: '#5E6C84',
          fontSize: 14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
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
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#F4F7FA' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>{children}</main>
    </div>
  );
}
