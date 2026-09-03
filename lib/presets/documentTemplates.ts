import type { DocumentTemplateType } from '../documentsCalc';

// Modelos de documentos administrativos para o mercado português — oferecidos
// como ação "Adicionar modelos PT" na página Documentos (POST
// /api/document-templates com { preset: true }), mesma ideia do
// PT_PATIENT_FIELDS em lib/presets/patientFields.ts.
//
// Todos deliberadamente NÃO clínicos: uma declaração de presença diz que o
// doente esteve na clínica e quanto tempo, nunca o que foi feito nem porquê.
// O âmbito do item 10 da automação é explicitamente "documentação não clínica",
// e é isso que faz com que estes modelos possam ser emitidos pela receção sem
// qualquer decisão médica pelo meio.
export const PT_DOCUMENT_TEMPLATES: Array<{
  name: string;
  type: DocumentTemplateType;
  subject: string;
  body: string;
}> = [
  {
    name: 'Declaração de presença',
    type: 'declaration',
    subject: 'Declaração de presença — {{paciente_nome}}',
    body: `DECLARAÇÃO DE PRESENÇA

Para os devidos efeitos, declara-se que {{paciente_nome}}, nascido(a) a {{paciente_dob}}, esteve presente nesta clínica no dia {{consulta_data}}, pelas {{consulta_hora}}, para consulta de medicina dentária, com uma duração aproximada de {{consulta_duracao}} minutos.

{{clinica_nome}} — {{clinica_cidade}}
{{clinica_cidade}}, {{data_hoje}}

_______________________________
{{emitido_por}}`,
  },
  {
    name: 'Justificação de falta (trabalho/escola)',
    type: 'justification',
    subject: 'Justificação de falta — {{paciente_nome}}',
    body: `JUSTIFICAÇÃO DE FALTA

Declara-se, para efeitos de justificação de falta perante entidade patronal ou estabelecimento de ensino, que {{paciente_nome}} compareceu a consulta de medicina dentária nesta clínica no dia {{consulta_data}}, pelas {{consulta_hora}}.

A presente declaração destina-se exclusivamente a comprovar a comparência, não contendo qualquer informação clínica.

{{clinica_nome}} — {{clinica_cidade}}
{{clinica_cidade}}, {{data_hoje}}

_______________________________
{{emitido_por}}`,
  },
  {
    name: 'Declaração para acompanhante',
    type: 'declaration',
    subject: 'Declaração de acompanhamento — {{paciente_nome}}',
    body: `DECLARAÇÃO DE ACOMPANHAMENTO

Declara-se que o(a) portador(a) desta declaração acompanhou {{paciente_nome}} a consulta de medicina dentária realizada nesta clínica no dia {{consulta_data}}, pelas {{consulta_hora}}, tendo permanecido no estabelecimento durante o período da mesma.

{{clinica_nome}} — {{clinica_cidade}}
{{clinica_cidade}}, {{data_hoje}}

_______________________________
{{emitido_por}}`,
  },
  {
    name: 'Carta de encaminhamento (administrativa)',
    type: 'letter',
    subject: 'Encaminhamento — {{paciente_nome}}',
    body: `Exmo.(a) Senhor(a) Doutor(a),

Encaminhamos o(a) doente {{paciente_nome}}, nascido(a) a {{paciente_dob}}, seguido(a) nesta clínica pelo(a) Dr.(a) {{dentista_nome}}.

Contactos do(a) doente: {{paciente_telefone}} · {{paciente_email}}
Subsistema/seguro: {{paciente_seguro}}

A informação clínica relevante segue em documento próprio, entregue ao(à) doente.

Com os melhores cumprimentos,

{{clinica_nome}} — {{clinica_cidade}}
{{clinica_cidade}}, {{data_hoje}}

_______________________________
{{emitido_por}}`,
  },
];
