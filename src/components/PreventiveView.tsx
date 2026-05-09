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
  Settings
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { getMaintenanceStatus, getPreventiveChecklist, getNextMaintenanceType } from '../lib/maintenanceLogic';

export function PreventiveView() {
  const { profile, setQuotaExceeded } = useAuth();
  const { forklifts: globalForklifts, activeStops, refreshGlobalData } = useData();
  const [forklifts, setForklifts] = useState<Forklift[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<ForkliftType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<string | 'all'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Execution Modal States
  const [selectedForklift, setSelectedForklift] = useState<Forklift | null>(null);
  const [executionModalOpen, setExecutionModalOpen] = useState(false);
  const [currentHorometer, setCurrentHorometer] = useState<string>('');
  const [observations, setObservations] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  const processForklifts = (allForklifts: Forklift[]) => {
    // Identify machines with active maintenance occurrences
    const machineStatusMap = new Map<string, ForkliftStatus>();
    activeStops.forEach(stop => {
      const f = allForklifts.find(fork => fork.id === stop.forkliftId);
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

    // Consolidação por Número de Série para evitar duplicatas físicas
    const fleetMap = new Map<string, Forklift>();
    
    // Sort by createdAt descending
    const sorted = [...allForklifts].sort((a, b) => {
      const dateA = (a as any).createdAt || '';
      const dateB = (b as any).createdAt || '';
      return dateB.localeCompare(dateA);
    });

    sorted.forEach(f => {
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

    setForklifts(Array.from(fleetMap.values()));
  };

  useEffect(() => {
    processForklifts(globalForklifts);
  }, [globalForklifts]);

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

  const stats = useMemo(() => {
    const total = forklifts.length;
    let vencidas = 0;
    let proximas = 0;
    let emDia = 0;
    let desatualizadas = 0;

    forklifts.forEach(f => {
      const status = getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0, f.lastHourMeterUpdate);
      if (status === 'vencida') vencidas++;
      else if (status === 'proxima') proximas++;
      else if (status === 'desatualizado') desatualizadas++;
      else emDia++;
    });

    return { total, vencidas, proximas, emDia, desatualizadas };
  }, [forklifts]);

  const filteredForklifts = useMemo(() => {
    return forklifts.filter(f => {
      const matchesSearch = f.serialNumber.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           f.model.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = filterType === 'all' || f.type === filterType;
      
      const machineStatus = getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0, f.lastHourMeterUpdate);
      const matchesStatus = filterStatus === 'all' || machineStatus === filterStatus;

      return matchesSearch && matchesType && matchesStatus;
    }).sort((a, b) => {
      const statusA = getMaintenanceStatus(a.lastHourMeter || 0, a.nextPreventiveHorometer || 0, a.lastHourMeterUpdate);
      const statusB = getMaintenanceStatus(b.lastHourMeter || 0, b.nextPreventiveHorometer || 0, b.lastHourMeterUpdate);
      
      const priority: Record<string, number> = { vencida: 0, desatualizado: 1, proxima: 2, em_dia: 3 };
      return (priority[statusA] ?? 4) - (priority[statusB] ?? 4);
    });
  }, [forklifts, searchQuery, filterType, filterStatus]);

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
      const nextHoro = currentNext + interval;
      
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

      await addDoc(collection(db, 'preventive_executions'), {
        ...execution,
        createdAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'forklifts', selectedForklift.id), {
        lastPreventiveHorometer: horometerNum,
        nextPreventiveHorometer: nextHoro,
        lastHourMeter: horometerNum,
        lastHourMeterUpdate: serverTimestamp(),
        lastMaintenance: new Date().toISOString(),
        status: 'available'
      });

      setExecutionModalOpen(false);
      setSelectedForklift(null);
      setObservations('');
    } catch (error) {
      console.error('Error saving maintenance:', error);
      alert('Erro ao salvar manutenção. Tente novamente.');
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
    <div className="min-h-full bg-slate-50 flex flex-col">
      {/* HEADER SECTION */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <button
                      onClick={fetchData}
                      disabled={isRefreshing}
                      className={cn(
                        "p-3 rounded-2xl border border-slate-200 transition-all active:scale-95 group",
                        isRefreshing ? "bg-slate-50 text-slate-300" : "bg-white text-slate-600 hover:bg-slate-50 hover:border-blue-200 shadow-sm"
                      )}
                      title="Atualizar Dados"
                    >
                      <Activity className={cn("w-5 h-5 transition-transform duration-700", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
                    </button>
                    <div>
                      <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Plano Preventivo</h1>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] leading-none mt-1">Gestão de Máquinas e Equipamentos</p>
                    </div>
                  </div>
                </div>

            {/* DASHBOARD CARDS */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total', value: stats.total, icon: Activity, color: 'text-slate-600', bg: 'bg-slate-50' },
                { label: 'Vencidas', value: stats.vencidas, icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50', active: stats.vencidas > 0 },
                { label: 'A Vencer', value: stats.proximas, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50' },
                { label: 'Em Dia', value: stats.emDia, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50' }
              ].map((stat, idx) => (
                <div key={idx} className={cn(
                  "px-4 py-3 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center transition-all",
                  stat.bg,
                  stat.active ? "ring-2 ring-red-500/20" : ""
                )}>
                  <div className="flex items-center gap-2 mb-1">
                    <stat.icon className={cn("w-3.5 h-3.5", stat.color)} />
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</span>
                  </div>
                  <span className={cn("text-xl font-black tabular-nums", stat.color)}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* FILTERS & SEARCH */}
      <div className="bg-white border-b border-slate-200 sticky top-16 z-30">
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

      {/* MACHINE LIST */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredForklifts.map((f) => {
            const currentStatus = getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0, f.lastHourMeterUpdate);
            const nextType = getNextMaintenanceType(f.nextPreventiveHorometer || 0);
            
            const prevHoro = (f.nextPreventiveHorometer || 0) - 500;
            const progress = Math.min(100, Math.max(0, ((f.lastHourMeter || 0) - prevHoro) / 500 * 100));
            
            const remainingHours = (f.nextPreventiveHorometer || 0) - (f.lastHourMeter || 0);

            const statusConfig = {
              vencida: { label: 'Vencida', class: 'bg-red-50 text-red-600 border-red-100', icon: AlertCircle },
              proxima: { label: 'A Vencer', class: 'bg-amber-50 text-amber-600 border-amber-100', icon: Clock },
              desatualizado: { label: 'Desatualizado', class: 'bg-purple-50 text-purple-600 border-purple-100', icon: AlertTriangle },
              em_dia: { label: 'No Prazo', class: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: CheckCircle2 }
            };

            const config = statusConfig[currentStatus as keyof typeof statusConfig] || statusConfig.em_dia;

            return (
              <motion.div 
                layout
                key={f.id}
                className={cn(
                  "bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col group transition-all hover:shadow-xl hover:shadow-slate-200/50 hover:border-slate-300",
                  currentStatus === 'vencida' && "border-red-200 ring-2 ring-red-500/5"
                )}
              >
                <div className="p-6">
                  {/* MACHINE HEADER */}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-xs shadow-lg shadow-slate-200 uppercase transition-transform group-hover:scale-105">
                        {f.model.slice(0, 4)}
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight leading-none">{f.model} - {f.serialNumber.slice(-2)}</h3>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1.5">{f.serialNumber}</p>
                      </div>
                    </div>
                    <div className={cn(
                      "px-4 py-2 rounded-xl border flex items-center gap-2 shadow-sm transition-transform group-hover:scale-105", 
                      config.class
                    )}>
                      <config.icon className="w-4 h-4" />
                      <span className="text-[9px] font-black uppercase tracking-[0.15em] leading-none">{config.label}</span>
                    </div>
                  </div>

                  {/* INFO GRID */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 transition-colors group-hover:bg-white group-hover:border-slate-200">
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Horímetro Atual</p>
                      <p className="text-xl font-black text-slate-900 tabular-nums">{(f.lastHourMeter || 0)}h</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 transition-colors group-hover:bg-white group-hover:border-slate-200 flex flex-col justify-between">
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 font-black">Próxima ({nextType})</p>
                      <div className="flex items-center justify-between">
                        <p className="text-xl font-black text-blue-600 tabular-nums">{(f.nextPreventiveHorometer || 0)}h</p>
                        <button 
                          onClick={() => {
                            const newValue = prompt("Definir próxima preventiva (horas):", String(f.nextPreventiveHorometer || 0));
                            if (newValue !== null && !isNaN(parseFloat(newValue))) {
                              updateDoc(doc(db, 'forklifts', f.id), { nextPreventiveHorometer: parseFloat(newValue) });
                            }
                          }}
                          className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          title="Ajustar próxima manutenção"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* REINFORCED REMAINING HOURS */}
                  <div className={cn(
                    "mb-6 p-4 rounded-2xl border border-dashed flex items-center justify-between",
                    remainingHours <= 0 ? "bg-red-50 border-red-200 text-red-700" : 
                    remainingHours <= 50 ? "bg-amber-50 border-amber-200 text-amber-700" : 
                    "bg-slate-50 border-slate-200 text-slate-600"
                  )}>
                    <div className="flex items-center gap-2">
                       <Clock className="w-4 h-4 opacity-50" />
                       <span className="text-[10px] font-black uppercase tracking-widest">Saldo de Horas</span>
                    </div>
                    <span className="text-sm font-black tabular-nums">
                        {remainingHours <= 0 ? (
                          `VENCIDA HÁ ${Math.round(Math.abs(remainingHours))}h`
                        ) : (
                          `${Math.round(remainingHours)}h restantes`
                        )}
                    </span>
                  </div>

                  {/* MACHINE TYPE & FOOTER INFO */}
                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-dashed border-slate-100">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Filter className="w-3 h-3 text-slate-300" />
                      {f.type || 'Empilhadeira'}
                    </span>
                    {f.lastHourMeterUpdate && (
                      <span className="text-[8px] font-black text-slate-300 uppercase tracking-tighter">
                        Att: {new Date(f.lastHourMeterUpdate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* ACTION BUTTON */}
                <div className="p-4 bg-slate-50 border-t border-slate-100">
                  <button 
                    onClick={() => {
                      setSelectedForklift(f);
                      setExecutionModalOpen(true);
                    }}
                    className="w-full bg-slate-900 text-white rounded-xl py-3.5 text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 hover:bg-emerald-600 transition-all shadow-md active:scale-95"
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    Executar Preventiva
                  </button>
                </div>
              </motion.div>
            );
          })}
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
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipo Identificado</label>
                    <div className="w-full px-5 py-4 bg-slate-900 text-emerald-400 rounded-xl font-black text-center text-sm ring-4 ring-emerald-500/20">
                      REVISÃO DE {getNextMaintenanceType(selectedForklift.nextPreventiveHorometer || 0).toUpperCase()}
                    </div>
                  </div>
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
                      <p className="text-xs font-black uppercase tracking-tight">{profile.displayName}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Data</p>
                    <p className="text-xs font-black tabular-nums">{new Date().toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-slate-100 bg-slate-50 flex gap-4">
                <button onClick={() => setExecutionModalOpen(false)} className="flex-1 py-4 text-xs font-black text-slate-400 uppercase tracking-widest hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
                <button 
                  onClick={handleExecuteMaintenance}
                  disabled={isSubmitting}
                  className="flex-[2] bg-slate-900 text-white rounded-xl py-4 text-xs font-black uppercase tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-xl active:scale-95 disabled:opacity-50"
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
