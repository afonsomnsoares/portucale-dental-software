'use client';
import { GitCompareArrows } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import ImagingCompareView from '@/components/dentist/ImagingCompareView';
import ImagingScanGrid, { type ImagingScan } from '@/components/dentist/ImagingScanGrid';
import ImagingTypeFilterBar from '@/components/dentist/ImagingTypeFilterBar';
import { PageHeader, Sel } from '@/components/ui';
import type { Patient } from '@/lib/types';

const TYPE_COLORS: Record<string, string> = {
  Panoramic: '#0052CC',
  Bitewing: '#00875A',
  'CBCT 3D': '#5243AA',
  Periapical: '#FF8B00',
};

export default function ImagingPage() {
  const { api } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selPat, setSelPat] = useState('');
  const [scans, setScans] = useState<ImagingScan[]>([]);
  const [compare, setCompare] = useState(false);
  const [divider, setDivider] = useState(50);
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    api('/patients')
      .then((pts) => {
        setPatients(pts || []);
        if (pts?.length) setSelPat(pts[0].id);
      })
      .catch(() => {});
  }, [api]);
  useEffect(() => {
    if (selPat)
      api(`/imaging?patientId=${selPat}`)
        .then(setScans)
        .catch(() => setScans([]));
  }, [selPat, api]);

  const types = ['All', ...new Set(scans.map((s) => s.type))];
  const visible = filter === 'All' ? scans : scans.filter((s) => s.type === filter);

  return (
    <div>
      <PageHeader
        title="Imaging Suite"
        sub="X-ray and CBCT viewer with time-lapse comparison"
        action={
          compare ? (
            'Exit Compare'
          ) : (
            <>
              <GitCompareArrows size={14} /> Time-Lapse Compare
            </>
          )
        }
        onAction={() => setCompare((c) => !c)}
      >
        <Sel value={selPat} onChange={(e) => setSelPat(e.target.value)} style={{ maxWidth: 240 }}>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} #{p.global_seq}
            </option>
          ))}
        </Sel>
      </PageHeader>

      {compare ? (
        <ImagingCompareView divider={divider} onDividerChange={setDivider} />
      ) : (
        <>
          <ImagingTypeFilterBar types={types} filter={filter} onChange={setFilter} />
          <ImagingScanGrid scans={visible} onSelectScan={() => setCompare(true)} typeColors={TYPE_COLORS} />
        </>
      )}
    </div>
  );
}
