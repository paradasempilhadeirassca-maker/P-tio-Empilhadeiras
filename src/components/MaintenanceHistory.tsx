import React, { useState, useEffect } from 'react';
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
import { History, Search, Filter, Loader2, ChevronDown } from 'lucide-react';
import { cn, formatDuration, formatDateTime, formatDate, formatTime } from '../lib/utils';

interface MaintenanceHistoryProps {
  role: 'operator' | 'mechanic' | 'manager';
}

export function MaintenanceHistory({ role }: MaintenanceHistoryProps) {
  const { profile, setQuotaExceeded } = useAuth();
  const { forklifts } = useData();
  const [history, setHistory] = useState<MaintenanceStop[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const CACHE_KEY = `maint_history_cache_${role}_${profile?.uid || 'guest'}`;
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
      let qH = query(collection(db, 'maintenance'), orderBy('stopTime', 'desc'), limit(pageSize));
      
      if (role === 'operator') {
        qH = query(collection(db, 'maintenance'), where('operatorId', '==', profile?.uid), orderBy('stopTime', 'desc'), limit(pageSize));
      } else if (role === 'mechanic') {
        qH = query(collection(db, 'maintenance'), where('mechanicId', '==', profile?.uid), orderBy('stopTime', 'desc'), limit(pageSize));
      }

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
  }, [role, profile?.uid]);

  const filteredHistory = history.filter(h => {
    const f = forklifts.find(fork => fork.id === h.forkliftId);
    const searchStr = `${f?.model} ${f?.serialNumber} ${h.description} ${h.repairNotes || ''}`.toLowerCase();
    return searchStr.includes(searchTerm.toLowerCase());
  });

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Histórico de Manutenções</h1>
          <p className="text-slate-500">
            {role === 'manager' ? 'Todos os registros do sistema' : 'Seus registros realizados'}
          </p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
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
              placeholder="Buscar por máquina ou descrição..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 w-full"
            />
          </div>
        </div>
      </header>

      {/* Desktop Table View */}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold">
            <tr>
              <th className="px-6 py-4">Máquina</th>
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
                <td colSpan={9} className="px-6 py-12 text-center text-slate-400 italic">
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
                        <span>{f?.model}</span>
                        <span className="text-xs text-slate-500">{f?.serialNumber}</span>
                      </div>
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
                    <h3 className="font-bold text-slate-900">{f?.model}</h3>
                    <p className="text-xs text-slate-500">{f?.serialNumber}</p>
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

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50">
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tempo Parado</p>
                    <p className="text-sm font-mono font-bold text-slate-700">{formatDuration(totalStopDuration)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tempo Manut.</p>
                    <p className="text-sm font-mono font-bold text-blue-600">{maintenanceDuration > 0 ? formatDuration(maintenanceDuration) : '-'}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Reparo Realizado</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{h.repairNotes || '-'}</p>
                </div>

                {h.parts && h.parts.length > 0 && (
                  <div className="space-y-2">
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
