'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import NotificationModal from '@/components/NotificationModal';
import { getCargosMinisteriais, saveCargosMinisteriais, type CargoMinisterial } from '@/lib/cargos-utils';
import { useAppDialog } from '@/providers/AppDialogProvider'
import { createClient } from '@/lib/supabase-client'
import { formatCnpj, formatPhone } from '@/lib/mascaras';


export const dynamic = 'force-dynamic';

export default function ConfiguracoesPage() {
  const [activeMenu, setActiveMenu] = useState('configuracoes');
  const [activeTab, setActiveTab] = useState('perfil');
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
  }>({ isOpen: false, title: '', message: '', type: 'success' });

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeMenu={activeMenu} setActiveMenu={setActiveMenu} />

      <NotificationModal
        title={notification.title}
        message={notification.message}
        type={notification.type}
        isOpen={notification.isOpen}
        onClose={() => setNotification({ ...notification, isOpen: false })}
      />

      <div className="flex-1 overflow-auto">
        <div className="p-6">
          {/* Header */}
          <h1 className="text-3xl font-bold text-gray-800 mb-6">âš™ï¸ ConfiguraÃ§Ãµes da InstituiÃ§Ã£o</h1>

          {/* Abas */}
          <div className="flex border-b border-gray-300 bg-white rounded-t-lg overflow-x-auto mb-6">
            <button
              onClick={() => setActiveTab('perfil')}
              className={`px-6 py-3 font-semibold transition whitespace-nowrap text-sm border-b-3 ${activeTab === 'perfil'
                ? 'text-teal-700 border-teal-600'
                : 'text-gray-600 border-transparent hover:text-teal-600'
                }`}
            >
              ðŸ›ï¸ Perfil da InstituiÃ§Ã£o
            </button>
            <button
              onClick={() => setActiveTab('identidade')}
              className={`px-6 py-3 font-semibold transition whitespace-nowrap text-sm border-b-3 ${activeTab === 'identidade'
                ? 'text-teal-700 border-teal-600'
                : 'text-gray-600 border-transparent hover:text-teal-600'
                }`}
            >
              ðŸŽ¨ Identidade Visual
            </button>

            <button
              onClick={() => setActiveTab('nomenclaturas')}
              className={`px-6 py-3 font-semibold transition whitespace-nowrap text-sm border-b-3 ${activeTab === 'nomenclaturas'
                ? 'text-teal-700 border-teal-600'
                : 'text-gray-600 border-transparent hover:text-teal-600'
                }`}
            >
              ðŸ“ Cargos Ministeriais
            </button>
          </div>

          {/* ConteÃºdo das Abas */}
          <div className="bg-white rounded-b-lg shadow-md p-6">
            {/* Aba: Perfil */}
            {activeTab === 'perfil' && (
              <PerfilContent onNotification={(title, message, type) => setNotification({ isOpen: true, title, message, type })} />
            )}

            {/* Aba: Identidade Visual */}
            {activeTab === 'identidade' && (
              <BrandingContent onNotification={(title, message, type) => setNotification({ isOpen: true, title, message, type })} />
            )}


            {/* Aba: Nomenclaturas */}
            {activeTab === 'nomenclaturas' && (
              <NomenclaturaContent onNotification={(title, message, type) => setNotification({ isOpen: true, title, message, type })} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Componente Perfil
function PerfilContent({ onNotification }: { onNotification: (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void }) {
  const supabase = createClient();
  const { fetchConfiguracaoIgrejaFromSupabase, updateConfiguracaoIgrejaInSupabase } = require('@/lib/igreja-config-utils');

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    nomeMinisterio: '',
    cnpj: '',
    email: '',
    telefone: '',
    website: '',
    endereco: '',
    descricao: '',
    responsavel: '',
    dataCadastro: ''
  });

  useEffect(() => {
    fetchConfiguracaoIgrejaFromSupabase(supabase)
      .then((config: any) => {
        setFormData({
          nomeMinisterio: config.nome || 'InstituiÃ§Ã£o',
          cnpj: config.cnpj || '',
          email: config.email || '',
          telefone: config.telefone || '',
          website: config.website || '',
          endereco: config.endereco || '',
          descricao: config.descricao || '',
          responsavel: config.responsavel || '',
          dataCadastro: config.dataCadastro || ''
        });
      })
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const nextValue = name === 'cnpj'
      ? formatCnpj(value)
      : name === 'telefone'
        ? formatPhone(value)
        : value;
    setFormData(prev => ({
      ...prev,
      [name]: nextValue
    }));
  };

  const handleSave = async () => {
    try {
      await updateConfiguracaoIgrejaInSupabase(supabase, {
        nome: formData.nomeMinisterio,
        cnpj: formData.cnpj,
        email: formData.email,
        telefone: formData.telefone,
        endereco: formData.endereco,
        descricao: formData.descricao,
        website: formData.website,
        responsavel: formData.responsavel,
        dataCadastro: formData.dataCadastro
      });
      onNotification('Sucesso', 'Dados da instituiÃ§Ã£o atualizados com sucesso!', 'success');
      setIsEditing(false);
    } catch (error: any) {
      console.error('âŒ Erro ao salvar perfil:', error);
      onNotification('Erro', error?.message || 'Erro ao salvar. Tente novamente.', 'error');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Perfil da InstituiÃ§Ã£o</h2>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className={`px-6 py-2 rounded-lg transition font-semibold ${isEditing
            ? 'bg-gray-500 text-white hover:bg-gray-600'
            : 'bg-teal-600 text-white hover:bg-teal-700'
            }`}
        >
          {isEditing ? 'âŒ Cancelar' : 'âœï¸ Editar'}
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Nome da InstituiÃ§Ã£o</label>
            <input
              type="text"
              name="nomeMinisterio"
              value={formData.nomeMinisterio}
              onChange={handleChange}
              disabled={!isEditing}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">CNPJ</label>
            <input
              type="text"
              name="cnpj"
              value={formData.cnpj}
              onChange={handleChange}
              disabled={!isEditing}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              disabled={!isEditing}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Telefone</label>
            <input
              type="tel"
              name="telefone"
              value={formData.telefone}
              onChange={handleChange}
              disabled={!isEditing}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Website</label>
            <input
              type="url"
              name="website"
              value={formData.website}
              onChange={handleChange}
              disabled={!isEditing}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Presidente</label>
            <input
              type="text"
              name="responsavel"
              value={formData.responsavel}
              onChange={handleChange}
              disabled={!isEditing}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">EndereÃ§o</label>
          <textarea
            name="endereco"
            value={formData.endereco}
            onChange={handleChange}
            disabled={!isEditing}
            rows={2}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">DescriÃ§Ã£o</label>
          <textarea
            name="descricao"
            value={formData.descricao}
            onChange={handleChange}
            disabled={!isEditing}
            rows={3}
            placeholder="InformaÃ§Ãµes sobre sua instituiÃ§Ã£o"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Data de FundaÃ§Ã£o</label>
          <input
            type="date"
            name="dataCadastro"
            value={formData.dataCadastro}
            onChange={handleChange}
            disabled={!isEditing}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        {isEditing && (
          <div className="flex gap-4 pt-4">
            <button
              onClick={handleSave}
              className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
            >
              âœ“ Salvar AlteraÃ§Ãµes
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex-1 px-6 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition font-semibold"
            >
              âœ• Descartar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Componente Branding
function BrandingContent({ onNotification }: { onNotification: (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void }) {
  const supabase = createClient();
  const { fetchConfiguracaoIgrejaFromSupabase, updateConfiguracaoIgrejaInSupabase } = require('@/lib/igreja-config-utils');

  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    fetchConfiguracaoIgrejaFromSupabase(supabase)
      .then((config: any) => setLogoPreview(config.logo || null))
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          if (img.width < 200 || img.height < 200) {
            onNotification('Aviso', 'A imagem deve ter no mÃ­nimo 200x200 pixels', 'warning');
            return;
          }
          const logoBase64 = event.target?.result as string;
          setLogoPreview(logoBase64);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveLogo = async () => {
    if (logoPreview) {
      await updateConfiguracaoIgrejaInSupabase(supabase, { logo: logoPreview });
      onNotification('Sucesso', 'ConfiguraÃ§Ãµes salvas com sucesso!', 'success');
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Identidade Visual - Logomarca</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="text-lg font-bold text-gray-800 mb-4">Upload da Logomarca</h3>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-gray-50 mb-4">
            <div className="text-5xl mb-3">ðŸ“¤</div>
            <p className="text-gray-600 text-sm mb-3">Clique ou arraste a imagem aqui</p>
            <p className="text-gray-500 text-xs mb-4">DimensÃµes recomendadas: 500x500px<br />Formatos: PNG, JPG, SVG | MÃ¡ximo: 5MB</p>
            <input
              type="file"
              accept="image/*"
              onChange={handleLogoChange}
              className="hidden"
              id="logo-input"
            />
            <label
              htmlFor="logo-input"
              className="inline-block px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 cursor-pointer font-semibold"
            >
              ðŸ“ Escolher Imagem
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-bold text-gray-800 mb-4">PrÃ©via da Logomarca</h3>

          <div className="border border-gray-300 rounded-lg p-8 text-center bg-gray-50 mb-4 h-64 flex items-center justify-center">
            {logoPreview ? (
              <img src={logoPreview} alt="Logo Preview" className="max-h-full max-w-full object-contain" />
            ) : (
              <div className="text-gray-400">
                <div className="text-5xl mb-2">ðŸ–¼ï¸</div>
                <p>Nenhuma imagem selecionada</p>
              </div>
            )}
          </div>

          {logoPreview && (
            <button
              onClick={handleSaveLogo}
              className="w-full px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
            >
              âœ“ Salvar Logomarca
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-gray-700">
          ðŸ’¡ <strong>Dica:</strong> As informaÃ§Ãµes da chiesa (nome, endereÃ§o, CNPJ, telefone, email) sÃ£o configuradas na aba <strong>"Perfil da InstituiÃ§Ã£o"</strong> e serÃ£o exibidas automaticamente no cabeÃ§alho dos relatÃ³rios em PDF.
        </p>
      </div>
    </div>
  );
}
// Componente Nomenclaturas
function NomenclaturaContent({ onNotification }: { onNotification: (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void }) {
  const dialog = useAppDialog();
  const [isEditing, setIsEditing] = useState(false);

  const supabase = createClient();

  const CARGOS_MINISTERIAIS_KEY = 'cargos_ministeriais';

  type DivisionKey = 'divisaoPrincipal' | 'divisaoSecundaria' | 'divisaoTerciaria';
  type DivisionConfig = { opcao1: string; custom?: string[] };
  type NomenclaturasState = Record<DivisionKey, DivisionConfig>;

  const NATIVE_OPTIONS: Record<DivisionKey, string[]> = {
    // DivisÃ£o 1 agora usa as opÃ§Ãµes que eram da DivisÃ£o 3
    divisaoPrincipal: ['CONGREGAÃ‡ÃƒO', 'IGREJA', 'TEMPLO', 'NENHUMA'],
    divisaoSecundaria: ['CAMPO', 'SETOR', 'GRUPO', 'ÃREA', 'NENHUMA'],
    // DivisÃ£o 3: deixar apenas "NENHUMA" (usuÃ¡rio pode adicionar manualmente)
    divisaoTerciaria: ['NENHUMA']
  };

  const getDefaultNomenclaturas = (): NomenclaturasState => ({
    divisaoPrincipal: { opcao1: 'IGREJA', custom: [] },
    divisaoSecundaria: { opcao1: 'CAMPO', custom: [] },
    divisaoTerciaria: { opcao1: 'NENHUMA', custom: [] }
  });

  const nomenclaturas: NomenclaturasState = getDefaultNomenclaturas();
  const [temp, setTemp] = useState<NomenclaturasState>(() => getDefaultNomenclaturas());
  const [novaOpcao, setNovaOpcao] = useState<Record<DivisionKey, string>>({
    divisaoPrincipal: '',
    divisaoSecundaria: '',
    divisaoTerciaria: ''
  });

  const [cargosMinisteriais, setCargosMinisteriais] = useState<CargoMinisterial[]>(() => getCargosMinisteriais());
  const [novoCargo, setNovoCargo] = useState('');

  const upsertCargos = async (cargos: CargoMinisterial[]) => {
    const { error } = await supabase
      .from('configurations')
      .upsert({ key: CARGOS_MINISTERIAIS_KEY, value: cargos }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  };

  const loadFromSupabase = async () => {
    const { data, error } = await supabase
      .from('configurations')
      .select('value')
      .eq('key', CARGOS_MINISTERIAIS_KEY)
      .maybeSingle();

    if (!error && data?.value && Array.isArray(data.value)) {
      setCargosMinisteriais(data.value as CargoMinisterial[]);
      saveCargosMinisteriais(data.value as CargoMinisterial[]);
    }
  };

  useEffect(() => {
    loadFromSupabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectChange = (nivel: DivisionKey, value: string) => {
    const selected = (value || '').trim().toUpperCase();
    setTemp(prev => ({
      ...prev,
      [nivel]: {
        ...prev[nivel],
        opcao1: selected
      }
    }));
  };

  const handleAddCustomOption = (nivel: DivisionKey) => {
    const raw = novaOpcao[nivel] || '';
    const value = raw.trim().toUpperCase();

    if (!value) {
      onNotification('Aviso', 'Digite uma nomenclatura para adicionar.', 'warning');
      return;
    }

    const native = NATIVE_OPTIONS[nivel];
    const currentCustom = temp[nivel].custom || [];
    const exists = [...native, ...currentCustom].some(v => v.toUpperCase() === value);
    if (exists) {
      onNotification('Aviso', 'Essa opÃ§Ã£o jÃ¡ existe.', 'warning');
      return;
    }

    setTemp(prev => ({
      ...prev,
      [nivel]: {
        ...prev[nivel],
        opcao1: value,
        custom: [...(prev[nivel].custom || []), value]
      }
    }));
    setNovaOpcao(prev => ({ ...prev, [nivel]: '' }));
  };

  const handleDeleteCustomOption = (nivel: DivisionKey, value: string) => {
    const toDelete = (value || '').trim().toUpperCase();
    setTemp(prev => {
      const custom = (prev[nivel].custom || []).filter(v => v.toUpperCase() !== toDelete);
      const nextSelected = prev[nivel].opcao1?.toUpperCase() === toDelete ? 'NENHUMA' : prev[nivel].opcao1;
      return {
        ...prev,
        [nivel]: {
          ...prev[nivel],
          opcao1: nextSelected,
          custom
        }
      };
    });
  };

  const handleSave = async () => {
    try {
      await upsertCargos(cargosMinisteriais);
      setIsEditing(false);
      onNotification('Sucesso', 'Cargos atualizados com sucesso!', 'success');
    } catch (error: any) {
      console.error('âŒ Erro ao salvar cargos:', error);
      onNotification('Erro', `Erro ao salvar: ${error?.message || 'Tente novamente'}`, 'error');
    }
  };

  const handleCancel = () => {
    console.log('âŒ Cancelando ediÃ§Ã£o, revertendo para:', nomenclaturas);
    setTemp(nomenclaturas);
    setIsEditing(false);
  };

  const toggleCargo = (id: number) => {
    const nextCargos = cargosMinisteriais.map(cargo =>
      cargo.id === id ? { ...cargo, ativo: !cargo.ativo } : cargo
    );
    setCargosMinisteriais(nextCargos);
    saveCargosMinisteriais(nextCargos);
  };

  const adicionarCargo = () => {
    const nomeNormalizado = novoCargo.trim();

    // ValidaÃ§Ãµes
    if (!nomeNormalizado) {
      onNotification('Aviso', 'Por favor, digite o nome do cargo.', 'warning');
      return;
    }

    // Verificar duplicados (case insensitive)
    const jaExiste = cargosMinisteriais.some(
      cargo => cargo.nome.toLowerCase() === nomeNormalizado.toLowerCase()
    );

    if (jaExiste) {
      onNotification('Aviso', 'Este cargo jÃ¡ existe na lista.', 'warning');
      return;
    }

    // Adicionar novo cargo
    const novoId = Math.max(...cargosMinisteriais.map(c => c.id), 0) + 1;
    const novoCargoObj: CargoMinisterial = {
      id: novoId,
      nome: nomeNormalizado,
      ativo: true
    };

    const nextCargos = [...cargosMinisteriais, novoCargoObj];
    setCargosMinisteriais(nextCargos);
    saveCargosMinisteriais(nextCargos);
    setNovoCargo('');
    onNotification('Sucesso', `Cargo "${nomeNormalizado}" adicionado com sucesso!`, 'success');
  };

  const removerCargo = async (id: number) => {
    const cargo = cargosMinisteriais.find(c => c.id === id);
    if (!cargo) return;

    const ok = await dialog.confirm({
      title: 'Confirmar',
      type: 'warning',
      message: `Deseja realmente remover o cargo "${cargo.nome}"?`,
      confirmText: 'OK',
      cancelText: 'Cancelar',
    })

    if (ok) {
      const nextCargos = cargosMinisteriais.filter(c => c.id !== id);
      setCargosMinisteriais(nextCargos);
      saveCargosMinisteriais(nextCargos);
      onNotification('Sucesso', `Cargo "${cargo.nome}" removido com sucesso!`, 'success');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Cargos Ministeriais</h2>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className={`px-6 py-2 rounded-lg transition font-semibold ${isEditing
            ? 'bg-gray-500 text-white hover:bg-gray-600'
            : 'bg-teal-600 text-white hover:bg-teal-700'
            }`}
        >
          {isEditing ? 'âŒ Cancelar' : 'âœï¸ Editar'}
        </button>
      </div>

      {/* Placeholder para manter estrutura - seÃ§Ã£o removida */}
      {false && <div className="mb-8">
        <h3 className="text-xl font-bold text-gray-800 mb-4">ðŸ¢ DivisÃµes Organizacionais</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {(['divisaoPrincipal', 'divisaoSecundaria', 'divisaoTerciaria'] as DivisionKey[]).map((key, index) => (
            <div key={key} className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span>{index + 1}ï¸âƒ£</span> {index === 0 ? 'Primeira' : index === 1 ? 'Segunda' : 'Terceira'} DivisÃ£o
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Nomenclatura</label>
                  {isEditing ? (
                    <div className="space-y-3">
                      <select
                        value={temp[key].opcao1}
                        onChange={(e) => handleSelectChange(key, e.target.value)}
                        autoFocus={index === 0}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                      >
                        {Array.from(
                          new Set([
                            ...NATIVE_OPTIONS[key],
                            ...(temp[key].custom || [])
                          ])
                        ).map(option => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>

                      <div className="flex gap-3">
                        <input
                          type="text"
                          value={novaOpcao[key]}
                          onChange={(e) => setNovaOpcao(prev => ({ ...prev, [key]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddCustomOption(key);
                          }}
                          placeholder="Digite um novo valor"
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <button
                          onClick={() => handleAddCustomOption(key)}
                          className="px-5 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-semibold whitespace-nowrap"
                        >
                          âž• Adicionar
                        </button>
                      </div>

                      {(temp[key].custom || []).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-gray-600">OpÃ§Ãµes personalizadas:</p>
                          <div className="space-y-2">
                            {(temp[key].custom || []).map(option => (
                              <div key={option} className="flex items-center justify-between p-2 border border-gray-200 rounded-lg bg-gray-50">
                                <span className="text-sm font-semibold text-gray-800">{option}</span>
                                <button
                                  onClick={() => handleDeleteCustomOption(key, option)}
                                  className="text-red-500 hover:text-red-700 transition"
                                  title="Remover opÃ§Ã£o personalizada"
                                >
                                  ðŸ—‘ï¸
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-lg font-semibold text-teal-700">{nomenclaturas[key].opcao1}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* SeÃ§Ã£o: Cargos Ministeriais */}
      <div className="mb-8">
        <h3 className="text-xl font-bold text-gray-800 mb-4">â›ª Cargos Ministeriais</h3>
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {cargosMinisteriais.map(cargo => (
              <div key={cargo.id} className={`flex items-center gap-3 p-3 border border-gray-300 rounded-lg ${isEditing ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-75'}`}>
                <input
                  type="checkbox"
                  checked={cargo.ativo}
                  onChange={() => toggleCargo(cargo.id)}
                  disabled={!isEditing}
                  className={`w-5 h-5 ${isEditing ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                />
                <span className={`flex-1 font-semibold ${cargo.ativo ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                  {cargo.nome}
                </span>
                {isEditing && cargo.id > 8 && (
                  <button
                    onClick={() => removerCargo(cargo.id)}
                    className="text-red-500 hover:text-red-700 transition"
                    title="Remover cargo"
                  >
                    ðŸ—‘ï¸
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Campo para adicionar novo cargo */}
          {isEditing && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="text-sm font-bold text-gray-800 mb-3">âž• Adicionar Novo Cargo</h4>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={novoCargo}
                  onChange={(e) => setNovoCargo(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && adicionarCargo()}
                  placeholder="Ex: Cooperador, Obreiro, etc."
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <button
                  onClick={adicionarCargo}
                  className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-semibold whitespace-nowrap"
                >
                  âž• Adicionar
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                ðŸ’¡ Digite o nome do novo cargo e clique em "Adicionar". VocÃª pode remover cargos personalizados clicando no Ã­cone ðŸ—‘ï¸.
              </p>
            </div>
          )}

          <p className="text-xs text-gray-600 mt-4">
            ðŸ’¡ Marque os cargos que deseja disponibilizar no sistema. Eles aparecerÃ£o no formulÃ¡rio de cadastro de ministros.
          </p>
        </div>
      </div>

      {isEditing && (
        <div className="flex gap-4 mt-6">
          <button
            onClick={handleSave}
            className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
          >
            âœ“ Salvar
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition font-semibold"
          >
            âœ• Descartar
          </button>
        </div>
      )}
    </div>
  );
}
