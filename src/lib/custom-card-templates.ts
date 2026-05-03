// Templates de cartões personalizados criados pelo usuário

export interface ElementoCartao {
    id: string;
    tipo: 'texto' | 'qrcode' | 'logo' | 'foto-membro' | 'chapa' | 'imagem';
    x: number;
    y: number;
    largura: number;
    altura: number;
    fontSize?: number;
    cor?: string;
    backgroundColor?: string;
    fonte?: string;
    transparencia?: number;
    borderRadius?: number;
    texto?: string;
    alinhamento?: 'left' | 'center' | 'right';
    negrito?: boolean;
    italico?: boolean;
    sublinhado?: boolean;
    imagemUrl?: string;
    visivel: boolean;
}

export interface TemplateCartaoCustomizado {
    id: string;
    nome: string;
    tipoCadastro: 'membro' | 'congregado' | 'ministro' | 'funcionario';
    backgroundUrl?: string;
    elementos: ElementoCartao[];
    corTitulo: string;
    temVerso: boolean;
    elementosVerso?: ElementoCartao[];
    backgroundUrlVerso?: string;
    descricao?: string;
    previewImage?: string; // Caminho para a imagem de preview/miniatura
    variacao?: 'branco'; // Marca como personalizado
    orientacao?: 'landscape' | 'portrait'; // landscape: 297x210mm (padrão), portrait: 210x297mm
}

// ========== TEMPLATES CUSTOMIZADOS ==========
// Template MEMBRO_02 com frente e verso completos

