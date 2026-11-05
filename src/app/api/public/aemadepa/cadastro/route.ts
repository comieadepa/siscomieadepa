import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAemadepaToken } from '@/lib/aemadepa-token';

const BUCKET = 'membros-fotos';
const MAX_BYTES = 2 * 1024 * 1024; // 2MB

function onlyDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

async function ensureBucket(supabaseAdmin: any) {
  try {
    const { data, error } = await supabaseAdmin.storage.listBuckets();
    if (error) return;
    const exists = Array.isArray(data) && data.some((b: any) => b?.name === BUCKET);
    if (exists) return;
    await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: String(MAX_BYTES),
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });
  } catch {
    // best-effort
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null as any);
    if (!body) {
      return NextResponse.json({ error: 'Dados não fornecidos' }, { status: 400 });
    }

    const {
      ministroId,
      token,
      nome,
      cpf,
      rg,
      orgao_emissor,
      data_nascimento,
      nacionalidade,
      naturalidade,
      nome_pai,
      nome_mae,
      titulo_eleitoral,
      fone,
      email,
      tipo_sanguineo,
      foto_url,
    } = body;

    // Também verifica header alternativo
    const authHeaderToken = request.headers.get('x-aemadepa-token') || token;

    if (!ministroId) {
      return NextResponse.json({ error: 'Ministro vinculado não identificado.' }, { status: 400 });
    }

    // 0. Validação de Autorização Temporária (Proteção LGPD contra submissão direta)
    const tokenVerification = verifyAemadepaToken(authHeaderToken, ministroId);
    if (!tokenVerification.valid) {
      return NextResponse.json(
        {
          error: 'Sessão de autorização expirada ou inválida. Por favor, valide o CPF e a data de nascimento novamente.',
        },
        { status: 401 }
      );
    }

    if (!nome || !String(nome).trim()) {
      return NextResponse.json({ error: 'O nome completo da esposa é obrigatório.' }, { status: 400 });
    }

    const supabaseAdmin = createServerClient();

    // 1. Busca os dados atuais do ministro no banco para preservar seus campos e custom_fields
    const { data: ministroAtual, error: fetchErr } = await supabaseAdmin
      .from('members')
      .select('*')
      .eq('id', ministroId)
      .single();

    if (fetchErr || !ministroAtual) {
      return NextResponse.json({ error: 'Ministro não encontrado no sistema.' }, { status: 404 });
    }

    // 2. Upload da foto se for base64 / data URL
    let fotoFinalUrl = foto_url || null;
    if (fotoFinalUrl && typeof fotoFinalUrl === 'string' && fotoFinalUrl.startsWith('data:image/')) {
      try {
        await ensureBucket(supabaseAdmin);
        const matches = fotoFinalUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (matches) {
          const imageType = matches[1] === 'png' ? 'png' : matches[1] === 'webp' ? 'webp' : 'jpg';
          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, 'base64');

          const path = `esposas/${ministroId}/${Date.now()}-${randomUUID()}.${imageType}`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET)
            .upload(path, buffer, {
              contentType: `image/${imageType === 'jpg' ? 'jpeg' : imageType}`,
              upsert: true,
            });

          if (!uploadError) {
            const { data: publicData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
            if (publicData?.publicUrl) {
              fotoFinalUrl = publicData.publicUrl;
            }
          }
        }
      } catch (uploadErr) {
        console.warn('Falha no upload da foto da esposa:', uploadErr);
      }
    }

    const inputCpfDigits = onlyDigits(cpf);
    if (!inputCpfDigits || inputCpfDigits.length !== 11) {
      return NextResponse.json({ error: 'O CPF da esposa deve conter 11 dígitos numéricos.' }, { status: 400 });
    }

    if (!data_nascimento || String(data_nascimento).trim().length < 8) {
      return NextResponse.json({ error: 'A data de nascimento da esposa é obrigatória.' }, { status: 400 });
    }

    // 3. Validação da Operação Autorizada pelo Token HMAC
    const operacaoAutorizada = tokenVerification.operacao; // 'primeiro_cadastro' ou 'edicao_esposa'

    // 4. Verificação de Integridade e Antiusurpação de Vínculo:
    // Se o CPF já existe na AEMADEPA, deve obrigatoriamente pertencer a este mesmo ministro!
    const { data: associadaExistente, error: checkErr } = await supabaseAdmin
      .from('aemadepa_associadas')
      .select('id, ministro_id, status, numero_aemadepa, custom_fields')
      .eq('cpf', inputCpfDigits)
      .maybeSingle();

    if (checkErr) {
      console.error('Erro ao verificar associada por CPF:', checkErr);
      return NextResponse.json({ error: 'Erro ao validar cadastro.' }, { status: 500 });
    }

    if (associadaExistente && associadaExistente.ministro_id !== ministroId) {
      return NextResponse.json(
        {
          error: 'Este CPF já está cadastrado para a esposa de outro ministro. Caso precise de regularização, procure a Secretaria da COMIEADEPA.',
        },
        { status: 409 }
      );
    }

    const customFieldsExistente =
      ministroAtual.custom_fields && typeof ministroAtual.custom_fields === 'object'
        ? ministroAtual.custom_fields
        : {};

    const numeroAemadepaAtual = String(
      associadaExistente?.numero_aemadepa ||
      customFieldsExistente.numero_aemadepa ||
      customFieldsExistente.numeroAemadepa ||
      ''
    ).trim() || null;

    // 5. Execução Exclusiva via RPC Atômica Transacional no PostgreSQL
    // Não utiliza fallback de gravações separadas: a atomicidade com rollback integral é garantida no banco.
    const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('salvar_cadastro_aemadepa_transacional', {
      p_ministro_id: ministroId,
      p_operacao: operacaoAutorizada,
      p_nome: String(nome).trim(),
      p_cpf: inputCpfDigits,
      p_data_nascimento: data_nascimento,
      p_rg: rg ? String(rg).trim() : null,
      p_orgao_emissor: orgao_emissor ? String(orgao_emissor).trim() : null,
      p_nacionalidade: nacionalidade ? String(nacionalidade).trim() : 'BRASILEIRA',
      p_naturalidade: naturalidade ? String(naturalidade).trim() : null,
      p_tipo_sanguineo: tipo_sanguineo || null,
      p_nome_pai: nome_pai ? String(nome_pai).trim() : null,
      p_nome_mae: nome_mae ? String(nome_mae).trim() : null,
      p_titulo_eleitoral: titulo_eleitoral ? String(titulo_eleitoral).trim() : null,
      p_fone: fone ? String(fone).trim() : null,
      p_email: email ? String(email).trim() : null,
      p_foto_url: fotoFinalUrl || ministroAtual.conjuge_foto_url || null,
      p_numero_aemadepa: numeroAemadepaAtual,
    });

    if (rpcErr || !rpcRes) {
      console.error('Falha na RPC transacional salvar_cadastro_aemadepa_transacional:', rpcErr);
      return NextResponse.json(
        { error: 'Não foi possível salvar o cadastro de forma atômica no servidor. Tente novamente mais tarde.' },
        { status: 500 }
      );
    }

    if (!rpcRes.success) {
      return NextResponse.json({ error: rpcRes.error || 'Falha ao processar cadastro.' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: 'Cadastro da esposa realizado com sucesso!',
      fotoUrl: fotoFinalUrl,
    });
  } catch (err: any) {
    console.error('Erro no endpoint de cadastro AEMADEPA:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}
