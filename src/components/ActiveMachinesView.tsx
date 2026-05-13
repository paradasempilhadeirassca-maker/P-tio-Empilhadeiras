import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs,
  doc, 
  updateDoc,
  limit
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './Auth';
import { useToast } from './ToastContext';
import { useData } from './DataContext';
import { MaintenanceStop, Forklift, ForkliftStatus } from '../types';
import { Clock, AlertTriangle, Ban, AlertCircle, Wrench, CheckCircle2, Timer, PauseCircle, Search, History as HistoryIcon, PlusCircle } from 'lucide-react';
import { cn, formatDuration, formatDate, formatTime, formatDateTime } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';

export function ActiveMachinesView({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const { profile, loading: authLoading, setQuotaExceeded } = useAuth();
  const { showToast } = useToast();
  const { forklifts, activeStops, refreshGlobalData, loading: dataLoading } = useData();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, setTick] = useState(0);

  const severityGroups = {
    high: activeStops.filter(s => s.severity === 'high'),
    medium: activeStops.filter(s => s.severity === 'medium'),
    low: activeStops.filter(s => s.severity === 'low')
  };

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!authLoading && profile) {
      refreshGlobalData();
    }
  }, [authLoading, profile]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshGlobalData(true);
    setIsRefreshing(false);
  };

  const consolidatedForklifts = React.useMemo(() => {
    // Determine which machines have active maintenance occurrences
    const machineStatusMap = new Map<string, ForkliftStatus>();
    activeStops.forEach(stop => {
      const f = forklifts.find(fork => fork.id === stop.forkliftId);
      if (f?.serialNumber) {
        const serial = f.serialNumber.trim().toLowerCase();
        const severity = stop.severity || 'high';
        const stopStatus = stop.status || 'pending';
        
        let targetStatus: ForkliftStatus = 'available';

        if (stopStatus === 'in_progress') {
          targetStatus = 'maintenance';
        } else if (severity === 'high') {
          targetStatus = 'stopped';
        } else if (severity === 'medium' || severity === 'low' || stopStatus === 'awaiting_parts') {
          targetStatus = 'at_risk';
        }
        
        const existingStatus = machineStatusMap.get(serial);
        // Priority: maintenance > stopped > at_risk > available
        const priority = { maintenance: 4, stopped: 3, at_risk: 2, available: 1, interdicted: 5, external: 5 };
        if (!existingStatus || (priority[targetStatus as keyof typeof priority] || 0) > (priority[existingStatus as keyof typeof priority] || 0)) {
          machineStatusMap.set(serial, targetStatus);
        }
      }
    });

    const fleetMap = new Map<string, Forklift>();
    
    // Sort by createdAt descending
    const sorted = [...forklifts].sort((a, b) => {
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

    return fleetMap;
  }, [forklifts, activeStops]);

  const stats = React.useMemo(() => {
    const total = activeStops.length;
    const high = activeStops.filter(s => s.severity === 'high').length;
    const awaitingParts = activeStops.filter(s => s.status === 'awaiting_parts').length;
    
    const now = Date.now();
    const durations = activeStops.map(s => now - new Date(s.stopTime).getTime());
    const maxDowntime = durations.length > 0 ? Math.max(...durations) : 0;
    
    // Average response time for accepted ones
    const activeOccurrences = activeStops.filter(s => s.status !== 'pending');
    const responseTimes = activeOccurrences.map(s => {
      const stopTime = new Date(s.stopTime).getTime();
      const startTime = new Date(s.startTime!).getTime();
      return startTime - stopTime;
    });
    const avgResponse = responseTimes.length > 0 
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
      : 0;

    return { total, high, awaitingParts, maxDowntime, avgResponse };
  }, [activeStops]);

  function renderOccurrenceCard(stop: MaintenanceStop) {
    // First try finding the specific machine by ID
    const directForklift = forklifts.find(f => f.id === stop.forkliftId);
    
    // Then get the consolidated version using serial number (or ID as fallback)
    const key = (directForklift?.serialNumber || '').trim().toLowerCase() || stop.forkliftId;
    const forklift = consolidatedForklifts.get(key) || directForklift;
    
    const isCritical = stop.severity === 'high';
    const isMedium = stop.severity === 'medium';
    const isAwaitingParts = stop.status === 'awaiting_parts';
    const isPending = stop.status === 'pending';
    
    // Calculate durations
    const now = Date.now();
    const stopTime = new Date(stop.stopTime).getTime();
    let responseTime = stop.startTime ? (new Date(stop.startTime).getTime() - stopTime) : (now - stopTime);
    const downtime = now - stopTime;
    const minutesDowntime = downtime / 60000;

    let partsWaitingTotal = (stop.totalWaitingPartsMinutes || 0) * 60000;
    if (stop.waitingPartsStartTime) {
      partsWaitingTotal += (now - new Date(stop.waitingPartsStartTime).getTime());
    }

    return (
      <div key={stop.id} className={cn(
        "bg-white p-5 rounded-[2.5rem] border-2 transition-all hover:shadow-2xl hover:border-indigo-100 flex flex-col lg:flex-row justify-between lg:items-center gap-6 relative overflow-hidden group",
        isAwaitingParts ? "border-amber-200 bg-amber-50/10" :
        isCritical ? "border-red-100" : 
        isMedium ? "border-amber-100" : 
        "border-slate-100"
      )}>
        {/* Glow effect for critical */}
        {isCritical && (
          <div className="absolute -left-12 -top-12 w-32 h-32 bg-red-500 opacity-[0.03] rounded-full blur-3xl pointer-events-none group-hover:opacity-[0.08] transition-opacity" />
        )}

        <div className="flex items-center gap-5 relative z-10">
          <div className={cn(
            "w-16 h-16 rounded-[1.5rem] flex items-center justify-center shadow-lg relative transition-transform group-hover:scale-105",
            isAwaitingParts ? "bg-amber-600 text-white shadow-amber-200" :
            isCritical ? "bg-red-600 text-white shadow-red-200" : 
            isMedium ? "bg-amber-500 text-white shadow-amber-100" : 
            "bg-blue-600 text-white shadow-blue-100"
          )}>
            {minutesDowntime >= 1440 && (
              <div className="absolute -top-3 -right-2 bg-indigo-600 text-white px-2 py-0.5 rounded-lg text-[8px] font-black whitespace-nowrap shadow-xl border-2 border-white animate-bounce z-20">
                {formatDuration(downtime)}
              </div>
            )}
            {isAwaitingParts ? <PauseCircle className="w-8 h-8" /> :
             isCritical ? <Ban className="w-8 h-8" /> : 
             isMedium ? <AlertTriangle className="w-8 h-8" /> : 
             <Wrench className="w-8 h-8" />}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className="text-xl font-black text-slate-900 tracking-tight leading-none uppercase">
                {forklift?.model || 'MÁQUINA'} <span className="text-blue-600">#{forklift?.serialNumber}</span>
              </h3>
              {isAwaitingParts && (
                <span className="bg-amber-100 text-amber-600 text-[8px] font-black px-2.5 py-1 rounded-full uppercase border border-amber-200">Aguardando Peça</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className={cn(
                "text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest border",
                isCritical ? "bg-red-50 text-red-600 border-red-100" : 
                isMedium ? "bg-amber-50 text-amber-600 border-amber-100" : 
                "bg-blue-50 text-blue-600 border-blue-100"
              )}>
                {isCritical ? 'CRITICAL - QUEBRA' : isMedium ? 'MEDIUM - FALHA' : 'LOW - REPARO'}
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                OP: {stop.operatorName || 'Não ident.'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 lg:px-4">
          <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 h-full relative group/relato">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 leading-none flex items-center gap-2">
              <AlertCircle className="w-3 h-3 text-slate-300" />
              Relato do Problema
            </p>
            <p className="text-sm text-slate-800 font-semibold italic leading-relaxed">
              "{stop.description}"
            </p>
            {stop.pendingPartsList && stop.pendingPartsList.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {stop.pendingPartsList.map((p, i) => (
                  <span key={i} className="text-[8px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md uppercase border border-amber-200">{p}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-5 border-t lg:border-t-0 lg:border-l border-slate-100 pt-4 lg:pt-0 lg:pl-6 shrink-0 z-10">
          <div className="grid grid-cols-2 gap-3 w-full sm:w-auto">
            <div className="bg-white p-3 rounded-2xl border border-slate-100 min-w-[110px] shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Atendimento</span>
                <Clock className="w-3 h-3 text-slate-300" />
              </div>
              <p className={cn(
                "text-sm font-black",
                isPending ? "text-amber-600 animate-pulse" : "text-slate-900"
              )}>{formatDuration(responseTime)}</p>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-slate-100 min-w-[110px] shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Inatividade</span>
                <Timer className="w-3 h-3 text-slate-300" />
              </div>
              <p className="text-sm font-black text-slate-900">{formatDuration(downtime)}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full sm:w-auto">
            <div className={cn(
              "px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest min-w-[120px] text-center border shadow-sm",
              stop.status === 'pending' ? "bg-slate-50 text-slate-400 border-slate-200" : 
              stop.status === 'awaiting_parts' ? "bg-amber-500 text-white border-amber-600" :
              "bg-blue-600 text-white border-blue-700"
            )}>
              {stop.status === 'pending' ? 'PENDENTE' : 
               stop.status === 'awaiting_parts' ? 'EM ESPERA' :
               'EM REPARO'}
            </div>
            {partsWaitingTotal > 0 && (
              <span className="text-[9px] font-black text-amber-600 uppercase tracking-tight flex items-center justify-center gap-1">
                <Timer className="w-3 h-3" />
                Wait: {formatDuration(partsWaitingTotal)}
              </span>
            )}
            
            {onNavigate && (
              <button
                onClick={() => onNavigate('op-register')}
                className="mt-2 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-[9px] font-black uppercase tracking-wider hover:bg-blue-600 hover:text-white transition-all group/btn"
              >
                <PlusCircle className="w-3.5 h-3.5 group-hover/btn:rotate-90 transition-transform" />
                Relatar Novo Problema
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              "p-4 rounded-3xl border border-slate-200 transition-all active:scale-95 group shadow-sm bg-white",
              isRefreshing ? "text-slate-300" : "text-slate-600 hover:bg-slate-50 hover:border-blue-300"
            )}
            title="Atualizar Status"
          >
            <HistoryIcon className={cn("w-6 h-6 transition-transform duration-700", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
          </button>
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-slate-900 rounded-[2rem] flex items-center justify-center shadow-xl shadow-slate-200">
               <AlertTriangle className="w-8 h-8 text-amber-400" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Ocorrências Ativas v2.2</h1>
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">Gestão de prioridade e tempo de resposta</p>
            </div>
          </div>
        </div>
        
        {onNavigate && (
          <button
            onClick={() => onNavigate('op-register')}
            className="bg-blue-600 text-white px-6 py-4 rounded-[1.25rem] font-black text-sm uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center gap-2 shadow-xl shadow-blue-100 whitespace-nowrap"
          >
            <PlusCircle className="w-5 h-5" />
            NOVA OCORRÊNCIA
          </button>
        )}
      </header>

      {/* Analytical Top Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total de Ocorrências', value: stats.total, icon: Wrench, color: 'blue', sub: 'Pendentes ou em curso' },
          { label: 'Paradas Críticas', value: stats.high, icon: Ban, color: 'red', sub: `${Math.round((stats.high / (stats.total || 1)) * 100)}% de severidade` },
          { label: 'Média de Resposta', value: formatDuration(stats.avgResponse), icon: Clock, color: 'indigo', sub: 'Tempo até aceitação' },
          { label: 'Maior Inatividade', value: formatDuration(stats.maxDowntime), icon: Timer, color: 'amber', sub: 'Equipamento mais crítico' },
        ].map((stat, idx) => (
          <div
            key={stat.label}
            className="bg-white p-5 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-center gap-5 hover:shadow-lg transition-all"
          >
            <div className={cn(
              "w-14 h-14 rounded-2xl flex items-center justify-center",
              stat.color === 'blue' ? "bg-blue-50 text-blue-600" :
              stat.color === 'red' ? "bg-red-50 text-red-600" :
              stat.color === 'indigo' ? "bg-indigo-50 text-indigo-600" :
              "bg-amber-50 text-amber-600"
            )}>
              <stat.icon className="w-7 h-7" />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
              <h3 className="text-xl font-black text-slate-900 leading-none mt-1 mb-1">{stat.value}</h3>
              <p className="text-[9px] font-bold text-slate-400 uppercase opacity-70">{stat.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="h-6 w-6 text-slate-300 absolute left-6 top-1/2 -translate-y-1/2" />
        <input 
          type="text" 
          placeholder="PROCURAR MÁQUINA, SÉRIE OU DESCRIÇÃO DO PROBLEMA..."
          className="w-full pl-16 pr-6 py-6 bg-white border-2 border-slate-100 rounded-[2.5rem] text-sm font-black uppercase tracking-widest outline-none focus:ring-8 focus:ring-blue-500/5 focus:border-blue-500 transition-all placeholder:text-slate-200 shadow-sm"
        />
      </div>
      {activeStops.length === 0 ? (
        <div className="bg-white p-16 rounded-[2rem] shadow-sm border border-slate-100 text-center flex flex-col items-center">
          <div className="w-20 h-20 bg-green-50 rounded-3xl flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          </div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight mb-2 uppercase">Sem Ocorrências</h2>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nenhuma máquina parada ou com falha reportada no momento.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {severityGroups.high.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <h2 className="text-[10px] font-black text-red-600 uppercase tracking-[0.2em]">Paradas Críticas ({severityGroups.high.length})</h2>
              </div>
              <div className="grid gap-4">
                {severityGroups.high.map(stop => renderOccurrenceCard(stop))}
              </div>
            </div>
          )}

          {severityGroups.medium.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <h2 className="text-[10px] font-black text-amber-600 uppercase tracking-[0.2em]">Falhas Iminentes ({severityGroups.medium.length})</h2>
              </div>
              <div className="grid gap-4">
                {severityGroups.medium.map(stop => renderOccurrenceCard(stop))}
              </div>
            </div>
          )}

          {severityGroups.low.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em]">Reparos Programados ({severityGroups.low.length})</h2>
              </div>
              <div className="grid gap-4">
                {severityGroups.low.map(stop => renderOccurrenceCard(stop))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
