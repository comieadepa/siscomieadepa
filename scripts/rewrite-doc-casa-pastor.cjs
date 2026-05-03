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

// Abordagem: centralizar pelo lineHeight (funciona no html2canvas)
// linha de 11px + padding 0 + lineHeight 28px => texto centrado na celula
const ROW_H = '28px';

const cell: React.CSSProperties = {
  border: '1px solid #bbb',
  padding: '0 7px',
  fontSize: '11px',
  lineHeight: ROW_H,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

const lbl: React.CSSProperties = {
  ...cell,
  background: '#dce8f5',
  fontWeight: 'bold',
  width: '1%',
  fontSize: '10px',
};

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
      <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:Arial,sans-serif;background:#fff;}
        td,th{line-height:28px;padding:0 7px;overflow:hidden;}
        @media print{@page{margin:8mm;}}
      </style>
    </head><body>\${fichaRef.current.innerHTML}</body></html>\`);
    pw.document.close();
    setTimeout(() => pw.print(), 300);
  };

  const gerarPDF = async () => {
    if (!fichaRef.current) return;
    try {
      await new Promise(r => setTimeout(r, 200));
      const canvas = await html2canvas(fichaRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        onclone: (doc) => {
          // Garante lineHeight nas celulas no clone usado pelo html2canvas
          doc.querySelectorAll('td, th').forEach((el) => {
            (el as HTMLElement).style.lineHeight = ROW_H;
            (el as HTMLElement).style.paddingTop = '0';
            (el as HTMLElement).style.paddingBottom = '0';
          });
        },
      });
      const imgW = 210;
      const imgH = (canvas.height * imgW) / canvas.width;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      let left = imgH; let pos = 0; const ph = 297;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, pos, imgW, imgH);
      left -= ph;
      while (left >= 0) {
        pos = left - imgH;
        pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, pos, imgW, imgH);
        left -= ph;
      }
      pdf.save(\`DocCasaPastor_\${membro.nome.replace(/\\\\s+/g, '_')}_\${membro.matricula}.pdf\`);
    } catch (e) {
      alert('Erro ao gerar PDF: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const cargo = fmt(membro.cargo).toUpperCase() || fmt(membro.qualFuncao).toUpperCase();
  const rgCompleto = [fmt(membro.rg), fmt(membro.orgaoEmissor), membro.uf_rg ? membro.uf_rg : ''].filter(Boolean).join(' ');
  const formacaoTeologica = [fmt(membro.cursoTeologico), fmt(membro.instituicaoTeologica)].filter(Boolean).join(' - ');

  // celulas com texto longo permitido quebrar (nomes, enderecos)
  const wrap: React.CSSProperties = { ...cell, whiteSpace: 'normal', lineHeight: '1.4', padding: '5px 7px' };
  const wrapLbl: React.CSSProperties = { ...lbl, whiteSpace: 'normal', lineHeight: '1.4', padding: '5px 7px' };

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

      <div ref={fichaRef} style={{ width: '210mm', margin: '0 auto', padding: '8mm 10mm', fontFamily: 'Arial, sans-serif', backgroundColor: '#fff', color: '#222', boxSizing: 'border-box' }}>

        {/* CABECALHO */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px' }}>
          <tbody>
            <tr>
              <td style={{ width: '70px', verticalAlign: 'middle', padding: '0 8px 0 0', border: 'none', lineHeight: 'normal' }}>
                {dadosIgreja.logoUrl
                  ? <img src={dadosIgreja.logoUrl} alt="Logo" style={{ width: '65px', height: '65px', objectFit: 'contain', display: 'block' }} />
                  : <div style={{ width: '65px', height: '65px', border: '1px dashed #999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#999' }}>LOGO</div>
                }
              </td>
              <td style={{ textAlign: 'center', verticalAlign: 'middle', border: 'none', lineHeight: 'normal', padding: '0' }}>
                <div style={{ fontSize: '26px', fontWeight: 'bold', letterSpacing: '8px', color: '#0D2B4E', lineHeight: '1.1' }}>
                  {dadosIgreja.nomeIgreja.toUpperCase()}
                </div>
                {dadosIgreja.endereco && <div style={{ fontSize: '9px', color: '#444', marginTop: '2px', lineHeight: '1.3' }}>{dadosIgreja.endereco}</div>}
                <div style={{ fontSize: '9px', color: '#444', lineHeight: '1.3' }}>
                  {[dadosIgreja.telefone && \`Fone: \${dadosIgreja.telefone}\`, dadosIgreja.cnpj && \`CNPJ \${dadosIgreja.cnpj}\`].filter(Boolean).join(' - ')}
                </div>
                <div style={{ fontSize: '14px', fontStyle: 'italic', fontWeight: 'bold', color: '#0D2B4E', marginTop: '6px', lineHeight: '1.3' }}>
                  Encaminhamento Para:
                </div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0D2B4E', letterSpacing: '1px', lineHeight: '1.3' }}>
                  ASSOCIACAO CASA DO PASTOR
                </div>
              </td>
              <td style={{ width: '70px', verticalAlign: 'middle', padding: '0 0 0 8px', textAlign: 'right', border: 'none', lineHeight: 'normal' }}>
                <QRCode value={membro.uniqueId || membro.id} size={62} level="L" fgColor="#003d7a" bgColor="#ffffff" />
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ borderTop: '2px solid #0D2B4E', marginBottom: '6px' }} />

        {/* TABELA PRINCIPAL */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <tbody>

            {/* Cadastro/ACP | Registro/COMIEADEPA | Status */}
            <tr>
              <td style={{ ...lbl, width: '18%' }}>Cadastro/ACP</td>
              <td style={{ ...cell, width: '14%' }}></td>
              <td style={{ ...lbl, width: '22%' }}>Registro/COMIEADEPA</td>
              <td style={{ ...cell, width: '10%' }}>{fmt(membro.matricula)}</td>
              <td style={{ ...lbl, width: '10%' }}>Status</td>
              <td style={{ ...cell, fontWeight: 'bold', color: membro.status === 'ativo' ? '#16a34a' : '#dc2626', width: '26%' }}>
                {(membro.status || 'ativo').toUpperCase()}
              </td>
            </tr>

            {/* Nome + foto rowspan */}
            <tr>
              <td style={lbl}>Nome</td>
              <td colSpan={4} style={{ ...cell, fontWeight: 'bold', fontSize: '13px', lineHeight: ROW_H, overflow: 'hidden' }}>
                {membro.nome.toUpperCase()}
              </td>
              <td rowSpan={5} style={{ border: '1px solid #bbb', verticalAlign: 'top', padding: '4px', textAlign: 'center', width: '88px' }}>
                {fotoUrl
                  ? <img src={fotoUrl} alt={membro.nome} style={{ width: '80px', height: '100px', objectFit: 'cover', border: '1px solid #bbb', display: 'block' }} />
                  : <div style={{ width: '80px', height: '100px', border: '1px dashed #bbb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#bbb' }}>sem foto</div>
                }
              </td>
            </tr>

            {/* Categoria | Registro CGADB */}
            <tr>
              <td style={lbl}>Categoria</td>
              <td style={{ ...cell, fontWeight: 'bold' }}>{cargo}</td>
              <td style={lbl}>Registro CGADB</td>
              <td colSpan={2} style={cell}>{fmt(membro.numero_cgadb)}</td>
            </tr>

            {/* Nascimento | Tipo Sanguineo */}
            <tr>
              <td style={lbl}>Nascimento</td>
              <td style={cell}>{fmtDate(membro.dataNascimento)}</td>
              <td style={lbl}>Tipo Sanguineo</td>
              <td colSpan={2} style={cell}>{fmt(membro.tipoSanguineo)}</td>
            </tr>

            {/* RG | CPF | Data de Filiacao */}
            <tr>
              <td style={lbl}>RG</td>
              <td style={cell}>{rgCompleto}</td>
              <td style={lbl}>CPF</td>
              <td style={cell}>{fmt(membro.cpf)}</td>
              <td style={lbl}>Data de Filiacao</td>
            </tr>
            <tr>
              <td colSpan={5} style={{ ...cell, textAlign: 'right', fontWeight: 'bold' }}>
                {fmtDate(membro.data_filiacao)}
              </td>
            </tr>

            {/* Pai | Estado Civil */}
            <tr>
              <td style={lbl}>Pai</td>
              <td colSpan={2} style={wrap}>{fmt(membro.nomePai).toUpperCase()}</td>
              <td style={lbl}>Estado Civil</td>
              <td colSpan={2} style={cell}>{fmt(membro.estadoCivil).toUpperCase()}</td>
            </tr>

            {/* Mae */}
            <tr>
              <td style={lbl}>Mae</td>
              <td colSpan={5} style={wrap}>{fmt(membro.nomeMae).toUpperCase()}</td>
            </tr>

            {/* Conjuge | Nascimento */}
            <tr>
              <td style={lbl}>Conjuge</td>
              <td colSpan={2} style={{ ...wrap, fontWeight: 'bold' }}>{fmt(membro.nomeConjuge).toUpperCase()}</td>
              <td style={lbl}>Nascimento</td>
              <td colSpan={2} style={cell}>{fmtDate(membro.dataNascimentoConjuge)}</td>
            </tr>

            {/* Nacionalidade | Naturalidade */}
            <tr>
              <td style={lbl}>Nacionalidade</td>
              <td style={{ ...cell, fontWeight: 'bold' }}>{fmt(membro.nacionalidade).toUpperCase()}</td>
              <td style={lbl}>Naturalidade</td>
              <td colSpan={3} style={{ ...cell, fontWeight: 'bold' }}>
                {[fmt(membro.naturalidade), fmt(membro.uf)].filter(Boolean).join(', ').toUpperCase()}
              </td>
            </tr>

            {/* Escolaridade */}
            <tr>
              <td style={lbl}>Escolaridade</td>
              <td colSpan={5} style={{ ...cell, fontWeight: 'bold' }}>{fmt(membro.escolaridade).toUpperCase()}</td>
            </tr>

            {/* Formacao Teologica */}
            <tr>
              <td style={lbl}>Formacao Teologica</td>
              <td colSpan={5} style={{ ...cell, fontWeight: 'bold' }}>{formacaoTeologica.toUpperCase()}</td>
            </tr>

            {/* E-Mail | Fone */}
            <tr>
              <td style={lbl}>E-Mail</td>
              <td colSpan={2} style={cell}>{fmt(membro.email)}</td>
              <td style={lbl}>Fone</td>
              <td colSpan={2} style={cell}>{fmt(membro.celular)}</td>
            </tr>

            {/* Batismo/Aguas | local/Batismo */}
            <tr>
              <td style={lbl}>Batismo/Aguas</td>
              <td style={cell}>{fmtDate(membro.dataBatismoAguas)}</td>
              <td style={lbl}>local/Batismo</td>
              <td colSpan={3} style={cell}>{fmt(membro.ev_autorizado_local)}</td>
            </tr>

            {/* Autorizacao a Evangelista */}
            <tr>
              <td style={lbl}>Autorizacao a Evangelista</td>
              <td colSpan={5} style={cell}>{fmtDate(membro.ev_autorizado_data)}</td>
            </tr>

            {/* Consagracao a Evangelista | Local */}
            <tr>
              <td style={lbl}>Consagracao a Evangelista</td>
              <td style={cell}>{fmtDate(membro.ev_consagrado_data)}</td>
              <td style={lbl}>Local</td>
              <td colSpan={3} style={cell}>{fmt(membro.ev_consagrado_local)}</td>
            </tr>

            {/* Ordenacao ao Pastor | Local */}
            <tr>
              <td style={lbl}>Ordenacao ao Pastor</td>
              <td style={{ ...cell, fontWeight: 'bold' }}>{fmtDate(membro.orden_pastor_data)}</td>
              <td style={lbl}>Local</td>
              <td colSpan={3} style={cell}>{fmt(membro.orden_pastor_local)}</td>
            </tr>

            {/* Campo */}
            <tr>
              <td style={lbl}>Campo</td>
              <td colSpan={5} style={{ ...cell, fontWeight: 'bold' }}>{fmt(membro.campo).toUpperCase()}</td>
            </tr>

            {/* Supervisao */}
            <tr>
              <td style={lbl}>Supervisao</td>
              <td colSpan={5} style={cell}>{fmt(membro.supervisao).toUpperCase()}</td>
            </tr>

            {/* OBSERVACOES header */}
            <tr>
              <td colSpan={6} style={{ border: '1px solid #bbb', background: '#fff', fontWeight: 'bold', color: '#dc2626', textAlign: 'right', fontSize: '11px', lineHeight: ROW_H, padding: '0 8px' }}>
                OBSERVACOES
              </td>
            </tr>

            {/* Area de observacoes */}
            <tr>
              <td colSpan={6} style={{ border: '1px solid #bbb', padding: '6px 7px', fontSize: '11px', height: '60px', verticalAlign: 'top', lineHeight: '1.4' }}>
                {fmt(membro.observacoes)}
              </td>
            </tr>
            <tr><td colSpan={6} style={{ border: '1px solid #bbb', height: '26px' }}></td></tr>
            <tr><td colSpan={6} style={{ border: '1px solid #bbb', height: '26px' }}></td></tr>

          </tbody>
        </table>

        {/* RODAPE */}
        <div style={{ borderTop: '1px solid #0D2B4E', marginTop: '8px', paddingTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '9px', color: '#555' }}>Secretaria da COMIEADEPA - Belem - PA</span>
          <span style={{ fontSize: '9px', color: '#555', textAlign: 'right' }}>
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
console.log('DocCasaDoPastor.tsx reescrito. Linhas: ' + content.split('\n').length);
