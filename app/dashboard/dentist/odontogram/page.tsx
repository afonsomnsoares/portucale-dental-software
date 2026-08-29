'use client';
import { AlertTriangle, Box } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import Odontogram from '@/components/Odontogram';
import { Badge, PageHeader, Sel, Spinner } from '@/components/ui';
import type { Patient, ToothState, Treatment } from '@/lib/types';

export default function DentistOdontogramPage() {
  const { api } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selPat, setSelPat] = useState('');
  const [teeth, setTeeth] = useState<Record<number, ToothState>>({});
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [loading, setLoading] = useState(false);
  const [ptsLoad, setPtsLoad] = useState(true);
  const [use3D, setUse3D] = useState(true);

  useEffect(() => {
    api('/patients')
      .then((pts) => {
        setPatients(pts || []);
        if (pts?.length) setSelPat(pts[0].id);
      })
      .catch(() => {})
      .finally(() => setPtsLoad(false));
  }, [api]);

  const loadData = useCallback(
    async (pid: string) => {
      if (!pid) return;
      setLoading(true);
      const [t, tr] = await Promise.all([
        api(`/patients/${pid}/teeth`).catch(() => ({})),
        api(`/treatments?patientId=${pid}`).catch(() => []),
      ]);
      setTeeth(t || {});
      setTreatments(tr || []);
      setLoading(false);
    },
    [api],
  );
  useEffect(() => {
    if (selPat) loadData(selPat);
  }, [selPat, loadData]);

  async function handleTeethChange(num: number, patch: Partial<ToothState>) {
    const u = await api(`/patients/${selPat}/teeth/${num}`, { method: 'PUT', body: patch }).catch(() => null);
    if (u) {
      setTeeth((prev) => ({
        ...prev,
        [num]: {
          ...prev[num],
          condition: u.condition,
          surfaces: u.surfaces || [],
          notes: u.notes || '',
        },
      }));
    }
  }

  async function handleAddTreatment(data: Record<string, unknown>) {
    const t = await api('/treatments', { method: 'POST', body: { patientId: selPat, ...data } }).catch(() => null);
    if (t) setTreatments((prev) => [...prev, t]);
  }

  const selPatient = patients.find((p) => p.id === selPat);

  return (
    <div>
      <PageHeader title="Odontogram" sub="Interactive dental chart — tag conditions and add treatments per tooth">
        <button
          type="button"
          onClick={() => setUse3D((v) => !v)}
          style={{
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: 'inherit',
            background: use3D ? '#DEEBFF' : 'white',
            border: `1.5px solid ${use3D ? '#0052CC' : '#DFE1E6'}`,
            color: use3D ? '#0052CC' : '#5E6C84',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all 0.12s',
          }}
        >
          <Box size={14} /> {use3D ? '3D' : '2D'} Mode
        </button>
      </PageHeader>
      {/* Patient selector */}
      <div className="card p-4 mb-5">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="section-label" style={{ whiteSpace: 'nowrap' }}>
            PATIENT
          </div>
          {ptsLoad ? (
            <Spinner />
          ) : (
            <Sel value={selPat} onChange={(e) => setSelPat(e.target.value)} style={{ maxWidth: 280 }}>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — #{p.global_seq}
                </option>
              ))}
            </Sel>
          )}
          {selPatient && (
            <>
              {[
                ['DOB', selPatient.dob?.slice(0, 10) || '—'],
                ['Insurance', selPatient.insurance || '—'],
                ['Last Visit', selPatient.last_visit?.slice(0, 10) || '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="section-label" style={{ marginBottom: 2 }}>
                    {k}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#172B4D' }}>{v}</div>
                </div>
              ))}
              <Badge s={selPatient.status} />
              {selPatient.alerts?.filter(Boolean).length > 0 && (
                <div
                  style={{
                    background: '#FFEBE6',
                    borderRadius: 5,
                    padding: '4px 12px',
                    fontSize: 11,
                    color: '#DE350B',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <AlertTriangle size={12} /> {selPatient.alerts.filter(Boolean).join(' · ')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {loading ? (
        <Spinner />
      ) : selPat ? (
        <Odontogram
          patientId={selPat}
          teeth={teeth}
          treatments={treatments}
          onTeethChange={handleTeethChange}
          onAddTreatment={handleAddTreatment}
          use3D={use3D}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#C1C7D0', fontSize: 14 }}>
          Select a patient above to open their odontogram.
        </div>
      )}
    </div>
  );
}
