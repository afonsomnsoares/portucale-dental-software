'use client';
import { useAuth } from '@/app/providers';
import DocumentsView from '@/components/documents/DocumentsView';

// O admin da clínica é o único que gere os modelos por omissão (ver
// 'document-templates:manage' em lib/permissions.ts) — dentista e rececionista só
// emitem a partir deles.
export default function AdminDocumentsPage() {
  const { api } = useAuth();
  return <DocumentsView api={api} canManageTemplates />;
}
