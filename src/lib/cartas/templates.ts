export type CartaTipo = 'requerimento_cgadb' | 'carta_recomendacao' | 'carta_mudanca';

export type CartaDados = {
  ministroNome: string;
  matricula?: string | null;
  cpf?: string | null;
  rg?: string | null;
  registroCgadb?: string | null;
  dataFiliacao?: string | null;
  dataEmissao: string;
  presidente: string;
  cidadeUf: string;
  observacoesInternas?: string | null;
  destinoPresidente?: string | null;
  destinoConvencao?: string | null;
  destinoSigla?: string | null;
  destinoCidadeUf?: string | null;
};

export type CartaTextoResult = {
  titulo: string;
  texto: string;
  validade?: string;
};

const fmtDate = (value?: string | null) => {
  if (!value) return '';
  const dt = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString('pt-BR');
};

const addDays = (value: string, days: number) => {
  const dt = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(dt.getTime())) return '';
  dt.setDate(dt.getDate() + days);
  return dt.toLocaleDateString('pt-BR');
};

export const getCartaTitulo = (tipo: CartaTipo) => {
  switch (tipo) {
    case 'requerimento_cgadb':
      return 'REQUERIMENTO CGADB';
    case 'carta_recomendacao':
      return 'CARTA DE RECOMENDACAO';
    case 'carta_mudanca':
      return 'CARTA DE MUDANCA';
    default:
      return 'CARTA';
  }
};

export const buildCartaTexto = (tipo: CartaTipo, dados: CartaDados): CartaTextoResult => {
  if (tipo === 'carta_recomendacao') {
    const validade = addDays(dados.dataEmissao, 90);
    const registro = dados.registroCgadb || dados.matricula || '____';
    const texto = [
      'As\nIgrejas Evangelicas.\nPor onde transitar o Pr. **' + dados.ministroNome + '**',
      '**__Assunto: Carta de Apresentacao__**',
      `A COMIEADEPA (Convencao Interestadual de Ministros e Igrejas Evangelicas Assembleia de Deus no Estado do Para), por meio de seu Presidente, Pr. ${dados.presidente}, no uso de suas atribuicoes, apresenta o amado Pr. **${dados.ministroNome}**, filiado a esta Convencao sob o numero de registro **${registro}**, estando em plena comunhao com nossa Convencao.`,
      'Recomendamos que o recebais com amor e hospitalidade crista, conforme o fazem os santos.',
      'Aproveitamos a oportunidade para reiterar nossos votos de estima e consideracao, desejando paz no Senhor Jesus.',
      'Obs.: Esta carta tem prazo de validade de 90 dias a contar da data de emissao.',
      `[[right]]${dados.cidadeUf}, ${fmtDate(dados.dataEmissao)}.`,
    ].filter(Boolean).join('\n\n');

    return {
      titulo: getCartaTitulo(tipo),
      texto,
      validade,
    };
  }

  if (tipo === 'carta_mudanca') {
    const destinoNome = dados.destinoConvencao || '____';
    const destinoSigla = dados.destinoSigla || '____';
    const destinoPresidente = dados.destinoPresidente || '____';
    const matriculaMudanca = dados.matricula || '____';
    const cpfMudanca = dados.cpf || '____';
    const rgMudanca = dados.rg || '____';

    const texto = [
      `EXMO. Pr. ${destinoPresidente}`,
      `Mui Digno Presidente da **${destinoSigla}**`,
      '**__Assunto: Transferencia de Ministro__**',
      `A COMIEADEPA (Convencao Interestadual de Ministros e Igrejas Evangelicas Assembleia de Deus no Estado do Para), atendendo a solicitacao do Ministro Pr. **${dados.ministroNome}**, matricula n. **${matriculaMudanca}**, CPF ${cpfMudanca}, RG ${rgMudanca} resolve, por meio deste ato, expedir Carta de Transferencia em favor do referido ministro, destinada a ${destinoNome}, **${destinoSigla}**.`,
      'Declaramos que o referido ministro prestou relevantes servicos a esta Convencao durante o periodo em que esteve sob nossa jurisdicao, conduzindo-se de forma digna, etica e comprometida com a obra do Senhor.',
      'O ministro mencionado, encontra-se em comunhao. Sendo assim o recomendamos para que o recebais no Senhor, como convem aos santos, confiando que continuara a exercer seu ministerio com zelo, fidelidade e dedicacao.',
      'Aproveitamos a oportunidade para renovar nossos votos de elevada estima e distinta consideracao.',
      `[[right]]${dados.cidadeUf}, ${fmtDate(dados.dataEmissao)}.`,
    ].join('\n\n');

    return {
      titulo: getCartaTitulo(tipo),
      texto,
    };
  }

  const registro = dados.registroCgadb || dados.matricula || '____';
  const filiacao = dados.dataFiliacao ? fmtDate(dados.dataFiliacao) : '____';

  const texto = [
    'A\nConvencao Geral das Assembleias de Deus no Brasil - CGADB',
    '**Assunto: Atualizacao de Cadastro de Ministro**',
    'Prezados Senhores,',
    `A Convencao Interestadual de Ministros e Igrejas Evangelicas Assembleias de Deus no Estado do Para - COMIEADEPA, por meio de sua Secretaria, vem respeitosamente a presenca de Vossas Senhorias informar que o Pastor **${dados.ministroNome}**, registro n. **${registro}**, passa, a partir de ${filiacao}, a integrar o quadro de ministros filiados a esta Convencao.`,
    'Diante do exposto, solicitamos a gentileza de proceder com a devida **atualizacao cadastral** junto a essa respeitavel Convencao Geral, para que conste o referido ministro como pertencente a COMIEADEPA.',
    'Sem mais para o momento, renovamos nossos votos de estima e consideracao.',
    'Atenciosamente,',
    `[[right]]${dados.cidadeUf}, ${fmtDate(dados.dataEmissao)}`,
  ].join('\n\n');

  return {
    titulo: getCartaTitulo(tipo),
    texto,
  };
};
