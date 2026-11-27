'use client';

export const dynamic = 'force-dynamic';

import { use, useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Shield,
  Sparkles,
  Calendar,
  Building2,
  MapPin,
  Clock,
} from 'lucide-react';

export default function ValidarCredencialUmadespaPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const [loading, setLoading] = useState(true);
  const [autentico, setAutentico] = useState(false);
  const [dados, setDados] = useState<any | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    async function validar() {
      setLoading(true);
      try {
        const res = await fetch(`/api/public/umadespa/validar-credencial/${codigo}`);
        const json = await res.json();
        if (res.ok && json.autentico) {
          setAutentico(true);
          setDados(json.registro);
        } else {
          setAutentico(false);
          setErro(json.error || 'Credencial não localizada ou inválida.');
        }
      } catch {
        setAutentico(false);
        setErro('Falha de conexão com os servidores de validação.');
      } finally {
        setLoading(false);
      }
    }
    validar();
  }, [codigo]);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Banner Superior Verde Institucional */}
        <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-6 text-center relative">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-white/10 text-emerald-100 border border-white/20 mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            COMIEADEPA — UMADESPA
          </div>
          <h1 className="text-xl font-black uppercase tracking-tight">
            Validação de Credencial
          </h1>
          <p className="text-xs text-emerald-100/80 mt-1">
            Sistema Oficial de Verificação de Autenticidade da Juventude
          </p>
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-emerald-500 border-t-transparent" />
            <p className="mt-4 text-xs font-semibold text-slate-700 dark:text-slate-300">
              Consultando registro oficial...
            </p>
          </div>
        ) : autentico && dados ? (
          <div className="p-6 space-y-5">
            {/* Selo de Autenticidade */}
            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-200 uppercase">
                  Credencial Oficial Autêntica
                </h4>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  Registro regularizado no banco de dados da convenção.
                </p>
              </div>
            </div>

            {/* Foto e Nome */}
            <div className="flex items-center gap-4">
              {dados.fotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={dados.fotoUrl}
                  alt={dados.nome}
                  className="w-16 h-20 rounded-xl object-cover border-2 border-emerald-600 shadow-xs shrink-0"
                />
              ) : (
                <div className="w-16 h-20 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-black text-xl shrink-0">
                  {dados.nome.charAt(0)}
                </div>
              )}
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
                  {dados.nome}
                </h3>
                <div className="inline-flex items-center gap-1 mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <Shield className="w-3.5 h-3.5" />
                  {dados.funcao}
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 font-mono">
                  Registro: {dados.numero}
                </p>
              </div>
            </div>

            {/* Detalhes Eclesiásticos */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 space-y-2 text-xs text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>Campo:</strong> {dados.campo}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>Supervisão:</strong> {dados.supervisao}
                </span>
              </div>
              {dados.congregacao && (
                <div className="flex items-center gap-2">
                  <span className="w-4 inline-block text-center font-bold text-emerald-600">•</span>
                  <span>
                    <strong>Congregação:</strong> {dados.congregacao}
                  </span>
                </div>
              )}
            </div>

            {/* Validade e Situação */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <span className="block text-[10px] uppercase font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Validade Oficial ({dados.via}ª Via)
                </span>
                <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                  {dados.validade
                    ? new Date(`${dados.validade}T12:00:00`).toLocaleDateString('pt-BR')
                    : 'Aguardando Emissão'}
                </span>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <span className="block text-[10px] uppercase font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Situação
                </span>
                <span
                  className={`font-semibold capitalize flex items-center gap-1 ${
                    dados.situacaoCredencial === 'valida'
                      ? 'text-emerald-600'
                      : dados.situacaoCredencial === 'cancelada' || dados.situacaoCredencial === 'substituida'
                      ? 'text-red-600'
                      : 'text-amber-600'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  {dados.situacaoCredencial === 'valida'
                    ? 'Ativa / Válida'
                    : dados.situacaoCredencial === 'substituida'
                    ? 'Via Substituída'
                    : dados.situacaoCredencial === 'cancelada'
                    ? 'Cancelada'
                    : dados.situacaoCredencial === 'aguardando_emissao'
                    ? 'Aguardando Emissão'
                    : 'Expirada / Em Renovação'}
                </span>
              </div>
            </div>

            <p className="text-[10px] text-center text-slate-700 dark:text-slate-300 pt-2 border-t border-slate-200 dark:border-slate-800">
              Consulta pública estrita protegida pelas diretrizes da Lei Geral de Proteção de Dados (LGPD).
            </p>
          </div>
        ) : (
          <div className="p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
              <XCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Registro Não Localizado
              </h3>
              <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 max-w-xs mx-auto">
                {erro || 'O código informado não corresponde a uma credencial válida no sistema oficial da UMADESPA.'}
              </p>
            </div>
            <p className="text-[11px] text-slate-700 dark:text-slate-300 pt-3 border-t border-slate-200 dark:border-slate-800">
              Em caso de dúvidas, procure a Secretaria Geral da COMIEADEPA.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
