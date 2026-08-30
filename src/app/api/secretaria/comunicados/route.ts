/**
 * API Administrativa de Comunicados Oficiais
 * POST /api/secretaria/comunicados - Cria matriz de comunicado
 * GET /api/secretaria/comunicados  - Lista comunicados cadastrados
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';
import { logDB } from '@/lib/audit';

const ALLOWED_ROLES = ['super', 'administrador', 'cgadb'] as const;

const CANAIS_VALIDOS = ['in_app', 'email', 'ambos'] as const;
const PUBLICOS_VALIDOS = ['todos', 'pastores_presidentes', 'supervisao', 'campo', 'cargo'] as const;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ALLOWED_ROLES);
  if (!auth.ok) return auth.response;

  const supabase = createServerClient();

  const { data: comunicados, error } = await supabase
    .from('comunicados')
    .select(`
      id,
      titulo,
      mensagem,
      link_acao,
      canal,
      publico_tipo,
      supervisao_id,
      campo_id,
      cargo_alvo,
      autor_id,
      enviado_em,
      total_alvos,
      supervisoes (nome),
      campos (nome)
    `)
    .order('enviado_em', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[secretaria/comunicados/GET] Erro ao listar comunicados:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (comunicados || []).map((c: any) => ({
    id: c.id,
    titulo: c.titulo,
    mensagem: c.mensagem,
    linkAcao: c.link_acao,
    canal: c.canal,
    publicoTipo: c.publico_tipo,
    supervisaoId: c.supervisao_id,
    supervisaoNome: c.supervisoes?.nome || null,
    campoId: c.campo_id,
    campoNome: c.campos?.nome || null,
    cargoAlvo: c.cargo_alvo,
    autorId: c.autor_id,
    enviadoEm: c.enviado_em,
    totalAlvos: c.total_alvos,
  }));

  return NextResponse.json({ data: items });
}

export async function POST(request: NextRequest) {
  // 1. Autorização administrativa
  const auth = await requireRole(request, ALLOWED_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    const {
      titulo,
      mensagem,
      linkAcao = null,
      canal = 'in_app',
      publicoTipo = 'todos',
      supervisaoId = null,
      campoId = null,
      cargoAlvo = null,
    } = body;

    // 2. Validações de campos obrigatórios
    if (!titulo || typeof titulo !== 'string' || !titulo.trim()) {
      return NextResponse.json(
        { error: 'O título do comunicado é obrigatório.' },
        { status: 400 },
      );
    }

    if (!mensagem || typeof mensagem !== 'string' || !mensagem.trim()) {
      return NextResponse.json(
        { error: 'A mensagem do comunicado é obrigatória.' },
        { status: 400 },
      );
    }

    // 3. Validação de canal
    if (!CANAIS_VALIDOS.includes(canal)) {
      return NextResponse.json(
        { error: `Canal inválido. Valores aceitos: ${CANAIS_VALIDOS.join(', ')}` },
        { status: 400 },
      );
    }

    // 4. Validação de público-alvo
    if (!PUBLICOS_VALIDOS.includes(publicoTipo)) {
      return NextResponse.json(
        { error: `Tipo de público inválido. Valores aceitos: ${PUBLICOS_VALIDOS.join(', ')}` },
        { status: 400 },
      );
    }

    // 5. Validação de filtros contextuais
    if (publicoTipo === 'supervisao' && (!supervisaoId || typeof supervisaoId !== 'string')) {
      return NextResponse.json(
        { error: 'A supervisão é obrigatória para a segmentação por supervisão.' },
        { status: 400 },
      );
    }

    if (publicoTipo === 'campo' && (!campoId || typeof campoId !== 'string')) {
      return NextResponse.json(
        { error: 'O campo é obrigatório para a segmentação por campo.' },
        { status: 400 },
      );
    }

    if (publicoTipo === 'cargo' && (!cargoAlvo || typeof cargoAlvo !== 'string' || !cargoAlvo.trim())) {
      return NextResponse.json(
        { error: 'O cargo-alvo é obrigatório para a segmentação por cargo.' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // 6. Inserção na tabela public.comunicados
    const insertPayload = {
      titulo: titulo.trim(),
      mensagem: mensagem.trim(),
      link_acao: linkAcao && typeof linkAcao === 'string' && linkAcao.trim() ? linkAcao.trim() : null,
      canal,
      publico_tipo: publicoTipo,
      supervisao_id: publicoTipo === 'supervisao' ? supervisaoId : null,
      campo_id: publicoTipo === 'campo' ? campoId : null,
      cargo_alvo: publicoTipo === 'cargo' ? cargoAlvo.trim() : null,
      autor_id: auth.ctx.userId,
      total_alvos: 0,
    };

    const { data: comunicado, error: dbError } = await supabase
      .from('comunicados')
      .insert(insertPayload)
      .select('id, titulo, mensagem, link_acao, canal, publico_tipo, supervisao_id, campo_id, cargo_alvo, autor_id, enviado_em, total_alvos')
      .single();

    if (dbError || !comunicado) {
      console.error('[secretaria/comunicados] Erro ao cadastrar comunicado:', dbError?.message);
      return NextResponse.json(
        { error: 'Erro ao cadastrar comunicado no banco de dados.' },
        { status: 500 },
      );
    }

    void logDB({
      acao: 'criar',
      modulo: 'secretaria',
      entidade: 'comunicado',
      entidadeId: comunicado.id,
      descricao: `Comunicado criado: "${comunicado.titulo}" (Público: ${comunicado.publico_tipo})`,
      status: 'sucesso',
      detalhes: {
        comunicadoId: comunicado.id,
        canal: comunicado.canal,
        publicoTipo: comunicado.publico_tipo,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        comunicado: {
          id: comunicado.id,
          titulo: comunicado.titulo,
          mensagem: comunicado.mensagem,
          linkAcao: comunicado.link_acao,
          canal: comunicado.canal,
          publicoTipo: comunicado.publico_tipo,
          supervisaoId: comunicado.supervisao_id,
          campoId: comunicado.campo_id,
          cargoAlvo: comunicado.cargo_alvo,
          autorId: comunicado.autor_id,
          enviadoEm: comunicado.enviado_em,
          totalAlvos: comunicado.total_alvos,
        },
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error('[secretaria/comunicados] Erro inesperado:', err?.message);
    return NextResponse.json(
      { error: 'Erro interno ao processar comunicado.' },
      { status: 500 },
    );
  }
}
