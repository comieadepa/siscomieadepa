'use client';

import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export const CREDENCIAL_URL_PREFIX = '/autentica_qrcode-05985642/';

interface EsposaData {
  cadastrada: boolean;
  nome: string;
  numeroAemadepa: string;
  cpf: string;
  rg: string;
  orgaoEmissor: string;
  dataNascimento: string;
  nacionalidade: string;
  naturalidade: string;
  nomePai: string;
  nomeMae: string;
  tituloEleitoral: string;
  fone: string;
  email: string;
  tipoSanguineo: string;
  fotoUrl: string | null;
  ministroNome: string;
  ministroMatricula: string;
  cargoMinisterial: string;
  campo: string;
  supervisao: string;
}

interface CredencialData {
  id: string;
  uniqueId: string;
  tipo?: 'ministro' | 'aemadepa';
  nome: string;
  matricula: string;
  cargo: string;
  tipoSanguineo: string;
  dataNascimento: string;
  dataConsagracao: string;
  dataValidade: string;
  fotoUrl: string | null;
  supervisao: string;
  campo: string;
  congregacao: string;
  status: string;
  rg: string;
  cpf: string;
  naturalidade: string;
  registroCgadb: string;
  filiacao: string;
  esposa?: EsposaData;
}

export default function CredencialDigitalPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = use(params);
  const searchParams = useSearchParams();
  const tipoParam = searchParams.get('tipo')?.toLowerCase();
  const isAemadepa = tipoParam === 'aemadepa';

  const [dados, setDados] = useState<CredencialData | null>(null);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = `/api/credencial/${uid}${isAemadepa ? '?tipo=aemadepa' : ''}`;
    fetch(url)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setErro(json.error || 'Não foi possível carregar a credencial.');
        } else {
          setDados(json);
        }
      })
      .catch(() => setErro('Erro de conexão. Tente novamente.'))
      .finally(() => setLoading(false));
  }, [uid, isAemadepa]);

  const vl = (v?: string) => (v && v.trim() ? v : '-');
  const ativo = dados?.status === 'active';

  // Helper para campos absolutos de ministro
  const field = (top: string, left: string, extra?: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    top,
    left,
    fontSize: '10px',
    fontFamily: 'Arial, sans-serif',
    fontWeight: 700,
    color: '#8B0000',
    maxWidth: extra?.maxWidth ?? '62%',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    lineHeight: 1,
    ...extra,
  });

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f8fafc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: 'Arial, sans-serif',
    }}>
      {/* CABEÇALHO */}
      <div style={{
        textAlign: 'center',
        marginBottom: '24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        maxWidth: '500px',
      }}>
        <img
          src="/img/logo_comieadepa.png"
          alt="COMIEADEPA"
          style={{
            height: '92px',
            width: 'auto',
            marginBottom: '10px',
            objectFit: 'contain',
            display: 'block',
            margin: '0 auto 10px auto',
            filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.08))',
          }}
        />
        <div style={{
          fontSize: '13px',
          color: isAemadepa ? '#9f1239' : '#1e3a8a',
          fontWeight: 800,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          textAlign: 'center',
        }}>
          {isAemadepa ? 'CREDENCIAL DIGITAL AEMADEPA' : 'CREDENCIAL DIGITAL DE MINISTRO'}
        </div>
      </div>

      {loading && (
        <div style={{ color: '#666', fontSize: '14px', margin: '30px 0' }}>
          Carregando credencial digital...
        </div>
      )}

      {!loading && erro && (
        <div style={{
          background: '#fee2e2',
          border: '1px solid #fca5a5',
          borderRadius: '12px',
          padding: '24px 32px',
          textAlign: 'center',
          maxWidth: '360px',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>⚠️</div>
          <div style={{ color: '#991b1b', fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>
            Credencial inválida
          </div>
          <div style={{ color: '#7f1d1d', fontSize: '13px' }}>{erro}</div>
        </div>
      )}

      {!loading && dados && isAemadepa && (
        <>
          {/* ======================================================== */}
          {/* CARTÃO DIGITAL AEMADEPA (ESPOSA / ASSOCIADA)            */}
          {/* ======================================================== */}
          <div style={{
            position: 'relative',
            width: '100%',
            maxWidth: '500px',
            borderRadius: '14px',
            overflow: 'hidden',
            boxShadow: '0 12px 36px rgba(159, 18, 57, 0.18)',
            border: '1px solid #fecdd3',
            background: 'linear-gradient(145deg, #ffffff 0%, #fff1f2 100%)',
          }}>
            {/* Topo institucional do cartão */}
            <div style={{
              background: 'linear-gradient(90deg, #881337 0%, #be123c 60%, #9f1239 100%)',
              color: '#ffffff',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '2px solid #fda4af',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <img
                  src="/img/logo_comieadepa.png"
                  alt="COMIEADEPA"
                  style={{ height: '44px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 900, letterSpacing: '0.5px' }}>
                    AEMADEPA • COMIEADEPA
                  </div>
                  <div style={{ fontSize: '9px', opacity: 0.9, letterSpacing: '0.3px', marginTop: '1px' }}>
                    Associação de Esposas de Ministros da Assembleia de Deus no Pará
                  </div>
                </div>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.18)',
                borderRadius: '6px',
                padding: '4px 8px',
                textAlign: 'center',
                border: '1px solid rgba(255,255,255,0.3)',
              }}>
                <div style={{ fontSize: '8px', textTransform: 'uppercase', opacity: 0.9 }}>MATRÍCULA</div>
                <div style={{ fontSize: '11px', fontWeight: 800, fontFamily: 'monospace' }}>
                  {vl(dados.esposa?.numeroAemadepa)}
                </div>
              </div>
            </div>

            {/* Corpo do Cartão AEMADEPA */}
            <div style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'center' }}>
              {/* Foto da Associada */}
              <div style={{
                width: '105px',
                height: '130px',
                borderRadius: '8px',
                overflow: 'hidden',
                backgroundColor: '#ffe4e6',
                border: '2px solid #fda4af',
                boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <img
                  src={dados.esposa?.fotoUrl || '/img/foto_placeholder.png'}
                  alt={dados.esposa?.nome || 'Associada'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center center' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/img/foto_placeholder.png'; }}
                />
              </div>

              {/* Informações da Associada */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Nome */}
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: '#9f1239', textTransform: 'uppercase' }}>
                    Esposa
                  </div>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 800,
                    color: '#1e293b',
                    whiteSpace: 'normal',
                    lineHeight: '1.2',
                  }}>
                    {vl(dados.esposa?.nome)}
                  </div>
                </div>

                {/* Ministro Vinculado */}
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: '#9f1239', textTransform: 'uppercase' }}>
                    Ministro Vinculado
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                    {vl(dados.esposa?.ministroNome)}
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>
                    Matrícula: {vl(dados.esposa?.ministroMatricula)} • Cargo: {vl(dados.esposa?.cargoMinisterial)}
                  </div>
                </div>

                {/* Campo e Supervisão */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px', fontSize: '10px' }}>
                  {dados.esposa?.campo && (
                    <span style={{
                      background: '#fff',
                      border: '1px solid #fecdd3',
                      color: '#9f1239',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 700,
                    }}>
                      Campo: {dados.esposa.campo}
                    </span>
                  )}
                  {dados.esposa?.supervisao && (
                    <span style={{
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      color: '#475569',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}>
                      {dados.esposa.supervisao}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Rodapé da arte do cartão */}
            <div style={{
              background: '#fff1f2',
              borderTop: '1px dashed #fecdd3',
              padding: '8px 16px',
              fontSize: '9px',
              color: '#9f1239',
              textAlign: 'center',
              fontWeight: 600,
            }}>
              A portadora desta credencial é esposa de ministro devidamente filiado à COMIEADEPA.
            </div>
          </div>

          {/* PAINEL DE VALIDAÇÃO AEMADEPA */}
          <div style={{
            marginTop: '16px',
            textAlign: 'center',
            width: '100%',
            maxWidth: '500px',
            background: '#fff',
            borderRadius: '12px',
            padding: '16px 20px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
            border: '1px solid #f1f5f9',
          }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
              Credencial AEMADEPA verificada em
            </div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#881337' }}>
              {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
            <div style={{ marginTop: '6px', fontSize: '10px', color: '#94a3b8', fontFamily: 'monospace' }}>
              ID: {dados.uniqueId || dados.id} - AEMADEPA
            </div>
            <div style={{
              marginTop: '10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: ativo ? '#fdf2f8' : '#fee2e2',
              border: ativo ? '1px solid #f472b6' : '1px solid #fca5a5',
              borderRadius: '20px',
              padding: '5px 16px',
              fontSize: '12px',
              fontWeight: 800,
              color: ativo ? '#be185d' : '#991b1b',
            }}>
              {ativo ? '✓ CREDENCIAL AEMADEPA ATIVA' : '✗ CREDENCIAL INATIVA'}
            </div>
          </div>
        </>
      )}

      {!loading && dados && !isAemadepa && (
        <>
          {/* ======================================================== */}
          {/* CARTÃO DE MINISTRO (PRESERVADO INTACTO)                  */}
          {/* ======================================================== */}
          <div style={{
            position: 'relative',
            width: '100%',
            maxWidth: '500px',
            borderRadius: '10px',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
          }}>
            <img
              src="/img/card001.png"
              alt=""
              style={{ width: '100%', display: 'block' }}
            />
            <div style={{ position: 'absolute', inset: 0 }}>

              {/* FOTO — x:355, y:138, largura:99, altura:110 */}
              <div style={{
                position: 'absolute',
                top: '47.4%',
                left: '76.3%',
                width: '21.3%',
                height: '37.8%',
                overflow: 'hidden',
                backgroundColor: '#fff',
              }}>
                <img
                  src={dados.fotoUrl || '/img/foto_placeholder.png'}
                  alt="Foto"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center center' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/img/foto_placeholder.png'; }}
                />
              </div>

              {/* REGISTRO — x:15, y:188 */}
              <div style={field('64.6%', '3.2%', { width: '63.4%', fontSize: '14px', color: '#000', fontWeight: 700 })}>
                REG.: {vl(dados.matricula)}
              </div>

              {/* NOME — x:15, y:207 */}
              <div style={field('71.1%', '3.2%', { width: '63.4%', fontSize: '14px', color: '#000', fontWeight: 700 })}>
                NOME: {vl(dados.nome)}
              </div>

              {/* CARGO — x:15, y:226 */}
              <div style={field('77.7%', '3.2%', { width: '63.4%', fontSize: '14px', color: '#000', fontWeight: 700 })}>
                CARGO: {vl(dados.cargo)}
              </div>

            </div>
          </div>

          {/* INFO DE VALIDAÇÃO DE MINISTRO */}
          <div style={{
            marginTop: '16px',
            textAlign: 'center',
            width: '100%',
            maxWidth: '500px',
            background: '#fff',
            borderRadius: '12px',
            padding: '16px 20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
              Credencial verificada em
            </div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0D2B4E' }}>
              {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
            <div style={{ marginTop: '8px', fontSize: '10px', color: '#9ca3af' }}>
              ID: {dados.uniqueId} - COMIEADEPA
            </div>
            <div style={{
              marginTop: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: ativo ? '#dcfce7' : '#fee2e2',
              border: ativo ? '1px solid #86efac' : '1px solid #fca5a5',
              borderRadius: '20px',
              padding: '4px 14px',
              fontSize: '12px',
              fontWeight: 700,
              color: ativo ? '#166534' : '#991b1b',
            }}>
              {ativo ? 'CREDENCIAL ATIVA' : 'CREDENCIAL INATIVA'}
            </div>
          </div>
        </>
      )}

      {/* RODAPÉ INSTITUCIONAL */}
      <div style={{ marginTop: '24px', fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
        www.comieadepa.org - CNPJ 04.760.047/0001-04
      </div>
    </div>
  );
}