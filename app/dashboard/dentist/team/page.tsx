'use client';
import { useAuth } from '@/app/providers';
import TeamRosterView from '@/components/team/TeamRosterView';

export default function DentistTeamPage() {
  const { api, user } = useAuth();
  return <TeamRosterView api={api} currentUserId={user?.id} />;
}
