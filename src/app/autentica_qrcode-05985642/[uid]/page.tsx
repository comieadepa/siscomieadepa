'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

// Prefixo fixo da URL — presente tanto aqui quanto no QR code
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

export default function CredencialDigitalPage({ params }: { params: { uid: string } }) {
  const [dados, setDados] = useState<CredencialData | null>(null);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/credencial/${params.uid}`)
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
  }, [params.uid]);

  const fmtDate = (v?: string) => {
    if (!v) return '—';
    const d = new Date(v + (v.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString('pt-BR');
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', fontFamily: 'Arial, sans-serif' }}>
      {/* Logo + título */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <img src="/img/logo_cgadb.png" alt="COMIEADEPA" style={{ height: '60px', marginBottom: '8px' }} />
        <div style={{ fontSize: '13px', color: '#555', fontWeight: 600, letterSpacing: '0.5px' }}>CREDENCIAL DIGITAL</div>
      </div>

      {loading && (
        <div style={{ color: '#666', fontSize: '14px' }}>Carregando credencial...</div>
      )}

      {!loading && erro && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '12px', padding: '24px 32px', textAlign: 'center', maxWidth: '360px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚠️</div>
          <div style={{ color: '#991b1b', fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>Credencial inválida</div>
          <div style={{ color: '#7f1d1d', fontSize: '13px' }}>{erro}</div>
        </div>
      )}

      {!loading && dados && (
        <>
          {/* FRENTE DO CARTÃO */}
          <div style={{ position: 'relative', width: '460px', maxWidth: '100%', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.22)' }}>
            <img src="/img/cred_minf.png" alt="Frente" style={{ width: '100%', display: 'block' }} />

            {/* Sobreposição de dados */}
            <div style={{ position: 'absolute', inset: 0, padding: '0' }}>
              {/* Foto */}
              {dados.fotoUrl && (
                <div style={{ position: 'absolute', top: '138px', left: '355px', width: '99px', height: '110px', overflow: 'hidden' }}>
                  <img src={dados.fotoUrl} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              {/* REG */}
              <div style={{ position: 'absolute', top: '188px', left: '15px', fontSize: '11px', fontFamily: 'Arial', fontWeight: 700, color: '#000' }}>
                REG.: <span style={{ color: '#a00c0c' }}>{dados.matricula}</span>
              </div>
              {/* NOME */}
              <div style={{ position: 'absolute', top: '207px', left: '15px', fontSize: '11px', fontFamily: 'Arial', fontWeight: 700, color: '#000', maxWidth: '290px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                NOME: <span style={{ color: '#a00c0c' }}>{dados.nome}</span>
              </div>
              {/* CARGO */}
              <div style={{ position: 'absolute', top: '226px', left: '15px', fontSize: '11px', fontFamily: 'Arial', fontWeight: 700, color: '#000' }}>
                CARGO: <span style={{ color: '#a00c0c' }}>{dados.cargo}</span>
              </div>
            </div>
          </div>

          {/* VERSO DO CARTÃO */}
          <div style={{ position: 'relative', width: '460px', maxWidth: '100%', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.22)', marginTop: '12px' }}>
            <img src="/img/cred_minc.png" alt="Verso" style={{ width: '100%', display: 'block' }} />
            <div style={{ position: 'absolute', inset: 0, padding: '0' }}>
              {/* VALIDADE */}
              <div style={{ position: 'absolute', top: '184px', left: '311px', width: '121px', fontSize: '9px', fontWeight: 700, textAlign: 'center', color: '#000' }}>
                VALIDADE: <span style={{ color: '#a00c0c' }}>{fmtDate(dados.dataValidade)}</span>
              </div>
              {/* Campos do verso */}
              <div style={{ position: 'absolute', top: '53px', left: '27px', fontSize: '10px', fontWeight: 700, color: '#000' }}>
                CONSAGRAÇÃO: <span style={{ color: '#a00c0c' }}>{fmtDate(dados.dataConsagracao)}</span>
              </div>
              <div style={{ position: 'absolute', top: '67px', left: '27px', fontSize: '10px', fontWeight: 700, color: '#000' }}>
                DATA DE NASC.: <span style={{ color: '#a00c0c' }}>{fmtDate(dados.dataNascimento)}</span>
              </div>
            </div>
          </div>

          {/* Rodapé de autenticidade */}
          <div style={{ marginTop: '20px', textAlign: 'center', maxWidth: '460px', background: '#fff', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>Credencial verificada em</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0D2B4E' }}>
              {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
            <div style={{ marginTop: '8px', fontSize: '10px', color: '#9ca3af' }}>
              ID: {dados.uniqueId} · COMIEADEPA
            </div>
            {dados.status === 'active' ? (
              <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: '20px', padding: '4px 14px', fontSize: '12px', fontWeight: 700, color: '#166534' }}>
                ✓ CREDENCIAL ATIVA
              </div>
            ) : (
              <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '20px', padding: '4px 14px', fontSize: '12px', fontWeight: 700, color: '#991b1b' }}>
                ✗ CREDENCIAL INATIVA
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: '24px', fontSize: '11px', color: '#9ca3af', textAlign: 'center' }}>
        www.comieadepa.org · CNPJ 04.760.047/0001-04
      </div>
    </div>
  );
}
