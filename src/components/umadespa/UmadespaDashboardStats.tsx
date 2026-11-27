import { Users, Shield, Clock, CheckCircle2 } from 'lucide-react';

interface UmadespaDashboardStatsProps {
  totalAssociados: number;
  totalLiderancas: number;
  pedidosPendentes: number;
  pedidosEmitidos: number;
}

export function UmadespaDashboardStats({
  totalAssociados,
  totalLiderancas,
  pedidosPendentes,
  pedidosEmitidos,
}: UmadespaDashboardStatsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Jovens Cadastrados */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <Users className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Jovens e Líderes
          </p>
          <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {totalAssociados}
          </h3>
          <p className="text-xs text-slate-700 dark:text-slate-300">Membros cadastrados</p>
        </div>
      </div>

      {/* Lideranças Ativas */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-700 dark:text-emerald-300">
          <Shield className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Liderança UMADESPA
          </p>
          <h3 className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
            {totalLiderancas}
          </h3>
          <p className="text-xs text-slate-700 dark:text-slate-300">Coordenadores e Líderes</p>
        </div>
      </div>

      {/* Carteirinhas Pendentes */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
          <Clock className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Carteirinhas em Fila
          </p>
          <h3 className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {pedidosPendentes}
          </h3>
          <p className="text-xs text-slate-700 dark:text-slate-300">Aguardando / Impressão</p>
        </div>
      </div>

      {/* Carteirinhas Emitidas / Entregues */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-teal-50 dark:bg-teal-950/40 flex items-center justify-center text-teal-600 dark:text-teal-400">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Carteirinhas Entregues
          </p>
          <h3 className="text-2xl font-bold text-teal-600 dark:text-teal-400">
            {pedidosEmitidos}
          </h3>
          <p className="text-xs text-slate-700 dark:text-slate-300">Entregues com sucesso</p>
        </div>
      </div>
    </div>
  );
}