export const TEMPLATE_MEMBRO_02_CUSTOMIZADO: TemplateCartaoCustomizado = {
  id: 'membro-02',
  nome: 'Membro Modelo 02',
  tipoCadastro: 'membro',
  backgroundUrl: '/img/card_membro2f.png',
  backgroundUrlVerso: '/img/card_membro2c.png',
  corTitulo: '#6b7280',
  temVerso: true,
  elementos: [
    {
      id: '1766698021395',
      tipo: 'logo',
      x: 15,
      y: 15,
      largura: 90,
      altura: 90,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      transparencia: 1,
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766698031393',
      tipo: 'foto-membro',
      x: 319,
      y: 112,
      largura: 130,
      altura: 165,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766698059049',
      tipo: 'texto',
      x: 104,
      y: 15,
      largura: 345,
      altura: 53,
      fontSize: 20,
      cor: '#000',
      fonte: 'Verdana',
      texto: 'NOME&nbsp;<div>DA IGREJA</div>',
      alinhamento: 'center',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766698112979',
      tipo: 'texto',
      x: 104,
      y: 67,
      largura: 345,
      altura: 38,
      fontSize: 10,
      cor: '#ef4444',
      fonte: 'Arial',
      texto: 'ENDEREÇO DA IGREJA<div>DADOS DE CONTATO</div><div>SITE/EMAIL</div>',
      alinhamento: 'center',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766698201325',
      tipo: 'texto',
      x: 15,
      y: 180,
      largura: 295,
      altura: 30,
      fontSize: 13,
      cor: '#000000',
      fonte: 'Arial',
      borderRadius: 6,
      backgroundColor: '#ffffff',
      texto: 'MATRÍCULA:&nbsp;<font color="#ef4444">{matricula}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766698310205',
      tipo: 'texto',
      x: 15,
      y: 213,
      largura: 295,
      altura: 30,
      fontSize: 13,
      cor: '#000',
      fonte: 'Arial',
      borderRadius: 6,
      backgroundColor: '#ffffff',
      texto: 'CONGREGAÇÃO: <font color="#ef4444">{divisao3}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766698417605',
      tipo: 'texto',
      x: 15,
      y: 247,
      largura: 295,
      altura: 30,
      fontSize: 13,
      cor: '#000',
      fonte: 'Arial',
      borderRadius: 6,
      backgroundColor: '#ffffff',
      texto: 'NOME:&nbsp;<font color="#ef4444">{nome}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766698534212',
      tipo: 'texto',
      x: 15,
      y: 128,
      largura: 295,
      altura: 35,
      fontSize: 20,
      cor: '#000',
      fonte: 'Verdana',
      texto: 'CARTÃO DE MEMBRO',
      alinhamento: 'center',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    }
  ],
  elementosVerso: [
    {
      id: '1766780864615',
      tipo: 'chapa',
      x: 131,
      y: 82,
      largura: 304,
      altura: 23,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      transparencia: 0.6,
      borderRadius: 4,
      texto: 'CHAPA',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766780571636jo0z4pwnl',
      tipo: 'chapa',
      x: 317,
      y: 169,
      largura: 126,
      altura: 35,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      transparencia: 1,
      borderRadius: 6,
      texto: 'CHAPA',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '17667805716366m1aowyxu',
      tipo: 'chapa',
      x: 151,
      y: 169,
      largura: 160,
      altura: 35,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      transparencia: 1,
      borderRadius: 6,
      texto: 'CHAPA',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766780571636bvwf59de0',
      tipo: 'chapa',
      x: 19,
      y: 168,
      largura: 126,
      altura: 35,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      transparencia: 1,
      borderRadius: 6,
      texto: 'CHAPA',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766780578164ar5unopkq',
      tipo: 'chapa',
      x: 317,
      y: 124,
      largura: 126,
      altura: 35,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      transparencia: 1,
      borderRadius: 6,
      texto: 'CHAPA',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766780578164d9mgr31d0',
      tipo: 'chapa',
      x: 19,
      y: 123,
      largura: 292,
      altura: 35,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      transparencia: 1,
      borderRadius: 6,
      texto: 'CHAPA',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766780219376',
      tipo: 'chapa',
      x: 20,
      y: 215,
      largura: 126,
      altura: 35,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      transparencia: 1,
      borderRadius: 6,
      texto: 'CHAPA',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766780463162runssoccu',
      tipo: 'chapa',
      x: 318,
      y: 216,
      largura: 126,
      altura: 35,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      transparencia: 1,
      borderRadius: 6,
      texto: 'CHAPA',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766780318914sb40je7js',
      tipo: 'chapa',
      x: 152,
      y: 216,
      largura: 160,
      altura: 35,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      transparencia: 1,
      borderRadius: 6,
      texto: 'CHAPA',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766701435750',
      tipo: 'qrcode',
      x: 35,
      y: 17,
      largura: 90,
      altura: 90,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      alinhamento: 'left',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766701497174',
      tipo: 'texto',
      x: 10,
      y: 252,
      largura: 442,
      altura: 30,
      fontSize: 10,
      cor: '#ffffff',
      fonte: 'Arial',
      backgroundColor: '#000000',
      texto: 'Ide por todo o mundo e pregai o evangelho a toda a criatura. MC 16:15<div><font color="#ef4444">Válido somente enquanto o portador se manter fiel a Deus e a Doutrina desta Igreja.</font></div>',
      alinhamento: 'center',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593a8nkcpczi',
      tipo: 'texto',
      x: 26,
      y: 134,
      largura: 282,
      altura: 24,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '<font color="#ef4444">Pai: {nomePai} / Mãe: {nomeMae}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '17667794825933nfyrfhmg',
      tipo: 'texto',
      x: 26,
      y: 124,
      largura: 90,
      altura: 18,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: 'Filiação',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '17667794825931t3s1esri',
      tipo: 'texto',
      x: 158,
      y: 84,
      largura: 250,
      altura: 20,
      fontSize: 12,
      cor: '#000',
      fonte: 'Arial',
      texto: 'Data de Validade:&nbsp;<font color="#ef4444">{validade}</font>',
      alinhamento: 'center',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593u1foluglk',
      tipo: 'texto',
      x: 26,
      y: 168,
      largura: 90,
      altura: 18,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: 'RG',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593uv8wintn3',
      tipo: 'texto',
      x: 26,
      y: 182,
      largura: 115,
      altura: 20,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '<font color="#ef4444">{rg}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593g72ekzpt9',
      tipo: 'texto',
      x: 158,
      y: 168,
      largura: 90,
      altura: 18,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: 'Naturalidade',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593mh9ikg3o4',
      tipo: 'texto',
      x: 158,
      y: 182,
      largura: 150,
      altura: 20,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '<font color="#ef4444">{naturalidade}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593yo3zf3noz',
      tipo: 'texto',
      x: 325,
      y: 168,
      largura: 102,
      altura: 18,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: 'Data de Nascimento',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593dup9z5b60',
      tipo: 'texto',
      x: 325,
      y: 182,
      largura: 110,
      altura: 20,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '<font color="#ef4444">{dataNascimento}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '17667794825939iiatm79s',
      tipo: 'texto',
      x: 25,
      y: 216,
      largura: 90,
      altura: 18,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: 'CPF',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593lp1rmlz7r',
      tipo: 'texto',
      x: 26,
      y: 229,
      largura: 117,
      altura: 20,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '<font color="#ef4444">{cpf}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '176677948259349a37k9o5',
      tipo: 'texto',
      x: 158,
      y: 229,
      largura: 150,
      altura: 20,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '<font color="#ef4444">{nacionalidade}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593tlhj4bod3',
      tipo: 'texto',
      x: 158,
      y: 216,
      largura: 100,
      altura: 18,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: 'Nacionalidade',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593ayzm2h2ob',
      tipo: 'texto',
      x: 325,
      y: 124,
      largura: 90,
      altura: 18,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: 'Data de Batismo',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593b2q5e6zg6',
      tipo: 'texto',
      x: 325,
      y: 134,
      largura: 110,
      altura: 20,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '<font color="#ef4444">{dataBatismo}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '17667794825939fugeylyp',
      tipo: 'texto',
      x: 324,
      y: 216,
      largura: 90,
      altura: 18,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: 'Estadi Civil',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593eplbssa6n',
      tipo: 'texto',
      x: 325,
      y: 229,
      largura: 115,
      altura: 20,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '<font color="#ef4444">{estadoCivil}</font>',
      alinhamento: 'left',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593hl4yxyxdx',
      tipo: 'texto',
      x: 131,
      y: 47,
      largura: 150,
      altura: 32,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '____________________<div>Pastor Presidente</div>',
      alinhamento: 'center',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: '1766779482593x1v89fgsu',
      tipo: 'texto',
      x: 284,
      y: 47,
      largura: 150,
      altura: 32,
      fontSize: 10,
      cor: '#000',
      fonte: 'Arial',
      texto: '____________________<div>Secretário(a)</div>',
      alinhamento: 'center',
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    }
  ],
  previewImage: '/img/card2m.jpg'
};

