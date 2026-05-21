import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData
} from 'firebase/firestore';
import { db } from '../firebase';
import { MaintenanceStop, Forklift } from '../types';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { History, Search, Filter, Loader2, ChevronDown, ChevronUp, X, Layers, List } from 'lucide-react';
import { cn, formatDuration, formatDateTime, formatDate, formatTime } from '../lib/utils';

interface MaintenanceHistoryProps {
  role: 'operator' | 'mechanic' | 'manager';
}

export function MaintenanceHistory({ role }: MaintenanceHistoryProps) {
  const { profile, setQuotaExceeded } = useAuth();
  const { forklifts, uniqueForklifts, operators } = useData();
  const [history, setHistory] = useState<MaintenanceStop[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Grouping & Expansion states
  const [isGroupedByMachine, setIsGroupedByMachine] = useState(true);
  const [expandedMachines, setExpandedMachines] = useState<Record<string, boolean>>({});

  const toggleMachineExpand = (machineId: string) => {
    setExpandedMachines(prev => ({
      ...prev,
      [machineId]: !prev[machineId]
    }));
  };

  // New Filter States
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterForkliftId, setFilterForkliftId] = useState('');
  const [filterOperatorId, setFilterOperatorId] = useState('');

  const CACHE_KEY = `maint_history_cache_all_v2`;
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  const fetchData = async (isLoadMore = false) => {
    if (loading || isRefreshing) return;
    
    setIsRefreshing(!isLoadMore);
    setLoading(isLoadMore);

    try {
      if (!isLoadMore) {
        // Tentar Cache
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_DURATION) {
            setHistory(data);
            if (!isRefreshing) {
               setIsRefreshing(false);
               setLoading(false);
            }
          }
        }
      }

      const pageSize = 50;
      // All users see general list of maintenance, so do not restrict by user role or operatorId
      let qH = query(collection(db, 'maintenance'), orderBy('stopTime', 'desc'), limit(pageSize));
      
      if (isLoadMore && lastDoc) {
        qH = query(qH, startAfter(lastDoc));
      }

      const hSnap = await getDocs(qH);
      const newData = hSnap.docs.map(d => ({ id: d.id, ...d.data() } as MaintenanceStop));
      
      let finalData: MaintenanceStop[];
      if (isLoadMore) {
        finalData = [...history, ...newData];
        setHistory(finalData);
      } else {
        finalData = newData;
        setHistory(finalData);
      }

      setLastDoc(hSnap.docs[hSnap.docs.length - 1] || null);
      setHasMore(hSnap.docs.length === pageSize);

      // Save to Cache
      if (!isLoadMore) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          data: finalData,
          timestamp: Date.now()
        }));
      }

    } catch (error: any) {
      if (error?.code === 'resource-exhausted' || error?.message?.includes('Quota exceeded')) {
        setQuotaExceeded(true);
      }
      console.error("Fetch Maintenance Error:", error);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile?.uid]);

  // Extract unique operator list from history to combine with useData().operators
  const availableOperators = useMemo(() => {
    const operatorMap = new Map<string, string>();
    
    // Add known operators from DataContext
    operators.forEach(o => {
      const name = o.displayName || o.email?.split('@')[0] || '';
      if (name) {
        operatorMap.set(o.uid, name);
      }
    });

    // Add actual operators found in maintenance history to never miss anyone
    history.forEach(h => {
      if (h.operatorId && h.operatorName) {
        operatorMap.set(h.operatorId, h.operatorName);
      } else if (h.operatorName) {
        operatorMap.set(h.operatorName, h.operatorName);
      }
      if (h.operatorNames) {
        h.operatorNames.forEach((name, idx) => {
          const id = h.operatorIds?.[idx] || name;
          operatorMap.set(id, name);
        });
      }
    });

    return Array.from(operatorMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [operators, history]);

  // Extract unique machines list from history and forklifts list
  const availableForklifts = useMemo(() => {
    const forkliftMap = new Map<string, { model: string, serialNumber: string }>();

    // Add known forklifts from context
    forklifts.forEach(f => {
      forkliftMap.set(f.id, { model: f.model || '', serialNumber: f.serialNumber || '' });
    });

    // Add from history in case database references don't match
    history.forEach(h => {
      if (h.forkliftId && !forkliftMap.has(h.forkliftId)) {
        forkliftMap.set(h.forkliftId, { model: 'Máquina', serialNumber: h.forkliftId });
      }
    });

    return Array.from(forkliftMap.entries())
      .map(([id, info]) => ({
        id,
        model: info.model,
        serialNumber: info.serialNumber
      }))
      .sort((a, b) => (a.serialNumber || '').localeCompare(b.serialNumber || ''));
  }, [forklifts, history]);

  const filteredHistory = useMemo(() => {
    return history.filter(h => {
      const f = forklifts.find(fork => fork.id === h.forkliftId);
      
      // 1. Text Search
      if (searchTerm) {
        const searchStr = `${f?.model || ''} ${f?.serialNumber || ''} ${h.description || ''} ${h.repairNotes || ''}`.toLowerCase();
        if (!searchStr.includes(searchTerm.toLowerCase())) {
          return false;
        }
      }

      // 2. Machine Filter
      if (filterForkliftId) {
        if (h.forkliftId !== filterForkliftId) {
          const forkliftObj = forklifts.find(fork => fork.id === filterForkliftId);
          if (forkliftObj) {
            const matchById = h.forkliftId === forkliftObj.id;
            const matchBySerial = h.forkliftId === forkliftObj.serialNumber;
            if (!matchById && !matchBySerial) {
              return false;
            }
          } else {
            return false;
          }
        }
      }

      // 3. Operator Filter
      if (filterOperatorId) {
        const matchesOperator = 
          h.operatorId === filterOperatorId || 
          h.operatorName === filterOperatorId ||
          h.operatorIds?.includes(filterOperatorId) ||
          h.operatorNames?.includes(filterOperatorId);
        
        if (!matchesOperator) return false;
      }

      // 4. Date Filters
      if (filterStartDate) {
        const recordDateStr = h.stopTime.slice(0, 10); // YYYY-MM-DD
        if (recordDateStr < filterStartDate) return false;
      }
      if (filterEndDate) {
        const recordDateStr = h.stopTime.slice(0, 10); // YYYY-MM-DD
        if (recordDateStr > filterEndDate) return false;
      }

      return true;
    });
  }, [history, forklifts, searchTerm, filterForkliftId, filterOperatorId, filterStartDate, filterEndDate]);

  const groupedHistory = useMemo(() => {
    const groups: Record<string, { forklift: Forklift | undefined; records: MaintenanceStop[] }> = {};
    
    filteredHistory.forEach(h => {
      const key = h.forkliftId || 'Desconhecido';
      if (!groups[key]) {
        const f = forklifts.find(fork => fork.id === key);
        groups[key] = {
          forklift: f,
          records: []
        };
      }
      groups[key].records.push(h);
    });

    return Object.entries(groups)
      .map(([forkliftId, group]) => ({
        forkliftId,
        forklift: group.forklift,
        records: group.records
      }))
      .sort((a, b) => {
        const serialA = a.forklift?.serialNumber || a.forkliftId || '';
        const serialB = b.forklift?.serialNumber || b.forkliftId || '';
        return serialA.localeCompare(serialB, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [filteredHistory, forklifts]);

  const hasActiveFilters = filterStartDate || filterEndDate || filterForkliftId || filterOperatorId || searchTerm;

  const handleClearFilters = () => {
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterForkliftId('');
    setFilterOperatorId('');
    setSearchTerm('');
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Histórico de Manutenções</h1>
          <p className="text-slate-500">
            Todos os registros do sistema para todos os operadores
          </p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <button
            onClick={() => setIsGroupedByMachine(prev => !prev)}
            className={cn(
              "px-4 py-2 rounded-xl border transition-all flex items-center gap-2 text-sm font-medium",
              isGroupedByMachine 
                ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" 
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            )}
            title={isGroupedByMachine ? "Mudar para visualização em lista simples" : "Agrupar manutenções por máquina"}
          >
            {isGroupedByMachine ? <Layers className="w-4 h-4" /> : <List className="w-4 h-4" />}
            <span>{isGroupedByMachine ? "Agrupado" : "Lista Plana"}</span>
          </button>
          <button
            onClick={() => fetchData()}
            disabled={isRefreshing}
            className={cn(
              "px-4 py-2 rounded-xl border border-slate-200 transition-all flex items-center gap-2",
              isRefreshing ? "bg-slate-50 text-slate-300" : "bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <History className="w-4 h-4" />}
            <span className="text-sm font-medium">Atualizar</span>
          </button>
          <div className="relative flex-1 md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Buscar por descrição ou código..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 w-full"
            />
          </div>
        </div>
      </header>

      {/* Elegant Filters Group Grid */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-bold text-slate-700">Filtros de Pesquisa</span>
          </div>
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="text-xs text-red-600 hover:text-red-700 font-bold flex items-center gap-1 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg transition-all"
            >
              <X className="w-3.5 h-3.5" />
              Limpar Filtros
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Machine selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Máquina (Frota)</label>
            <select
              value={filterForkliftId}
              onChange={(e) => setFilterForkliftId(e.target.value)}
              className="w-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
            >
              <option value="">Todas as Máquinas</option>
              {availableForklifts.map(f => (
                <option key={f.id} value={f.id}>
                  {f.serialNumber || 'S/N'} {f.model ? `(${f.model})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Operator selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Operador</label>
            <select
              value={filterOperatorId}
              onChange={(e) => setFilterOperatorId(e.target.value)}
              className="w-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
            >
              <option value="">Todos os Operadores</option>
              {availableOperators.map(op => (
                <option key={op.id} value={op.id}>
                  {op.name}
                </option>
              ))}
            </select>
          </div>

          {/* Start Date */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Data Inicial</label>
            <input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="w-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
            />
          </div>

          {/* End Date */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Data Final</label>
            <input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="w-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
            />
          </div>
        </div>
      </div>

      {isGroupedByMachine ? (
        <div className="space-y-4">
          {groupedHistory.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 italic shadow-sm">
              Nenhum registro de manutenção encontrado para o filtro atual.
            </div>
          ) : (
            groupedHistory.map(group => {
              const f = group.forklift;
              const isExpanded = !!expandedMachines[group.forkliftId];
              const totalRecords = group.records.length;
              
              const anyInProgress = group.records.some(r => r.status === 'in_progress');
              const anyWaiting = group.records.some(r => r.status === 'awaiting_parts');
              
              const latestDate = group.records[0]?.stopTime || '';
              
              return (
                <div 
                  key={group.forkliftId} 
                  className={cn(
                    "bg-white rounded-2xl border transition-all duration-200 overflow-hidden shadow-sm",
                    isExpanded ? "border-blue-500 ring-2 ring-blue-500/5 pb-2" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  {/* Group Header Card */}
                  <div 
                    onClick={() => toggleMachineExpand(group.forkliftId)}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer select-none bg-slate-50/50 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-4 text-left">
                      {/* Machine Badge */}
                      <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex flex-col items-center justify-center text-blue-700 shrink-0">
                        <span className="text-[9px] font-black leading-none uppercase text-blue-500">FROTA</span>
                        <span className="text-sm font-black leading-tight tracking-tight text-blue-800">
                          {(f?.serialNumber || group.forkliftId).slice(-4)}
                        </span>
                      </div>
                      
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-extrabold text-slate-900 text-base">
                            Frota: {f?.serialNumber || 'S/N'}
                          </h3>
                          {f?.model && (
                            <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-lg border border-slate-200 font-bold">
                              {f.model}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 font-semibold mt-0.5">
                          ID: <span className="font-mono text-[11px] text-slate-550">{group.forkliftId}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-left">
                      {/* Records Count Badge */}
                      <div className="text-left w-20">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Registros</p>
                        <span className="text-xs font-bold text-slate-700">{totalRecords} {totalRecords === 1 ? 'registro' : 'registros'}</span>
                      </div>

                      {/* Latest Date */}
                      {latestDate && (
                        <div className="text-left hidden xs:block w-24">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Última Parada</p>
                          <span className="text-xs font-bold text-slate-600">{formatDate(latestDate)}</span>
                        </div>
                      )}

                      {/* Group Maintenance Status Badge */}
                      <div className="text-left w-28">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Status Máquina</p>
                        {anyInProgress ? (
                          <span className="inline-flex text-[9px] font-extrabold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100 uppercase tracking-wide">
                            Em Manut.
                          </span>
                        ) : anyWaiting ? (
                          <span className="inline-flex text-[9px] font-extrabold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-100 uppercase tracking-wide">
                            Ag. Peça
                          </span>
                        ) : (
                          <span className="inline-flex text-[9px] font-extrabold text-green-600 bg-green-50 px-2.5 py-0.5 rounded-full border border-green-100 uppercase tracking-wide">
                            Sem Pendência
                          </span>
                        )}
                      </div>

                      {/* Expand Action Icon */}
                      <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 shadow-sm hover:border-slate-300">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>

                  {/* Group Body (Sub-records) */}
                  {isExpanded && (
                    <div className="border-t border-slate-105 bg-slate-50/20">
                      {/* Desktop sub-table */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 text-slate-500 uppercase text-[9px] font-black border-b border-slate-150">
                            <tr>
                              <th className="px-6 py-3">Operador</th>
                              <th className="px-6 py-3">Status</th>
                              <th className="px-6 py-3">Gravidade</th>
                              <th className="px-6 py-3">Parada</th>
                              <th className="px-6 py-3">Início Manut.</th>
                              <th className="px-6 py-3">Finalização</th>
                              <th className="px-6 py-3">Tempo de Parada</th>
                              <th className="px-6 py-3">Tempo de Manut.</th>
                              <th className="px-6 py-3">Reparo Realizado</th>
                              <th className="px-6 py-3">Peças Trocadas</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {group.records.map(h => {
                              const totalStopDuration = h.endTime ? new Date(h.endTime).getTime() - new Date(h.stopTime).getTime() : Date.now() - new Date(h.stopTime).getTime();
                              const maintenanceDuration = h.endTime && h.startTime ? new Date(h.endTime).getTime() - new Date(h.startTime).getTime() : (h.startTime ? Date.now() - new Date(h.startTime).getTime() : 0);
                              
                              return (
                                <tr key={h.id} className="hover:bg-slate-50/50 transition-colors text-xs">
                                  <td className="px-6 py-3.5">
                                    <span className="font-bold text-slate-700">
                                      {h.operatorName || h.operatorNames?.join(', ') || 'Sistema'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-3.5">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${h.status === 'completed' ? 'bg-green-50 text-green-600' : h.status === 'in_progress' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                                      {h.status === 'completed' ? 'Concluída' : h.status === 'in_progress' ? 'Em Manut.' : 'Aguardando'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-3.5">
                                    {h.severity === 'high' ? (
                                      <span className="text-[9px] font-bold text-red-600 bg-red-50/80 px-2 py-0.5 rounded border border-red-100 uppercase tracking-tighter">Parada</span>
                                    ) : h.severity === 'medium' ? (
                                      <span className="text-[9px] font-bold text-amber-600 bg-amber-50/80 px-2 py-0.5 rounded border border-amber-100 uppercase tracking-tighter">Risco</span>
                                    ) : (
                                      <span className="text-[9px] font-bold text-blue-600 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-100 uppercase tracking-tighter">Reparo</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-3.5 text-slate-500 leading-tight">
                                    {formatDateTime(h.stopTime)}
                                  </td>
                                  <td className="px-6 py-3.5 text-slate-500 leading-tight">
                                    {h.startTime ? formatDateTime(h.startTime) : '-'}
                                  </td>
                                  <td className="px-6 py-3.5 text-slate-500 leading-tight">
                                    {h.endTime ? formatDateTime(h.endTime) : '-'}
                                  </td>
                                  <td className="px-6 py-3.5 font-mono font-bold text-slate-700">
                                    {formatDuration(totalStopDuration)}
                                  </td>
                                  <td className="px-6 py-3.5 font-mono font-bold text-blue-600">
                                    {maintenanceDuration > 0 ? formatDuration(maintenanceDuration) : '-'}
                                  </td>
                                  <td className="px-6 py-3.5">
                                    <p className="text-slate-600 max-w-[180px] line-clamp-2" title={h.repairNotes}>
                                      {h.repairNotes || '-'}
                                    </p>
                                  </td>
                                  <td className="px-6 py-3.5">
                                    {h.parts && h.parts.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {h.parts.map((p, i) => (
                                          <span key={i} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                                            {p.quantity}x {p.name}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-slate-300 italic">Nenhuma</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile sub-cards */}
                      <div className="md:hidden p-4 space-y-3 bg-slate-50/40">
                        {group.records.map(h => {
                          const totalStopDuration = h.endTime ? new Date(h.endTime).getTime() - new Date(h.stopTime).getTime() : Date.now() - new Date(h.stopTime).getTime();
                          const maintenanceDuration = h.endTime && h.startTime ? new Date(h.endTime).getTime() - new Date(h.startTime).getTime() : (h.startTime ? Date.now() - new Date(h.startTime).getTime() : 0);
                          
                          return (
                            <div key={h.id} className="bg-white p-4 rounded-xl border border-slate-150 space-y-3 shadow-sm text-left">
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Operador</span>
                                  <span className="text-xs font-bold text-slate-800">
                                    {h.operatorName || h.operatorNames?.join(', ') || 'Sistema'}
                                  </span>
                                </div>
                                <div className="flex gap-1.5">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${h.status === 'completed' ? 'bg-green-50 text-green-600' : h.status === 'in_progress' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                                    {h.status === 'completed' ? 'Concluída' : h.status === 'in_progress' ? 'Manual' : 'Aguard.'}
                                  </span>
                                  {h.severity === 'high' ? (
                                    <span className="text-[8px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100 uppercase">Parada</span>
                                  ) : h.severity === 'medium' ? (
                                    <span className="text-[8px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 uppercase">Risco</span>
                                  ) : (
                                    <span className="text-[8px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 uppercase">Reparo</span>
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3 border-t border-slate-50 pt-2.5">
                                <div>
                                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Tempo Parado</p>
                                  <p className="text-xs font-mono font-bold text-slate-700">{formatDuration(totalStopDuration)}</p>
                                </div>
                                <div>
                                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Tempo Manut.</p>
                                  <p className="text-xs font-mono font-bold text-blue-600">{maintenanceDuration > 0 ? formatDuration(maintenanceDuration) : '-'}</p>
                                </div>
                              </div>

                              <div className="border-t border-slate-105 pt-2.5">
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Reparo Realizado</p>
                                <p className="text-xs text-slate-600 leading-relaxed">{h.repairNotes || '-'}</p>
                              </div>

                              {h.parts && h.parts.length > 0 && (
                                <div className="border-t border-slate-105 pt-2.5 space-y-1">
                                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Peças</p>
                                  <div className="flex flex-wrap gap-1">
                                    {h.parts.map((p, i) => (
                                      <span key={i} className="text-[8px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                                        {p.quantity}x {p.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="pt-2 border-t border-slate-105 flex justify-between text-[9px] text-slate-400 font-semibold uppercase tracking-tight">
                                <span>Parada: {formatDate(h.stopTime)}</span>
                                <span>Fim: {h.endTime ? formatDate(h.endTime) : '-'}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold">
                <tr>
                  <th className="px-6 py-4">Máquina</th>
                  <th className="px-6 py-4">Operador</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Gravidade</th>
                  <th className="px-6 py-4">Parada</th>
                  <th className="px-6 py-4">Início Manut.</th>
                  <th className="px-6 py-4">Finalização</th>
                  <th className="px-6 py-4">Tempo Parado</th>
                  <th className="px-6 py-4">Tempo Manut.</th>
                  <th className="px-6 py-4">Reparo Realizado</th>
                  <th className="px-6 py-4">Peças Trocadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-slate-400 italic">
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map(h => {
                    const f = forklifts.find(fork => fork.id === h.forkliftId);
                    const totalStopDuration = h.endTime ? new Date(h.endTime).getTime() - new Date(h.stopTime).getTime() : Date.now() - new Date(h.stopTime).getTime();
                    const maintenanceDuration = h.endTime && h.startTime ? new Date(h.endTime).getTime() - new Date(h.startTime).getTime() : (h.startTime ? Date.now() - new Date(h.startTime).getTime() : 0);
                    
                    return (
                      <tr key={h.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-bold text-slate-900">
                          <div className="flex flex-col">
                            <span className="text-slate-800 font-extrabold">{f?.serialNumber || 'S/N'}</span>
                            <span className="text-xs text-slate-450 font-medium">{f?.model}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs text-slate-700 font-bold">
                            {h.operatorName || h.operatorNames?.join(', ') || 'Sistema'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${h.status === 'completed' ? 'bg-green-50 text-green-600' : h.status === 'in_progress' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                            {h.status === 'completed' ? 'Concluída' : h.status === 'in_progress' ? 'Em Manut.' : 'Aguardando'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {h.severity === 'high' ? (
                            <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg border border-red-100 uppercase tracking-tighter">Parada</span>
                          ) : h.severity === 'medium' ? (
                            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100 uppercase tracking-tighter">Risco</span>
                          ) : (
                            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100 uppercase tracking-tighter">Reparo</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-[11px] text-slate-500 leading-tight">
                          {formatDateTime(h.stopTime)}
                        </td>
                        <td className="px-6 py-4 text-[11px] text-slate-500 leading-tight">
                          {h.startTime ? formatDateTime(h.startTime) : '-'}
                        </td>
                        <td className="px-6 py-4 text-[11px] text-slate-500 leading-tight">
                          {h.endTime ? formatDateTime(h.endTime) : '-'}
                        </td>
                        <td className="px-6 py-4 text-sm font-mono font-bold text-slate-700">
                          {formatDuration(totalStopDuration)}
                        </td>
                        <td className="px-6 py-4 text-sm font-mono font-bold text-blue-600">
                          {maintenanceDuration > 0 ? formatDuration(maintenanceDuration) : '-'}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-xs text-slate-600 max-w-[200px] line-clamp-2" title={h.repairNotes}>
                            {h.repairNotes || '-'}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          {h.parts && h.parts.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {h.parts.map((p, i) => (
                                <span key={i} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                                  {p.quantity}x {p.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-300 italic">Nenhuma</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {filteredHistory.length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 italic">
                Nenhum registro encontrado.
              </div>
            ) : (
              filteredHistory.map(h => {
                const f = forklifts.find(fork => fork.id === h.forkliftId);
                const totalStopDuration = h.endTime ? new Date(h.endTime).getTime() - new Date(h.stopTime).getTime() : Date.now() - new Date(h.stopTime).getTime();
                const maintenanceDuration = h.endTime && h.startTime ? new Date(h.endTime).getTime() - new Date(h.startTime).getTime() : (h.startTime ? Date.now() - new Date(h.startTime).getTime() : 0);
                
                return (
                  <div key={h.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-extrabold text-slate-900 text-sm">Frota: {f?.serialNumber || 'S/N'}</h3>
                        <p className="text-xs text-slate-450 font-medium">{f?.model}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${h.status === 'completed' ? 'bg-green-50 text-green-600' : h.status === 'in_progress' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                          {h.status === 'completed' ? 'Concluída' : h.status === 'in_progress' ? 'Em Manut.' : 'Aguardando'}
                        </span>
                        {h.severity === 'high' ? (
                          <span className="text-[8px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100 uppercase tracking-tighter">Parada</span>
                        ) : h.severity === 'medium' ? (
                          <span className="text-[8px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100 uppercase tracking-tighter">Risco</span>
                        ) : (
                          <span className="text-[8px] font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-100 uppercase tracking-tighter">Reparo</span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50 font-sans">
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tempo Parado</p>
                        <p className="text-sm font-mono font-bold text-slate-700">{formatDuration(totalStopDuration)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tempo Manut.</p>
                        <p className="text-sm font-mono font-bold text-blue-600">{maintenanceDuration > 0 ? formatDuration(maintenanceDuration) : '-'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t border-slate-50 pt-3">
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Operador</p>
                        <p className="text-xs font-bold text-slate-700">{h.operatorName || h.operatorNames?.join(', ') || 'Sistema'}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Reparo Realizado</p>
                        <p className="text-xs text-slate-600 line-clamp-2" title={h.repairNotes}>{h.repairNotes || '-'}</p>
                      </div>
                    </div>

                    {h.parts && h.parts.length > 0 && (
                      <div className="space-y-2 pt-3 border-t border-slate-50">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Peças</p>
                        <div className="flex flex-wrap gap-1">
                          {h.parts.map((p, i) => (
                            <span key={i} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                              {p.quantity}x {p.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="pt-4 border-t border-slate-50 flex justify-between text-[10px] text-slate-400 font-medium">
                      <span>Parada: {formatDate(h.stopTime)}</span>
                      <span>Fim: {h.endTime ? formatDate(h.endTime) : '-'}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
            Carregar mais registros
          </button>
        </div>
      )}
    </div>
  );
}
