// scripts/seed.js
// Run: node scripts/seed.js
// Seeds the PostgreSQL database with demo data
// @ts-nocheck

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const RESET = process.argv.includes('--reset');
const WITH_DEMO_USERS = process.argv.includes('--with-demo-users') || process.argv.includes('--with-demo');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/portucale_dental',
});

async function seed() {
  const client = await pool.connect();
  try {
    if (RESET) {
      console.log('🗑  A eliminar todas as tabelas...');
      // Was missing every table added after the original baseline (consent_forms,
      // medical_history, prescriptions, lab_orders, treatment_plans, recalls, leads,
      // notifications, job_runs, uploads, role_permissions, and everything that only
      // ever existed via scripts/migrations/* — recovery_snapshots,
      // appointment_cancellations, waitlist_entries, slot_offers, patient_lifecycle_state)
      // — those tables (and their RLS policies) silently survived a "reset", so
      // re-running scripts/schema.sql against them failed on
      // `CREATE POLICY tenant_isolation` already existing. schema_migrations is
      // included too, so the migrate.ts run right after this script (see
      // test/helpers/testDb.ts) re-applies every migration from scratch instead of
      // skipping ones it thinks already ran against a database that, from this point,
      // no longer has their tables.
      await client.query(`
        DROP TABLE IF EXISTS
          patient_data_consents, data_subject_requests, processing_activities,
          data_retention_policies, dpo_contacts, privacy_notices,
          audit_log, patient_timeline, inventory_stock, inventory_items, schema_fields,
          invoices, treatments, appointments,
          patient_alerts, patients, users, tenants,
          treatment_codes, statuses,
          leads, notifications, job_runs, uploads, role_permissions,
          medical_history, prescriptions, lab_orders, treatment_plans, recalls, consent_forms,
          recall_schedule, recovery_snapshots, appointment_cancellations,
          waitlist_entries, slot_offers, patient_lifecycle_state,
          schema_migrations
        CASCADE
      `);
      console.log('   Concluído.');
    }
    console.log('🔧 A executar schema...');
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);

    console.log('🌱 A inserir dados...');
    await client.query('BEGIN');

    // ── SCHEMA FIELDS ─────────────────────────────────────────
    await client.query(`
      INSERT INTO schema_fields (tenant_id, field_name, field_type, rollout, required, pushed_at) VALUES
        (NULL,'tobacco_use',        'enum',     100, true,  '2026-01-10'),
        (NULL,'allergy_penicillin', 'boolean',  100, true,  '2025-11-04'),
        (NULL,'cbct_scan_id',       'uuid_ref', 83,  false, '2026-02-28'),
        (NULL,'insurance_network',  'string',   100, false, '2025-09-17'),
        (NULL,'anxiety_score',      'integer',  66,  false, '2026-03-15'),
        (NULL,'hba1c_level',        'decimal',  0,   false,  NULL)
      ON CONFLICT DO NOTHING
    `);
    console.log('  ✓ Campos de schema');

    // ── LOOKUPS / SETTINGS ─────────────────────────────────────
    const TREATMENT_CODES = [
      // 01 Consulta
      { code: '01.01.01.01', desc: 'Consulta de medicina dentária', category: '01 Consulta', fee: 50 },
      { code: '01.01.01.02', desc: 'Consulta de urgentologia', category: '01 Consulta', fee: 60 },
      { code: '01.01.01.03', desc: 'Revisão periódica', category: '01 Consulta', fee: 40 },
      { code: '01.01.01.04', desc: 'Consulta de avaliação', category: '01 Consulta', fee: 50 },
      { code: '01.01.01.05', desc: 'Consulta pós-operatória', category: '01 Consulta', fee: 40 },
      { code: '01.01.01.06', desc: 'Consulta de emergência', category: '01 Consulta', fee: 60 },
      { code: '01.01.01.07', desc: 'Consulta de consulta externa', category: '01 Consulta', fee: 45 },
      // 02 Medicina Dentária Preventiva
      {
        code: '02.02.01.01',
        desc: 'Limpeza dental (profilaxia)',
        category: '02 Medicina Dentária Preventiva',
        fee: 60,
      },
      { code: '02.02.01.02', desc: 'Aplicação de flúor tópico', category: '02 Medicina Dentária Preventiva', fee: 25 },
      { code: '02.02.01.03', desc: 'Instrução de higiene oral', category: '02 Medicina Dentária Preventiva', fee: 30 },
      // 03 Dentisteria Operatória
      {
        code: '03.01.01.01',
        desc: 'Restauração em resina composta — 1 superfície',
        category: '03 Dentisteria Operatória',
        fee: 70,
      },
      {
        code: '03.01.01.02',
        desc: 'Restauração em resina composta — 2+ superfícies',
        category: '03 Dentisteria Operatória',
        fee: 120,
      },
      { code: '03.01.02.01', desc: 'Restauração em amálgama', category: '03 Dentisteria Operatória', fee: 60 },
      { code: '03.06.01.01', desc: 'Coroa em porcelana', category: '03 Dentisteria Operatória', fee: 600 },
      { code: '03.06.01.02', desc: 'Coroa metalocerâmica', category: '03 Dentisteria Operatória', fee: 500 },
      // 04 Endodontia
      { code: '04.01.01.01', desc: 'Desvitalização — Incisivo', category: '04 Endodontia', fee: 300 },
      { code: '04.01.01.02', desc: 'Desvitalização — Canino', category: '04 Endodontia', fee: 350 },
      { code: '04.01.01.03', desc: 'Desvitalização — Pré-molar', category: '04 Endodontia', fee: 400 },
      { code: '04.01.01.04', desc: 'Desvitalização — Molar', category: '04 Endodontia', fee: 500 },
      { code: '04.01.02.01', desc: 'Retratamento endodôntico — Incisivo', category: '04 Endodontia', fee: 350 },
      { code: '04.01.02.02', desc: 'Retratamento endodôntico — Canino', category: '04 Endodontia', fee: 400 },
      { code: '04.01.02.03', desc: 'Retratamento endodôntico — Pré-molar', category: '04 Endodontia', fee: 450 },
      { code: '04.01.02.04', desc: 'Retratamento endodôntico — Molar', category: '04 Endodontia', fee: 600 },
      // 05 Cirurgia Oral
      { code: '05.02.01.01', desc: 'Extração simples', category: '05 Cirurgia Oral', fee: 70 },
      { code: '05.02.01.02', desc: 'Extração cirúrgica', category: '05 Cirurgia Oral', fee: 150 },
      // 06 Periodontologia
      { code: '06.01.01.01', desc: 'Raspagem e alisamento radicular', category: '06 Periodontologia', fee: 80 },
      // 07 Implantologia
      { code: '07.02.01.01', desc: 'Colocação de implante dentário', category: '07 Implantologia', fee: 2500 },
      // 08 Prótese
      { code: '08.01.01.01', desc: 'Ponte fixa — por unidade', category: '08 Prótese', fee: 600 },
      // 10 Radiologia
      { code: '10.01.01.01', desc: 'Radiografia periapical', category: '10 Radiologia', fee: 15 },
      { code: '10.01.01.02', desc: 'Radiografia panorâmica (OPG)', category: '10 Radiologia', fee: 50 },
    ];

    const STATUS_META = {
      confirmed: { label: 'Confirmado', bg: '#DEEBFF', color: '#0052CC' },
      registered: { label: 'Registado', bg: '#EBECF0', color: '#5E6C84' },
      waiting: { label: 'A aguardar', bg: '#FFF7E6', color: '#FF8B00' },
      'in-operatory': { label: 'Na sala', bg: '#DEEBFF', color: '#0052CC' },
      'procedure-active': { label: 'Procedimento ativo', bg: '#FFEBE6', color: '#DE350B' },
      'ready-dismissal': { label: 'Pronto para alta', bg: '#E3FCEF', color: '#00875A' },
      departed: { label: 'Saiu', bg: '#E6FCFF', color: '#00A3BF' },
      'no-show': { label: 'Faltou', bg: '#FFEBE6', color: '#DE350B' },
      active: { label: 'Ativo', bg: '#E3FCEF', color: '#00875A' },
      provisioning: { label: 'A provisionar', bg: '#FFF7E6', color: '#FF8B00' },
      suspended: { label: 'Suspenso', bg: '#FFEBE6', color: '#DE350B' },
      completed: { label: 'Concluído', bg: '#E3FCEF', color: '#00875A' },
      accepted: { label: 'Aceite', bg: '#DEEBFF', color: '#0052CC' },
      proposed: { label: 'Proposto', bg: '#FFF7E6', color: '#FF8B00' },
      paid: { label: 'Pago', bg: '#E3FCEF', color: '#00875A' },
      partial: { label: 'Parcial', bg: '#FFF7E6', color: '#FF8B00' },
      pending: { label: 'Pendente', bg: '#FFEBE6', color: '#DE350B' },
    };

    const STATUS_TRANSITIONS = {
      confirmed: ['waiting', 'no-show'],
      registered: ['waiting', 'no-show'],
      waiting: ['in-operatory'],
      'in-operatory': ['procedure-active', 'ready-dismissal'],
      'procedure-active': ['ready-dismissal'],
      'ready-dismissal': ['departed'],
      departed: [],
      'no-show': [],
    };

    for (const c of TREATMENT_CODES) {
      await client.query(
        `INSERT INTO treatment_codes (code, description, category, fee) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [c.code, c.desc, c.category, c.fee],
      );
    }
    for (const [key, meta] of Object.entries(STATUS_META)) {
      const trans = (STATUS_TRANSITIONS as Record<string, string[]>)[key] || [];
      await client.query(
        `INSERT INTO statuses (key, label, bg, color, transitions) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [key, meta.label, meta.bg, meta.color, trans],
      );
    }
    console.log('  ✓ Definições (TANOMD, Condições, Estados)');

    if (WITH_DEMO_USERS) {
      const demoTenantName = 'Clínica Portucale';
      const demoTenantCity = 'Lisboa';
      let tenantId = null;
      const existingTenant = await client.query(`SELECT id FROM tenants WHERE name=$1 AND city=$2 LIMIT 1`, [
        demoTenantName,
        demoTenantCity,
      ]);
      if (existingTenant.rowCount) tenantId = existingTenant.rows[0].id;
      if (!tenantId) {
        const createdTenant = await client.query(
          `INSERT INTO tenants (name, city, operatories, status) VALUES ($1,$2,$3,$4) RETURNING id`,
          [demoTenantName, demoTenantCity, 4, 'active'],
        );
        tenantId = createdTenant.rows[0].id;
      }

      await client.query(
        `INSERT INTO schema_fields (tenant_id, field_name, label, description, field_type, enum_values, rollout, required, pushed_at)
         SELECT $1, field_name, label, description, field_type, enum_values, rollout, required, pushed_at
         FROM schema_fields
         WHERE tenant_id IS NULL
         ON CONFLICT DO NOTHING`,
        [tenantId],
      );

      const users = [
        {
          email: 'admin@portucale.dental',
          name: 'Super Admin',
          role: 'super_admin',
          clinic: 'System',
          tenantId: null,
          password: 'admin123',
        },
        {
          email: 'rececao@portucale.dental',
          name: 'Rececionista',
          role: 'receptionist',
          clinic: demoTenantName,
          tenantId,
          password: 'recep123',
        },
        {
          email: 'medico@portucale.dental',
          name: 'Médico Dentista',
          role: 'dentist',
          clinic: demoTenantName,
          tenantId,
          password: 'dent123',
        },
      ];

      for (const u of users) {
        const hashed = await bcrypt.hash(u.password, 10);
        await client.query(
          `INSERT INTO users (email, password, name, role, clinic, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (email) DO NOTHING`,
          [u.email, hashed, u.name, u.role, u.clinic, u.tenantId],
        );
      }
      console.log('  ✓ Utilizadores demo');

      // ── DEMO PATIENTS ────────────────────────────────────────
      const DEMO_PATIENTS = [
        {
          name: 'Maria Silva',
          dob: '1985-03-12',
          phone: '912 345 678',
          email: 'maria.silva@email.pt',
          insurance: 'ADSE',
          nif: '501234567',
          address: 'Rua Augusta 123',
          postal_code: '1100-025',
          city: 'Lisboa',
          tenantId,
        },
        {
          name: 'João Santos',
          dob: '1992-07-24',
          phone: '913 456 789',
          email: 'joao.santos@email.pt',
          insurance: 'Médis',
          nif: '502345678',
          address: 'Av. da Liberdade 45',
          postal_code: '1250-095',
          city: 'Lisboa',
          tenantId,
        },
        {
          name: 'Ana Ferreira',
          dob: '1978-11-02',
          phone: '914 567 890',
          email: 'ana.ferreira@email.pt',
          insurance: 'Multicare',
          nif: '503456789',
          address: 'Rua do Ouro 78',
          postal_code: '1100-061',
          city: 'Lisboa',
          tenantId,
        },
        {
          name: 'Pedro Costa',
          dob: '1990-05-15',
          phone: '915 678 901',
          email: 'pedro.costa@email.pt',
          insurance: 'Particular',
          nif: '504567890',
          address: 'Rua da Prata 32',
          postal_code: '1100-420',
          city: 'Lisboa',
          tenantId,
        },
        {
          name: 'Inês Oliveira',
          dob: '2000-01-30',
          phone: '916 789 012',
          email: 'ines.oliveira@email.pt',
          insurance: 'AdvanceCare',
          nif: '505678901',
          address: 'Rua do Carmo 15',
          postal_code: '1200-092',
          city: 'Lisboa',
          tenantId,
        },
      ];
      const patientIds = [];
      for (const p of DEMO_PATIENTS) {
        const r = await client.query(
          `INSERT INTO patients (tenant_id, name, dob, phone, email, insurance, nif, address, postal_code, city, country, status, data_consent_given, data_consent_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PT','registered',TRUE,NOW()) RETURNING id`,
          [p.tenantId, p.name, p.dob, p.phone, p.email, p.insurance, p.nif, p.address, p.postal_code, p.city],
        );
        patientIds.push(r.rows[0].id);
      }
      console.log('  ✓ Doentes demo');

      const dentistRes = await client.query(`SELECT id FROM users WHERE email='medico@portucale.dental' LIMIT 1`);
      const dentistUser = dentistRes.rows[0] || null;

      // ── MEDICAL HISTORIES ────────────────────────────────────
      const MED_HISTORIES = [
        {
          allergies: [{ name: 'Penicilina', notes: 'Erupção cutânea' }],
          medications: [{ name: 'Lisinopril', dosage: '10mg', frequency: 'diário' }],
          conditions: [{ name: 'Hipertensão', notes: 'Controlada' }],
          family_history: 'Doenças cardíacas',
          smoking: 'nunca',
          pregnancy: false,
        },
        {
          allergies: [],
          medications: [{ name: 'Metformina', dosage: '500mg', frequency: '2x/dia' }],
          conditions: [{ name: 'Diabetes tipo 2', notes: 'HbA1c 7.2' }],
          family_history: 'Diabetes',
          smoking: 'ex-fumador',
          pregnancy: null,
        },
        {
          allergies: [{ name: 'Látex', notes: 'Dermatite de contacto' }],
          medications: [],
          conditions: [{ name: 'Asma', notes: 'Inhalador SOS' }],
          family_history: '—',
          smoking: 'nunca',
          pregnancy: false,
        },
      ];
      for (let i = 0; i < Math.min(MED_HISTORIES.length, patientIds.length); i++) {
        const mh = MED_HISTORIES[i];
        await client.query(
          `INSERT INTO medical_history (patient_id, tenant_id, allergies, medications, conditions, family_history, smoking, pregnancy, updated_by)
           VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9) ON CONFLICT (patient_id) DO UPDATE SET
             allergies=$3::jsonb, medications=$4::jsonb, conditions=$5::jsonb,
             family_history=$6, smoking=$7, pregnancy=$8, updated_by=$9`,
          [
            patientIds[i],
            tenantId,
            JSON.stringify(mh.allergies),
            JSON.stringify(mh.medications),
            JSON.stringify(mh.conditions),
            mh.family_history,
            mh.smoking,
            mh.pregnancy,
            dentistUser?.id,
          ],
        );
      }
      console.log('  ✓ Históricos médicos');

      // ── PRESCRIPTIONS ────────────────────────────────────────
      const PRESCRIPTIONS = [
        {
          patientId: patientIds[0],
          medication: 'Amoxicilina',
          dosage: '500mg',
          frequency: '3x/dia',
          route: 'VO',
          duration: '7 dias',
          quantity: 21,
          refills: 0,
          instructions: 'Tomar com alimentos',
          created_by: dentistUser?.id,
        },
        {
          patientId: patientIds[0],
          medication: 'Ibuprofeno',
          dosage: '600mg',
          frequency: '2x/dia',
          route: 'VO',
          duration: '5 dias',
          quantity: 10,
          refills: 1,
          instructions: 'Tomar após refeições',
          created_by: dentistUser?.id,
        },
        {
          patientId: patientIds[1],
          medication: 'Clorexidina 0.12%',
          dosage: '0.12%',
          frequency: '2x/dia',
          route: 'tópico',
          duration: '14 dias',
          quantity: 1,
          refills: 0,
          instructions: 'Enxaguar 30 segundos',
          created_by: dentistUser?.id,
        },
      ];
      for (const rx of PRESCRIPTIONS) {
        await client.query(
          `INSERT INTO prescriptions (tenant_id, patient_id, medication, dosage, frequency, route, duration, quantity, refills, instructions, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            tenantId,
            rx.patientId,
            rx.medication,
            rx.dosage,
            rx.frequency,
            rx.route,
            rx.duration,
            rx.quantity,
            rx.refills,
            rx.instructions,
            rx.created_by,
          ],
        );
      }
      console.log('  ✓ Prescrições');

      // ── LAB ORDERS ──────────────────────────────────────────
      const LAB_ORDERS = [
        {
          patientId: patientIds[2],
          labName: 'Laboratório Dentário Premium',
          caseType: 'coroa',
          description: 'Coroa PFM dente 14',
          fee: 1200,
          created_by: dentistUser?.id,
        },
        {
          patientId: patientIds[3],
          labName: 'Laboratório Apex',
          caseType: 'ponte',
          description: 'Ponte 3 unidades dentes 19, 20, 21',
          fee: 3400,
          created_by: dentistUser?.id,
          status: 'sent',
        },
      ];
      for (const lo of LAB_ORDERS) {
        await client.query(
          `INSERT INTO lab_orders (tenant_id, patient_id, lab_name, case_type, description, fee, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            tenantId,
            lo.patientId,
            lo.labName,
            lo.caseType,
            lo.description,
            lo.fee,
            lo.status || 'ordered',
            lo.created_by,
          ],
        );
      }
      console.log('  ✓ Encomendas de laboratório');

      // ── TREATMENT PLANS ─────────────────────────────────────
      const TREATMENT_PLANS = [
        {
          patientId: patientIds[0],
          title: 'Reabilitação Oral Completa',
          description: 'Plano de tratamento abrangente',
          phases: [
            { phase: 1, description: 'Consulta e diagnósticos', fee: 350 },
            { phase: 2, description: 'Raspagem e alisamento', fee: 840 },
            { phase: 3, description: 'Coroas #14, #19', fee: 3600 },
          ],
          totalFee: 4790,
          created_by: dentistUser?.id,
        },
        {
          patientId: patientIds[1],
          title: 'Restauração com Implantes',
          description: 'Substituição de #18 e #30',
          phases: [
            { phase: 1, description: 'Extrações', fee: 440 },
            { phase: 2, description: 'Colocação de implantes #18, #30', fee: 7000 },
            { phase: 3, description: 'Coroas sobre implantes', fee: 3600 },
          ],
          totalFee: 11040,
          status: 'approved',
          approved: true,
          created_by: dentistUser?.id,
        },
      ];
      for (const tp of TREATMENT_PLANS) {
        const planRes = await client.query(
          `INSERT INTO treatment_plans (tenant_id, patient_id, title, description, phases, total_fee, status, created_by)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id`,
          [
            tenantId,
            tp.patientId,
            tp.title,
            tp.description,
            JSON.stringify(tp.phases),
            tp.totalFee,
            tp.status || 'draft',
            tp.created_by,
          ],
        );
        const planId = planRes.rows[0].id;
        if (tp.approved) {
          await client.query(
            `UPDATE treatment_plans SET approved=TRUE, approved_at=NOW(), approved_by=$1 WHERE id=$2`,
            [dentistUser?.id, planId],
          );
        }
      }
      console.log('  ✓ Planos de tratamento');

      // ── RECALL SCHEDULES ────────────────────────────────────
      const RECALLS = [
        {
          patientId: patientIds[0],
          recallType: 'checkup',
          intervalMonths: 6,
          lastDone: '2026-01-15',
          nextDue: '2026-07-15',
          active: true,
        },
        {
          patientId: patientIds[1],
          recallType: 'prophylaxis',
          intervalMonths: 6,
          lastDone: '2025-11-20',
          nextDue: '2026-05-20',
          active: true,
        },
        {
          patientId: patientIds[2],
          recallType: 'checkup',
          intervalMonths: 12,
          lastDone: '2025-06-10',
          nextDue: '2026-06-10',
          active: true,
        },
        {
          patientId: patientIds[3],
          recallType: 'follow-up',
          intervalMonths: 3,
          lastDone: '2026-03-01',
          nextDue: '2026-06-01',
          active: true,
        },
        {
          patientId: patientIds[4],
          recallType: 'prophylaxis',
          intervalMonths: 6,
          lastDone: null,
          nextDue: '2026-05-01',
          active: true,
        },
      ];
      for (const r of RECALLS) {
        await client.query(
          `INSERT INTO recalls (tenant_id, patient_id, recall_type, interval_months, last_done, next_due, active, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [tenantId, r.patientId, r.recallType, r.intervalMonths, r.lastDone, r.nextDue, r.active, dentistUser?.id],
        );
      }
      console.log('  ✓ Relembramentos');

      // ── CONSENT FORMS ───────────────────────────────────────
      const CONSENT_FORMS = [
        {
          patientId: patientIds[0],
          procedureName: 'Extração #1',
          description: 'Extração cirúrgica do dente #1',
          signedBy: 'Maria Silva',
          created_by: dentistUser?.id,
        },
        {
          patientId: patientIds[1],
          procedureName: 'Endodontia #19',
          description: 'Tratamento endodôntico no #19',
          signedBy: 'João Santos',
          created_by: dentistUser?.id,
        },
        {
          patientId: patientIds[2],
          procedureName: 'Coroa #14',
          description: 'Coroa em porcelana para o #14',
          signedBy: 'Ana Ferreira',
          created_by: dentistUser?.id,
        },
      ];
      for (const cf of CONSENT_FORMS) {
        await client.query(
          `INSERT INTO consent_forms (tenant_id, patient_id, procedure_name, description, signed_by, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, cf.patientId, cf.procedureName, cf.description, cf.signedBy, cf.created_by],
        );
      }
      // ── INVOICES ────────────────────────────────────────────
      const DEMO_INVOICES = [
        {
          patientId: patientIds[0],
          amount: 2480,
          paid: 2480,
          method: 'multibanco',
          status: 'paid',
          invoiceDate: '2026-06-15',
          items: [
            { description: 'Coroa #14 — Porcelana', amount: 1800 },
            { description: 'Raspagem e alisamento', amount: 280 },
            { description: 'Consulta de medicina dentária', amount: 400 },
          ],
        },
        {
          patientId: patientIds[1],
          amount: 1600,
          paid: 800,
          method: 'seguro',
          status: 'partial',
          invoiceDate: '2026-06-18',
          items: [{ description: 'Desvitalização — Molar', amount: 1600 }],
        },
        {
          patientId: patientIds[2],
          amount: 3500,
          paid: 0,
          method: '—',
          status: 'pending',
          invoiceDate: '2026-06-22',
          dueDate: '2026-07-22',
          items: [{ description: 'Colocação de implante dentário', amount: 3500 }],
        },
        {
          patientId: patientIds[3],
          amount: 600,
          paid: 600,
          method: 'numerário',
          status: 'paid',
          invoiceDate: '2026-06-10',
          items: [
            { description: 'Extração simples', amount: 220 },
            { description: 'Restauração em resina composta', amount: 380 },
          ],
        },
        {
          patientId: patientIds[4],
          amount: 1280,
          paid: 0,
          method: '—',
          status: 'pending',
          invoiceDate: '2026-06-25',
          dueDate: '2026-07-10',
          items: [
            { description: 'Radiografia panorâmica (OPG)', amount: 150 },
            { description: 'Limpeza dental (profilaxia)', amount: 120 },
            { description: 'Aplicação de flúor tópico', amount: 60 },
          ],
        },
      ];
      for (const inv of DEMO_INVOICES) {
        await client.query(
          `INSERT INTO invoices (tenant_id, patient_id, patient_name, dentist_id, amount, paid, method, status, invoice_date, due_date, items, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11::jsonb,$12)`,
          [
            tenantId,
            inv.patientId,
            null,
            dentistUser?.id,
            inv.amount,
            inv.paid || 0,
            inv.method,
            inv.status || 'pending',
            inv.invoiceDate,
            inv.dueDate || null,
            JSON.stringify(inv.items || []),
            dentistUser?.id,
          ],
        );
        if (inv.paid > 0) {
          const newBalance = Math.max(0, inv.amount - inv.paid);
          await client.query(`UPDATE patients SET balance = $1 WHERE id = $2`, [newBalance, inv.patientId]);
        }
      }
      console.log('  ✓ Faturas demo');

      // ── RGPD: PROCESSING ACTIVITIES ────────────────────────
      const PROCESSING_ACTIVITIES = [
        {
          tenantId,
          activityName: 'Prestação de cuidados de saúde oral',
          purpose: 'Registo e tratamento clínico dos doentes',
          lawfulBasis: 'contrato',
          dataCategories: 'Dados de saúde, dados de identificação, dados de contacto',
          recipients: 'Profissionais de saúde da clínica',
          retentionPeriod: '10 anos após último registo',
          securityMeasures: 'Encriptação em repouso e tráfego, acesso controlado por perfil',
        },
        {
          tenantId,
          activityName: 'Gestão financeira',
          purpose: 'Emissão de faturas, contabilidade e cobranças',
          lawfulBasis: 'obrigação legal',
          dataCategories: 'Dados de identificação, dados financeiros, NIF',
          recipients: 'Autoridade tributária, contabilidade',
          retentionPeriod: '10 anos (obrigação fiscal)',
          securityMeasures: 'Encriptação, acesso restrito ao departamento financeiro',
        },
        {
          tenantId,
          activityName: 'Comunicações de marketing',
          purpose: 'Envio de comunicações promocionais e lembretes de consulta',
          lawfulBasis: 'consentimento',
          dataCategories: 'Nome, email, telefone',
          recipients: 'Serviço de marketing interno',
          retentionPeriod: 'Até revogação do consentimento',
          securityMeasures: 'Opt-in explícito, opção de revogação em qualquer momento',
        },
      ];
      for (const pa of PROCESSING_ACTIVITIES) {
        await client.query(
          `INSERT INTO processing_activities (tenant_id, activity_name, purpose, lawful_basis, data_categories, recipients, retention_period, security_measures)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [
            pa.tenantId,
            pa.activityName,
            pa.purpose,
            pa.lawfulBasis,
            pa.dataCategories,
            pa.recipients,
            pa.retentionPeriod,
            pa.securityMeasures,
          ],
        );
      }
      console.log('  ✓ Atividades de tratamento RGPD');

      // ── RGPD: RETENTION POLICIES ───────────────────────────
      const RETENTION_POLICIES = [
        {
          tenantId,
          dataCategory: 'dados_clinicos',
          retentionDays: 3650,
          action: 'anonymize',
          description: 'Dados clínicos dos doentes — conservados 10 anos após último registo',
        },
        {
          tenantId,
          dataCategory: 'dados_financeiros',
          retentionDays: 3650,
          action: 'archive',
          description: 'Dados financeiros e faturação — conservados 10 anos (obrigação fiscal)',
        },
        {
          tenantId,
          dataCategory: 'dados_marketing',
          retentionDays: 0,
          action: 'delete',
          description: 'Dados de marketing — mantidos até revogação do consentimento',
        },
      ];
      for (const rp of RETENTION_POLICIES) {
        await client.query(
          `INSERT INTO data_retention_policies (tenant_id, data_category, retention_days, action, description)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [rp.tenantId, rp.dataCategory, rp.retentionDays, rp.action, rp.description],
        );
      }
      console.log('  ✓ Políticas de conservação RGPD');

      // ── RGPD: DPO CONTACT ──────────────────────────────────
      await client.query(
        `INSERT INTO dpo_contacts (tenant_id, name, email, phone, active)
         VALUES ($1, 'DPO Portucale', 'dpo@portucale.dental', '', TRUE) ON CONFLICT DO NOTHING`,
        [tenantId],
      );
      console.log('  ✓ Contacto DPO');

      // ── RGPD: PRIVACY NOTICE ───────────────────────────────
      await client.query(
        `INSERT INTO privacy_notices (tenant_id, version, title, content, effective_date, active)
         VALUES ($1, '1.0', 'Política de Privacidade Portucale Dental', 'Esta política descreve como a Clínica Portucale recolhe, utiliza e protege os dados pessoais dos seus doentes, em conformidade com o Regulamento Geral sobre a Proteção de Dados (RGPD).', '2026-01-01', TRUE) ON CONFLICT DO NOTHING`,
        [tenantId],
      );
      console.log('  ✓ Política de privacidade');
    }

    await client.query('COMMIT');
    console.log('\n✅ Base de dados iniciada com sucesso!');
    if (WITH_DEMO_USERS) {
      console.log(
        '\nDados demo incluem: 5 doentes, históricos médicos, prescrições, encomendas de laboratório, planos de tratamento, recalls, consentimentos.',
      );
      console.log(
        '\nEntrar com: admin@portucale.dental / admin123 (super admin) ou medico@portucale.dental / dent123 (médico dentista)',
      );
    } else {
      console.log('\nPróximo passo: abrir a aplicação e criar a primeira conta de Super Admin.');
    }
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    console.error('❌ Seed falhou:', err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
