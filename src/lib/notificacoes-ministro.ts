/**
 * Helper Centralizado de Notificações do Portal do Ministro.
 * Grava notificações in-app em public.ministro_portal_notificacoes
 * e envia e-mails transacionais via Resend (src/services/email.ts) quando aplicável.
 */

import { createServerClient } from '@/lib/supabase-server';
import { sendEmail } from '@/services/email';

export type TipoNotificacaoMinistro = 'credencial' | 'financeiro' | 'evento' | 'comunicado';
export type CanalNotificacaoMinistro = 'in_app' | 'email' | 'ambos';

export interface NotificacaoParams {
  ministroId: string;
  tipo: TipoNotificacaoMinistro;
  titulo: string;
  mensagem: string;
  linkAcao?: string | null;
  canal?: CanalNotificacaoMinistro;
  comunicadoId?: string | null;
}

export interface NotificacaoResult {
  sucesso: boolean;
  notificacaoId?: string;
  emailEnviado?: boolean;
  erro?: string;
}

const TIPOS_VALIDOS: TipoNotificacaoMinistro[] = ['credencial', 'financeiro', 'evento', 'comunicado'];
const CANAIS_VALIDOS: CanalNotificacaoMinistro[] = ['in_app', 'email', 'ambos'];

export async function criarNotificacaoMinistro(
  params: NotificacaoParams,
): Promise<NotificacaoResult> {
  const {
    ministroId,
    tipo,
    titulo,
    mensagem,
    linkAcao = null,
    canal = 'in_app',
    comunicadoId = null,
  } = params;

  if (!ministroId) {
    return { sucesso: false, erro: 'ID do ministro é obrigatório.' };
  }

  if (!TIPOS_VALIDOS.includes(tipo)) {
    return { sucesso: false, erro: `Tipo de notificação inválido: ${tipo}` };
  }

  if (!CANAIS_VALIDOS.includes(canal)) {
    return { sucesso: false, erro: `Canal de notificação inválido: ${canal}` };
  }

  if (!titulo || !titulo.trim()) {
    return { sucesso: false, erro: 'Título da notificação é obrigatório.' };
  }

  if (!mensagem || !mensagem.trim()) {
    return { sucesso: false, erro: 'Mensagem da notificação é obrigatória.' };
  }

  const supabase = createServerClient();

  let notificacaoId: string | undefined;

  // 1. Gravação In-App no banco (para canais 'in_app' ou 'ambos')
  if (canal === 'in_app' || canal === 'ambos') {
    try {
      const { data, error } = await supabase
        .from('ministro_portal_notificacoes')
        .insert({
          ministro_id: ministroId,
          tipo,
          titulo: titulo.trim(),
          mensagem: mensagem.trim(),
          link_acao: linkAcao?.trim() || null,
          canal,
          comunicado_id: comunicadoId || null,
        })
        .select('id')
        .single();

      if (error || !data) {
        console.error('[notificacoes-ministro] Erro ao gravar notificação in-app:', error?.message);
        return { sucesso: false, erro: 'Erro ao registrar notificação no banco de dados.' };
      }

      notificacaoId = data.id;
    } catch (err: any) {
      console.error('[notificacoes-ministro] Erro inesperado ao gravar no banco:', err?.message);
      return { sucesso: false, erro: 'Falha interna ao salvar notificação.' };
    }
  }

  // 2. Disparo de E-mail via Resend (para canais 'email' ou 'ambos')
  let emailEnviado = false;

  if (canal === 'email' || canal === 'ambos') {
    try {
      // Busca dados de contato do ministro
      const { data: ministro } = await supabase
        .from('members')
        .select('id, name, email, custom_fields')
        .eq('id', ministroId)
        .maybeSingle();

      const cf = (ministro?.custom_fields && typeof ministro.custom_fields === 'object')
        ? (ministro.custom_fields as Record<string, any>)
        : {};

      const emailDestinatario = String(ministro?.email || cf.email || '').trim();

      if (emailDestinatario && emailDestinatario.includes('@')) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://siscomieadepa.org';
        const urlCompleta = linkAcao
          ? linkAcao.startsWith('http')
            ? linkAcao
            : `${appUrl}${linkAcao.startsWith('/') ? '' : '/'}${linkAcao}`
          : null;

        const corpoHtml = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; line-height: 1.6;">
            <h2 style="color: #0D2B4E; margin-top: 0;">${titulo}</h2>
            <p style="font-size: 15px; color: #444;">${mensagem.replace(/\n/g, '<br/>')}</p>
            ${
              urlCompleta
                ? `<div style="margin-top: 25px; margin-bottom: 25px;">
                     <a href="${urlCompleta}" target="_blank" style="background-color: #0D2B4E; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 14px;">
                       Acessar no Portal do Ministro
                     </a>
                   </div>`
                : ''
            }
            <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;" />
            <p style="font-size: 11px; color: #888;">
              Esta é uma mensagem automática enviada pela Convenção Estadual COMIEADEPA.<br/>
              Acesse o Portal do Ministro para acompanhar sua situação cadastral e eclesiástica.
            </p>
          </div>
        `;

        const resEmail = await sendEmail({
          para: emailDestinatario,
          assunto: `[COMIEADEPA] ${titulo}`,
          mensagem,
          html: corpoHtml,
          nomeDestinatario: ministro?.name || 'Ministro',
        });

        emailEnviado = resEmail.sucesso;
      }
    } catch (err: any) {
      console.error('[notificacoes-ministro] Erro ao enviar e-mail transacional:', err?.message);
      // O erro de e-mail não cancela o registro in-app com sucesso
    }
  }

  return {
    sucesso: true,
    notificacaoId,
    emailEnviado,
  };
}
