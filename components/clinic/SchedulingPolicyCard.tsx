'use client';
import { useEffect, useState } from 'react';
import { FormField, GhostBtn, Inp, PrimaryBtn, Sel } from '@/components/ui';
import type { DemandSource, SchedulingMode, SchedulingPolicyView } from '@/lib/types';

// A fronteira do agente de agenda, escrita por quem responde pela clínica.
//
// O ponto desta página não é a configuração — é a responsabilidade. Um software
// que contacta doentes sozinho tem de conseguir responder a "quem autorizou
// isto?", e a resposta não pode ser "veio assim". Por isso o valor por omissão é
// 'Só propor' e subir a autonomia é um ato explícito, com o aviso à frente.

const MODES: Array<{ value: SchedulingMode; label: string; help: string }> = [
  { value: 'off', label: 'Desligado', help: 'O agente não calcula nem contacta ninguém.' },
  {
    value: 'propose',
    label: 'Só propor',
    help: 'Calcula quem encaixa em cada espaço livre e mostra a lista. Ninguém é contactado.',
  },
  {
    value: 'contact',
    label: 'Contactar',
    help: 'Envia SMS aos doentes que escolheu. A marcação continua a passar por uma pessoa.',
  },
  {
    value: 'autobook',
    label: 'Contactar e marcar',
    help: 'Um "SIM" do doente marca a consulta sozinho, dentro dos limites abaixo.',
  },
];

const SOURCES: Array<{ value: DemandSource; label: string; help: string }> = [
  { value: 'waitlist', label: 'Lista de espera', help: 'Quem se inscreveu à espera de vaga.' },
  { value: 'treatment_open', label: 'Planos parados', help: 'Tratamentos aceites sem próxima sessão marcada.' },
  { value: 'recall_due', label: 'Recalls vencidos', help: 'Higienes e revisões fora de prazo.' },
  { value: 'advance', label: 'Antecipações', help: 'Quem tem consulta longe e talvez viesse mais cedo.' },
  {
    value: 'reactivation',
    label: 'Reativação',
    help: 'Doentes inativos com consentimento de contacto. Desligado por omissão.',
  },
];

export default function SchedulingPolicyCard({
  policy,
  canManage,
  saving,
  onSave,
}: {
  policy: SchedulingPolicyView | null;
  canManage: boolean;
  saving?: boolean;
  onSave: (patch: Partial<SchedulingPolicyView>) => void;
}) {
  const [form, setForm] = useState<SchedulingPolicyView | null>(policy);

  useEffect(() => {
    setForm(policy);
  }, [policy]);

  if (!form) return null;

  const set = <K extends keyof SchedulingPolicyView>(key: K, value: SchedulingPolicyView[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));
  const num = (key: keyof SchedulingPolicyView, value: string) =>
    set(key, (Number(value) || 0) as SchedulingPolicyView[typeof key]);

  const toggleSource = (source: string) =>
    set(
      'allowedSources',
      form.allowedSources.includes(source)
        ? form.allowedSources.filter((s) => s !== source)
        : [...form.allowedSources, source],
    );

  const dirty = JSON.stringify(form) !== JSON.stringify(policy);
  const mode = MODES.find((m) => m.value === form.mode);

  return (
    <div className="card p-5">
      <div className="section-label mb-3">AUTONOMIA DO AGENTE</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <FormField label="O que o agente pode fazer" hint={mode?.help}>
          <Sel value={form.mode} disabled={!canManage} onChange={(e) => set('mode', e.target.value as SchedulingMode)}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Sel>
        </FormField>

        <FormField label="Dias à frente" hint="Até onde procura espaços livres.">
          <Inp
            type="number"
            min={1}
            max={60}
            value={form.horizonDays}
            disabled={!canManage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => num('horizonDays', e.target.value)}
          />
        </FormField>

        <FormField label="Ofertas por espaço" hint="Quantos doentes se contactam pela mesma cadeira.">
          <Inp
            type="number"
            min={1}
            max={10}
            value={form.maxOffersPerSlot}
            disabled={!canManage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => num('maxOffersPerSlot', e.target.value)}
          />
        </FormField>

        <FormField label="Teto de contactos por dia" hint="Travão da clínica inteira, somando todas as fontes.">
          <Inp
            type="number"
            min={0}
            max={1000}
            value={form.dailyContactCap}
            disabled={!canManage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => num('dailyContactCap', e.target.value)}
          />
        </FormField>

        <FormField label="Pontuação mínima" hint="Abaixo disto o doente aparece na lista mas não é contactado.">
          <Inp
            type="number"
            min={0}
            max={100}
            value={form.minScore}
            disabled={!canManage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => num('minScore', e.target.value)}
          />
        </FormField>

        <FormField label="Dias entre contactos ao mesmo doente" hint="Protege quem cabe em muitos espaços.">
          <Inp
            type="number"
            min={0}
            max={90}
            value={form.patientCooldownDays}
            disabled={!canManage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => num('patientCooldownDays', e.target.value)}
          />
        </FormField>

        <FormField label="Validade da oferta (horas)" hint="Nunca ultrapassa a hora da própria vaga.">
          <Inp
            type="number"
            min={1}
            max={168}
            value={form.offerExpiryHours}
            disabled={!canManage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => num('offerExpiryHours', e.target.value)}
          />
        </FormField>

        <FormField label="Silêncio das / até" hint="Horas em que não sai nenhuma mensagem.">
          <div className="flex items-center gap-2">
            <Inp
              type="number"
              min={0}
              max={23}
              value={form.quietHoursStart}
              disabled={!canManage}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => num('quietHoursStart', e.target.value)}
            />
            <span style={{ color: 'var(--ink-3)' }}>—</span>
            <Inp
              type="number"
              min={0}
              max={23}
              value={form.quietHoursEnd}
              disabled={!canManage}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => num('quietHoursEnd', e.target.value)}
            />
          </div>
        </FormField>
      </div>

      <div className="section-label mt-4 mb-2">DE ONDE PODE VIR A PROCURA</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SOURCES.map((s) => (
          <label key={s.value} className="flex items-start gap-2" style={{ cursor: canManage ? 'pointer' : 'default' }}>
            <input
              type="checkbox"
              checked={form.allowedSources.includes(s.value)}
              disabled={!canManage}
              onChange={() => toggleSource(s.value)}
              style={{ marginTop: 3 }}
            />
            <span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
              <span className="text-xs" style={{ color: 'var(--ink-3)', display: 'block' }}>
                {s.help}
              </span>
            </span>
          </label>
        ))}
      </div>

      {canManage && (
        <div className="flex items-center gap-2 mt-4">
          <PrimaryBtn onClick={() => onSave(form)} disabled={!dirty || saving}>
            {saving ? 'A guardar…' : 'Guardar política'}
          </PrimaryBtn>
          {dirty && <GhostBtn onClick={() => setForm(policy)}>Repor</GhostBtn>}
        </div>
      )}
      {!canManage && (
        <div className="text-xs mt-4" style={{ color: 'var(--ink-3)' }}>
          Só a direção da clínica pode alterar a autonomia do agente.
        </div>
      )}
    </div>
  );
}
