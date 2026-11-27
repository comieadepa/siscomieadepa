import { useRef } from 'react';
import { Sparkles, Printer, X } from 'lucide-react';

export interface FichaUmadespaProps {
  associado: {
    id: string;
    nome: string;
    cpf: string;
    rg?: string | null;
    orgao_emissor?: string | null;
    data_nascimento: string;
    sexo: string;
    nacionalidade?: string | null;
    naturalidade?: string | null;
    tipo_sanguineo?: string | null;
    nome_pai?: string | null;
    nome_mae?: string | null;
    titulo_eleitoral?: string | null;
    fone?: string | null;
    email?: string | null;
    foto_url?: string | null;
    funcao: string;
    is_lideranca: boolean;
    cargo_detalhe?: string | null;
    menor_idade: boolean;
    responsavel_nome?: string | null;
    responsavel_cpf?: string | null;
    responsavel_fone?: string | null;
    status: string;
    supervisao?: { nome: string; codigo?: number } | null;
    campo?: { nome: string } | null;
    congregacao?: { nome: string } | null;
    created_at?: string;
  };
  onClose: () => void;
}

export function FichaCadastralUmadespa({ associado, onClose }: FichaUmadespaProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const fmt = (v?: string | null) => v || '—';
  const fmtDate = (v?: string | null) => {
    if (!v) return '—';
    const d = new Date(v + (v.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString('pt-BR');
  };

  const handlePrint = () => {
    if (!printRef.current) {
      window.print();
      return;
    }
    const printWin = window.open('', '_blank', 'height=1100,width=850');
    if (!printWin) {
      window.print();
      return;
    }

    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Ficha Cadastral UMADESPA — ${associado.nome}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #fff; color: #1e293b; font-size: 11pt; line-height: 1.4; }
    .sheet { padding: 10px; }
    .header { text-align: center; border-bottom: 2px solid #047857; padding-bottom: 12px; margin-bottom: 16px; }
    .title { font-size: 15pt; font-weight: 800; color: #047857; text-transform: uppercase; margin-bottom: 2px; }
    .subtitle { font-size: 9pt; font-weight: 600; color: #475569; }
    .sec-title { font-size: 10pt; font-weight: 800; color: #047857; text-transform: uppercase; margin: 12px 0 6px 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
    .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 8px; margin-bottom: 8px; }
    .col-3 { grid-column: span 3; }
    .col-4 { grid-column: span 4; }
    .col-6 { grid-column: span 6; }
    .col-8 { grid-column: span 8; }
    .col-12 { grid-column: span 12; }
    .field { border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 6px; }
    .label { font-size: 7.5pt; font-weight: 700; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 2px; }
    .value { font-size: 9.5pt; font-weight: 600; color: #0f172a; }
    .photo-box { width: 100px; height: 130px; border: 1px solid #047857; object-fit: cover; border-radius: 4px; float: right; margin-left: 10px; }
    .footer { margin-top: 30px; text-align: center; font-size: 8pt; color: #64748b; border-top: 1px solid #cbd5e1; padding-top: 8px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }
    .sign-line { border-top: 1px solid #0f172a; margin-top: 40px; padding-top: 4px; font-size: 8.5pt; font-weight: 600; }
  </style>
</head>
<body>
  <div class="sheet">
    ${printRef.current.innerHTML}
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); window.close(); }, 350);
    };
  </script>
</body>
</html>`);
    printWin.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-3xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl relative animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Ficha Cadastral Oficial — UMADESPA
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
            >
              <Printer className="w-4 h-4" />
              Imprimir Ficha (A4)
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-700 dark:text-slate-300 hover:text-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Conteúdo Renderizável para Impressão */}
        <div ref={printRef} className="p-4 bg-white text-slate-900 text-sm">
          {/* Cabeçalho */}
          <div className="text-center border-b-2 border-emerald-700 pb-3 mb-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
              Convenção Interestadual de Ministros e Igrejas Evangélicas Assembleias de Deus no Estado do Pará (COMIEADEPA)
            </p>
            <h2 className="text-xl font-extrabold text-emerald-800 uppercase tracking-tight">
              UMADESPA — União de Mocidade
            </h2>
            <p className="text-xs font-semibold text-slate-700">
              Ficha Cadastral e Eclesiástica do Jovem / Membro
            </p>
          </div>

          {/* Foto e Dados Básicos */}
          <div className="flex gap-4 mb-4">
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 border border-slate-200 rounded">
                  <span className="block text-[10px] font-bold text-slate-700 uppercase">Nome Completo</span>
                  <span className="font-bold text-sm text-slate-900">{associado.nome}</span>
                </div>
                <div className="p-2 border border-slate-200 rounded">
                  <span className="block text-[10px] font-bold text-slate-700 uppercase">CPF</span>
                  <span className="font-semibold text-sm text-slate-900">{associado.cpf}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 border border-slate-200 rounded">
                  <span className="block text-[10px] font-bold text-slate-700 uppercase">Nascimento</span>
                  <span className="font-medium text-xs text-slate-900">{fmtDate(associado.data_nascimento)}</span>
                </div>
                <div className="p-2 border border-slate-200 rounded">
                  <span className="block text-[10px] font-bold text-slate-700 uppercase">Sexo</span>
                  <span className="font-medium text-xs text-slate-900">{associado.sexo}</span>
                </div>
                <div className="p-2 border border-slate-200 rounded">
                  <span className="block text-[10px] font-bold text-slate-700 uppercase">Função</span>
                  <span className="font-bold text-xs text-emerald-800">{associado.funcao}</span>
                </div>
              </div>
            </div>

            {associado.foto_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={associado.foto_url}
                alt={associado.nome}
                className="w-24 h-32 object-cover border-2 border-emerald-600 rounded shrink-0"
              />
            )}
          </div>

          {/* Vínculo Eclesiástico */}
          <div className="mb-4">
            <h4 className="text-xs font-bold uppercase text-emerald-800 border-b border-slate-300 pb-1 mb-2">
              Vínculo Eclesiástico
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 border border-slate-200 rounded">
                <span className="block text-[10px] font-bold text-slate-700 uppercase">Supervisão</span>
                <span className="font-medium text-xs text-slate-900">{fmt(associado.supervisao?.nome)}</span>
              </div>
              <div className="p-2 border border-slate-200 rounded">
                <span className="block text-[10px] font-bold text-slate-700 uppercase">Campo</span>
                <span className="font-medium text-xs text-slate-900">{fmt(associado.campo?.nome)}</span>
              </div>
              <div className="p-2 border border-slate-200 rounded">
                <span className="block text-[10px] font-bold text-slate-700 uppercase">Congregação</span>
                <span className="font-medium text-xs text-slate-900">{fmt(associado.congregacao?.nome)}</span>
              </div>
            </div>
          </div>

          {/* Contato & Documentos */}
          <div className="mb-4">
            <h4 className="text-xs font-bold uppercase text-emerald-800 border-b border-slate-300 pb-1 mb-2">
              Contato & Documentação
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 border border-slate-200 rounded">
                <span className="block text-[10px] font-bold text-slate-700 uppercase">Telefone</span>
                <span className="font-medium text-xs text-slate-900">{fmt(associado.fone)}</span>
              </div>
              <div className="p-2 border border-slate-200 rounded col-span-2">
                <span className="block text-[10px] font-bold text-slate-700 uppercase">E-mail</span>
                <span className="font-medium text-xs text-slate-900">{fmt(associado.email)}</span>
              </div>
            </div>
          </div>

          {/* Responsável Legal (se menor) */}
          {associado.menor_idade && (
            <div className="mb-4 p-3 bg-amber-50/60 border border-amber-300 rounded">
              <h4 className="text-xs font-bold uppercase text-amber-900 mb-1">
                Autorização do Responsável Legal (Menor de 18 Anos)
              </h4>
              <p className="text-xs text-slate-800">
                <strong>Responsável:</strong> {fmt(associado.responsavel_nome)} | <strong>CPF:</strong> {fmt(associado.responsavel_cpf)} | <strong>Telefone:</strong> {fmt(associado.responsavel_fone)}
              </p>
              <p className="text-[10px] text-slate-700 mt-1 italic">
                * Consentimento registrado digitalmente com aceite dos termos em conformidade com a LGPD e o Estatuto da Juventude.
              </p>
            </div>
          )}

          {/* Assinaturas */}
          <div className="grid grid-cols-2 gap-8 mt-12 pt-6 text-center text-xs">
            <div>
              <div className="border-t border-slate-800 pt-1 font-semibold">
                {associado.nome}
              </div>
              <span className="text-[10px] text-slate-700">Assinatura do Associado / Jovem</span>
            </div>
            <div>
              <div className="border-t border-slate-800 pt-1 font-semibold">
                Coordenação / Secretaria UMADESPA
              </div>
              <span className="text-[10px] text-slate-700">Assinatura / Visto do Responsável</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
