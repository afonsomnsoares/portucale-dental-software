'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui';

export default function ProgressNotesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/dentist/patients');
  }, [router]);
  return <Spinner />;
}
