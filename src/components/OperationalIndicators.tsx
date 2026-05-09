import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  orderBy,
  where,
  getDocs,
  limit
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { 
  OperationalEvent, 
  OperationType, 
  ShiftType, 
  OperationGoal 
} from '../types';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  PieChart, 
  Pie,
  Area,
  AreaChart,
  ReferenceLine,
  Label,
  LabelList,
  Legend
} from 'recharts';
import { 
  TrendingUp, 
  Activity, 
  AlertTriangle, 
  Package, 
  Calendar, 
  ArrowLeft, 
  Target, 
  Maximize2,
  CheckCircle2,
  Clock,
  History as HistoryIcon
} from 'lucide-react';
import { cn } from '../lib/utils';
import { CACHE_KEYS, CACHE_DURATION } from '../constants/cacheKeys';

const COLORS = ['#4f46e5', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'];

const OPERATION_LABELS: Record<string, string> = {
  'tirar_producao': 'Tirar Produção',
  'quebra': 'Quebra',
  'emblocamento': 'Emblocamento',
  'carregamento': 'Carregamento'
};

export function OperationalIndicators() {
  const { profile, loading: authLoading, setQuotaExceeded } = useAuth();
  const { goals } = useData();
  const [events, setEvents] = useState<OperationalEvent[]>([]);
  
  // Date Range Filters: Default to current month
  const now = new Date();
  const firstDayStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastDayStr = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  
  const [startDate, setStartDate] = useState<string>(firstDayStr);
  const [endDate, setEndDate] = useState<string>(lastDayStr);
  const [filterShift, setFilterShift] = useState<ShiftType | 'all'>('all');
  const [selectedOperation, setSelectedOperation] = useState<OperationType | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async (force = false) => {
    if (!profile) return;
    setIsRefreshing(true);
    
    // 1. Try Loading from Cache
    const cacheKey = `${CACHE_KEYS.INDICATORS}_${startDate}_${endDate}`;
    if (!force) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { data, timestamp } = JSON.parse(cached);
          
          if (Date.now() - timestamp < CACHE_DURATION) {
            setEvents(data);
            setIsRefreshing(false);
            return;
          }
        } catch (e) {
          localStorage.removeItem(cacheKey);
        }
      }
    }

    try {
      // Fetch events in range
      const qE = query(
        collection(db, 'operational_events'),
        where('timestamp', '>=', startDate + 'T00:00:00'),
        where('timestamp', '<=', endDate + 'T23:59:59'),
        orderBy('timestamp', 'asc'),
        limit(5000) // Safety limit
      );
      const eSnap = await getDocs(qE);
      const newEvents = eSnap.docs.map(d => ({ id: d.id, ...d.data() } as OperationalEvent));
      
      setEvents(newEvents);
      
      // Update Cache
      localStorage.setItem(cacheKey, JSON.stringify({
        data: newEvents,
        timestamp: Date.now()
      }));

    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        setQuotaExceeded(true);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!authLoading && profile) {
      fetchData();
    }
  }, [authLoading, profile, startDate, endDate]);

  const handleRefresh = () => fetchData(true);

  // Historical Analysis Processing
  const dailyData = useMemo(() => {
    const data: Record<string, Record<string, Record<string, { production: number, activeSeconds: number, hasConsolidation?: boolean }>>> = {};
    
    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    
    // Lifecycle tracking per forklift to calculate duration
    const forkliftStates: Record<string, { lastTime: string, opType: OperationType, shift: string, isEntreSafra?: boolean }> = {};

    sortedEvents.forEach(e => {
      const date = e.timestamp.split('T')[0];
      const shift = e.shift || '1';
      
      if (filterShift !== 'all' && shift !== filterShift) return;
      
      if (!data[date]) data[date] = {};
      if (!data[date][shift]) data[date][shift] = {};
      
      const type = e.operationType;
      if (!data[date][shift][type]) data[date][shift][type] = { production: 0, activeSeconds: 0 };

      // Identify if this is a consolidation event
      const isConsolidation = e.action === 'consolidation' || e.forkliftId === 'system_consolidated';

      // Implementation of "Entre Safra" ignore logic
      const isIgnoredOp = ['tirar_producao', 'quebra', 'emblocamento'].includes(type);
      const inEntreSafra = forkliftStates[e.forkliftId]?.isEntreSafra || e.stopReason === 'entre_safra';
      const skipMeasurement = isIgnoredOp && inEntreSafra;

      if (!skipMeasurement) {
        // Sum production for the operation
        if (e.production) {
          if (isConsolidation) {
            // Consolidation is the absolute total for this (date, shift, type)
            data[date][shift][type].production = e.production;
            data[date][shift][type].hasConsolidation = true;
          } else if (!data[date][shift][type].hasConsolidation) {
            // Only add individual production if no consolidation exists for this bucket
            data[date][shift][type].production += e.production;
          }
        }
      }

      // Duration tracking
      const prev = forkliftStates[e.forkliftId];
      if (prev && !prev.isEntreSafra) {
        const startTime = new Date(prev.lastTime).getTime();
        const endTime = new Date(e.timestamp).getTime();
        const diffSeconds = (endTime - startTime) / 1000;
        
        if (diffSeconds > 0 && diffSeconds < 14 * 3600) { 
          const prevDate = prev.lastTime.split('T')[0];
          const prevShift = prev.shift || '1';
          
          if (filterShift === 'all' || prevShift === filterShift) {
            if (!data[prevDate]) data[prevDate] = {};
            if (!data[prevDate][prevShift]) data[prevDate][prevShift] = {};
            if (!data[prevDate][prevShift][prev.opType]) data[prevDate][prevShift][prev.opType] = { production: 0, activeSeconds: 0 };
            
            data[prevDate][prevShift][prev.opType].activeSeconds += diffSeconds;
          }
        }
      }

      // Update state
      if (e.action === 'stop') {
        const isEntreSafra = e.stopReason === 'entre_safra';
        if (isEntreSafra) {
          forkliftStates[e.forkliftId] = { lastTime: e.timestamp, opType: e.operationType, shift: e.shift, isEntreSafra: true };
        } else {
          delete forkliftStates[e.forkliftId];
        }
      } else {
        forkliftStates[e.forkliftId] = { lastTime: e.timestamp, opType: e.operationType, shift: e.shift, isEntreSafra: false };
      }
    });

    return data;
  }, [events, filterShift]);

  const operationStats = useMemo(() => {
    const list: any[] = [];
    const types: string[] = ['tirar_producao', 'quebra', 'emblocamento', 'carregamento'];
    
    // Days in current range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysInRangeCount = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Days in current full month for projections
    const daysInMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();

    types.forEach(type => {
      const dailyProductions: number[] = [];
      let totalProduction = 0;
      let totalActiveSeconds = 0;
      let worstDay = { production: Infinity, date: '' };
      let bestDay = { production: -1, date: '' };
      let operatedDays = 0;

      Object.entries(dailyData).forEach(([date, shifts]) => {
        let prod = 0;
        let seconds = 0;
        
        Object.values(shifts).forEach(shOps => {
          const stats = shOps[type];
          if (stats) {
            prod += stats.production || 0;
            seconds += stats.activeSeconds || 0;
          }
        });
        
        if (prod > 0 || seconds > 0) {
          operatedDays++;
          totalProduction += prod;
          totalActiveSeconds += seconds;
          if (prod > 0) dailyProductions.push(prod);
          
          if (prod > 0 && prod < worstDay.production) worstDay = { production: prod, date };
          if (prod > bestDay.production) bestDay = { production: prod, date };
        }
      });

      const avgDaily = operatedDays > 0 ? totalProduction / operatedDays : 0;
      const hoursActive = totalActiveSeconds / 3600;
      const productivity = hoursActive > 0 ? totalProduction / hoursActive : 0;
      
      // Stability check
      let stability: 'stable' | 'unstable' = 'stable';
      if (dailyProductions.length >= 3) {
        const variance = dailyProductions.reduce((acc, p) => acc + Math.pow(p - avgDaily, 2), 0) / dailyProductions.length;
        const stdDev = Math.sqrt(variance);
        if (stdDev > avgDaily * 0.4) stability = 'unstable';
      }

      // Projection
      const projection = avgDaily * daysInMonth;
      
      // Daily and Period Goal Calculation
      let dailyGoal = 0;
      if (goals && goals.length > 0) {
        if (filterShift === 'all') {
          dailyGoal = goals
            .filter(g => g.operationType === type)
            .reduce((acc, g) => acc + (Number(g.goal) || 0), 0);
        } else {
          dailyGoal = Number(goals.find(g => g.operationType === type && g.shift === filterShift)?.goal || 0);
        }
      }
      
      const monthGoal = dailyGoal * daysInMonth; 
      
      // Calculate remaining days and needed daily to reach goal
      const today = new Date();
      const currentDay = today.getDate();
      const remainingDays = Math.max(1, daysInMonth - currentDay + 1);
      const remainingToGoal = Math.max(0, monthGoal - totalProduction);
      const neededDailyToGoal = remainingToGoal / remainingDays;

      // Trend
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (dailyProductions.length >= 3) {
        const last3Avg = dailyProductions.slice(-3).reduce((a, b) => a + b, 0) / 3;
        if (last3Avg > avgDaily * 1.05) trend = 'up';
        else if (last3Avg < avgDaily * 0.95) trend = 'down';
      }

      list.push({
        key: type,
        label: OPERATION_LABELS[type] || type,
        totalProduction,
        avgDaily: parseFloat(avgDaily.toFixed(1)),
        productivity: parseFloat(productivity.toFixed(1)),
        hoursActive: parseFloat(hoursActive.toFixed(1)),
        bestDay: bestDay.date ? bestDay : null,
        worstDay: worstDay.date ? worstDay : null,
        operatedDays,
        idleDays: daysInRangeCount - operatedDays,
        stability,
        projection: Math.round(projection),
        monthGoal,
        dailyGoal,
        neededDailyToGoal: parseFloat(neededDailyToGoal.toFixed(1)),
        remainingDays,
        trend,
        dailyHistory: Object.keys(dailyData).sort().map(date => ({
          date: date.split('-').reverse().slice(0, 2).join('/'),
          production: Object.values(dailyData[date] || {}).reduce((acc, sh) => acc + (sh[type]?.production || 0), 0)
        }))
      });
    });

    return list.sort((a, b) => b.totalProduction - a.totalProduction);
  }, [dailyData, startDate, endDate, goals, filterShift]);

  const globalSummary = useMemo(() => {
    const totalProd = operationStats.reduce((acc, s) => acc + s.totalProduction, 0);
    const avgDailyProd = operationStats.filter(s => s.avgDaily > 0).reduce((acc, s) => acc + s.avgDaily, 0);
    
    // Bottleneck: lowest daily avg performance among active
    const bottleneck = [...operationStats]
      .filter(s => s.operatedDays > 0)
      .sort((a, b) => a.avgDaily - b.avgDaily)[0];

    return {
        totalProd,
        avgDailyProd,
        bottleneck
    };
  }, [operationStats]);

  const downtimeStats = useMemo(() => {
    const stats: Record<string, number> = {};
    const count: Record<string, number> = {};
    
    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    
    // Lifecycle tracking per forklift to calculate duration
    const forkliftStates: Record<string, { lastTime: string, action: string, stopReason?: string }> = {};

    sortedEvents.forEach(e => {
      const prev = forkliftStates[e.forkliftId];
      
      // If we are moving FROM a stop TO something else, calculate downtime duration
      if (prev && prev.action === 'stop' && prev.stopReason) {
        const startTime = new Date(prev.lastTime).getTime();
        const endTime = new Date(e.timestamp).getTime();
        const diffSeconds = (endTime - startTime) / 1000;
        
        if (diffSeconds > 0 && diffSeconds < 14 * 3600) { // Reject anomalies
          const reason = prev.stopReason || 'outro';
          if (reason !== 'entre_safra' && reason !== 'consolidacao' && reason !== 'finalizacao_turno') {
            stats[reason] = (stats[reason] || 0) + diffSeconds;
          }
        }
      }

      // Track occurrences
      if (e.action === 'stop') {
        const reason = e.stopReason || 'outro';
        // DO NOT calculate downtime or count occurrences for 'entre_safra' or 'consolidacao'
        if (reason !== 'entre_safra' && reason !== 'consolidacao') {
          count[reason] = (count[reason] || 0) + 1;
          forkliftStates[e.forkliftId] = { lastTime: e.timestamp, action: 'stop', stopReason: reason };
        } else {
          // Still track the state so we know it's not active, but don't count for downtime stats
          forkliftStates[e.forkliftId] = { lastTime: e.timestamp, action: 'stop' }; 
        }
      } else {
        forkliftStates[e.forkliftId] = { lastTime: e.timestamp, action: e.action };
      }
    });

    const labels: Record<string, string> = {
      'chuva': 'Chuva',
      'sem_producao': 'Sem Produção',
      'sem_classificacao': 'Sem Classificação',
      'sem_caminhao': 'Sem Caminhão',
      'algodoeira': 'Algodoeira',
      'mecanico': 'Problema Mecânico',
      'intervalo': 'Intervalo',
      'aguardando_analise': 'Aguardando Análise',
      'sem_carga': 'Sem Carga',
      'falta_fardo': 'Falta Fardo',
      'consolidacao': 'Consolidação',
      'finalizacao_turno': 'Finalização Turno',
      'outro': 'Outro'
    };

    return Object.entries(count).map(([reason, qty]) => {
      const seconds = stats[reason] || 0;
      return {
        key: reason,
        name: labels[reason] || reason,
        qty,
        hours: parseFloat((seconds / 3600).toFixed(1)),
        avgMinutes: qty > 0 ? Math.round((seconds / 60) / qty) : 0
      };
    }).sort((a, b) => b.qty - a.qty);
  }, [events]);

  return (
    <div className="flex flex-col min-h-full bg-[#f8fafc]">
      {/* Header & Advanced Range Filters */}
      <div className="bg-white border-b border-slate-200 px-6 py-6 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <BarChart className="w-8 h-8 text-indigo-600" />
              Gestão de Produção & Histórico
            </h1>
            <p className="text-slate-500 font-medium text-sm">Análise consolidada por período e tendências operacionais</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={cn(
                "p-2.5 rounded-2xl border border-slate-200 transition-all active:scale-95 group",
                isRefreshing ? "bg-slate-50 text-slate-300" : "bg-white text-slate-600 hover:bg-slate-50 hover:border-blue-200"
              )}
              title="Atualizar Dados"
            >
              <HistoryIcon className={cn("w-4 h-4 transition-transform duration-700", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
            </button>
            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 text-xs font-black">
              <Calendar className="w-4 h-4 text-slate-400 ml-2" />
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-slate-700 outline-none"
              />
              <span className="text-slate-300">até</span>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-slate-700 outline-none pr-2"
              />
            </div>

            <select 
                value={filterShift}
                onChange={(e) => setFilterShift(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 text-xs font-black text-slate-700 outline-none hover:border-indigo-300 transition-all cursor-pointer"
            >
                <option value="all">TODOS OS TURNOS</option>
                <option value="1">TURNO 1 (DIA)</option>
                <option value="2">TURNO 2 (NOITE)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-8 max-w-7xl mx-auto w-full">
        
        {/* TOP LEVEL: GLOBAL OVERVIEW */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex items-center gap-6">
                <div className="w-16 h-16 bg-blue-50 rounded-3xl flex items-center justify-center text-blue-600">
                    <Package className="w-8 h-8" />
                </div>
                <div>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Produção no Período</p>
                   <h3 className="text-3xl font-black text-slate-900">{globalSummary.totalProd} <span className="text-sm text-slate-400">fardos</span></h3>
                </div>
            </div>

            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex items-center gap-6">
                <div className="w-16 h-16 bg-indigo-50 rounded-3xl flex items-center justify-center text-indigo-600">
                    <Activity className="w-8 h-8" />
                </div>
                <div>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Soma Médias Diárias</p>
                   <h3 className="text-3xl font-black text-slate-900">{globalSummary.avgDailyProd.toFixed(1)} <span className="text-sm text-slate-400">f/dia</span></h3>
                </div>
            </div>

            {/* Historical Bottleneck */}
            <div className="bg-slate-900 p-6 rounded-[2.5rem] shadow-xl text-white flex items-center gap-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/20 rounded-full blur-3xl -mr-12 -mt-12" />
                <div className="w-16 h-16 bg-white/10 border border-white/20 rounded-3xl flex items-center justify-center text-red-400 z-10">
                    <Target className="w-8 h-8" />
                </div>
                <div className="z-10">
                   <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">Menor Média no Período</p>
                   <h3 className="text-xl font-black text-white uppercase tracking-tight truncate max-w-[180px]">
                        {globalSummary.bottleneck?.label || '---'}
                   </h3>
                   <p className="text-[10px] font-bold text-slate-500 mt-1">Média: {globalSummary.bottleneck?.avgDaily || 0} f/dia</p>
                </div>
            </div>
        </div>

        {/* MAIN PERFORMANCE SECTION */}
        <section className="space-y-6">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Análise por Operação
            </h2>

            <div className="grid grid-cols-1 gap-8">
                {operationStats.map(op => (
                    <div key={op.key} className="bg-white rounded-[3rem] p-8 shadow-sm border border-slate-100 hover:shadow-md transition-shadow group">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                            {/* Stats Column */}
                            <div className="lg:col-span-4 space-y-8">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">{op.label}</h3>
                                        <div className="flex items-center gap-2 mt-2">
                                            {op.stability === 'stable' ? (
                                                <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-600 rounded-full text-[10px] font-black uppercase">
                                                    <CheckCircle2 className="w-3 h-3" /> Operação Estável
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-[10px] font-black uppercase">
                                                    <AlertTriangle className="w-3 h-3" /> Operação Instável
                                                </span>
                                            )}
                                            {op.trend === 'up' && <TrendingUp className="w-4 h-4 text-green-500" />}
                                            {op.trend === 'down' && <TrendingUp className="w-4 h-4 text-red-500 rotate-180" />}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Média Diária</span>
                                        <h4 className="text-xl font-black text-slate-900">{op.avgDaily} <span className="text-[10px] text-slate-400">fardos</span></h4>
                                    </div>
                                    <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Dias Ativos</span>
                                        <h4 className="text-xl font-black text-slate-900">{op.operatedDays} <span className="text-[10px] text-slate-400">dias</span></h4>
                                    </div>
                                </div>

                                <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100">
                                    <div className="flex justify-between items-center mb-4">
                                        <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Projeção Mensal</p>
                                        <span className="text-[10px] font-bold text-indigo-400">Baseado na média</span>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                        <h4 className="text-3xl font-black text-indigo-900">{op.projection}</h4>
                                        <span className="text-sm font-black text-indigo-400">fardos / mês</span>
                                    </div>
                                    
                                    {op.monthGoal > 0 && (
                                        <div className="mt-4 space-y-3">
                                            <div className="flex justify-between items-end">
                                                <div>
                                                    <span className="text-[10px] font-black text-indigo-400 uppercase block">Falta p/ Meta</span>
                                                    <span className="text-lg font-black text-indigo-900 leading-none">{Math.max(0, op.monthGoal - op.totalProduction)} f</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-[10px] font-black text-amber-600 uppercase block">Necessário</span>
                                                    <span className="text-lg font-black text-amber-700 leading-none">{op.neededDailyToGoal} f/dia</span>
                                                </div>
                                            </div>

                                            <div className="space-y-1">
                                                <div className="h-2 w-full bg-white rounded-full overflow-hidden border border-indigo-100">
                                                    <div 
                                                        className="h-full bg-indigo-500 rounded-full transition-all duration-1000"
                                                        style={{ width: `${Math.min(100, (op.totalProduction / op.monthGoal * 100))}%` }}
                                                    />
                                                </div>
                                                <div className="flex justify-between text-[8px] font-bold text-indigo-400 uppercase">
                                                    <span>Progresso: {Math.round((op.totalProduction / op.monthGoal) * 100)}%</span>
                                                    <span>{op.remainingDays} dias restantes</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Chart Column */}
                            <div className="lg:col-span-8 flex flex-col">
                                <div className="flex justify-between items-center mb-6">
                                    <span className="text-xs font-black text-slate-900 uppercase tracking-widest">Evolução Histórica</span>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right">
                                            <p className="text-[10px] font-black text-slate-400 uppercase">Melhor Dia</p>
                                            <p className="text-xs font-black text-green-600">{op.bestDay?.production || 0} f <span className="opacity-60 text-[8px]">({op.bestDay?.date?.split('-').reverse().slice(0,2).join('/')})</span></p>
                                        </div>
                                    </div>
                                </div>

                                <div className="h-[280px] w-full bg-slate-50/30 rounded-3xl p-4">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={op.dailyHistory} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                            <XAxis 
                                                dataKey="date" 
                                                axisLine={false} 
                                                tickLine={false} 
                                                tick={{fontSize: 9, fontWeight: 800, fill: '#94a3b8'}}
                                                dy={10}
                                            />
                                            <YAxis 
                                                axisLine={false} 
                                                tickLine={false} 
                                                tick={false}
                                                domain={[0, (dataMax: any) => Math.max(dataMax, op.dailyGoal * 1.1, 10)]}
                                            />
                                            <Tooltip 
                                                cursor={{ fill: 'transparent' }}
                                                contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '16px' }}
                                                itemStyle={{ fontWeight: 900, fontSize: '12px' }}
                                            />
                                            {op.dailyGoal > 0 && (
                                                <ReferenceLine 
                                                    y={op.dailyGoal} 
                                                    stroke="#f59e0b" 
                                                    strokeDasharray="5 5" 
                                                    strokeWidth={2}
                                                >
                                                    <Label 
                                                        value={`${op.dailyGoal}`} 
                                                        position="top" 
                                                        fill="#f59e0b" 
                                                        fontSize={10} 
                                                        fontWeight={900} 
                                                        offset={10}
                                                    />
                                                </ReferenceLine>
                                            )}
                                            <Bar dataKey="production" radius={[6, 6, 0, 0]} barSize={24}>
                                                {op.dailyHistory.map((entry: any, index: number) => (
                                                    <Cell 
                                                        key={`cell-${index}`} 
                                                        fill={(op.dailyGoal > 0 && entry.production >= op.dailyGoal) ? '#10b981' : (op.dailyGoal > 0 ? '#ef4444' : '#4f46e5')} 
                                                    />
                                                ))}
                                                <LabelList 
                                                    dataKey="production" 
                                                    position="top" 
                                                    style={{ fontSize: '10px', fontWeight: '900', fill: '#64748b' }} 
                                                    formatter={(v: number) => v > 0 ? v : ''}
                                                />
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </section>

        {/* COMPARISON AND DETAILED RANKINGS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-8">
            <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-8 text-center text-indigo-600">Comparativo Global (Produção)</h3>
                <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={operationStats} layout="vertical" margin={{ left: 20, right: 40 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                            <XAxis type="number" axisLine={false} tickLine={false} tick={false} />
                            <YAxis dataKey="label" type="category" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 900, fill: '#64748b'}} width={100} />
                            <Tooltip 
                                cursor={{ fill: 'transparent' }}
                                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            />
                            <Bar dataKey="totalProduction" name="Prod. Real" radius={[0, 8, 8, 0]} barSize={20}>
                                {operationStats.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                                <LabelList 
                                    dataKey="totalProduction" 
                                    position="right" 
                                    style={{ fontSize: '10px', fontWeight: '900', fill: '#1e293b' }} 
                                />
                            </Bar>
                            <Bar dataKey="monthGoal" name="Meta Período" fill="#e2e8f0" radius={[0, 8, 8, 0]} barSize={10}>
                                <LabelList 
                                    dataKey="monthGoal" 
                                    position="right" 
                                    style={{ fontSize: '8px', fontWeight: '700', fill: '#94a3b8' }} 
                                    formatter={(v: number) => v > 0 ? `Meta: ${v}` : ''}
                                />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-8 text-center text-indigo-600">Ranking por Média Diária</h3>
                <div className="space-y-6">
                    {operationStats.map((op, idx) => (
                        <div key={op.key} className="flex items-center gap-4">
                            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-[10px] font-black text-slate-400">
                                0{idx + 1}
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-baseline mb-2">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-black text-slate-700 uppercase">{op.label}</span>
                                        {op.dailyGoal > 0 && (
                                            <span className="text-[8px] font-bold text-amber-600 uppercase">Meta: {op.dailyGoal} f/dia</span>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-black text-slate-900">{op.avgDaily} <span className="text-[10px] text-slate-400 px-1">f/dia</span></span>
                                        {op.dailyGoal > 0 && (
                                            <span className={cn(
                                                "block text-[9px] font-black uppercase",
                                                op.avgDaily >= op.dailyGoal ? "text-emerald-500" : "text-red-500"
                                            )}>
                                                {Math.round((op.avgDaily / op.dailyGoal) * 100)}% da meta
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="h-2.5 w-full bg-slate-50 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-indigo-500 transition-all duration-1000"
                                        style={{ width: `${(op.avgDaily / (operationStats[0]?.avgDaily || 1)) * 100}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
        
        {/* NEW: DOWNTIME & DEFICIENCIES ANALYSIS */}
        <section className="space-y-6 pt-8 border-t border-slate-200">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Análise de Paradas e Deficiências
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Ranking of Reasons */}
                <div className="lg:col-span-7 bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-8 flex items-center gap-2">
                        <Target className="w-4 h-4 text-indigo-500" />
                        Impacto por Motivo
                    </h3>
                    
                    <div className="space-y-4">
                        {downtimeStats.length > 0 ? downtimeStats.map((item, idx) => (
                            <div key={item.key} className="group">
                                <div className="flex justify-between items-end mb-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center text-[10px] font-black text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                                            {idx + 1}
                                        </div>
                                        <div>
                                            <p className="text-xs font-black text-slate-900 uppercase">{item.name}</p>
                                            <p className="text-[10px] font-bold text-slate-400">{item.qty} ocorrências • Média {item.avgMinutes} min</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-slate-900">{item.hours}h</p>
                                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Tempo Total</p>
                                    </div>
                                </div>
                                <div className="h-2 w-full bg-slate-50 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-amber-500 group-hover:bg-indigo-500 transition-all duration-1000"
                                        style={{ width: `${(item.hours / (downtimeStats[0]?.hours || 1)) * 100}%` }}
                                    />
                                </div>
                            </div>
                        )) : (
                            <div className="h-40 flex items-center justify-center text-slate-300 italic text-xs uppercase font-black">Nenhuma parada registrada</div>
                        )}
                    </div>
                </div>

                {/* Pie Chart of Distribution */}
                <div className="lg:col-span-5 bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100">
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-8 text-center text-indigo-600">Proporção do Tempo Parado</h3>
                    <div className="h-[350px]">
                        {downtimeStats.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={downtimeStats}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={70}
                                        outerRadius={100}
                                        paddingAngle={5}
                                        dataKey="hours"
                                        nameKey="name"
                                    >
                                        {downtimeStats.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip 
                                        contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '16px' }}
                                        itemStyle={{ fontWeight: 900, fontSize: '12px' }}
                                    />
                                    <Legend 
                                        verticalAlign="bottom" 
                                        align="center"
                                        iconType="circle"
                                        wrapperStyle={{ paddingTop: '20px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase' }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-300 italic text-[10px] uppercase font-black">Sem dados</div>
                        )}
                    </div>
                </div>
            </div>
            
            {/* Advice Cards based on deficiencies */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="p-6 bg-red-50 border border-red-100 rounded-[2rem] space-y-2">
                    <div className="w-10 h-10 bg-red-100 rounded-2xl flex items-center justify-center text-red-600 mb-2">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <h4 className="text-xs font-black text-red-900 uppercase tracking-tight">Maior Deficiência</h4>
                    <p className="text-lg font-black text-red-600 truncate">{downtimeStats[0]?.name || '---'}</p>
                    <p className="text-[10px] font-bold text-red-400">Representa {downtimeStats[0] ? ((downtimeStats[0].hours / (downtimeStats.reduce((acc,s)=>acc+s.hours,0)||1)) * 100).toFixed(1) : 0}% das paradas.</p>
                </div>

                <div className="p-6 bg-amber-50 border border-amber-100 rounded-[2rem] space-y-2">
                    <div className="w-10 h-10 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600 mb-2">
                        <Clock className="w-5 h-5" />
                    </div>
                    <h4 className="text-xs font-black text-amber-900 uppercase tracking-tight">Média de Tempo</h4>
                    <p className="text-lg font-black text-amber-600">
                        {downtimeStats.length > 0 ? (downtimeStats.reduce((acc,s)=>acc+s.avgMinutes,0) / downtimeStats.length).toFixed(0) : 0} min
                    </p>
                    <p className="text-[10px] font-bold text-amber-400">Tempo médio por desligamento.</p>
                </div>

                <div className="p-6 bg-indigo-50 border border-indigo-100 rounded-[2rem] space-y-2">
                    <div className="w-10 h-10 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 mb-2">
                        <Activity className="w-5 h-5" />
                    </div>
                    <h4 className="text-xs font-black text-indigo-900 uppercase tracking-tight">Frequência</h4>
                    <p className="text-lg font-black text-indigo-600">
                        {downtimeStats.reduce((acc,s)=>acc+s.qty,0)} paradas
                    </p>
                    <p className="text-[10px] font-bold text-indigo-400">Total de registros no período.</p>
                </div>

                <div className="p-6 bg-slate-900 border border-slate-800 rounded-[2rem] space-y-2 text-white">
                    <div className="w-10 h-10 bg-white/10 rounded-2xl flex items-center justify-center text-indigo-400 mb-2">
                        <Target className="w-5 h-5" />
                    </div>
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-tight">Potencial Ganho</h4>
                    <p className="text-lg font-black text-white">
                        {Math.round(downtimeStats.reduce((acc,s)=>acc+(s.hours * 150), 0))} fardos
                    </p>
                    <p className="text-[10px] font-bold text-slate-500">Produção perdida estimada em paradas.</p>
                </div>
            </div>
        </section>
      </div>

      {/* DETAIL MODAL */}
      {selectedOperation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedOperation(null)} />
            <div className="relative bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-white">
                    <div className="flex items-center gap-4 text-slate-900">
                        <Package className="w-8 h-8 text-indigo-500" />
                        <h2 className="text-2xl font-black uppercase tracking-tight">{OPERATION_LABELS[selectedOperation] || selectedOperation}</h2>
                    </div>
                    <button onClick={() => setSelectedOperation(null)} className="p-3 bg-slate-50 text-slate-400 rounded-full hover:bg-slate-100 hover:text-slate-900 transition-all cursor-pointer">
                        <ArrowLeft className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="p-8 max-h-[70vh] overflow-y-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div>
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Distribuição por Máquina/Operador (Proporcional)</h3>
                            <div className="space-y-3">
                                {useMemo(() => {
                                    const opStats = operationStats.find(s => s.key === selectedOperation);
                                    if (!opStats) return null;
                                    
                                    const totalHours = opStats.hoursActive;
                                    const totalProd = opStats.totalProduction;
                                    const productivity = opStats.productivity; // f/hour

                                    // Calculate individual contributions
                                    const contributions: Record<string, number> = {}; // { forkliftId: seconds }
                                    events.filter(e => e.operationType === selectedOperation).forEach((e, idx, arr) => {
                                        const next = arr.find((nextE, nextIdx) => nextIdx > idx && nextE.forkliftId === e.forkliftId);
                                        const endTime = next ? new Date(next.timestamp).getTime() : new Date().getTime();
                                        const startTime = new Date(e.timestamp).getTime();
                                        const diff = Math.max(0, endTime - startTime) / 1000;
                                        if (e.action !== 'stop') {
                                            contributions[e.forkliftId] = (contributions[e.forkliftId] || 0) + diff;
                                        }
                                    });

                                    return Object.entries(contributions).map(([fid, seconds]) => {
                                        const hours = seconds / 3600;
                                        const shareProd = Math.round(hours * productivity);
                                        return (
                                            <div key={fid} className="flex justify-between items-center p-5 bg-white border border-slate-100 rounded-3xl shadow-sm hover:border-indigo-200 transition-all">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 bg-slate-50 rounded-2xl flex items-center justify-center">
                                                        <Maximize2 className="w-5 h-5 text-slate-400" />
                                                    </div>
                                                    <div>
                                                        <span className="text-xs font-black text-slate-900 block truncate max-w-[120px] uppercase">Ref: {fid.slice(-4)}</span>
                                                        <span className="text-[10px] font-bold text-slate-400 capitalize">{hours.toFixed(1)}h em atividade</span>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-lg font-black text-indigo-600 block">{shareProd} <span className="text-[10px] font-medium opacity-50">f</span></span>
                                                    <span className="text-[8px] font-black text-slate-400 uppercase">Produtividade Est.</span>
                                                </div>
                                            </div>
                                        );
                                    });
                                }, [events, selectedOperation, operationStats])}
                            </div>
                        </div>
                        
                        <div className="space-y-6">
                            <div className="bg-indigo-50 p-8 rounded-[2.5rem] border border-indigo-100">
                                <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-4">Informações de Produtividade</h4>
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-bold text-slate-500">Tempo Total de Máquina</span>
                                        <span className="text-sm font-black text-indigo-900">
                                            {operationStats.find(s => s.key === selectedOperation)?.hoursActive} horas
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-bold text-slate-500">Produtividade Real</span>
                                        <span className="text-sm font-black text-green-600">
                                            {operationStats.find(s => s.key === selectedOperation)?.productivity} fardos/hora
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-bold text-slate-500">Volume Total Acumulado</span>
                                        <span className="text-sm font-black text-indigo-900">
                                            {operationStats.find(s => s.key === selectedOperation)?.totalProduction} fardos
                                        </span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="h-[250px] w-full mt-4">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={[
                                                { name: 'Produtivo', value: operationStats.find(s => s.key === selectedOperation)?.operatedDays || 0 },
                                                { name: 'Inativo', value: operationStats.find(s => s.key === selectedOperation)?.idleDays || 0 }
                                            ]}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            <Cell fill="#4f46e5" />
                                            <Cell fill="#f1f5f9" />
                                        </Pie>
                                        <Tooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                                <p className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Ocupação do Calendário (Dias)</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
