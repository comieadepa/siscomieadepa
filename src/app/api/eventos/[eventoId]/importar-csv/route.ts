import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { generateQRCodeToken } from '@/lib/qrcode-token';
import { cleanCpf } from '@/lib/cpf';

type CsvImportRow = {
  nome?: string | null;
  cpf?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  sexo?: string | null;
  data_nascimento?: string | null;
  supervisao_nome?: string | null;
  campo_nome?: string | null;
  status_raw?: string | null;
  metodo_raw?: string | null;
  qtd_refeicoes?: number | null;
  created_at?: string | null;
  valor_raw?: string | number | null;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mapSexo(raw: string | null | undefined): string | null {
  const s = normalizeText(raw);
  if (!s) return null;
  if (s.startsWith('m') || s.includes('masc')) return 'M';
  if (s.startsWith('f') || s.includes('fem')) return 'F';
  return null;
}

function mapStatus(raw: string | null | undefined): 'pago' | 'pendente' {
  const s = normalizeText(raw);
  return s.includes('received') ? 'pago' : 'pendente';
}

function mapMetodo(raw: string | null | undefined): string | null {
  const s = normalizeText(raw);
  if (!s) return null;
  if (s.includes('pix')) return 'pix';
  if (s.includes('boleto')) return 'boleto';
  if (s.includes('cartao') || s.includes('credit')) return 'cartao';
  return null;
}

function parseNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[^0-9,.-]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return null;
}

function parseDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const rows = (body?.rows as CsvImportRow[]) ?? [];

    if (!rows.length) {
      return NextResponse.json({ error: 'Nenhum registro para importar.' }, { status: 400 });
    }

    const supabase = guard.ctx.supabaseAdmin;
    const { data: evento } = await supabase
      .from('eventos')
      .select('id, valor_inscricao')
      .eq('id', eventoId)
      .single();

    if (!evento) {
      return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
    }

    const [supRes, camRes] = await Promise.all([
      supabase.from('supervisoes').select('id,nome'),
      supabase.from('campos').select('id,nome,supervisao_id'),
    ]);

    if (supRes.error) throw new Error(supRes.error.message);
    if (camRes.error) throw new Error(camRes.error.message);

    const supMap = new Map<string, string>();
    for (const s of supRes.data ?? []) {
      supMap.set(normalizeText(s.nome), s.id);
    }

    const campoMap = new Map<string, string>();
    const campoMapSup = new Map<string, string>();
    for (const c of camRes.data ?? []) {
      const norm = normalizeText(c.nome);
      campoMap.set(norm, c.id);
      if (c.supervisao_id) {
        campoMapSup.set(`${norm}|${c.supervisao_id}`, c.id);
      }
    }

    const cpfs = Array.from(new Set(rows.map(r => cleanCpf(r.cpf)).filter(c => c.length === 11)));

    const [membrosRes, existentesRes] = await Promise.all([
      cpfs.length
        ? supabase.from('members').select('id,cpf').in('cpf', cpfs)
        : Promise.resolve({ data: [], error: null }),
      cpfs.length
        ? supabase.from('evento_inscricoes').select('id,cpf').eq('evento_id', eventoId).in('cpf', cpfs)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (membrosRes.error) throw new Error(membrosRes.error.message);
    if (existentesRes.error) throw new Error(existentesRes.error.message);

    const membroMap = new Map<string, string>();
    for (const m of membrosRes.data ?? []) {
      if (m.cpf) membroMap.set(cleanCpf(m.cpf), m.id);
    }

    const existentes = new Set<string>();
    for (const e of existentesRes.data ?? []) {
      if (e.cpf) existentes.add(cleanCpf(e.cpf));
    }

    const vistos = new Set<string>();
    const ignorados = {
      semCpf: 0,
      semNome: 0,
      duplicados: 0,
      existentes: 0,
    };

    const valorBase = Number(evento.valor_inscricao ?? 0) || 0;
    const registros: Record<string, unknown>[] = [];

    for (const row of rows) {
      const nome = String(row.nome ?? '').trim();
      const cpf = cleanCpf(row.cpf);

      if (!nome) {
        ignorados.semNome += 1;
        continue;
      }

      if (!cpf || cpf.length !== 11) {
        ignorados.semCpf += 1;
        continue;
      }

      if (vistos.has(cpf)) {
        ignorados.duplicados += 1;
        continue;
      }

      if (existentes.has(cpf)) {
        ignorados.existentes += 1;
        continue;
      }

      vistos.add(cpf);

      const status = mapStatus(row.status_raw);
      const metodo = mapMetodo(row.metodo_raw);
      const createdAt = parseDateTime(row.created_at);
      const valorRaw = parseNumber(row.valor_raw);
      const valorFinal = valorRaw && valorRaw > 0 ? valorRaw : valorBase;

      const supId = row.supervisao_nome ? supMap.get(normalizeText(row.supervisao_nome)) : null;
      let campoId = row.campo_nome ? campoMap.get(normalizeText(row.campo_nome)) : null;
      if (row.campo_nome && supId) {
        const key = `${normalizeText(row.campo_nome)}|${supId}`;
        campoId = campoMapSup.get(key) ?? campoId;
      }

      const payload: Record<string, unknown> = {
        evento_id: eventoId,
        nome_inscrito: nome,
        cpf,
        email: row.email ? String(row.email).trim() : null,
        whatsapp: row.whatsapp ? String(row.whatsapp).trim() : null,
        sexo: mapSexo(row.sexo),
        data_nascimento: parseDateOnly(row.data_nascimento),
        supervisao_id: supId ?? null,
        campo_id: campoId ?? null,
        hospedagem: false,
        alimentacao: (row.qtd_refeicoes ?? 0) > 0,
        brinde: false,
        tipo_inscricao: null,
        valor_original: valorBase,
        desconto_valor: 0,
        valor_final: valorFinal,
        valor_pago: valorFinal,
        status_pagamento: status,
        forma_pagamento: metodo,
        qr_code: generateQRCodeToken(),
        ministro_id: membroMap.get(cpf) ?? null,
      };

      if (createdAt) payload.created_at = createdAt;

      registros.push(payload);
    }

    if (!registros.length) {
      return NextResponse.json({
        error: 'Nenhum registro valido para importar.',
        ignorados: { ...ignorados, total: rows.length },
      }, { status: 400 });
    }

    const { error } = await supabase.from('evento_inscricoes').insert(registros);
    if (error) throw new Error(error.message);

    const totalIgnorados = ignorados.semCpf + ignorados.semNome + ignorados.duplicados + ignorados.existentes;

    return NextResponse.json({
      importados: registros.length,
      ignorados: {
        ...ignorados,
        total: totalIgnorados,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
