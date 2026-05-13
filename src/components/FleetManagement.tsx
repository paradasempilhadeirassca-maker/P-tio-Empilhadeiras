import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  where,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { useToast } from './ToastContext';
import { Forklift, UserProfile, ForkliftStatus } from '../types';
import { requiresPreventiveMaintenance, formatHourMeter } from '../lib/operationalLogic';
import { getMaintenanceStatus } from '../lib/maintenanceLogic';
import { 
  Truck, 
  Plus, 
  Search, 
  UserPlus, 
  Trash2, 
  X, 
  Check, 
  AlertTriangle,
  Settings,
  Loader2,
  Wrench,
  Clock,
  Activity,
  History,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';

export function FleetManagement({ onReportOccurrence }: { onReportOccurrence?: (forklift: Forklift) => void }) {
  const { setQuotaExceeded } = useAuth();
  const { showToast } = useToast();
  const { forklifts, uniqueForklifts, operators, activeStops, refreshGlobalData, loading: dataLoading } = useData();
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state for new machine
  const [formData, setFormData] = useState({
    model: '',
    serialNumber: '',
    type: 'empilhadeira',
    initialHourMeter: '',
    nextPreventiveHorometer: '500',
    assignedOperatorIdShift1: '',
    assignedOperatorIdShift2: ''
  });

  const [editingHourMeter, setEditingHourMeter] = useState<{ id: string, value: string, field: 'last' | 'next' } | null>(null);

  useEffect(() => {
    refreshGlobalData();
  }, []);

  const handleAddMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.model || !formData.serialNumber) return;

    // Check for duplicates by serial number
    const isDuplicate = forklifts.some(f => f.serialNumber.trim().toLowerCase() === formData.serialNumber.trim().toLowerCase());
    if (isDuplicate) {
      showToast('Esta máquina já está cadastrada (Número de Série duplicado).', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const op1 = operators.find(o => o.uid === formData.assignedOperatorIdShift1);
      const op2 = operators.find(o => o.uid === formData.assignedOperatorIdShift2);
      
      await addDoc(collection(db, 'forklifts'), {
        model: formData.model.trim(),
        serialNumber: formData.serialNumber.trim(),
        type: formData.type,
        status: 'available',
        lastHourMeter: Number(formData.initialHourMeter) || 0,
        nextPreventiveHorometer: Number(formData.nextPreventiveHorometer) || (Number(formData.initialHourMeter) + 500),
        assignedOperatorIdShift1: formData.assignedOperatorIdShift1 || null,
        assignedOperatorNameShift1: op1?.displayName || null,
        assignedOperatorIdShift2: formData.assignedOperatorIdShift2 || null,
        assignedOperatorNameShift2: op2?.displayName || null,
        lastHourMeterUpdate: new Date().toISOString(),
        createdAt: new Date().toISOString()
      });

      await refreshGlobalData(true);
      showToast('Máquina cadastrada com sucesso!');
      setIsModalOpen(false);
      setFormData({ 
        model: '', 
        serialNumber: '', 
        type: 'empilhadeira',
        initialHourMeter: '',
        nextPreventiveHorometer: '500',
        assignedOperatorIdShift1: '', 
        assignedOperatorIdShift2: '' 
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'forklifts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignOperator = async (forkliftId: string, operatorId: string, shift: '1' | '2') => {
    const operator = operators.find(o => o.uid === operatorId);
    
    try {
      const updateData: any = {};
      if (shift === '1') {
        updateData.assignedOperatorIdShift1 = operatorId || null;
        updateData.assignedOperatorNameShift1 = operator?.displayName || null;
      } else {
        updateData.assignedOperatorIdShift2 = operatorId || null;
        updateData.assignedOperatorNameShift2 = operator?.displayName || null;
      }
      
      await updateDoc(doc(db, 'forklifts', forkliftId), updateData);
      await refreshGlobalData(true);
      showToast(`Operador do Turno ${shift} atribuído!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'forklifts');
    }
  };

  const handleDeleteMachine = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta máquina?')) return;

    try {
      await deleteDoc(doc(db, 'forklifts', id));
      await refreshGlobalData(true);
      showToast('Máquina excluída com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'forklifts');
    }
  };

  const handleUpdateHourMeter = async (id: string) => {
    if (!editingHourMeter || editingHourMeter.id !== id) return;
    
    const newValue = Number(editingHourMeter.value);
    if (isNaN(newValue)) {
      showToast('O valor deve ser um número.', 'error');
      return;
    }

    try {
      const updateField = editingHourMeter.field === 'last' ? 'lastHourMeter' : 'nextPreventiveHorometer';
      const updateData: any = {
        [updateField]: newValue
      };
      if (editingHourMeter.field === 'last') {
        updateData.lastHourMeterUpdate = new Date().toISOString();
      }
      await updateDoc(doc(db, 'forklifts', id), updateData);
      await refreshGlobalData(true);
      showToast('Horímetro atualizado com sucesso!');
      setEditingHourMeter(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'forklifts');
    }
  };

  const uniqueOperators = useMemo(() => {
    const idMap = new Map<string, UserProfile>();
    operators.forEach(o => {
      if (!idMap.has(o.uid)) {
        idMap.set(o.uid, o);
      }
    });
    return Array.from(idMap.values()).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }, [operators]);

  const filteredForklifts = uniqueForklifts.filter(f => 
    f.model.toLowerCase().includes(searchTerm.toLowerCase()) || 
    f.serialNumber.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));

  const stats = useMemo(() => {
    const total = uniqueForklifts.length;
    const operational = uniqueForklifts.filter(f => f.status === 'available' || f.status === 'at_risk').length;
    const inMaintenance = uniqueForklifts.filter(f => f.status === 'maintenance' || f.status === 'stopped').length;
    const preventiveOverdue = uniqueForklifts.filter(f => getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0) === 'vencida').length;
    
    // Calculate global health score
    const healthScores = uniqueForklifts.map(f => {
      const remaining = Math.max(0, (f.nextPreventiveHorometer || 0) - (f.lastHourMeter || 0));
      const preventiveBonus = remaining > 100 ? 20 : (remaining > 50 ? 10 : 0);
      const statusPenalty = f.status === 'available' ? 80 : (f.status === 'at_risk' ? 40 : 10);
      return Math.min(100, preventiveBonus + statusPenalty);
    });
    
    const avgHealth = healthScores.length > 0 ? (healthScores.reduce((a, b) => a + b, 0) / healthScores.length) : 0;

    return { total, operational, maintenance: inMaintenance, preventiveOverdue, avgHealth: Math.round(avgHealth) };
  }, [uniqueForklifts]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Gestão de Frota</h1>
          <p className="text-slate-500 font-medium whitespace-nowrap">Ativos operacionais, saúde da frota e produtividade</p>
        </div>
        
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="hidden lg:flex items-center gap-3 px-4 py-2 bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Health Score Geral</p>
              <p className={cn(
                "text-sm font-black",
                stats.avgHealth > 80 ? "text-emerald-600" : stats.avgHealth > 50 ? "text-amber-600" : "text-red-600"
              )}>{stats.avgHealth}%</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center relative border border-slate-100">
               <svg className="w-10 h-10 -rotate-90">
                 <circle cx="20" cy="20" r="16" fill="none" stroke="#f1f5f9" strokeWidth="4" />
                 <circle 
                   cx="20" cy="20" r="16" fill="none" 
                   stroke={stats.avgHealth > 80 ? "#10b981" : stats.avgHealth > 50 ? "#f59e0b" : "#ef4444"} 
                   strokeWidth="4" 
                   strokeDasharray={`${(stats.avgHealth / 100) * 100.5} 100.5`}
                   strokeLinecap="round"
                 />
               </svg>
               <Activity className={cn("w-4 h-4 absolute inset-0 m-auto", stats.avgHealth > 80 ? "text-emerald-600" : stats.avgHealth > 50 ? "text-amber-600" : "text-red-600")} />
            </div>
          </div>
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsModalOpen(true)}
            className="flex-1 md:flex-none bg-slate-900 text-white px-6 py-3 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
          >
            <Plus className="w-5 h-5" />
            CADASTRAR ATIVO
          </motion.button>
        </div>
      </header>

      {/* Analytics Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Ativos Cadastrados', value: stats.total, icon: Truck, color: 'blue', sub: 'Máquinas em estoque' },
          { label: 'Disponibilidade', value: `${Math.round((stats.operational / (stats.total || 1)) * 100)}%`, icon: Activity, color: 'emerald', sub: `${stats.operational} ativos operando` },
          { label: 'Indisponíveis', value: stats.maintenance, icon: Wrench, color: 'amber', sub: 'Paradas ou manutenção' },
          { label: 'Risco Crítico', value: stats.preventiveOverdue, icon: AlertCircle, color: 'red', sub: 'Prev. vencidas/urgentes' },
        ].map((stat, idx) => (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.1 }}
            key={stat.label}
            className="group bg-white p-5 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-center gap-5 hover:shadow-xl hover:border-slate-200 transition-all cursor-default"
          >
            <div className={cn(
              "w-14 h-14 rounded-[1.25rem] flex items-center justify-center transition-transform group-hover:scale-110",
              stat.color === 'blue' ? "bg-blue-50 text-blue-600" :
              stat.color === 'emerald' ? "bg-emerald-50 text-emerald-600" :
              stat.color === 'amber' ? "bg-amber-50 text-amber-600" :
              "bg-red-50 text-red-600"
            )}>
              <stat.icon className="w-7 h-7" />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
              <h3 className="text-2xl font-black text-slate-900 leading-none mt-1 mb-1">{stat.value}</h3>
              <p className="text-[9px] font-bold text-slate-400 uppercase opacity-70">{stat.sub}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="relative group">
        <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 group-focus-within:text-blue-500 transition-colors" />
        <input 
          type="text" 
          placeholder="Buscar por modelo ou série (ex: Mx25, 91005)..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-[1.5rem] outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm font-medium"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(loading || dataLoading) ? (
          <div className="col-span-full py-12 flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">Sincronizando ativos...</p>
          </div>
        ) : filteredForklifts.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="col-span-full py-20 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100 flex flex-col items-center"
          >
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <Search className="w-10 h-10 text-slate-200" />
            </div>
            <p className="text-slate-400 font-bold">Nenhum ativo encontrado nos registros.</p>
          </motion.div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredForklifts.map((f, idx) => {
              const prevMaintStatus = getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0, f.lastHourMeterUpdate);
              const nextHours = f.nextPreventiveHorometer || 0;
              const lastHours = f.lastHourMeter || 0;
              const remaining = Math.max(0, nextHours - lastHours);
              const progress = Math.min(100, Math.max(0, ((500 - remaining) / 500) * 100));
              
              const isMaintenanceRequired = prevMaintStatus === 'vencida' || prevMaintStatus === 'proxima';

              // Local Health Indicator
              const localHealth = Math.min(100, (f.status === 'available' ? 80 : 20) + (remaining > 50 ? 20 : 0));
              
              return (
                <motion.div 
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.03 }}
                  key={f.id} 
                  className={cn(
                    "bg-white p-6 rounded-[2.5rem] border-2 transition-all space-y-5 shadow-sm group hover:shadow-2xl hover:border-indigo-100 relative overflow-hidden",
                    isMaintenanceRequired ? (prevMaintStatus === 'vencida' ? "border-red-100 bg-red-50/10" : "border-amber-100 bg-amber-50/10") : "border-slate-50"
                  )}
                >
                  {/* Decorative background circle */}
                  <div className={cn(
                    "absolute -right-12 -top-12 w-32 h-32 rounded-full opacity-[0.03] transition-transform group-hover:scale-150 group-hover:opacity-[0.05]",
                    f.status === 'available' ? "bg-emerald-500" : "bg-red-500"
                  )} />

                  {/* Card Header */}
                  <div className="flex justify-between items-start relative z-10">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110",
                        f.status === 'available' ? "bg-emerald-600 text-white shadow-emerald-100" : 
                        f.status === 'at_risk' ? "bg-amber-500 text-white shadow-amber-100" : 
                        "bg-red-600 text-white shadow-red-100"
                      )}>
                        <Truck className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                           <h4 className="font-black text-slate-900 text-lg leading-tight tracking-tight">{f.model}</h4>
                           <span className={cn(
                             "text-[8px] font-black px-1.5 py-0.5 rounded-full border",
                             localHealth > 70 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-amber-50 text-amber-600 border-amber-100"
                           )}>{localHealth}% Health</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{f.serialNumber}</span>
                           <span className="w-1 h-1 bg-slate-200 rounded-full" />
                           <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{f.type || 'Equipamento'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                       {onReportOccurrence && (
                         <button 
                           onClick={() => onReportOccurrence(f)}
                           className="p-2 text-slate-400 hover:text-orange-500 hover:bg-orange-50 rounded-xl transition-all"
                           title="Registrar Ocorrência"
                         >
                           <AlertTriangle className="w-4 h-4" />
                         </button>
                       )}
                       <button 
                        onClick={() => handleDeleteMachine(f.id)}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Maintenance Progress Section */}
                  <div className="space-y-3 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                    <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <History className="w-3 h-3" />
                        Saúde Preventiva
                      </span>
                      <span className={cn(
                        remaining <= 50 ? "text-red-500" : "text-blue-600"
                      )}>
                        {remaining}h para {nextHours}h
                      </span>
                    </div>
                    <div className="h-4 w-full bg-slate-200/50 rounded-full overflow-hidden p-1 shadow-inner relative">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className={cn(
                          "h-full rounded-full transition-all shadow-sm relative z-10",
                          prevMaintStatus === 'vencida' ? "bg-red-500" :
                          prevMaintStatus === 'proxima' ? "bg-amber-500" :
                          "bg-indigo-500"
                        )}
                      />
                      {/* Scale marks */}
                      <div className="absolute inset-0 flex justify-around items-center px-2">
                        {[1,2,3,4,5].map(i => <div key={i} className="w-[1px] h-1 bg-slate-300 opacity-30" />)}
                      </div>
                    </div>
                    <div className="flex justify-between items-center text-[9px] font-bold text-slate-400">
                       <span className="bg-white px-2 py-0.5 rounded-full border border-slate-100">{nextHours - 500}h Base</span>
                       <span className={cn(
                         "px-2.5 py-1 rounded-full border shadow-sm font-black text-[8px]",
                         prevMaintStatus === 'vencida' ? "bg-red-500 text-white border-red-600" :
                         prevMaintStatus === 'proxima' ? "bg-amber-100 text-amber-700 border-amber-200" :
                         prevMaintStatus === 'desatualizado' ? "bg-slate-100 text-slate-500 border-slate-200" :
                         "bg-emerald-500 text-white border-emerald-600"
                       )}>
                         {prevMaintStatus === 'vencida' ? 'MANUTENÇÃO VENCIDA' :
                          prevMaintStatus === 'proxima' ? 'MANUTENÇÃO PRÓXIMA' :
                          prevMaintStatus === 'desatualizado' ? 'DADOS DESATUALIZADOS' : 'PLANILHA EM DIA'}
                       </span>
                    </div>
                  </div>

                  {/* Operational Data Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative group/meter">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Horímetro Atual</p>
                      <div className="bg-white p-3 rounded-2xl border border-slate-100 flex items-center justify-between group-hover/meter:border-indigo-200 transition-colors shadow-sm">
                        {editingHourMeter?.id === f.id && editingHourMeter.field === 'last' ? (
                          <div className="flex items-center gap-1 w-full">
                            <input 
                              type="number"
                              step="0.1"
                              autoFocus
                              value={editingHourMeter.value}
                              onChange={(e) => setEditingHourMeter({ ...editingHourMeter, value: e.target.value })}
                              className="w-full bg-indigo-50/50 border-none rounded-lg text-sm font-black outline-none py-0.5 px-2"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateHourMeter(f.id);
                                if (e.key === 'Escape') setEditingHourMeter(null);
                              }}
                            />
                            <button onClick={() => handleUpdateHourMeter(f.id)} className="text-emerald-600 p-1">
                              <Check className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="text-sm font-black text-slate-900">{formatHourMeter(f.lastHourMeter)}</span>
                            <button 
                              onClick={() => setEditingHourMeter({ id: f.id, value: String(f.lastHourMeter || 0), field: 'last' })}
                              className="p-1 px-2 text-[8px] font-black text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all border border-indigo-100 bg-indigo-50/30"
                            >
                              EDITAR
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="relative group/meter">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Próxima Prev.</p>
                      <div className="bg-white p-3 rounded-2xl border border-slate-100 flex items-center justify-between group-hover/meter:border-indigo-200 transition-colors shadow-sm">
                        {editingHourMeter?.id === f.id && editingHourMeter.field === 'next' ? (
                          <div className="flex items-center gap-1 w-full">
                            <input 
                              type="number"
                              step="1"
                              autoFocus
                              value={editingHourMeter.value}
                              onChange={(e) => setEditingHourMeter({ ...editingHourMeter, value: e.target.value })}
                              className="w-full bg-indigo-50/50 border-none rounded-lg text-sm font-black outline-none py-0.5 px-2"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateHourMeter(f.id);
                                if (e.key === 'Escape') setEditingHourMeter(null);
                              }}
                            />
                            <button onClick={() => handleUpdateHourMeter(f.id)} className="text-emerald-600 p-1">
                              <Check className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="text-sm font-black text-slate-900">{f.nextPreventiveHorometer || 0}h</span>
                            <button 
                              onClick={() => setEditingHourMeter({ id: f.id, value: String(f.nextPreventiveHorometer || 0), field: 'next' })}
                              className="p-1 px-2 text-[8px] font-black text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all border border-indigo-100 bg-indigo-50/30"
                            >
                              EDITAR
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Assignments Section */}
                  <div className="space-y-4 pt-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-sm shadow-blue-200" />
                          Diurno
                        </label>
                        <div className="relative">
                          <select 
                            value={f.assignedOperatorIdShift1 || ''}
                            onChange={(e) => handleAssignOperator(f.id, e.target.value, '1')}
                            className="w-full p-2.5 bg-slate-50 border border-slate-100 rounded-2xl text-[11px] font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none cursor-pointer pr-8"
                          >
                            <option value="">Livre</option>
                            {uniqueOperators.map(o => (
                              <option key={o.uid} value={o.uid}>{o.displayName}</option>
                            ))}
                          </select>
                          <UserPlus className="w-3 h-3 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-sm shadow-orange-200" />
                          Noturno
                        </label>
                        <div className="relative">
                          <select 
                            value={f.assignedOperatorIdShift2 || ''}
                            onChange={(e) => handleAssignOperator(f.id, e.target.value, '2')}
                            className="w-full p-2.5 bg-slate-50 border border-slate-100 rounded-2xl text-[11px] font-bold outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer pr-8"
                          >
                            <option value="">Livre</option>
                            {uniqueOperators.map(o => (
                              <option key={o.uid} value={o.uid}>{o.displayName}</option>
                            ))}
                          </select>
                          <UserPlus className="w-3 h-3 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer Status */}
                  <div className="pt-4 border-t border-slate-50 flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest w-fit mb-1 border shadow-xs",
                        f.status === 'available' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : 
                        f.status === 'at_risk' ? "bg-amber-50 text-amber-600 border-amber-100" :
                        "bg-red-50 text-red-600 border-red-100"
                      )}>
                        {f.status === 'available' ? 'OPERACIONAL' : 
                         f.status === 'at_risk' ? 'EM RISCO' :
                         f.status === 'stopped' ? 'EQUIP. PARADO' : 'MANUTENÇÃO'}
                      </span>
                      {f.lastHourMeterUpdate && (
                        <p className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          Lido {isNaN(new Date(f.lastHourMeterUpdate).getTime()) ? '-' : formatDistanceToNow(new Date(f.lastHourMeterUpdate), { addSuffix: true, locale: ptBR })}
                        </p>
                      )}
                    </div>
                    {(f.assignedOperatorNameShift1 || f.assignedOperatorNameShift2) && (
                      <div className="flex -space-x-2">
                        {f.assignedOperatorNameShift1 && (
                          <div className="w-8 h-8 rounded-full bg-blue-600 border-2 border-white flex items-center justify-center text-[10px] font-black text-white shadow-sm cursor-help relative group/name" title={`Diurno: ${f.assignedOperatorNameShift1}`}>
                            {f.assignedOperatorNameShift1.charAt(0)}
                          </div>
                        )}
                        {f.assignedOperatorNameShift2 && (
                          <div className="w-8 h-8 rounded-full bg-orange-500 border-2 border-white flex items-center justify-center text-[10px] font-black text-white shadow-sm cursor-help relative group/name" title={`Noturno: ${f.assignedOperatorNameShift2}`}>
                            {f.assignedOperatorNameShift2.charAt(0)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Add Machine Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[3rem] w-full max-w-md shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-xl">
                    <Plus className="w-5 h-5 text-blue-600" />
                  </div>
                  Nova Máquina
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
            
            <form onSubmit={handleAddMachine} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Modelo</label>
                <input 
                  type="text" 
                  value={formData.model}
                  onChange={(e) => setFormData({...formData, model: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Mx25, Manipulador..."
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Número de Série</label>
                <input 
                  type="text" 
                  value={formData.serialNumber}
                  onChange={(e) => setFormData({...formData, serialNumber: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: 91005-01"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Tipo</label>
                  <select 
                    value={formData.type}
                    onChange={(e) => setFormData({...formData, type: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="empilhadeira">Empilhadeira</option>
                    <option value="manipulador">Manipulador</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Próxima Prev. (H)</label>
                  <input 
                    type="number" 
                    value={formData.nextPreventiveHorometer}
                    onChange={(e) => setFormData({...formData, nextPreventiveHorometer: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: 500, 1000..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Diurno (Opcional)</label>
                  <select 
                    value={formData.assignedOperatorIdShift1}
                    onChange={(e) => setFormData({...formData, assignedOperatorIdShift1: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Nenhum</option>
                    {uniqueOperators.map(o => (
                      <option key={o.uid} value={o.uid}>{o.displayName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Noturno (Opcional)</label>
                  <select 
                    value={formData.assignedOperatorIdShift2}
                    onChange={(e) => setFormData({...formData, assignedOperatorIdShift2: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Nenhum</option>
                    {uniqueOperators.map(o => (
                      <option key={o.uid} value={o.uid}>{o.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-6 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-4 text-slate-500 font-black hover:bg-slate-50 rounded-2xl transition-all uppercase text-xs tracking-widest"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-4 bg-slate-900 text-white font-black rounded-2xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-2 uppercase text-xs tracking-widest"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      </AnimatePresence>
    </div>
  );
}
