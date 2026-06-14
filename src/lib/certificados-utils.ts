export const CERTIFICADO_PLACEHOLDERS = [
  { campo: 'ministro_nome', placeholder: '{ministro_nome}', label: 'Nome do Ministro' },
  { campo: 'matricula', placeholder: '{matricula}', label: 'Matrícula' },
  { campo: 'cargo_ministerial', placeholder: '{cargo_ministerial}', label: 'Cargo Ministerial' },
  { campo: 'congregacao', placeholder: '{congregacao}', label: 'Congregação' },
  { campo: 'data_consagracao', placeholder: '{data_consagracao}', label: 'Data de Consagração' },
  { campo: 'presidente_nome', placeholder: '{presidente_nome}', label: 'Presidente' },
  { campo: 'data_emissao', placeholder: '{data_emissao}', label: 'Data de Emissao' },
  { campo: 'nome_igreja', placeholder: '{nome_igreja}', label: 'Nome da Igreja' },
  
  // CONEC
  { campo: 'instituicao_nome', placeholder: '{instituicao_nome}', label: 'Nome da Instituição' },
  { campo: 'cnpj', placeholder: '{cnpj}', label: 'CNPJ' },
  { campo: 'numero_registro', placeholder: '{numero_registro}', label: 'Registro nº' },
  { campo: 'data_credenciamento', placeholder: '{data_credenciamento}', label: 'Data de Credenciamento' },
  { campo: 'validade', placeholder: '{validade}', label: 'Validade' },
  { campo: 'ano_referencia', placeholder: '{ano_referencia}', label: 'Ano Referência' },

  // Eventos
  { campo: 'evento_nome', placeholder: '{evento_nome}', label: 'Nome do Evento' },
  { campo: 'participante_nome', placeholder: '{participante_nome}', label: 'Nome do Participante' },
  { campo: 'evento_carga_horaria', placeholder: '{evento_carga_horaria}', label: 'Carga Horária' },
  { campo: 'evento_data', placeholder: '{evento_data}', label: 'Data do Evento' },

  // Sistema
  { campo: 'data_atual', placeholder: '{data_atual}', label: 'Data Atual' }
];


const formatDate = (value?: string | null) => {
  if (!value) return '';
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [ano, mes, dia] = str.split('-');
    return `${dia}/${mes}/${ano}`;
  }
  return str;
};

export function substituirPlaceholdersCertificado(texto: string, dados: Record<string, any>): string {
  if (!texto) return texto;

  let resultado = texto;
  const today = new Date();
  const dataEmissao = dados.data_emissao || `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  const base: Record<string, any> = {
    ...dados,
    data_emissao: dataEmissao,
    data_consagracao: formatDate(dados.data_consagracao || dados.data_processo || dados.data_evento || '')
  };

  CERTIFICADO_PLACEHOLDERS.forEach((ph) => {
    const regex = new RegExp(ph.placeholder.replace(/[{}]/g, '\\$&'), 'g');
    const valor = base[ph.campo] ?? '';
    resultado = resultado.replace(regex, String(valor));
  });

  return resultado;
}

export function obterPreviewTextoCertificado(texto: string): string {
  if (!texto) return 'Texto';

  let preview = texto;
  CERTIFICADO_PLACEHOLDERS.forEach((ph) => {
    const regex = new RegExp(ph.placeholder.replace(/[{}]/g, '\\$&'), 'g');
    preview = preview.replace(regex, `[${ph.label}]`);
  });

  return preview;
}
