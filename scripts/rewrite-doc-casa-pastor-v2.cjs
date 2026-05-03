const fs = require('fs');
const path = require('path');

const content = `'use client';

import { useRef, useEffect, useState } from 'react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
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
  status?: string;
  dataNascimento?: string;
  sexo?: string;
  tipoSanguineo?: string;
  escolaridade?: string;
  estadoCivil?: string;
  rg?: string;
  orgaoEmissor?: string;
  uf_rg?: string;
  nacionalidade?: string;
  naturalidade?: string;
  uf?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  cidade?: string;
  email?: string;
  celular?: string;
  whatsapp?: string;
  nomeConjuge?: string;
  cpfConjuge?: string;
  dataNascimentoConjuge?: string;
  nomePai?: string;
  nomeMae?: string;
  qualFuncao?: string;
  setorDepartamento?: string;
  numero_cgadb?: string;
  posicaoNoCampo?: string;
  supervisao?: string;
  campo?: string;
  cursoTeologico?: string;
  instituicaoTeologica?: string;
  profissao?: string;
  dataBatismoAguas?: string;
  dataConsagracao?: string;
  dataEmissao?: string;
  dataValidadeCredencial?: string;
  data_filiacao?: string;
  ev_autorizado_data?: string;
  ev_autorizado_local?: string;
  ev_consagrado_data?: string;
  ev_consagrado_local?: string;
  cons_missionario_data?: string;
  cons_missionario_local?: string;
  orden_pastor_data?: string;
  orden_pastor_local?: string;
  conjuge_rg?: string;
  conjuge_naturalidade?: string;
  conjuge_nome_pai?: string;
  conjuge_nome_mae?: string;
  conjuge_tipo_sanguineo?: string;
  conjuge_titulo_eleitoral?: string;
  conjuge_fone?: string;
  conjuge_email?: string;
  conjuge_foto_url?: string;
  qtd_filhos?: number;
  numero_aemadepa?: string;
  observacoes?: string;
}

interface DadosIgreja {
  nomeIgreja: string;
  endereco: string;
  telefone: string;
  email: string;
  cnpj?: string;
  logoUrl?: string;
}

interface DocCasaDoPastorProps {
  membro: DadosMembro;
  dadosIgreja: DadosIgreja;
  fotoUrl?: string;
}

const fmt = (v?: string | null) => v || '';

const fmtDate = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v + (v.length === 10 ? 'T12:00:00' : ''));
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString('pt-BR');
};

const cell: React.CSSProperties = {
  border: '1px solid #bbb',
  padding: '3px 6px',
  fontSize: '10px',
  verticalAlign: 'middle',
};
const lbl: React.CSSProperties = {
  ...cell,
  background: '#f0f0f0',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
  width: '1%',
};
const secHead = (color = '#003d7a'): React.CSSProperties => ({
  background: color,
  color: '#fff',
  fontWeight: 'bold',
  fontSize: '10px',
  padding: '3px 8px',
  textAlign: 'right',
  letterSpacing: '0.5px',
});

export default function DocCasaDoPastor({ membro, dadosIgreja, fotoUrl }: DocCasaDoPastorProps) {
  const fichaRef = useRef<HTMLDivElement>(null);
  const [emailUsuario, setEmailUsuario] = useState('');

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(({ data }) => {
      setEmailUsuario(data?.user?.email || '');
    });
  }, []);

  const dataPrint = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const dataCapit = dataPrint.charAt(0).toUpperCase() + dataPrint.slice(1);

  const imprimirFicha = () => {
    if (!fichaRef.current) return;
    const pw = window.open('', '', 'height=1100,width=800');
    if (!pw) return;
    pw.document.write(\`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>Doc. Casa do Pastor - \${membro.nome}</title>
      <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;background:#fff;}@media print{@page{margin:8mm;}}</style>
    </head><body>\${fichaRef.current.innerHTML}</body></html>\`);
    pw.document.close();
    setTimeout(() => pw.print(), 300);
  };

  const gerarPDF = async () => {
    if (!fichaRef.current) return;
    try {
      await new Promise(r => setTimeout(r, 400));
      const canvas = await html2canvas(fichaRef.current, {
        scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff', logging: false,
        windowHeight: fichaRef.current.scrollHeight, windowWidth: fichaRef.current.scrollWidth,
      });
      const imgW = 210;
      const imgH = (canvas.height * imgW) / canvas.width;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      let left = imgH; let pos = 0; const ph = 297;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, pos, imgW, imgH);
      left -= ph;
      while (left >= 0) { pos = left - imgH; pdf.addPage(); pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, pos, imgW, imgH); left -= ph; }
      pdf.save(\`DocCasaPastor_\${membro.nome.replace(/\\\\s+/g, '_')}_\${membro.matricula}.pdf\`);
    } catch (e) { alert('Erro ao gerar PDF: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const cargo = fmt(membro.cargo).toUpperCase() || fmt(membro.qualFuncao).toUpperCase();
  const rgCompleto = [fmt(membro.rg), fmt(membro.orgaoEmissor), fmt(membro.uf_rg)].filter(Boolean).join(' ');
  const formacaoTeologica = [fmt(membro.cursoTeologico).toUpperCase(), fmt(membro.instituicaoTeologica)].filter(Boolean).join(' - ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Botoes */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={gerarPDF} style={{ padding: '8px 18px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
          Baixar PDF
        </button>
        <button onClick={imprimirFicha} style={{ padding: '8px 18px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
          Imprimir Documento
        </button>
      </div>

      <div ref={fichaRef} style={{ width: '210mm', margin: '0 auto', padding: '8mm 10mm', fontFamily: 'Arial, sans-serif', fontSize: '11px', lineHeight: '1.3', backgroundColor: '#fff', color: '#222', boxSizing: 'border-box' }}>

        {/* CABECALHO */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <tbody>
            <tr>
              <td style={{ width: '70px', verticalAlign: 'middle', padding: '0 8px 0 0' }}>
                {dadosIgreja.logoUrl
                  ? <img src={dadosIgreja.logoUrl} alt="Logo" style={{ width: '65px', height: '65px', objectFit: 'contain' }} />
                  : <div style={{ width: '65px', height: '65px', border: '1px dashed #999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#999' }}>LOGO</div>
                }
              </td>
              <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '22px', fontWeight: 'bold', letterSpacing: '6px', color: '#0D2B4E' }}>
                  {dadosIgreja.nomeIgreja.toUpperCase()}
                </div>
                {dadosIgreja.endereco && <div style={{ fontSize: '9px', color: '#444', marginTop: '2px' }}>{dadosIgreja.endereco}</div>}
                <div style={{ fontSize: '9px', color: '#444' }}>
                  {[dadosIgreja.telefone && \`Fone: \${dadosIgreja.telefone}\`, dadosIgreja.cnpj && \`CNPJ \${dadosIgreja.cnpj}\`].filter(Boolean).join(' | ')}
                </div>
                <div style={{ fontSize: '11px', fontStyle: 'italic', color: '#0D2B4E', marginTop: '4px' }}>
                  Encaminhamento Para:
                </div>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#0D2B4E', letterSpacing: '1px' }}>
                  ASSOCIACAO CASA DO PASTOR
                </div>
              </td>
              <td style={{ width: '70px', verticalAlign: 'middle', padding: '0 0 0 8px', textAlign: 'right' }}>
                <QRCode value={membro.uniqueId || membro.id} size={62} level="L" fgColor="#003d7a" bgColor="#ffffff" />
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ borderTop: '2px solid #0D2B4E', marginBottom: '5px' }} />

        {/* IDENTIFICACAO */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'top', paddingRight: '6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr><td colSpan={4} style={secHead()}>Identificacao</td></tr>
                    <tr>
                      <td style={lbl}>Nome</td>
                      <td colSpan={3} style={{ ...cell, fontWeight: 'bold', fontSize: '11px' }}>{membro.nome.toUpperCase()}</td>
                    </tr>
                    <tr>
                      <td style={lbl}>Cadastro/ACP</td>
                      <td style={cell}></td>
                      <td style={lbl}>Registro/COMIEADEPA</td>
                      <td style={cell}>{fmt(membro.matricula)}</td>
                    </tr>
                    <tr>
                      <td style={lbl}>Status</td>
                      <td style={{ ...cell, fontWeight: 'bold', color: membro.status === 'ativo' ? '#16a34a' : '#dc2626' }}>
                        {(membro.status || 'ativo').toUpperCase()}
                      </td>
                      <td style={lbl}>Registro CGADB</td>
                      <td style={cell}>{fmt(membro.numero_cgadb)}</td>
                    </tr>
                    <tr>
                      <td style={lbl}>Categoria</td>
                      <td style={{ ...cell, fontWeight: 'bold' }}>{cargo}</td>
                      <td style={lbl}>Data de Filiacao</td>
                      <td style={cell}>{fmtDate(membro.data_filiacao)}</td>
                    </tr>
                    <tr>
                      <td style={lbl}>Campo</td>
                      <td style={cell}>{fmt(membro.campo).toUpperCase()}</td>
                      <td style={lbl}>Supervisao</td>
                      <td style={cell}>{fmt(membro.supervisao).toUpperCase()}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td style={{ width: '90px', verticalAlign: 'top' }}>
                <div style={{ width: '88px', height: '110px', border: '2px solid #0D2B4E', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
                  {fotoUrl
                    ? <img src={fotoUrl} alt={membro.nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: '9px', color: '#bbb' }}>sem foto</span>
                  }
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* DADOS PESSOAIS */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <tbody>
            <tr><td colSpan={6} style={secHead()}>Dados Pessoais</td></tr>
            <tr>
              <td style={lbl}>RG</td>
              <td colSpan={3} style={cell}>{rgCompleto}</td>
              <td style={lbl}>Tipo Sanguineo</td>
              <td style={cell}>{fmt(membro.tipoSanguineo)}</td>
            </tr>
            <tr>
              <td style={lbl}>CPF</td>
              <td style={cell}>{fmt(membro.cpf)}</td>
              <td style={lbl}>Nascimento</td>
              <td style={cell}>{fmtDate(membro.dataNascimento)}</td>
              <td style={lbl}>Estado Civil</td>
              <td style={cell}>{fmt(membro.estadoCivil).toUpperCase()}</td>
            </tr>
            <tr>
              <td style={lbl}>Pai</td>
              <td colSpan={3} style={cell}>{fmt(membro.nomePai).toUpperCase()}</td>
              <td style={lbl}>Nacionalidade</td>
              <td style={cell}>{fmt(membro.nacionalidade).toUpperCase()}</td>
            </tr>
            <tr>
              <td style={lbl}>Mae</td>
              <td colSpan={5} style={cell}>{fmt(membro.nomeMae).toUpperCase()}</td>
            </tr>
            <tr>
              <td style={lbl}>Naturalidade</td>
              <td colSpan={2} style={cell}>{[fmt(membro.naturalidade), fmt(membro.uf)].filter(Boolean).join(', ').toUpperCase()}</td>
              <td style={lbl}>Escolaridade</td>
              <td colSpan={2} style={cell}>{fmt(membro.escolaridade).toUpperCase()}</td>
            </tr>
            <tr>
              <td style={lbl}>Formacao Teologica</td>
              <td colSpan={5} style={cell}>{formacaoTeologica}</td>
            </tr>
            <tr>
              <td style={lbl}>E-Mail</td>
              <td colSpan={3} style={cell}>{fmt(membro.email)}</td>
              <td style={lbl}>Fone</td>
              <td style={cell}>{fmt(membro.celular)}</td>
            </tr>
          </tbody>
        </table>

        {/* CONJUGE */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <tbody>
            <tr><td colSpan={4} style={secHead()}>Conjuge</td></tr>
            <tr>
              <td style={lbl}>Nome do Conjuge</td>
              <td colSpan={3} style={{ ...cell, fontWeight: 'bold' }}>{fmt(membro.nomeConjuge).toUpperCase()}</td>
            </tr>
            <tr>
              <td style={lbl}>Nascimento</td>
              <td style={cell}>{fmtDate(membro.dataNascimentoConjuge)}</td>
              <td style={lbl}>Naturalidade</td>
              <td style={cell}>{fmt(membro.conjuge_naturalidade).toUpperCase()}</td>
            </tr>
          </tbody>
        </table>

        {/* DADOS MINISTERIAIS */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <tbody>
            <tr><td colSpan={4} style={secHead()}>Dados Ministeriais</td></tr>
            <tr>
              <td style={lbl}>Batismo nas Aguas</td>
              <td style={cell}>{fmtDate(membro.dataBatismoAguas)}</td>
              <td style={lbl}>Local</td>
              <td style={cell}>{fmt(membro.ev_autorizado_local)}</td>
            </tr>
            <tr>
              <td style={lbl}>Autorizacao a Evangelista</td>
              <td colSpan={3} style={cell}>{fmtDate(membro.ev_autorizado_data)}</td>
            </tr>
            <tr>
              <td style={lbl}>Consagracao a Evangelista</td>
              <td style={cell}>{fmtDate(membro.ev_consagrado_data)}</td>
              <td style={lbl}>Local</td>
              <td style={cell}>{fmt(membro.ev_consagrado_local)}</td>
            </tr>
            <tr>
              <td style={lbl}>Ordenacao ao Pastorado</td>
              <td style={cell}>{fmtDate(membro.orden_pastor_data)}</td>
              <td style={lbl}>Local</td>
              <td style={cell}>{fmt(membro.orden_pastor_local)}</td>
            </tr>
          </tbody>
        </table>

        {/* OBSERVACOES */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px' }}>
          <tbody>
            <tr><td colSpan={2} style={secHead()}>Observacoes</td></tr>
            <tr>
              <td style={lbl}>Obs.</td>
              <td style={{ ...cell, minHeight: '24px', height: '24px' }}>{fmt(membro.observacoes)}</td>
            </tr>
            <tr>
              <td colSpan={2} style={{ ...cell, height: '24px' }}></td>
            </tr>
            <tr>
              <td colSpan={2} style={{ ...cell, height: '24px' }}></td>
            </tr>
          </tbody>
        </table>

        {/* RODAPE */}
        <div style={{ borderTop: '1px solid #0D2B4E', paddingTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '8px', color: '#555' }}>Secretaria da COMIEADEPA - Belem - PA</span>
          <span style={{ fontSize: '8px', color: '#555', textAlign: 'right' }}>
            {emailUsuario && (<><strong>{emailUsuario}</strong> &nbsp;|&nbsp;</>)}
            {dataCapit}
          </span>
        </div>

      </div>
    </div>
  );
}
`;

const dest = path.join(__dirname, '..', 'src', 'components', 'DocCasaDoPastor.tsx');
fs.writeFileSync(dest, content, { encoding: 'utf8' });
console.log('DocCasaDoPastor.tsx reescrito com layout da FichaMembro. Linhas: ' + content.split('\n').length);
