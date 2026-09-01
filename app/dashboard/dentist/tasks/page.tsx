'use client';
import { useAuth } from '@/app/providers';
import TasksQueueView from '@/components/patient/TasksQueueView';

export default function DentistTasksPage() {
  const { api, user } = useAuth();
  return <TasksQueueView api={api} currentUserId={user?.id} />;
}
