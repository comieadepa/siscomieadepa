'use client';

import { use, useEffect, useState } from 'react';

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
  rg: string;
  cpf: string;
  naturalidade: string;
  registroCgadb: string;
  filiacao: string;
}

export default function CredencialDigitalPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = use(params);
  const [dados, setDados] = useState<CredencialData | null>(null);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(true);
  const [face, setFace] = useState<'frente' | 'verso'>('frente');

  useEffect(() => {
    fetch(`/api/credencial/${uid}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) setErro(json.error || 'Nao foi possivel carregar a credencial.');
        else setDados(json);
      })
      .catch(() => setErro('Erro de conexao. Tente novamente.'))
      .finally(() => setLoading(false));
  }, [uid]);

  const fmtDate = (v?: string, rejectFuture = false) => {
    if (!v || v === 'null' || v === 'undefined' || v.trim() === '') return '-';
    const d = new Date(v.length === 10 ? v + 'T12:00:00' : v);
    if (isNaN(d.getTime())) return '-';
    if (rejectFuture && d > new Date()) return '-';
    return d.toLocaleDateString('pt-BR');
  };

  const vl = (v?: string) => (v && v.trim() ? v : '-');
  const ativo = dados?.status === 'active';

  const cardStyle: React.CSSProperties = {
    position: 'relative', width: '460px', maxWidth: '100%',
    borderRadius: '16px', overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
  };

  const row = (top: number, left: number, extra?: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute', top, left,
    fontSize: '10px', fontFamily: 'Arial', fontWeight: 700, color: '#000',
    ...extra,
  });

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#f0f2f5',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '24px 16px', fontFamily: 'Arial, sans-serif',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <img src="/img/logo_cgadb.png" alt="COMIEADEPA" style={{ height: '60px', marginBottom: '8px' }} />
        <div style={{ fontSize: '13px', color: '#555', fontWeight: 600, letterSpacing: '0.5px' }}>
          CREDENCIAL DIGITAL
        </div>
      </div>

      {loading && <div style={{ color: '#666', fontSize: '14px' }}>Carregando credencial...</div>}

      {!loading && erro && (
        <div style={{
          background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '12px',
          padding: '24px 32px', textAlign: 'center', maxWidth: '360px',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>[!]</div>
          <div style={{ color: '#991b1b', fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>
            Credencial invalida
          </div>
          <div style={{ color: '#7f1d1d', fontSize: '13px' }}>{erro}</div>
        </div>
      )}

      {!loading && dados && (
        <>
          {/* FRENTE */}
          {face === 'frente' && (
            <div style={cardStyle}>
              <img src="/img/cred_minf.png" alt="Frente" style={{ width: '100%', display: 'block' }} />
              <div style={{ position: 'absolute', inset: 0 }}>
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
                <div style={row(188, 15, { fontSize: '11px' })}>
                  REG.: <span style={{ color: '#a00c0c' }}>{vl(dados.matricula)}</span>
                </div>
                <div style={row(207, 15, { fontSize: '11px', maxWidth: '290px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' })}>
                  NOME: <span style={{ color: '#a00c0c' }}>{vl(dados.nome)}</span>
                </div>
                <div style={row(226, 15, { fontSize: '11px' })}>
                  CARGO: <span style={{ color: '#a00c0c' }}>{vl(dados.cargo)}</span>
                </div>
              </div>
            </div>
          )}

          {/* VERSO */}
          {face === 'verso' && (
            <div style={cardStyle}>
              <img src="/img/cred_minc.png" alt="Verso" style={{ width: '100%', display: 'block' }} />
              <div style={{ position: 'absolute', inset: 0 }}>
                <div style={row(30, 27)}>
                  RG: <span style={{ color: '#a00c0c' }}>{vl(dados.rg)}</span>
                </div>
                <div style={row(44, 27)}>
                  CPF: <span style={{ color: '#a00c0c' }}>{vl(dados.cpf)}</span>
                </div>
                <div style={row(58, 27)}>
                  DATA DE NASC.: <span style={{ color: '#a00c0c' }}>{fmtDate(dados.dataNascimento, true)}</span>
                </div>
                <div style={row(72, 27)}>
                  NATURALIDADE: <span style={{ color: '#a00c0c' }}>{vl(dados.naturalidade)}</span>
                </div>
                <div style={row(86, 27)}>
                  REG. CGADB: <span style={{ color: '#a00c0c' }}>{vl(dados.registroCgadb)}</span>
                </div>
                <div style={row(100, 27)}>
                  CONSAGRACAO: <span style={{ color: '#a00c0c' }}>{fmtDate(dados.dataConsagracao)}</span>
                </div>
                <div style={row(114, 27)}>
                  TIPO SANGUINEO: <span style={{ color: '#a00c0c' }}>{vl(dados.tipoSanguineo)}</span>
                </div>
                <div style={row(128, 27, { maxWidth: '260px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' })}>
                  FILIACAO: <span style={{ color: '#a00c0c' }}>{vl(dados.filiacao)}</span>
                </div>
                <div style={row(184, 311, { width: '121px', fontSize: '9px', textAlign: 'center' })}>
                  VALIDADE: <span style={{ color: '#a00c0c' }}>{fmtDate(dados.dataValidade)}</span>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => setFace(face === 'frente' ? 'verso' : 'frente')}
            style={{
              marginTop: '16px', padding: '10px 28px', borderRadius: '24px',
              border: '1.5px solid #0D2B4E', background: '#fff', color: '#0D2B4E',
              fontWeight: 700, fontSize: '13px', cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            {face === 'frente' ? 'Ver verso' : 'Ver frente'}
          </button>

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
              ID: {dados.uniqueId} - COMIEADEPA
            </div>
            <div style={{
              marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px',
              background: ativo ? '#dcfce7' : '#fee2e2',
              border: ativo ? '1px solid #86efac' : '1px solid #fca5a5',
              borderRadius: '20px', padding: '4px 14px',
              fontSize: '12px', fontWeight: 700,
              color: ativo ? '#166534' : '#991b1b',
            }}>
              {ativo ? 'CREDENCIAL ATIVA' : 'CREDENCIAL INATIVA'}
            </div>
          </div>
        </>
      )}

      <div style={{ marginTop: '24px', fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
        www.comieadepa.org - CNPJ 04.760.047/0001-04
      </div>
    </div>
  );
}