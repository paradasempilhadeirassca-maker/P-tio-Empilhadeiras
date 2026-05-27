import React, { useState, useEffect } from 'react';
import * as Firestore from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './Auth';
import { useToast } from './ToastContext';
import { useData } from './DataContext';
import { Forklift, MaintenanceStop, Part, InventoryPart, OccurrenceSeverity, ForkliftStatus } from '../types';
import { 
  Wrench, 
  Play, 
  CheckCircle2, 
  Plus, 
  Trash2, 
  ArrowLeft, 
  Clock, 
  AlertTriangle, 
  Ban, 
  Search,
  Timer,
  ChevronRight,
  User,
  PauseCircle,
  History
} from 'lucide-react';
import { cn, formatDuration } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';
import { sendWhatsAppNotification } from '../lib/notifications';

// Helper to calculate minutes between two dates
const diffInMinutes = (t1: string | Date | any, t2: string | Date | any) => {
  const getTime = (val: any) => {
    if (!val) return Date.now();
    if (typeof val === 'string') return new Date(val).getTime();
    if (val.toDate) return val.toDate().getTime();
    if (val.seconds) return val.seconds * 1000;
    return Date.now();
  };
  const d1 = getTime(t1);
  const d2 = getTime(t2);
  return Math.max(0, Math.floor((d2 - d1) / 60000));
};

const formatDateSafe = (val: any) => {
  if (!val) return '-';
  if (typeof val === 'string') return new Date(val).toLocaleString();
  if (val.toDate) return val.toDate().toLocaleString();
  if (val.seconds) return new Date(val.seconds * 1000).toLocaleString();
  return '-';
};

import { CACHE_KEYS, CACHE_DURATION } from '../constants/cacheKeys';

