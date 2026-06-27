import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';
import {
  calcularPrioridadeHospedagem,
  resolveCamaInferiorAutomatica,
  resolveGrupoHospedagemAGO,
} from '@/lib/hospedagem-helpers';
import { createOrFindAsaasCustomer, createEventoPayment } from '@/lib/asaas';
import { cleanCpf } from '@/lib/cpf';
import { generateQRCodeToken } from '@/lib/qrcode-token';
import { parseCampoMissionarioConfig } from '@/lib/ago-regras';
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';

const VENCIMENTO_DIAS = 3;

function dueDateFromNow(dias = VENCIMENTO_DIAS): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function incrementarCupom(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase-server').createServerClient>>,
  eventoId: string,
  codigo: string
) {
  const { data: cup } = await supabase
    .from('evento_cupons')
    .select('usados')
    .eq('evento_id', eventoId)
    .eq('codigo', codigo)
    .single();
  if (cup) {
    await supabase
      .from('evento_cupons')
      .update({ usados: cup.usados + 1 })
      .eq('evento_id', eventoId)
      .eq('codigo', codigo);
  }
}

function normalizePhoneCompare(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

async function sincronizarFichaMembroPorInscricao(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase-server').createServerClient>>,
  payload: {
    cpf?: string | null;
    email?: string | null;
    whatsapp?: string | null;
    campoId?: string | null;
  },
) {
  const cpf = String(payload.cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) return;

  const { data: membro, error: membroErr } = await supabase
    .from('members')
    .select('id,email,whatsapp,custom_fields')
    .eq('cpf', cpf)
    .maybeSingle();

  if (membroErr || !membro) return;

  const updates: Record<string, unknown> = {};
  const emailNovo = String(payload.email || '').trim() || null;
  const whatsappNovo = String(payload.whatsapp || '').trim() || null;

  const emailAtualNorm = String((membro as any).email || '').trim().toLowerCase();
  const emailNovoNorm = String(emailNovo || '').toLowerCase();
  if (emailNovo && emailNovoNorm !== emailAtualNorm) {
    updates.email = emailNovo;
  }

  const whatsappAtualNorm = normalizePhoneCompare((membro as any).whatsapp || null);
  const whatsappNovoNorm = normalizePhoneCompare(whatsappNovo);
  if (whatsappNovo && whatsappNovoNorm && whatsappNovoNorm !== whatsappAtualNorm) {
    updates.whatsapp = whatsappNovo;
  }

  const campoId = String(payload.campoId || '').trim();
  if (campoId) {
    const { data: campoRow } = await supabase
      .from('campos')
      .select('nome')
      .eq('id', campoId)
      .maybeSingle();
    const campoNome = String((campoRow as { nome?: string | null } | null)?.nome || '').trim();
    if (campoNome) {
      const cfAtual = ((membro as any).custom_fields && typeof (membro as any).custom_fields === 'object')
        ? ((membro as any).custom_fields as Record<string, unknown>)
        : {};
      const campoAtual = String(cfAtual.campo || '').trim();
      if (campoAtual !== campoNome) {
        updates.custom_fields = {
          ...cfAtual,
          campo: campoNome,
        };
      }
    }
  }

  if (Object.keys(updates).length === 0) return;

  await supabase
    .from('members')
    .update(updates)
    .eq('id', (membro as any).id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;
  const operadorEmail = guard.ctx.user?.email ?? undefined;

  // Identificar operador da equipe e caixa ativo
  let equipeId: string | null = guard.ctx.equipe?.id || null;
  let operadorNome: string | null = null;

  if (equipeId) {
    const { data: eq } = await supabase
      .from('evento_equipe')
      .select('nome')
      .eq('id', equipeId)
      .maybeSingle();
    if (eq) {
      operadorNome = eq.nome;
    }
  } else if (guard.ctx.user?.email) {
    const { data: eq } = await supabase
      .from('evento_equipe')
      .select('id, nome')
      .eq('evento_id', eventoId)
      .eq('email', guard.ctx.user.email)
      .eq('ativo', true)
      .maybeSingle();
    if (eq) {
      equipeId = eq.id;
      operadorNome = eq.nome;
    }
  }

  let caixaSessaoId: string | null = null;
  if (equipeId) {
    const { data: sessao } = await supabase
      .from('evento_caixa_sessoes')
      .select('id, operador_nome')
      .eq('evento_id', eventoId)
      .eq('operador_id', equipeId)
      .eq('status', 'aberto')
      .maybeSingle();

    if (sessao) {
      caixaSessaoId = sessao.id;
      if (!operadorNome) {
        operadorNome = sessao.operador_nome;
      }
    } else {
      // Auto-abrir caixa se não existir
      const { data: novaSessao, error: insertError } = await supabase
        .from('evento_caixa_sessoes')
        .insert({
          evento_id: eventoId,
          operador_id: equipeId,
          operador_nome: operadorNome || guard.ctx.user?.email || 'Operador',
          status: 'aberto',
          data_abertura: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (!insertError && novaSessao) {
        caixaSessaoId = novaSessao.id;
      }
    }
  } else {
    const isGlobalOrDeptAdmin = guard.ctx.role === 'admin_evento' || guard.ctx.source === 'global' || guard.ctx.source === 'departamento';
    if (!isGlobalOrDeptAdmin) {
      return NextResponse.json({ error: 'Operador não identificado para o caixa operacional.' }, { status: 403 });
    }
  }

  const operadorId = equipeId || guard.ctx.user?.id || undefined;
  const dbOperadorNome = operadorNome || guard.ctx.user?.email || 'Operador';

  try {
    const body = await request.json() as Record<string, unknown>;
    const {
      nome_inscrito,
      cpf,
      email,
      whatsapp,
      sexo,
      data_nascimento,
      supervisao_id,
      campo_id,
      hospedagem,
      brinde,
      tipo_inscricao,
      equipe_apoio,
      cupom_codigo,
      valor_original,
      desconto_valor,
      valor_final,
      forma_pagamento,
      observacoes,
      qr_code,
      hosp_necessidade_especial,
      hosp_descricao_necessidade,
      hosp_observacoes,
      incluir_esposa,
      esposa,
      participantes,
    } = body;

    const hospPossuiComorbidade = !!(body as any).hosp_possui_comorbidade;
    const hospDescricaoComorbidade = ((body as any).hosp_descricao_comorbidade as string)?.trim() || null;
    let hospCamaInferiorAuto = false;
    let grupoHospedagemAuto: string | null = null;

    if (!nome_inscrito || !String(nome_inscrito).trim() || !supervisao_id) {
      return NextResponse.json({ error: 'Nome e Supervisão são obrigatórios.' }, { status: 400 });
    }

    // Busca dados completos do evento
    const { data: evento } = await supabase
      .from('eventos')
      .select('id,nome,slug,departamento,configuracoes_ago,inscricoes_abertas,status')
      .eq('id', eventoId)
      .single();

    if (!evento) {
      return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
    }

    let tipoNome = tipo_inscricao ? String(tipo_inscricao).trim() : null;
    const norm = (v: string | null | undefined) =>
      String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const ehTipoEsposaOuViuva = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('esposa') || n.includes('viuva');
    };
    const ehTipoPastorPresidente = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('pastor presidente') && !ehTipoEsposaOuViuva(n);
    };
    const ehTipoPastorAuxiliar = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('pastor auxiliar') && !ehTipoEsposaOuViuva(n);
    };
    const ehTipoPastorJubilado = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('pastor jubilado') && !ehTipoEsposaOuViuva(n);
    };
    const ehTipoEsposaJubilado = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('esposa') && n.includes('pastor jubilado');
    };
    const ehTipoVisitante = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('visitante');
    };
    const normalizarSexo = (valor: unknown): 'M' | 'F' | '' => {
      const raw = String(valor ?? '').trim().toUpperCase();
      if (raw.startsWith('M')) return 'M';
      if (raw.startsWith('F')) return 'F';
      return '';
    };
    let incluiAlimentacao = false;
    let quantidadeRefeicoes = 0;
    if (tipoNome) {
      const { data: tipo } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, valor, inclui_alimentacao, quantidade_refeicoes')
        .eq('evento_id', eventoId)
        .ilike('nome', tipoNome)
        .eq('ativo', true)
        .maybeSingle();
      if (tipo) {
        // Proteção: tipo encontrado mas valor NULL → erro explícito (não usar valor do corpo da requisição sem validar)
        if (tipo.valor === null || tipo.valor === undefined) {
          return NextResponse.json(
            { error: `Tipo de inscrição sem valor configurado: "${tipo.nome}". Corrija a configuração do evento.` },
            { status: 500 },
          );
        }
        tipoNome = tipo.nome;
        incluiAlimentacao = !!tipo.inclui_alimentacao;
        quantidadeRefeicoes = incluiAlimentacao ? Math.max(0, Number(tipo.quantidade_refeicoes ?? 0)) : 0;
      }
    }

    if ((evento as any).departamento === 'AGO') {
      incluiAlimentacao = true;
      quantidadeRefeicoes = 12;
    }

    if ((evento as any).departamento === 'AGO') {
      hospCamaInferiorAuto = resolveCamaInferiorAutomatica({
        sexo: sexo ? String(sexo) : null,
        data_nascimento: data_nascimento ? String(data_nascimento) : null,
        tipo_inscricao: tipoNome,
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_possui_comorbidade: hospPossuiComorbidade,
      });
      grupoHospedagemAuto = resolveGrupoHospedagemAGO({
        sexo: sexo ? String(sexo) : null,
        data_nascimento: data_nascimento ? String(data_nascimento) : null,
        tipo_inscricao: tipoNome,
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_possui_comorbidade: hospPossuiComorbidade,
      });
    }

    // Determina forma e status de pagamento
    const formaStr = String(forma_pagamento ?? '');
    let vFinal = tipoNome === 'Equipe de Apoio' ? 0 : (typeof valor_final === 'number' ? valor_final : 0);
    let vOriginal = tipoNome === 'Equipe de Apoio' ? 0 : (typeof valor_original === 'number' ? valor_original : 0);
    const vDesconto = tipoNome === 'Equipe de Apoio' ? 0 : (typeof desconto_valor === 'number' ? desconto_valor : 0);
    let isGratuito = tipoNome === 'Equipe de Apoio' || vFinal <= 0 || formaStr === 'isento' || formaStr === 'equipe_apoio';
    let isAsaas = formaStr === 'asaas' && !isGratuito;
    let isPresencial = !isAsaas && !isGratuito;
    let statusPag: 'isento' | 'pendente' | 'pago' = 'pendente';
    let formaPagSalva: string | null = null;
    const recalcularPagamento = () => {
      statusPag = isGratuito ? 'isento'
        : isAsaas ? 'pendente'
        : 'pago';
      formaPagSalva = isGratuito ? (tipoNome === 'Equipe de Apoio' ? 'isento' : (formaStr === 'equipe_apoio' ? 'equipe_apoio' : null))
        : formaStr === 'pix_manual' ? 'pix'
        : formaStr === 'asaas' ? 'pix'
        : formaStr;
    };
    recalcularPagamento();

    // CPF limpo
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;

    const resolverVinculoEsposaJubilado = async (cpfParaValidar: string | null | undefined) => {
      const cpfNorm = String(cpfParaValidar || '').replace(/\D/g, '');
      if (cpfNorm.length !== 11) return null;

      const { data: rows, error: vincErr } = await supabase
        .from('members')
        .select('id,name,jubilado,status,estado_civil,nome_conjuge,cpf_conjuge')
        .eq('jubilado', true)
        .in('status', ['active', 'ativo'])
        .eq('cpf_conjuge', cpfNorm)
        .limit(10);

      if (vincErr) {
        throw new Error(`Falha ao validar cpf_conjuge de jubilado no balcao: ${vincErr.message}`);
      }

      const match = (rows ?? []).find((r) => {
        const cpfConjuge = String((r as any).cpf_conjuge ?? '').replace(/\D/g, '');
        const nomeConjuge = String((r as any).nome_conjuge ?? '').trim();
        const estadoCivilNorm = String((r as any).estado_civil ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();
        return cpfConjuge === cpfNorm
          && cpfConjuge.length === 11
          && !!nomeConjuge
          && estadoCivilNorm.includes('casad');
      }) as { id?: string | null; name?: string | null } | undefined;

      if (!match) return null;
      return {
        ministroId: String(match.id || ''),
        ministroNome: match.name ? String(match.name) : null,
      };
    };

    const vinculoEsposaJubiladoTitular = (evento as any).departamento === 'AGO' && cpfLimpo
      ? await resolverVinculoEsposaJubilado(cpfLimpo)
      : null;

    if ((evento as any).departamento === 'AGO' && vinculoEsposaJubiladoTitular) {
      const { data: tipoEsposaJubilado } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, inclui_alimentacao, quantidade_refeicoes')
        .eq('evento_id', eventoId)
        .eq('ativo', true)
        .ilike('nome', '%Esposa%Pastor Jubilado%')
        .maybeSingle();

      if (!tipoEsposaJubilado) {
        return NextResponse.json(
          { error: 'Categoria Esposa de Pastor Jubilado não está disponível para este evento.' },
          { status: 400 },
        );
      }

      tipoNome = tipoEsposaJubilado.nome;
      incluiAlimentacao = !!tipoEsposaJubilado.inclui_alimentacao;
      quantidadeRefeicoes = incluiAlimentacao ? Math.max(0, Number(tipoEsposaJubilado.quantidade_refeicoes ?? 0)) : 0;
      vOriginal = 0;
      vFinal = 0;
      isGratuito = true;
      isAsaas = false;
      isPresencial = false;
      recalcularPagamento();
    }

    // Snapshot ministerial (AGO)
    let ministroSnapshot: Record<string, unknown> | null = null;
    if (cpfLimpo && (evento as any).departamento === 'AGO') {
      const { data: membro } = await supabase
        .from('members')
        .select('id,name,cpf,matricula,data_nascimento,status,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado,campo_id,supervisao_id,congregacao_id,congregacoes!congregacao_id(campo_id,nome),custom_fields')
        .eq('cpf', cpfLimpo)
        .maybeSingle();
      if (membro) {
        let isCampoMissionario = false;
        let campoNome: string | null = null;
        // Resolve campo_id: direto no membro → via congregação → via custom_fields
        const campoIdDireto = String((membro as any).campo_id ?? '').trim() || null;
        const campoIdViaCong = (membro as any).congregacoes?.campo_id
          ? String((membro as any).congregacoes.campo_id).trim() || null
          : null;
        const campoNomeViaCf = (() => {
          try {
            const cf = (membro as any).custom_fields;
            if (!cf) return null;
            const obj = typeof cf === 'string' ? JSON.parse(cf) : cf;
            return obj?.campo ?? null;
          } catch { return null; }
        })();
        const campoIdSnapshot = (campoIdDireto ?? campoIdViaCong ?? (campo_id ? String(campo_id).trim() : null)) || null;
        const supervisaoIdSnapshot = String((membro as any).supervisao_id ?? supervisao_id ?? '').trim() || null;
        if (campoIdSnapshot) {
          const { data: campoData } = await supabase
            .from('campos')
            .select('nome,is_campo_missionario')
            .eq('id', campoIdSnapshot)
            .maybeSingle();
          if (campoData) {
            isCampoMissionario = !!(campoData as any).is_campo_missionario;
            campoNome = (campoData as any).nome ?? null;
          }
        } else if (campoNomeViaCf) {
          // Fallback: busca campo pelo nome nos custom_fields
          const { data: campoData } = await supabase
            .from('campos')
            .select('nome,is_campo_missionario')
            .ilike('nome', campoNomeViaCf.trim())
            .maybeSingle();
          if (campoData) {
            isCampoMissionario = !!(campoData as any).is_campo_missionario;
            campoNome = (campoData as any).nome ?? null;
          }
        }
        ministroSnapshot = {
          ministro_id:        (membro as any).id,
          nome:               (membro as any).name,
          cpf:                (membro as any).cpf,
          matricula:          (membro as any).matricula ?? null,
          campo:              campoNome,
          campo_id:           campoIdSnapshot,
          supervisao_id:      supervisaoIdSnapshot,
          status_ministerial: (membro as any).status ?? null,
          cargo:              (membro as any).cargo_ministerial ?? null,
          is_pastor_presidente:  !!((membro as any).pastor_presidente),
          is_pastor_auxiliar:    !!((membro as any).pastor_auxiliar),
          is_pastor_jubilado:    !!((membro as any).jubilado),
          is_campo_missionario:  isCampoMissionario,
        };
        console.log('[DEBUG BALCAO MEMBER]:', {
          encontrado: true,
          cpfLimpo,
          nome: (membro as any).name,
          campoIdSnapshot,
          is_campo_missionario: isCampoMissionario,
          is_pastor_presidente: !!((membro as any).pastor_presidente),
          status: (membro as any).status
        });
      } else {
        console.log('[DEBUG BALCAO MEMBER NOT FOUND]:', { cpfLimpo });
      }
    }

    const confAgo = (evento as any).configuracoes_ago as Record<string, unknown> | null;
    const cmConfig = parseCampoMissionarioConfig(confAgo);
    // Alinha com o frontend: aceita o flag booleano OU a nova estrutura campo_missionario.enabled,
    // sem exigir que valor_pastor_presidente seja > 0 (preço pode vir do tipo em evento_tipos_inscricao)
    const campoMissionarioEnabled =
      !!cmConfig?.enabled
      || !!(confAgo as any)?.habilitar_desconto_campo_missionario
      || !!(confAgo as any)?.campo_missionario?.enabled;
    const statusMinistro = String(ministroSnapshot?.status_ministerial ?? '').toLowerCase();
    const ministroAtivo = statusMinistro === 'active' || statusMinistro === 'ativo';
    const fluxoCampoMissionarioEspecial =
      (evento as any).departamento === 'AGO'
      && campoMissionarioEnabled
      && ministroAtivo
      && !!ministroSnapshot?.is_pastor_presidente
      && !!ministroSnapshot?.is_campo_missionario;

    console.log('[DEBUG BALCAO CM]:', {
      departamento: (evento as any).departamento,
      campoMissionarioEnabled,
      statusMinistro,
      ministroAtivo,
      is_pastor_presidente: !!ministroSnapshot?.is_pastor_presidente,
      is_campo_missionario: !!ministroSnapshot?.is_campo_missionario,
      fluxoCampoMissionarioEspecial,
      tipoNome
    });

    if (tipoNome === 'CAMPO MISSIONÁRIO' && !fluxoCampoMissionarioEspecial) {
      return NextResponse.json(
        { error: 'Inscrição não permitida para esta modalidade. Requisitos ministeriais de Campo Missionário não atendidos.' },
        { status: 422 },
      );
    }

    if ((evento as any).departamento === 'AGO' && !!ministroSnapshot?.is_pastor_jubilado) {
      const { data: tipoJubilado } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, valor, inclui_alimentacao, quantidade_refeicoes')
        .eq('evento_id', eventoId)
        .ilike('nome', 'Pastor Jubilado%')
        .eq('ativo', true)
        .maybeSingle();

      if (tipoJubilado) {
        tipoNome = tipoJubilado.nome;
        incluiAlimentacao = !!tipoJubilado.inclui_alimentacao;
        quantidadeRefeicoes = incluiAlimentacao ? Math.max(0, Number(tipoJubilado.quantidade_refeicoes ?? 0)) : 0;
        vOriginal = Number(tipoJubilado.valor ?? vOriginal);
        vFinal = Math.max(0, vOriginal - vDesconto);
        isGratuito = vFinal <= 0 || formaStr === 'isento';
        isAsaas = formaStr === 'asaas' && !isGratuito;
        isPresencial = !isAsaas && !isGratuito;
        recalcularPagamento();
      }
    }

    if (fluxoCampoMissionarioEspecial && Array.isArray(participantes) && participantes.length > 0) {
      return NextResponse.json(
        { error: 'Campo Missionário permite inscrição apenas do Pastor Presidente e, opcionalmente, sua esposa.' },
        { status: 400 },
      );
    }

    if (ministroSnapshot) {
      const statusTitular = String(ministroSnapshot.status_ministerial ?? '').toLowerCase();
      const titularAtivo = statusTitular === 'active' || statusTitular === 'ativo';
      const titularEhPP = !!ministroSnapshot.is_pastor_presidente;
      const titularEhPA = !!ministroSnapshot.is_pastor_auxiliar;
      const titularEhJub = !!ministroSnapshot.is_pastor_jubilado;
      const sexoTitularNorm = normalizarSexo(sexo);
      const titularPodePA = titularEhPA || (titularAtivo && sexoTitularNorm === 'M' && !titularEhPP && !titularEhJub);

      if (titularAtivo && ehTipoVisitante(tipoNome)) {
        return NextResponse.json(
          { error: 'Ministro ativo não pode se inscrever como Visitante.' },
          { status: 400 },
        );
      }

      if (titularAtivo && ehTipoPastorPresidente(tipoNome) && !titularEhPP) {
        return NextResponse.json(
          { error: 'Categoria Pastor Presidente exige flag ministerial de Pastor Presidente ativa.' },
          { status: 400 },
        );
      }

      if (titularAtivo && ehTipoPastorAuxiliar(tipoNome) && !titularPodePA) {
        return NextResponse.json(
          { error: 'Categoria Pastor Auxiliar não é compatível com o perfil ministerial informado.' },
          { status: 400 },
        );
      }

      if (titularAtivo && titularEhJub && !ehTipoPastorJubilado(tipoNome)) {
        return NextResponse.json(
          { error: 'Ministro jubilado ativo deve usar categoria de Pastor Jubilado.' },
          { status: 400 },
        );
      }
    }

    const esposaJubiladoManualSemVinculo =
      (evento as any).departamento === 'AGO'
      && ehTipoEsposaJubilado(tipoNome)
      && !vinculoEsposaJubiladoTitular;

    if (fluxoCampoMissionarioEspecial) {
      if (!(tipoNome && (ehTipoPastorPresidente(tipoNome) || tipoNome === 'CAMPO MISSIONÁRIO'))) {
        return NextResponse.json(
          { error: 'Campo Missionário exige categoria Pastor Presidente ou Campo Missionário para o titular.' },
          { status: 400 },
        );
      }

      const valorCmPastor = cmConfig
        ? (typeof cmConfig.valor_pastor_presidente === 'number' ? cmConfig.valor_pastor_presidente : parseFloat(String(cmConfig.valor_pastor_presidente)) || 0)
        : 0;
      if (valorCmPastor > 0 && tipoNome === 'CAMPO MISSIONÁRIO') {
        vOriginal = valorCmPastor;
        vFinal = Math.max(0, vOriginal - vDesconto);
      }

      isGratuito = vFinal <= 0 || formaStr === 'isento';
      isAsaas = formaStr === 'asaas' && !isGratuito;
      isPresencial = !isAsaas && !isGratuito;
      recalcularPagamento();
    }

    // QR code
    const qrFinal = qr_code ? String(qr_code) : generateQRCodeToken();
    const cupomCodigo = cupom_codigo
      ? String(cupom_codigo).trim().toUpperCase()
      : null;

    // ── Fluxo esposa (AGO Campo Missionário) ─────────────────
    const ehEsposaFlow = !!(incluir_esposa) && !!(esposa) && (evento as any).departamento === 'AGO' && fluxoCampoMissionarioEspecial;
    if (ehEsposaFlow) {
      const confAgo = (evento as any).configuracoes_ago as Record<string, unknown> | null;
      const cmConfig = parseCampoMissionarioConfig(confAgo);
      const valorEsposaBase = cmConfig
        ? (typeof cmConfig.valor_esposa === 'number' ? cmConfig.valor_esposa : parseFloat(String(cmConfig.valor_esposa)) || 0)
        : 0;

      // Consulta tipo "Esposa de Pastor Presidente*" para nome e alimentação
      const { data: tipoEsposa } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, inclui_alimentacao, quantidade_refeicoes')
        .eq('evento_id', eventoId)
        .ilike('nome', 'Esposa de Pastor Presidente%')
        .eq('ativo', true)
        .maybeSingle();

      const refeicoesEsposa = (evento as any).departamento === 'AGO'
        ? 12
        : (tipoEsposa?.inclui_alimentacao ? Math.max(0, Number(tipoEsposa?.quantidade_refeicoes ?? 0)) : 0);

      const esposaData = esposa as Record<string, unknown>;
      const esposaComorbidade = !!esposaData.hosp_possui_comorbidade;
      const esposaCamaInferiorAuto = resolveCamaInferiorAutomatica({
        sexo: 'F',
        data_nascimento: esposaData.data_nascimento ? String(esposaData.data_nascimento) : null,
        tipo_inscricao: tipoEsposa?.nome ?? 'Esposa de Pastor Presidente Campo Missionário',
        hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial,
        hosp_possui_comorbidade: esposaComorbidade,
      });
      const esposaGrupoAuto = resolveGrupoHospedagemAGO({
        sexo: 'F',
        data_nascimento: esposaData.data_nascimento ? String(esposaData.data_nascimento) : null,
        tipo_inscricao: tipoEsposa?.nome ?? 'Esposa de Pastor Presidente Campo Missionário',
        hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial,
        hosp_possui_comorbidade: esposaComorbidade,
      });
      const valorTotal2 = vFinal + valorEsposaBase;
      const isGratuito2 = valorTotal2 <= 0 || formaStr === 'isento';
      const codigoLote2 = 'LOTE-' + Date.now().toString(36).toUpperCase() + '-B';

      const { data: lote2, error: loteErr2 } = await supabase
        .from('evento_lotes_inscricao')
        .insert([normalizePayloadUppercase({
          evento_id:            eventoId,
          codigo:               codigoLote2,
          responsavel_nome:     String(nome_inscrito).trim(),
          responsavel_email:    email ? String(email).trim() : null,
          responsavel_whatsapp: whatsapp ? String(whatsapp).trim() : null,
          valor_total:          valorTotal2,
          status_pagamento:     isGratuito2 ? 'isento' : isPresencial ? 'pago' : 'pendente',
          cupom_codigo:         cupomCodigo,
          desconto_valor:       vDesconto,
        })])
        .select('id')
        .single();

      if (loteErr2 || !lote2) return NextResponse.json({ error: 'Erro ao criar lote casal.' }, { status: 500 });

      const rowPastor = normalizePayloadUppercase({
        evento_id: eventoId, lote_id: lote2.id,
        nome_inscrito: String(nome_inscrito).trim(),
        cpf: cpfLimpo || null, email: email ? String(email).trim() : null,
        whatsapp: whatsapp ? String(whatsapp).trim() : null,
        sexo: sexo || null, data_nascimento: data_nascimento || null,
        supervisao_id: supervisao_id || null, campo_id: campo_id || null,
        hospedagem: !!hospedagem, alimentacao: incluiAlimentacao, brinde: !!brinde,
        tipo_inscricao: tipoNome,
        valor_original: vOriginal, cupom_codigo: cupomCodigo, desconto_valor: vDesconto,
        valor_final: vFinal, valor_pago: isGratuito2 ? 0 : isPresencial ? vFinal : 0,
        status_pagamento: statusPag, forma_pagamento: formaPagSalva,
        refeicoes_total: quantidadeRefeicoes,
        refeicoes_utilizadas: 0,
        quantidade_refeicoes_total: quantidadeRefeicoes,
        quantidade_refeicoes_usadas: 0,
        quantidade_refeicoes_saldo: quantidadeRefeicoes,
        observacoes: observacoes ? String(observacoes).trim() : null,
        qr_code: qrFinal, operador_id: operadorId, ministro_snapshot: ministroSnapshot,
        operador_nome: dbOperadorNome,
        caixa_sessao_id: caixaSessaoId,
        origem: 'balcao',
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_descricao_necessidade: hosp_descricao_necessidade ? String(hosp_descricao_necessidade).trim() : null,
        hosp_cama_inferior: hospCamaInferiorAuto,
        hosp_observacoes: hosp_observacoes ? String(hosp_observacoes).trim() : null,
        hosp_possui_comorbidade: hospPossuiComorbidade,
        hosp_descricao_comorbidade: hospDescricaoComorbidade,
        grupo_hospedagem: grupoHospedagemAuto,
        lgpd_aceito: true, lgpd_aceito_em: new Date().toISOString(),
      });

      const rowEsposa = normalizePayloadUppercase({
        evento_id: eventoId, lote_id: lote2.id,
        nome_inscrito: String(esposaData.nome_inscrito ?? '').trim(),
        cpf: String(esposaData.cpf ?? '').replace(/\D/g, '') || null,
        whatsapp: esposaData.whatsapp ? String(esposaData.whatsapp).trim() : null,
        sexo: 'F', data_nascimento: esposaData.data_nascimento || null,
        supervisao_id: supervisao_id || null, campo_id: campo_id || null,
        hospedagem: !!esposaData.hospedagem, alimentacao: (evento as any).departamento === 'AGO' ? true : !!(tipoEsposa?.inclui_alimentacao), brinde: false,
        tipo_inscricao: tipoEsposa?.nome ?? 'Esposa de Pastor Presidente Campo Missionário',
        valor_original: valorEsposaBase, cupom_codigo: null, desconto_valor: 0,
        valor_final: valorEsposaBase, valor_pago: isGratuito2 ? 0 : isPresencial ? valorEsposaBase : 0,
        status_pagamento: statusPag, forma_pagamento: formaPagSalva,
        qr_code: esposaData.qr_code ? String(esposaData.qr_code) : generateQRCodeToken(),
        refeicoes_total: refeicoesEsposa,
        refeicoes_utilizadas: 0,
        quantidade_refeicoes_total: refeicoesEsposa,
        quantidade_refeicoes_usadas: 0,
        quantidade_refeicoes_saldo: refeicoesEsposa,
        operador_id: operadorId,
        operador_nome: dbOperadorNome,
        caixa_sessao_id: caixaSessaoId,
        origem: 'balcao',
        hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial,
        hosp_descricao_necessidade: esposaData.hosp_descricao_necessidade ? String(esposaData.hosp_descricao_necessidade).trim() : null,
        hosp_cama_inferior: esposaCamaInferiorAuto,
        hosp_observacoes: esposaData.hosp_observacoes ? String(esposaData.hosp_observacoes).trim() : null,
        hosp_possui_comorbidade: esposaComorbidade,
        hosp_descricao_comorbidade: esposaData.hosp_descricao_comorbidade ? String(esposaData.hosp_descricao_comorbidade).trim() : null,
        grupo_hospedagem: esposaGrupoAuto,
        lgpd_aceito: true, lgpd_aceito_em: new Date().toISOString(),
      });

      const { data: insRows, error: insErr2 } = await supabase
        .from('evento_inscricoes').insert([rowPastor, rowEsposa]).select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,hospedagem,alimentacao,brinde,qr_code,checkin_realizado');

      if (insErr2 || !insRows || insRows.length < 2) {
        return NextResponse.json({ error: 'Erro ao inserir inscrições do casal.' }, { status: 500 });
      }

      const [insPastor, insEsposa] = insRows as { id: string }[];

      await Promise.all([
        sincronizarFichaMembroPorInscricao(supabase, {
          cpf: cpfLimpo,
          email: email ? String(email).trim() : null,
          whatsapp: whatsapp ? String(whatsapp).trim() : null,
          campoId: campo_id ? String(campo_id) : null,
        }),
        sincronizarFichaMembroPorInscricao(supabase, {
          cpf: String(esposaData.cpf ?? '').replace(/\D/g, '') || null,
          email: null,
          whatsapp: esposaData.whatsapp ? String(esposaData.whatsapp).trim() : null,
          campoId: campo_id ? String(campo_id) : null,
        }),
      ]);

      // Hospedagem
      if (!!hospedagem) {
        const priorPastor = calcularPrioridadeHospedagem({ id: insPastor.id, nome_inscrito: String(nome_inscrito).trim(), sexo: sexo ? String(sexo) : null, data_nascimento: data_nascimento ? String(data_nascimento) : null, tipo_inscricao: tipo_inscricao ? String(tipo_inscricao) : null, hosp_necessidade_especial: !!hosp_necessidade_especial, hosp_descricao_necessidade: hosp_descricao_necessidade ? String(hosp_descricao_necessidade).trim() : null, hosp_cama_inferior: hospCamaInferiorAuto, hosp_observacoes: hosp_observacoes ? String(hosp_observacoes).trim() : null, hosp_possui_comorbidade: hospPossuiComorbidade, hosp_descricao_comorbidade: hospDescricaoComorbidade });
        await supabase.from('evento_hospedagens').insert([normalizePayloadUppercase({ evento_id: eventoId, inscricao_id: insPastor.id, status: 'solicitada', prioridade: priorPastor, necessidade_especial: !!hosp_necessidade_especial, descricao_necessidade: hosp_descricao_necessidade ? String(hosp_descricao_necessidade).trim() : null, cama_inferior: hospCamaInferiorAuto, observacoes: hosp_observacoes ? String(hosp_observacoes).trim() : null, grupo_hospedagem: grupoHospedagemAuto, alocacao_automatica: true })]);
      }
      if (!!esposaData.hospedagem) {
        const priorEsposa = calcularPrioridadeHospedagem({ id: insEsposa.id, nome_inscrito: String(esposaData.nome_inscrito ?? ''), sexo: 'F', data_nascimento: esposaData.data_nascimento ? String(esposaData.data_nascimento) : null, tipo_inscricao: 'Esposa de Pastor Presidente', hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial, hosp_descricao_necessidade: esposaData.hosp_descricao_necessidade ? String(esposaData.hosp_descricao_necessidade).trim() : null, hosp_cama_inferior: esposaCamaInferiorAuto, hosp_observacoes: esposaData.hosp_observacoes ? String(esposaData.hosp_observacoes).trim() : null, hosp_possui_comorbidade: esposaComorbidade, hosp_descricao_comorbidade: esposaData.hosp_descricao_comorbidade ? String(esposaData.hosp_descricao_comorbidade).trim() : null });
        await supabase.from('evento_hospedagens').insert([normalizePayloadUppercase({ evento_id: eventoId, inscricao_id: insEsposa.id, status: 'solicitada', prioridade: priorEsposa, necessidade_especial: !!esposaData.hosp_necessidade_especial, descricao_necessidade: esposaData.hosp_descricao_necessidade ? String(esposaData.hosp_descricao_necessidade).trim() : null, cama_inferior: esposaCamaInferiorAuto, observacoes: esposaData.hosp_observacoes ? String(esposaData.hosp_observacoes).trim() : null, grupo_hospedagem: esposaGrupoAuto, alocacao_automatica: true })]);
      }

      if (cupomCodigo) await incrementarCupom(supabase, eventoId, cupomCodigo);

      if (isAsaas) {
        try {
          const customerId2 = await createOrFindAsaasCustomer({ nome: String(nome_inscrito).trim(), email: email ? String(email).trim() : null, cpf: cleanCpf(cpfLimpo ?? ''), whatsapp: whatsapp ? String(whatsapp) : null });
          const dueDate2 = dueDateFromNow();
          const pagamento2 = await createEventoPayment({ customerId: customerId2, value: valorTotal2, dueDate: dueDate2, description: `Inscrição Casal CM Balcão — ${(evento as any).nome}`, externalReference: `lote:${lote2.id}` });
          await supabase.from('evento_lotes_inscricao').update({ asaas_payment_id: pagamento2.id, invoice_url: pagamento2.invoiceUrl, pix_copia_cola: pagamento2.pixCopiaECola, pix_qr_code: pagamento2.pixQrCode, asaas_due_date: dueDate2 }).eq('id', lote2.id);
          return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, inscricao: insRows[0], statusPagamento: 'aguardando_pagamento', pagamento: { invoiceUrl: pagamento2.invoiceUrl, pixCopiaECola: pagamento2.pixCopiaECola, valor: valorTotal2 } });
        } catch (asaasErr2) {
          console.error('[BALCAO CASAL ASAAS]', (asaasErr2 as Error).message);
          return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, inscricao: insRows[0], statusPagamento: 'pendente', pagamento: null, asaasError: 'Cobrança ASAAS não gerada.' });
        }
      }

      if ((statusPag as string) === 'pago' || (statusPag as string) === 'isento') {
        if ((evento as any).departamento === 'AGO') {
          if (!!hospedagem) {
            await alocarLeitoParaInscricao(supabase, insPastor.id);
          }
          if (!!esposaData.hospedagem) {
            await alocarLeitoParaInscricao(supabase, insEsposa.id);
          }
        }
      }

      return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, inscricao: insRows[0], statusPagamento: statusPag, pagamento: null });
    }

    // Monta payload
    const inscricaoPayload = normalizePayloadUppercase({
      evento_id:        eventoId,
      nome_inscrito:    String(nome_inscrito).trim(),
      cpf:              cpfLimpo || null,
      email:            email ? String(email).trim() : null,
      whatsapp:         whatsapp ? String(whatsapp).trim() : null,
      sexo:             sexo || null,
      data_nascimento:  data_nascimento || null,
      supervisao_id:    supervisao_id || null,
      campo_id:         campo_id || null,
      hospedagem:       !!hospedagem,
      alimentacao:      incluiAlimentacao,
      brinde:           !!brinde,
      tipo_inscricao:   tipoNome,
      equipe_apoio:     tipoNome === 'Equipe de Apoio' ? (equipe_apoio ? String(equipe_apoio).trim() : null) : null,
      valor_original:   vOriginal,
      cupom_codigo:     cupomCodigo,
      desconto_valor:   vDesconto,
      valor_final:      vFinal,
      valor_pago:       isGratuito ? 0 : isPresencial ? vFinal : 0,
      status_pagamento: statusPag,
      forma_pagamento:  formaPagSalva,
      refeicoes_total: quantidadeRefeicoes,
      refeicoes_utilizadas: 0,
      quantidade_refeicoes_total: quantidadeRefeicoes,
      quantidade_refeicoes_usadas: 0,
      quantidade_refeicoes_saldo: quantidadeRefeicoes,
      observacoes:      observacoes ? String(observacoes).trim() : null,
      qr_code:          qrFinal,
      operador_id:      operadorId,
      operador_nome:    dbOperadorNome,
      caixa_sessao_id:  caixaSessaoId,
      origem:           'balcao',
      ministro_snapshot: ministroSnapshot,
      hosp_necessidade_especial:  !!hosp_necessidade_especial,
      hosp_descricao_necessidade: hosp_descricao_necessidade
        ? String(hosp_descricao_necessidade).trim()
        : null,
      hosp_cama_inferior:  hospCamaInferiorAuto,
      hosp_observacoes:    hosp_observacoes ? String(hosp_observacoes).trim() : null,
      hosp_possui_comorbidade: hospPossuiComorbidade,
      hosp_descricao_comorbidade: hospDescricaoComorbidade,
      grupo_hospedagem:    grupoHospedagemAuto,
      lgpd_aceito:         true,
      lgpd_aceito_em:      new Date().toISOString(),
    });

    // Insere via service role (bypassa RLS)
    const { data: inscricao, error: insErr } = await supabase
      .from('evento_inscricoes')
      .insert([inscricaoPayload])
      .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,hospedagem,alimentacao,brinde,qr_code,checkin_realizado')
      .single();

    if (insErr || !inscricao) {
      console.error('[BALCAO] Erro ao inserir inscrição:', insErr);
      return NextResponse.json({
        error: 'Erro ao salvar inscrição.',
        stage: 'insert_evento_inscricoes',
        details: insErr?.message ?? 'sem detalhes',
        code: insErr?.code ?? null,
        hint: insErr?.hint ?? null,
      }, { status: 500 });
    }

    const inscricaoId = (inscricao as any).id as string;

    await sincronizarFichaMembroPorInscricao(supabase, {
      cpf: cpfLimpo,
      email: email ? String(email).trim() : null,
      whatsapp: whatsapp ? String(whatsapp).trim() : null,
      campoId: campo_id ? String(campo_id) : null,
    });

    // Incrementa cupom
    if (cupomCodigo) {
      await incrementarCupom(supabase, eventoId, cupomCodigo);
    }

    // Hospedagem AGO
    if (!!hospedagem && (evento as any).departamento === 'AGO') {
      const prioridade = calcularPrioridadeHospedagem({
        id:                         inscricaoId,
        nome_inscrito:              String(nome_inscrito).trim(),
        sexo:                       sexo ? String(sexo) : null,
        data_nascimento:            data_nascimento ? String(data_nascimento) : null,
        tipo_inscricao:             tipoNome,
        hosp_necessidade_especial:  !!hosp_necessidade_especial,
        hosp_descricao_necessidade: hosp_descricao_necessidade
          ? String(hosp_descricao_necessidade).trim()
          : null,
        hosp_cama_inferior: hospCamaInferiorAuto,
        hosp_observacoes:   hosp_observacoes ? String(hosp_observacoes).trim() : null,
        hosp_possui_comorbidade: hospPossuiComorbidade,
        hosp_descricao_comorbidade: hospDescricaoComorbidade,
      });
      await supabase.from('evento_hospedagens').insert([
        normalizePayloadUppercase({
          evento_id:            eventoId,
          inscricao_id:         inscricaoId,
          status:               'solicitada',
          prioridade,
          necessidade_especial: !!hosp_necessidade_especial,
          descricao_necessidade: hosp_descricao_necessidade
            ? String(hosp_descricao_necessidade).trim()
            : null,
          cama_inferior:  hospCamaInferiorAuto,
          observacoes:    hosp_observacoes ? String(hosp_observacoes).trim() : null,
          grupo_hospedagem: grupoHospedagemAuto,
          alocacao_automatica: true,
        }),
      ]);
    }

    // Auditoria (fire-and-forget)
    void logDB({
      userId:      operadorId,
      userEmail:   operadorEmail,
      acao:        'criar_inscricao_balcao',
      modulo:      'eventos',
      entidade:    'evento_inscricoes',
      entidadeId:  inscricaoId,
      descricao:   `[Balcão] Nova inscrição: ${String(nome_inscrito).trim()} — ${(evento as any).nome}`,
      detalhes: {
        evento_id:        eventoId,
        forma_pagamento:  formaStr,
        valor_final:      vFinal,
        status_pagamento: statusPag,
        operador_id:      operadorId,
        categoria_esposa_jubilado_manual_sem_vinculo: esposaJubiladoManualSemVinculo,
        conjuge_jubilado_vinculado_por_cpf: !!vinculoEsposaJubiladoTitular,
      },
      request,
    });

    if (esposaJubiladoManualSemVinculo) {
      void logDB({
        userId: operadorId,
        userEmail: operadorEmail,
        acao: 'aplicar_esposa_jubilado_manual_balcao',
        modulo: 'eventos',
        entidade: 'evento_inscricoes',
        entidadeId: inscricaoId,
        descricao: `[Balcão] Categoria Esposa de Pastor Jubilado aplicada manualmente sem vínculo automático de cpf_conjuge.`,
        detalhes: {
          evento_id: eventoId,
          inscricao_id: inscricaoId,
          cpf_informado: cpfLimpo,
          tipo_inscricao: tipoNome,
          operador_id: operadorId,
          motivo: 'validacao_humana_balcao_sem_vinculo_automatico',
        },
        request,
      });
    }

    // ASAAS: cria cobrança
    if (isAsaas) {
      try {
        const customerId = await createOrFindAsaasCustomer({
          nome:     String(nome_inscrito).trim(),
          email:    email ? String(email).trim() : null,
          cpf:      cleanCpf(cpfLimpo ?? ''),
          whatsapp: whatsapp ? String(whatsapp) : null,
        });

        const pagamento = await createEventoPayment({
          customerId,
          value:             vFinal,
          dueDate:           dueDateFromNow(),
          description:       `Inscrição Balcão — ${(evento as any).nome}${tipoNome ? ` (${tipoNome})` : ''}`,
          externalReference: inscricaoId,
        });

        await supabase
          .from('evento_inscricoes')
          .update({
            asaas_payment_id: pagamento.id,
            forma_pagamento:  'pix',
            invoice_url:      pagamento.invoiceUrl,
            pix_copia_cola:   pagamento.pixCopiaECola,
            pix_qr_code:      pagamento.pixQrCode,
            asaas_due_date:   dueDateFromNow(),
          })
          .eq('id', inscricaoId);

        return NextResponse.json({
          inscricaoId,
          inscricao,
          statusPagamento: 'aguardando_pagamento',
          pagamento: {
            invoiceUrl:    pagamento.invoiceUrl,
            pixCopiaECola: pagamento.pixCopiaECola,
            valor:         vFinal,
          },
        });
      } catch (asaasErr) {
        const msg = asaasErr instanceof Error ? asaasErr.message : String(asaasErr);
        console.error('[BALCAO ASAAS] Erro ao criar cobrança:', msg);
        return NextResponse.json({
          inscricaoId,
          inscricao,
          statusPagamento: 'pendente',
          pagamento:       null,
          asaasError:      'Cobrança ASAAS não gerada. Use outra forma de pagamento.',
        });
      }
    }

    if ((statusPag as string) === 'pago' || (statusPag as string) === 'isento') {
      if ((evento as any).departamento === 'AGO' && !!hospedagem) {
        await alocarLeitoParaInscricao(supabase, inscricaoId);
      }
    }

    return NextResponse.json({
      inscricaoId,
      inscricao,
      statusPagamento: statusPag,
      pagamento:       null,
    });
  } catch (err) {
    console.error('[BALCAO] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro inesperado no servidor.' }, { status: 500 });
  }
}
