'use client';

import React, { useRef, useEffect, useState } from 'react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
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
  casaDoPastorAcp?: string;
  numeroProcesso?: string;
  tipoRegistro?: string;
  categoriaRegistro?: string;
  regiao?: string;
}

interface DadosIgreja {
  nomeIgreja: string;
  endereco: string;
  telefone: string;
  email: string;
  cnpj?: string;
  logoUrl?: string;
}

interface FichaMembroProps {
  membro: DadosMembro;
  dadosIgreja: DadosIgreja;
  fotoUrl?: string;
  isCandidato?: boolean;
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
  padding: '3px 5px',
  fontSize: '8.5px',
  lineHeight: '1.25',
  verticalAlign: 'middle',
  overflow: 'visible',
  whiteSpace: 'normal',
};

const lbl: React.CSSProperties = {
  ...cell,
  background: '#f0f0f0',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
};

const renderSectionHeader = (title: string, color = '#003d7a') => (
  <div style={{
    background: color,
    color: '#fff',
    fontWeight: 'bold',
    fontSize: '9px',
    padding: '3px 6px',
    minHeight: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    letterSpacing: '0.5px',
    boxSizing: 'border-box',
    width: '100%',
  }}>
    {title.toUpperCase()}
  </div>
);

export default function FichaMembro({ membro, dadosIgreja, fotoUrl, isCandidato = false }: FichaMembroProps) {
  const fichaRef = useRef<HTMLDivElement>(null);
  const [emailUsuario, setEmailUsuario] = useState('');

  useEffect(() => {
    const sb = createClient();
    (async () => {
      const { data } = await sb.auth.getUser();
      setEmailUsuario(data?.user?.email || '');
    })();
  }, []);

  const dataPrint = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const dataCapit = dataPrint.charAt(0).toUpperCase() + dataPrint.slice(1);

  const imprimirFicha = () => {
    if (!fichaRef.current) return;
    const pw = window.open('', '', 'height=1100,width=800');
    if (!pw) return;
    pw.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>${isCandidato ? 'Comissão - Dados do Candidato' : 'Ficha Convencional'} - ${membro.nome}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:Arial,sans-serif;background:#fff;}
        @media print{
          @page{size: A4 portrait; margin: 6mm;}
          .print-block{page-break-inside:avoid;break-inside:avoid;}
          .no-print{display:none !important;}
        }
      </style>
    </head><body>${fichaRef.current.innerHTML}</body></html>`);
    pw.document.close();
    setTimeout(() => pw.print(), 300);
  };

  const cargo = fmt(membro.cargo).toUpperCase() || fmt(membro.qualFuncao).toUpperCase();
  const acpCarregando = membro.casaDoPastorAcp === 'carregando';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Botoes */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} className="no-print">
        <button
          onClick={imprimirFicha}
          disabled={acpCarregando}
          style={{ padding: '8px 18px', backgroundColor: acpCarregando ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: acpCarregando ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '13px', opacity: acpCarregando ? 0.6 : 1 }}
        >
          Imprimir Ficha
        </button>
        {acpCarregando && (
          <span style={{ fontSize: '12px', color: '#6b7280', fontStyle: 'italic' }}>
            Consultando Casa do Pastor...
          </span>
        )}
      </div>

      {/* CONTEÚDO PRINCIPAL (Exibido no modal e clonado na impressão) */}
      <div ref={fichaRef} style={{ width: '210mm', margin: '0 auto', padding: '4mm 6mm', fontFamily: 'Arial, sans-serif', fontSize: '9.5px', lineHeight: '1.25', backgroundColor: '#fff', color: '#222', boxSizing: 'border-box' }}>
        
        {/* CABECALHO INSTITUCIONAL */}
        <table className="print-block" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', marginBottom: '2px' }}>
          <colgroup>
            <col style={{ width: '60px' }} />
            <col style={{ width: 'auto' }} />
            <col style={{ width: '60px' }} />
          </colgroup>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'middle', paddingRight: '6px' }}>
                {dadosIgreja.logoUrl
                  ? <img src={dadosIgreja.logoUrl} alt="Logo" style={{ width: '55px', height: '55px', objectFit: 'contain' }} />
                  : <div style={{ width: '55px', height: '55px', border: '1px dashed #999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#999' }}>LOGO</div>
                }
              </td>
              <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '4px', color: '#0D2B4E' }}>
                  {dadosIgreja.nomeIgreja.toUpperCase()}
                </div>
                {dadosIgreja.endereco && <div style={{ fontSize: '8px', color: '#444', marginTop: '1px' }}>{dadosIgreja.endereco}</div>}
                <div style={{ fontSize: '8px', color: '#444' }}>
                  {[dadosIgreja.telefone && `Fone: ${dadosIgreja.telefone}`, dadosIgreja.cnpj && `CNPJ ${dadosIgreja.cnpj}`].filter(Boolean).join(' | ')}
                </div>
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#0D2B4E', marginTop: '2px', letterSpacing: '1px' }}>
                  {isCandidato ? 'Comissão - Dados do Candidato' : 'Ficha Convencional'}
                </div>
              </td>
              <td style={{ verticalAlign: 'middle', paddingLeft: '6px', textAlign: 'right' }}>
                <QRCode value={membro.uniqueId || membro.id} size={52} level="L" fgColor="#003d7a" bgColor="#ffffff" />
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ borderTop: '2px solid #0D2B4E', marginBottom: '4px' }} />

        {/* PROCESSO SUPERIOR */}
        {isCandidato && (
          <div className="print-block" style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            minHeight: '20px',
            width: '100%',
            border: '1px solid #0D2B4E',
            backgroundColor: '#e0f2fe',
            marginBottom: '2px',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '9px',
            fontWeight: 'bold',
            color: '#0D2B4E',
            boxSizing: 'border-box'
          }}>
            <div>
              Nº DO PROCESSO: <span style={{ color: '#222', marginLeft: '4px' }}>{fmt(membro.numeroProcesso) || '—'}</span>
            </div>
            <div>
              CATEGORIA DE REGISTRO: <span style={{ color: '#222', marginLeft: '4px' }}>{fmt(membro.categoriaRegistro).toUpperCase() || '—'}</span>
            </div>
          </div>
        )}

        {/* DADOS ECLESIASTICOS + FOTO */}
        <table className="print-block" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', marginBottom: '2px' }}>
          <colgroup>
            <col style={{ width: 'auto' }} />
            <col style={{ width: '78px' }} />
          </colgroup>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'top', paddingRight: '4px' }}>
                {renderSectionHeader('Dados Eclesiásticos')}
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                  <colgroup>
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '25%' }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <td style={lbl}>Nome</td>
                      <td colSpan={3} style={{ ...cell, fontWeight: 'bold', fontSize: '10px' }}>{membro.nome.toUpperCase()}</td>
                    </tr>
                    <tr>
                      <td style={lbl}>Data de Filiação</td>
                      <td style={cell}>{fmtDate(membro.data_filiacao)}</td>
                      <td style={lbl}>Status</td>
                      <td style={{ ...cell, fontWeight: 'bold', color: membro.status === 'ativo' ? '#16a34a' : '#dc2626' }}>
                        {(membro.status || 'ativo').toUpperCase()}
                      </td>
                    </tr>
                    <tr>
                      <td style={lbl}>Registro No</td>
                      <td style={cell}>{fmt(membro.matricula)}</td>
                      <td style={lbl}>Registro CGADB</td>
                      <td style={cell}>{fmt(membro.numero_cgadb)}</td>
                    </tr>
                    <tr>
                      <td style={lbl}>Batismo nas Águas</td>
                      <td style={cell}>{fmtDate(membro.dataBatismoAguas)}</td>
                      <td style={lbl}>Autorização a Evangelista</td>
                      <td style={cell}>{fmtDate(membro.ev_autorizado_data)}{membro.ev_autorizado_local ? ` - ${membro.ev_autorizado_local}` : ''}</td>
                    </tr>
                    <tr>
                      <td style={lbl}>Consagração a Evangelista</td>
                      <td style={cell}>{fmtDate(membro.ev_consagrado_data)}{membro.ev_consagrado_local ? ` - ${membro.ev_consagrado_local}` : ''}</td>
                      <td style={lbl}>Casa do Pastor</td>
                      <td style={{
                        ...cell,
                        fontWeight: 'bold',
                        color: membro.casaDoPastorAcp === 'adimplente' ? '#166534'
                          : membro.casaDoPastorAcp === 'inadimplente' ? '#991b1b'
                          : undefined
                      }}>
                        {membro.casaDoPastorAcp === 'carregando' ? 'Consultando...'
                          : membro.casaDoPastorAcp === 'adimplente' ? 'ADIMPLENTE'
                          : membro.casaDoPastorAcp === 'inadimplente' ? 'INADIMPLENTE'
                          : membro.casaDoPastorAcp === 'nao_encontrado' ? 'NÃO ENCONTRADO'
                          : membro.casaDoPastorAcp === 'erro' ? 'Indisponível'
                          : membro.casaDoPastorAcp === 'sem_cpf' ? 'CPF não informado'
                          : fmt(membro.posicaoNoCampo).toUpperCase()}
                      </td>
                    </tr>
                    <tr>
                      <td style={lbl}>Ordenação ao Pastorado</td>
                      <td style={cell}>{fmtDate(membro.orden_pastor_data)}{membro.orden_pastor_local ? ` - ${membro.orden_pastor_local}` : ''}</td>
                      <td style={lbl}>Profissão</td>
                      <td style={cell}>{fmt(membro.profissao)}</td>
                    </tr>
                    <tr>
                      <td style={lbl}>Campo</td>
                      <td style={cell}>{fmt(membro.campo).toUpperCase()}</td>
                      <td style={lbl}>Cargo</td>
                      <td style={{ ...cell, fontWeight: 'bold' }}>{cargo}</td>
                    </tr>
                    <tr>
                      <td style={lbl}>Supervisão</td>
                      <td colSpan={3} style={cell}>{fmt(membro.supervisao).toUpperCase()}</td>
                    </tr>
                    {(membro.numeroProcesso || membro.categoriaRegistro || membro.regiao) && (
                      <tr>
                        <td style={lbl}>Processo / Cat. / Região</td>
                        <td colSpan={3} style={cell}>
                          {[membro.numeroProcesso && `Proc: ${membro.numeroProcesso}`, membro.categoriaRegistro, membro.regiao].filter(Boolean).join(' - ').toUpperCase()}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </td>
              <td style={{ verticalAlign: 'top', paddingTop: '16px' }}>
                <div style={{ width: '76px', height: '95px', border: '1px solid #0D2B4E', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
                  {fotoUrl
                    ? <img src={fotoUrl} alt={membro.nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: '16px', color: '#bbb' }}>foto</span>
                  }
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* DADOS PESSOAIS */}
        <div className="print-block" style={{ marginBottom: '2px' }}>
          {renderSectionHeader('Dados Pessoais')}
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '21%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '21%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '22%' }} />
            </colgroup>
            <tbody>
              <tr>
                <td style={lbl}>RG</td>
                <td style={cell}>{fmt(membro.rg)}{membro.orgaoEmissor ? ` ${membro.orgaoEmissor}` : ''}{membro.uf_rg ? `-${membro.uf_rg}` : ''}</td>
                <td style={lbl}>CPF</td>
                <td style={cell}>{fmt(membro.cpf)}</td>
                <td style={lbl}>Nacionalidade</td>
                <td style={cell}>{fmt(membro.nacionalidade)}</td>
              </tr>
              <tr>
                <td style={lbl}>Pai</td>
                <td colSpan={3} style={cell}>{fmt(membro.nomePai).toUpperCase()}</td>
                <td style={lbl}>Tipo Sanguíneo</td>
                <td style={cell}>{fmt(membro.tipoSanguineo)}</td>
              </tr>
              <tr>
                <td style={lbl}>Mãe</td>
                <td colSpan={5} style={cell}>{fmt(membro.nomeMae).toUpperCase()}</td>
              </tr>
              <tr>
                <td style={lbl}>Nascimento</td>
                <td style={cell}>{fmtDate(membro.dataNascimento)}</td>
                <td style={lbl}>Naturalidade</td>
                <td style={cell}>{fmt(membro.naturalidade)}{membro.uf ? `, ${membro.uf}` : ''}</td>
                <td style={lbl}>Estado Civil</td>
                <td style={cell}>{fmt(membro.estadoCivil)}</td>
              </tr>
              <tr>
                <td style={lbl}>Escolaridade</td>
                <td style={cell}>{fmt(membro.escolaridade).toUpperCase()}</td>
                <td style={lbl}>Curso Teológico</td>
                <td colSpan={3} style={cell}>{[fmt(membro.cursoTeologico).toUpperCase(), fmt(membro.instituicaoTeologica)].filter(Boolean).join(' - ')}</td>
              </tr>
              <tr>
                <td style={lbl}>E-Mail</td>
                <td colSpan={3} style={cell}>{fmt(membro.email)}</td>
                <td style={lbl}>Fone</td>
                <td style={cell}>{fmt(membro.celular)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* FAMILIA */}
        <div className="print-block" style={{ marginBottom: '2px' }}>
          <div style={{ display: 'flex', width: '100%' }}>
            <div style={{ flex: 1, marginRight: '4px' }}>
              {renderSectionHeader('Família')}
            </div>
            <div style={{ width: '76px' }}>
              {renderSectionHeader('Foto da Esposa')}
            </div>
          </div>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <colgroup>
              <col style={{ width: '25%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '76px' }} />
            </colgroup>
            <tbody>
              <tr>
                <td style={lbl}>Cônjuge</td>
                <td colSpan={4} style={{ ...cell, fontWeight: 'bold' }}>{fmt(membro.nomeConjuge).toUpperCase()}</td>
                <td rowSpan={7} style={{ ...cell, width: '76px', verticalAlign: 'middle', padding: '2px', textAlign: 'center' }}>
                  {membro.conjuge_foto_url
                    ? <img src={membro.conjuge_foto_url} alt="Esposa" style={{ width: '70px', height: '88px', objectFit: 'cover', border: '1px solid #bbb' }} />
                    : <div style={{ width: '70px', height: '88px', border: '1px dashed #bbb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#bbb' }}>sem foto</div>
                  }
                </td>
              </tr>
              <tr>
                <td style={lbl}>Data Nasc. da Esposa</td>
                <td style={cell}>{fmtDate(membro.dataNascimentoConjuge)}</td>
                <td style={lbl}>Naturalidade</td>
                <td colSpan={2} style={cell}>{fmt(membro.conjuge_naturalidade)}</td>
              </tr>
              <tr>
                <td style={lbl}>RG da Esposa</td>
                <td style={cell}>{fmt(membro.conjuge_rg)}</td>
                <td style={lbl}>CPF da Esposa</td>
                <td colSpan={2} style={cell}>{fmt(membro.cpfConjuge)}</td>
              </tr>
              <tr>
                <td style={lbl}>Pai</td>
                <td style={cell}>{fmt(membro.conjuge_nome_pai)}</td>
                <td style={lbl}>Mãe</td>
                <td colSpan={2} style={cell}>{fmt(membro.conjuge_nome_mae)}</td>
              </tr>
              <tr>
                <td style={lbl}>Tipo Sanguíneo da Esposa</td>
                <td style={cell}>{fmt(membro.conjuge_tipo_sanguineo)}</td>
                <td style={lbl}>Título de eleitor da Esposa</td>
                <td colSpan={2} style={cell}>{fmt(membro.conjuge_titulo_eleitoral)}</td>
              </tr>
              <tr>
                <td style={lbl}>Fone da Esposa</td>
                <td style={cell}>{fmt(membro.conjuge_fone)}</td>
                <td style={lbl}>E-Mail Esposa</td>
                <td colSpan={2} style={cell}>{fmt(membro.conjuge_email)}</td>
              </tr>
              <tr>
                <td style={lbl}>Filhos</td>
                <td style={cell}>{membro.qtd_filhos != null ? String(membro.qtd_filhos) : ''}</td>
                <td style={lbl}>No AEMADEPA</td>
                <td colSpan={2} style={cell}>{fmt(membro.numero_aemadepa)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* DADOS RESIDENCIAIS */}
        <div className="print-block" style={{ marginBottom: '2px' }}>
          {renderSectionHeader('Dados Residenciais')}
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '21%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '21%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '22%' }} />
            </colgroup>
            <tbody>
              <tr>
                <td style={lbl}>Endereço</td>
                <td colSpan={3} style={cell}>{[fmt(membro.logradouro), fmt(membro.numero)].filter(Boolean).join(', ').toUpperCase()}</td>
                <td style={lbl}>CEP</td>
                <td style={cell}>{fmt(membro.cep)}</td>
              </tr>
              <tr>
                <td style={lbl}>Bairro</td>
                <td colSpan={2} style={cell}>{fmt(membro.bairro).toUpperCase()}</td>
                <td style={lbl}>Cidade/UF</td>
                <td colSpan={2} style={cell}>{[fmt(membro.cidade), fmt(membro.uf)].filter(Boolean).join('/').toUpperCase()}</td>
              </tr>
              <tr>
                <td style={lbl}>Complemento</td>
                <td colSpan={5} style={cell}>{fmt(membro.complemento).toUpperCase()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* RODAPE / OBSERVACOES / COMISSAO */}
        {isCandidato ? (
          <div className="print-block" style={{ marginBottom: '2px' }}>
            {renderSectionHeader('Comissão')}
            <div style={{ border: '1px solid #bbb', borderTop: 'none', padding: '6px' }}>
              {/* Parecer da comissão */}
              <div style={{ marginTop: '2px', marginBottom: '11px' }}>
                <strong style={{ fontSize: '8.5px' }}>Parecer da comissão</strong>
                <div style={{ marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ borderBottom: '1px solid #999', height: '10px' }}></div>
                  <div style={{ borderBottom: '1px solid #999', height: '10px' }}></div>
                </div>
              </div>

              {/* Tabela COMISSÃO */}
              <div style={{ marginTop: '4px', marginBottom: '4px' }}>
                <strong style={{ display: 'block', marginBottom: '2px', fontSize: '8.5px' }}>COMISSÃO</strong>
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '8px' }}>
                  <thead>
                    <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                      <th style={{ border: '1px solid #bbb', padding: '3px 5px', textAlign: 'left', width: '70%', fontSize: '8.5px' }}>Nome</th>
                      <th style={{ border: '1px solid #bbb', padding: '3px 5px', textAlign: 'left', width: '30%', fontSize: '8.5px' }}>Assinatura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...Array(6)].map((_, idx) => (
                      <tr key={idx}>
                        <td style={{ border: '1px solid #bbb', height: '22px', padding: '3px 5px' }}></td>
                        <td style={{ border: '1px solid #bbb', height: '22px', padding: '3px 5px' }}></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Deferimento e assinatura do presidente */}
              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '9px' }}>
                <div>
                  <strong>Data de deferimento:</strong> ____/____/________
                </div>
                <div style={{ textAlign: 'center', minWidth: '200px' }}>
                  <div style={{ height: '24px' }}></div>
                  <div style={{ borderTop: '1px solid #000', width: '100%', margin: '0 auto 2px auto' }}></div>
                  <strong>Pr. Océlio Nauar de Araújo</strong><br />
                  Presidente
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="print-block" style={{ marginBottom: '2px' }}>
            {renderSectionHeader('Observações')}
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={lbl}>Obs.</td>
                  <td style={cell}>{fmt(membro.observacoes)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* RODAPE */}
        <div style={{ borderTop: '1px solid #0D2B4E', paddingTop: '2px', marginTop: '3px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '6.5px', color: '#555' }}>Secretaria da COMIEADEPA - Belém - PA</span>
          <span style={{ fontSize: '6.5px', color: '#555', textAlign: 'right' }}>
            {emailUsuario && (<><strong>{emailUsuario}</strong> &nbsp;|&nbsp;</>)}
            {dataCapit}
          </span>
        </div>

      </div>
    </div>
  );
}
