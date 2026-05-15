import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { buildCartaTexto, type CartaDados, type CartaTipo } from '@/lib/cartas/templates';

const TIPOS_VALIDOS = new Set<CartaTipo>([
  'requerimento_cgadb',
  'carta_recomendacao',
  'carta_mudanca',
]);

const STATUS_VALIDO = new Set(['emitida', 'pendente', 'cancelada']);

const parseTipo = (value?: string | null): CartaTipo | null => {
  if (!value) return null;
  if (TIPOS_VALIDOS.has(value as CartaTipo)) return value as CartaTipo;
  return null;
};

const trimText = (value?: string | null) => (value || '').toString().trim();

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const tipo = searchParams.get('tipo');
  const search = searchParams.get('search');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const limit = Math.min(Number(searchParams.get('limit') || '200'), 500);
  const offset = Math.max(Number(searchParams.get('offset') || '0'), 0);

  const supabase = createServerClient();
  let query = supabase
    .from('cartas_ministeriais')
    .select('id,numero,tipo,ministro_nome,matricula,emitido_em,emitido_por_email,status,created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(limit, 1) - 1);

  if (status && STATUS_VALIDO.has(status)) query = query.eq('status', status);
  if (tipo && TIPOS_VALIDOS.has(tipo as CartaTipo)) query = query.eq('tipo', tipo);
  if (from) query = query.gte('emitido_em', from);
  if (to) query = query.lte('emitido_em', to);
  if (search) {
    const term = search.trim();
    if (term) {
      query = query.or(`numero.ilike.%${term}%,ministro_nome.ilike.%${term}%,matricula.ilike.%${term}%`);
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const tipo = parseTipo(body?.tipo);
  if (!tipo) {
    return NextResponse.json({ error: 'Tipo de carta invalido.' }, { status: 400 });
  }

  const dados = (body?.dados || {}) as CartaDados;
  const ministroNome = trimText(dados.ministroNome || body?.ministroNome);
  const dataEmissao = trimText(dados.dataEmissao || body?.dataEmissao);
  const presidente = trimText(dados.presidente || body?.presidente);
  const cidadeUf = trimText(dados.cidadeUf || body?.cidadeUf);

  if (!ministroNome || !dataEmissao || !presidente || !cidadeUf) {
    return NextResponse.json({ error: 'Campos obrigatorios nao informados.' }, { status: 400 });
  }

  const numero = `CARTA-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const status = STATUS_VALIDO.has(body?.status) ? body.status : 'emitida';
  const emitidoEm = status === 'emitida' ? new Date().toISOString() : null;

  const textoInfo = buildCartaTexto(tipo, {
    ...dados,
    ministroNome,
    dataEmissao,
    presidente,
    cidadeUf,
  });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('cartas_ministeriais')
    .insert({
      numero,
      tipo,
      ministro_id: body?.ministroId || null,
      ministro_nome: ministroNome,
      matricula: trimText(dados.matricula || body?.matricula) || null,
      cpf: trimText(dados.cpf || body?.cpf) || null,
      rg: trimText(dados.rg || body?.rg) || null,
      dados_json: {
        ...dados,
        ministroNome,
        dataEmissao,
        presidente,
        cidadeUf,
      },
      texto_final: textoInfo.texto,
      status,
      emitido_por: auth.ctx.user.id,
      emitido_por_nome: auth.ctx.user.user_metadata?.nome || auth.ctx.user.user_metadata?.name || null,
      emitido_por_email: auth.ctx.user.email || null,
      emitido_em: emitidoEm,
    })
    .select('id,numero,tipo,ministro_nome,matricula,emitido_em,emitido_por_email,status,texto_final,dados_json')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, titulo: textoInfo.titulo, validade: textoInfo.validade || null });
}
