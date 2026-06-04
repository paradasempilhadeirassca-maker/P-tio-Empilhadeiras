import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  getDocs, 
  doc, 
  updateDoc, 
  addDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { Forklift, ForkliftType, ChecklistItem, PreventiveMaintenanceExecution, ForkliftStatus } from '../types';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { 
  ClipboardList, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Search, 
  Filter, 
  MoreVertical,
  ChevronRight,
  User,
  MessageCircle,
  Camera,
  Check,
  X,
  Wrench,
  Activity,
  ArrowRight,
  AlertTriangle,
  Settings,
  ShieldCheck,
  Truck
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { getMaintenanceStatus, getPreventiveChecklist, getNextMaintenanceType } from '../lib/maintenanceLogic';

export function PreventiveView() {
  const { profile, setQuotaExceeded } = useAuth();
  const { uniqueForklifts, activeStops, refreshGlobalData } = useData();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<ForkliftType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<string | 'all'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [responsibilityTab, setResponsibilityTab] = useState<'mechanic' | 'non_mechanic'>('mechanic');
  
  // Execution Modal States
  const [selectedForklift, setSelectedForklift] = useState<Forklift | null>(null);
  const [executionModalOpen, setExecutionModalOpen] = useState(false);
  const [currentHorometer, setCurrentHorometer] = useState<string>('');
  const [observations, setObservations] = useState('');
  const [missingPartsInput, setMissingPartsInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  const fetchData = async () => {
    setIsRefreshing(true);
    try {
      await refreshGlobalData();
    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        setQuotaExceeded(true);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Deduplicate duplicate 8640001 entries as requested by user
  const deduplicatedForklifts = useMemo(() => {
    const seenSerials = new Set<string>();
    return uniqueForklifts.filter(f => {
      const serial = (f.serialNumber || '').trim().toLowerCase();
      if (serial === '8640001' || serial.startsWith('8640001')) {
        if (seenSerials.has('8640001')) {
          return false; // Remove / retire second one
        }
        seenSerials.add('8640001');
        return true;
      }
      return true;
    });
  }, [uniqueForklifts]);

  // Compute counts for tab labels
  const tabCounts = useMemo(() => {
    const mechanic = deduplicatedForklifts.filter(f => f.isMechanicResponsibility !== false).length;
    const nonMechanic = deduplicatedForklifts.filter(f => f.isMechanicResponsibility === false).length;
    return { mechanic, nonMechanic };
  }, [deduplicatedForklifts]);

  const stats = useMemo(() => {
    const total = deduplicatedForklifts.length;
    let vencidas = 0;
    let proximas = 0;
    let emDia = 0;
    let desatualizadas = 0;

    deduplicatedForklifts.forEach(f => {
      const status = getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0, f.lastHourMeterUpdate);
      if (status === 'vencida') vencidas++;
      else if (status === 'proxima') proximas++;
      else if (status === 'desatualizado') desatualizadas++;
      else emDia++;
    });

    return { total, vencidas, proximas, emDia, desatualizadas };
  }, [deduplicatedForklifts]);

  const filteredForklifts = useMemo(() => {
    return deduplicatedForklifts.filter(f => {
      // Responsibility filter
      const matchesResponsibility = responsibilityTab === 'mechanic' 
        ? f.isMechanicResponsibility !== false 
        : f.isMechanicResponsibility === false;

      const matchesSearch = f.serialNumber.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           f.model.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = filterType === 'all' || f.type === filterType;
      
      const machineStatus = getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0, f.lastHourMeterUpdate);
      const matchesStatus = filterStatus === 'all' || machineStatus === filterStatus;

      return matchesResponsibility && matchesSearch && matchesType && matchesStatus;
    }).sort((a, b) => {
      const statusA = getMaintenanceStatus(a.lastHourMeter || 0, a.nextPreventiveHorometer || 0, a.lastHourMeterUpdate);
      const statusB = getMaintenanceStatus(b.lastHourMeter || 0, b.nextPreventiveHorometer || 0, b.lastHourMeterUpdate);
      
      const priority: Record<string, number> = { vencida: 0, desatualizado: 1, proxima: 2, em_dia: 3 };
      return (priority[statusA] ?? 4) - (priority[statusB] ?? 4);
    });
  }, [deduplicatedForklifts, responsibilityTab, searchQuery, filterType, filterStatus]);

  useEffect(() => {
    if (selectedForklift) {
      setChecklist(getPreventiveChecklist(selectedForklift.type || 'empilhadeira', selectedForklift.nextPreventiveHorometer || 0));
      setCurrentHorometer(selectedForklift.lastHourMeter?.toString() || '');
    }
  }, [selectedForklift]);

  const handleExecuteMaintenance = async () => {
    if (!selectedForklift || !profile) return;
    
    const horometerNum = parseFloat(currentHorometer);
    if (isNaN(horometerNum)) {
      alert('Por favor, informe um horímetro válido.');
      return;
    }

    const unfinishedItems = checklist.filter(i => i.isMandatory && !i.isConform);
    if (unfinishedItems.length > 0) {
      alert('Por favor, complete todos os itens obrigatórios do checklist.');
      return;
    }

    setIsSubmitting(true);
    try {
      const currentNext = selectedForklift.nextPreventiveHorometer || 0;
      const maintenanceType = getNextMaintenanceType(currentNext);
      const interval = 500; 
      // Auto calculate next preventive hours based on actual entered hour meter
      const nextHoro = horometerNum + interval;
      
      const execution: Partial<PreventiveMaintenanceExecution> = {
        forkliftId: selectedForklift.id,
        forkliftModel: selectedForklift.model,
        forkliftSerialNumber: selectedForklift.serialNumber,
        type: selectedForklift.type || 'empilhadeira',
        preventiveType: maintenanceType === '1000h' ? 1000 : 500,
        horometerAtExecution: horometerNum,
        date: new Date().toISOString(),
        mechanicId: profile.uid,
        mechanicName: profile.displayName,
        checklist,
        observations,
        nextPreventiveHorometer: nextHoro
      };

      const addPromise = addDoc(collection(db, 'preventive_executions'), {
        ...execution,
        createdAt: serverTimestamp()
      });

      const updatePromise = updateDoc(doc(db, 'forklifts', selectedForklift.id), {
        lastPreventiveHorometer: horometerNum,
        nextPreventiveHorometer: nextHoro,
        lastHourMeter: horometerNum,
        lastHourMeterUpdate: serverTimestamp(),
        lastMaintenance: new Date().toISOString(),
        status: 'available'
      });

      const result = await Promise.race([
        Promise.all([addPromise, updatePromise]),
        new Promise(resolve => setTimeout(() => resolve('offline_timeout'), 2500))
      ]);

      if (result === 'offline_timeout') {
        alert('Registro de revisão salvo localmente! Será sincronizado ao restaurar a conexão.');
      }

      setExecutionModalOpen(false);
      setSelectedForklift(null);
      setObservations('');
      setMissingPartsInput('');
      await refreshGlobalData();
    } catch (error) {
      console.error('Error saving maintenance:', error);
      alert('Erro ao salvar manutenção. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAwaitingParts = async () => {
    if (!selectedForklift || !profile) return;
    
    if (!missingPartsInput.trim()) {
      alert('Por favor, informe pendência de peças para salvar como "Aguardando Peças".');
      return;
    }

    setIsSubmitting(true);
    try {
      const partsArray = missingPartsInput.split(',').map(p => p.trim()).filter(Boolean);
      
      const occurrenceData = {
        forkliftId: selectedForklift.id,
        type: 'preventive',
        category: 'Falta de peça',
        status: 'awaiting_parts',
        operatorId: profile.uid,
        operatorName: profile.displayName || 'Mecânico',
        mechanicId: profile.uid,
        stopTime: new Date().toISOString(),
        waitingPartsStartTime: new Date().toISOString(),
        pendingPartsList: partsArray,
        description: `Revisão preventiva interrompida por falta de peças: ${missingPartsInput}. Obs: ${observations || 'Sem observações'}`,
        severity: 'medium',
        parts: []
      };

      const addPromise = addDoc(collection(db, 'maintenance'), {
        ...occurrenceData,
        createdAt: serverTimestamp()
      });

      const updatePromise = updateDoc(doc(db, 'forklifts', selectedForklift.id), {
        status: 'at_risk',
        lastMaintenance: new Date().toISOString()
      });

      const result = await Promise.race([
        Promise.all([addPromise, updatePromise]),
        new Promise(resolve => setTimeout(() => resolve('offline_timeout'), 2500))
      ]);

      if (result === 'offline_timeout') {
        alert('Registro salvo localmente! Será sincronizado ao restaurar a conexão.');
      } else {
        alert('Revisão preventiva pausada e salva como "Aguardando peças" com sucesso!');
      }

      setExecutionModalOpen(false);
      setSelectedForklift(null);
      setObservations('');
      setMissingPartsInput('');
      await refreshGlobalData();
    } catch (error) {
      console.error('Error saving preventive awaiting parts:', error);
      alert('Erro ao registrar peças faltantes. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleChecklistItem = (id: string) => {
    setChecklist(prev => prev.map(item => 
      item.id === id ? { ...item, isConform: !item.isConform } : item
    ));
  };

  return (
    <div className="min-h-full bg-slate-50/50 flex flex-col">
      {/* HEADER SECTION */}
      <header className="bg-white border-b border-slate-200/60 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="space-y-1">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-slate-900 text-white rounded-2xl shadow-lg">
                  <Wrench className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Plano Preventivo</h1>
                  <p className="text-slate-500 font-medium">Gestão técnica de periodicidade e revisões</p>
                </div>
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div className="flex items-center gap-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={fetchData}
                disabled={isRefreshing}
                className={cn(
                  "p-4 rounded-2xl border border-slate-200 transition-all flex items-center gap-3",
                  isRefreshing ? "bg-slate-50 text-slate-300" : "bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/50 shadow-sm"
                )}
              >
                <Activity className={cn("w-5 h-5", isRefreshing && "animate-spin")} />
                <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Sincronizar Dados</span>
              </motion.button>
            </div>
          </div>
          
          {/* ANALYTICAL KPI's */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            {[
              { label: 'Frota Total', value: stats.total, icon: Activity, color: 'blue' },
              { label: 'Manut. Vencidas', value: stats.vencidas, icon: AlertCircle, color: 'red', alert: stats.vencidas > 0 },
              { label: 'Proximas 50h', value: stats.proximas, icon: Clock, color: 'amber' },
              { label: 'Saúde OK', value: stats.emDia, icon: ShieldCheck, color: 'emerald' }
            ].map((stat, idx) => (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                key={stat.label}
                className={cn(
                  "p-5 rounded-[2rem] border shadow-sm flex flex-col justify-between transition-all",
                  stat.color === 'blue' ? "bg-blue-50/30 border-blue-100" :
                  stat.color === 'red' ? "bg-red-50 border-red-200" :
                  stat.color === 'amber' ? "bg-amber-50 border-amber-200" :
                  "bg-emerald-50 border-emerald-200"
                )}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shadow-sm",
                    stat.color === 'blue' ? "bg-blue-600 text-white" :
                    stat.color === 'red' ? "bg-red-600 text-white" :
                    stat.color === 'amber' ? "bg-amber-600 text-white" :
                    "bg-emerald-600 text-white"
                  )}>
                    <stat.icon className="w-5 h-5" />
                  </div>
                  {stat.alert && (
                    <motion.div 
                      animate={{ scale: [1, 1.2, 1] }} 
                      transition={{ repeat: Infinity, duration: 2 }}
                      className="w-2 h-2 bg-red-600 rounded-full" 
                    />
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</p>
                  <h3 className="text-2xl font-black text-slate-900 mt-1">{stat.value}</h3>
                </div>
              </motion.div>
            ))}
          </div>

          {/* TAB SELECTOR: RESPONSABILIDADE DO MECÂNICO */}
          <div className="flex gap-4 mt-8 border-b border-slate-100 pb-0">
            <button
              onClick={() => setResponsibilityTab('mechanic')}
              className={cn(
                "pb-4 px-2 text-xs font-black uppercase tracking-wider border-b-4 transition-all relative",
                responsibilityTab === 'mechanic' ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"
              )}
            >
              Responsabilidade do Mecânico
              <span className="ml-2 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[9px] font-black">
                {tabCounts.mechanic}
              </span>
            </button>
            <button
              onClick={() => setResponsibilityTab('non_mechanic')}
              className={cn(
                "pb-4 px-2 text-xs font-black uppercase tracking-wider border-b-4 transition-all relative",
                responsibilityTab === 'non_mechanic' ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"
              )}
            >
              Sem Responsabilidade do Mecânico
              <span className="ml-2 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[9px] font-black animate-pulse">
                {tabCounts.nonMechanic}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* SEARCH AND FILTERS */}
      <div className="bg-white border-b border-slate-200 sticky top-[188px] md:top-[220px] lg:top-[248px] z-30 shadow-sm py-4">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
            <input 
              type="text" 
              placeholder="BUSCAR EQUIPAMENTO..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-slate-900/10 focus:bg-white transition-all text-xs font-black uppercase tracking-widest text-slate-700"
            />
          </div>
          <div className="flex gap-2">
            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none text-[10px] font-black uppercase tracking-widest text-slate-600 focus:ring-2 focus:ring-slate-900/10"
            >
              <option value="all">TODOS OS TIPOS</option>
              <option value="empilhadeira">EMPILHADEIRA</option>
              <option value="manipulador">MANIPULADOR</option>
            </select>
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none text-[10px] font-black uppercase tracking-widest text-slate-600 focus:ring-2 focus:ring-slate-900/10"
            >
              <option value="all">TODOS STATUS</option>
              <option value="vencida">VENCIDAS 🔴</option>
              <option value="proxima">A VENCER 🟡</option>
              <option value="desatualizado">DESATUALIZADO ⚠️</option>
              <option value="em_dia">EM DIA 🟢</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-8 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <AnimatePresence mode="popLayout">
            {filteredForklifts.map((f, idx) => {
              const currentStatus = getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0, f.lastHourMeterUpdate);
              const nextType = getNextMaintenanceType(f.nextPreventiveHorometer || 0);
              const remainingHours = (f.nextPreventiveHorometer || 0) - (f.lastHourMeter || 0);
              const prevBase = (f.nextPreventiveHorometer || 0) - 500;
              const progress = Math.min(100, Math.max(0, ((f.lastHourMeter || 0) - prevBase) / 500 * 100));

              const statusConfig: Record<string, any> = {
                vencida: { label: 'Vencida', color: 'bg-red-500', icon: AlertCircle, bg: 'bg-red-50/50', border: 'border-red-200' },
                proxima: { label: 'A Vencer', color: 'bg-amber-500', icon: Clock, bg: 'bg-amber-50/50', border: 'border-amber-200' },
                desatualizado: { label: 'Ociosa', color: 'bg-slate-400', icon: Clock, bg: 'bg-slate-50', border: 'border-slate-200' },
                em_dia: { label: 'Em Dia', color: 'bg-emerald-500', icon: CheckCircle2, bg: 'bg-emerald-50/50', border: 'border-emerald-200' }
              };

              const config = statusConfig[currentStatus] || statusConfig.em_dia;

              return (
                <motion.div 
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.05 }}
                  key={f.id}
                  className={cn(
                    "bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col group transition-all hover:shadow-2xl hover:shadow-slate-200/50",
                    config.border
                  )}
                >
                  <div className="p-8 pb-4">
                    {/* MACHINE HEADER */}
                    <div className="flex items-start justify-between mb-8">
                      <div className="flex items-center gap-5">
                        <div className="w-16 h-16 bg-slate-900 text-white rounded-[1.5rem] flex items-center justify-center flex-col shadow-xl shadow-slate-200 transition-transform group-hover:scale-105">
                          <Truck className="w-6 h-6 mb-1" />
                          <span className="text-[10px] font-black tracking-tight">{f.model.slice(0, 4)}</span>
                        </div>
                        <div>
                          <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight leading-none mb-2">{f.model}</h3>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-black tracking-widest">{f.serialNumber}</span>
                          </div>
                        </div>
                      </div>
                      <div className={cn(
                        "w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg",
                        config.color,
                        "text-white"
                      )}>
                        <config.icon className="w-5 h-5" />
                      </div>
                    </div>

                    {/* MAINTENANCE TIMELINE */}
                    <div className="space-y-4 mb-8">
                      <div className="flex justify-between items-end">
                        <div className="space-y-1">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Saldo do Plano</p>
                          <h4 className={cn(
                            "text-2xl font-black tabular-nums tracking-tight",
                            remainingHours <= 0 ? "text-red-600" : remainingHours <= 50 ? "text-amber-600" : "text-slate-900"
                          )}>
                            {remainingHours <= 0 ? (
                              `VENCIDA ${Math.round(Math.abs(remainingHours))}h`
                            ) : (
                              `${Math.round(remainingHours)}h RESTANTES`
                            )}
                          </h4>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Próxima</p>
                          <p className="text-sm font-black text-blue-600 tabular-nums">{f.nextPreventiveHorometer}h</p>
                        </div>
                      </div>

                      <div className="h-4 w-full bg-slate-100 rounded-full p-1 shadow-inner relative overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          className={cn(
                            "h-full rounded-full shadow-lg transition-all",
                            currentStatus === 'vencida' ? "bg-red-500" : currentStatus === 'proxima' ? "bg-amber-500" : "bg-blue-500"
                          )}
                        />
                      </div>
                      
                      <div className="flex justify-between items-center text-[9px] font-black text-slate-400 uppercase tracking-widest">
                        <span>{prevBase}h</span>
                        <div className="flex items-center gap-2 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
                          <Activity className="w-3 h-3" />
                          <span>Atual: {f.lastHourMeter}h</span>
                        </div>
                        <span>{f.nextPreventiveHorometer}h</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Status de Frota</span>
                        <div className="flex items-center gap-1.5 pt-1">
                          <div className={cn("w-2 h-2 rounded-full", f.status === 'available' ? 'bg-emerald-500 bubble-animate' : 'bg-red-500')} />
                          <span className="text-[10px] font-black text-slate-700 uppercase tracking-tight">
                            {f.status === 'available' ? 'Operacional' : 'Equip. Parado'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Revisão Tipo</span>
                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-tight py-1 px-3 bg-blue-50 rounded-full border border-blue-100">
                          {nextType.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-8 pt-4">
                    <motion.button 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        setSelectedForklift(f);
                        setExecutionModalOpen(true);
                      }}
                      className={cn(
                        "w-full py-5 rounded-[1.5rem] flex items-center justify-center gap-3 transition-all transform text-xs font-black uppercase tracking-[0.2em] shadow-xl shadow-slate-200 group-hover:shadow-blue-200/50",
                        currentStatus === 'vencida' ? "bg-red-600 text-white hover:bg-red-700" : "bg-slate-900 text-white hover:bg-blue-600"
                      )}
                    >
                      <Wrench className="w-4 h-4" />
                      ABRIR REVISÃO
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* EXECUTION MODAL */}
      <AnimatePresence>
        {executionModalOpen && selectedForklift && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-slate-900 text-white rounded-2xl flex items-center justify-center font-black text-lg">
                    {selectedForklift.model.slice(0, 4)}
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900 uppercase leading-none">{selectedForklift.model}</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">{selectedForklift.serialNumber}</p>
                  </div>
                </div>
                <button onClick={() => setExecutionModalOpen(false)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Horímetro Atual</label>
                    <input 
                      type="number"
                      value={currentHorometer}
                      onChange={(e) => setCurrentHorometer(e.target.value)}
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10 font-black text-lg tabular-nums"
                    />
                    {currentHorometer && !isNaN(parseFloat(currentHorometer)) && (
                      <p className="text-[10px] font-extrabold text-emerald-600 mt-1 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Próxima preventiva automática: {parseFloat(currentHorometer) + 500}h
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipo Identificado</label>
                    <div className="w-full px-5 py-4 bg-slate-900 text-emerald-400 rounded-xl font-black text-center text-sm ring-4 ring-emerald-500/20">
                      REVISÃO DE {getNextMaintenanceType(selectedForklift.nextPreventiveHorometer || 0).toUpperCase()}
                    </div>
                  </div>
                </div>

                <div className="space-y-2 bg-amber-50/50 p-5 rounded-[1.5rem] border border-amber-200/60 shadow-sm">
                  <label className="text-[10px] font-black text-amber-800 uppercase tracking-widest ml-1 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 animate-pulse" />
                    Falta Alguma Peça? (Apenas se for pausar por Falta de Peça)
                  </label>
                  <input 
                    type="text"
                    value={missingPartsInput}
                    onChange={(e) => setMissingPartsInput(e.target.value)}
                    placeholder="Descreva as peças necessárias (Ex: Filtro de óleo, Correia)..."
                    className="w-full px-5 py-4 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500/20 font-bold text-xs text-slate-700"
                  />
                  <p className="text-[9px] text-amber-600 font-bold ml-1">Ao preencher este campo, você poderá usar o botão "Aguardando peças" abaixo.</p>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-[0.1em] border-l-4 border-emerald-500 pl-3">Checklist de Itens ({getNextMaintenanceType(selectedForklift.nextPreventiveHorometer || 0)})</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {checklist.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => toggleChecklistItem(item.id)}
                        className={cn(
                          "p-4 rounded-xl border text-left flex items-center gap-3 transition-all group",
                          item.isConform ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200 hover:border-slate-300"
                        )}
                      >
                        <div className={cn(
                          "w-5 h-5 rounded-md flex items-center justify-center transition-all",
                          item.isConform ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-300 group-hover:bg-slate-200"
                        )}>
                          {item.isConform && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <span className="text-[10px] font-black uppercase text-slate-600 tracking-tight">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Observações do Mecânico</label>
                  <textarea 
                    value={observations}
                    onChange={(e) => setObservations(e.target.value)}
                    placeholder="Descreva detalhes..."
                    rows={3}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10 placeholder:text-slate-300"
                  />
                </div>

                <div className="p-6 bg-slate-900 rounded-2xl text-white flex justify-between items-center shadow-lg shadow-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center"><User className="w-5 h-5 text-emerald-400" /></div>
                    <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Responsável</p>
                      <p className="text-xs font-black uppercase tracking-tight">{profile?.displayName || 'Mecânico'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Data</p>
                    <p className="text-xs font-black tabular-nums">{new Date().toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row gap-3">
                <button 
                  onClick={() => setExecutionModalOpen(false)} 
                  className="px-4 py-4 text-xs font-black text-slate-400 uppercase tracking-widest hover:bg-slate-200 rounded-xl transition-colors min-w-[100px]"
                >
                  Cancelar
                </button>
                
                <button
                  type="button"
                  onClick={handleAwaitingParts}
                  disabled={isSubmitting || !missingPartsInput.trim()}
                  className={cn(
                    "flex-1 py-4 text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 shadow-md",
                    missingPartsInput.trim() 
                      ? "bg-amber-500 hover:bg-amber-600 text-white" 
                      : "bg-slate-100 text-slate-400 cursor-not-allowed"
                  )}
                  title={!missingPartsInput.trim() ? "Preencha as peças pendentes para habilitar" : ""}
                >
                  <AlertTriangle className="w-4 h-4" />
                  Aguardando Peças
                </button>

                <button 
                  onClick={handleExecuteMaintenance}
                  disabled={isSubmitting}
                  className="flex-[1.5] bg-slate-900 text-white rounded-xl py-4 text-xs font-black uppercase tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-xl active:scale-95 disabled:opacity-50"
                >
                  {isSubmitting ? <Activity className="w-4 h-4 animate-spin" /> : <>Concluir Preventiva <ArrowRight className="w-3 h-3" /></>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
