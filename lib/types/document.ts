import type { DocumentTemplateType } from '../documentsCalc';

export type { DocumentTemplateType };

export interface DocumentTemplate {
  id: string;
  tenant_id: string;
  name: string;
  type: DocumentTemplateType;
  subject: string;
  body: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratedDocument {
  id: string;
  tenant_id: string;
  template_id: string | null;
  template_name: string;
  type: DocumentTemplateType;
  patient_id: string;
  patient_name: string;
  appointment_id: string | null;
  title: string;
  body: string;
  variables: Record<string, string>;
  issued_by: string | null;
  issued_by_name: string;
  created_at: string;
}

// Resposta de POST /api/documents — `missing` são os marcadores do catálogo que
// ficaram por preencher e saíram como traço de preenchimento à mão (ver
// BLANK_FILL em lib/documentsCalc.ts), para a UI avisar depois de emitir.
export interface GenerateDocumentResponse {
  document: GeneratedDocument;
  missing: string[];
}