export function MechanicView() {
  const { profile, loading: authLoading, setQuotaExceeded } = useAuth();
  const { showToast } = useToast();
  const { refreshGlobalData } = useData();
  const [forklifts, setForklifts] = useState<Forklift[]>([]);
  const [activeStops, setActiveStops] = useState<MaintenanceStop[]>([]);
  const [inventoryParts, setInventoryParts] = useState<InventoryPart[]>([]);
  const [selectedStop, setSelectedStop] = useState<MaintenanceStop | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(new Date());

  // Filters
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'in_progress'>('all');
  const [filterSeverity, setFilterSeverity] = useState<'all' | OccurrenceSeverity>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Part form state
  const [partName, setPartName] = useState('');
  const [partQty, setPartQty] = useState(1);
  const [isReplaced, setIsReplaced] = useState(true);
  const [hourMeter, setHourMeter] = useState<number | ''>('');
  const [approverName, setApproverName] = useState('');
  const [repairNotes, setRepairNotes] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedPartId, setSelectedPartId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000); // 30s refresh for live timers
    return () => clearInterval(timer);
  }, []);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async (force = false) => {
    if (!profile) return;
    setIsRefreshing(true);
    
    // 1. Try Loading from Cache
    const M_CACHE_KEY = CACHE_KEYS.MAINTENANCE;
    const F_CACHE_KEY = CACHE_KEYS.FORKLIFTS;
    const I_CACHE_KEY = CACHE_KEYS.INVENTORY;
    
    if (!force) {
      const cachedM = localStorage.getItem(M_CACHE_KEY);
      const cachedF = localStorage.getItem(F_CACHE_KEY);
      const cachedI = localStorage.getItem(I_CACHE_KEY);
      
      if (cachedM && cachedF && cachedI) {
        try {
          const mData = JSON.parse(cachedM);
          const fData = JSON.parse(cachedF);
          const iData = JSON.parse(cachedI);
          
          if (Date.now() - mData.timestamp < CACHE_DURATION && 
              Date.now() - fData.timestamp < CACHE_DURATION &&
              Date.now() - iData.timestamp < CACHE_DURATION) {
            setActiveStops(mData.data);
            setForklifts(fData.data);
            setInventoryParts(iData.data);
            setLoading(false);
            setIsRefreshing(false);
            return;
          }
        } catch (e) {
          localStorage.removeItem(M_CACHE_KEY);
          localStorage.removeItem(F_CACHE_KEY);
          localStorage.removeItem(I_CACHE_KEY);
        }
      }
    }

    try {
      const qF = Firestore.query(Firestore.collection(db, 'forklifts'), Firestore.limit(300));
      const fSnap = await Firestore.getDocs(qF);
      const newForklifts = fSnap.docs.map(d => ({ id: d.id, ...d.data() } as Forklift));
      setForklifts(newForklifts);
      localStorage.setItem(F_CACHE_KEY, JSON.stringify({ data: newForklifts, timestamp: Date.now() }));

      const qS = Firestore.query(
        Firestore.collection(db, 'maintenance'), 
        Firestore.where('status', 'in', ['pending', 'in_progress', 'awaiting_parts']),
        Firestore.limit(100)
      );
      const sSnap = await Firestore.getDocs(qS);
      const newStops = sSnap.docs.map(d => ({ id: d.id, ...d.data() } as MaintenanceStop));
      setActiveStops(newStops);
      localStorage.setItem(M_CACHE_KEY, JSON.stringify({ data: newStops, timestamp: Date.now() }));

      const qI = Firestore.query(Firestore.collection(db, 'parts_inventory'), Firestore.limit(500));
      const iSnap = await Firestore.getDocs(qI);
      const newInv = iSnap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryPart));
      setInventoryParts(newInv);
      localStorage.setItem(I_CACHE_KEY, JSON.stringify({ data: newInv, timestamp: Date.now() }));

    } catch (error: any) {
      if (error?.code === 'resource-exhausted' || error?.message?.includes('Quota exceeded')) {
        setQuotaExceeded(true);
      }
      handleFirestoreError(error, OperationType.LIST, 'forklifts');
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && profile) {
      fetchData();
    }
  }, [authLoading, profile, setQuotaExceeded]);

  const handleRefresh = () => fetchData(true);

  const handleStartMaintenance = async (stop: MaintenanceStop) => {
    if (!profile) return;
    setLoading(true);
    try {
      const startTime = new Date().toISOString();
      const maintenanceRef = Firestore.doc(db, 'maintenance', stop.id);
      const forkliftRef = Firestore.doc(db, 'forklifts', stop.forkliftId);

      await Firestore.updateDoc(maintenanceRef, {
        status: 'in_progress',
        mechanicId: profile.uid,
        startTime: startTime
      });
      
      await Firestore.updateDoc(forkliftRef, {
        status: 'maintenance'
      });

      // Update local state immediately for offline responsiveness
      const updatedStops = activeStops.map(s => 
        s.id === stop.id ? { ...s, status: 'in_progress' as const, mechanicId: profile.uid, startTime } : s
      );
      const updatedForklifts = forklifts.map(f =>
        f.id === stop.forkliftId ? { ...f, status: 'maintenance' as const } : f
      );

      setActiveStops(updatedStops);
      setForklifts(updatedForklifts);

      // Update cache
      localStorage.setItem(CACHE_KEYS.MAINTENANCE, JSON.stringify({ data: updatedStops, timestamp: Date.now() }));
      localStorage.setItem(CACHE_KEYS.FORKLIFTS, JSON.stringify({ data: updatedForklifts, timestamp: Date.now() }));

      showToast('Manutenção iniciada!');

      const forklift = forklifts.find(f => f.id === stop.forkliftId);
      const machineName = forklift ? `${forklift.model} ${forklift.serialNumber}` : 'Máquina';
      
      sendWhatsAppNotification(
        `🔧 *MANUTENÇÃO INICIADA*\n\n` +
        `*Máquina:* ${machineName}\n` +
        `*Mecânico:* ${profile.displayName || profile.email}\n` +
        `*Status:* Em Reparo\n` +
        `*Horário:* ${new Date().toLocaleString('pt-BR')}`
      );
      
      setSelectedStop(prev => prev ? { ...prev, status: 'in_progress', startTime } : null);
    } catch (error) {
      console.error('Error starting maintenance:', error);
      showToast('Erro ao iniciar manutenção.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFinishMaintenance = async (stop: MaintenanceStop) => {
    if (!profile) return;
    
    const hasHm = hourMeter !== '';
    const hmVal = hasHm ? Number(hourMeter) : null;
    if (hasHm && isNaN(hmVal as number)) {
      showToast('Por favor, informe um horímetro válido.', 'error');
      return;
    }
    if (!repairNotes.trim()) {
      showToast('Por favor, descreva o reparo realizado.', 'error');
      return;
    }

    setLoading(true);
    try {
      const endTime = new Date().toISOString();
      const batch = Firestore.writeBatch(db);

      // Inventory deduction logic
      for (const part of parts) {
        if (part.inventoryPartId) {
          const partRef = Firestore.doc(db, 'parts_inventory', part.inventoryPartId);
          batch.update(partRef, {
            quantity: Firestore.increment(-part.quantity),
            lastUpdated: endTime
          });
          
          const historyRef = Firestore.doc(Firestore.collection(db, 'parts_inventory_history'));
          batch.set(historyRef, {
            partId: part.inventoryPartId,
            partName: part.name,
            type: 'deduction',
            quantityChange: -part.quantity,
            reason: `Manutenção finalizada: ${stop.forkliftId}`,
            userId: profile.uid,
            userName: profile.displayName || profile.email,
            timestamp: endTime
          });
        }
      }

      const maintenanceUpdates: any = {
        status: 'completed',
        endTime: endTime,
        approverName: approverName.trim(),
        repairNotes: repairNotes.trim(),
        parts: parts
      };
      if (hmVal !== null) {
        maintenanceUpdates.hourMeter = hmVal;
      }

      batch.update(Firestore.doc(db, 'maintenance', stop.id), maintenanceUpdates);

      // DETERMINING NEW STATUS
      // Exclude current stop as it's completing
      const otherStops = activeStops.filter(s => s.id !== stop.id && s.forkliftId === stop.forkliftId);
      let targetStatus: ForkliftStatus = 'available';

      if (otherStops.length > 0) {
        const hasInProgress = otherStops.some(s => s.status === 'in_progress');
        const hasHighSeverity = otherStops.some(s => (s.severity || 'high') === 'high' && s.status !== 'in_progress');
        
        if (hasInProgress) {
          targetStatus = 'maintenance';
        } else if (hasHighSeverity) {
          targetStatus = 'stopped';
        } else {
          targetStatus = 'at_risk';
        }
      }

      const forkliftUpdates: any = {
        status: targetStatus,
        lastMaintenance: endTime,
        lastHourMeterUpdate: endTime
      };
      if (hmVal !== null) {
        forkliftUpdates.lastHourMeter = hmVal;
      }

      batch.update(Firestore.doc(db, 'forklifts', stop.forkliftId), forkliftUpdates);

      await batch.commit();

      // Update local state
      const updatedStops = activeStops.filter(s => s.id !== stop.id);
      const updatedForklifts = forklifts.map(f =>
        f.id === stop.forkliftId 
          ? { 
              ...f, 
              status: targetStatus, 
              lastMaintenance: endTime, 
              ...(hmVal !== null ? { lastHourMeter: hmVal } : {}) 
            } 
          : f
      );

      setActiveStops(updatedStops);
      setForklifts(updatedForklifts);

      // Update cache
      localStorage.setItem(CACHE_KEYS.MAINTENANCE, JSON.stringify({ data: updatedStops, timestamp: Date.now() }));
      localStorage.setItem(CACHE_KEYS.FORKLIFTS, JSON.stringify({ data: updatedForklifts, timestamp: Date.now() }));

      refreshGlobalData(true);
      showToast('Manutenção finalizada!');
      
      setSelectedStop(null);
      setParts([]);
      setHourMeter('');
      setApproverName('');
      setRepairNotes('');

      const forklift = forklifts.find(f => f.id === stop.forkliftId);
      const machineName = forklift ? `${forklift.model} ${forklift.serialNumber}` : 'Máquina';
      sendWhatsAppNotification(`✅ *MANUTENÇÃO CONCLUÍDA*\n\nMáquina: ${machineName}\nStatus: Disponível\nNotas: ${repairNotes}`);

    } catch (error) {
      console.error('Erro ao finalizar:', error);
      showToast('Erro ao finalizar manutenção.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePauseForParts = async (stop: MaintenanceStop, pieces: string) => {
    if (!pieces || !pieces.trim()) {
      showToast('Por favor, informe quais peças estão faltando.', 'error');
      return;
    }

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const maintenanceRef = Firestore.doc(db, 'maintenance', stop.id);
      const forkliftRef = Firestore.doc(db, 'forklifts', stop.forkliftId);

      await Firestore.updateDoc(maintenanceRef, {
        status: 'awaiting_parts',
        waitingPartsStartTime: nowIso,
        pendingPartsList: pieces.split(',').map(p => p.trim())
      });

      // DETERMINING NEW STATUS
      // Treat current stop as awaiting_parts (which maps to at_risk)
      const otherStops = activeStops.filter(s => s.id !== stop.id && s.forkliftId === stop.forkliftId);
      let targetStatus: ForkliftStatus = 'at_risk';

      if (otherStops.length > 0) {
        const hasInProgress = otherStops.some(s => s.status === 'in_progress');
        const hasHighSeverity = otherStops.some(s => (s.severity || 'high') === 'high' && s.status !== 'in_progress');
        
        if (hasInProgress) {
          targetStatus = 'maintenance';
        } else if (hasHighSeverity) {
          targetStatus = 'stopped';
        }
      }

      await Firestore.updateDoc(forkliftRef, {
        status: targetStatus
      });

      // Update local state immediately for offline responsiveness
      const piecesList = pieces.split(',').map(p => p.trim());
      const updatedStops = activeStops.map(s => 
        s.id === stop.id ? { ...s, status: 'awaiting_parts' as const, waitingPartsStartTime: nowIso, pendingPartsList: piecesList } : s
      );
      const updatedForklifts = forklifts.map(f =>
        f.id === stop.forkliftId ? { ...f, status: targetStatus } : f
      );

      setActiveStops(updatedStops);
      setForklifts(updatedForklifts);

      // Update cache
      localStorage.setItem(CACHE_KEYS.MAINTENANCE, JSON.stringify({ data: updatedStops, timestamp: Date.now() }));
      localStorage.setItem(CACHE_KEYS.FORKLIFTS, JSON.stringify({ data: updatedForklifts, timestamp: Date.now() }));

      showToast('Status alterado: Aguardando Peças');
      setSelectedStop(prev => prev ? { 
        ...prev, 
        status: 'awaiting_parts', 
        waitingPartsStartTime: nowIso,
        pendingPartsList: pieces.split(',').map(p => p.trim())
      } : null);

    } catch (error) {
      console.error('Error pausing for parts:', error);
      showToast('Erro ao pausar manutenção.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResumeFromParts = async (stop: MaintenanceStop) => {
    setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const waitingMinutes = stop.waitingPartsStartTime ? diffInMinutes(stop.waitingPartsStartTime, nowIso) : 0;
      
      const maintenanceRef = Firestore.doc(db, 'maintenance', stop.id);
      const forkliftRef = Firestore.doc(db, 'forklifts', stop.forkliftId);

      await Firestore.updateDoc(maintenanceRef, {
        status: 'in_progress',
        totalWaitingPartsMinutes: Firestore.increment(waitingMinutes),
        waitingPartsStartTime: null
      });

      await Firestore.updateDoc(forkliftRef, {
        status: 'maintenance'
      });

      // Update local state immediately for offline responsiveness
      const updatedStops = activeStops.map(s => 
        s.id === stop.id ? { 
          ...s, 
          status: 'in_progress' as const, 
          totalWaitingPartsMinutes: (s.totalWaitingPartsMinutes || 0) + waitingMinutes,
          waitingPartsStartTime: null 
        } : s
      );
      const updatedForklifts = forklifts.map(f =>
        f.id === stop.forkliftId ? { ...f, status: 'maintenance' as const } : f
      );

      setActiveStops(updatedStops);
      setForklifts(updatedForklifts);

      // Update cache
      localStorage.setItem(CACHE_KEYS.MAINTENANCE, JSON.stringify({ data: updatedStops, timestamp: Date.now() }));
      localStorage.setItem(CACHE_KEYS.FORKLIFTS, JSON.stringify({ data: updatedForklifts, timestamp: Date.now() }));

      showToast('Manutenção retomada!');
      setSelectedStop(prev => prev ? { 
        ...prev, 
        status: 'in_progress',
        waitingPartsStartTime: undefined
      } : null);

    } catch (error) {
      console.error('Error resuming maintenance:', error);
      showToast('Erro ao retomar manutenção.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const addPart = () => {
    if (!partName.trim()) return;
    const invPart = selectedPartId ? inventoryParts.find(p => p.id === selectedPartId) : null;
    
    setParts([...parts, { 
      name: invPart?.name || partName.trim(), 
      quantity: partQty, 
      replaced: isReplaced,
      inventoryPartId: invPart?.id
    }]);
    setPartName('');
    setPartQty(1);
    setSelectedPartId(undefined);
  };

  const filteredStops = activeStops
    .filter(s => {
      const matchesStatus = filterStatus === 'all' || s.status === filterStatus;
      const matchesSeverity = filterSeverity === 'all' || s.severity === filterSeverity;
      const forklift = forklifts.find(f => f.id === s.forkliftId);
      const forkliftLabel = ((forklift?.model || '') + ' ' + (forklift?.serialNumber || '')).toLowerCase();
      const matchesSearch = forkliftLabel.includes(searchTerm.toLowerCase()) || 
                           (s.description || '').toLowerCase().includes(searchTerm.toLowerCase());
      return matchesStatus && matchesSeverity && matchesSearch;
    })
    .sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      const sevA = (severityOrder as any)[a.severity || 'low'];
      const sevB = (severityOrder as any)[b.severity || 'low'];
      if (sevA !== sevB) return sevA - sevB;
      
      const getTime = (val: any) => {
        if (!val) return 0;
        if (typeof val === 'string') return new Date(val).getTime();
        if (val.toDate) return val.toDate().getTime();
        if (val.seconds) return val.seconds * 1000;
        return 0;
      };
      
      return getTime(a.stopTime) - getTime(b.stopTime);
    });

  const getDowntime = (stop: MaintenanceStop) => {
    // Q (Quebra/high): starts at stopTime (registration)
    // R (Reparo/low), I (Iminente/medium): starts at startTime (atendimento)
    const sev = stop.severity || (stop.type === 'preventive' ? 'low' : 'high');
    const isParada = sev === 'high' || sev === 'critical';
    const startIso = isParada ? stop.stopTime : stop.startTime;
    if (!startIso) return 0;
    return diffInMinutes(startIso, stop.endTime ? stop.endTime : now);
  };

  const getResponseTime = (stop: MaintenanceStop) => {
    if (!stop.startTime) return diffInMinutes(stop.stopTime, now);
    return diffInMinutes(stop.stopTime, stop.startTime);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      {!selectedStop ? (
        <>
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="flex items-center gap-4">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={cn(
                  "p-3 rounded-2xl border border-slate-200 transition-all active:scale-95 group bg-white",
                  isRefreshing ? "text-slate-300" : "text-slate-600 hover:bg-slate-50 hover:border-blue-200"
                )}
                title="Atualizar Dados"
              >
                <History className={cn("w-5 h-5 transition-transform duration-700", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
              </button>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3 italic">
                <Wrench className="w-8 h-8 text-blue-600" />
                OCORRÊNCIAS REGISTRADAS
              </h1>
            </div>
            
            <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
                <button 
                  onClick={() => setFilterStatus('all')}
                  className={cn("px-4 py-2 text-[10px] font-black uppercase rounded-xl transition-all", filterStatus === 'all' ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-600")}
                >TUDO</button>
                <button 
                  onClick={() => setFilterStatus('pending')}
                  className={cn("px-4 py-2 text-[10px] font-black uppercase rounded-xl transition-all", filterStatus === 'pending' ? "bg-red-500 text-white" : "text-slate-400 hover:text-slate-600")}
                >ABERTAS</button>
                <button 
                  onClick={() => setFilterStatus('in_progress')}
                  className={cn("px-4 py-2 text-[10px] font-black uppercase rounded-xl transition-all", filterStatus === 'in_progress' ? "bg-blue-500 text-white" : "text-slate-400 hover:text-slate-600")}
                >EM ATENDIMENTO</button>
            </div>
          </header>

          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="PROCURAR MÁQUINA OU DESCRIÇÃO..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-[10px] font-black focus:ring-2 focus:ring-blue-500 outline-none uppercase"
              />
            </div>
            <select 
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value as any)}
              className="w-full md:w-48 px-4 py-3 bg-slate-50 border-none rounded-2xl text-[10px] font-black focus:ring-2 focus:ring-blue-500 outline-none uppercase"
            >
              <option value="all">TODAS PRIORIDADES</option>
              <option value="high">QUEBRA (PELE VERMELHA)</option>
              <option value="medium">IMINENTE (AMARELO)</option>
              <option value="low">REPARO (VERDE)</option>
            </select>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {filteredStops.length === 0 ? (
              <div className="col-span-full bg-white p-16 rounded-[3rem] border border-slate-100 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-6">
                  <CheckCircle2 className="w-10 h-10 text-slate-200" />
                </div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-2">Tudo em Ordem</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest max-w-xs">Não encontramos nenhuma ocorrência aberta com os filtros selecionados.</p>
              </div>
            ) : filteredStops.map(stop => (
              <OccurrenceCard 
                key={stop.id} 
                stop={stop} 
                forklift={forklifts.find(f => f.id === stop.forkliftId)}
                onSelect={() => setSelectedStop(stop)}
                downtime={getDowntime(stop)}
                responseTime={getResponseTime(stop)}
              />
            ))}
          </div>
        </>
      ) : (
        <MaintenanceForm 
          stop={selectedStop}
          forklift={forklifts.find(f => f.id === selectedStop.forkliftId)}
          loading={loading}
          onBack={() => setSelectedStop(null)}
          onStart={() => handleStartMaintenance(selectedStop)}
          onFinish={() => handleFinishMaintenance(selectedStop)}
          onPauseForParts={(pieces: string) => handlePauseForParts(selectedStop, pieces)}
          onResumeFromParts={() => handleResumeFromParts(selectedStop)}
          hourMeter={hourMeter}
          setHourMeter={setHourMeter}
          repairNotes={repairNotes}
          setRepairNotes={setRepairNotes}
          approverName={approverName}
          setApproverName={setApproverName}
          parts={parts}
          setParts={setParts}
          inventoryParts={inventoryParts}
          partName={partName}
          setPartName={setPartName}
          partQty={partQty}
          setPartQty={setPartQty}
          isReplaced={isReplaced}
          setIsReplaced={setIsReplaced}
          addPart={addPart}
          removePart={(i: number) => setParts(parts.filter((_, idx) => idx !== i))}
          showSuggestions={showSuggestions}
          setShowSuggestions={setShowSuggestions}
          selectedPartId={selectedPartId}
          setSelectedPartId={setSelectedPartId}
          downtime={getDowntime(selectedStop)}
          responseTime={getResponseTime(selectedStop)}
          now={now}
        />
      )}
    </div>
  );
}

function OccurrenceCard({ stop, forklift, onSelect, downtime, responseTime }: any) {
  const isHigh = stop.severity === 'high';
  const isMedium = stop.severity === 'medium';
  const isInWork = stop.status === 'in_progress';
  const isAwaitingParts = stop.status === 'awaiting_parts';

  return (
    <div 
      onClick={onSelect}
      className={cn(
        "bg-white rounded-[2.5rem] border-2 p-6 transition-all cursor-pointer hover:shadow-2xl relative overflow-hidden group",
        isHigh ? "border-red-100/50 hover:border-red-400" : 
        isMedium ? "border-amber-100/50 hover:border-amber-400" : 
        "border-emerald-100/50 hover:border-emerald-400"
      )}
    >
      {/* Visual Indicator Line */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-2",
        isHigh ? "bg-red-500" : isMedium ? "bg-amber-500" : "bg-emerald-500"
      )} />

      <div className="flex justify-between items-start pl-4">
        <div className="flex gap-4">
          <div className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg relative group-hover:scale-110 transition-transform",
            isHigh ? "bg-red-500 text-white" : 
            isMedium ? "bg-amber-500 text-white" : 
            "bg-emerald-500 text-white"
          )}>
            {downtime >= 1440 && (
              <div className="absolute -top-3 -right-2 bg-blue-600 text-white px-2 py-0.5 rounded-lg text-[9px] font-black whitespace-nowrap shadow-xl border-2 border-white animate-bounce">
                {formatDuration(downtime * 60000)}
              </div>
            )}
            {isHigh ? <Ban className="w-7 h-7" /> : 
             isMedium ? <AlertTriangle className="w-7 h-7" /> : 
             <Wrench className="w-7 h-7" />}
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase italic leading-none mb-1.5">
              {forklift?.model || 'MAQ.'} <span className="text-slate-400">{forklift?.serialNumber}</span>
            </h3>
            <div className="flex gap-2">
                <span className={cn(
                  "text-[8px] font-black uppercase px-2 py-0.5 rounded",
                  isHigh ? "bg-red-50 text-red-600" : 
                  isMedium ? "bg-amber-50 text-amber-600" : 
                  "bg-emerald-50 text-emerald-600"
                )}>
                  {isHigh ? 'Q - QUEBRA CRÍTICA' : isMedium ? 'I - FALHA IMINENTE' : 'R - REPARO NORMAL'}
                </span>
                {isInWork && (
                  <span className="bg-blue-500 text-white text-[8px] font-black px-2 py-0.5 rounded animate-pulse">EM MANUTENÇÃO</span>
                )}
                {isAwaitingParts && (
                  <span className="bg-amber-500 text-white text-[8px] font-black px-2 py-0.5 rounded animate-pulse">AGUARDANDO PEÇA</span>
                )}
            </div>
          </div>
        </div>
        <div className="text-right">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Status</p>
            <p className={cn("text-xs font-black uppercase italic", (isInWork || isAwaitingParts) ? "text-blue-600" : "text-slate-400")}>
                {isAwaitingParts ? 'Pausado (Peças)' : isInWork ? 'Mecânico Atuando' : 'Aguardando'}
            </p>
        </div>
      </div>

      <div className="pl-4 mt-6 bg-slate-50 p-4 rounded-2xl border border-slate-100 flex-1">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-none">Relato do Problema</p>
        <p className="text-sm font-bold text-slate-600 italic leading-relaxed line-clamp-2">"{stop.description}"</p>
      </div>

      <div className="pl-4 mt-4 grid grid-cols-2 gap-3">
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Tempo Resposta</span>
            <Clock className="w-3 h-3 text-slate-300" />
          </div>
          <p className="text-lg font-black text-slate-900 tracking-tighter leading-none">{formatDuration(responseTime * 60000)}</p>
        </div>
        <div className={cn(
          "p-3 rounded-2xl border transition-all",
          isInWork ? "bg-slate-900 border-slate-900 text-white shadow-xl" : "bg-slate-50 border-slate-100"
        )}>
          <div className="flex justify-between items-center mb-1">
            <span className={cn("text-[8px] font-black uppercase tracking-tighter", isInWork ? "text-slate-500" : "text-slate-400")}>Indisponibilidade</span>
            <Timer className={cn("w-3 h-3", isInWork ? "text-blue-400 animate-pulse" : "text-slate-300")} />
          </div>
          <p className={cn("text-lg font-black tracking-tighter leading-none", isInWork ? "text-emerald-400" : "text-slate-900")}>
             {formatDuration(downtime * 60000)}
          </p>
        </div>
      </div>
      
      <div className="pl-4 mt-4 flex items-center justify-between border-t border-slate-50 pt-4 opacity-60 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center">
                <User className="w-3 h-3 text-slate-400" />
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase">{stop.operatorName}</span>
        </div>
        <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">{formatDateSafe(stop.stopTime)}</span>
      </div>
    </div>
  );
}

function MaintenanceForm({ 
  stop, 
  forklift, 
  loading, 
  onBack, 
  onStart, 
  onFinish,
  onPauseForParts,
  onResumeFromParts,
  hourMeter, setHourMeter,
  repairNotes, setRepairNotes,
  approverName, setApproverName,
  parts, addPart, removePart,
  inventoryParts,
  partName, setPartName,
  partQty, setPartQty,
  isReplaced, setIsReplaced,
  showSuggestions, setShowSuggestions,
  selectedPartId, setSelectedPartId,
  downtime, responseTime,
  now
}: any) {
  const isInWork = stop.status === 'in_progress';
  const isAwaitingParts = stop.status === 'awaiting_parts';
  const [showMissingInput, setShowMissingInput] = useState(false);
  const [missingPieces, setMissingPieces] = useState('');

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center mb-8">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-black text-[10px] uppercase tracking-widest bg-white pl-4 pr-6 py-3 rounded-2xl shadow-sm border border-slate-100"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar à Lista
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900 p-8 rounded-[3rem] text-white shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
                <Wrench className="w-32 h-32 rotate-12" />
            </div>
            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-4">Detalhamento da Máquina</p>
            <h2 className="text-4xl font-black italic tracking-tighter mb-1 leading-none">{forklift?.model || 'MAQ.'}</h2>
            <p className="text-xl font-bold text-slate-500 mb-8 leading-none">SÉRIE: {forklift?.serialNumber}</p>
            
            <div className="space-y-4">
                <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                    <p className="text-[9px] font-black text-slate-500 uppercase mb-2">Relato do Problema</p>
                    <p className="text-sm italic text-slate-300">"{stop.description}"</p>
                </div>
                {stop.pendingPartsList && stop.pendingPartsList.length > 0 && (
                  <div className="bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20">
                      <p className="text-[9px] font-black text-amber-500 uppercase mb-2">Peças Faltantes</p>
                      <div className="flex flex-wrap gap-2">
                        {stop.pendingPartsList.map((p: string, i: number) => (
                          <span key={i} className="bg-amber-500 text-white text-[9px] font-black px-2 py-1 rounded-lg uppercase tracking-wider">{p}</span>
                        ))}
                      </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                        <p className="text-[8px] font-black text-slate-500 uppercase mb-1">T. Resposta</p>
                        <p className="text-xl font-black">{formatDuration(responseTime * 60000)}</p>
                    </div>
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                        <p className="text-[8px] font-black text-slate-500 uppercase mb-1">T. Indispon.</p>
                        <p className="text-xl font-black text-emerald-400">{formatDuration(downtime * 60000)}</p>
                    </div>
                </div>
                {(stop.totalWaitingPartsMinutes || stop.waitingPartsStartTime) && (
                  <div className="bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20">
                      <p className="text-[8px] font-black text-amber-500 uppercase mb-1">Total Aguardando Peças</p>
                      <p className="text-xl font-black text-amber-600">
                        {(() => {
                           let total = stop.totalWaitingPartsMinutes || 0;
                           if (stop.waitingPartsStartTime) {
                             total += diffInMinutes(stop.waitingPartsStartTime, now);
                           }
                           return formatDuration(total * 60000);
                        })()}
                      </p>
                  </div>
                )}
            </div>
          </div>

          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm relative overflow-hidden">
              <h3 className="text-xs font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-500" />
                Histórico de Registro
              </h3>
              <div className="space-y-6">
                <div className="relative pl-8 border-l-2 border-slate-100 space-y-8">
                    <div className="relative">
                        <div className="absolute -left-[35px] top-0 w-3.5 h-3.5 rounded-full bg-blue-500 border-4 border-white shadow-sm" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Registro</p>
                        <p className="text-xs font-bold text-slate-700">{formatDateSafe(stop.stopTime)}</p>
                        <p className="text-[9px] font-bold text-slate-400 mt-1">Por: {stop.operatorName || 'N/A'}</p>
                    </div>
                    {stop.startTime && (
                        <div className="relative">
                            <div className="absolute -left-[35px] top-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-4 border-white shadow-sm" />
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Atendimento</p>
                            <p className="text-xs font-bold text-slate-700">{formatDateSafe(stop.startTime)}</p>
                        </div>
                    )}
                    {stop.waitingPartsStartTime && (
                        <div className="relative">
                            <div className="absolute -left-[35px] top-0 w-3.5 h-3.5 rounded-full bg-amber-500 border-4 border-white shadow-sm" />
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Pausa por Peça</p>
                            <p className="text-xs font-bold text-slate-700">{formatDateSafe(stop.waitingPartsStartTime)}</p>
                        </div>
                    )}
                </div>
              </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-8">
          {!isInWork && !isAwaitingParts ? (
            <div className="bg-white p-12 rounded-[3.5rem] border-2 border-dashed border-blue-200 flex flex-col items-center justify-center text-center space-y-6 shadow-xl shadow-blue-50">
                <div className="w-20 h-20 bg-blue-50 rounded-[2rem] flex items-center justify-center text-blue-500">
                    <Play className="w-8 h-8 fill-current translate-x-1" />
                </div>
                <div>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Iniciar Manutenção?</h3>
                    <p className="text-sm font-medium text-slate-500 italic max-w-xs mx-auto">
                        Ao iniciar, a máquina será marcada como em manutenção e o tempo de indisponibilidade oficial começará a contar.
                    </p>
                </div>
                <button 
                  onClick={onStart}
                  disabled={loading}
                  className="bg-blue-600 text-white px-12 py-5 rounded-[2rem] font-black uppercase tracking-widest text-sm shadow-2xl shadow-blue-200 hover:bg-blue-700 transition-all hover:-translate-y-1 active:scale-95"
                >
                    {loading ? 'Processando...' : 'CONFIRMAR INÍCIO'}
                </button>
            </div>
          ) : isAwaitingParts ? (
            <div className="bg-white p-12 rounded-[3.5rem] border-2 border-dashed border-amber-200 flex flex-col items-center justify-center text-center space-y-6 shadow-xl shadow-amber-50">
                <div className="w-20 h-20 bg-amber-50 rounded-[2rem] flex items-center justify-center text-amber-500">
                    <Play className="w-8 h-8 fill-current translate-x-1" />
                </div>
                <div>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Retomar Manutenção?</h3>
                    <p className="text-sm font-medium text-slate-500 italic max-w-xs mx-auto">
                        A peça chegou! Retome o trabalho para registrar o tempo de execução.
                    </p>
                </div>
                <button 
                  onClick={onResumeFromParts}
                  disabled={loading}
                  className="bg-amber-600 text-white px-12 py-5 rounded-[2rem] font-black uppercase tracking-widest text-sm shadow-2xl shadow-amber-200 hover:bg-amber-700 transition-all hover:-translate-y-1 active:scale-95"
                >
                    {loading ? 'Processando...' : 'RETOMAR TRABALHO'}
                </button>
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm space-y-8">
                    <div className="flex justify-between items-center">
                        <h3 className="text-sm font-black text-slate-900 tracking-widest">REGISTRO DE INSUMOS</h3>
                        <span className="text-[10px] font-black text-blue-500 uppercase">{parts.length} ITENS</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <div className="md:col-span-2 relative">
                            <label className="text-[8px] font-black text-slate-400 uppercase mb-1.5 ml-1 inline-block">Nome do Componente</label>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    value={partName}
                                    onChange={(e) => {
                                        setPartName(e.target.value);
                                        setShowSuggestions(true);
                                    }}
                                    onFocus={() => setShowSuggestions(true)}
                                    placeholder="DIGITE PARA BUSCAR..."
                                    className="w-full p-4 bg-slate-50 border-none rounded-2xl text-[10px] font-black focus:ring-2 focus:ring-blue-500 outline-none uppercase"
                                />
                                {showSuggestions && partName && (
                                    <div className="absolute z-10 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl overflow-hidden max-h-40 overflow-y-auto">
                                        {inventoryParts.filter((p: any) => p.name.toLowerCase().includes(partName.toLowerCase())).map((p: any) => (
                                            <button 
                                                key={p.id}
                                                onClick={() => {
                                                    setPartName(p.name);
                                                    setSelectedPartId(p.id);
                                                    setShowSuggestions(false);
                                                }}
                                                className="w-full text-left px-5 py-3 hover:bg-slate-50 text-[10px] font-black flex justify-between items-center"
                                            >
                                                <span>{p.name}</span>
                                                <span className="text-blue-500">ESTOQUE: {p.quantity}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="md:col-span-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase mb-1.5 ml-1 inline-block">Qtd</label>
                            <input 
                                type="number" 
                                value={partQty}
                                onChange={(e) => setPartQty(Math.max(1, Number(e.target.value)))}
                                className="w-full p-4 bg-slate-50 border-none rounded-2xl text-[10px] font-black focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div className="md:col-span-1 flex items-center justify-center pt-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={isReplaced}
                                    onChange={(e) => setIsReplaced(e.target.checked)}
                                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-200"
                                />
                                <span className="text-[9px] font-black text-slate-500 uppercase">Trocado?</span>
                            </label>
                        </div>
                        <div className="md:col-span-1 pt-6">
                            <button 
                                onClick={addPart}
                                className="w-full h-14 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-blue-600 transition-all shadow-lg active:scale-90"
                            >
                                <Plus className="w-6 h-6" />
                            </button>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {parts.map((p: any, i: number) => (
                            <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group animate-in slide-in-from-left-2 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-xs font-black text-slate-400">
                                        {p.quantity}X
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-900 uppercase italic leading-none mb-1">{p.name}</p>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{p.replaced ? 'Substituição' : 'Reparo'}</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => removePart(i)}
                                    className="p-2 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-white p-10 rounded-[3.5rem] border border-slate-100 shadow-sm space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block ml-1">Horímetro Final (Opcional)</label>
                            <input 
                                type="number"
                                value={hourMeter}
                                onChange={(e) => setHourMeter(e.target.value === '' ? '' : Number(e.target.value))}
                                placeholder="0000"
                                className="w-full p-5 bg-slate-50 border-none rounded-2xl text-2xl font-black italic focus:ring-4 focus:ring-blue-500/10 outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block ml-1">Supervisor de Liberação <span className="text-red-500">*</span></label>
                            <input 
                                type="text"
                                value={approverName}
                                onChange={(e) => setApproverName(e.target.value)}
                                placeholder="NOME DO APROVADOR"
                                className="w-full p-5 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase focus:ring-4 focus:ring-blue-500/10 outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block ml-1">Diagnóstico & Solução <span className="text-red-500">*</span></label>
                        <textarea 
                            value={repairNotes}
                            onChange={(e) => setRepairNotes(e.target.value)}
                            placeholder="DESCREVA O SERVIÇO EXECUTADO..."
                            rows={4}
                            className="w-full p-6 bg-slate-50 border-none rounded-[2rem] text-sm font-semibold italic focus:ring-4 focus:ring-blue-500/10 outline-none resize-none"
                        />
                    </div>

                    {showMissingInput && (
                      <div className="bg-amber-50 p-6 rounded-[2rem] border border-amber-100 animate-in zoom-in-95 duration-200">
                          <label className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-2 block ml-1">Quais peças estão faltando? <span className="text-red-500">*</span></label>
                          <input 
                              type="text"
                              autoFocus
                              value={missingPieces}
                              onChange={(e) => setMissingPieces(e.target.value)}
                              placeholder="EX: FILTRO DE ÓLEO, CORREIA..."
                              className="w-full p-5 bg-white border-none rounded-2xl text-[10px] font-black uppercase focus:ring-4 focus:ring-amber-500/10 outline-none mb-4"
                          />
                          <div className="flex gap-2">
                             <button 
                                onClick={() => onPauseForParts(missingPieces)}
                                className="flex-1 py-4 bg-amber-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-amber-200"
                             >
                                CONFIRMAR PAUSA
                             </button>
                             <button 
                                onClick={() => setShowMissingInput(false)}
                                className="px-6 py-4 bg-white text-slate-400 rounded-xl font-black uppercase tracking-widest text-[10px] border border-slate-200"
                             >
                                CANCELAR
                             </button>
                          </div>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-4">
                        {!showMissingInput && (
                          <button 
                              onClick={() => setShowMissingInput(true)}
                              disabled={loading}
                              className="flex-1 py-6 bg-amber-500 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl shadow-amber-200 hover:bg-amber-600 transition-all hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-3 order-2 sm:order-1"
                          >
                              <PauseCircle className="w-5 h-5" />
                              Sinalizar Falta de Peça
                          </button>
                        )}

                        <button 
                            onClick={onFinish}
                            disabled={loading}
                            className="flex-[2] py-6 bg-emerald-600 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] text-sm shadow-2xl shadow-emerald-200 hover:bg-emerald-700 transition-all hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-4 group order-1 sm:order-2"
                        >
                            {loading ? (
                                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <CheckCircle2 className="w-6 h-6 group-hover:scale-125 transition-transform" />
                            )}
                            FINALIZAR E LIBERAR EQUIPAMENTO
                        </button>
                    </div>
                </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
