'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase-client';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  webViewLink?: string;
  webContentLink?: string;
}

interface DocumentosMinistroProps {
  memberId: string;
  memberName: string;
  matricula: string;
  onClose: () => void;
  entityType?: 'ministro' | 'candidato_consagracao';
  entityId?: string;
  titulo?: string;
  subtitulo?: string;
  anoReferencia?: string;
  tipoDocumentoOptions?: string[];
  onChanged?: () => void;
}

const TIPOS_DOCUMENTO_MINISTRO = [
  'RG',
  'CPF',
  'Comprovante de Residência',
  'Diploma Teológico',
  'Certificado de Ordenação',
  'Carta de Transferência',
  'Foto',
  'Outros',
];

const TIPOS_DOCUMENTO_CANDIDATO = [
  'RG',
  'CPF',
  'Comprovante de Residência',
  'Certidão de Casamento',
  'Diploma Teológico',
  'Carta de Recomendação',
  'Certificado de Batismo',
  'Certificado de Ordenação anterior',
  'Foto',
  'Outros',
];

const ICON_BY_MIME: Record<string, string> = {
  'application/pdf': '📄',
  'image/jpeg': '🖼️',
  'image/png': '🖼️',
  'image/gif': '🖼️',
  'image/webp': '🖼️',
  'application/msword': '📝',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
};

function fileIcon(mimeType: string) {
  return ICON_BY_MIME[mimeType] || '📎';
}

function fmtSize(bytes?: string) {
  if (!bytes) return '';
  const n = parseInt(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function tipoFromName(name: string): string {
  const match = name.match(/^\[([^\]]+)\]/);
  return match ? match[1] : '';
}

function displayName(name: string): string {
  return name.replace(/^\[[^\]]+\]\s*/, '');
}

