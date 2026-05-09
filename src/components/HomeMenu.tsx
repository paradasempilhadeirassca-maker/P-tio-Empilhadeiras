import React from 'react';
import { 
  LayoutDashboard, 
  Truck, 
  Wrench, 
  History, 
  ClipboardList, 
  ClipboardCheck,
  AlertTriangle,
  PlusCircle,
  Package,
  User as UserIcon,
  LogOut,
  ChevronRight,
  WifiOff,
  Settings,
  Activity,
  Zap,
  Loader2,
  Lock,
  X,
  Info
} from 'lucide-react';
import { 
  collection, 
  query, 
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';
import { UserProfile } from '../types';
import { useState, useEffect } from 'react';
import { useAuth } from './Auth';
import { WeeklyReminder } from './WeeklyReminder';

interface HomeMenuProps {
  profile: UserProfile;
  onViewChange: (view: string) => void;
  onLogout: () => void;
}

export function HomeMenu({ profile, onViewChange, onLogout }: HomeMenuProps) {
  const { updateUserPassword } = useAuth();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [passError, setPassError] = useState('');
  const [activeTab, setActiveTab] = useState<'profile' | 'system'>('profile');
  const [isResetting, setIsResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetStatus, setResetStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

  const handleResetData = async () => {
    setIsResetting(true);
    setShowResetConfirm(false);
    setResetStatus({ type: 'error', message: '⏳ Iniciando limpeza...' });
    
    const collectionsToClear = [
      'checklists',
      'operational_events',
      'maintenance',
      'shift_reports',
      'parts_inventory_history'
    ];

    try {
      // 1. Clear transactional collections
      for (const collName of collectionsToClear) {
        setResetStatus({ type: null, message: `🧹 Limpando ${collName}...` });
        const q = query(collection(db, collName));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) continue;

        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += 500) {
          chunks.push(snapshot.docs.slice(i, i + 500));
        }

        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }

      // 2. Reset forklift states to default
      const forkliftSnapshot = await getDocs(collection(db, 'forklifts'));
      const forkliftBatch = writeBatch(db);
      forkliftSnapshot.docs.forEach(d => {
        forkliftBatch.update(d.ref, {
          status: 'available',
          lastHourMeter: 0,
          currentOperatorId: null,
          lastMaintenance: null,
          nextPreventive: null
        });
      });
      await forkliftBatch.commit();

      setResetStatus({ 
        type: 'success', 
        message: '✅ Base de dados Resetada! Todo o histórico foi removido.' 
      });
      
      setTimeout(() => {
        window.location.reload();
      }, 3000);

    } catch (error) {
      console.error("Erro ao resetar dados:", error);
      setResetStatus({ 
        type: 'error', 
        message: `❌ Erro: ${error instanceof Error ? error.message : 'Erro desconhecido'}` 
      });
    } finally {
      setIsResetting(false);
      setShowResetConfirm(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');

    if (newPassword !== confirmPassword) {
      setPassError('A nova senha e a confirmação não coincidem.');
      return;
    }

    setIsChangingPass(true);
    try {
      await updateUserPassword(currentPassword, newPassword);
      setShowPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPassError(err.message || 'Erro ao alterar a senha.');
    } finally {
      setIsChangingPass(false);
    }
  };

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const menuItems = {
    manager: [
      { id: 'operational-indicators', label: 'Indicadores', description: 'Visão operacional e gargalos', icon: Zap, color: 'bg-amber-500' },
      { id: 'dashboard', label: 'Dashboard', description: 'Indicadores e KPIs de performance', icon: LayoutDashboard, color: 'bg-blue-500' },
      { id: 'fleet', label: 'Gestão de Frota', description: 'Cadastrar máquinas e operadores', icon: Truck, color: 'bg-slate-800' },
      { id: 'leader-apontamento', label: 'Apontamentos', description: 'Registro de eventos em tempo real', icon: Activity, color: 'bg-indigo-600' },
      { id: 'checklist', label: 'Check-list Diário', description: 'Inspeção de conformidade diária', icon: ClipboardCheck, color: 'bg-cyan-500' },
      { id: 'op-register', label: 'Registrar Ocorrência', description: 'Abrir nova ordem de manutenção', icon: PlusCircle, color: 'bg-red-500' },
      { id: 'op-active', label: 'Ocorrências Registradas', description: 'Ver frota e eventos em tempo real', icon: AlertTriangle, color: 'bg-amber-500' },
      { id: 'mech-orders', label: 'Iniciar/Finalizar Manutenção', description: 'Execução de ordens de serviço', icon: Wrench, color: 'bg-indigo-500' },
      { id: 'mech-preventive', label: 'Manutenção Preventiva', description: 'Cronograma de revisões', icon: ClipboardList, color: 'bg-emerald-500' },
      { id: 'parts-inventory', label: 'Gestão de Peças', description: 'Controle de estoque e insumos', icon: Package, color: 'bg-orange-500' },
      { id: 'history', label: 'Histórico Geral', description: 'Todos os registros do sistema', icon: History, color: 'bg-slate-600' },
    ],
    leader: [
      { id: 'operational-indicators', label: 'Indicadores', description: 'Visão operacional e gargalos', icon: Zap, color: 'bg-amber-500' },
      { id: 'leader-apontamento', label: 'Apontamentos', description: 'Registro de eventos em tempo real', icon: Activity, color: 'bg-indigo-600' },
      { id: 'fleet', label: 'Gestão de Frota', description: 'Cadastrar máquinas e operadores', icon: Truck, color: 'bg-slate-800' },
      { id: 'op-register', label: 'Registrar Ocorrência', description: 'Abrir nova ordem de manutenção', icon: PlusCircle, color: 'bg-red-500' },
      { id: 'dashboard', label: 'Dashboard', description: 'Ver indicadores de performance', icon: LayoutDashboard, color: 'bg-blue-500' },
      { id: 'op-active', label: 'Ocorrências Registradas', description: 'Ver frota e eventos em tempo real', icon: AlertTriangle, color: 'bg-amber-500' },
      { id: 'history', label: 'Histórico Mensal', description: 'Todos os eventos registrados', icon: History, color: 'bg-slate-600' },
    ],
    operator: [
      { id: 'checklist', label: 'Check-list Diário', description: 'Realizar inspeção da máquina', icon: ClipboardCheck, color: 'bg-cyan-500' },
      { id: 'op-register', label: 'Registrar Ocorrência', description: 'Reportar problema em máquina', icon: PlusCircle, color: 'bg-red-500' },
      { id: 'op-active', label: 'Ocorrências Registradas', description: 'Ver frota e eventos em tempo real', icon: AlertTriangle, color: 'bg-amber-500' },
      { id: 'history', label: 'Meu Histórico', description: 'Suas paradas registradas', icon: History, color: 'bg-slate-600' },
    ],
    mechanic: [
      { id: 'mech-orders', label: 'Iniciar/Finalizar Manutenção', description: 'Trabalhar em ordens abertas', icon: Wrench, color: 'bg-indigo-500' },
      { id: 'mech-preventive', label: 'Manutenção Preventiva', description: 'Ver revisões programadas', icon: ClipboardList, color: 'bg-emerald-500' },
      { id: 'parts-inventory', label: 'Estoque de Peças', description: 'Consultar e ajustar estoque', icon: Package, color: 'bg-orange-500' },
      { id: 'op-active', label: 'Ocorrências Registradas', description: 'Frota aguardando reparo', icon: AlertTriangle, color: 'bg-amber-500' },
      { id: 'history', label: 'Meu Histórico', description: 'Suas manutenções concluídas', icon: History, color: 'bg-slate-600' },
    ]
  };

  const items = menuItems[profile.role as keyof typeof menuItems] || [];

  return (
    <div className="min-h-full bg-slate-50 p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        <header className="flex justify-between items-center mb-12">
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-xl shadow-slate-200 border-2 border-white overflow-hidden">
              <img 
                src="https://i.postimg.cc/SKcgQrKX/openart-image-CVX2wu-Ks-1775830140914-raw-Photoroom.png" 
                alt="Logo" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">PÁTIO</h1>
              <p className="text-slate-500 font-medium mt-1">Gestão de Empilhadeiras</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isOffline && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-600 rounded-xl border border-amber-100 animate-pulse">
                <WifiOff className="w-4 h-4" />
                <span className="text-xs font-black uppercase tracking-widest">Modo Offline</span>
              </div>
            )}
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold text-slate-900">{profile.displayName}</p>
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{profile.role}</p>
            </div>
            <button 
              onClick={() => setShowPasswordModal(true)}
              className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-blue-600 hover:border-blue-100 transition-all shadow-sm"
              title="Configurações"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={onLogout}
              className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-600 hover:border-red-100 transition-all shadow-sm"
              title="Sair"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        <WeeklyReminder />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className="group bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:shadow-blue-900/5 hover:border-blue-200 transition-all text-left flex flex-col h-full relative overflow-hidden"
            >
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110 duration-300",
                item.color
              )}>
                <item.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1">{item.label}</h3>
              <p className="text-xs text-slate-500 mb-4 flex-1">{item.description}</p>
              <div className="flex items-center gap-2 text-blue-600 text-[10px] font-bold uppercase tracking-wider group-hover:translate-x-1 transition-transform">
                Acessar
                <ChevronRight className="w-3 h-3" />
              </div>
            </button>
          ))}
        </div>

        <footer className="mt-16 pt-8 border-t border-slate-200 flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
              Sistema Operacional
            </span>
            <span>v1.0.0</span>
          </div>
          <div>© 2026 Empilhadeiras Pátio</div>
        </footer>

        {/* Settings Modal */}
        {showPasswordModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-600 rounded-2xl text-white">
                    <Settings className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">Configurações</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ajustes e administração</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setShowPasswordModal(false);
                    setShowResetConfirm(false);
                  }}
                  className="p-2 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              {/* Tabs */}
              {profile.role === 'manager' && (
                <div className="flex bg-slate-50 p-2 gap-2 mx-8 mt-6 rounded-[1.25rem] border border-slate-200/50">
                  <button
                    onClick={() => setActiveTab('profile')}
                    className={cn(
                      "flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                      activeTab === 'profile' ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    Meu Perfil
                  </button>
                  <button
                    onClick={() => setActiveTab('system')}
                    className={cn(
                      "flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                      activeTab === 'system' ? "bg-white text-red-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    Sistema
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {activeTab === 'profile' ? (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-black text-slate-900 tracking-tight mb-1">Alterar Senha</h3>
                      <p className="text-sm font-medium text-slate-500">Mantenha seu acesso seguro e atualizado.</p>
                    </div>

                    <form onSubmit={handleChangePassword} className="space-y-4">
                      {passError && (
                        <div className="p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100">
                          {passError}
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Senha Atual</label>
                        <input 
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 transition-all font-medium"
                          placeholder="Sua senha atual"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nova Senha</label>
                        <input 
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 transition-all font-medium"
                          placeholder="Mínimo 6 caracteres"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Confirmar Nova Senha</label>
                        <input 
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-600 transition-all font-medium"
                          placeholder="Repita a nova senha"
                          required
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isChangingPass}
                        className="w-full bg-slate-900 text-white py-4 rounded-[1.25rem] font-black text-sm hover:bg-blue-600 transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
                      >
                        {isChangingPass ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar Alteração'}
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="space-y-6">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Zona de Perigo</h3>
                      </div>

                      <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-200 text-left space-y-4 shadow-inner">
                        <div>
                          <h3 className="text-base font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                            Limpeza da Base de Dados
                          </h3>
                          <p className="text-xs text-slate-500 mt-2 leading-relaxed font-medium">
                            Esta ação apaga todos os apontamentos, checklists e históricos, mantendo os cadastros de máquinas e operadores. Use apenas para iniciar a operação real ou limpar testes.
                          </p>
                        </div>
                        
                        {resetStatus.type && (
                          <div className={cn(
                            "p-4 rounded-2xl text-[10px] font-black uppercase tracking-wider animate-in zoom-in-95 duration-200 border",
                            resetStatus.type === 'success' ? "bg-green-50 text-green-700 border-green-100" : "bg-red-50 text-red-700 border-red-100"
                          )}>
                            {resetStatus.message}
                          </div>
                        )}

                        {!showResetConfirm ? (
                          <button
                            onClick={() => setShowResetConfirm(true)}
                            className="w-full py-5 rounded-2xl bg-red-600 text-white font-black uppercase text-xs tracking-widest hover:bg-red-700 shadow-xl shadow-red-100 transition-all flex items-center justify-center gap-3"
                          >
                            <Wrench className="w-5 h-5" />
                            Limpar Dados de Produção
                          </button>
                        ) : (
                          <div className="space-y-4 pt-4 border-t border-slate-200">
                            <p className="text-[10px] font-black text-red-600 uppercase tracking-widest text-center italic animate-pulse">Confirmar exclusão definitiva? Esta ação é irreversível.</p>
                            <div className="flex gap-3">
                              <button
                                onClick={handleResetData}
                                disabled={isResetting}
                                className={cn(
                                  "flex-1 py-5 rounded-2xl font-black uppercase text-xs tracking-widest transition-all flex items-center justify-center gap-2",
                                  isResetting 
                                    ? "bg-slate-200 text-slate-400 cursor-not-allowed" 
                                    : "bg-red-600 text-white hover:bg-red-700 shadow-xl shadow-red-100"
                                )}
                              >
                                {isResetting ? <Loader2 className="w-5 h-5 animate-spin" /> : "CONFIRMAR E APAGAR"}
                              </button>
                              <button
                                onClick={() => setShowResetConfirm(false)}
                                disabled={isResetting}
                                className="flex-1 py-5 rounded-2xl bg-slate-100 text-slate-600 font-black uppercase text-xs tracking-widest hover:bg-slate-200 transition-all"
                              >
                                CANCELAR
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
