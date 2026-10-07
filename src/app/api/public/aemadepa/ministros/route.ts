import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

function onlyDigits(value: string) {
  return (value || '').replace(/\D/g, '');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const id = (searchParams.get('id') || '').trim();

    const supabase = createServerClient();

    // Se passou ID específico, retorna os dados completos do ministro e da esposa já cadastrada
    if (id) {
      const { data: membro, error } = await supabase
        .from('members')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !membro) {
        return NextResponse.json({ error: 'Ministro não encontrado' }, { status: 404 });
      }

      const cf = membro.custom_fields && typeof membro.custom_fields === 'object' ? membro.custom_fields : {};
      const nomeEsposa = String(membro.nome_conjuge || cf.nomeConjuge || '').trim();

      return NextResponse.json({
        ministro: {
          id: membro.id,
          nome: String(membro.name || membro.nome || cf.nome || '').trim(),
          matricula: String(membro.matricula || cf.matricula || '').trim(),
          cpf: String(membro.cpf || cf.cpf || '').trim(),
          cargo: String(membro.cargo_ministerial || cf.cargoMinisterial || membro.profissao || 'PASTOR').trim(),
          campo: String(cf.campo || membro.cidade || '').trim(),
          supervisao: String(cf.supervisao || '').trim(),
          temEsposaCadastrada: Boolean(nomeEsposa && nomeEsposa.length > 0),
          dadosEsposa: {
            nome: nomeEsposa,
            cpf: String(membro.cpf_conjuge || cf.cpfConjuge || '').trim(),
            rg: String(membro.conjuge_rg || cf.conjugeRg || '').trim(),
            orgao_emissor: String(membro.conjuge_orgao_emissor || cf.conjugeOrgaoEmissor || '').trim(),
            data_nascimento: String(membro.data_nascimento_conjuge || cf.dataNascimentoConjuge || '').trim(),
            nacionalidade: String(membro.conjuge_nacionalidade || cf.conjugeNacionalidade || 'BRASILEIRA').trim(),
            naturalidade: String(membro.conjuge_naturalidade || cf.conjugeNaturalidade || '').trim(),
            nome_pai: String(membro.conjuge_nome_pai || cf.conjugeNomePai || '').trim(),
            nome_mae: String(membro.conjuge_nome_mae || cf.conjugeNomeMae || '').trim(),
            titulo_eleitoral: String(membro.conjuge_titulo_eleitoral || cf.conjugeTituloEleitoral || '').trim(),
            fone: String(membro.conjuge_fone || cf.conjugeFone || '').trim(),
            email: String(membro.conjuge_email || cf.conjugeEmail || '').trim(),
            tipo_sanguineo: String(membro.conjuge_tipo_sanguineo || cf.conjugeTipoSanguineo || '').trim(),
            foto_url: membro.conjuge_foto_url || cf.conjugeFotoUrl || null,
            numero_aemadepa: String(membro.numero_aemadepa || cf.numero_aemadepa || cf.numeroAemadepa || '').trim(),
          }
        }
      });
    }

    // Busca geral ou por termo q
    let query = supabase
      .from('members')
      .select('id, name, nome, matricula, cpf, cargo_ministerial, status, jubilado, custom_fields, nome_conjuge, cpf_conjuge, conjuge_foto_url')
      .is('deleted_at', null)
      .limit(30);

    const qDigits = onlyDigits(q);
    if (q) {
      if (qDigits && qDigits.length >= 3) {
        query = query.or(`name.ilike.%${q}%,nome.ilike.%${q}%,matricula.ilike.%${q}%,cpf.ilike.%${qDigits}%`);
      } else {
        query = query.or(`name.ilike.%${q}%,nome.ilike.%${q}%,matricula.ilike.%${q}%`);
      }
    }

    const { data: rows, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const ministros = (rows || []).map((m: any) => {
      const cf = m.custom_fields && typeof m.custom_fields === 'object' ? m.custom_fields : {};
      const nomeEsposa = String(m.nome_conjuge || cf.nomeConjuge || '').trim();

      return {
        id: m.id,
        nome: String(m.name || m.nome || cf.nome || '').trim(),
        matricula: String(m.matricula || cf.matricula || '').trim(),
        cpf: String(m.cpf || cf.cpf || '').trim(),
        cargo: String(m.cargo_ministerial || cf.cargoMinisterial || 'PASTOR').trim(),
        campo: String(cf.campo || '').trim(),
        supervisao: String(cf.supervisao || '').trim(),
        temEsposaCadastrada: Boolean(nomeEsposa && nomeEsposa.length > 0),
        nomeEsposa: nomeEsposa || null,
        status: m.jubilado ? 'JUBILADO' : String(m.status || 'ATIVO').toUpperCase(),
      };
    });

    return NextResponse.json({ ministros });
  } catch (err: any) {
    console.error('Erro na rota pública de ministros AEMADEPA:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}
