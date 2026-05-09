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
import { Clock, AlertTriangle, Ban, AlertCircle, Wrench, CheckCircle2, Timer, PauseCircle, History as HistoryIcon } from 'lucide-react';
import { cn, formatDuration } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';

export function ActiveMachinesView() {
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
        const targetStatus: ForkliftStatus = severity === 'high' ? 'stopped' : 'maintenance';
        
        const existingStatus = machineStatusMap.get(serial);
        if (!existingStatus || (existingStatus === 'maintenance' && targetStatus === 'stopped')) {
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

  function renderOccurrenceCard(stop: MaintenanceStop) {
    // First try finding the specific machine by ID
    const directForklift = forklifts.find(f => f.id === stop.forkliftId);
    
    // Then get the consolidated version using serial number (or ID as fallback)
    const key = (directForklift?.serialNumber || '').trim().toLowerCase() || stop.forkliftId;
    const forklift = consolidatedForklifts.get(key) || directForklift;
    
    const isCritical = stop.severity === 'high';
    const isMedium = stop.severity === 'medium';
    const isAwaitingParts = stop.status === 'awaiting_parts';
    
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
        "bg-white p-5 rounded-3xl border-2 transition-all hover:shadow-xl hover:shadow-slate-200/50 flex flex-col lg:flex-row justify-between lg:items-center gap-4",
        isAwaitingParts ? "border-amber-200 bg-amber-50/10 shadow-sm" :
        isCritical ? "border-red-100 hover:border-red-300" : 
        isMedium ? "border-amber-100 hover:border-amber-300" : 
        "border-slate-100 hover:border-blue-300"
      )}>
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm relative",
            isAwaitingParts ? "bg-amber-600 text-white shadow-amber-200" :
            isCritical ? "bg-red-50 text-red-600" : 
            isMedium ? "bg-amber-50 text-amber-600" : 
            "bg-blue-50 text-blue-600"
          )}>
            {minutesDowntime >= 1440 && (
              <div className="absolute -top-3 -right-2 bg-blue-600 text-white px-2 py-0.5 rounded-lg text-[9px] font-black whitespace-nowrap shadow-xl border-2 border-white animate-bounce">
                {formatDuration(downtime)}
              </div>
            )}
            {isAwaitingParts ? <PauseCircle className="w-7 h-7" /> :
             isCritical ? <Ban className="w-7 h-7" /> : 
             isMedium ? <AlertTriangle className="w-7 h-7" /> : 
             <Wrench className="w-7 h-7" />}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-black text-slate-900 tracking-tight leading-none uppercase">
                {forklift?.model || 'MAQ.'} {forklift?.serialNumber}
              </h3>
              {isAwaitingParts && (
                <span className="bg-amber-100 text-amber-600 text-[8px] font-black px-2 py-0.5 rounded uppercase animate-pulse">Aguardando Peça</span>
              )}
            </div>
            <p className="text-[10px] font-black text-slate-400 border border-slate-100 px-2 py-0.5 rounded-lg uppercase tracking-widest inline-block mb-1">
               {isCritical ? 'Q - Quebra Crítica' : isMedium ? 'I - Falha Iminente' : 'R - Reparo Normal'}
            </p>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
              <span className="text-slate-600">{stop.operatorName || 'Operador'}</span> • {new Date(stop.stopTime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        <div className="flex-1 lg:px-4">
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 h-full space-y-2">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 leading-none">Relato do Problema</p>
              <p className="text-sm text-slate-800 font-medium italic leading-relaxed">
                "{stop.description}"
              </p>
            </div>
            {stop.pendingPartsList && stop.pendingPartsList.length > 0 && (
              <div className="border-t border-slate-100 pt-2">
                <p className="text-[8px] font-black text-amber-600 uppercase tracking-widest mb-1">Peças em Aguardo</p>
                <div className="flex flex-wrap gap-1">
                  {stop.pendingPartsList.map((p, i) => (
                    <span key={i} className="text-[9px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg uppercase">{p}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 border-t lg:border-t-0 lg:border-l border-slate-100 pt-4 lg:pt-0 lg:pl-6 shrink-0">
          <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 min-w-[100px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] font-black text-slate-400 uppercase">Tempo Resposta</span>
                <Clock className="w-3 h-3 text-slate-300" />
              </div>
              <p className="text-sm font-black text-slate-900">{formatDuration(responseTime)}</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 min-w-[100px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] font-black text-slate-400 uppercase">Indisponibilidade</span>
                <Timer className="w-3 h-3 text-slate-300" />
              </div>
              <p className="text-sm font-black text-slate-900">{formatDuration(downtime)}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full sm:w-auto text-center">
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em]">Status</span>
            <span className={cn(
              "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest min-w-[100px]",
              stop.status === 'pending' ? "bg-slate-100 text-slate-400" : 
              stop.status === 'awaiting_parts' ? "bg-amber-600 text-white" :
              "bg-blue-500 text-white"
            )}>
              {stop.status === 'pending' ? 'Aguardando' : 
               stop.status === 'awaiting_parts' ? 'Aguardando Peça' :
               'Em Atendimento'}
            </span>
            {partsWaitingTotal > 0 && (
              <span className="text-[9px] font-bold text-amber-600 uppercase tracking-tighter">
                Em espera: {formatDuration(partsWaitingTotal)}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
            <HistoryIcon className={cn("w-5 h-5 transition-transform duration-700", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
          </button>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600 rounded-2xl shadow-xl shadow-blue-100">
               <Wrench className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase leading-tight">Ocorrências</h1>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-wrap">Priorização e atendimento</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-slate-100 p-1 rounded-2xl border border-slate-200">
          <button className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase rounded-xl shadow-lg">Tudo</button>
          <button className="px-4 py-2 text-slate-400 text-[10px] font-black uppercase rounded-xl">Abertas</button>
          <button className="px-4 py-2 text-slate-400 text-[10px] font-black uppercase rounded-xl">Atendimento</button>
        </div>
      </header>

      <div className="relative">
        <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
          <Clock className="h-5 w-5 text-slate-300" />
        </div>
        <input 
          type="text" 
          placeholder="PROCURAR MÁQUINA OU DESCRIÇÃO"
          className="w-full pl-14 pr-6 py-6 bg-slate-50 border-2 border-slate-100 rounded-[2rem] text-xs font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all placeholder:text-slate-300"
        />
        <div className="absolute inset-y-2 right-2 flex items-center">
          <button className="h-full px-6 bg-white border border-slate-100 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-slate-50 transition-colors shadow-sm">Todas Prioridades</button>
        </div>
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
