import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { getOrCreateMemberFolder, listDocumentosDrive, getDriveClient } from '@/lib/google-drive';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const year = searchParams.get('year');
  const fieldsParam = searchParams.get('fields');
  const fields = fieldsParam
    ? fieldsParam.split(',').map((value) => value.trim()).filter(Boolean).join(',')
    : '*';

  const supabase = createServerClient();
  let query = supabase.from('consagracao_registros').select(fields).order('created_at', { ascending: false });

  if (year) {
    query = query.like('numero_processo', `%/${year}`);
  }

  if (id) {
    const { data, error } = await query.eq('id', id).maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  if (!body) {
    return NextResponse.json({ error: 'Payload invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();

  if (!body.numero_processo) {
    const year = new Date().getFullYear();
    const { data: existing } = await supabase
      .from('consagracao_registros')
      .select('numero_processo')
      .like('numero_processo', `%/${year}`);

    let next = 1;
    if (existing && existing.length > 0) {
      const numeros = existing
        .map((item: any) => {
          const raw = String(item?.numero_processo || '');
          const base = raw.split('/')[0];
          const parsed = parseInt(base, 10);
          return Number.isFinite(parsed) ? parsed : 0;
        })
        .filter((value: number) => value > 0);
      next = (numeros.length ? Math.max(...numeros) : 0) + 1;
    }
    body.numero_processo = `${next}/${year}`;
  }

  const { data, error } = await supabase
    .from('consagracao_registros')
    .insert([body])
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: 'Id invalido.' }, { status: 400 });
  }

  const updates = { ...body } as Record<string, any>;
  delete updates.id;

  const supabase = createServerClient();

  // 1. Fetch the existing process record to have the complete data
  const { data: processRecord, error: fetchError } = await supabase
    .from('consagracao_registros')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError || !processRecord) {
    return NextResponse.json({ error: fetchError?.message || 'Processo não encontrado.' }, { status: 404 });
  }

  // 2. If status_processo is being updated, handle specific transition rules
  const statusProcesso = updates.status_processo;
  if (statusProcesso && statusProcesso !== processRecord.status_processo) {
    
    // Check if process is already homologated
    if (processRecord.status_processo === 'homologar') {
      return NextResponse.json({ error: 'Processo já homologado. Nenhuma alteração é permitida.' }, { status: 400 });
    }

    if (statusProcesso === 'deferir') {
      // Deferir
      const { data: updatedProcess, error: updateError } = await supabase
        .from('consagracao_registros')
        .update({ status_processo: 'deferir' })
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

      // Log to history if member_id is linked
      const mId = processRecord.member_id;
      if (mId) {
        await supabase.from('member_history').insert({
          member_id: mId,
          tipo: 'Processo de Consagração',
          descricao: 'Processo de consagração deferido.',
          usuario_id: auth.ctx.user.id,
          ocorrencia: new Date().toISOString().split('T')[0]
        } as any);
      }
      return NextResponse.json({ data: updatedProcess });
    }

    if (statusProcesso === 'indeferir') {
      // Indeferir
      const { data: updatedProcess, error: updateError } = await supabase
        .from('consagracao_registros')
        .update({ status_processo: 'indeferir' })
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

      const mId = processRecord.member_id;
      if (mId) {
        await supabase.from('member_history').insert({
          member_id: mId,
          tipo: 'Processo de Consagração',
          descricao: 'Processo de consagração indeferido.',
          usuario_id: auth.ctx.user.id,
          ocorrencia: new Date().toISOString().split('T')[0]
        } as any);
      }
      return NextResponse.json({ data: updatedProcess });
    }

    if (statusProcesso === 'em_processo') {
      // Em Processo
      const { data: updatedProcess, error: updateError } = await supabase
        .from('consagracao_registros')
        .update({ status_processo: 'em_processo' })
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

      const mId = processRecord.member_id;
      if (mId) {
        await supabase.from('member_history').insert({
          member_id: mId,
          tipo: 'Processo de Consagração',
          descricao: 'Processo de consagração retornado para Em Processo.',
          usuario_id: auth.ctx.user.id,
          ocorrencia: new Date().toISOString().split('T')[0]
        } as any);
      }
      return NextResponse.json({ data: updatedProcess });
    }

    if (statusProcesso === 'homologar') {
      // HOMOLOGAR
      
      // A. IDEMPOTÊNCIA - Buscar se o ministro já existe
      let existingMember: any = null;

      // Check by CPF
      if (processRecord.cpf) {
        const { data } = await supabase
          .from('members')
          .select('*')
          .eq('cpf', processRecord.cpf)
          .maybeSingle();
        existingMember = data;
      }

      // Check by custom_fields reference
      if (!existingMember) {
        const { data } = await supabase
          .from('members')
          .select('*')
          .eq('custom_fields->>consagracao_processo_id', id)
          .maybeSingle();
        existingMember = data;
      }

      // Check by name and birthdate
      if (!existingMember && processRecord.nome && processRecord.data_nascimento) {
        const { data } = await supabase
          .from('members')
          .select('*')
          .eq('name', processRecord.nome)
          .eq('data_nascimento', processRecord.data_nascimento)
          .maybeSingle();
        existingMember = data;
      }

      let memberId = '';

      // Pre-calculate dates and local of ordination based on cargo pretendido
      const cargoPretendido = processRecord.cargo_pretendido;
      const dataConsagracao = processRecord.data_consagracao || new Date().toISOString().split('T')[0];
      const localConsagracao = processRecord.local || '';

      const consagraFields: Record<string, any> = {};
      if (cargoPretendido === 'EVANGELISTA AUTORIZADO') {
        consagraFields.ev_autorizado_data = dataConsagracao;
        consagraFields.ev_autorizado_local = localConsagracao;
      } else if (cargoPretendido === 'EVANGELISTA CONSAGRADO') {
        consagraFields.ev_consagrado_data = dataConsagracao;
        consagraFields.ev_consagrado_local = localConsagracao;
      } else if (cargoPretendido === 'PASTOR') {
        consagraFields.orden_pastor_data = dataConsagracao;
        consagraFields.orden_pastor_local = localConsagracao;
      }

      if (existingMember) {
        // Ministro já existe!
        memberId = existingMember.id;
        
        // Update their custom fields and cargo ministerial
        const existingCustomFields = existingMember.custom_fields || {};
        const newCustomFields = {
          ...existingCustomFields,
          consagracao_processo_id: id
        };

        const { error: updateMemberError } = await supabase
          .from('members')
          .update({
            cargo_ministerial: cargoPretendido || existingMember.cargo_ministerial,
            custom_fields: newCustomFields,
            ...consagraFields
          })
          .eq('id', memberId);

        if (updateMemberError) {
          return NextResponse.json({ error: `Erro ao atualizar cadastro oficial do ministro: ${updateMemberError.message}` }, { status: 500 });
        }

        // Log to history
        await supabase.from('member_history').insert({
          member_id: memberId,
          tipo: 'Processo de Consagração',
          descricao: 'Processo de consagração homologado. Ministro atualizado no cadastro oficial.',
          usuario_id: auth.ctx.user.id,
          ocorrencia: new Date().toISOString().split('T')[0]
        } as any);
      } else {
        // Ministro não existe! Criar novo cadastro.
        const newMemberData = {
          name: processRecord.nome,
          cpf: processRecord.cpf || null,
          rg: processRecord.rg || null,
          orgao_emissor: processRecord.orgao_emissor || null,
          estado_civil: processRecord.estado_civil || null,
          nacionalidade: processRecord.nacionalidade || null,
          naturalidade: processRecord.naturalidade || null,
          email: processRecord.email || null,
          sexo: processRecord.sexo || null,
          data_nascimento: processRecord.data_nascimento || null,
          nome_pai: processRecord.nome_pai || null,
          nome_mae: processRecord.nome_mae || null,
          nome_conjuge: processRecord.nome_conjuge || null,
          // Endereço
          cep: processRecord.cep || null,
          logradouro: processRecord.endereco || null,
          numero: processRecord.numero_endereco || null,
          bairro: processRecord.bairro || null,
          complemento: processRecord.complemento || null,
          cidade: processRecord.cidade || null,
          estado: processRecord.uf_endereco || null,
          // Contato
          celular: processRecord.telefone || null,
          whatsapp: processRecord.telefone || null,
          // Geolocalização
          supervisao_id: processRecord.supervisao_id || null,
          campo_id: processRecord.campo_id || null,
          congregacao_id: processRecord.congregacao_id || null,
          // Ministerial
          cargo_ministerial: cargoPretendido || null,
          curso_teologico: processRecord.curso_teologico || null,
          foto_url: processRecord.foto_url || null,
          status: 'active',
          custom_fields: { consagracao_processo_id: id },
          member_since: new Date(),
          ...consagraFields
        };

        const { data: createdMember, error: createMemberError } = await supabase
          .from('members')
          .insert([newMemberData])
          .select('id')
          .maybeSingle();

        if (createMemberError || !createdMember) {
          return NextResponse.json({ error: `Erro ao criar cadastro oficial do ministro: ${createMemberError?.message || 'Não retornado'}` }, { status: 500 });
        }

        memberId = createdMember.id;

        // Log to history
        await supabase.from('member_history').insert({
          member_id: memberId,
          tipo: 'Processo de Consagração',
          descricao: 'Processo de consagração homologado. Ministro incluído no cadastro oficial.',
          usuario_id: auth.ctx.user.id,
          ocorrencia: new Date().toISOString().split('T')[0]
        } as any);
      }

      // B. VINCULAR E MOVER DOCUMENTOS
      let ministerFolderId = '';
      let memberMatricula = '';
      try {
        // Query candidate documents in DB
        const { data: dbDocs } = await supabase
          .from('candidato_documentos')
          .select('*')
          .eq('candidato_id', id);

        // Fetch candidate files from Google Drive
        const candidateYear = String(processRecord.data_processo || '').slice(0, 4) || String(new Date().getFullYear());
        const driveFiles = await listDocumentosDrive(
          'candidato_consagracao',
          id,
          processRecord.nome,
          processRecord.numero_processo || undefined,
          candidateYear
        );

        // Fetch target member info to get matricula and name
        const { data: currentMember } = await supabase
          .from('members')
          .select('id, name, matricula')
          .eq('id', memberId)
          .single();

        memberMatricula = currentMember?.matricula || '';
        const memberName = currentMember?.name || processRecord.nome;

        // Get or create minister's Drive folder
        ministerFolderId = await getOrCreateMemberFolder(
          memberId,
          memberName,
          memberMatricula
        );

        // 1. ANTES DE MOVER OS ARQUIVOS: Registrar no processo de consagração o member_id, a matricula, o drive_folder_id definitivo, data e operador
        await supabase
          .from('consagracao_registros')
          .update({
            member_id: memberId,
            matricula: memberMatricula,
            drive_folder_id: ministerFolderId,
            homologado_em: new Date().toISOString(),
            homologado_por: auth.ctx.user.id
          })
          .eq('id', id);

        const drive = getDriveClient();

        // We process documents found in the database AND/OR Google Drive
        const processedFileIds = new Set<string>();

        for (const driveFile of driveFiles) {
          const driveFileId = driveFile.id;
          if (!driveFileId || processedFileIds.has(driveFileId)) continue;
          processedFileIds.add(driveFileId);

          const fileName = driveFile.name || '';
          const dbDoc = dbDocs?.find(d => d.drive_file_id === driveFileId) || {};

          const tipoDoc = dbDoc.tipo_documento || fileName.match(/^\[([^\]]+)\]/)?.[1] || 'Outros';
          const cleanName = dbDoc.nome_arquivo || fileName.replace(/^\[[^\]]+\]\s*/, '') || fileName;

          // Deduplication Check
          const { data: existsInHistory } = await supabase
            .from('member_history')
            .select('id')
            .eq('member_id', memberId)
            .or(`referencia_id.eq.${driveFileId},descricao.ilike.%${driveFileId}%`)
            .maybeSingle();

          const { data: existsByName } = await supabase
            .from('member_history')
            .select('id')
            .eq('member_id', memberId)
            .eq('tipo', 'Documento adicionado')
            .ilike('descricao', `%${cleanName}%`)
            .maybeSingle();

          if (existsInHistory || existsByName) {
            continue;
          }

          // MOVER O ARQUIVO NO GOOGLE DRIVE (mantendo o mesmo drive_file_id)
          try {
            const fileMeta = await drive.files.get({ fileId: driveFileId, fields: 'parents' });
            const previousParents = fileMeta.data.parents?.join(',') || '';
            
            await drive.files.update({
              fileId: driveFileId,
              addParents: ministerFolderId,
              removeParents: previousParents,
              fields: 'id, parents'
            });
          } catch (driveErr) {
            console.error(`Erro ao mover arquivo ${driveFileId} no Google Drive:`, driveErr);
          }

          // ATUALIZAR METADADOS DO DOCUMENTO MANTENDO O VÍNCULO DO PROCESSO (não deixar a impressão de que sumiram)
          const nowIso = new Date().toISOString();
          await supabase
            .from('candidato_documentos')
            .update({
              member_id: memberId,
              drive_folder_id: ministerFolderId,
              homologado_em: nowIso,
              homologado_por: auth.ctx.user.id
            })
            .eq('drive_file_id', driveFileId);

          const originalBytes = dbDoc.arquivo_original_bytes || parseInt(driveFile.size || '0') || 0;
          const optimizedBytes = dbDoc.arquivo_otimizado_bytes || originalBytes;
          const reduction = dbDoc.percentual_reducao || 0;
          const processadoEm = dbDoc.processado_em || dbDoc.created_at || new Date().toISOString();

          let logDesc = `Documento [${tipoDoc}] "${cleanName}" vinculado a partir do processo de consagração.`;
          if (originalBytes && optimizedBytes && originalBytes > optimizedBytes) {
            logDesc += ` (PDF Otimizado: de ${(originalBytes / 1024).toFixed(1)} KB para ${(optimizedBytes / 1024).toFixed(1)} KB, -${reduction}%)`;
          }

          await supabase.from('member_history').insert({
            member_id: memberId,
            tipo: 'Documento adicionado',
            descricao: logDesc,
            usuario_id: auth.ctx.user.id,
            ocorrencia: new Date().toISOString().split('T')[0],
            origem: 'consagracao',
            referencia_id: driveFileId,
            arquivo_original_bytes: originalBytes,
            arquivo_otimizado_bytes: optimizedBytes,
            percentual_reducao: reduction,
            processado_em: processadoEm
          } as any);
        }

        // 3. No processo de consagração criar um registro de histórico do Processo
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const formattedDate = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const formattedNow = now.toLocaleString('pt-BR');

        const processHistoryDesc = `Documentação do processo vinculada ao cadastro oficial do Ministro.
- Data/Hora: ${formattedNow}
- Operador: ${auth.ctx.user.email || auth.ctx.user.id}
- Registro COMIEADEPA: ${memberMatricula || '—'}
- Member ID: ${memberId}
- Pasta do Google Drive: ${ministerFolderId}`;

        await supabase.from('member_history').insert({
          member_id: memberId,
          tipo: 'Processo de Consagração',
          descricao: processHistoryDesc,
          usuario_id: auth.ctx.user.id,
          ocorrencia: now.toISOString().split('T')[0]
        } as any);

        // 5. PRIMEIRO REGISTRO DO HISTÓRICO MINISTERIAL (Marco Inicial da Vida Ministerial)
        const firstHistoryDesc = `Ministro incorporado ao Cadastro Oficial da COMIEADEPA através do Processo de Consagração.
• Número do Processo: ${processRecord.numero_processo || '—'}
• Registro COMIEADEPA: ${memberMatricula || '—'}
• Cargo recebido: ${cargoPretendido || '—'}
• Data da homologação: ${formattedDate}
• Operador responsável: ${auth.ctx.user.email || auth.ctx.user.id}
• Origem: Processo de Consagração`;

        await supabase.from('member_history').insert({
          member_id: memberId,
          tipo: 'Consagração',
          titulo: 'Homologação Ministerial',
          descricao: firstHistoryDesc,
          origem: 'Processo de Consagração',
          usuario_id: auth.ctx.user.id,
          ocorrencia: now.toISOString().split('T')[0]
        } as any);

      } catch (docErr) {
        console.error('Erro no fluxo de migração de documentos:', docErr);
      }

      // C. Update the candidate process record to homologar and link member_id
      const { data: updatedProcess, error: updateError } = await supabase
        .from('consagracao_registros')
        .update({
          status_processo: 'homologar',
          member_id: memberId,
          matricula: memberMatricula,
          drive_folder_id: ministerFolderId,
          homologado_em: new Date().toISOString(),
          homologado_por: auth.ctx.user.id
        })
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

      return NextResponse.json({ data: updatedProcess });
    }
  }

  // Fallback for direct field updates (standard patch)
  const { data: updatedProcess, error: updateError } = await supabase
    .from('consagracao_registros')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ data: updatedProcess });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: 'Id invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase.from('consagracao_registros').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
