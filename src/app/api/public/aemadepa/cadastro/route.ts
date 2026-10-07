import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createServerClient } from '@/lib/supabase-server';

const BUCKET = 'membros-fotos';
const MAX_BYTES = 2 * 1024 * 1024; // 2MB

function onlyDigits(value: string) {
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

    if (!ministroId) {
      return NextResponse.json({ error: 'Ministro vinculado não identificado.' }, { status: 400 });
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

    // 3. Mescla os custom_fields preservando todos os campos existentes do ministro
    const customFieldsExistente =
      ministroAtual.custom_fields && typeof ministroAtual.custom_fields === 'object'
        ? ministroAtual.custom_fields
        : {};

    const novosCustomFields = {
      ...customFieldsExistente,
      nomeConjuge: String(nome).trim(),
      cpfConjuge: onlyDigits(cpf) || null,
      dataNascimentoConjuge: data_nascimento || null,
      conjugeRg: rg ? String(rg).trim() : null,
      conjugeOrgaoEmissor: orgao_emissor ? String(orgao_emissor).trim() : null,
      conjugeNacionalidade: nacionalidade ? String(nacionalidade).trim() : 'BRASILEIRA',
      conjugeNaturalidade: naturalidade ? String(naturalidade).trim() : null,
      conjugeNomePai: nome_pai ? String(nome_pai).trim() : null,
      conjugeNomeMae: nome_mae ? String(nome_mae).trim() : null,
      conjugeTituloEleitoral: titulo_eleitoral ? String(titulo_eleitoral).trim() : null,
      conjugeFone: fone ? String(fone).trim() : null,
      conjugeEmail: email ? String(email).trim() : null,
      conjugeTipoSanguineo: tipo_sanguineo || null,
      conjugeFotoUrl: fotoFinalUrl || customFieldsExistente.conjugeFotoUrl || null,
    };

    // 4. Atualiza o registro no banco
    const { error: updateErr } = await supabaseAdmin
      .from('members')
      .update({
        nome_conjuge: String(nome).trim(),
        cpf_conjuge: onlyDigits(cpf) || null,
        data_nascimento_conjuge: data_nascimento || null,
        conjuge_rg: rg ? String(rg).trim() : null,
        conjuge_orgao_emissor: orgao_emissor ? String(orgao_emissor).trim() : null,
        conjuge_nacionalidade: nacionalidade ? String(nacionalidade).trim() : 'BRASILEIRA',
        conjuge_naturalidade: naturalidade ? String(naturalidade).trim() : null,
        conjuge_nome_pai: nome_pai ? String(nome_pai).trim() : null,
        conjuge_nome_mae: nome_mae ? String(nome_mae).trim() : null,
        conjuge_titulo_eleitoral: titulo_eleitoral ? String(titulo_eleitoral).trim() : null,
        conjuge_fone: fone ? String(fone).trim() : null,
        conjuge_email: email ? String(email).trim() : null,
        conjuge_tipo_sanguineo: tipo_sanguineo || null,
        conjuge_foto_url: fotoFinalUrl || ministroAtual.conjuge_foto_url || null,
        custom_fields: novosCustomFields,
      })
      .eq('id', ministroId);

    if (updateErr) {
      console.error('Erro ao salvar cadastro AEMADEPA:', updateErr);
      return NextResponse.json({ error: updateErr.message || 'Erro ao salvar cadastro.' }, { status: 500 });
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
