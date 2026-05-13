import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  doc, 
  updateDoc,
  limit
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { useToast } from './ToastContext';
import { Forklift, MaintenanceStop, ForkliftStatus } from '../types';
import { AlertCircle, Clock, CheckCircle2, Play, Loader2, AlertTriangle, Ban, Info, Wrench, History } from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';
import { sendWhatsAppNotification, sendLocalNotification } from '../lib/notifications';

interface OperatorViewProps {
  mode?: 'register' | 'full';
}

export function OperatorView({ mode = 'full' }: OperatorViewProps) {
  const { profile, setQuotaExceeded } = useAuth();
  const { showToast } = useToast();
  const { forklifts, activeStops, refreshGlobalData } = useData();
  const [selectedForklift, setSelectedForklift] = useState<string>('');
  const [description, setDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('high');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => refreshGlobalData(true);

  // Pre-select assigned forklift
  useEffect(() => {
    if (profile && forklifts.length > 0 && !selectedForklift) {
      const assigned = forklifts.find(f => f.assignedOperatorId === profile.uid);
      if (assigned) {
        setSelectedForklift(assigned.id);
      }
    }
  }, [profile, forklifts, selectedForklift]);

  const handleRegisterStop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedForklift || !profile) return;

    const isActiveStop = activeStops.some(s => s.forkliftId === selectedForklift);
    if (isActiveStop) {
      showToast('Esta máquina está em PARADA CRÍTICA. Não é possível registrar novas ocorrências até o reparo.', 'error');
      return;
    }

    setIsUploading(true);
    
    try {
      const maintenanceData = {
        forkliftId: selectedForklift,
        type: 'corrective',
        status: 'pending',
        operatorId: profile.uid, // Keep for legacy if needed
        operatorName: profile.displayName || profile.email.split('@')[0], // Keep for legacy if needed
        operatorIds: [profile.uid],
        operatorNames: [profile.displayName || profile.email.split('@')[0]],
        stopTime: new Date().toISOString(),
        description,
        parts: [],
        severity,
        isIncidentOnly: severity !== 'high'
      };

      // Start operations
      const addPromise = addDoc(collection(db, 'maintenance'), maintenanceData);
      
      // Update forklift status
      const promises: Promise<any>[] = [addPromise];
      
      let newStatus: any = 'at_risk';
      // Low severity stays available or at_risk? 
      // User says "Reparo" should allow operation. at_risk is best as it signals maintenance needed.
      if (severity === 'low') newStatus = 'at_risk'; 
      else if (severity === 'medium') newStatus = 'at_risk';
      else if (severity === 'high') newStatus = 'stopped';

      if (newStatus !== 'available') {
        promises.push(updateDoc(doc(db, 'forklifts', selectedForklift), {
          status: newStatus
        }));
      }

      // Race against a timeout to provide immediate feedback if offline/slow
      const result = await Promise.race([
        Promise.all(promises),
        new Promise(resolve => setTimeout(() => resolve('offline_timeout'), 2500))
      ]);

      if (result === 'offline_timeout') {
        showToast('Registro salvo localmente! Será sincronizado ao restaurar a conexão.', 'info');
      } else {
        showToast('Registro realizado com sucesso!', 'success');
      }

      // Send WhatsApp Notification
      const forklift = forklifts.find(f => f.id === selectedForklift);
      const machineName = forklift ? `${forklift.model} ${forklift.serialNumber}` : 'Máquina';
      
      const severityLabels = {
        low: 'REPARO (Sem parada)',
        medium: 'FALHA IMINENTE (Risco)',
        high: 'PARADA CRÍTICA'
      };

      const statusLabels = {
        low: 'Operando',
        medium: 'Operando com risco',
        high: 'Máquina Indisponível'
      };

      const notificationTitle = `🚨 ${severityLabels[severity]}`;
      const notificationBody = `Máquina: ${machineName}\nOperador: ${profile.displayName || profile.email}\nProblema: ${description}\nStatus: ${statusLabels[severity]}`;

      sendLocalNotification(notificationTitle, notificationBody);
      
      sendWhatsAppNotification(
        `🚨 *${severityLabels[severity]}*\n\n` +
        `*Máquina:* ${machineName}\n` +
        `*Operador:* ${profile.displayName || profile.email}\n` +
        `*Problema:* ${description}\n` +
        `*Status:* ${statusLabels[severity]}\n` +
        `*Data/Hora:* ${new Date().toLocaleString('pt-BR')}`
      );

      setSelectedForklift('');
      setDescription('');
      setSeverity('high');
    } catch (error: any) {
      console.error("Critical error registering stop:", error);
      handleFirestoreError(error, OperationType.WRITE, 'maintenance');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSeedFleet = async () => {
    const defaultFleet = [
      { model: 'Mx25', serialNumber: '91005-04' },
      { model: 'Mx25', serialNumber: '91005-05' },
      { model: 'Mx25', serialNumber: '91005-06' },
      { model: 'Mx25', serialNumber: '91005-07' },
      { model: 'Mx25', serialNumber: '91005-08' },
      { model: 'Manipulador', serialNumber: '93006-30' },
      { model: 'Manipulador', serialNumber: '93006-31' },
    ];

    try {
      const existingSerials = new Set(forklifts.map(f => f.serialNumber));
      let addedCount = 0;

      for (const item of defaultFleet) {
        if (!existingSerials.has(item.serialNumber)) {
          await addDoc(collection(db, 'forklifts'), {
            ...item,
            status: 'available',
            createdAt: new Date().toISOString()
          });
          existingSerials.add(item.serialNumber); // Prevent adding same serial in same loop
          addedCount++;
        }
      }
      
      if (addedCount > 0) {
        showToast(`${addedCount} máquinas importadas com sucesso!`);
      } else {
        showToast('Toda a frota já está cadastrada.', 'info');
      }
    } catch (error) {
      console.error("Error seeding fleet:", error);
      showToast('Erro ao importar frota.', 'error');
    }
  };

  const fleetList = useMemo(() => {
    // Determine which machines have active maintenance occurrences
    const machineStatusMap = new Map<string, ForkliftStatus>();
    activeStops.forEach(stop => {
      const f = forklifts.find(fork => fork.id === stop.forkliftId);
      if (f?.serialNumber) {
        const serial = f.serialNumber.trim().toLowerCase();
        const severity = stop.severity || 'high';
        const targetStatus: ForkliftStatus = severity === 'high' ? 'stopped' : 'maintenance';
        
        const existingStatus = machineStatusMap.get(serial);
        if (!existingStatus || (existingStatus === 'maintenance' && targetStatus === 'stopped')) {
          machineStatusMap.set(serial, targetStatus);
        }
      }
    });

    const fleetMap = new Map<string, Forklift>();
    
    // Most recent machine record wins for parameters like model, but status is overridden by active stops
    const sortedForklifts = [...forklifts].sort((a, b) => {
      const dateA = (a as any).createdAt || '';
      const dateB = (b as any).createdAt || '';
      return dateB.localeCompare(dateA);
    });

    sortedForklifts.forEach(f => {
      const serial = (f.serialNumber || '').trim().toLowerCase();
      const key = serial || f.id;
      
      if (!fleetMap.has(key)) {
        const enriched = { ...f };
        const activeStatus = serial ? machineStatusMap.get(serial) : null;
        
        if (activeStatus) {
          enriched.status = activeStatus;
        } else if (enriched.status === 'stopped' || enriched.status === 'maintenance') {
          // If no active occurrence, it must be operational
          enriched.status = 'available';
        }
        fleetMap.set(key, enriched);
      }
    });

    // We only want machines that are actually operational
    return Array.from(fleetMap.values())
      .sort((a, b) => (a.serialNumber || '').localeCompare(b.serialNumber || ''));
  }, [forklifts, activeStops]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <header className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              "p-3 rounded-2xl border border-slate-200 transition-all active:scale-95 group",
              isRefreshing ? "bg-slate-50 text-slate-300" : "bg-white text-slate-600 hover:bg-slate-50 hover:border-blue-200"
            )}
            title="Atualizar Dados"
          >
            <History className={cn("w-5 h-5 transition-transform duration-700", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 leading-tight">
              {mode === 'register' ? 'Registrar Ocorrência' : 'Painel do Operador'}
            </h1>
            <p className="text-slate-500 text-sm">
              {mode === 'register' ? 'Informe os detalhes do reparo necessário' : 'Registro de paradas e monitoramento'}
            </p>
          </div>
        </div>
      </header>

      {forklifts.length === 0 && profile?.role === 'manager' && (
        <div className="bg-blue-50 border border-blue-200 p-6 rounded-2xl text-center">
          <p className="text-blue-700 font-medium mb-4">A frota ainda não foi cadastrada.</p>
          <button
            onClick={handleSeedFleet}
            className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-blue-700 transition-all"
          >
            Cadastrar Frota Padrão Agora
          </button>
        </div>
      )}

      <div className={cn("grid gap-8", mode === 'full' ? "md:grid-cols-2" : "max-w-2xl mx-auto w-full")}>
        {/* Register Stop Form */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="text-red-500 w-5 h-5" />
            Formulário de Parada
          </h2>
          <form onSubmit={handleRegisterStop} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Empilhadeira / Manipulador <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedForklift}
                onChange={(e) => setSelectedForklift(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                required
              >
                <option value="">Selecione uma Frota</option>
                {fleetList.map(f => {
                  const hasActive = activeStops.some(s => s.forkliftId === f.id);
                  return (
                    <option key={f.id} value={f.id}>
                      {f.serialNumber} - {f.model} {hasActive ? '(OCORRÊNCIA ATIVA)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-3">
                Tipo de Ocorrência <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-1 gap-3">
                {/* LOW SEVERITY */}
                <div 
                  onClick={() => setSeverity('low')}
                  className={cn(
                    "p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center gap-4",
                    severity === 'low' 
                      ? "border-blue-500 bg-blue-50 ring-4 ring-blue-50" 
                      : "border-slate-100 hover:border-blue-200 bg-slate-50/50"
                  )}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center shadow-sm",
                    severity === 'low' ? "bg-blue-500 text-white" : "bg-white text-blue-500 border border-blue-100"
                  )}>
                    <Wrench className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-slate-900 text-sm leading-tight uppercase">Reparo (Sem parada)</h3>
                    <p className="text-[10px] font-medium text-blue-600 mt-1 uppercase tracking-wider">Status: Operando</p>
                  </div>
                  {severity === 'low' && <CheckCircle2 className="w-5 h-5 text-blue-500" />}
                </div>

                {/* MEDIUM SEVERITY */}
                <div 
                  onClick={() => setSeverity('medium')}
                  className={cn(
                    "p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center gap-4",
                    severity === 'medium' 
                      ? "border-amber-500 bg-amber-50 ring-4 ring-amber-50" 
                      : "border-slate-100 hover:border-amber-200 bg-slate-50/50"
                  )}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center shadow-sm",
                    severity === 'medium' ? "bg-amber-500 text-white" : "bg-white text-amber-500 border border-amber-100"
                  )}>
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-slate-900 text-sm leading-tight uppercase">Falha Iminente (Risco)</h3>
                    <p className="text-[10px] font-medium text-amber-600 mt-1 uppercase tracking-wider">Status: Operando com risco</p>
                  </div>
                  {severity === 'medium' && <CheckCircle2 className="w-5 h-5 text-amber-500" />}
                </div>

                {/* HIGH SEVERITY */}
                <div 
                  onClick={() => setSeverity('high')}
                  className={cn(
                    "p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center gap-4",
                    severity === 'high' 
                      ? "border-red-500 bg-red-50 ring-4 ring-red-50" 
                      : "border-slate-100 hover:border-red-200 bg-slate-50/50"
                  )}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center shadow-sm",
                    severity === 'high' ? "bg-red-500 text-white" : "bg-white text-red-500 border border-red-100"
                  )}>
                    <Ban className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-slate-900 text-sm leading-tight uppercase tracking-tight">Parada (Manutenção)</h3>
                    <p className="text-[10px] font-medium text-red-600 mt-1 uppercase tracking-wider">Status: Máquina Indisponível</p>
                  </div>
                  {severity === 'high' && <CheckCircle2 className="w-5 h-5 text-red-500" />}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Descrição do Problema <span className="text-red-500">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-3 border border-slate-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none h-24 text-sm resize-none"
                placeholder="Descreva o que aconteceu..."
                required
              />
            </div>

            <button
              type="submit"
              disabled={isUploading}
              className={cn(
                "w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-xl mt-4",
                severity === 'low' ? "bg-blue-500 hover:bg-blue-600 shadow-blue-100" :
                severity === 'medium' ? "bg-amber-500 hover:bg-amber-600 shadow-amber-100" :
                "bg-red-600 hover:bg-red-700 shadow-red-100",
                "text-white"
              )}
            >
              {isUploading ? (
                <Loader2 className="w-6 h-6 animate-spin opacity-50" />
              ) : (
                `Confirmar Registro`
              )}
            </button>
          </form>
        </section>

        {/* Active Stops (Only in full mode) */}
        {mode === 'full' && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="text-blue-500 w-5 h-5" />
              Ocorrências Registradas
            </h2>
            <div className="space-y-3">
              {activeStops.length === 0 ? (
                <div className="bg-slate-100 p-8 rounded-2xl text-center text-slate-400">
                  Nenhuma solicitação pendente.
                </div>
              ) : (
                activeStops.map(stop => {
                  const forklift = forklifts.find(f => f.id === stop.forkliftId);
                  const isAwaitingParts = stop.status === 'awaiting_parts';
                  return (
                    <div key={stop.id} className={cn(
                      "p-4 rounded-xl shadow-sm border flex justify-between items-center transition-all",
                      isAwaitingParts ? "bg-amber-50 border-amber-200" :
                      stop.isIncidentOnly ? "bg-orange-50/30 border-orange-100" : "bg-white border-slate-200"
                    )}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900">{forklift?.model || 'Desconhecida'} {forklift?.serialNumber}</h3>
                          {isAwaitingParts ? (
                            <span className="bg-amber-600 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase">Aguardando Peça</span>
                          ) : (
                            <>
                              {stop.severity === 'low' && (
                                <span className="bg-blue-100 text-blue-600 text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-tighter">Reparo</span>
                              )}
                              {stop.severity === 'medium' && (
                                <span className="bg-amber-100 text-amber-600 text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-tighter">Risco de Parada</span>
                              )}
                              {stop.severity === 'high' && (
                                <span className="bg-red-100 text-red-600 text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-tighter">Parada Crítica</span>
                              )}
                            </>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">{new Date(stop.stopTime).toLocaleString()}</p>
                        <div className="mt-2 flex flex-wrap gap-2 items-center">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                            stop.status === 'pending' ? "bg-red-100 text-red-600" : 
                            stop.status === 'awaiting_parts' ? "bg-amber-100 text-amber-700" :
                            "bg-blue-100 text-blue-600"
                          )}>
                            {stop.status === 'pending' ? 'Aguardando Mecânico' : 
                             stop.status === 'awaiting_parts' ? 'Aguardando Peça' :
                             'Em Manutenção'}
                          </span>
                          {isAwaitingParts && stop.pendingPartsList && stop.pendingPartsList.map((p, i) => (
                            <span key={i} className="text-[8px] font-black text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded uppercase">{p}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <span className="text-xs font-medium text-slate-400 block mb-1">Status Máquina</span>
                        <span className="text-xs font-bold text-slate-700 uppercase">
                          {stop.severity === 'low' ? 'Operando' : stop.severity === 'medium' ? 'Risco' : 'Indisponível'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
