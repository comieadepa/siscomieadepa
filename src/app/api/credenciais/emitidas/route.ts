import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';
import { registrarHistoricoMinisterial } from '@/lib/historico-ministerial';

const CREDENCIAIS_ROLES = ['super', 'administrador', 'comissao'] as const;
const MAX_LIMIT = 100;
const ACTION_EMITIR = 'emitir';
const ACTION_REIMPRIMIR = 'reimprimir';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole(request, CREDENCIAIS_ROLES);
    if (!auth.ok) return auth.response;

    const supabase = createServerClient();
    const searchParams = request.nextUrl.searchParams;

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.min(Math.max(limitRaw, 1), MAX_LIMIT);
    const offset = (page - 1) * limit;

    const status = (searchParams.get('status') || '').trim();
    const tipoCadastro = (searchParams.get('tipoCadastro') || '').trim();
    const search = (searchParams.get('search') || '').trim();
    const from = (searchParams.get('from') || '').trim();
    const to = (searchParams.get('to') || '').trim();

    let query = supabase
      .from('cartoes_gerados')
      .select(
        `id, member_id, template_id, pdf_url, qr_code_data, printed_count, created_at,
         members!inner(
           id, name, cpf, matricula, unique_id, tipo_cadastro, status,
           cargo_ministerial, data_nascimento, sexo,
           tipo_sanguineo, estado_civil, nome_pai, nome_mae, naturalidade, nacionalidade,
           data_batismo_aguas, data_batismo_espirito_santo, email, phone, celular, whatsapp,
           logradouro, numero, bairro, cidade, qual_funcao, foto_url,
           custom_fields, cred_validade, profissao
         )`,
        { count: 'exact' }
      );

    if (status) query = query.eq('members.status', status);
    if (tipoCadastro) query = query.eq('members.tipo_cadastro', tipoCadastro);

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,cpf.ilike.%${search}%,matricula.ilike.%${search}%,unique_id.ilike.%${search}%`,
        { foreignTable: 'members' }
      );
    }

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    query = query.order('created_at', { ascending: false });

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const items = (data || []).map((row: any) => ({
      id: row.id,
      member_id: row.member_id,
      template_id: row.template_id,
      pdf_url: row.pdf_url,
      qr_code_data: row.qr_code_data,
      printed_count: row.printed_count,
      created_at: row.created_at,
      member: row.members,
    }));

    return NextResponse.json({
      data: items,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        total_pages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (error) {
    console.error('GET /api/credenciais/emitidas:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

type RegistroItem = {
  memberId: string;
  templateId?: string | null;
  qrCodeData?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toUuidOrNull(value: any): string | null {
  if (!value) return null;
  const s = String(value).trim();
  return UUID_RE.test(s) ? s : null;
}

function normalizeRegistroItem(raw: any): RegistroItem | null {
  if (!raw) return null;
  const memberId = toUuidOrNull(raw.memberId ?? raw.member_id);
  if (!memberId) return null;
  const templateId = toUuidOrNull(raw.templateId ?? raw.template_id);
  const qrCodeData = raw.qrCodeData ?? raw.qr_code_data ?? null;
  return {
    memberId,
    templateId,
    qrCodeData: qrCodeData ? String(qrCodeData) : null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, CREDENCIAIS_ROLES);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null as any);
    const action = body?.action === ACTION_REIMPRIMIR ? ACTION_REIMPRIMIR : ACTION_EMITIR;
    const rawItems = Array.isArray(body?.items)
      ? body.items
      : (body?.item ? [body.item] : []);

    const items = (rawItems.map(normalizeRegistroItem) as Array<RegistroItem | null>)
      .filter((item): item is RegistroItem => item !== null);

    if (items.length === 0) {
      return NextResponse.json({ error: 'Payload invalido' }, { status: 400 });
    }

    const supabase = createServerClient();
    const results: Array<{ id: string; printed_count: number; action: string }> = [];

    const nomeUsuario =
      auth.ctx.user.user_metadata?.nome ||
      auth.ctx.user.user_metadata?.name ||
      auth.ctx.user.email ||
      null;

    for (const item of items) {
      // Sempre verifica se já existe registro para o membro (evita duplicatas)
      const { data: existing, error: existingError } = await supabase
        .from('cartoes_gerados')
        .select('id, printed_count')
        .eq('member_id', item.memberId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 400 });
      }

      if (existing?.id) {
        // Registro já existe: apenas incrementa o contador de impressões
        const nextCount = (existing.printed_count ?? 0) + 1;
        const updatePayload: { printed_count: number; qr_code_data?: string | null } = {
          printed_count: nextCount,
        };
        if (item.qrCodeData) updatePayload.qr_code_data = item.qrCodeData;

        const { error: updateError } = await supabase
          .from('cartoes_gerados')
          .update(updatePayload)
          .eq('id', existing.id);

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 400 });
        }

        // Registrar no historico ministerial (dedup evita duplicatas)
        await registrarHistoricoMinisterial({
          ministroId: item.memberId,
          tipo: 'credencial_emitida',
          titulo: 'Credencial emitida',
          descricao: `Credencial ministerial emitida${item.templateId ? ` (modelo: ${item.templateId})` : ''}.`,
          origem: 'credencial',
          referenciaId: existing.id,
          criadoPor: auth.ctx.userId,
          nomeUsuario,
        });

        results.push({ id: existing.id, printed_count: nextCount, action: ACTION_REIMPRIMIR });
        continue;
      }

      // Primeira emissão: insere novo registro
      const insertPayload = {
        member_id: item.memberId,
        template_id: item.templateId ?? null,
        qr_code_data: item.qrCodeData ?? null,
        generated_by: auth.ctx.userId,
        printed_count: 1,
      };

      const { data: inserted, error: insertError } = await supabase
        .from('cartoes_gerados')
        .insert(insertPayload)
        .select('id, printed_count')
        .single();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }

      results.push({
        id: inserted.id,
        printed_count: inserted.printed_count ?? 1,
        action: ACTION_EMITIR,
      });

      // Registrar no histórico ministerial apenas na primeira emissão
      await registrarHistoricoMinisterial({
        ministroId: item.memberId,
        tipo: 'credencial_emitida',
        titulo: 'Credencial emitida',
        descricao: `Credencial ministerial emitida${item.templateId ? ` (modelo: ${item.templateId})` : ''}.`,
        origem: 'credencial',
        referenciaId: inserted.id,
        criadoPor: auth.ctx.userId,
        nomeUsuario,
      });
    }

    return NextResponse.json({ ok: true, total: results.length, data: results });
  } catch (error) {
    console.error('POST /api/credenciais/emitidas:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
