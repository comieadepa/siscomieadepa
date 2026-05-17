import { NextRequest } from 'next/server';
import { sendEmail } from '@/services/email';

export type FuncaoEquipeEvento = 'operador' | 'checkin';

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
  const path = funcao === 'operador'
    ? `/eventos/${eventoId}/operador`
    : `/eventos/${eventoId}/checkin`;
  return `${origin.replace(/\/$/, '')}${path}`;
}

export async function enviarEmailAcessoEquipe(params: EmailAcessoEquipeParams) {
  const link = getEquipeAccessUrl(params.origin, params.eventoId, params.funcao);
  const funcaoLabel = params.funcao === 'operador' ? 'Operador' : 'Check-in';
  const titulo = params.redefinicao
    ? `Acesso atualizado - ${params.eventoNome}`
    : `Acesso da equipe - ${params.eventoNome}`;

  const linhas = [
    `Olá, ${params.nome}.`,
    '',
    `Você recebeu acesso à equipe do evento ${params.eventoNome}.`,
    `Função: ${funcaoLabel}.`,
    '',
    `Link de acesso: ${link}`,
    `E-mail cadastrado: ${params.para}`,
  ];

  if (params.funcao === 'operador') {
    if (params.senha) {
      linhas.push(`Senha ${params.redefinicao ? 'redefinida' : 'inicial'}: ${params.senha}`);
    } else {
      linhas.push('Senha: por segurança, a senha anterior não é reenviada. Se você não souber a senha, solicite uma redefinição ao administrador.');
    }
    linhas.push('');
    linhas.push('Instruções: acesse o link acima, informe seu e-mail e senha para abrir o painel operacional do evento.');
  } else {
    linhas.push('');
    if (params.codigo) {
      linhas.push(`Codigo de acesso: ${params.codigo}`);
      linhas.push('Instruções: acesse o link acima e informe o código para liberar o leitor de QR Code.');
    } else {
      linhas.push('Instruções: acesse o link acima e informe o seu código de acesso para liberar o leitor de QR Code.');
    }
  }

  linhas.push('');
  linhas.push('Este acesso é válido apenas enquanto o evento estiver ativo.');

  return sendEmail({
    para: params.para,
    nomeDestinatario: params.nome,
    assunto: titulo,
    mensagem: linhas.join('\n'),
  });
}
