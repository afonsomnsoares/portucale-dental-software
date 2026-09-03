'use client';
import { useAuth } from '@/app/providers';
import DocumentsView from '@/components/documents/DocumentsView';

export default function DentistDocumentsPage() {
  const { api } = useAuth();
  return <DocumentsView api={api} />;
}
