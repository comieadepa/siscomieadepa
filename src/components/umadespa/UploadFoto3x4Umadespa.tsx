import React, { useState, useRef } from 'react';
import { Camera, Upload, Trash2, AlertCircle } from 'lucide-react';

interface FotoProps {
  fotoUrl: string | null;
  onFotoChange: (novaFotoBase64: string | null) => void;
}

export function UploadFoto3x4Umadespa({ fotoUrl, onFotoChange }: FotoProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  const processarArquivo = (file: File) => {
    setErro(null);

    // Valida tipo
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErro('A foto deve estar no formato JPG, PNG ou WEBP.');
      return;
    }

    // Valida tamanho bruto (máx 5MB antes da compressão)
    if (file.size > 5 * 1024 * 1024) {
      setErro('A imagem selecionada é muito grande. Escolha uma foto de até 5MB.');
      return;
    }

    setProcessando(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Redimensiona proporcionalmente para foto 3x4 oficial (600x800 máx)
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const base64Comprimido = canvas.toDataURL('image/jpeg', 0.85);
          onFotoChange(base64Comprimido);
        }
        setProcessando(false);
      };
      img.onerror = () => {
        setErro('Não foi possível carregar a imagem.');
        setProcessando(false);
      };
      img.src = e.target?.result as string;
    };

    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processarArquivo(file);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
        Foto Oficial 3x4 (Fundo Claro e Rosto Visível) *
      </label>

      {erro && (
        <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40">
        {/* Preview do 3x4 */}
        <div className="relative w-28 h-36 rounded-lg overflow-hidden border-2 border-emerald-500/40 bg-white dark:bg-slate-800 flex items-center justify-center shrink-0 shadow-sm">
          {fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fotoUrl}
              alt="Pré-visualização 3x4"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-center p-2 text-slate-700 dark:text-slate-300">
              <Camera className="w-8 h-8 mx-auto mb-1 opacity-40 text-slate-700 dark:text-slate-300" />
              <span className="text-[10px] uppercase font-semibold">Sem Foto</span>
            </div>
          )}

          {processando && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
            </div>
          )}
        </div>

        {/* Instruções e Botões */}
        <div className="space-y-2 text-center sm:text-left">
          <div className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5">
            <p className="font-semibold text-slate-700 dark:text-slate-300">Padrão da Credencial da Juventude:</p>
            <p>• Fotografia recente com fundo branco ou neutro;</p>
            <p>• Postura frontal, sem óculos escuros, bonés ou acessórios que ocultem o rosto;</p>
            <p>• Imagem tratada e otimizada automaticamente para impressão em PVC.</p>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={processando}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              {fotoUrl ? 'Substituir Foto' : 'Selecionar Foto'}
            </button>

            {fotoUrl && (
              <button
                type="button"
                onClick={() => onFotoChange(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remover
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
