'use client';

import { use, useEffect, useState } from 'react';

// Prefixo fixo da URL â€” presente tanto aqui quanto no QR code
export const CREDENCIAL_URL_PREFIX = '/autentica_qrcode-05985642/';

interface CredencialData {
  uniqueId: string;
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
}

export default function CredencialDigitalPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = use(params);
  const [dados, setDados] = useState<CredencialData | null>(null);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(true);
  const [mostrando, setMostrando] = useState<'frente' | 'verso'>('frente');

  useEffect(() => {
    fetch(`/api/credencial/${uid}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setErro(json.error || 'NÃ£o foi possÃ­vel carregar a credencial.');
        } else {
          setDados(json);
        }
      })
      .catch(() => setErro('Erro de conexÃ£o. Tente novamente.'))
      .finally(() => setLoading(false));
  }, [uid]);

  /** Formata data ISO para pt-BR. Retorna 'â€”' se ausente, invÃ¡lida ou no futuro (para nascimento). */
  const fmtDate = (v?: string, opts?: { rejectFuture?: boolean }) => {
    if (!v || v === 'null' || v === 'undefined') return 'â€”';
    const d = new Date(v + (v.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return 'â€”';
    if (opts?.rejectFuture && d > new Date()) return 'â€”';
    return d.toLocaleDateString('pt-BR');
  };

  const statusAtivo = dados?.status === 'active';

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f0f2f5',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: 'Arial, sans-serif',
    }}>
      {/* Logo + tÃ­tulo */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <img src="/img/logo_cgadb.png" alt="COMIEADEPA" style={{ height: '60px', marginBottom: '8px' }} />
        <div style={{ fontSize: '13px', color: '#555', fontWeight: 600, letterSpacing: '0.5px' }}>
          CREDENCIAL DIGITAL
        </div>
      </div>

      {loading && (
        <div style={{ color: '#666', fontSize: '14px' }}>Carregando credencial...</div>
      )}

      {!loading && erro && (
        <div style={{
          background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '12px',
          padding: '24px 32px', textAlign: 'center', maxWidth: '360px',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>âš ï¸</div>
          <div style={{ color: '#991b1b', fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>
            Credencial invÃ¡lida
          </div>
          <div style={{ color: '#7f1d1d', fontSize: '13px' }}>{erro}</div>
        </div>
      )}

      {!loading && dados && (
        <>
          {/* â”€â”€ FRENTE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {mostrando === 'frente' && (
            <div style={{
              position: 'relative', width: '460px', maxWidth: '100%',
              borderRadius: '16px', overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
            }}>
              <img src="/img/cred_minf.png" alt="Frente" style={{ width: '100%', display: 'block' }} />

              <div style={{ position: 'absolute', inset: 0 }}>
                {/* Foto */}
                <div style={{
                  position: 'absolute', top: '138px', left: '355px',
                  width: '99px', height: '110px', overflow: 'hidden', backgroundColor: '#e5e7eb',
                }}>
                  <img
                    src={dados.fotoUrl || '/img/foto_placeholder.png'}
                    alt="Foto"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/img/foto_placeholder.png'; }}
                  />
                </div>

                {/* REG */}
                <div style={{
                  position: 'absolute', top: '188px', left: '15px',
                  fontSize: '11px', fontFamily: 'Arial', fontWeight: 700, color: '#000',
                }}>
                  REG.: <span style={{ color: '#a00c0c' }}>{dados.matricula || 'â€”'}</span>
                </div>

                {/* NOME */}
                <div style={{
                  position: 'absolute', top: '207px', left: '15px',
                  fontSize: '11px', fontFamily: 'Arial', fontWeight: 700, color: '#000',
                  maxWidth: '290px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                  NOME: <span style={{ color: '#a00c0c' }}>{dados.nome || 'â€”'}</span>
                </div>

                {/* CARGO */}
                <div style={{
                  position: 'absolute', top: '226px', left: '15px',
                  fontSize: '11px', fontFamily: 'Arial', fontWeight: 700, color: '#000',
                }}>
                  CARGO: <span style={{ color: '#a00c0c' }}>{dados.cargo || 'â€”'}</span>
                </div>
              </div>
            </div>
          )}

          {/* â”€â”€ VERSO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {mostrando === 'verso' && (
            <div style={{
              position: 'relative', width: '460px', maxWidth: '100%',
              borderRadius: '16px', overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
            }}>
              <img src="/img/cred_minc.png" alt="Verso" style={{ width: '100%', display: 'block' }} />

              <div style={{ position: 'absolute', inset: 0 }}>
                {/* CONSAGRAÃ‡ÃƒO */}
                <div style={{
                  position: 'absolute', top: '53px', left: '27px',
                  fontSize: '10px', fontWeight: 700, color: '#000',
                }}>
                  CONSAGRAÃ‡ÃƒO:{' '}
                  <span style={{ color: '#a00c0c' }}>{fmtDate(dados.dataConsagracao)}</span>
                </div>

                {/* DATA DE NASC. â€” rejeita datas no futuro (erro de digitaÃ§Ã£o) */}
                <div style={{
                  position: 'absolute', top: '67px', left: '27px',
                  fontSize: '10px', fontWeight: 700, color: '#000',
                }}>
                  DATA DE NASC.:{' '}
                  <span style={{ color: '#a00c0c' }}>
                    {fmtDate(dados.dataNascimento, { rejectFuture: true })}
                  </span>
                </div>

                {/* VALIDADE */}
                <div style={{
                  position: 'absolute', top: '184px', left: '311px',
                  width: '121px', fontSize: '9px', fontWeight: 700,
                  textAlign: 'center', color: '#000',
                }}>
                  VALIDADE:{' '}
                  <span style={{ color: '#a00c0c' }}>{fmtDate(dados.dataValidade)}</span>
                </div>
              </div>
            </div>
          )}

          {/* â”€â”€ BotÃ£o de alternÃ¢ncia â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <button
            onClick={() => setMostrando(mostrando === 'frente' ? 'verso' : 'frente')}
            style={{
              marginTop: '16px',
              padding: '10px 24px',
              borderRadius: '24px',
              border: '1.5px solid #0D2B4E',
              background: '#fff',
              color: '#0D2B4E',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            ðŸ”„ {mostrando === 'frente' ? 'Ver verso' : 'Ver frente'}
          </button>

          {/* â”€â”€ Card de validaÃ§Ã£o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div style={{
            marginTop: '16px', textAlign: 'center', width: '460px', maxWidth: '100%',
            background: '#fff', borderRadius: '12px', padding: '16px 20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
              Credencial verificada em
            </div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0D2B4E' }}>
              {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
            <div style={{ marginTop: '8px', fontSize: '10px', color: '#9ca3af' }}>
              ID: {dados.uniqueId} Â· COMIEADEPA
            </div>
            {statusAtivo ? (
              <div style={{
                marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: '#dcfce7', border: '1px solid #86efac', borderRadius: '20px',
                padding: '4px 14px', fontSize: '12px', fontWeight: 700, color: '#166534',
              }}>
                âœ“ CREDENCIAL ATIVA
              </div>
            ) : (
              <div style={{
                marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '20px',
                padding: '4px 14px', fontSize: '12px', fontWeight: 700, color: '#991b1b',
              }}>
                âœ— CREDENCIAL INATIVA
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: '24px', fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
        www.comieadepa.org Â· CNPJ 04.760.047/0001-04
      </div>
    </div>
  );
}
