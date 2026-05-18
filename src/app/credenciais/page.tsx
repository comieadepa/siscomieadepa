'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import PageLayout from '@/components/PageLayout';
import CartaoMembro from '@/components/CartãoMembro';
import { authenticatedFetch } from '@/lib/api-client';
import type { Member } from '@/types/supabase';

type CredencialEmitida = {
  id: string;
  created_at: string | null;
  printed_count: number | null;
  member: Member | null;
};

type Filtros = {
  search: string;
  status: string;
  tipoCadastro: string;
  from: string;
  to: string;
};

type Membro = Record<string, any>;

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  deceased: 'Falecido',
  transferred: 'Transferido',
};

const TIPO_LABEL: Record<string, string> = {
  membro: 'Membro',
  congregado: 'Congregado',
  ministro: 'Ministro',
  crianca: 'Crianca',
  funcionario: 'Funcionario',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const dia = String(parsed.getDate()).padStart(2, '0');
  const mes = String(parsed.getMonth() + 1).padStart(2, '0');
  const ano = parsed.getFullYear();
  const horas = String(parsed.getHours()).padStart(2, '0');
  const minutos = String(parsed.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${ano} ${horas}:${minutos}`;
};

const normalizeTipoCadastro = (value: any): 'membro' | 'congregado' | 'ministro' | 'crianca' | 'funcionario' => {
  const v = String(value || '').toLowerCase();
  if (v === 'membro' || v === 'congregado' || v === 'ministro' || v === 'crianca' || v === 'funcionario') return v as any;
  return 'membro';
};

const resolveStatusFromMember = (member: Member): string => {
  const tc = String(member.tipo_cadastro || '').toUpperCase().trim();
  if (tc.includes('FALECIDO')) return 'falecido';
  if (tc.includes('DESLIGADO')) return 'desligado';
  if (tc === 'EM PROCESSO') return 'em_processo';
  if (tc === 'SUSPENSO' || tc === 'INATIVO' || tc === 'LICENCIADO' || tc === 'DISPONIBILIDADE' || tc === 'ARQUIVO MORTO') return 'inativo';
  if (member.status === 'active') return 'ativo';
  if (member.status === 'deceased') return 'falecido';
  if (member.status === 'transferred') return 'desligado';
  return 'inativo';
};

const memberToMembro = (member: Member): Membro => {
  const cf = (member.custom_fields && typeof member.custom_fields === 'object') ? member.custom_fields : {};
  const cargoMinisterial = String(
    (cf as any).cargoMinisterial ||
    (cf as any).cargo_ministerial ||
    member.cargo_ministerial ||
    member.profissao ||
    ''
  );
  const stableUniqueId =
    member.unique_id ||
    (typeof (cf as any).uniqueId === 'string' && String((cf as any).uniqueId).length >= 8
      ? String((cf as any).uniqueId)
      : String(member.id || '').replace(/-/g, '').slice(0, 16).toUpperCase());

  return {
    ...(cf as any),
    id: member.id,
    uniqueId: stableUniqueId,
    matricula: String(member.matricula || (cf as any).matricula || ''),
    nome: String(member.name || (cf as any).nome || ''),
    cpf: String(member.cpf || (cf as any).cpf || ''),
    tipoCadastro: normalizeTipoCadastro(member.tipo_cadastro || member.role || (cf as any).tipoCadastro),
    status: resolveStatusFromMember(member),
    cargoMinisterial,
    supervisao: String((cf as any).supervisao || ''),
    campo: String((cf as any).campo || ''),
    congregacao: String((cf as any).congregacao || ''),
    dataNascimento: String(member.data_nascimento || (cf as any).dataNascimento || ''),
    sexo: String(member.sexo || (cf as any).sexo || ''),
    tipoSanguineo: String(member.tipo_sanguineo || (cf as any).tipoSanguineo || ''),
    estadoCivil: String(member.estado_civil || (cf as any).estadoCivil || ''),
    nomePai: String(member.nome_pai || (cf as any).nomePai || ''),
    nomeMae: String(member.nome_mae || (cf as any).nomeMae || ''),
    naturalidade: String(member.naturalidade || (cf as any).naturalidade || ''),
    nacionalidade: String(member.nacionalidade || (cf as any).nacionalidade || ''),
    dataBatismoAguas: String(member.data_batismo_aguas || (cf as any).dataBatismoAguas || ''),
    dataBatismoEspiritoSanto: String(member.data_batismo_espirito_santo || (cf as any).dataBatismoEspiritoSanto || ''),
    email: String(member.email || (cf as any).email || ''),
    celular: String(member.celular || member.phone || (cf as any).celular || ''),
    whatsapp: String(member.whatsapp || (cf as any).whatsapp || ''),
    logradouro: String(member.logradouro || (cf as any).logradouro || ''),
    numero: String(member.numero || (cf as any).numero || ''),
    bairro: String(member.bairro || (cf as any).bairro || ''),
    cidade: String(member.cidade || (cf as any).cidade || ''),
    dataConsagracao: String(member.data_consagracao || (cf as any).dataConsagracao || ''),
    dataEmissao: String(member.data_emissao || (cf as any).dataEmissao || ''),
    dataValidadeCredencial: String(member.data_validade_credencial || member.cred_validade || (cf as any).dataValidadeCredencial || ''),
    qualFuncao: String(member.qual_funcao || member.profissao || (cf as any).qualFuncao || ''),
    fotoUrl: member.foto_url || (cf as any).fotoUrl || undefined,
  };
};

export default function CredenciaisEmitidasPage() {
  const [filtros, setFiltros] = useState<Filtros>({
    search: '',
    status: '',
    tipoCadastro: '',
    from: '',
    to: '',
  });
  const [applied, setApplied] = useState<Filtros>(filtros);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<CredencialEmitida[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [membroImprimindoCartao, setMembroImprimindoCartao] = useState<Membro | null>(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);

  const fetchCredenciais = async () => {
    try {
      setLoading(true);
      setError('');

      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (applied.search) params.set('search', applied.search);
      if (applied.status) params.set('status', applied.status);
      if (applied.tipoCadastro) params.set('tipoCadastro', applied.tipoCadastro);
      if (applied.from) params.set('from', applied.from);
      if (applied.to) params.set('to', applied.to);

      const res = await authenticatedFetch(`/api/credenciais/emitidas?${params.toString()}`);
      const json = await res.json().catch(() => null as any);

      if (!res.ok) {
        const msg = json?.error || 'Erro ao carregar credenciais.';
        setError(String(msg));
        setItems([]);
        setTotal(0);
        return;
      }

      setItems(Array.isArray(json?.data) ? json.data : []);
      setTotal(Number(json?.pagination?.total || 0));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado.';
      setError(msg);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredenciais();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, applied]);

  const onApply = () => {
    setPage(1);
    setApplied({ ...filtros });
  };

  const onClear = () => {
    const clean: Filtros = { search: '', status: '', tipoCadastro: '', from: '', to: '' };
    setFiltros(clean);
    setApplied(clean);
    setPage(1);
  };

  return (
    <PageLayout
      title="Credenciais emitidas"
      description="Consulta, filtros e reimpressao de credenciais ja emitidas."
      activeMenu="secretaria"
    >
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-gray-600">Busca</label>
            <input
              type="text"
              value={filtros.search}
              onChange={(e) => setFiltros((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Nome, CPF, matricula ou ID"
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">Status</label>
            <select
              value={filtros.status}
              onChange={(e) => setFiltros((prev) => ({ ...prev, status: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Todos</option>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
              <option value="deceased">Falecido</option>
              <option value="transferred">Transferido</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">Tipo</label>
            <select
              value={filtros.tipoCadastro}
              onChange={(e) => setFiltros((prev) => ({ ...prev, tipoCadastro: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Todos</option>
              <option value="membro">Membro</option>
              <option value="congregado">Congregado</option>
              <option value="ministro">Ministro</option>
              <option value="crianca">Crianca</option>
              <option value="funcionario">Funcionario</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">De</label>
            <input
              type="date"
              value={filtros.from}
              onChange={(e) => setFiltros((prev) => ({ ...prev, from: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600">Ate</label>
            <input
              type="date"
              value={filtros.to}
              onChange={(e) => setFiltros((prev) => ({ ...prev, to: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end mt-4">
          <button
            onClick={onClear}
            className="px-4 py-2 text-sm font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Limpar
          </button>
          <button
            onClick={onApply}
            className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex flex-wrap gap-3 items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Credenciais emitidas</h2>
            <p className="text-xs text-gray-500">Total: {total}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Por pagina</span>
            <select
              value={limit}
              onChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(1); }}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-gray-500">Carregando...</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">Nenhuma credencial encontrada.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">Nome</th>
                  <th className="text-left font-semibold px-4 py-3">Matricula</th>
                  <th className="text-left font-semibold px-4 py-3">CPF</th>
                  <th className="text-left font-semibold px-4 py-3">Tipo</th>
                  <th className="text-left font-semibold px-4 py-3">Status</th>
                  <th className="text-left font-semibold px-4 py-3">Emitida em</th>
                  <th className="text-left font-semibold px-4 py-3">Impressoes</th>
                  <th className="text-left font-semibold px-4 py-3">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => {
                  const member = item.member;
                  const nome = member?.name || (member as any)?.nome || '—';
                  const cpf = member?.cpf || '—';
                  const matricula = member?.matricula || '—';
                  const tipoRaw = String(member?.tipo_cadastro || '').toLowerCase();
                  const tipoLabel = TIPO_LABEL[tipoRaw] || (tipoRaw ? tipoRaw : '—');
                  const statusRaw = String(member?.status || '').toLowerCase();
                  const statusLabel = STATUS_LABEL[statusRaw] || (statusRaw ? statusRaw : '—');

                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{nome}</td>
                      <td className="px-4 py-3 text-gray-700">{matricula}</td>
                      <td className="px-4 py-3 text-gray-700">{cpf}</td>
                      <td className="px-4 py-3 text-gray-700">{tipoLabel}</td>
                      <td className="px-4 py-3 text-gray-700">{statusLabel}</td>
                      <td className="px-4 py-3 text-gray-700">{formatDateTime(item.created_at)}</td>
                      <td className="px-4 py-3 text-gray-700">{item.printed_count ?? 0}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => member && setMembroImprimindoCartao(memberToMembro(member))}
                          disabled={!member}
                          className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60"
                        >
                          Reimprimir
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between p-4 border-t border-gray-200 text-sm text-gray-600">
          <span>
            Pagina {page} de {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-60"
            >
              Proxima
            </button>
          </div>
        </div>
      </div>

      {membroImprimindoCartao && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <CartaoMembro
            membro={membroImprimindoCartao as any}
            onClose={() => setMembroImprimindoCartao(null)}
            registroAction="reimprimir"
          />
        </div>
      )}
    </PageLayout>
  );
}
