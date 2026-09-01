'use client';
import { useAuth } from '@/app/providers';
import TeamRosterView from '@/components/team/TeamRosterView';

export default function ReceptionistTeamPage() {
  const { api } = useAuth();
  return <TeamRosterView api={api} />;
}
