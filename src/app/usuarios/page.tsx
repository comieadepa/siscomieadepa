'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { createClient } from '@/lib/supabase-client';
import { fetchConfiguracaoIgrejaFromSupabase } from '@/lib/igreja-config-utils';


interface Usuario {
  id: string;
  nome: string;
  email: string;
  email_confirmed?: boolean;
  nivel: 'super' | 'administrador' | 'cgadb' | 'comissao' | 'inscricao' | 'financeiro';
  congregacao?: string;
  congregacao_id?: string | null;
  supervisao?: string;
  cpf?: string;
  celular?: string;
  status: 'ativo' | 'inativo';
}

interface NivelAcesso {
  id: string;
  nome: string;
  descricao: string;
  icon: string;
  cor: string;
}

interface CongregacaoOption {
  id: string;
  nome: string;
}

export default function UsuariosPage() {
  const [activeMenu, setActiveMenu] = useState('usuarios');
  const { loading: authLoading } = useRequireSupabaseAuth();
  const supabase = useMemo(() => createClient(), []);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuariosLoading, setUsuariosLoading] = useState(true);
  const [usuariosError, setUsuariosError] = useState('');
  const [congregacoes, setCongregacoes] = useState<CongregacaoOption[]>([]);
  const [congregacoesLoading, setCongregacoesLoading] = useState(true);
  const [formData, setFormData] = useState({
    nome: '',
    email: '',
    nivel: '',
    congregacao_id: '',
    cpf: '',
    celular: '',
    senha: '',
    confirmar_senha: '',
    subcategoria: '',
  });
  const [formError, setFormError] = useState('');
  const [formStatus, setFormStatus] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [usuarioParaRemover, setUsuarioParaRemover] = useState<Usuario | null>(null);
  const [removendoUsuario, setRemovendoUsuario] = useState(false);
  const [usuarioParaDesativar, setUsuarioParaDesativar] = useState<Usuario | null>(null);
  const [desativando, setDesativando] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');
  const [editEmailConfirmed, setEditEmailConfirmed] = useState(true);
  const [editOriginalStatus, setEditOriginalStatus] = useState<'ativo' | 'inativo'>('ativo');
  const [editData, setEditData] = useState({
    user_id: '',
    nome: '',
    email: '',
    nivel: '',
    congregacao_id: '',
    cpf: '',
    subcategoria: '',
    celular: '',
    status: 'ativo',
    senha: '',
    confirmar_senha: '',
  });

  const [showForm, setShowForm] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [nomeSugestoes, setNomeSugestoes] = useState<{ name: string; cpf: string; phone: string }[]>([]);
  const [cpfAutoPreenchido, setCpfAutoPreenchido] = useState(false);
  const [celularAutoPreenchido, setCelularAutoPreenchido] = useState(false);
  const [nomeBuscando, setNomeBuscando] = useState(false);
  const [nomeFoco, setNomeFoco] = useState(false);
  const itemsPerPage = 5;

  const totalUsuarios = usuarios.length;

  const nivelAcessoInfo: NivelAcesso[] = [
    {
      id: 'super',
      nome: 'Super',
      descricao: 'Acesso total ao sistema',
      icon: '🔑',
      cor: 'bg-yellow-100 border-yellow-400',
    },
    {
      id: 'administrador',
      nome: 'Administrador',
      descricao: 'Dashboard, Secretaria, Comissão, Patrimônio, Missões, Configurações',
      icon: '👑',
      cor: 'bg-purple-100 border-purple-300',
    },
    {
      id: 'cgadb',
      nome: 'CGADB',
      descricao: 'Acesso aos Débitos CGADB',
      icon: '📋',
      cor: 'bg-red-100 border-red-300',
    },
    {
      id: 'comissao',
      nome: 'Comissão',
      descricao: 'Dashboard, Secretaria (Supervisões/Campos/Ministros/Consagração), Comissão',
      icon: '🏛️',
      cor: 'bg-indigo-100 border-indigo-300',
    },
    {
      id: 'inscricao',
      nome: 'Inscrição',
      descricao: 'Acesso ao módulo de Eventos',
      icon: '🎫',
      cor: 'bg-teal-100 border-teal-300',
    },
    {
      id: 'financeiro',
      nome: 'Financeiro',
      descricao: 'Acesso ao módulo Financeiro',
      icon: '💳',
      cor: 'bg-blue-100 border-blue-300',
    },
  ];

  const getNivelInfo = (nivel: string) => {
    return nivelAcessoInfo.find(n => n.id === nivel);
  };

  const getCorNivel = (nivel: string) => {
    const info = getNivelInfo(nivel);
    return info?.cor || 'bg-gray-100 border-gray-300';
  };

  const getNomeNivel = (nivel: string) => {
    const info = getNivelInfo(nivel);
    return info?.nome || nivel;
  };

  const getIconNivel = (nivel: string) => {
    const info = getNivelInfo(nivel);
    return info?.icon || '👤';
  };

  const getCountByLevel = (nivelId: string) => {
    return usuarios.filter(u => u.nivel === nivelId).length;
  };

  useEffect(() => {
    const loadUsuarios = async () => {
      if (authLoading) return;
      setUsuariosLoading(true);
      setUsuariosError('');

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setUsuariosError('Sessao expirada.');
        setUsuariosLoading(false);
        return;
      }

      const res = await fetch('/api/usuarios', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const err = await res.json();
        setUsuariosError(err?.error || 'Falha ao carregar usuarios.');
        setUsuariosLoading(false);
        return;
      }

      const payload = await res.json();
      setUsuarios(payload?.data || []);
      setCurrentUserId(data.session?.user?.id ?? null);
      setCurrentUserEmail(data.session?.user?.email ?? '');
      setUsuariosLoading(false);
    };

    loadUsuarios();
  }, [authLoading, supabase]);

  useEffect(() => {
    const loadCongregacoes = async () => {
      if (authLoading) return;
      setCongregacoesLoading(true);

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setCongregacoes([]);
        setCongregacoesLoading(false);
        return;
      }

      const { data: rows, error } = await supabase
        .from('congregacoes')
        .select('id, nome')
        .order('nome');

      if (!error && rows) {
        setCongregacoes(rows as CongregacaoOption[]);
      } else {
        setCongregacoes([]);
      }

      setCongregacoesLoading(false);
    };

    loadCongregacoes();
  }, [authLoading, supabase]);


  const openEditModal = (usuario: Usuario & { congregacao_id?: string | null }) => {
    setEditError('');
    setEditStatus('');
    setEditEmailConfirmed(Boolean(usuario.email_confirmed));
    setEditOriginalStatus(usuario.status);
    setEditData({
      user_id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      nivel: usuario.nivel,
      congregacao_id: usuario.congregacao_id || '',
      cpf: usuario.cpf || '',
      celular: usuario.celular || '',
      subcategoria: (usuario as any).subcategoria || '',
      status: usuario.status,
      senha: '',
      confirmar_senha: '',
    });
    setEditOpen(true);
  };

  const handleEditChange = (field: keyof typeof editData, value: string) => {
    setEditData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = async () => {
    setEditError('');
    setEditStatus('');

    if (!editData.nome.trim() || !editData.email.trim() || !editData.nivel) {
      setEditError('Preencha nome, email e nivel de acesso.');
      return;
    }

    if (editData.senha && editData.senha.length < 6) {
      setEditError('Senha precisa ter pelo menos 6 caracteres.');
      return;
    }

    if (editData.senha && editData.senha !== editData.confirmar_senha) {
      setEditError('As senhas nao coincidem.');
      return;
    }

    if (editOriginalStatus === 'ativo' && editData.status === 'inativo') {
      const confirmed = window.confirm('Tem certeza que deseja desativar este usuario?');
      if (!confirmed) return;
    }

    setEditSaving(true);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setEditError('Sessao expirada.');
      setEditSaving(false);
      return;
    }

    const res = await fetch('/api/usuarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        user_id: editData.user_id,
        nome: editData.nome.trim(),
        email: editData.email.trim(),
        nivel: editData.nivel,
        congregacao_id: editData.congregacao_id || null,
        status: editData.status,
        senha: editData.senha ? editData.senha : undefined,
        cpf: editData.cpf || '',
        celular: editData.celular || '',
        subcategoria: editData.subcategoria || '',
      })
    });

    if (!res.ok) {
      const err = await res.json();
      setEditError(err?.error || 'Falha ao salvar usuario.');
      setEditSaving(false);
      return;
    }

    setEditStatus('Usuario atualizado com sucesso.');
    setEditSaving(false);

    const { data: sessionData } = await supabase.auth.getSession();
    const refreshToken = sessionData.session?.access_token;
    if (refreshToken) {
      const refresh = await fetch('/api/usuarios', {
        headers: { Authorization: `Bearer ${refreshToken}` }
      });
      if (refresh.ok) {
        const payload = await refresh.json();
        setUsuarios(payload?.data || []);
      }
    }
  };

  const handleRemoverUsuario = (usuario: Usuario) => {
    setUsuarioParaRemover(usuario);
  };

  const handleDesativar = (usuario: Usuario) => {
    if (usuario.id === currentUserId) {
      alert('Você não pode desativar sua própria conta.');
      return;
    }
    setUsuarioParaDesativar(usuario);
  };

  const confirmarDesativar = async () => {
    if (!usuarioParaDesativar) return;
    setDesativando(true);
    const novoStatus = usuarioParaDesativar.status === 'ativo' ? 'inativo' : 'ativo';

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { setDesativando(false); return; }

    const res = await fetch('/api/usuarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        user_id: usuarioParaDesativar.id,
        nome: usuarioParaDesativar.nome,
        email: usuarioParaDesativar.email,
        nivel: usuarioParaDesativar.nivel,
        status: novoStatus,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err?.error || 'Falha ao atualizar status.');
      setDesativando(false);
      return;
    }

    setUsuarios(prev => prev.map(u => u.id === usuarioParaDesativar.id ? { ...u, status: novoStatus } : u));
    setUsuarioParaDesativar(null);
    setDesativando(false);
  };

  const handleImprimirTermo = async (usuario: Usuario) => {
    const config = await fetchConfiguracaoIgrejaFromSupabase(supabase);
    const agora = new Date();
    const dataImpressao = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const horaImpressao = agora.toLocaleTimeString('pt-BR');
    const nivelNome = getNomeNivel(usuario.nivel);

    // Pré-carrega logo como base64 para evitar problemas de CORS no html2canvas
    let logoSrc = '';
    if (config.logo) {
      try {
        const resp = await fetch(config.logo);
        const blob = await resp.blob();
        logoSrc = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch { logoSrc = ''; }
    }
    const logoHtml = logoSrc
      ? `<img src="${logoSrc}" style="width:120px;height:80px;object-fit:contain;" />`
      : '';

    // Container fora da tela, largura A4 a 96dpi (794px = 210mm)
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;';
    container.innerHTML = `
<div style="padding:20mm 18mm;font-family:Arial,sans-serif;font-size:11pt;color:#1a1a1a;line-height:1.6;box-sizing:border-box;">
  <div style="display:flex;align-items:center;gap:18px;border-bottom:3px solid #003d7a;padding-bottom:14px;margin-bottom:20px;">
    <div>${logoHtml}</div>
    <div>
      <div style="font-size:14pt;font-weight:bold;text-transform:uppercase;color:#003d7a;">${config.nome}</div>
      <div style="font-size:9pt;color:#555;margin-top:2px;">${config.endereco}${config.cnpj ? ' | CNPJ: ' + config.cnpj : ''}${config.telefone ? ' | Tel: ' + config.telefone : ''}</div>
      <div style="font-size:9pt;color:#555;">${config.email}${config.website ? ' | ' + config.website : ''}</div>
    </div>
  </div>
  <div style="font-size:13pt;font-weight:bold;text-align:center;text-transform:uppercase;letter-spacing:1px;color:#003d7a;margin:18px 0 10px;border-bottom:1px solid #003d7a;padding-bottom:6px;">Termo de Responsabilidade de Uso e Tratamento de Dados Pessoais</div>
  <div style="background:#f0f6ff;border:1px solid #003d7a;border-radius:6px;padding:8px 12px;font-size:9pt;color:#003d7a;margin-bottom:14px;">&#128274; Este documento é regido pela <strong>Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018 (LGPD)</strong>. O usuário assume ciência plena das obrigações aqui descritas.</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;padding:12px 16px;margin-bottom:16px;">
    <div style="display:flex;flex-direction:column;"><span style="font-size:8pt;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Nome completo</span><span style="font-size:10pt;color:#1a1a1a;border-bottom:1px solid #ccc;padding-bottom:2px;min-height:18px;">${usuario.nome}</span></div>
    <div style="display:flex;flex-direction:column;"><span style="font-size:8pt;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:0.5px;">E-mail de acesso</span><span style="font-size:10pt;color:#1a1a1a;border-bottom:1px solid #ccc;padding-bottom:2px;min-height:18px;">${usuario.email}</span></div>
    <div style="display:flex;flex-direction:column;"><span style="font-size:8pt;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Nível de acesso</span><span style="font-size:10pt;color:#1a1a1a;border-bottom:1px solid #ccc;padding-bottom:2px;min-height:18px;">${nivelNome}</span></div>
    <div style="display:flex;flex-direction:column;"><span style="font-size:8pt;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:0.5px;">CPF</span><span style="font-size:10pt;color:#1a1a1a;border-bottom:1px solid #ccc;padding-bottom:2px;min-height:18px;">${usuario.cpf || ''}</span></div>
    <div style="display:flex;flex-direction:column;"><span style="font-size:8pt;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Celular</span><span style="font-size:10pt;color:#1a1a1a;border-bottom:1px solid #ccc;padding-bottom:2px;min-height:18px;">${usuario.celular || ''}</span></div>
  </div>
  <p style="margin-bottom:12px;font-size:10pt;">Declaro ter recebido credenciais de acesso ao sistema <strong>SISCOMIEADEPA.ORG</strong> — plataforma da ${config.nome} — e, em plena ciência e concordância, comprometo-me a cumprir integralmente as condições abaixo:</p>
  <div style="margin-bottom:12px;">
    <div style="font-size:10pt;font-weight:bold;color:#003d7a;margin-bottom:4px;border-left:3px solid #003d7a;padding-left:8px;">1. Uso Responsável do Sistema</div>
    <ol type="a" style="padding-left:18px;">
      <li style="margin-bottom:3px;font-size:10pt;">Utilizar o sistema exclusivamente para fins relacionados às minhas atribuições ou por determinação expressa da Diretoria;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Não compartilhar minhas credenciais de acesso (login/senha) com terceiros, sob nenhuma circunstância;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Encerrar minha sessão sempre que me ausentar da estação de trabalho;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Manter cautela ao exibir, exportar ou imprimir dados, impedindo o acesso por pessoas não autorizadas;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Não instalar softwares, extensões ou dispositivos que possam comprometer a segurança do sistema.</li>
    </ol>
  </div>
  <div style="margin-bottom:12px;">
    <div style="font-size:10pt;font-weight:bold;color:#003d7a;margin-bottom:4px;border-left:3px solid #003d7a;padding-left:8px;">2. Proteção de Dados Pessoais — LGPD (Lei nº 13.709/2018)</div>
    <ol type="a" style="padding-left:18px;">
      <li style="margin-bottom:3px;font-size:10pt;">Reconheço que os dados pessoais de membros, ministros e colaboradores são de titularidade dos respectivos indivíduos e que seu tratamento deve observar os princípios da LGPD: finalidade, adequação, necessidade, livre acesso, qualidade dos dados, transparência, segurança, prevenção, não discriminação e responsabilização;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Comprometo-me a tratar os dados pessoais somente para as finalidades autorizadas e compatíveis com a missão da Convenção, vedado o uso para fins particulares, comerciais ou de terceiros;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Tenho ciência de que os titulares possuem direitos garantidos por lei: acesso, correção, eliminação, portabilidade, revogação do consentimento e oposição ao tratamento — e que devo respeitar e facilitar o exercício de tais direitos;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Caso identifique ou tome conhecimento de qualquer incidente de segurança (vazamento, acesso indevido, perda ou alteração de dados), comprometendo-me a comunicar imediatamente à Diretoria de TI ou ao Encarregado de Proteção de Dados (DPO);</li>
      <li style="margin-bottom:3px;font-size:10pt;">É vedado inserir dados falsos, alterar registros sem autorização ou extrair bases de dados para fins não autorizados, sujeitando-me a sanções civis, penais e administrativas previstas na LGPD e legislação correlata.</li>
    </ol>
  </div>
  <div style="margin-bottom:12px;">
    <div style="font-size:10pt;font-weight:bold;color:#003d7a;margin-bottom:4px;border-left:3px solid #003d7a;padding-left:8px;">3. Segurança da Informação</div>
    <ol type="a" style="padding-left:18px;">
      <li style="margin-bottom:3px;font-size:10pt;">Respeitar as restrições de acesso definidas para meu perfil, sem tentar acessar módulos ou informações além do autorizado;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Solicitar a redefinição de senha imediatamente se houver suspeita de comprometimento;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Cumprir a Política de Segurança da Informação e as demais diretrizes internas da Convenção;</li>
      <li style="margin-bottom:3px;font-size:10pt;">Reconhecer que o acesso ao sistema é pessoal e intransferível, e que toda ação registrada sob minhas credenciais é de minha responsabilidade.</li>
    </ol>
  </div>
  <div style="margin-bottom:12px;">
    <div style="font-size:10pt;font-weight:bold;color:#003d7a;margin-bottom:4px;border-left:3px solid #003d7a;padding-left:8px;">4. Vigência e Sanções</div>
    <ol type="a" style="padding-left:18px;">
      <li style="margin-bottom:3px;font-size:10pt;">Este termo tem vigência imediata e permanece válido enquanto houver vinculação do signatário à Convenção ou acesso ativo ao sistema;</li>
      <li style="margin-bottom:3px;font-size:10pt;">O descumprimento das obrigações aqui assumidas poderá ensejar: suspensão ou revogação do acesso, responsabilidade funcional, civil e penal, além das sanções administrativas previstas na LGPD (Art. 52).</li>
    </ol>
  </div>
  <p style="margin-top:14px;font-size:10pt;">Declaro, nesta data, estar plenamente esclarecido e de acordo com todos os termos acima, comprometendo-me a respeitá-los e cumpri-los integralmente.</p>
  <p style="margin-top:10px;font-size:10pt;"><strong>Belém, PA, ${dataImpressao}.</strong></p>
  <div style="margin-top:28px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;">
    <div style="text-align:center;"><div style="border-top:1px solid #333;margin-top:30px;padding-top:4px;font-size:9pt;color:#444;">Assinatura do Usuário<br/><em>${usuario.nome}</em></div></div>
    <div style="text-align:center;"><div style="border-top:1px solid #333;margin-top:30px;padding-top:4px;font-size:9pt;color:#444;">Responsável pelo Cadastro<br/><em>${currentUserEmail}</em></div></div>
    <div style="text-align:center;"><div style="border-top:1px solid #333;margin-top:30px;padding-top:4px;font-size:9pt;color:#444;">Diretor de TI<br/>(Comissão de Tecnologia)</div></div>
  </div>
  <div style="margin-top:20px;font-size:8pt;color:#999;text-align:center;border-top:1px solid #eee;padding-top:8px;">Documento gerado em ${dataImpressao} às ${horaImpressao} | SISCOMIEADEPA.ORG | ${config.nome}</div>
</div>`;

    document.body.appendChild(container);

    try {
      const { default: html2canvas } = await import('html2canvas');
      const { jsPDF } = await import('jspdf');

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: 794,
      });

      document.body.removeChild(container);

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfW = pdf.internal.pageSize.getWidth();   // 210mm
      const pdfH = pdf.internal.pageSize.getHeight();  // 297mm
      const ratio = pdfW / canvas.width;               // mm por px
      const marginMm = 20;

      // Pág 1: canvas já tem 20mm de padding no topo (do container), então ocupa (pdfH - marginMm) mm
      // Pág 2+: sem padding no topo do canvas, então o conteúdo é colocado a partir de marginMm no PDF
      const page1SlicePx = (pdfH - marginMm) / ratio;
      const nextSlicePx  = (pdfH - marginMm * 2) / ratio;

      let yPx = 0;
      let page = 0;

      while (yPx < canvas.height) {
        if (page > 0) pdf.addPage();

        const isFirst = page === 0;
        const sliceHpx = Math.min(isFirst ? page1SlicePx : nextSlicePx, canvas.height - yPx);
        const yOffsetMm = isFirst ? 0 : marginMm;
        const sliceHmm  = sliceHpx * ratio;

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHpx;
        const ctx = pageCanvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, yPx, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx);
        pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, yOffsetMm, pdfW, sliceHmm);
        yPx += sliceHpx;
        page++;
      }

      pdf.save(`termo-${usuario.nome.replace(/\s+/g, '-').toLowerCase()}.pdf`);
    } catch {
      if (document.body.contains(container)) document.body.removeChild(container);
    }
  };

  const confirmarRemocao = async () => {
    if (!usuarioParaRemover) return;
    setRemovendoUsuario(true);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const currentUserId = data.session?.user?.id;

    if (!token) {
      setRemovendoUsuario(false);
      return;
    }

    if (usuarioParaRemover.id === currentUserId) {
      alert('Você não pode remover sua própria conta.');
      setUsuarioParaRemover(null);
      setRemovendoUsuario(false);
      return;
    }

    const res = await fetch(`/api/usuarios?user_id=${encodeURIComponent(usuarioParaRemover.id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err?.error || 'Falha ao remover usuário.');
      setRemovendoUsuario(false);
      return;
    }

    setUsuarios(prev => prev.filter(u => u.id !== usuarioParaRemover.id));
    setUsuarioParaRemover(null);
    setRemovendoUsuario(false);
  };

  const maskCpf = (v: string) =>
    v.replace(/\D/g, '').slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');

  const maskCelular = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '');
    return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '');
  };

  const handleFormChange = (field: keyof typeof formData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (field === 'nome') { setCpfAutoPreenchido(false); setCelularAutoPreenchido(false); buscarNomeMembro(value); }
  };

  const buscarNomeMembro = async (termo: string) => {
    if (termo.trim().length < 3) { setNomeSugestoes([]); return; }
    setNomeBuscando(true);
    try {
      const { data } = await supabase
        .from('members')
        .select('name, cpf, phone')
        .ilike('name', `%${termo}%`)
        .order('name')
        .limit(8);
      setNomeSugestoes((data || []).map((r: any) => ({ name: String(r.name), cpf: String(r.cpf || ''), phone: String(r.phone || '') })));
    } catch {
      setNomeSugestoes([]);
    } finally {
      setNomeBuscando(false);
    }
  };

  const handleCreateUser = async () => {
    setFormError('');
    setFormStatus('');

    if (!formData.nome.trim() || !formData.email.trim() || !formData.nivel) {
      setFormError('Preencha nome, email e nivel de acesso.');
      return;
    }

    if (!formData.senha.trim() || formData.senha.length < 6) {
      setFormError('Informe uma senha com pelo menos 6 caracteres.');
      return;
    }

    if (formData.senha !== formData.confirmar_senha) {
      setFormError('As senhas nao coincidem.');
      return;
    }

    setCreatingUser(true);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setFormError('Sessao expirada.');
      setCreatingUser(false);
      return;
    }

    const res = await fetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nome: formData.nome.trim(),
        email: formData.email.trim(),
        nivel: formData.nivel,
        congregacao_id: formData.congregacao_id || null,
        senha: formData.senha,
        cpf: formData.cpf || '',
        celular: formData.celular || '',
        subcategoria: formData.subcategoria || '',
      })
    });

    if (!res.ok) {
      const err = await res.json();
      setFormError(err?.error || 'Falha ao criar usuario.');
      setCreatingUser(false);
      return;
    }

    setShowForm(false);
    setFormStatus('Usuário criado com sucesso!');
    setFormData({
      nome: '',
      email: '',
      nivel: '',
      congregacao_id: '',
      cpf: '',
      celular: '',
      senha: '',
      confirmar_senha: '',
      subcategoria: '',
    });
    setSelectedLevel('');
    setNomeSugestoes([]);
    setCreatingUser(false);

    const { data: sessionData } = await supabase.auth.getSession();
    const refreshToken = sessionData.session?.access_token;
    if (refreshToken) {
      const refresh = await fetch('/api/usuarios', {
        headers: { Authorization: `Bearer ${refreshToken}` }
      });
      if (refresh.ok) {
        const payload = await refresh.json();
        setUsuarios(payload?.data || []);
      }
    }
  };

  // Paginação
  const totalPages = Math.max(1, Math.ceil(usuarios.length / itemsPerPage));
  const startIndex = usuarios.length === 0 ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const usuariosPaginados = usuarios.slice(startIndex, endIndex);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-[#123b63]">Usuários</h1>
              <p className="text-gray-600 mt-2">Gerencie usuários e seus níveis de acesso</p>
              <p className="text-sm mt-1 text-gray-500">{totalUsuarios} usuário{totalUsuarios !== 1 ? 's' : ''} cadastrado{totalUsuarios !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-6 py-3 rounded-lg font-semibold transition bg-[#0284c7] text-white hover:bg-blue-700"
            >
              + Novo Usuário
            </button>
          </div>

          {/* Níveis de Acesso */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {nivelAcessoInfo.map(nivel => (
              <div
                key={nivel.id}
                className={`${nivel.cor} border-2 rounded-lg p-4 cursor-pointer transition hover:shadow-lg flex items-center justify-between`}
              >
                <div className="flex-1">
                  <div className="text-2xl mb-1">{nivel.icon}</div>
                  <h3 className="font-bold text-[#123b63] text-sm">{nivel.nome}</h3>
                  <p className="text-xs text-gray-700">{nivel.descricao}</p>
                </div>
                <div className="text-right ml-3">
                  <p className="text-2xl font-bold text-[#123b63]">{getCountByLevel(nivel.id)}</p>
                  <p className="text-xs text-gray-600">usuário{getCountByLevel(nivel.id) !== 1 ? 's' : ''}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Form de novo usuário */}
          {showForm && (
            <div className="bg-white rounded-lg p-6 shadow-md mb-6 border-2 border-[#123b63]">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-[#123b63]">Adicionar Novo Usuário</h2>
                <span className="text-sm font-semibold px-3 py-1 rounded-full bg-green-100 text-green-700">
                  {totalUsuarios} usuário{totalUsuarios !== 1 ? 's' : ''}
                </span>
              </div>
              
              {/* Linha 1: Nome + Nível de Acesso */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                <div className="relative">
                  <label className="block text-sm font-semibold text-[#123b63] mb-2">Nome completo</label>
                  <input
                    type="text"
                    placeholder="Digite o nome..."
                    value={formData.nome}
                    onChange={(e) => handleFormChange('nome', e.target.value)}
                    onFocus={() => setNomeFoco(true)}
                    onBlur={() => setTimeout(() => setNomeFoco(false), 150)}
                    autoComplete="off"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]"
                  />
                  {nomeBuscando && (
                    <p className="text-xs text-gray-400 mt-1">Buscando...</p>
                  )}
                  {nomeFoco && nomeSugestoes.length > 0 && (
                    <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                      {nomeSugestoes.map((s, i) => (
                        <li
                          key={i}
                          onMouseDown={() => {
                            handleFormChange('nome', s.name);
                            const cpfMasked = s.cpf ? maskCpf(s.cpf) : '';
                            const celMasked = s.phone ? maskCelular(s.phone) : '';
                            if (cpfMasked) handleFormChange('cpf', cpfMasked);
                            if (celMasked) handleFormChange('celular', celMasked);
                            setCpfAutoPreenchido(!!cpfMasked);
                            setCelularAutoPreenchido(!!celMasked);
                            setNomeSugestoes([]);
                          }}
                          className="px-4 py-2.5 text-sm text-gray-800 hover:bg-blue-50 cursor-pointer border-b last:border-0"
                        >
                          {s.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#123b63] mb-2">Nível de Acesso</label>
                  <div className={`flex gap-2`}>
                    <select
                      value={formData.nivel}
                      onChange={(e) => {
                        const value = e.target.value;
                        handleFormChange('nivel', value);
                        setSelectedLevel(value);
                        if (value !== 'inscricao') handleFormChange('subcategoria', '');
                      }}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]"
                    >
                      <option value="">Selecione um nível</option>
                      {nivelAcessoInfo.map(nivel => (
                        <option key={nivel.id} value={nivel.id}>
                          {nivel.icon} {nivel.nome}
                        </option>
                      ))}
                    </select>
                    {formData.nivel === 'inscricao' && (
                      <select
                        value={formData.subcategoria}
                        onChange={(e) => handleFormChange('subcategoria', e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]"
                      >
                        <option value="">Sub-categoria</option>
                        <option value="AGO">AGO</option>
                        <option value="UMADESPA">UMADESPA</option>
                        <option value="COADESPA">COADESPA</option>
                        <option value="SEIADEPA">SEIADEPA</option>
                        <option value="AVULSO">AVULSO</option>
                      </select>
                    )}
                  </div>
                </div>
              </div>

              {/* Linha 2: E-mail + CPF + Celular */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <input
                  type="email"
                  placeholder="E-mail"
                  value={formData.email}
                  onChange={(e) => handleFormChange('email', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]"
                />
                <input
                  type="text"
                  placeholder="CPF"
                  value={formData.cpf}
                  onChange={(e) => { if (!cpfAutoPreenchido) handleFormChange('cpf', maskCpf(e.target.value)); }}
                  readOnly={cpfAutoPreenchido}
                  className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7] ${cpfAutoPreenchido ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                />
                <input
                  type="text"
                  placeholder="Celular"
                  value={formData.celular}
                  onChange={(e) => { if (!celularAutoPreenchido) handleFormChange('celular', maskCelular(e.target.value)); }}
                  readOnly={celularAutoPreenchido}
                  className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7] ${celularAutoPreenchido ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                />
              </div>

              {/* Linha 3: Senha + Confirmar Senha */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <input
                  type="password"
                  placeholder="Senha"
                  value={formData.senha}
                  onChange={(e) => handleFormChange('senha', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]"
                />
                <input
                  type="password"
                  placeholder="Confirmar Senha"
                  value={formData.confirmar_senha}
                  onChange={(e) => handleFormChange('confirmar_senha', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#0284c7]"
                />
              </div>

              {formError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded">
                  {formError}
                </div>
              )}
              {formStatus && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 text-sm text-green-700 rounded">
                  {formStatus}
                </div>
              )}

              <div className="flex gap-6">
                <button
                  onClick={() => { setShowForm(false); setCpfAutoPreenchido(false); setCelularAutoPreenchido(false); }}
                  className="flex-1 bg-gray-300 text-[#123b63] px-6 py-3 rounded-lg hover:bg-gray-400 transition font-semibold"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateUser}
                  disabled={creatingUser}
                  className="flex-1 bg-[#0284c7] text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition font-semibold"
                >
                  {creatingUser ? 'Criando...' : 'Criar Usuário'}
                </button>
              </div>
            </div>
          )}

          {/* Lista de Usuários */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden mt-4">
            <div className="bg-[#123b63] text-white px-6 py-3">
              <h2 className="text-xl font-bold">Usuários Cadastrados ({usuarios.length})</h2>
            </div>

            {usuariosError && (
              <div className="px-6 py-4 text-sm text-red-700 bg-red-50 border-b border-red-200">
                {usuariosError}
              </div>
            )}


            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[#123b63]">Nome</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[#123b63]">E-mail</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[#123b63]">Nível de Acesso</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[#123b63]">Status</th>
                    <th className="px-6 py-4 text-center text-sm font-semibold text-[#123b63]">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {usuariosLoading ? (
                    <tr>
                      <td className="px-6 py-6 text-sm text-gray-500" colSpan={5}>Carregando usuarios...</td>
                    </tr>
                  ) : usuariosPaginados.length === 0 ? (
                    <tr>
                      <td className="px-6 py-6 text-sm text-gray-500" colSpan={5}>Nenhum usuario encontrado.</td>
                    </tr>
                  ) : usuariosPaginados.map((usuario, index) => (
                    <tr
                      key={usuario.id}
                      className={`border-b transition ${
                        usuario.status === 'inativo'
                          ? 'bg-red-50 hover:bg-red-100 border-red-100'
                          : index % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                            usuario.status === 'inativo' ? 'opacity-40 grayscale' : ''
                          } ${getCorNivel(usuario.nivel)}`}>
                            {getIconNivel(usuario.nivel)}
                          </div>
                          <div>
                            <div className={`font-semibold ${usuario.status === 'inativo' ? 'text-red-400 line-through' : 'text-[#123b63]'}`}>{usuario.nome}</div>
                          </div>
                        </div>
                      </td>
                      <td className={`px-6 py-4 ${usuario.status === 'inativo' ? 'text-red-300' : 'text-gray-700'}`}>{usuario.email}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getCorNivel(usuario.nivel)} border border-gray-300`}>
                          {getNomeNivel(usuario.nivel)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                          usuario.status === 'ativo'
                            ? 'bg-green-100 text-green-800 border border-green-300'
                            : 'bg-red-100 text-red-800 border border-red-300'
                        }`}>
                          {usuario.status === 'ativo' ? '✓ Ativo' : '✗ Inativo'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex gap-1.5 justify-center">
                          <button
                            onClick={() => openEditModal(usuario)}
                            className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg font-semibold text-xs transition"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDesativar(usuario)}
                            className={`px-3 py-1.5 border rounded-lg font-semibold text-xs transition ${
                              usuario.status === 'ativo'
                                ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border-yellow-200'
                                : 'bg-green-50 text-green-700 hover:bg-green-100 border-green-200'
                            }`}
                          >
                            {usuario.status === 'ativo' ? 'Desativar' : 'Reativar'}
                          </button>
                          <button
                            onClick={() => handleImprimirTermo(usuario)}
                            className="px-3 py-1.5 bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 rounded-lg font-semibold text-xs transition"
                            title="Imprimir Termo de Responsabilidade"
                          >
                            🖨 Termo
                          </button>
                          <button
                            onClick={() => handleRemoverUsuario(usuario)}
                            className="px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-lg font-semibold text-xs transition"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-t">
              <div className="text-sm text-gray-600">
                Mostrando {usuarios.length === 0 ? 0 : startIndex + 1} a {Math.min(endIndex, usuarios.length)} de {usuarios.length} usuários
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition font-semibold text-sm"
                >
                  ← Anterior
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-2 rounded-lg font-semibold text-sm transition ${
                        currentPage === page
                          ? 'bg-[#0284c7] text-white'
                          : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition font-semibold text-sm"
                >
                  Próxima →
                </button>
              </div>
            </div>
          </div>
        </div>

        {editOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden">

              {/* Header */}
              <div className="bg-gradient-to-r from-[#123b63] to-[#1a5490] px-6 py-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl">
                    {getNivelInfo(editData.nivel)?.icon || '👤'}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Editar Usuário</h3>
                    <p className="text-xs text-blue-200">{editData.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-5">

                {/* Informações básicas */}
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Informações Básicas</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-[#123b63] mb-1.5">Nome completo</label>
                      <input
                        value={editData.nome}
                        onChange={(e) => handleEditChange('nome', e.target.value)}
                        placeholder="Nome do usuário"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7] text-sm transition"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#123b63] mb-1.5">E-mail</label>
                      <input
                        type="email"
                        value={editData.email}
                        onChange={(e) => handleEditChange('email', e.target.value)}
                        disabled={!editEmailConfirmed}
                        placeholder="email@exemplo.com"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7] text-sm transition disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                      />
                      {!editEmailConfirmed && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          ⚠️ E-mail não confirmado — alteração bloqueada
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Acesso e status */}
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Acesso e Status</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-[#123b63] mb-1.5">Nível de Acesso</label>
                      <div className="flex gap-2">
                        <select
                          value={editData.nivel}
                          onChange={(e) => { handleEditChange('nivel', e.target.value); if (e.target.value !== 'inscricao') handleEditChange('subcategoria', ''); }}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7] text-sm transition bg-white"
                        >
                          <option value="">Selecione</option>
                          {nivelAcessoInfo.map(nivel => (
                            <option key={nivel.id} value={nivel.id}>
                              {nivel.icon} {nivel.nome}
                            </option>
                          ))}
                        </select>
                        {editData.nivel === 'inscricao' && (
                          <select
                            value={editData.subcategoria}
                            onChange={(e) => handleEditChange('subcategoria', e.target.value)}
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7] text-sm transition bg-white"
                          >
                            <option value="">Sub-categoria</option>
                            <option value="AGO">AGO</option>
                            <option value="UMADESPA">UMADESPA</option>
                            <option value="COADESPA">COADESPA</option>
                            <option value="SEIADEPA">SEIADEPA</option>
                            <option value="AVULSO">AVULSO</option>
                          </select>
                        )}
                      </div>
                      {editData.nivel && (
                        <p className="text-xs text-gray-500 mt-1">{getNivelInfo(editData.nivel)?.descricao}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#123b63] mb-1.5">Status</label>
                      <select
                        value={editData.status}
                        onChange={(e) => handleEditChange('status', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7] text-sm transition bg-white"
                      >
                        <option value="ativo">✓ Ativo</option>
                        <option value="inativo">✗ Inativo</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* CPF e Celular */}
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Dados Complementares</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-[#123b63] mb-1.5">CPF</label>
                      <input
                        type="text"
                        value={editData.cpf}
                        onChange={(e) => handleEditChange('cpf', maskCpf(e.target.value))}
                        placeholder="000.000.000-00"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7] text-sm transition"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#123b63] mb-1.5">Celular</label>
                      <input
                        type="text"
                        value={editData.celular}
                        onChange={(e) => handleEditChange('celular', maskCelular(e.target.value))}
                        placeholder="(91) 99999-9999"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7] text-sm transition"
                      />
                    </div>
                  </div>
                </div>

                {/* Redefinir senha */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Redefinir Senha <span className="normal-case font-normal text-gray-400">(opcional — deixe em branco para não alterar)</span></p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-[#123b63] mb-1.5">Nova Senha</label>
                      <input
                        type="password"
                        value={editData.senha}
                        onChange={(e) => handleEditChange('senha', e.target.value)}
                        placeholder="Mínimo 6 caracteres"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7] text-sm transition bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-[#123b63] mb-1.5">Confirmar Senha</label>
                      <input
                        type="password"
                        value={editData.confirmar_senha}
                        onChange={(e) => handleEditChange('confirmar_senha', e.target.value)}
                        placeholder="Repita a nova senha"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0284c7]/30 focus:border-[#0284c7] text-sm transition bg-white"
                      />
                    </div>
                  </div>
                </div>

                {editError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded-xl">
                    <span className="flex-shrink-0">⚠️</span>
                    {editError}
                  </div>
                )}
                {editStatus && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 text-sm text-green-700 rounded-xl">
                    <span className="flex-shrink-0">✓</span>
                    {editStatus}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row gap-2 justify-end">
                <button
                  onClick={() => setEditOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-100 transition text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving}
                  className="px-5 py-2.5 rounded-xl bg-[#123b63] text-white font-semibold hover:bg-[#1a5490] disabled:opacity-60 transition text-sm flex items-center gap-2"
                >
                  {editSaving ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Salvando...</>
                  ) : (
                    'Salvar Alterações'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {usuarioParaDesativar && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">

              {/* Header */}
              <div className={`px-6 py-5 flex items-center gap-4 border-b ${
                usuarioParaDesativar.status === 'ativo'
                  ? 'bg-amber-50 border-amber-100'
                  : 'bg-green-50 border-green-100'
              }`}>
                <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-2xl ${
                  usuarioParaDesativar.status === 'ativo' ? 'bg-amber-100' : 'bg-green-100'
                }`}>
                  {usuarioParaDesativar.status === 'ativo' ? '🔒' : '🔓'}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">
                    {usuarioParaDesativar.status === 'ativo' ? 'Desativar Usuário' : 'Reativar Usuário'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {usuarioParaDesativar.status === 'ativo'
                      ? 'O acesso ao sistema será bloqueado'
                      : 'O acesso ao sistema será restaurado'}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5">
                <p className="text-gray-600 text-sm">
                  {usuarioParaDesativar.status === 'ativo'
                    ? 'Você está prestes a desativar o usuário:'
                    : 'Você está prestes a reativar o usuário:'}
                </p>
                <div className="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${getCorNivel(usuarioParaDesativar.nivel)}`}>
                    {getIconNivel(usuarioParaDesativar.nivel)}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{usuarioParaDesativar.nome}</p>
                    <p className="text-xs text-gray-500">{usuarioParaDesativar.email}</p>
                  </div>
                </div>
                <p className={`mt-4 text-sm font-medium px-3 py-2 rounded-lg ${
                  usuarioParaDesativar.status === 'ativo'
                    ? 'bg-amber-50 border border-amber-200 text-amber-700'
                    : 'bg-green-50 border border-green-200 text-green-700'
                }`}>
                  {usuarioParaDesativar.status === 'ativo'
                    ? '⚠️ O usuário não conseguirá fazer login até ser reativado.'
                    : '✓ O usuário voltará a ter acesso normalmente.'}
                </p>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                <button
                  onClick={() => setUsuarioParaDesativar(null)}
                  disabled={desativando}
                  className="px-5 py-2 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-100 disabled:opacity-50 transition text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarDesativar}
                  disabled={desativando}
                  className={`px-5 py-2 rounded-xl text-white font-semibold disabled:opacity-60 transition text-sm flex items-center gap-2 ${
                    usuarioParaDesativar.status === 'ativo'
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {desativando ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Aguarde...</>
                  ) : usuarioParaDesativar.status === 'ativo' ? 'Desativar' : 'Reativar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {usuarioParaRemover && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
              <div className="bg-red-50 px-6 py-5 flex items-center gap-4 border-b border-red-100">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Remover Usuário</h3>
                  <p className="text-sm text-gray-500">Esta ação não pode ser desfeita</p>
                </div>
              </div>

              <div className="px-6 py-5">
                <p className="text-gray-700">
                  Você está prestes a remover permanentemente o usuário:
                </p>
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="font-semibold text-gray-900">{usuarioParaRemover.nome}</p>
                  <p className="text-sm text-gray-500">{usuarioParaRemover.email}</p>
                </div>
                {usuarioParaRemover.id === currentUserId ? (
                  <p className="mt-3 text-sm text-amber-600 font-medium bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠️ Você não pode remover sua própria conta.
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-red-600 font-medium">
                    O acesso ao sistema será revogado imediatamente.
                  </p>
                )}
              </div>

              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                <button
                  onClick={() => setUsuarioParaRemover(null)}
                  disabled={removendoUsuario}
                  className="px-5 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-100 disabled:opacity-50 transition-colors"
                >
                  Cancelar
                </button>
                {usuarioParaRemover.id !== currentUserId && (
                  <button
                    onClick={confirmarRemocao}
                    disabled={removendoUsuario}
                    className="px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-60 transition-colors flex items-center gap-2"
                  >
                    {removendoUsuario ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Removendo...
                      </>
                    ) : 'Remover Usuário'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
