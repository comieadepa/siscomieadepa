import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { getOrCreateMemberFolder, listDocumentosDrive, getDriveClient } from '@/lib/google-drive';
import { logDB } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/secretaria/consagracao/regularizar-homologados
 * Retorna a lista de candidatos elegíveis para regularização.
 */
export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const supabase = createServerClient();

  // Localiza candidatos onde status_processo = homologar E member_id IS NULL
  const { data: elegiveis, error } = await supabase
    .from('consagracao_registros')
    .select('id, numero_processo, nome, cpf, cargo_pretendido, data_nascimento, data_processo')
    .eq('status_processo', 'homologar')
    .is('member_id', null)
    .order('numero_processo', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Pre-visualização: verifica se já existe ministro com o mesmo CPF
  const cpfs = elegiveis?.map((r) => r.cpf).filter(Boolean) || [];
  let existingMembers: any[] = [];
  if (cpfs.length > 0) {
    const { data } = await supabase
      .from('members')
      .select('id, name, cpf, matricula')
      .in('cpf', cpfs);
    existingMembers = data || [];
  }

  // Busca quantidade de documentos vinculados a cada candidato_id no banco
  const elegiveisIds = elegiveis?.map((r) => r.id) || [];
  let docsCount: Record<string, number> = {};
  if (elegiveisIds.length > 0) {
    const { data: dbDocs } = await supabase
      .from('candidato_documentos')
      .select('candidato_id')
      .in('candidato_id', elegiveisIds);
    
    for (const doc of dbDocs || []) {
      const cid = String(doc.candidato_id);
      docsCount[cid] = (docsCount[cid] || 0) + 1;
    }
  }

  const result = elegiveis?.map((r) => {
    const ministroExistente = existingMembers.find((m) => m.cpf && m.cpf === r.cpf);
    return {
      ...r,
      possui_documentos: (docsCount[r.id] || 0) > 0,
      existe_ministro_mesmo_cpf: !!ministroExistente,
      ministro_existente_info: ministroExistente
        ? { id: ministroExistente.id, name: ministroExistente.name, matricula: ministroExistente.matricula }
        : null,
      status_previsto: ministroExistente ? 'Vincular e Atualizar' : 'Criar Novo Ministro',
    };
  });

  return NextResponse.json({ data: result || [] });
}

/**
 * POST /api/v1/secretaria/consagracao/regularizar-homologados
 * Executa a regularização dos processos homologados órfãos.
 */
