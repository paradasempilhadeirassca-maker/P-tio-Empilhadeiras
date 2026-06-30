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
  Briefcase,
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
  Info,
  Save,
  Trash2,
  Plus,
  Bell,
  BellRing
} from 'lucide-react';
import { 
  collection, 
  query, 
  getDocs,
  writeBatch,
  doc,
  updateDoc,
  deleteDoc,
  where,
  addDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../lib/utils';
import { UserProfile } from '../types';
import { useState, useEffect } from 'react';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { WeeklyReminder } from './WeeklyReminder';
import { handleFirestoreError, OperationType as FirestoreOp } from '../lib/firebaseErrorHandler';

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
  const [activeTab, setActiveTab ] = useState<'profile' | 'system'>('profile');
  const [isResetting, setIsResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetStatus, setResetStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });
  
  // Mechanic presence/absence (pointing) states
  const [selectedMechanicId, setSelectedMechanicId] = useState<string>('');
  const [absenceStartDate, setAbsenceStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [absenceEndDate, setAbsenceEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [absenceNotes, setAbsenceNotes] = useState<string>('');
  const [isLoggingAbsence, setIsLoggingAbsence] = useState<boolean>(false);

  // Push notifications states
  const [notificationPermission, setNotificationPermission] = useState<string>('default');
  const [showNotificationBanner, setShowNotificationBanner] = useState<boolean>(false);
  const [isSubscribingPush, setIsSubscribingPush] = useState<boolean>(false);
  const [pushStatusMsg, setPushStatusMsg] = useState<string>('');
  const [showNotificationInstructions, setShowNotificationInstructions] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(window.Notification.permission);
      
      const dismissed = localStorage.getItem('dismiss_push_banner_v2');
      if (window.Notification.permission !== 'granted' && dismissed !== 'true') {
        setShowNotificationBanner(true);
      }
    }
  }, []);

  const handleEnableNotifications = async () => {
    setIsSubscribingPush(true);
    setPushStatusMsg('');
    try {
      const { requestNotificationPermission, subscribeUserToPush } = await import('../lib/notifications');
      const granted = await requestNotificationPermission();
      if (granted) {
        setNotificationPermission('granted');
        await subscribeUserToPush(profile.uid);
        setPushStatusMsg('Este aparelho foi inscrito com sucesso para receber notificações! ✅');
        localStorage.setItem('dismiss_push_banner_v2', 'true');
        setShowNotificationBanner(false);
      } else {
        setNotificationPermission('denied');
        setPushStatusMsg('Permissão de notificação recusada ou bloqueada no navegador.');
      }
    } catch (err: any) {
      console.error(err);
      setPushStatusMsg('Erro ao configurar notificações: ' + err.message);
    } finally {
      setIsSubscribingPush(false);
    }
  };

  const { goals: operationGoals, mechanics, absences } = useData();

  const handleAddAbsence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMechanicId) return;
    
    const mech = mechanics.find(u => u.uid === selectedMechanicId);
    if (!mech) return;

    setIsLoggingAbsence(true);
    try {
      const newAbsence = {
        operatorId: selectedMechanicId,
        operatorName: mech.displayName || mech.email,
        startDate: absenceStartDate,
        endDate: absenceEndDate,
        reason: 'Indisponibilidade',
        role: 'mechanic',
        sector: mech.sector || 'Geral',
        notes: absenceNotes || '',
        createdAt: new Date().toISOString()
      };
      
      await addDoc(collection(db, 'operator_absences'), newAbsence);
      alert("Indisponibilidade de mecânico registrada com sucesso!");
      setAbsenceNotes('');
    } catch (err: any) {
      console.error("Error creating absence:", err);
      alert("Erro ao salvar: " + err.message);
    } finally {
      setIsLoggingAbsence(false);
    }
  };

  const handleDeleteAbsence = async (absenceId: string) => {
    if (!confirm("Tem certeza que deseja remover esta indisponibilidade de mecânico?")) return;
    try {
      await deleteDoc(doc(db, 'operator_absences', absenceId));
    } catch (err: any) {
      console.error("Error deleting absence:", err);
      alert("Erro ao remover: " + err.message);
    }
  };

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
      { id: 'dashboard', label: 'Dashboard', description: 'Indicadores e KPIs de performance', icon: LayoutDashboard, color: 'bg-blue-500' },
      { id: 'fleet', label: 'Gestão de Frota', description: 'Cadastrar máquinas e operadores', icon: Truck, color: 'bg-slate-800' },
      { id: 'mechanic-availability', label: 'Disponibilidade do Mecânico', description: 'Escala, presença e impactos', icon: Briefcase, color: 'bg-teal-600' },
      { id: 'checklist', label: 'Check-list Diário', description: 'Inspeção de conformidade diária', icon: ClipboardCheck, color: 'bg-cyan-500' },
      { id: 'op-register', label: 'Registrar Ocorrência', description: 'Abrir nova ordem de manutenção', icon: PlusCircle, color: 'bg-red-500' },
      { id: 'op-active', label: 'Ocorrências Registradas', description: 'Ver frota e eventos em tempo real', icon: AlertTriangle, color: 'bg-amber-500' },
      { id: 'mech-orders', label: 'Iniciar/Finalizar Manutenção', description: 'Execução de ordens de serviço', icon: Wrench, color: 'bg-indigo-500' },
      { id: 'mech-preventive', label: 'Manutenção Preventiva', description: 'Cronograma de revisões', icon: ClipboardList, color: 'bg-emerald-500' },
      { id: 'parts-inventory', label: 'Gestão de Peças', description: 'Controle de estoque e insumos', icon: Package, color: 'bg-orange-500' },
      { id: 'history', label: 'Histórico Geral', description: 'Todos os registros do sistema', icon: History, color: 'bg-slate-600' },
    ],
    leader: [
      { id: 'fleet', label: 'Gestão de Frota', description: 'Cadastrar máquinas e operadores', icon: Truck, color: 'bg-slate-800' },
      { id: 'mechanic-availability', label: 'Disponibilidade do Mecânico', description: 'Escala, presença e impactos', icon: Briefcase, color: 'bg-teal-600' },
      { id: 'op-register', label: 'Registrar Ocorrência', description: 'Abrir nova ordem de manutenção', icon: PlusCircle, color: 'bg-red-500' },
      { id: 'dashboard', label: 'Dashboard', description: 'Ver indicadores de performance', icon: LayoutDashboard, color: 'bg-blue-500' },
      { id: 'op-active', label: 'Ocorrências Registradas', description: 'Ver frota e eventos em tempo real', icon: AlertTriangle, color: 'bg-amber-500' },
      { id: 'history', label: 'Histórico Mensal', description: 'Todos os eventos registrados', icon: History, color: 'bg-slate-600' },
    ],
    operator: [
      { id: 'dashboard', label: 'Dashboard', description: 'Ver indicadores de performance', icon: LayoutDashboard, color: 'bg-blue-500' },
      { id: 'checklist', label: 'Check-list Diário', description: 'Realizar inspeção da máquina', icon: ClipboardCheck, color: 'bg-cyan-500' },
      { id: 'op-register', label: 'Registrar Ocorrência', description: 'Reportar problema em máquina', icon: PlusCircle, color: 'bg-red-500' },
      { id: 'op-active', label: 'Ocorrências Registradas', description: 'Ver frota e eventos em tempo real', icon: AlertTriangle, color: 'bg-amber-500' },
      { id: 'history', label: 'Meu Histórico', description: 'Suas paradas registradas', icon: History, color: 'bg-slate-600' },
    ],
    mechanic: [
      { id: 'dashboard', label: 'Dashboard', description: 'Ver indicadores de performance', icon: LayoutDashboard, color: 'bg-blue-500' },
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

        {/* Dynamic Push Notification Opt-in Banner */}
        {showNotificationBanner && (
          <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-[2rem] shadow-sm flex flex-col gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-600 rounded-2xl text-white shrink-0 shadow-md">
                  <BellRing className="w-6 h-6 animate-bounce" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 tracking-tight">Ativar Notificações no Celular/Aparelho</h3>
                  <p className="text-slate-600 text-sm font-medium leading-relaxed mt-1">
                    Receba alertas de <strong>Registros de Ocorrências</strong>, <strong>Check-Lists</strong> e do <strong>Início/Fim de Manutenção</strong> em tempo real, mesmo com o aplicativo fechado!
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto self-end md:self-center shrink-0">
                <button
                  onClick={() => setShowNotificationInstructions(!showNotificationInstructions)}
                  className="px-4 py-3 bg-white hover:bg-slate-100 rounded-xl text-blue-600 hover:text-blue-700 font-bold text-xs uppercase tracking-widest border border-blue-200 transition-all active:scale-95 flex-1 md:flex-none text-center"
                >
                  {showNotificationInstructions ? 'Fechar Instruções' : 'Como Funciona? 📱'}
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem('dismiss_push_banner_v2', 'true');
                    setShowNotificationBanner(false);
                  }}
                  className="px-4 py-3 bg-white hover:bg-slate-100 rounded-xl text-slate-500 hover:text-slate-700 font-bold text-xs uppercase tracking-widest border border-slate-200 transition-all active:scale-95 flex-1 md:flex-none text-center"
                >
                  Esconder
                </button>
                <button
                  onClick={handleEnableNotifications}
                  disabled={isSubscribingPush}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs uppercase tracking-widest shadow-md transition-all active:scale-95 disabled:opacity-50 flex-1 md:flex-none text-center flex items-center justify-center gap-2"
                >
                  {isSubscribingPush ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ativar Agora'}
                </button>
              </div>
            </div>

            {showNotificationInstructions && (
              <div className="mt-2 p-5 bg-white border border-slate-150 rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="space-y-3">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                    Para iPhone (iOS) - Recomendado/Obrigatório
                  </h4>
                  <ul className="text-xs text-slate-600 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                    <li>No Safari do seu iPhone, clique no botão de <strong className="text-blue-600">Compartilhar</strong> (ícone de um quadrado com uma seta apontando para cima).</li>
                    <li>Role as opções para baixo e clique em <strong className="text-blue-600">"Adicionar à Tela de Início"</strong>.</li>
                    <li>Abra o aplicativo através do novo ícone criado na tela inicial do seu celular.</li>
                    <li>Clique no botão <strong className="text-blue-600">"Ativar Agora"</strong> acima e, quando o iOS perguntar se deseja enviar notificações, clique em <strong className="text-blue-600">Permitir</strong>.</li>
                  </ul>
                  <p className="text-[10px] text-amber-600 font-bold leading-relaxed bg-amber-50 p-2.5 rounded-xl border border-amber-100 mt-2">
                    ⚠️ Importante: A Apple por segurança bloqueia o envio de notificações push em plano de fundo se você usar o site aberto em uma aba comum do Safari. É obrigatório instalar o ícone na Tela de Início!
                  </p>
                </div>
                <div className="space-y-3">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                    Para Android (Samsung, Motorola, Xiaomi, etc.)
                  </h4>
                  <ul className="text-xs text-slate-600 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                    <li>Clique no botão azul <strong className="text-blue-600">"Ativar Agora"</strong> acima.</li>
                    <li>Quando o navegador perguntar se deseja enviar notificações, selecione <strong className="text-blue-600">"Permitir"</strong> (Allow).</li>
                    <li>Para obter o aplicativo completo sem barras de endereço, clique em instalar aplicativo nas configurações do navegador Chrome.</li>
                    <li>Para garantir que os alertas cheguem instantaneamente com o app fechado, certifique-se de que o navegador Chrome não está na lista de "suspensão profunda" ou "economia extrema de bateria" em suas configurações do celular.</li>
                  </ul>
                  <p className="text-[10px] text-blue-600 font-bold leading-relaxed bg-blue-50/50 p-2.5 rounded-xl border border-blue-100/50 mt-2">
                    📶 Sincronização Inteligente: Graças à tecnologia do aplicativo, caso seu celular perca a internet ao registrar algo, os alertas são guardados e serão disparados de forma automática em segundo plano assim que a conexão voltar!
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

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
                  <div className="space-y-8">
                    {/* Dedicated Notification Subscription settings area */}
                    <div className="p-6 bg-slate-50 border border-slate-200 rounded-[1.75rem] space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl shadow-inner">
                          <Bell className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-base font-black text-slate-900 tracking-tight">Notificações Push do Aparelho</h4>
                          <p className="text-xs font-medium text-slate-500 leading-relaxed mt-0.5">
                            Permita o recebimento de avisos de ocorrências, check-lists e status dos mecânicos para todos os aparelhos integrados.
                          </p>
                        </div>
                      </div>

                      <div className="pt-2 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-xs bg-white px-4 py-3 rounded-xl border border-slate-150">
                          <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Status das Notificações:</span>
                          <span className={cn(
                            "font-black uppercase tracking-widest text-[9.5px] px-2.5 py-1 rounded-full",
                            notificationPermission === 'granted' ? "bg-green-100 text-green-700" :
                            notificationPermission === 'denied' ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                          )}>
                            {notificationPermission === 'granted' ? 'PERMITIDO (Ativo)' :
                             notificationPermission === 'denied' ? 'BLOQUEADO' : 'PENDENTE'}
                          </span>
                        </div>

                        {pushStatusMsg && (
                          <div className={cn(
                            "p-3 rounded-xl text-center font-bold text-xs",
                            pushStatusMsg.includes('sucesso') ? "bg-green-50 text-green-700 border border-green-100" : "bg-amber-50 text-amber-700 border border-amber-100"
                          )}>
                            {pushStatusMsg}
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={isSubscribingPush}
                          onClick={handleEnableNotifications}
                          className="w-full mt-2 py-3 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isSubscribingPush ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                            notificationPermission === 'granted' ? 'Atualizar/Inscrever Aparelho' : 'Ativar Notificações Neste Aparelho'
                          )}
                        </button>
                      </div>
                    </div>

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