// Template MINISTRO CLASSICO (Modelo 01) com frente e verso completos
export const TEMPLATE_MINISTRO_CLASSICO_CUSTOMIZADO: TemplateCartaoCustomizado = {
  id: 'ministro-classico',
  nome: 'Credencial de Ministro — Modelo 01',
  tipoCadastro: 'ministro',
  corTitulo: '#A00C0C',
  temVerso: true,
  descricao: 'Credencial ministerial com frente e verso',
  backgroundUrl: '/img/cred_minf.png',
  backgroundUrlVerso: '/img/cred_minc.png',
  elementos: [
    {"id":"1735670001000","tipo":"logo","x":4,"y":2,"largura":124,"altura":144,"fontSize":10,"cor":"#000","fonte":"Arial","transparencia":1,"alinhamento":"left","negrito":false,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1735670002000","tipo":"texto","x":110,"y":13,"largura":334,"altura":53,"fontSize":13,"cor":"#000","fonte":"Georgia","texto":"CONVENÇÃO INTERESTADUAL DE MINISTROS E IGREJAS EVANGÉLICAS ASSEMBLEIAS DE DEUS NO PARÁ","alinhamento":"center","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1735670003000","tipo":"texto","x":108,"y":86,"largura":345,"altura":38,"fontSize":25,"cor":"#A00C0C","fonte":"Akshar Semibold","texto":"MINISTRO DO EVANGELHO","alinhamento":"center","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1735670005000","tipo":"foto-membro","x":355,"y":138,"largura":99,"altura":110,"fontSize":10,"cor":"#000","fonte":"Arial","alinhamento":"left","negrito":false,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1735670006000","tipo":"texto","x":15,"y":226,"largura":295,"altura":30,"fontSize":14,"cor":"#000000","backgroundColor":"","borderRadius":6,"fonte":"Akshar Semibold","texto":"CARGO:&nbsp;<font color=\"#a00c0c\">{cargo_ministerial}</font>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1735670007000","tipo":"texto","x":15,"y":188,"largura":295,"altura":30,"fontSize":14,"cor":"#000","backgroundColor":"","borderRadius":6,"fonte":"Akshar Semibold","texto":"REG.: <font color=\"#a00c0c\">{matricula}</font>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1735670008000","tipo":"texto","x":15,"y":207,"largura":295,"altura":30,"fontSize":14,"cor":"#000","backgroundColor":"","borderRadius":6,"fonte":"Akshar Semibold","texto":"NOME: <font color=\"#a00c0c\">{nome}</font>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"3bb32cd1-0acb-4eeb-a4b8-782cfb3d3efa","tipo":"texto","x":9,"y":252,"largura":446,"altura":33,"fontSize":10,"cor":"#ffffff","fonte":"Akshar","texto":"O portador está devidamente inscrito nesta CONVENÇÃO, podendo realizar as atividades ministeriais inerentes ao cargo, segundo as Sagradas Escrituras e com amparo no Art. 5º Inciso VI e VII da Constituição Federal","alinhamento":"center","negrito":false,"italico":false,"sublinhado":false,"visivel":true}
  ],
  elementosVerso: [
    {"id":"1735670013000","tipo":"texto","x":0,"y":213,"largura":162,"altura":27,"fontSize":8,"cor":"#000","fonte":"Akshar","texto":"WASHINGTON ALVES GOMES<br>1º Secretário","alinhamento":"center","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1767201628647bpwv852t2","tipo":"texto","x":27,"y":53,"largura":261,"altura":20,"fontSize":13,"cor":"#000","fonte":"Akshar Semibold","texto":"RG:&nbsp;<font color=\"#a00c0c\">{rg}</font>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1767201628647sys6lhlln","tipo":"qrcode","x":311,"y":60,"largura":121,"altura":122,"fontSize":10,"cor":"#000","fonte":"Arial","alinhamento":"left","negrito":false,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1767202091623ynvnv6j45","tipo":"texto","x":12,"y":0,"largura":438,"altura":47,"fontSize":13,"cor":"#000","fonte":"Akshar","texto":"<div>Solicitamos às autoridades que prestem todo apoio e auxílio necessário ao desempenho das atribuições de Ministro do Evangelho.</div>","alinhamento":"center","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1777756774935wtwb1tl70","tipo":"texto","x":165,"y":213,"largura":162,"altura":27,"fontSize":8,"cor":"#000","fonte":"Akshar","texto":"OCELIO NAUAR DE ARAUJO<br>Presidente","alinhamento":"center","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"6cd41de3-e39f-4b82-8834-2112e5261a42","tipo":"imagem","x":51,"y":180,"largura":59,"altura":40,"fontSize":10,"cor":"#000","fonte":"Arial","transparencia":1,"alinhamento":"left","negrito":false,"italico":false,"sublinhado":false,"visivel":true,"imagemUrl":"/img/assinatura_secretario.png"},
    {"id":"17777568765992qb0h74qo","tipo":"imagem","x":180,"y":188,"largura":124,"altura":42,"fontSize":10,"cor":"#000","fonte":"Arial","transparencia":1,"alinhamento":"left","negrito":false,"italico":false,"sublinhado":false,"visivel":true,"imagemUrl":"/img/assinatura_presidente.png"},
    {"id":"1777756906786chq5g6ueu","tipo":"texto","x":158,"y":236,"largura":173,"altura":22,"fontSize":16,"cor":"#ffffff","fonte":"Akshar Semibold","texto":"WWW.COMIEADEPA.ORG","alinhamento":"right","negrito":false,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"17777569562636f8zsvs99","tipo":"texto","x":17,"y":254,"largura":428,"altura":31,"fontSize":11,"cor":"#ffffff","fonte":"Akshar Semibold","texto":"<div>Rod. Mário Covas, 2500 - Ananindeua - Pará - CEP 67.110-000 - Fone: (91) 3245-1115<br>CNPJ: 04.760.047/0001-04</div>","alinhamento":"center","negrito":false,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"6eec0efa-8111-48a5-97d5-f4cf2b45141c","tipo":"imagem","x":390,"y":202,"largura":49,"altura":52,"fontSize":10,"cor":"#000","fonte":"Arial","transparencia":1,"alinhamento":"left","negrito":false,"italico":false,"sublinhado":false,"visivel":true,"imagemUrl":"/img/logo_cgadb.png"},
    {"id":"17777571028966ts4a85jk","tipo":"texto","x":311,"y":184,"largura":121,"altura":21,"fontSize":11,"cor":"#000","fonte":"Akshar Semibold","texto":"VALIDADE:&nbsp;<font color=\"#a00c0c\">{validade}</font>","alinhamento":"center","negrito":false,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1777757238895q2sn1gxml","tipo":"texto","x":27,"y":67,"largura":261,"altura":20,"fontSize":13,"cor":"#000","fonte":"Akshar Semibold","texto":"CPF:&nbsp;<font color=\"#a00c0c\">{cpf}</font>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1777757272566sc4kykrtj","tipo":"texto","x":27,"y":94,"largura":261,"altura":20,"fontSize":13,"cor":"#000","fonte":"Akshar Semibold","texto":"NATURALIDADE:<font color=\"#a00c0c\">&nbsp;{naturalidade}</font>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"17777572725668rh5q2649","tipo":"texto","x":27,"y":80,"largura":261,"altura":20,"fontSize":13,"cor":"#000","fonte":"Akshar Semibold","texto":"DATA DE NASCIMENTO:&nbsp;<font color=\"#a00c0c\">{dataNascimento}</font>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"17777572943580y7bte3zo","tipo":"texto","x":27,"y":109,"largura":261,"altura":20,"fontSize":13,"cor":"#000","fonte":"Akshar Semibold","texto":"REG. CGADB:&nbsp;{matricula}","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"1777757294358vu6u0di8o","tipo":"texto","x":27,"y":124,"largura":261,"altura":20,"fontSize":13,"cor":"#000","fonte":"Akshar Semibold","texto":"CONSAGRAÇÃO:&nbsp;<font color=\"#a00c0c\">{dataConsagracao}</font>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"17777572943580gowkt8cz","tipo":"texto","x":27,"y":139,"largura":261,"altura":20,"fontSize":13,"cor":"#000","fonte":"Akshar Semibold","texto":"TIPO SANGUÍNEO:&nbsp;<font color=\"#a00c0c\">{tipoSanguineo}</font>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true},
    {"id":"17777572943587u2rcugr0","tipo":"texto","x":27,"y":152,"largura":261,"altura":38,"fontSize":13,"cor":"#000","fonte":"Akshar Semibold","texto":"<div>FILIAÇÃO:&nbsp;<font color=\"#a00c0c\">{nomePai}</font></div><div><font color=\"#a00c0c\">&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp;</font><font color=\"#a00c0c\">{nomeMae}</font></div>","alinhamento":"left","negrito":true,"italico":false,"sublinhado":false,"visivel":true}
  ]
} as TemplateCartaoCustomizado;

// Template MINISTRO 02 (Modelo 02) - Cópia do modelo 01 sem background
export const TEMPLATE_MINISTRO_02_CUSTOMIZADO: TemplateCartaoCustomizado = {
  id: 'ministro-02',
  nome: 'Ministro Modelo 02',
  tipoCadastro: 'ministro',
  corTitulo: '#d97706',
  temVerso: true,
  descricao: 'Credencial ministerial com frente e verso - Modelo 02',
  backgroundUrl: '/img/card_ministro2f.png',
  backgroundUrlVerso: '/img/card_ministro2c.png',
  previewImage: '/img/card2o.jpg',
  elementos: [
    { id: '1735670001000', tipo: 'logo', x: 359, y: 15, largura: 90, altura: 90, fontSize: 10, cor: '#000', fonte: 'Arial', transparencia: 1, alinhamento: 'left', negrito: false, italico: false, sublinhado: false, visivel: true },
    { id: '1735670002000', tipo: 'texto', x: 15, y: 15, largura: 345, altura: 53, fontSize: 20, cor: '#000', fonte: 'Verdana', texto: 'NOME<div>DA IGREJA</div>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1735670003000', tipo: 'texto', x: 15, y: 67, largura: 345, altura: 38, fontSize: 10, cor: '#d97706', fonte: 'Arial', texto: 'ENDEREÇO DA IGREJA<div>DADOS DE CONTATO</div><div>SITE/EMAIL</div>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1735670004000', tipo: 'texto', x: 15, y: 122, largura: 295, altura: 45, fontSize: 20, cor: '#000', fonte: 'Verdana', texto: 'CREDENCIAL DE MINISTRO', alinhamento: 'center', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1735670005000', tipo: 'foto-membro', x: 319, y: 112, largura: 130, altura: 165, fontSize: 10, cor: '#000', fonte: 'Arial', alinhamento: 'left', negrito: false, italico: false, sublinhado: false, visivel: true },
    { id: '1735670006000', tipo: 'texto', x: 15, y: 245, largura: 295, altura: 30, fontSize: 13, cor: '#000000', backgroundColor: '', borderRadius: 6, fonte: 'Arial', texto: 'NOME: <font color="#ef4444">{nome}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1735670007000', tipo: 'texto', x: 15, y: 188, largura: 295, altura: 30, fontSize: 13, cor: '#000', backgroundColor: '', borderRadius: 6, fonte: 'Arial', texto: 'MATRÍCULA: <font color="#ef4444">{matricula}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1735670008000', tipo: 'texto', x: 15, y: 217, largura: 295, altura: 30, fontSize: 13, cor: '#000', backgroundColor: '', borderRadius: 6, fonte: 'Arial', texto: 'CARGO:<font color="#ef4444"> {cargo_ministerial}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true }
  ],
  elementosVerso: [
    { id: '1735670013000', tipo: 'texto', x: 35, y: 156, largura: 180, altura: 40, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '____________________________<div>Pastor Presidente</div>', alinhamento: 'center', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1735670014000', tipo: 'texto', x: 250, y: 156, largura: 180, altura: 40, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '____________________________<div>Secretário(a)</div>', alinhamento: 'center', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647ujz9v1ry9', tipo: 'texto', x: 237, y: 91, largura: 90, altura: 18, fontSize: 10, cor: '#000', fonte: 'Arial', texto: 'Data de Batismo', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '17672016286477ygtl2bbk', tipo: 'texto', x: 29, y: 22, largura: 303, altura: 24, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">Pai: {nomePai} / Mãe: {nomeMae}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647xky8db3ph', tipo: 'texto', x: 29, y: 12, largura: 90, altura: 18, fontSize: 10, cor: '#000', fonte: 'Arial', texto: 'Filiação', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647bpwv852t2', tipo: 'texto', x: 29, y: 52, largura: 90, altura: 18, fontSize: 10, cor: '#000', fonte: 'Arial', texto: 'RG', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647apu3djicw', tipo: 'texto', x: 29, y: 66, largura: 119, altura: 20, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">{rg}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647d0gc06nvo', tipo: 'texto', x: 29, y: 91, largura: 90, altura: 18, fontSize: 10, cor: '#000', fonte: 'Arial', texto: 'CPF', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647fq9z1jes4', tipo: 'texto', x: 30, y: 105, largura: 117, altura: 20, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">{cpf}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647pnolof1f5', tipo: 'texto', x: 155, y: 52, largura: 90, altura: 18, fontSize: 10, cor: '#000', fonte: 'Arial', texto: 'Naturalidade', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647qt9ju3p9i', tipo: 'texto', x: 157, y: 66, largura: 177, altura: 20, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">{naturalidade}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647s2zj5ezkd', tipo: 'texto', x: 155, y: 105, largura: 75, altura: 20, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">{nacionalidade}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '17672016286474hra4jt61', tipo: 'texto', x: 155, y: 91, largura: 77, altura: 18, fontSize: 10, cor: '#000', fonte: 'Arial', texto: 'Nacionalidade', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647dl196i039', tipo: 'texto', x: 236, y: 105, largura: 99, altura: 20, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">{dataBatismo}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647p4xvc6ktk', tipo: 'texto', x: 342, y: 91, largura: 90, altura: 18, fontSize: 10, cor: '#000', fonte: 'Arial', texto: 'Estadi Civil', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647xddwjscdz', tipo: 'texto', x: 343, y: 106, largura: 99, altura: 20, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">{estadoCivil}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '17672016286475ydb1iqsn', tipo: 'texto', x: 341, y: 52, largura: 102, altura: 18, fontSize: 10, cor: '#000', fonte: 'Arial', texto: 'Data de Nascimento', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647xlmjs086e', tipo: 'texto', x: 343, y: 66, largura: 90, altura: 20, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">{dataNascimento}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647shug4a1n3', tipo: 'texto', x: 342, y: 12, largura: 90, altura: 18, fontSize: 10, cor: '#000', fonte: 'Arial', texto: 'Data de Validade', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647omyzf59wf', tipo: 'texto', x: 343, y: 26, largura: 99, altura: 22, fontSize: 10, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">{validade}</font>', alinhamento: 'left', negrito: true, italico: false, sublinhado: false, visivel: true },
    { id: '1767201628647sys6lhlln', tipo: 'qrcode', x: 30, y: 197, largura: 80, altura: 80, fontSize: 10, cor: '#000', fonte: 'Arial', alinhamento: 'left', negrito: false, italico: false, sublinhado: false, visivel: true },
    { id: '1767202091623ynvnv6j45', tipo: 'texto', x: 119, y: 210, largura: 322, altura: 62, fontSize: 12, cor: '#000', fonte: 'Arial', texto: '<font color="#ef4444">Ide por todo o mundo e pregai o evangelho a toda a criatura. MC 16:15</font><div>Válido somente enquanto o portador se manter fiel a Deus e a doutrina desta Igreja.</div>', alinhamento: 'center', negrito: true, italico: false, sublinhado: false, visivel: true }
  ]
} as TemplateCartaoCustomizado;

// ========== CARTÃO DE FUNCIONÁRIO ==========
// Template FUNCIONÁRIO EM BRANCO (Portrait 210x297mm)

export const TEMPLATE_FUNCIONARIO_BRANCO: TemplateCartaoCustomizado = {
  id: 'funcionario-branco',
  nome: 'Funcionário em Branco',
  tipoCadastro: 'funcionario',
  corTitulo: '#1e40af',
  temVerso: false,
  orientacao: 'portrait', // Portrait: 210mm (largura) x 297mm (altura)
  elementos: [
    // Espaço em branco para preenchimento manual ou dinâmico
    {
      id: 'func-branco-placeholder',
      tipo: 'texto',
      x: 10,
      y: 10,
      largura: 190,
      altura: 40,
      fontSize: 14,
      cor: '#d1d5db',
      fonte: 'Arial',
      texto: '',
      alinhamento: 'center',
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: false
    }
  ]
} as TemplateCartaoCustomizado;

// Template FUNCIONÁRIO CUSTOMIZADO (será preenchido com JSON do usuário)
// Placeholder - aguardando JSON do usuário
export const TEMPLATE_FUNCIONARIO_CUSTOMIZADO: TemplateCartaoCustomizado = {
  id: "funcionario-customizado",
  nome: "Funcionário Customizado",
  tipoCadastro: "funcionario",
  corTitulo: "#1e40af",
  temVerso: false,
  orientacao: "portrait",
  previewImage: "/img/card1f.jpg",
  elementos: [
    {
      id: "func-placeholder",
      tipo: "texto",
      x: 57,
      y: 427,
      largura: 190,
      altura: 30,
      fontSize: 23,
      cor: "#ffffff",
      fonte: "Trebuchet MS",
      texto: "EQUIPE DE APOIO",
      alinhamento: "center",
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: "1767394595432",
      tipo: "texto",
      x: 12,
      y: 15,
      largura: 261,
      altura: 37,
      fontSize: 25,
      cor: "#ffffff",
      fonte: "Trebuchet MS",
      texto: "NOME DO EVENTO",
      alinhamento: "center",
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: "1767394809260",
      tipo: "imagem",
      x: 86,
      y: 75,
      largura: 120,
      altura: 160,
      fontSize: 10,
      cor: "#000",
      fonte: "Arial",
      transparencia: 1,
      alinhamento: "left",
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: "1767394857839",
      tipo: "texto",
      x: 20,
      y: 276,
      largura: 250,
      altura: 37,
      fontSize: 19,
      cor: "#000",
      fonte: "Trebuchet MS",
      texto: "NOME DO VOLUNTÁRIO",
      alinhamento: "center",
      negrito: true,
      italico: false,
      sublinhado: false,
      visivel: true
    },
    {
      id: "1767394900479",
      tipo: "qrcode",
      x: 105,
      y: 323,
      largura: 92,
      altura: 88,
      fontSize: 10,
      cor: "#000",
      fonte: "Arial",
      alinhamento: "left",
      negrito: false,
      italico: false,
      sublinhado: false,
      visivel: true
    }
  ],
  criadoEm: "2026-01-02T22:44:48.361Z",
  atualizadoEm: "2026-01-02T23:03:46.253Z",
  tipo: "funcionario",
  ativo: true,
  backgroundUrl: "/img/card_funcionario.png"
} as TemplateCartaoCustomizado;

// Array com todos os templates customizados
export const TEMPLATES_CUSTOMIZADOS: TemplateCartaoCustomizado[] = [
    // Ministro (único modelo)
    TEMPLATE_MINISTRO_CLASSICO_CUSTOMIZADO,
    // Funcionário
    TEMPLATE_FUNCIONARIO_BRANCO,
    TEMPLATE_FUNCIONARIO_CUSTOMIZADO
];

/**
 * Obtém template customizado por ID
 */
export function getTemplateCustomizado(id: string): TemplateCartaoCustomizado | undefined {
    return TEMPLATES_CUSTOMIZADOS.find(t => t.id === id);
}

/**
 * Obtém templates customizados por tipo
 */
export function getTemplatesCustomizadosPorTipo(tipo: 'membro' | 'congregado' | 'ministro' | 'funcionario'): TemplateCartaoCustomizado[] {
    return TEMPLATES_CUSTOMIZADOS.filter(t => t.tipoCadastro === tipo);
}
