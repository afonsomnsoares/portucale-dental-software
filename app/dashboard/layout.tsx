'use client';
import { Menu } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import ActingClinicBanner from '@/components/ActingClinicBanner';
import Sidebar from '@/components/Sidebar';
import { AppLogo } from '@/components/ui';
import { ROLE_HOME } from '@/lib/constants';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [user, loading, router]);

  // Navegar fecha a gaveta. O onNavigate dos links trata do caso normal; isto
  // apanha o resto — um redirecionamento, o botão de voltar do browser.
  // biome-ignore lint/correctness/useExhaustiveDependencies: é a mudança de rota que fecha
  useEffect(() => {
    setMenuAberto(false);
  }, [pathname]);

  useEffect(() => {
    if (loading || !user) return;
    const role = user.role as keyof typeof ROLE_HOME;
    // O super_admin dentro de uma clínica usa a árvore do admin — mesma exceção que o
    // middleware faz do lado do servidor. Sem isto, este espelho expulsava-o de
    // /dashboard/admin no primeiro render e "entrar na clínica" nunca chegava a funcionar.
    const insideClinic = role === 'super_admin' && !!user.actingTenantId;
    // 'admin' e 'super-admin' são árvores separadas, uma por papel — ver o
    // DASHBOARD_ACCESS de proxy.ts, que isto espelha do lado do cliente para
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
          fontSize: 'var(--text-base)',
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
    <div className="app-shell">
      <Sidebar open={menuAberto} onNavigate={() => setMenuAberto(false)} />
      {/* Só existe abaixo de 900 px (ver .app-scrim). Fechar ao clicar fora é o
          que faz uma gaveta parecer uma gaveta. */}
      {menuAberto ? (
        <button type="button" className="app-scrim" aria-label="Fechar menu" onClick={() => setMenuAberto(false)} />
      ) : null}
      <div className="app-main-col">
        <ActingClinicBanner />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px 0' }}>
          <button
            type="button"
            className="app-sidebar-toggle"
            aria-label="Abrir menu"
            aria-expanded={menuAberto}
            onClick={() => setMenuAberto(true)}
          >
            <Menu size={18} />
          </button>
        </div>
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
