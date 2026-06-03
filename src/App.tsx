/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { AuthProvider, useAuth, LoginScreen } from './components/Auth';
import { DataProvider } from './components/DataContext';
import { ToastProvider } from './components/ToastContext';
import { OperatorView } from './components/OperatorView';
import { MechanicView } from './components/MechanicView';
import { ManagerDashboard } from './components/ManagerDashboard';
import { HomeMenu } from './components/HomeMenu';
import { MaintenanceHistory } from './components/MaintenanceHistory';
import { ActiveMachinesView } from './components/ActiveMachinesView';
import { PreventiveView } from './components/PreventiveView';
import { PartsInventory } from './components/PartsInventory';
import { ChecklistView } from './components/ChecklistView';
import { FleetManagement } from './components/FleetManagement';
import { MechanicAvailabilityView } from './components/MechanicAvailabilityView';
import { requestNotificationPermission } from './lib/notifications';
import { 
  Truck, 
  ArrowLeft,
  Home,
  Wrench,
  WifiOff
} from 'lucide-react';

function AppContent() {
  const { user, profile, loading, logout, quotaExceeded, setQuotaExceeded } = useAuth();
  const [activeView, setActiveView] = useState<string>('menu');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

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

  useEffect(() => {
    if (user && profile) {
      requestNotificationPermission().catch(console.error);
    }
  }, [user, profile]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-8 text-center">
        <div className="relative mb-8">
          <div className="absolute inset-0 bg-blue-100 rounded-full animate-ping opacity-25"></div>
          <div className="relative animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600"></div>
        </div>
        <h2 className="text-xl font-black text-slate-900 mb-2">Carregando dados...</h2>
        <p className="text-slate-500 text-sm max-w-xs">
          {isOffline 
            ? "Você está offline. O sistema está carregando os dados salvos localmente no seu dispositivo." 
            : "Sincronizando informações com o servidor."}
        </p>
        
        {isOffline && (
          <div className="mt-8 px-4 py-2 bg-amber-50 text-amber-600 rounded-xl border border-amber-100 flex items-center gap-2 animate-bounce">
            <WifiOff className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Modo Offline Ativo</span>
          </div>
        )}
      </div>
    );
  }

  if (!user || !profile) {
    return <LoginScreen />;
  }

  const renderView = () => {
    if (activeView === 'menu') {
      return (
        <HomeMenu 
          profile={profile} 
          onViewChange={setActiveView} 
          onLogout={logout} 
        />
      );
    }

    switch (activeView) {
      case 'dashboard': return <ManagerDashboard />;
      case 'op-register': return <OperatorView mode="register" />;
      case 'op-active': return <ActiveMachinesView onNavigate={setActiveView} />;
      case 'mech-orders': return <MechanicView />;
      case 'mech-preventive': return <PreventiveView />;
      case 'parts-inventory': return <PartsInventory />;
      case 'checklist': return <ChecklistView />;
      case 'fleet': return <FleetManagement />;
      case 'mechanic-availability': return <MechanicAvailabilityView />;
      case 'history': {
        const historyRole = (profile.role === 'manager' || profile.role === 'leader') 
          ? 'manager' 
          : (profile.role === 'mechanic' ? 'mechanic' : 'operator');
        return <MaintenanceHistory role={historyRole} />;
      }
      default: return <div className="p-8 text-center">Selecione uma opção no menu.</div>;
    }
  };

  if (activeView === 'menu') {
    return renderView();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* View Header with Back Button */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex justify-between items-center">
          <button 
            onClick={() => setActiveView('menu')}
            className="flex items-center gap-2 text-slate-500 hover:text-blue-600 font-bold text-sm transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </div>
            <span className="hidden sm:inline italic">VOLTAR AO MENU</span>
          </button>
          
          <div className="flex items-center gap-3">
            {isOffline && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-600 rounded-lg border border-amber-100 animate-pulse">
                <WifiOff className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-widest">Offline</span>
              </div>
            )}
            <div className="relative w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-100 overflow-hidden">
              <img 
                src="https://i.postimg.cc/SKcgQrKX/openart-image-CVX2wu-Ks-1775830140914-raw-Photoroom.png" 
                alt="Logo" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <span className="text-sm font-black tracking-tight text-slate-900 uppercase">Pátio</span>
          </div>

          <button 
            onClick={() => setActiveView('menu')}
            className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center hover:bg-blue-600 transition-colors shadow-lg shadow-slate-200"
            title="Início"
          >
            <Home className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        {renderView()}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <DataProvider>
          <AppContent />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

