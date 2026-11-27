import { useState } from 'react';
import { X, Link as LinkIcon, Copy, Check, ExternalLink } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface ModalLinkProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ModalLinkPublicoUmadespa({ isOpen, onClose }: ModalLinkProps) {
  const [copiado, setCopiado] = useState(false);

  if (!isOpen) return null;

  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/umadespa/cadastro`
      : 'https://www.siscomieadepa.org/umadespa/cadastro';

  const handleCopiar = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 3000);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl relative animate-in fade-in zoom-in-95 duration-150 text-center">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-700 dark:text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mx-auto mb-3">
          <LinkIcon className="w-6 h-6" />
        </div>

        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Link Público da UMADESPA
        </h3>
        <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 mb-5">
          Compartilhe com líderes locais, jovens e congregações para inscrição e emissão de carteirinhas.
        </p>

        {/* QR Code */}
        <div className="p-4 bg-white rounded-xl border border-slate-200 inline-block shadow-xs mb-4">
          <QRCodeSVG value={url} size={160} level="M" />
        </div>

        {/* Link Input com Botão Copiar */}
        <div className="flex items-center gap-2 p-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 mb-4">
          <input
            type="text"
            readOnly
            value={url}
            className="w-full bg-transparent px-2 text-xs text-slate-700 dark:text-slate-300 focus:outline-none select-all"
          />
          <button
            type="button"
            onClick={handleCopiar}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg text-white transition-colors shrink-0 flex items-center gap-1 ${
              copiado ? 'bg-emerald-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {copiado ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copiar
              </>
            )}
          </button>
        </div>

        <div className="flex justify-center">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir página de inscrição em nova aba
          </a>
        </div>
      </div>
    </div>
  );
}