export default function DocumentosMinistro({
  memberId,
  memberName,
  matricula,
  onClose,
  entityType = 'ministro',
  entityId,
  titulo,
  subtitulo,
  anoReferencia,
  tipoDocumentoOptions,
  onChanged,
}: DocumentosMinistroProps) {
  const resolvedEntityId = entityId || memberId;
  const resolvedEntityName = memberName;
  const tituloModal = titulo || (entityType === 'candidato_consagracao' ? 'Documentos do Candidato' : 'Documentos do Ministro');
  const subtituloModal = subtitulo || `${matricula} — ${memberName}`;
  const tiposDocumento = tipoDocumentoOptions || (entityType === 'candidato_consagracao' ? TIPOS_DOCUMENTO_CANDIDATO : TIPOS_DOCUMENTO_MINISTRO);

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState(tiposDocumento[0] || 'Outros');
  const [descricaoOutros, setDescricaoOutros] = useState('');
  const [confirmDeletar, setConfirmDeletar] = useState<string | null>(null);
  const [deletando, setDeletando] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastStats, setLastStats] = useState<{
    originalSize: number;
    optimizedSize: number;
    reductionPercentage: number;
    optimized: boolean;
    fileName: string;
  } | null>(null);

  // Estados do Progresso por Etapas (Sprint UX)
  const [uploadStage, setUploadStage] = useState<'idle' | 'validating' | 'uploading' | 'optimizing' | 'sending_drive' | 'completed' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);

  const getAuthHeader = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || '';
    return { Authorization: `Bearer ${token}` };
  }, []);

  const abrirArquivo = useCallback(async (fileId: string, mimeType: string, _name: string) => {
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/documentos/${fileId}`, { headers });
      if (!res.ok) throw new Error('Erro ao obter arquivo');
      const blob = await res.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
      const a = window.open(url, '_blank');
      if (!a) URL.revokeObjectURL(url);
      // limpa a URL depois de 60s
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      alert('Não foi possível abrir o arquivo.');
    }
  }, [getAuthHeader]);

  const baixarArquivo = useCallback(async (fileId: string, name: string) => {
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/documentos/${fileId}`, { headers });
      if (!res.ok) throw new Error('Erro ao baixar arquivo');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Não foi possível baixar o arquivo.');
    }
  }, [getAuthHeader]);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeader();
      const params = new URLSearchParams({
        entityType,
        entityId: resolvedEntityId,
        entityName: resolvedEntityName,
        memberId,
        memberName,
        matricula,
      });
      if (anoReferencia) {
        params.append('ano', anoReferencia);
      }
      const res = await fetch(`/api/documentos?${params}`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao listar documentos');
      setFiles(json.files || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [entityType, resolvedEntityId, resolvedEntityName, memberId, memberName, matricula, anoReferencia, getAuthHeader]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleUpload = async (file: File) => {
    // Validar tamanho do arquivo no frontend (limite: 100 MB)
    const maxLimit = 100 * 1024 * 1024;
    if (file.size > maxLimit) {
      setUploadError("Arquivo muito grande. O limite atual é 100 MB. Compacte o PDF ou divida em partes menores.");
      return;
    }

    setUploading(true);
    setUploadError('');
    setLastStats(null);
    setUploadingFile(file);

    // Progresso por Etapas (Sprint UX)
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    setUploadStage('validating');
    setUploadProgress(0);
    setUploadMessage('Validando arquivo...');

    let currentProgress = 0;
    const progressInterval = setInterval(() => {
      if (currentProgress < 10) {
        currentProgress += 2;
        setUploadStage('validating');
        setUploadMessage('Validando arquivo...');
        setUploadProgress(currentProgress);
      } else if (currentProgress < 45) {
        setUploadStage('uploading');
        setUploadMessage(isPdf ? 'Preparando upload...' : 'Preparando documento...');
        currentProgress += 3;
        setUploadProgress(Math.min(currentProgress, 45));
      } else if (isPdf && currentProgress < 75) {
        setUploadStage('optimizing');
        setUploadMessage('Otimizando PDF...');
        currentProgress += 2;
        setUploadProgress(Math.min(currentProgress, 75));
      } else if (currentProgress < 95) {
        setUploadStage('sending_drive');
        setUploadMessage('Enviando ao Google Drive...');
        currentProgress += 2;
        setUploadProgress(Math.min(currentProgress, 95));
      }
    }, 100);

    try {
      const headers = await getAuthHeader();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityType', entityType);
      formData.append('entityId', resolvedEntityId);
      formData.append('entityName', resolvedEntityName);
      formData.append('memberId', memberId);
      formData.append('memberName', memberName);
      formData.append('matricula', matricula);
      if (anoReferencia) formData.append('ano', anoReferencia);
      const tipoFinal = tipoDocumento === 'Outros' && descricaoOutros.trim()
        ? `Outros - ${descricaoOutros.trim()}`
        : tipoDocumento;
      formData.append('tipoDocumento', tipoFinal);

      const res = await fetch('/api/documentos', { method: 'POST', headers, body: formData });
      
      const contentType = res.headers.get('content-type') || '';
      let json: any = {};
      if (contentType.includes('application/json')) {
        json = await res.json();
      } else {
        const text = await res.text().catch(() => '');
        console.error('[UPLOAD ERROR RESPONSE]', text);
        throw new Error('Não foi possível processar o upload. O servidor recusou o arquivo ou retornou uma resposta inválida.');
      }

      if (!res.ok) throw new Error(json.error || 'Erro ao enviar arquivo');

      clearInterval(progressInterval);
      setUploadProgress(100);
      setUploadStage('completed');
      setUploadMessage('Upload concluído com sucesso.');
      
      setLastStats({
        originalSize: json.originalSize || file.size,
        optimizedSize: json.optimizedSize || file.size,
        reductionPercentage: json.reductionPercentage || 0,
        optimized: !!json.optimized,
        fileName: file.name,
      });

      await fetchFiles();
      onChanged?.();
    } catch (e) {
      clearInterval(progressInterval);
      setUploadStage('error');
      setUploadProgress(0);
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      setUploadingFile(null);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const handleDelete = async (fileId: string) => {
    setDeletando(true);
    try {
      const headers = await getAuthHeader();
      const params = new URLSearchParams({ entityType, entityId: resolvedEntityId });
      const res = await fetch(`/api/documentos/${fileId}?${params}`, { method: 'DELETE', headers });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Erro ao deletar');
      }
      setFiles(prev => prev.filter(f => f.id !== fileId));
      onChanged?.();
    } catch (e) {
      alert('Erro ao deletar: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeletando(false);
      setConfirmDeletar(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-[#0D2B4E] to-[#1a4a7a] rounded-t-xl flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>📁</span> {tituloModal}
            </h2>
            <p className="text-xs text-blue-200 mt-0.5">{subtituloModal}</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-300 text-2xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Upload area */}
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <select
                value={tipoDocumento}
                onChange={e => { setTipoDocumento(e.target.value); setDescricaoOutros(''); }}
                className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                disabled={uploading}
              >
                {tiposDocumento.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 bg-[#0D2B4E] hover:bg-[#1a4a7a] disabled:opacity-60 text-white text-sm font-semibold rounded-md transition whitespace-nowrap"
              >
                {uploading ? '⏳ Processando...' : '📤 Selecionar arquivo'}
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileInput}
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx" />
            </div>

            {tipoDocumento === 'Outros' && (
              <input
                type="text"
                placeholder="Descreva o documento..."
                value={descricaoOutros}
                onChange={e => setDescricaoOutros(e.target.value)}
                disabled={uploading}
                className="w-full text-sm border border-amber-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-amber-50"
              />
            )}

            {uploading ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-[#0D2B4E]">{uploadMessage}</span>
                  <span className="font-bold text-[#0D2B4E]">{uploadProgress}%</span>
                </div>
                {/* Barra de progresso */}
                <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-[#0D2B4E] h-2.5 rounded-full transition-all duration-200 ease-out" 
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                  <span>Arquivo: {uploadingFile?.name} [etapa: {uploadStage}]</span>
                  <span>Tamanho original: {fmtSize(String(uploadingFile?.size || 0))}</span>
                </div>
              </div>
            ) : (
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-5 text-center text-sm text-gray-500 transition cursor-pointer ${dragOver ? 'border-[#0D2B4E] bg-blue-50 text-[#0D2B4E]' : 'border-gray-300 hover:border-gray-400'}`}
                onClick={() => fileInputRef.current?.click()}
              >
                <span>Arraste um arquivo aqui ou clique para selecionar<br /><span className="text-xs text-gray-400">PDF, imagens, Word — tipo: <strong>{tipoDocumento === 'Outros' && descricaoOutros ? `Outros - ${descricaoOutros}` : tipoDocumento}</strong></span></span>
              </div>
            )}
            {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
            
            {lastStats && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-4 text-xs space-y-1">
                <p className="font-bold flex items-center gap-1 text-sm text-emerald-800">
                  <span>✨</span> Documento enviado com sucesso
                </p>
                <p className="text-emerald-700">Arquivo: <span className="font-semibold text-emerald-950">{lastStats.fileName}</span></p>
                {lastStats.optimized ? (
                  <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-emerald-100">
                    <div>
                      <span className="text-emerald-600 block">Original</span>
                      <span className="font-semibold text-emerald-800">{fmtSize(String(lastStats.originalSize))}</span>
                    </div>
                    <div>
                      <span className="text-emerald-600 block">Final</span>
                      <span className="font-semibold text-emerald-800">{fmtSize(String(lastStats.optimizedSize))}</span>
                    </div>
                    <div>
                      <span className="text-emerald-600 block">Redução</span>
                      <span className="font-bold text-[#0D2B4E]">-{lastStats.reductionPercentage}%</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-emerald-700 mt-1 pt-1 border-t border-emerald-100">
                    Documento enviado sem necessidade de otimização. (Tamanho: {fmtSize(String(lastStats.originalSize))})
                  </p>
                )}
              </div>
            )}
          </div>

          {/* File list */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600 text-sm mb-3">{error}</p>
              <button onClick={fetchFiles} className="text-sm text-blue-600 underline">Tentar novamente</button>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <div className="text-5xl mb-3">📂</div>
              <p className="text-sm">Nenhum documento enviado ainda.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">{files.length} documento{files.length > 1 ? 's' : ''}</p>
              {files.map(f => (
                <div key={f.id} className="flex items-center gap-3 border border-gray-200 rounded-lg px-4 py-3 hover:bg-gray-50 transition">
                  <span className="text-2xl flex-shrink-0">{fileIcon(f.mimeType)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {tipoFromName(f.name) && (
                        <span className="text-xs font-semibold bg-[#0D2B4E] text-white px-2 py-0.5 rounded-full flex-shrink-0">
                          {tipoFromName(f.name)}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-800 truncate">{displayName(f.name)}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {fmtSize(f.size)}{f.size && f.createdTime ? ' · ' : ''}{fmtDate(f.createdTime)}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {/* Visualizar — fetch autenticado → Blob URL → nova aba */}
                    <button
                      type="button"
                      onClick={() => abrirArquivo(f.id, f.mimeType, displayName(f.name))}
                      className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition"
                      title="Visualizar"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    {/* Baixar */}
                    <button
                      type="button"
                      onClick={() => baixarArquivo(f.id, displayName(f.name))}
                      className="p-2 text-green-700 hover:bg-green-100 rounded-lg transition"
                      title="Baixar arquivo"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setConfirmDeletar(f.id)}
                      className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition"
                      title="Deletar"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl flex-shrink-0">
          <p className="text-xs text-gray-400 text-center">
            Documentos armazenados no Google Drive da COMIEADEPA
          </p>
        </div>
      </div>

      {/* Confirm delete */}
      {confirmDeletar && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-bold text-gray-800 mb-2">Confirmar exclusão</h3>
            <p className="text-sm text-gray-600 mb-4">
              Tem certeza que deseja deletar este documento? Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeletar(null)}
                disabled={deletando}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDeletar)}
                disabled={deletando}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg text-sm font-semibold transition"
              >
                {deletando ? 'Deletando...' : '🗑️ Deletar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
