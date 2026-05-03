'use client';

import { useRef, useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { createClient } from '@/lib/supabase-client';

interface DadosMembro {
  matricula: string;
  id: string;
  uniqueId: string;
  nome: string;
  cpf: string;
  tipoCadastro: string;
  cargo?: string;
  qualFuncao?: string;
  status?: string;
  rg?: string;
  orgaoEmissor?: string;
  uf_rg?: string;
  dataNascimento?: string;
  numero_cgadb?: string;
  supervisao?: string;
  campo?: string;
  data_filiacao?: string;
  dataConsagracao?: string;
  orden_pastor_data?: string;
  orden_pastor_local?: string;
  observacoes?: string;
  naturalidade?: string;
  cidade?: string;
  uf?: string;
  nomeConjuge?: string;
}

interface DadosIgreja {
  nomeIgreja: string;
  endereco: string;
  telefone: string;
  email: string;
  cnpj?: string;
  logoUrl?: string;
}

interface CartaMudancaProps {
  membro: DadosMembro;
  dadosIgreja: DadosIgreja;
}

const fmt = (v?: string | null) => v || '';

export default function CartaMudanca({ membro, dadosIgreja }: CartaMudancaProps) {
  const cartaRef = useRef<HTMLDivElement>(null);
  const [emailUsuario, setEmailUsuario] = useState('');

  useEffect(() => {
    const sb = createClient();
    (async () => { const { data } = await sb.auth.getUser(); setEmailUsuario(data?.user?.email || ''); })();
  }, []);

  const hoje = new Date();
  const dataExtensa = hoje.toLocaleDateString('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const dataCapit = 'Belém, ' + dataExtensa.charAt(0).toUpperCase() + dataExtensa.slice(1);

  const cargo = fmt(membro.cargo).toUpperCase() || fmt(membro.qualFuncao).toUpperCase() || 'MINISTRO';
  const rgCompleto = [fmt(membro.rg), fmt(membro.orgaoEmissor), fmt(membro.uf_rg)].filter(Boolean).join(' ');

  const imprimirCarta = () => {
    if (!cartaRef.current) return;
    const pw = window.open('', '', 'height=1100,width=800');
    if (!pw) return;
    pw.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>Carta de Mudança - ${membro.nome}</title>
      <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;background:#fff;}@media print{@page{margin:10mm;}}</style>
    </head><body>${cartaRef.current.innerHTML}</body></html>`);
    pw.document.close();
    setTimeout(() => pw.print(), 300);
  };

  const gerarPDF = async () => {
    if (!cartaRef.current) return;
    try {
      await new Promise(r => setTimeout(r, 400));
      const canvas = await html2canvas(cartaRef.current, {
        scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff', logging: false,
      });
      const imgW = 210;
      const imgH = (canvas.height * imgW) / canvas.width;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      let left = imgH; let pos = 0; const ph = 297;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, pos, imgW, imgH);
      left -= ph;
      while (left >= 0) { pos = left - imgH; pdf.addPage(); pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, pos, imgW, imgH); left -= ph; }
      pdf.save(`CartaMudanca_${membro.nome.replace(/\s+/g, '_')}.pdf`);
    } catch (e) { alert('Erro ao gerar PDF: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const borderTop: React.CSSProperties = { borderTop: '4px solid #0D2B4E' };
  const borderBottom: React.CSSProperties = { borderBottom: '4px solid #F39C12' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Botões */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={gerarPDF} style={{ padding: '8px 18px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
          Baixar PDF
        </button>
        <button onClick={imprimirCarta} style={{ padding: '8px 18px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
          Imprimir
        </button>
      </div>

      {/* Documento */}
      <div ref={cartaRef} style={{ width: '210mm', margin: '0 auto', padding: '12mm 16mm', fontFamily: 'Arial, sans-serif', fontSize: '12px', lineHeight: '1.6', backgroundColor: '#fff', color: '#222', boxSizing: 'border-box', ...borderTop }}>

        {/* Cabeçalho */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px' }}>
          <tbody>
            <tr>
              <td style={{ width: '75px', verticalAlign: 'middle', paddingRight: '12px' }}>
                {dadosIgreja.logoUrl
                  ? <img src={dadosIgreja.logoUrl} alt="Logo" style={{ width: '70px', height: '70px', objectFit: 'contain' }} />
                  : <div style={{ width: '70px', height: '70px', border: '1px dashed #999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#999' }}>LOGO</div>
                }
              </td>
              <td style={{ verticalAlign: 'middle', textAlign: 'center' }}>
                <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#0D2B4E', letterSpacing: '1px' }}>COMIEADEPA</div>
                <div style={{ fontSize: '9px', color: '#555' }}>Convenção das Assembleias de Deus no Estado do Pará</div>
                <div style={{ fontSize: '8px', color: '#777', marginTop: '2px' }}>{dadosIgreja.endereco}</div>
                <div style={{ fontSize: '8px', color: '#777' }}>Tel: {dadosIgreja.telefone} | {dadosIgreja.email}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Faixa título */}
        <div style={{ background: '#0D2B4E', color: '#F39C12', fontWeight: 'bold', fontSize: '13px', textAlign: 'center', padding: '6px 10px', letterSpacing: '2px', marginBottom: '20px', ...borderBottom }}>
          CARTA DE MUDANÇA
        </div>

        {/* Número / Data */}
        <div style={{ textAlign: 'right', fontSize: '11px', marginBottom: '18px', color: '#444' }}>
          {dataCapit}
        </div>

        {/* Corpo */}
        <p style={{ marginBottom: '14px', textAlign: 'justify' }}>
          A <strong>CONVENÇÃO DAS ASSEMBLEIAS DE DEUS NO ESTADO DO PARÁ — COMIEADEPA</strong>, com sede nesta capital, por intermédio de sua Secretaria, faz saber a todos a quem possa interessar que o(a) ministro(a):
        </p>

        {/* Dados do ministro em destaque */}
        <div style={{ border: '1px solid #0D2B4E', borderLeft: '4px solid #F39C12', padding: '12px 16px', marginBottom: '18px', backgroundColor: '#f8f9fc' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 'bold', width: '30%', paddingBottom: '4px' }}>NOME:</td>
                <td style={{ paddingBottom: '4px', textTransform: 'uppercase' }}>{fmt(membro.nome)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', paddingBottom: '4px' }}>CARGO:</td>
                <td style={{ paddingBottom: '4px' }}>{cargo}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', paddingBottom: '4px' }}>MATRÍCULA:</td>
                <td style={{ paddingBottom: '4px' }}>{fmt(membro.matricula)}</td>
              </tr>
              {membro.numero_cgadb && (
                <tr>
                  <td style={{ fontWeight: 'bold', paddingBottom: '4px' }}>Nº CGADB:</td>
                  <td style={{ paddingBottom: '4px' }}>{fmt(membro.numero_cgadb)}</td>
                </tr>
              )}
              {rgCompleto && (
                <tr>
                  <td style={{ fontWeight: 'bold', paddingBottom: '4px' }}>RG:</td>
                  <td style={{ paddingBottom: '4px' }}>{rgCompleto}</td>
                </tr>
              )}
              {membro.campo && (
                <tr>
                  <td style={{ fontWeight: 'bold', paddingBottom: '4px' }}>CAMPO:</td>
                  <td style={{ paddingBottom: '4px' }}>{fmt(membro.campo)}</td>
                </tr>
              )}
              {membro.supervisao && (
                <tr>
                  <td style={{ fontWeight: 'bold' }}>SUPERVISÃO:</td>
                  <td>{fmt(membro.supervisao)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p style={{ marginBottom: '14px', textAlign: 'justify' }}>
          está sendo <strong>TRANSFERIDO(A)</strong> de seu atual campo de atuação, com todos os seus direitos e deveres preservados, conforme determinações estatutárias desta Convenção.
        </p>

        <p style={{ marginBottom: '14px', textAlign: 'justify' }}>
          Solicitamos às Igrejas e Convenções irmãs que o(a) recebam com toda a consideração e fraternidade cristã que lhe é de direito, facilitando sua integração na nova comunidade ministerial.
        </p>

        {membro.observacoes && (
          <p style={{ marginBottom: '14px', textAlign: 'justify', borderLeft: '3px solid #F39C12', paddingLeft: '10px', color: '#444' }}>
            <strong>Observações:</strong> {membro.observacoes}
          </p>
        )}

        {/* Linha para destinatário */}
        <div style={{ marginBottom: '20px', borderTop: '1px dashed #aaa', paddingTop: '10px' }}>
          <span style={{ fontSize: '10px', color: '#777' }}>À CONVENÇÃO / IGREJA DESTINATÁRIA:</span>
          <div style={{ marginTop: '4px', borderBottom: '1px solid #555', minHeight: '20px' }} />
          <div style={{ display: 'flex', gap: '20px', marginTop: '8px' }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '10px', color: '#777' }}>Campo Destino:</span>
              <div style={{ borderBottom: '1px solid #555', minHeight: '18px' }} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '10px', color: '#777' }}>Cidade/UF:</span>
              <div style={{ borderBottom: '1px solid #555', minHeight: '18px' }} />
            </div>
          </div>
        </div>

        <p style={{ marginBottom: '28px', textAlign: 'justify' }}>
          Por ser verdade, expedimos a presente carta de mudança, para que produza seus devidos efeitos legais e canônicos.
        </p>

        {/* Assinaturas */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '30px', gap: '20px' }}>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ borderTop: '1px solid #333', paddingTop: '6px', fontSize: '10px' }}>
              <div style={{ fontWeight: 'bold' }}>PRESIDENTE</div>
              <div>COMIEADEPA</div>
            </div>
          </div>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ borderTop: '1px solid #333', paddingTop: '6px', fontSize: '10px' }}>
              <div style={{ fontWeight: 'bold' }}>SECRETÁRIO GERAL</div>
              <div>COMIEADEPA</div>
            </div>
          </div>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ borderTop: '1px solid #333', paddingTop: '6px', fontSize: '10px' }}>
              <div style={{ fontWeight: 'bold' }}>MINISTRO(A)</div>
              <div>{fmt(membro.nome).split(' ')[0]}</div>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div style={{ marginTop: '24px', borderTop: '2px solid #0D2B4E', paddingTop: '6px', textAlign: 'center', fontSize: '9px', color: '#888' }}>
          Secretaria da COMIEADEPA — Belém — PA | {dadosIgreja.email} | Emitido por: {emailUsuario || 'Sistema'} | {dataCapit}
        </div>
      </div>
    </div>
  );
}
