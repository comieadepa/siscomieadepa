import { NextRequest } from 'next/server';
import { sendEmail, type EmailAttachment } from '@/services/email';
import { gerarCartaConviteEquipePdf } from './carta-convite-equipe-pdf';

export type FuncaoEquipeEvento = 'operador' | 'checkin' | 'checkin_refeitorio' | 'hospedagem' | 'checkin_hospedagem';

export type EmailAcessoEquipeParams = {
  para: string;
  nome: string;
  eventoNome: string;
  eventoId: string;
  funcao: FuncaoEquipeEvento;
  origin: string;
  senha?: string;
  codigo?: string;
  redefinicao?: boolean;
  dataInicio?: string | null;
  dataFim?: string | null;
  local?: string | null;
  cidade?: string | null;
  anexarCarta?: boolean; // Padrão: true
};

export function getRequestOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin');
  if (origin) return origin.replace(/\/$/, '');

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, '');
  }

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`.replace(/\/$/, '');
}

export function getEquipeAccessUrl(origin: string, eventoId: string, funcao: FuncaoEquipeEvento): string {
  const path =
    funcao === 'operador'
      ? `/eventos/${eventoId}/operador`
      : funcao === 'checkin'
        ? `/eventos/${eventoId}/checkin/credenciamento`
        : funcao === 'checkin_refeitorio'
          ? `/eventos/${eventoId}/checkin/refeitorio`
        : funcao === 'hospedagem'
          ? `/eventos/${eventoId}?tab=hospedagem`
          : `/eventos/${eventoId}/hospedagem/checkin`;
  return `${origin.replace(/\/$/, '')}${path}`;
}

export function getFuncaoEquipeLabel(funcao: FuncaoEquipeEvento): string {
  switch (funcao) {
    case 'operador':
      return 'Operador';
    case 'hospedagem':
      return 'Hospedagem';
    case 'checkin_hospedagem':
      return 'Check-in de Hospedagem';
    case 'checkin_refeitorio':
      return 'Refeitório';
    case 'checkin':
    default:
      return 'Check-in';
  }
}

export async function enviarEmailAcessoEquipe(params: EmailAcessoEquipeParams) {
  const link = getEquipeAccessUrl(params.origin, params.eventoId, params.funcao);
  const funcaoLabel = getFuncaoEquipeLabel(params.funcao);
  const titulo = params.redefinicao
    ? `Acesso atualizado - ${params.eventoNome}`
    : `Acesso da equipe - ${params.eventoNome}`;

  // Geração da Carta-Convite Oficial em PDF
  const attachments: EmailAttachment[] = [];
  const deveAnexarCarta = params.anexarCarta !== false;

  if (deveAnexarCarta) {
    try {
      const pdf = await gerarCartaConviteEquipePdf({
        nomeTrabalhador: params.nome,
        funcaoLabel,
        eventoNome: params.eventoNome,
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
        local: params.local,
        cidade: params.cidade,
      });

      attachments.push({
        filename: pdf.filename,
        content: pdf.base64,
        contentType: 'application/pdf',
      });
    } catch (err) {
      console.error('[EQUIPE EMAIL] Falha ao gerar carta-convite PDF:', err);
      // Tratamento explícito de falha na geração/anexação do PDF:
      return {
        sucesso: false,
        provider: 'pdf_generator',
        erro: `FALHA_GERACAO_PDF: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const linhas = [
    `Olá, ${params.nome}.`,
    '',
    `Você recebeu acesso à equipe do evento ${params.eventoNome}.`,
    `Função: ${funcaoLabel}.`,
    '',
    `Link de acesso: ${link}`,
    `E-mail cadastrado: ${params.para}`,
  ];

  if (params.funcao === 'operador' || params.funcao === 'hospedagem') {
    if (params.senha) {
      linhas.push(`Senha ${params.redefinicao ? 'redefinida' : 'inicial'}: ${params.senha}`);
    } else {
      linhas.push('Senha: por segurança, a senha anterior não é reenviada. Se você não souber a senha, solicite uma redefinição ao administrador.');
    }
    linhas.push('');
    linhas.push('Instruções: acesse o link acima, informe seu e-mail e senha para abrir sua área do evento.');
  } else {
    linhas.push('');
    if (params.funcao === 'checkin_refeitorio') {
      linhas.push('Instruções: acesse o link acima e informe o código de 4 dígitos enviado para sua equipe.');
    } else {
      linhas.push('Instruções: acesse o link acima e informe o código de 4 dígitos enviado para sua equipe.');
    }
  }

  if (deveAnexarCarta && attachments.length > 0) {
    linhas.push('');
    linhas.push('Em anexo, enviamos a sua Carta-Convite Oficial da COMIEADEPA para este evento.');
  }

  linhas.push('');
  linhas.push('Este acesso é válido apenas enquanto o evento estiver ativo.');

  return sendEmail({
    para: params.para,
    nomeDestinatario: params.nome,
    assunto: titulo,
    mensagem: linhas.join('\n'),
    attachments: attachments.length > 0 ? attachments : undefined,
  });
}