export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const supabase = createServerClient();
  const userId = auth.ctx.user.id;
  const userEmail = auth.ctx.user.email || 'Admin';

  // 1. Busca todos os processos elegíveis
  const { data: elegiveis, error } = await supabase
    .from('consagracao_registros')
    .select('*')
    .eq('status_processo', 'homologar')
    .is('member_id', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!elegiveis || elegiveis.length === 0) {
    return NextResponse.json({
      ok: true,
      regularizados: 0,
      ignorados: 0,
      erros: 0,
      mensagem: 'Nenhum processo elegível encontrado para regularização.',
    });
  }

  let regularizados = 0;
  let ignorados = 0;
  let erros = 0;
  const errosLog: string[] = [];

  // Mapeamento para idempotência e execução segura
  for (const processRecord of elegiveis) {
    const id = processRecord.id;

    try {
      // A. IDEMPOTÊNCIA/BUSCA - Buscar se o ministro já existe por CPF, custom_fields ou Nome + Data Nascimento
      let existingMember: any = null;

      if (processRecord.cpf) {
        const { data } = await supabase
          .from('members')
          .select('*')
          .eq('cpf', processRecord.cpf)
          .maybeSingle();
        existingMember = data;
      }

      if (!existingMember) {
        const { data } = await supabase
          .from('members')
          .select('*')
          .eq('custom_fields->>consagracao_processo_id', id)
          .maybeSingle();
        existingMember = data;
      }

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
        // Ministro já existe! Apenas vincula e atualiza (conforme especificação, sem duplicar)
        memberId = existingMember.id;
        
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

        if (updateMemberError) throw new Error(`Erro ao vincular ministro existente: ${updateMemberError.message}`);

        // Evitar histórico de consagração duplicado
        const { data: dupHist } = await supabase
          .from('member_history')
          .select('id')
          .eq('member_id', memberId)
          .eq('tipo', 'Processo de Consagração')
          .ilike('descricao', `%${id}%`)
          .maybeSingle();

        if (!dupHist) {
          await supabase.from('member_history').insert({
            member_id: memberId,
            tipo: 'Processo de Consagração',
            descricao: 'Processo de consagração homologado. Ministro atualizado no cadastro oficial.',
            usuario_id: userId,
            ocorrencia: new Date().toISOString().split('T')[0]
          } as any);
        }
      } else {
        // Ministro não existe! Criar novo cadastro exatamente igual à rotina atual
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
          throw new Error(`Erro ao criar cadastro oficial: ${createMemberError?.message || 'Não retornado'}`);
        }

        memberId = createdMember.id;

        await supabase.from('member_history').insert({
          member_id: memberId,
          tipo: 'Processo de Consagração',
          descricao: 'Processo de consagração homologado. Ministro incluído no cadastro oficial.',
          usuario_id: userId,
          ocorrencia: new Date().toISOString().split('T')[0]
        } as any);
      }

      // B. VINCULAR E MOVER DOCUMENTOS
      let ministerFolderId = '';
      let memberMatricula = '';

      // Busca informações atualizadas do membro para pegar a matrícula gerada automaticamente
      const { data: currentMember } = await supabase
        .from('members')
        .select('id, name, matricula')
        .eq('id', memberId)
        .single();

      memberMatricula = currentMember?.matricula || '';
      const memberName = currentMember?.name || processRecord.nome;

      // Obter ou criar pasta no Google Drive para o ministro
      try {
        ministerFolderId = await getOrCreateMemberFolder(
          memberId,
          memberName,
          memberMatricula
        );
      } catch (driveErr: any) {
        console.error('[regularizar_homologados] erro pasta drive:', driveErr.message);
      }

      // 1. Atualizar o processo de consagração com os vínculos
      const { error: updateProcessError } = await supabase
        .from('consagracao_registros')
        .update({
          member_id: memberId,
          matricula: memberMatricula,
          drive_folder_id: ministerFolderId || null,
          homologado_em: new Date().toISOString(),
          homologado_por: userId
        })
        .eq('id', id);

      if (updateProcessError) {
        throw new Error(`Erro ao vincular processo: ${updateProcessError.message}`);
      }

      // Processa documentos
      try {
        const { data: dbDocs } = await supabase
          .from('candidato_documentos')
          .select('*')
          .eq('candidato_id', id);

        const candidateYear = String(processRecord.data_processo || '').slice(0, 4) || String(new Date().getFullYear());
        const driveFiles = ministerFolderId
          ? await listDocumentosDrive(
              'candidato_consagracao',
              id,
              processRecord.nome,
              processRecord.numero_processo || undefined,
              candidateYear
            ).catch(() => [])
          : [];

        const drive = getDriveClient();
        const processedFileIds = new Set<string>();

        // Processar arquivos encontrados no drive
        for (const driveFile of driveFiles) {
          const driveFileId = driveFile.id;
          if (!driveFileId || processedFileIds.has(driveFileId)) continue;
          processedFileIds.add(driveFileId);

          const fileName = driveFile.name || '';
          const dbDoc = dbDocs?.find(d => d.drive_file_id === driveFileId) || {};

          const tipoDoc = dbDoc.tipo_documento || fileName.match(/^\[([^\]]+)\]/)?.[1] || 'Outros';
          const cleanName = dbDoc.nome_arquivo || fileName.replace(/^\[[^\]]+\]\s*/, '') || fileName;

          // Evita duplicidade no histórico de documentos
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

          if (existsInHistory || existsByName) continue;

          // Move arquivo no Google Drive
          if (ministerFolderId) {
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
              console.error(`[regularizar_homologados] erro mover drive file ${driveFileId}:`, driveErr);
            }
          }

          // Atualiza dados na tabela candidato_documentos
          const nowIso = new Date().toISOString();
          const { error: updateDocError } = await supabase
            .from('candidato_documentos')
            .update({
              member_id: memberId,
              drive_folder_id: ministerFolderId || null,
              homologado_em: nowIso,
              homologado_por: userId
            })
            .eq('drive_file_id', driveFileId);

          if (updateDocError) {
            console.error(`[regularizar_homologados] erro ao atualizar doc ${driveFileId}:`, updateDocError.message);
          }

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
            usuario_id: userId,
            ocorrencia: new Date().toISOString().split('T')[0],
            origem: 'consagracao',
            referencia_id: driveFileId,
            arquivo_original_bytes: originalBytes,
            arquivo_otimizado_bytes: optimizedBytes,
            percentual_reducao: reduction,
            processado_em: processadoEm
          } as any);
        }
      } catch (docErr: any) {
        console.error('[regularizar_homologados] erro documentos:', docErr.message);
      }

      // C. REGISTRAR HISTÓRICOS DA HOMOLOGAÇÃO E HISTÓRICO DE MIGRACAO
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const formattedDate = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const formattedNow = now.toLocaleString('pt-BR');

      // 1. Histórico do Processo
      const processHistoryDesc = `Documentação do processo vinculada ao cadastro oficial do Ministro (Regularização).
- Data/Hora: ${formattedNow}
- Operador: ${userEmail}
- Registro COMIEADEPA: ${memberMatricula || '—'}
- Member ID: ${memberId}
- Pasta do Google Drive: ${ministerFolderId || '—'}`;

      await supabase.from('member_history').insert({
        member_id: memberId,
        tipo: 'Processo de Consagração',
        descricao: processHistoryDesc,
        usuario_id: userId,
        ocorrencia: now.toISOString().split('T')[0]
      } as any);

      // 2. Histórico da Homologação (Marco Inicial da Vida Ministerial)
      const firstHistoryDesc = `Ministro incorporado ao Cadastro Oficial da COMIEADEPA através do Processo de Consagração.
• Número do Processo: ${processRecord.numero_processo || '—'}
• Registro COMIEADEPA: ${memberMatricula || '—'}
• Cargo recebido: ${cargoPretendido || '—'}
• Data da homologação: ${formattedDate}
• Operador responsável: ${userEmail}
• Origem: Processo de Consagração`;

      await supabase.from('member_history').insert({
        member_id: memberId,
        tipo: 'Consagração',
        titulo: 'Homologação Ministerial',
        descricao: firstHistoryDesc,
        origem: 'Processo de Consagração',
        usuario_id: userId,
        ocorrencia: now.toISOString().split('T')[0]
      } as any);

      // 3. Histórico adicional obrigatório para rastreio da migração legada
      const migrationHistoryDesc = `Cadastro ministerial regularizado através da rotina de migração de homologações legadas.
• Número do Processo: ${processRecord.numero_processo || '—'}
• Operador: ${userEmail}
• Data de Execução: ${formattedNow}`;

      await supabase.from('member_history').insert({
        member_id: memberId,
        tipo: 'Migração Legada',
        titulo: 'Regularização de Homologação',
        descricao: migrationHistoryDesc,
        origem: 'Rotina de Migração',
        usuario_id: userId,
        ocorrencia: now.toISOString().split('T')[0]
      } as any);

      regularizados++;
    } catch (err: any) {
      erros++;
      errosLog.push(`${processRecord.nome} (${processRecord.numero_processo}): ${err.message}`);
      console.error(`[regularizar_homologados] erro ao regularizar id ${id}:`, err);
    }
  }

  // Registrar auditoria global na tabela de logs
  void logDB({
    userId,
    acao: 'regularizar_homologados_legados',
    modulo: 'secretaria',
    entidade: 'consagracao_registros',
    entidadeId: 'rotina_regularizacao',
    status: erros > 0 ? 'aviso' : 'sucesso',
    descricao: `Rotina de Regularização de Homologados antigos executada. Regularizados: ${regularizados}, Ignorados: ${ignorados}, Erros: ${erros}.`,
    request,
  });

  return NextResponse.json({
    ok: true,
    regularizados,
    ignorados,
    erros,
    erros_detalhes: errosLog,
  });
}
