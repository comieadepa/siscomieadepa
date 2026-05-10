/**
 * Serviço de Certificados — Módulo Eventos
 *
 * Arquitetura preparada para geração futura de PDF.
 * NÃO gera PDF ainda — apenas valida elegibilidade e prepara metadados.
 *
 * Regras de elegibilidade:
 * - status_pagamento = 'pago' OU 'isento'
 * - checkin_realizado = true
 * - evento.gerar_certificado = true
 *
 * Quando gerar PDF: integrar com @react-pdf/renderer ou puppeteer.
 */

export interface CertificadoElegibilidade {
  elegivel:  boolean;
  motivos:   string[]; // motivos de inelegibilidade (vazio se elegível)
}

export interface CertificadoMetadata {
  inscricaoId:     string;
  nomeInscrito:    string;
  nomeEvento:      string;
  departamento:    string;
  dataInicio:      string;
  dataFim:         string;
  local:           string | null;
  qrCode:          string | null;   // para validação futura via QR
  geradoEm:        string;          // ISO string
}

/**
 * Valida se a inscrição é elegível para receber certificado.
 */
export function verificarElegibilidadeCertificado(opts: {
  statusPagamento:   string;
  checkinRealizado:  boolean;
  gerarCertificado:  boolean; // campo do evento
}): CertificadoElegibilidade {
  const motivos: string[] = [];

  if (!opts.gerarCertificado) {
    motivos.push('Este evento não emite certificados.');
  }
  if (!opts.checkinRealizado) {
    motivos.push('Check-in não realizado.');
  }
  if (opts.statusPagamento !== 'pago' && opts.statusPagamento !== 'isento') {
    motivos.push('Pagamento não confirmado (status: ' + opts.statusPagamento + ').');
  }

  return { elegivel: motivos.length === 0, motivos };
}

/**
 * Prepara os metadados do certificado.
 * Não gera PDF — apenas estrutura os dados para uso futuro.
 */
export function prepararMetadadosCertificado(opts: {
  inscricaoId:   string;
  nomeInscrito:  string;
  qrCode:        string | null;
  evento: {
    nome:         string;
    departamento: string;
    data_inicio:  string;
    data_fim:     string;
    local:        string | null;
  };
}): CertificadoMetadata {
  return {
    inscricaoId:  opts.inscricaoId,
    nomeInscrito: opts.nomeInscrito,
    nomeEvento:   opts.evento.nome,
    departamento: opts.evento.departamento,
    dataInicio:   opts.evento.data_inicio,
    dataFim:      opts.evento.data_fim,
    local:        opts.evento.local,
    qrCode:       opts.qrCode,
    geradoEm:     new Date().toISOString(),
  };
}

/**
 * Placeholder para geração de PDF futura.
 * Retorna os metadados e informa que geração não está ativa.
 */
export async function gerarCertificado(opts: {
  inscricaoId:  string;
  nomeInscrito: string;
  qrCode:       string | null;
  statusPagamento:  string;
  checkinRealizado: boolean;
  evento: {
    nome:            string;
    departamento:    string;
    data_inicio:     string;
    data_fim:        string;
    local:           string | null;
    gerar_certificado: boolean;
  };
}): Promise<{ sucesso: false; motivos: string[]; metadata?: never } | { sucesso: true; metadata: CertificadoMetadata; pdf?: never }> {
  const elegibilidade = verificarElegibilidadeCertificado({
    statusPagamento:   opts.statusPagamento,
    checkinRealizado:  opts.checkinRealizado,
    gerarCertificado:  opts.evento.gerar_certificado,
  });

  if (!elegibilidade.elegivel) {
    return { sucesso: false, motivos: elegibilidade.motivos };
  }

  const metadata = prepararMetadadosCertificado({
    inscricaoId:  opts.inscricaoId,
    nomeInscrito: opts.nomeInscrito,
    qrCode:       opts.qrCode,
    evento:       opts.evento,
  });

  // TODO: quando implementar PDF real:
  // const pdfBuffer = await renderCertificadoPDF(metadata);
  // return { sucesso: true, metadata, pdf: pdfBuffer };

  console.log('[CERTIFICADO] Metadados preparados — geração PDF pendente:', metadata.inscricaoId);
  return { sucesso: true, metadata };
}
