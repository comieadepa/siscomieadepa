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

  const vl = (v?: string) => (v && v.trim() ? v : '-');
  const ativo = dados?.status === 'active';

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
          {/* CARTAO */}
          <div style={{
            position: 'relative', width: '520px', maxWidth: '100%',
            borderRadius: '10px', overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
          }}>
            <img src="/img/card001.png" alt="Credencial" style={{ width: '100%', display: 'block' }} />
            <div style={{ position: 'absolute', inset: 0 }}>

              {/* FOTO — area branca no canto superior direito do template */}
              <div style={{
                position: 'absolute', top: '5%', left: '79%',
                width: '18%', height: '38%',
                overflow: 'hidden', backgroundColor: '#e5e7eb',
              }}>
                <img
                  src={dados.fotoUrl || '/img/foto_placeholder.png'}
                  alt="Foto"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/img/foto_placeholder.png'; }}
                />
              </div>

              {/* REG — valor apos o rotulo impresso no template */}
              <div style={{
                position: 'absolute', top: '62%', left: '12%',
                fontSize: '8.5px', fontFamily: 'Arial', fontWeight: 700, color: '#7a0000',
                maxWidth: '60%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {vl(dados.matricula)}
              </div>

              {/* NOME */}
              <div style={{
                position: 'absolute', top: '71%', left: '12%',
                fontSize: '8.5px', fontFamily: 'Arial', fontWeight: 700, color: '#7a0000',
                maxWidth: '60%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {vl(dados.nome)}
              </div>

              {/* CARGO */}
              <div style={{
                position: 'absolute', top: '80%', left: '14%',
                fontSize: '8.5px', fontFamily: 'Arial', fontWeight: 700, color: '#7a0000',
                maxWidth: '60%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              }}>
                {vl(dados.cargo)}
              </div>

            </div>
          </div>

          {/* INFO DE VALIDACAO */}
          <div style={{
            marginTop: '16px', textAlign: 'center', width: '520px', maxWidth: '100%',
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