import type { NextRequest } from 'next/server';
import { getAuth, unauthorized } from '@/lib/auth';

// In production this would store S3 signed URLs + metadata
// For demo, returns structured scan records per patient

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get('patientId');

  // Return demo scan list — in production, query an imaging table
  const scans = [
    {
      id: 1,
      type: 'Panoramic',
      date: '2026-04-14',
      region: 'Full Arch',
      label: 'Panoramic · Apr 2026',
      icon: '▭',
      patientId,
    },
    {
      id: 2,
      type: 'Bitewing',
      date: '2026-04-14',
      region: 'UR / UL',
      label: 'Bitewing Right · Apr 2026',
      icon: '▭',
      patientId,
    },
    { id: 3, type: 'CBCT 3D', date: '2025-11-20', region: 'Quad 1', label: 'CBCT 3D · Nov 2025', icon: '⬡', patientId },
    {
      id: 4,
      type: 'Periapical',
      date: '2026-02-10',
      region: 'T-14',
      label: 'Periapical #14 · Feb 2026',
      icon: '▭',
      patientId,
    },
    {
      id: 5,
      type: 'Panoramic',
      date: '2024-09-01',
      region: 'Full Arch',
      label: 'Panoramic · Sep 2024',
      icon: '▭',
      patientId,
    },
    {
      id: 6,
      type: 'Bitewing',
      date: '2024-09-01',
      region: 'UR / UL',
      label: 'Bitewing Right · Sep 2024',
      icon: '▭',
      patientId,
    },
  ];

  return Response.json(patientId ? scans : []);
}
