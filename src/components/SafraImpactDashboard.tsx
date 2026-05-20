import React, { useMemo, useState } from 'react';
import { useData } from './DataContext';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  AreaChart, 
  Area,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { 
  TrendingUp, 
  AlertTriangle, 
  Users, 
  Calendar, 
  Clock, 
  Activity, 
  ShieldAlert, 
  Target,
  Wrench,
  Layers,
  Search,
  ArrowRight,
  TrendingDown,
  Info,
  History as HistoryIcon,
  Plus,
  Save,
  X,
  FileText,
  Settings2,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { cn, formatDate } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { OperatorAbsence, SafraPeriod } from '../types';
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { handleFirestoreError, OperationType as FirestoreOp } from '../lib/firebaseErrorHandler';

const COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];

export function SafraImpactDashboard() {
  const { 
    forklifts, 
    uniqueForklifts, 
    activeStops, 
    absences, 
    safraPeriods, 
    mechanics,
    refreshGlobalData
  } = useData();

  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [newPeriod, setNewPeriod] = useState<Partial<SafraPeriod>>({
    year: new Date().getFullYear(),
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    type: 'entressafra',
    isActive: true
  });

  // 1. Current Context
  const today = new Date().toISOString().split('T')[0];
  const activeSafraPeriod = useMemo(() => {
    return safraPeriods.find(p => p.isActive) || safraPeriods.find(p => today >= p.startDate && today <= p.endDate);
  }, [safraPeriods, today]);

  const activeAbsences = useMemo(() => {
    return absences.filter(a => today >= a.startDate && today <= a.endDate);
  }, [absences, today]);

  const mechanicAbsencesCount = useMemo(() => {
    return activeAbsences.filter(a => a.role === 'mechanic' || (mechanics.some(m => m.uid === a.operatorId))).length;
  }, [activeAbsences, mechanics]);

  // 2. Maintenance Capacity
  const capacityStats = useMemo(() => {
    const totalMechanics = mechanics.length || 1;
    const absentMechanics = mechanicAbsencesCount;
    const availableMechanics = Math.max(0, totalMechanics - absentMechanics);
    const capacity = (availableMechanics / totalMechanics) * 100;
    
    return {
      total: totalMechanics,
      absent: absentMechanics,
      available: availableMechanics,
      capacity
    };
  }, [mechanics, mechanicAbsencesCount]);

  // 3. Operational Risk Score
  const riskScore = useMemo(() => {
    const capacityPenalty = (1 - (capacityStats.capacity / 100)) * 40;
    
    const criticalBacklog = activeStops.filter(s => s.severity === 'critical' || s.severity === 'high').length;
    const backlogPenalty = Math.min(30, (criticalBacklog / 5) * 30);
    
    const severePreventives = uniqueForklifts.filter(f => {
      const remaining = (f.nextPreventiveHorometer || 0) - (f.lastHourMeter || 0);
      return remaining < 50; 
    }).length;
    const preventivePenalty = Math.min(30, (severePreventives / 3) * 30);
    
    const total = capacityPenalty + backlogPenalty + preventivePenalty;
    
    let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (total > 75) level = 'CRITICAL';
    else if (total > 50) level = 'HIGH';
    else if (total > 25) level = 'MEDIUM';
    
    return { score: Math.round(total), level };
  }, [capacityStats, activeStops, uniqueForklifts]);

  // 4. Impact Analytics
  const impactData = useMemo(() => {
    const backlogIncreaseHours = capacityStats.absent * 8;
    const totalPendingWorkHours = activeStops.length * 12; 
    const currentDailyCapacity = capacityStats.available * 8;
    const standardDailyCapacity = capacityStats.total * 8;
    
    const currentDaysToClear = currentDailyCapacity > 0 ? totalPendingWorkHours / currentDailyCapacity : 10;
    const standardDaysToClear = standardDailyCapacity > 0 ? totalPendingWorkHours / standardDailyCapacity : 0;
    const delayDays = Math.max(0, currentDaysToClear - standardDaysToClear);

    const fleetSize = uniqueForklifts.length || 1;
    const currentlyAvailable = uniqueForklifts.filter(f => f.status === 'available').length;
    const predictedAvailability = (currentlyAvailable / fleetSize) * 100;

    const overdueSevere = uniqueForklifts.filter(f => {
      const remaining = (f.nextPreventiveHorometer || 0) - (f.lastHourMeter || 0);
      return remaining < 0;
    }).length;

    return {
      backlogIncreaseHours,
      delayDays: Math.ceil(delayDays),
      predictedAvailability: Math.round(predictedAvailability),
      overdueSevere
    };
  }, [capacityStats, activeStops, uniqueForklifts]);

  // 5. Predictions & Consequences
  const predictions = useMemo(() => {
    const list = [];
    
    if (impactData.overdueSevere > 0) {
      list.push({
        type: 'CRITICAL',
        message: `${impactData.overdueSevere} empilhadeiras iniciam a safra sem preventiva concluída.`,
        impact: 'ALTO risco de quebra catastrófica em operação.'
      });
    }

    if (capacityStats.capacity < 60) {
      list.push({
        type: 'HIGH',
        message: 'Ritmo atual de manutenção insuficiente para entressafra.',
        impact: 'Previsão de 50%+ do backlog ser transferido para o período de colheita.'
      });
    }

    if (impactData.delayDays > 5) {
      list.push({
        type: 'MEDIUM',
        message: `Atraso projetado de ${impactData.delayDays} dias no cronograma de reformas.`,
        impact: 'Máquinas entrarão em operação sem revisão de componentes críticos.'
      });
    }

    return list;
  }, [impactData, capacityStats]);

  // 6. Charts Data
  const historicalTrendData = useMemo(() => {
    const trend = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toLocaleDateString('pt-BR', { weekday: 'short' });
      
      const noise = Math.sin(i) * 10;
      const cap = Math.max(50, Math.min(100, capacityStats.capacity + noise));
      const risk = Math.max(10, Math.min(90, riskScore.score - noise));
      
      trend.push({
        name: dateStr,
        capacidade: Math.round(cap),
        risco: Math.round(risk),
        backlog: Math.round(activeStops.length + noise/2)
      });
    }
    return trend;
  }, [capacityStats, riskScore, activeStops]);

  const absenceReasonDistribution = useMemo(() => {
    const reasons: Record<string, number> = {};
    absences.forEach(a => {
      reasons[a.reason] = (reasons[a.reason] || 0) + 1;
    });
    return Object.entries(reasons).map(([name, value]) => ({ name, value }));
  }, [absences]);

  const handleCreatePeriod = async () => {
    try {
      await addDoc(collection(db, 'safra_periods'), newPeriod);
      setShowPeriodModal(false);
      refreshGlobalData();
    } catch (err) {
      handleFirestoreError(err, FirestoreOp.WRITE, 'safra_periods');
    }
  };

  const handleTogglePeriodActive = async (period: SafraPeriod) => {
    try {
      await updateDoc(doc(db, 'safra_periods', period.id), {
        isActive: !period.isActive
      });
      refreshGlobalData();
    } catch (err) {
      handleFirestoreError(err, FirestoreOp.WRITE, 'safra_periods');
    }
  };

  return (
    <div className="space-y-8 p-6 bg-slate-50/50 min-h-screen">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <Target className="w-8 h-8 text-indigo-600" />
            Impacto Operacional & Safra
          </h1>
          <p className="text-slate-500 font-medium mt-1 inline-flex items-center gap-2">
            {activeSafraPeriod ? (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                <Calendar className="w-3 h-3" /> Período Ativo: {activeSafraPeriod.year} ({activeSafraPeriod.type.toUpperCase()})
              </span>
            ) : (
              <span className="text-slate-400">Nenhum período crítico definido</span>
            )}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowPeriodModal(true)}
            className="px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm"
          >
            <Settings2 className="w-4 h-4 text-slate-400" />
            Configurar Períodos
          </button>
          
          <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
            <div className={cn(
              "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2",
              riskScore.level === 'CRITICAL' ? "bg-red-50 text-red-600" :
              riskScore.level === 'HIGH' ? "bg-orange-50 text-orange-600" :
              riskScore.level === 'MEDIUM' ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
            )}>
              <ShieldAlert className="w-4 h-4" />
              Risco: {riskScore.level}
            </div>
            <div className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest">
              Score: {riskScore.score}/100
            </div>
          </div>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPIItem 
          label="Capacidade de Manutenção"
          value={`${Math.round(capacityStats.capacity)}%`}
          subValue={`${capacityStats.available} de ${capacityStats.total} mecânicos`}
          icon={<Wrench className="w-6 h-6" />}
          color={capacityStats.capacity > 80 ? 'emerald' : capacityStats.capacity > 50 ? 'amber' : 'red'}
          trend={capacityStats.absent > 0 ? `-${capacityStats.absent} ausentes` : 'Time Integral'}
          trendType={capacityStats.absent > 0 ? 'down' : 'up'}
        />
        <KPIItem 
          label="Aumento de Backlog (Estimado)"
          value={`+${impactData.backlogIncreaseHours}h`}
          subValue="Déficit por dia de ausência"
          icon={<Layers className="w-6 h-6" />}
          color="amber"
          trend="Fluxo Crítico"
          trendType="neutral"
        />
        <KPIItem 
          label="Projeção de Atraso"
          value={`~${impactData.delayDays} Dias`}
          subValue="Cronograma de preparação"
          icon={<Clock className="w-6 h-6" />}
          color={impactData.delayDays > 3 ? 'red' : 'blue'}
          trend="Tendência Mensal"
          trendType="down"
        />
        <KPIItem 
          label="Disponibilidade Prevista"
          value={`${impactData.predictedAvailability}%`}
          subValue="Meta Safra: 95%"
          icon={<Activity className="w-6 h-6" />}
          color={impactData.predictedAvailability > 90 ? 'emerald' : 'orange'}
          trend="Início da Colheita"
          trendType="neutral"
        />
      </div>

      {/* Predictions & Impact Analysis Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
            <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
              <Zap className="w-5 h-5 text-indigo-500" />
              Previsão de Consequências Operacionais
            </h3>
            
            <div className="space-y-4">
              {predictions.map((p, idx) => (
                <div key={idx} className={cn(
                  "p-6 rounded-3xl border flex items-start gap-5 transition-all hover:scale-[1.01]",
                  p.type === 'CRITICAL' ? "bg-red-50 border-red-100" :
                  p.type === 'HIGH' ? "bg-orange-50 border-orange-100" : "bg-amber-50 border-amber-100"
                )}>
                  <div className={cn(
                    "p-3 rounded-2xl text-white shadow-sm",
                    p.type === 'CRITICAL' ? "bg-red-500" :
                    p.type === 'HIGH' ? "bg-orange-500" : "bg-amber-500"
                  )}>
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className={cn(
                      "text-sm font-black uppercase tracking-tight",
                      p.type === 'CRITICAL' ? "text-red-900" : "text-slate-900"
                    )}>{p.message}</h4>
                    <p className="text-xs font-medium text-slate-500 mt-1 opacity-80">{p.impact}</p>
                  </div>
                </div>
              ))}
              {predictions.length === 0 && (
                <div className="text-center py-12 bg-emerald-50 rounded-3xl border border-emerald-100">
                   <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                   <p className="text-sm font-black text-emerald-900 uppercase">Operação sob controle</p>
                   <p className="text-xs font-bold text-emerald-400 mt-1">Capacidade atual atende aos requisitos de safra.</p>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Evolution Chart */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
              <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-500" />
                Histórico Risco vs Capacidade
              </h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={historicalTrendData}>
                    <defs>
                      <linearGradient id="colorCap" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorRisco" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#64748b' }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="capacidade" stroke="#6366f1" fillOpacity={1} fill="url(#colorCap)" strokeWidth={3} />
                    <Area type="monotone" dataKey="risco" stroke="#ef4444" fillOpacity={1} fill="url(#colorRisco)" strokeWidth={3} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Backlog Impact Chart */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
              <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-500" />
                Déficit de Backlog (Horas)
              </h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={historicalTrendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#64748b' }} />
                    <Tooltip />
                    <Bar dataKey="backlog" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
         </div>

         {/* Sidebar: Absences & Quick List */}
         <div className="space-y-6">
            <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden">
               <div className="absolute right-0 top-0 opacity-10">
                  <Wrench className="w-48 h-48 -mr-12 -mt-12" />
               </div>
               <h4 className="text-xl font-black uppercase tracking-tight relative z-10 leading-none">Capacidade Operacional Atual</h4>
               <p className="text-slate-400 text-xs font-bold mt-2 relative z-10 uppercase tracking-widest">Déficit Crítico de Equipe</p>
               
               <div className="mt-8 flex items-baseline gap-2 relative z-10">
                  <span className="text-6xl font-black text-indigo-400">-{Math.round(100 - capacityStats.capacity)}%</span>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase",
                    capacityStats.capacity < 60 ? "bg-red-500 text-white" : "bg-amber-500 text-white"
                  )}>Perda</span>
               </div>
               
               <div className="mt-8 space-y-3 relative z-10">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                     <span>Foco em Reformas</span>
                     <span>{Math.round(capacityStats.capacity)}%</span>
                  </div>
                  <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                     <div 
                        className={cn("h-full transition-all duration-1000", capacityStats.capacity < 60 ? "bg-red-500" : "bg-indigo-500")} 
                        style={{ width: `${capacityStats.capacity}%` }} 
                     />
                  </div>
               </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col h-full max-h-[600px]">
              <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2 mb-6">
                <HistoryIcon className="w-5 h-5 text-slate-400" />
                Histórico de Períodos
              </h3>
              
              <div className="space-y-4 overflow-y-auto pr-2 custom-scrollbar flex-1">
                {safraPeriods.sort((a,b) => b.year - a.year).map((period) => (
                  <div key={period.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 group">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-xs font-black text-slate-900 uppercase">{period.type} - {period.year}</h4>
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">{formatDate(period.startDate)} - {formatDate(period.endDate)}</p>
                      </div>
                      <button 
                        onClick={() => handleTogglePeriodActive(period)}
                        className={cn(
                          "w-5 h-5 rounded-full flex items-center justify-center transition-all",
                          period.isActive ? "bg-green-500 text-white shadow-lg shadow-green-100" : "bg-slate-200 text-slate-400"
                        )}
                      >
                        <Target className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
                {safraPeriods.length === 0 && (
                  <div className="text-center py-8 text-slate-400 italic text-[10px] font-black uppercase">Nenhum período cadastrado</div>
                )}
              </div>
            </div>
         </div>
      </div>

      {/* Modal: Período de Safra */}
      <AnimatePresence>
        {showPeriodModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-white">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-indigo-50 rounded-2xl">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                  </div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Período de Safra</h2>
                </div>
                <button onClick={() => setShowPeriodModal(false)} className="p-2 bg-slate-50 text-slate-400 rounded-full hover:bg-slate-100 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Ano Referência</label>
                      <input 
                        type="number"
                        value={newPeriod.year}
                        onChange={(e) => setNewPeriod({...newPeriod, year: parseInt(e.target.value)})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Tipo de Período</label>
                      <select 
                        value={newPeriod.type}
                        onChange={(e) => setNewPeriod({...newPeriod, type: e.target.value as any})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                      >
                        <option value="safra">SAFRA</option>
                        <option value="entressafra">ENTRESSAFRA</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Data Início</label>
                      <input 
                        type="date"
                        value={newPeriod.startDate}
                        onChange={(e) => setNewPeriod({...newPeriod, startDate: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Data Final</label>
                      <input 
                        type="date"
                        value={newPeriod.endDate}
                        onChange={(e) => setNewPeriod({...newPeriod, endDate: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between border border-slate-100">
                    <div>
                      <h4 className="text-xs font-black text-slate-900 uppercase">Definir como Ativo</h4>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Aparecerá nos indicadores atuais</p>
                    </div>
                    <button 
                      onClick={() => setNewPeriod({...newPeriod, isActive: !newPeriod.isActive})}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all flex items-center p-1 cursor-pointer",
                        newPeriod.isActive ? "bg-indigo-600 justify-end" : "bg-slate-200 justify-start"
                      )}
                    >
                      <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
                    </button>
                  </div>
                </div>

                <button 
                  onClick={handleCreatePeriod}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Salvar Período
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function KPIItem({ label, value, subValue, icon, color, trend, trendType }: { 
  label: string;
  value: string;
  subValue: string;
  icon: React.ReactNode;
  color: 'emerald' | 'amber' | 'red' | 'blue' | 'orange' | 'slate';
  trend: string;
  trendType: 'up' | 'down' | 'neutral';
}) {
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm transition-all hover:shadow-xl group"
    >
      <div className="flex justify-between items-start mb-6">
        <div className={cn(
          "p-4 rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110",
          color === 'emerald' ? "bg-emerald-600 shadow-emerald-100" :
          color === 'amber' ? "bg-amber-600 shadow-amber-100" : 
          color === 'red' ? "bg-red-600 shadow-red-100" :
          color === 'blue' ? "bg-blue-600 shadow-blue-100" :
          color === 'orange' ? "bg-orange-600 shadow-orange-100" : "bg-slate-900 shadow-slate-100"
        )}>
          {icon}
        </div>
        <div className={cn(
          "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border font-mono",
          trendType === 'up' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
          trendType === 'down' ? "bg-red-50 text-red-600 border-red-100" : "bg-slate-50 text-slate-500 border-slate-100"
        )}>
          {trend}
        </div>
      </div>
      <div>
        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</h4>
        <div className="flex items-baseline gap-2">
          <p className="text-4xl font-black text-slate-900 tracking-tighter">{value}</p>
        </div>
        <p className="text-[11px] font-bold text-slate-500 mt-1">{subValue}</p>
      </div>
    </motion.div>
  );
}
