'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { CheckCircle2, XCircle, Clock, ShieldCheck } from 'lucide-react';

interface ValidationResult {
  valid: boolean;
  statusCredencial: 'ativa' | 'vencida' | 'pendente';
  nome: string;
  matricula: string | null;
  cargo: string | null;
  statusMembro: string;
  dataValidade: string | null;
  fotoUrl: string | null;
  error?: string;
}

const fmtDate = (v: string | null) => {
  if (!v) return '—';
  const d = new Date(v + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

export default function ValidarCredencialPage() {
  const params = useParams();
  const token = params?.token as string;
  const [data, setData] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [httpError, setHttpError] = useState(false);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch(`/api/validar-credencial/${token}`)
      .then(async (r) => {
        const json = await r.json();
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setHttpError(true);
        setLoading(false);
      });
  }, [token]);

  const isValid = data?.valid === true;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-white flex flex-col items-center justify-start px-4 py-10">
      {/* Header */}
      <div className="text-center mb-8">
        <Image
          src="/img/logo_comieadepa.png"
          alt="COMIEADEPA"
          width={80}
          height={80}
          className="mx-auto mb-3 drop-shadow"
          priority
        />
        <p className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
          Validação de Credencial
        </p>
        <p className="text-xs text-gray-400 mt-0.5">COMIEADEPA — SISCOMIEADEPA</p>
      </div>

      <div className="w-full max-w-md">
        {loading && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
            <ShieldCheck size={40} className="mx-auto mb-3 text-gray-300 animate-pulse" />
            <p className="text-gray-500">Verificando credencial...</p>
          </div>
        )}

        {!loading && (httpError || !data) && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
            <XCircle size={40} className="mx-auto mb-3 text-red-400" />
            <p className="text-red-700 font-semibold">Não foi possível verificar a credencial.</p>
            <p className="text-red-500 text-sm mt-1">Tente novamente mais tarde.</p>
          </div>
        )}

        {!loading && data && (
          <div
            className={`rounded-2xl border-2 overflow-hidden shadow-lg ${
              isValid ? 'border-green-400' : 'border-red-400'
            }`}
          >
            {/* Banner de status */}
            <div
              className={`px-6 py-4 flex items-center gap-3 ${
                isValid ? 'bg-green-600' : 'bg-red-600'
              }`}
            >
              {isValid ? (
                <CheckCircle2 size={28} className="text-white flex-shrink-0" />
              ) : data.statusCredencial === 'vencida' ? (
                <Clock size={28} className="text-white flex-shrink-0" />
              ) : (
                <XCircle size={28} className="text-white flex-shrink-0" />
              )}
              <div>
                <p className="text-white font-bold text-lg leading-tight">
                  {isValid ? 'CREDENCIAL VÁLIDA' : 'CREDENCIAL INVÁLIDA'}
                </p>
                <p className="text-white/80 text-sm">
                  {data.statusCredencial === 'ativa' && 'Ministro com credencial em dia'}
                  {data.statusCredencial === 'vencida' && 'Credencial com validade expirada'}
                  {data.statusCredencial === 'pendente' && 'Credencial não emitida'}
                </p>
              </div>
            </div>

            {/* Conteúdo */}
            <div className="bg-white p-6">
              {/* Foto */}
              {data.fotoUrl && (
                <div className="flex justify-center mb-5">
                  <img
                    src={data.fotoUrl}
                    alt={data.nome}
                    className="w-24 h-24 rounded-full object-cover border-4 border-gray-200 shadow"
                  />
                </div>
              )}

              <div className="space-y-4">
                <div className="border-b border-gray-100 pb-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Ministro</p>
                  <p className="font-bold text-gray-900 text-xl">{data.nome}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {data.matricula && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Matrícula</p>
                      <p className="font-semibold text-gray-800">{data.matricula}</p>
                    </div>
                  )}
                  {data.cargo && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Cargo</p>
                      <p className="font-semibold text-gray-800">{data.cargo}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Status</p>
                    <p
                      className={`font-semibold ${
                        isValid ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {data.statusCredencial === 'ativa'
                        ? 'Ativa'
                        : data.statusCredencial === 'vencida'
                        ? 'Vencida'
                        : 'Pendente'}
                    </p>
                  </div>
                  {data.dataValidade && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Validade</p>
                      <p
                        className={`font-semibold ${
                          isValid ? 'text-gray-800' : 'text-red-700'
                        }`}
                      >
                        {fmtDate(data.dataValidade)}
                      </p>
                    </div>
                  )}
                </div>

                {!isValid && (
                  <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
                    <p className="text-sm font-semibold text-red-700">⚠ Credencial não válida</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {data.statusCredencial === 'vencida'
                        ? 'Esta credencial está vencida. O ministro deve regularizar com a secretaria da sua supervisão.'
                        : 'Esta credencial está pendente de emissão ou não foi encontrada.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-gray-400 text-xs mt-8">
          COMIEADEPA — SISCOMIEADEPA © {new Date().getFullYear()}
          <br />
          Esta página é gerada automaticamente. Não edite a URL.
        </p>
      </div>
    </div>
  );
}
