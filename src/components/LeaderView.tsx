import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc,
  updateDoc,
  doc,
  orderBy,
  limit,
  where,
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { useToast } from './ToastContext';
import { 
  Forklift, 
  ForkliftStatus,
  UserRole, 
  UserProfile, 
  OperationType as AppOperationType, 
  LowProductionReason, 
  EventAction, 
  OperationalEvent, 
  ShiftType,
  MaintenanceStop
} from '../types';
import { 
  Activity, 
  Play, 
  Pause, 
  CheckCircle2, 
  Loader2, 
  Package, 
  Layers, 
  BoxSelect, 
  Truck, 
  HelpCircle, 
  CloudRain, 
  AlertTriangle,
  Users,
  Timer,
  LogOut,
  ChevronRight,
  Info,
  Wrench,
  Ban,
  X,
  Plus,
  PauseCircle,
  Leaf,
  History as HistoryIcon
} from 'lucide-react';
import { cn, formatDuration, formatDate, formatTime, formatDateTime } from '../lib/utils';
import { getCurrentShift } from '../lib/operationalLogic';
import { Checklist, ShiftReport, OccurrenceSeverity } from '../types';
import { FleetManagement } from './FleetManagement';

import { handleFirestoreError, OperationType as FirestoreOperationType } from '../lib/firebaseUtils';

export function LeaderView() {
  const { profile, loading: authLoading, setQuotaExceeded } = useAuth();
  const { showToast } = useToast();
  const { forklifts, uniqueForklifts, operators, activeStops, absences, refreshGlobalData } = useData();
  const [events, setEvents] = useState<OperationalEvent[]>([]);
  
  const [selectedForkliftId, setSelectedForkliftId] = useState<string>('');
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<string[]>([]);
  const [operationType, setOperationType] = useState<AppOperationType | ''>('');
  const [assignments, setAssignments] = useState<{ forkliftId: string, operatorIds: string[] }[]>([]);
  const [stopReason, setStopReason] = useState<LowProductionReason | ''>('');
  const [production, setProduction] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [isOccurrence, setIsOccurrence] = useState(false);
  const [severity, setSeverity] = useState<OccurrenceSeverity>('high');
  // Navigation
  const [activeTab, setActiveTab] = useState<'fleet' | 'entries' | 'report_occurrence' | 'occurrences' | 'history'>('entries');

  // States for Production Modal
  const [showProductionModal, setShowProductionModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<EventAction | null>(null);
  const [modalProduction, setModalProduction] = useState<string>('');
  const [modalNextOperationType, setModalNextOperationType] = useState<AppOperationType | ''>('');
  const [activeModalForkliftId, setActiveModalForkliftId] = useState<string | null>(null);
  const [quickLinkForklift, setQuickLinkForklift] = useState<Forklift | null>(null);

  // States for Shift Finalization
  const [showShiftSummaryModal, setShowShiftSummaryModal] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<Partial<ShiftReport> | null>(null);
  const [lastChecklist, setLastChecklist] = useState<Checklist | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isShiftFinalized, setIsShiftFinalized] = useState(false);
  const [finalHourMeterInput, setFinalHourMeterInput] = useState<string>('');

  const [operatorSearch, setOperatorSearch] = useState('');
  
  // Machines in maintenance/stopped shouldn't be selectable for operations in LeaderView
  const leaderUniqueForklifts = useMemo(() => {
    return uniqueForklifts
      .filter(f => f.status !== 'stopped' && f.status !== 'maintenance');
  }, [uniqueForklifts]);

  // Derived state: find the last event for the selected forklift to know its current status
  const uniqueOperators = useMemo(() => {
    const idMap = new Map<string, UserProfile>();
    const now = new Date();
    
    // Sort to prioritize users with display names
    const sorted = [...operators].sort((a, b) => {
      if (a.displayName && !b.displayName) return -1;
      if (!a.displayName && b.displayName) return 1;
      return 0;
    });

    sorted
      .filter(o => o.role === 'operator') // Only operators as requested
      .filter(o => {
        // Filter out if there is an active absence today
        const activeAbsence = absences.find(abs => {
          if (abs.operatorId !== o.uid) return false;
          const start = new Date(abs.startDate);
          const end = new Date(abs.endDate);
          // Set hours to zero for date-only comparison
          start.setHours(0, 0, 0, 0);
          end.setHours(23, 59, 59, 999);
          return now >= start && now <= end;
        });
        return !activeAbsence;
      })
      .forEach(o => {
        if (!idMap.has(o.uid)) {
          idMap.set(o.uid, o);
        }
      });
    return Array.from(idMap.values()).sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));
  }, [operators]);

  // State for quick assignment to a specific operation
  const [assigningToOp, setAssigningToOp] = useState<AppOperationType | null>(null);

  // Derived state: current active operations
  // Derived state: active operations (latest event per machine that is NOT a stop)
  const activeOperations = useMemo(() => {
    const active: OperationalEvent[] = [];
    const seen = new Set<string>();
    const currentShift = getCurrentShift();
    
    // Get latest event for each machine
    for (const event of events) {
      if (event.forkliftId === 'system_consolidated' || event.forkliftId.startsWith('global_')) continue;
      
      if (!seen.has(event.forkliftId)) {
        seen.add(event.forkliftId);
        // Only include if it's NOT a stop event AND it's from the current shift
        if (event.action !== 'stop' && event.shift === currentShift) {
          active.push(event);
        }
      }
    }
    return active;
  }, [events]);

  // Derived state: current active operations grouped by type
  const activeOperationsByType = useMemo(() => {
    const groups: Record<string, OperationalEvent[]> = {
      tirar_producao: [],
      quebra: [],
      emblocamento: [],
      carregamento: []
    };
    
    activeOperations.forEach(op => {
      if (groups[op.operationType]) {
        groups[op.operationType].push(op);
      }
    });

    return groups;
  }, [activeOperations]);

  const globalStops = useMemo(() => {
    const stops: Record<string, OperationalEvent | null> = {
      tirar_producao: null,
      quebra: null,
      emblocamento: null,
      carregamento: null
    };
    
    const seen = new Set<string>();
    const currentShift = getCurrentShift();
    
    for (const event of events) {
      if (event.forkliftId.startsWith('global_')) {
        const opType = event.forkliftId.replace('global_', '');
        if (!seen.has(opType)) {
          seen.add(opType);
          if ((event.action === 'stop' || event.action === 'occurrence') && event.shift === currentShift) {
            stops[opType] = event;
          }
        }
      }
    }
    return stops;
  }, [events]);

  // Combined busy sets for filtering selection lists
  const busyForkliftIds = useMemo(() => {
    const active = new Set<string>();
    const seenSet = new Set<string>();
    const currentShift = getCurrentShift();
    const now = new Date();
    const activeThreshold = new Date(now.getTime() - (14 * 60 * 60 * 1000)); // 14 hours limit

    for (const event of events) {
      if (!seenSet.has(event.forkliftId)) {
        seenSet.add(event.forkliftId);
        // Check if event is recent AND same shift to be considered busy
        const eventTime = new Date(event.timestamp);
        if (event.action !== 'stop' && event.shift === currentShift && eventTime > activeThreshold) {
          active.add(event.forkliftId);
        }
      }
    }
    return active;
  }, [events]);

  const availableForkliftsList = useMemo(() => {
    return uniqueForklifts.filter(f => !busyForkliftIds.has(f.id));
  }, [uniqueForklifts, busyForkliftIds]);

  const busyOperatorIds = useMemo(() => {
    const active = new Set<string>();
    const seenSet = new Set<string>();
    const activeOps: string[] = [];
    const currentShift = getCurrentShift();
    const now = new Date();
    const activeThreshold = new Date(now.getTime() - (14 * 60 * 60 * 1000)); // 14 hours limit
    
    // Get latest event for each machine to see which operators are REALLY busy
    for (const event of events) {
      if (event.forkliftId === 'system_consolidated' || event.forkliftId.startsWith('global_')) continue;

      if (!seenSet.has(event.forkliftId)) {
        seenSet.add(event.forkliftId);
        // Only consider operators as busy if the latest machine event is NOT a stop 
        // AND it's from current shift AND it's within the threshold to avoid "ghost" busy status
        const eventTime = new Date(event.timestamp);
        if (event.action !== 'stop' && event.shift === currentShift && eventTime > activeThreshold) {
          activeOps.push(...(event.operatorIds || []));
        }
      }
    }
    return new Set(activeOps);
  }, [events]);

  const lastForkliftEvent = useMemo(() => {
    if (!selectedForkliftId) return null;
    return events.find(e => e.forkliftId === selectedForkliftId);
  }, [selectedForkliftId, events]);

  // Derived state: current operators for the selected forklift
  const currentOperators = useMemo(() => {
    if (!lastForkliftEvent) return [];
    return lastForkliftEvent.operatorIds || [];
  }, [lastForkliftEvent]);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async (force = false) => {
    if (!profile) return;
    setIsRefreshing(true);

    const E_CACHE_KEY = 'leader_events_cache';
    const S_CACHE_KEY = 'leader_stops_cache';

    const CACHE_KEY = S_CACHE_KEY;
    const cached = localStorage.getItem(CACHE_KEY);
    if (!force && cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        const CACHE_DURATION = 5 * 60 * 1000;
        if (Date.now() - timestamp < CACHE_DURATION) {
          setIsRefreshing(false);
          return;
        }
      } catch (e) {}
    }
    
    try {
      await refreshGlobalData(force);

      const qE = query(collection(db, 'operational_events'), orderBy('timestamp', 'desc'), limit(500));
      const eSnap = await getDocs(qE);
      const newEvents = eSnap.docs.map(d => ({ id: d.id, ...d.data() } as OperationalEvent));
      setEvents(newEvents);
      localStorage.setItem(E_CACHE_KEY, JSON.stringify({ data: newEvents, timestamp: Date.now() }));

      // Shift finalized check
      if (selectedForkliftId) {
        const shift = getCurrentShift();
        const today = new Date().toISOString().split('T')[0];
        const qR = query(
          collection(db, 'shift_reports'),
          where('forkliftId', '==', selectedForkliftId),
          where('shift', '==', shift),
          where('date', '==', today),
          limit(1)
        );
        const rSnap = await getDocs(qR);
        setIsShiftFinalized(!rSnap.empty);
      }
    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        setQuotaExceeded(true);
      }
      handleFirestoreError(err, FirestoreOperationType.LIST, 'events');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (authLoading || !profile) return;

    // Initial load from cache or fetch once
    fetchData();

    // Listen for events in real-time
    const qE = query(collection(db, 'operational_events'), orderBy('timestamp', 'desc'), limit(500));
    const unsubscribeE = onSnapshot(qE, (snapshot) => {
      const newEvents = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as OperationalEvent));
      setEvents(newEvents);
      localStorage.setItem('leader_events_cache', JSON.stringify({ data: newEvents, timestamp: Date.now() }));
    }, (err: any) => {
      console.error("Events Realtime Error:", err);
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        setQuotaExceeded(true);
      }
    });

    return () => {
      unsubscribeE();
    };
  }, [authLoading, profile, setQuotaExceeded]);

  const handleRefresh = () => fetchData(true);

  // Handle shift finalized check separately when machine changes
  useEffect(() => {
    const checkFinalized = async () => {
        if (!selectedForkliftId) return;
        const shift = getCurrentShift();
        const today = new Date().toISOString().split('T')[0];
        const qR = query(
          collection(db, 'shift_reports'),
          where('forkliftId', '==', selectedForkliftId),
          where('shift', '==', shift),
          where('date', '==', today)
        );
        const rSnap = await getDocs(qR);
        setIsShiftFinalized(!rSnap.empty);
    };
    checkFinalized();
  }, [selectedForkliftId]);

  // When a machine is selected, automatically select its previous operators (if available)
  useEffect(() => {
    if (lastForkliftEvent) {
      if (selectedOperatorIds.length === 0) {
        const availablePrevious = (lastForkliftEvent.operatorIds || []).filter(id => !busyOperatorIds.has(id));
        setSelectedOperatorIds(availablePrevious);
      }
      if (!operationType) {
        setOperationType(lastForkliftEvent.operationType);
      }
    }
  }, [lastForkliftEvent, busyOperatorIds]);

  const handleToggleOperator = (id: string) => {
    setSelectedOperatorIds(prev => 
      prev.includes(id) ? prev.filter(o => o !== id) : [...prev, id]
    );
  };

  const handleAddAssignment = () => {
    if (!selectedForkliftId || selectedOperatorIds.length === 0) {
      showToast('Selecione uma máquina e pelo menos um operador.', 'error');
      return;
    }
    if (assignments.some(a => a.forkliftId === selectedForkliftId)) {
      showToast('Esta máquina já está na fila.', 'info');
      return;
    }
    setAssignments([...assignments, { forkliftId: selectedForkliftId, operatorIds: [...selectedOperatorIds] }]);
    setSelectedForkliftId('');
    setSelectedOperatorIds([]);
  };

  const handleRemoveAssignment = (forkliftId: string) => {
    setAssignments(assignments.filter(a => a.forkliftId !== forkliftId));
  };

  const handleAction = async (
    action: EventAction, 
    customTargets?: { forkliftId: string, operatorIds: string[] }[],
    explicitOperationType?: AppOperationType
  ) => {
    if (!profile) return;

    const activeOperationType = explicitOperationType || operationType;

    if (action === 'start' || action === 'change' || action === 'resume') {
      if (!activeOperationType && !customTargets) {
        showToast('Selecione primeiro o tipo de operação.', 'error');
        return;
      }
      if (!customTargets && assignments.length === 0 && !selectedForkliftId) {
        showToast('Adicione pelo menos uma máquina com seus operadores.', 'error');
        return;
      }
    }

    const currentTargetId = customTargets ? customTargets[0].forkliftId : selectedForkliftId;

    if (action === 'stop' && !currentTargetId) {
      showToast('Selecione a máquina para registrar a parada.', 'error');
      return;
    }

    const finalAction = (action === 'stop' && isOccurrence) ? 'occurrence' : action;

    if ((finalAction === 'change' || finalAction === 'stop') && !showProductionModal) {
      setActiveModalForkliftId(currentTargetId);
      setPendingAction(finalAction);
      setModalProduction('');
      setShowProductionModal(true);
      return;
    }

    if (finalAction === 'occurrence' && !stopReason) {
      showToast('Descreva a ocorrência.', 'error');
      return;
    }

    // Capture the current target assignments
    const targets = customTargets || (assignments.length > 0 && (action === 'start' || action === 'change' || action === 'resume')
      ? assignments 
      : [{ forkliftId: selectedForkliftId, operatorIds: selectedOperatorIds }]);

    setIsUploading(true);
    try {
      const shift = getCurrentShift();

      for (const assignment of targets) {
        const { forkliftId, operatorIds } = assignment;
        const selectedOperators = operators.filter(o => operatorIds.includes(o.uid));
        
        const lastEvent = events.find(e => e.forkliftId === forkliftId);

        const eventData: any = {
          forkliftId,
          operatorIds,
          operatorNames: selectedOperators.map(o => o.displayName || o.email || 'Operador'),
          operationType: finalAction === 'change' && modalNextOperationType 
            ? modalNextOperationType 
            : (finalAction === 'stop' || finalAction === 'occurrence' 
                ? (lastEvent?.operationType || activeOperationType) 
                : (activeOperationType as AppOperationType)),
          action: finalAction,
          timestamp: new Date().toISOString(),
          shift,
          leaderId: profile.uid,
          leaderName: profile.displayName || profile.email
        };

        if (finalAction === 'stop' || finalAction === 'occurrence') {
          eventData.severity = severity;
          if (stopReason) eventData.stopReason = stopReason;
        }

        if (finalAction === 'change' || finalAction === 'stop') {
          // If it's a stop or change, we should record production if provided
          eventData.production = modalProduction ? parseInt(modalProduction) : 0;
        }

        let finalNewStatus: ForkliftStatus = 'available';
        if (finalAction === 'stop') {
          finalNewStatus = 'stopped';
        } else if (finalAction === 'occurrence') {
          finalNewStatus = 'at_risk';
        }

        if (!forkliftId.startsWith('global_')) {
          await updateDoc(doc(db, 'forklifts', forkliftId), { status: finalNewStatus });
          if (finalAction === 'occurrence') {
            await addDoc(collection(db, 'maintenance'), {
              forkliftId,
              operatorIds,
              operatorNames: eventData.operatorNames,
              status: 'pending',
              type: 'corrective',
              stopTime: new Date().toISOString(),
              description: stopReason || 'Registro via Líder',
              severity: severity,
              parts: [],
              isIncidentOnly: severity !== 'high'
            });
          }
        }
        
        await addDoc(collection(db, 'operational_events'), eventData);
      }

      const opLabel = activeOperationType ? activeOperationType.replace('_', ' ') : 'atividade';
      if (action === 'start' || action === 'resume') {
        const details = targets.map(t => {
          const f = forklifts.find(fork => fork.id === t.forkliftId);
          const ops = operators.filter(o => t.operatorIds.includes(o.uid))
            .map(o => o.displayName || o.email?.split('@')[0]);
          return `${f?.serialNumber || 'Máquina'} (${ops.join(', ')})`;
        }).join('; ');
        showToast(`Iniciado: ${details} em ${opLabel}.`, 'success');
      } else {
        showToast('Registro(s) concluído(s) com sucesso!', 'success');
      }

      setProduction('');
      setModalProduction('');
      setModalNextOperationType('');
      setShowProductionModal(false);
      setPendingAction(null);
      setActiveModalForkliftId(null);
      setStopReason('');
      setIsOccurrence(false);
      setAssignments([]);
    } catch (error) {
      console.error("Error saving event:", error);
      handleFirestoreError(error, FirestoreOperationType.WRITE, 'operational_events');
    } finally {
      setIsUploading(false);
    }
  };

  const prepareShiftSummary = async (fId?: string, opIds?: string[]) => {
    const targetFId = fId || selectedForkliftId;
    const targetOpIds = opIds || selectedOperatorIds;

    if (!targetFId || !targetOpIds || targetOpIds.length === 0) {
      showToast('Selecione máquina e pelo menos um operador para finalizar o turno.', 'error');
      return;
    }

    // Update state so the rest of the UI (and future calls) consistency
    setSelectedForkliftId(targetFId);
    setSelectedOperatorIds(targetOpIds);

    const targetLastEvent = events.find(e => e.forkliftId === targetFId);

    // 1. Check for active activity
    if (targetLastEvent && targetLastEvent.action !== 'stop') {
      showToast('Encerre a atividade ativa antes de finalizar o turno.', 'info');
      setPendingAction('stop');
      setStopReason('finalizacao_turno');
      setModalProduction('');
      setActiveModalForkliftId(targetFId);
      setShowProductionModal(true);
      return;
    }

    setIsUploading(true);
    try {
      // Use the shift from the last events if possible, to handle transitions correctly
      const shift = targetLastEvent?.shift || getCurrentShift();
      const today = new Date().toISOString().split('T')[0];
      
      // Fetch any checklist for this machine and shift (anyone could have done it)
      const checklistSnap = await Promise.race([
        (async () => {
          let qC = query(
            collection(db, 'checklists'),
            where('forkliftId', '==', targetFId),
            where('shift', '==', shift),
            orderBy('timestamp', 'desc'),
            limit(1)
          );
          let snap = await getDocs(qC);
          
          if (snap.empty) {
            // Try most recent regardless of shift
            qC = query(
              collection(db, 'checklists'),
              where('forkliftId', '==', targetFId),
              orderBy('timestamp', 'desc'),
              limit(1)
            );
            snap = await getDocs(qC);
          }
          return snap;
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout fetching data')), 5000))
      ]) as any;
      
      if (!checklistSnap || checklistSnap.empty) {
        showToast('Nenhum check-list encontrado para esta máquina. O horímetro é obrigatório.', 'error');
        return;
      }
      
      const checklist = { id: checklistSnap.docs[0].id, ...checklistSnap.docs[0].data() } as Checklist;
      setLastChecklist(checklist);

      if (checklist.initialHourMeter === undefined || checklist.initialHourMeter === null) {
        showToast('Horímetro não preenchido no check-list.', 'error');
        return;
      }

      // Fetch events for this machine in this shift
      const eventsSnap = await Promise.race([
        (async () => {
          const qE = query(
            collection(db, 'operational_events'),
            where('forkliftId', '==', targetFId),
            where('shift', '==', shift),
            where('timestamp', '>=', today), // Safe guard for today's events
            orderBy('timestamp', 'asc')
          );
          return await getDocs(qE);
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout fetching data')), 5000))
      ]) as any;
      
      const shiftEvents = eventsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() } as OperationalEvent));

      if (shiftEvents.length === 0) {
        showToast('Nenhum evento registrado para este turno.', 'error');
        return;
      }

      let totalProduction = 0;
      let stopCount = 0;
      let totalProductiveMinutes = 0;
      let totalDowntimeMinutes = 0;
      let totalIntervalMinutes = 0;
      
      // Breakdown by operation type
      const breakdown: Record<string, { 
        minutes: number, 
        production: number, 
        averageOperators: number, 
        productivityPerManHour: number,
        weightTimeOperators: number,
        isOverride?: boolean
      }> = {};

      for (let i = 0; i < shiftEvents.length; i++) {
        const current = shiftEvents[i];
        const next = shiftEvents[i+1];
        
        if (current.production) totalProduction += current.production;
        if (current.action === 'stop') stopCount++;

        if (next) {
          const duration = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / (1000 * 60);
          const numOperators = current.operatorIds?.length || 1;

          if (current.action === 'stop' || current.action === 'occurrence') {
            totalDowntimeMinutes += duration;
          } else {
            totalProductiveMinutes += duration;
            if (!breakdown[current.operationType]) {
              breakdown[current.operationType] = { 
                minutes: 0, 
                production: 0, 
                averageOperators: 0, 
                productivityPerManHour: 0,
                weightTimeOperators: 0
              };
            }
            breakdown[current.operationType].minutes += duration;
            breakdown[current.operationType].weightTimeOperators += (duration * numOperators);
          }
        }

        // Production sum for types
        if (current.production) {
            const type = current.operationType;
            if (!breakdown[type]) {
                breakdown[type] = { 
                  minutes: 0, 
                  production: 0, 
                  averageOperators: 0, 
                  productivityPerManHour: 0,
                  weightTimeOperators: 0
                };
            }
            breakdown[type].production += current.production;
        }
      }

      // Calculate averages and productivity
      Object.keys(breakdown).forEach(opType => {
        const data = breakdown[opType];
        if (data.minutes > 0) {
          data.averageOperators = parseFloat((data.weightTimeOperators / data.minutes).toFixed(1));
          const timeHours = data.minutes / 60;
          const manHours = timeHours * data.averageOperators;
          data.productivityPerManHour = manHours > 0 ? parseFloat((data.production / manHours).toFixed(2)) : 0;
        }
      });

      setShiftSummary({
        forkliftId: targetFId,
        shift,
        date: today,
        startTime: shiftEvents[0].timestamp,
        endTime: shiftEvents[shiftEvents.length - 1].timestamp,
        totalProductiveMinutes,
        totalDowntimeMinutes,
        totalIntervalMinutes,
        totalProduction,
        stopCount,
        operationsBreakdown: breakdown,
        initialHourMeter: checklist.initialHourMeter,
        finalHourMeter: checklist.initialHourMeter
      });
      setFinalHourMeterInput(checklist.initialHourMeter.toString());

      setShowShiftSummaryModal(true);
    } catch (error) {
      console.error("Error preparing summary:", error);
      handleFirestoreError(error, FirestoreOperationType.LIST, 'reports');
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmFinalize = async () => {
    if (!shiftSummary || !profile) return;
    
    const finalMeter = parseFloat(finalHourMeterInput);
    if (isNaN(finalMeter) || finalMeter < (shiftSummary.initialHourMeter || 0)) {
      showToast('O horímetro final é inválido ou menor que o inicial.', 'error');
      return;
    }

    setIsFinalizing(true);
    try {
      const reportData = {
        ...shiftSummary,
        finalHourMeter: finalMeter,
        status: 'finalized',
        leaderId: profile.uid,
        leaderName: profile.displayName || profile.email,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'shift_reports'), reportData);

      // Update the forklift's last horometer
      if (shiftSummary.forkliftId) {
        await updateDoc(doc(db, 'forklifts', shiftSummary.forkliftId), {
          lastHourMeter: finalMeter,
          lastHourMeterUpdate: new Date().toISOString()
        });
      }

      await refreshGlobalData(true);
      showToast('Turno finalizado com sucesso!', 'success');
      
      setShowShiftSummaryModal(false);
      setSelectedForkliftId('');
      setSelectedOperatorIds([]);
      setOperationType('');
      setShiftSummary(null);
    } catch (error) {
      console.error("Error finalizing shift:", error);
      handleFirestoreError(error, FirestoreOperationType.CREATE, 'shift_reports');
    } finally {
      setIsFinalizing(false);
    }
  };

  const getActionIcon = (act: EventAction) => {
    switch (act) {
      case 'start': return <Play className="w-4 h-4" />;
      case 'change': return <Layers className="w-4 h-4" />;
      case 'stop': return <Pause className="w-4 h-4" />;
      case 'resume': return <Activity className="w-4 h-4" />;
      case 'occurrence': return <AlertTriangle className="w-4 h-4" />;
    }
  };

  const getActionColor = (act: EventAction) => {
    switch (act) {
      case 'start': return 'bg-green-100 text-green-700 border-green-200';
      case 'change': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'stop': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'resume': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'occurrence': return 'bg-orange-100 text-orange-700 border-orange-200';
    }
  };

  const getOperationTypeColor = (type: string) => {
    switch (type) {
      case 'tirar_producao': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'quebra': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'emblocamento': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'carregamento': return 'bg-amber-100 text-amber-700 border-amber-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStopReasonLabel = (reason?: string) => {
    if (!reason) return '';
    const reasonsMap: Record<string, string> = {
      chuva: 'Chuva',
      sem_producao: 'Sem Produção',
      sem_classificacao: 'Sem Classificação',
      sem_caminhao: 'Sem Caminhão',
      algodoeira: 'Algodoeira',
      mecanico: 'Problema Mecânico',
      entre_safra: 'Entre Safra',
      intervalo: 'Intervalo',
      outro: 'Outro'
    };
    return reasonsMap[reason] || reason.replace('_', ' ');
  };

  const currentStatusLabel = useMemo(() => {
    if (!lastForkliftEvent) return 'Sem registro';
    const statusMap: Record<EventAction, string> = {
      start: 'Trabalhando',
      change: 'Trabalhando (Troca)',
      stop: 'Parada',
      resume: 'Trabalhando (Retorno)',
      occurrence: 'Operando c/ Ocorrência',
      consolidation: 'Consolidação de Produção'
    };
    return `${statusMap[lastForkliftEvent.action] || 'Log'} - ${lastForkliftEvent.operationType.replace('_', ' ')}`;
  }, [lastForkliftEvent]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Dynamic Header based on screen */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-4 py-4 md:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
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
            <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-200">
                  <Activity className="w-5 h-5" />
                </div>
                Controle Operacional
              </h1>
            </div>
          </div>


        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4 md:p-8">
          {activeTab === 'fleet' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <FleetManagement />
            </div>
          )}

          {activeTab === 'entries' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-white px-4 py-2 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-2">
                    <Timer className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-black text-slate-900 uppercase">Turno {getCurrentShift()}</span>
                  </div>
                </div>
              </div>

              {/* SECTION: AVAILABLE MACHINES */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <h2 className="text-xs font-black text-slate-900 uppercase tracking-[0.25em]">Máquinas Disponíveis</h2>
                  </div>
                  <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase">
                    {availableForkliftsList.length} unidades
                  </span>
                </div>
                
                <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
                  {availableForkliftsList.length === 0 ? (
                    <div className="w-full py-8 text-center bg-white rounded-3xl border border-slate-100 border-dashed">
                      <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic">Nenhuma máquina disponível no momento</p>
                    </div>
                  ) : (
                    availableForkliftsList.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          setQuickLinkForklift(f);
                          setSelectedForkliftId(f.id);
                        }}
                        className="flex-shrink-0 w-40 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-slate-200/60 hover:-translate-y-1 transition-all group text-left"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-900 font-black text-xs group-hover:bg-slate-900 group-hover:text-white transition-colors uppercase">
                            {f.serialNumber.slice(-2)}
                          </div>
                          <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-500">
                             <Plus className="w-3.5 h-3.5" />
                          </div>
                        </div>
                        <p className="text-[10px] font-black text-slate-900 uppercase truncate mb-0.5">{f.model}</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none">{f.serialNumber}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {isShiftFinalized && (
                <div className="bg-green-50 border border-green-200 p-6 rounded-[2rem] flex items-center gap-4 animate-in fade-in slide-in-from-top-4">
                  <div className="bg-green-100 p-3 rounded-2xl text-green-600">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-green-900 tracking-tight">Turno Finalizado</p>
                    <p className="text-xs text-green-700 font-medium italic">Todos os apontamentos deste turno foram consolidados.</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* START OF ACTIVITY CARDS */}
                {[
                  { id: 'tirar_producao', label: 'Tirar Produção', icon: <Package className="w-6 h-6 text-emerald-600" /> },
                  { id: 'quebra', label: 'Quebra / Retrabalho', icon: <Layers className="w-6 h-6 text-blue-600" /> },
                  { id: 'emblocamento', label: 'Emblocamento', icon: <BoxSelect className="w-6 h-6 text-purple-600" /> },
                  { id: 'carregamento', label: 'Carregamento', icon: <Truck className="w-6 h-6 text-amber-600" /> }
                ].map((op) => (
                  <div key={op.id} className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-500">
                    <div className="p-5 md:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 md:w-14 md:h-14 bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex items-center justify-center">
                          {op.icon}
                        </div>
                        <div>
                          <h3 className="text-sm md:text-base font-black text-slate-900 uppercase tracking-tight">{op.label}</h3>
                          <p className="text-[10px] font-bold text-slate-400">Total Produção (Apuramento)</p>
                        </div>
                      </div>
 
                      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                        <button 
                          onClick={() => {
                            setPendingAction('consolidation' as any);
                            setActiveModalForkliftId('system_consolidated');
                            setOperationType(op.id as AppOperationType);
                            setModalProduction('');
                            setShowProductionModal(true);
                          }}
                          className="flex items-center justify-center gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-emerald-600 hover:border-emerald-200 transition-all shadow-sm"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="text-[10px] font-black uppercase tracking-widest leading-none">Finalizar</span>
                        </button>
                        
                        <button 
                          onClick={() => {
                            setPendingAction('occurrence');
                            setActiveModalForkliftId(`global_${op.id}`);
                            setOperationType(op.id as AppOperationType);
                            setShowProductionModal(true);
                          }}
                          disabled={!!globalStops[op.id]}
                          className={cn(
                            "flex items-center justify-center gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-xl transition-all shadow-sm",
                            globalStops[op.id]
                              ? "text-slate-300 cursor-not-allowed border-slate-100"
                              : "text-slate-500 hover:text-red-600 hover:border-red-200"
                          )}
                        >
                          <Pause className="w-4 h-4" />
                          <span className="text-[10px] font-black uppercase tracking-widest leading-none">Parada</span>
                        </button>

                        <button 
                          onClick={() => setAssigningToOp(op.id as AppOperationType)}
                          disabled={!!globalStops[op.id]}
                          className={cn(
                            "col-span-2 sm:col-auto flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl transition-all shadow-lg",
                            globalStops[op.id] 
                              ? "bg-slate-100 text-slate-300 cursor-not-allowed shadow-none"
                              : "bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/20"
                          )}
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-[10px] font-black uppercase tracking-widest leading-none">incluir Máquina</span>
                        </button>
                      </div>
                    </div>
 
                    <div className="flex-1 p-4 md:p-6 space-y-3 bg-white">
                      {globalStops[op.id] && (
                        <div className="mb-4 bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                           <div className="flex items-center gap-3">
                             <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center text-red-600">
                               <AlertTriangle className="w-5 h-5" />
                             </div>
                             <div>
                               <p className="text-[10px] font-black text-red-900 uppercase tracking-tight">Operação Parada</p>
                               <p className="text-[11px] font-bold text-red-600 uppercase italic">Motivo: {getStopReasonLabel(globalStops[op.id]?.stopReason)}</p>
                             </div>
                           </div>
                           <button 
                             disabled={isUploading}
                             onClick={async () => {
                               if (!profile) return;
                               setIsUploading(true);
                               try {
                                 const eventData = {
                                   forkliftId: `global_${op.id}`,
                                   operatorIds: [],
                                   operatorNames: [],
                                   operationType: op.id as AppOperationType,
                                   action: 'resume' as const,
                                   timestamp: new Date().toISOString(),
                                   shift: getCurrentShift(),
                                   leaderId: profile.uid,
                                   leaderName: profile.displayName || profile.email || 'Líder'
                                 };
                                 await addDoc(collection(db, 'operational_events'), eventData);
                                 showToast(`Atividade "${op.label}" liberada.`, 'success');
                               } catch (err) {
                                 console.error("Error releasing global stop:", err);
                                 showToast('Erro ao liberar atividade.', 'error');
                               } finally {
                                 setIsUploading(false);
                               }
                             }}
                             className="px-4 py-2 bg-white border border-red-200 rounded-xl text-[10px] font-black text-red-700 uppercase hover:bg-red-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                           >
                             {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Liberar'}
                           </button>
                        </div>
                      )}

                      {activeOperationsByType[op.id].length === 0 ? (
                        <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-slate-100 rounded-[2rem] gap-3">
                          <Activity className="w-8 h-8 text-slate-100" />
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic text-center">Nenhuma máquina ativa</p>
                        </div>
                      ) : (
                        activeOperationsByType[op.id].map((activeOp) => {
                          const machine = forklifts.find(f => f.id === activeOp.forkliftId);
                          return (
                            <div key={activeOp.id} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between group hover:bg-white hover:shadow-xl hover:shadow-slate-200/40 transition-all border-l-4 border-l-slate-900 gap-4">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm font-black text-slate-900 text-xs shrink-0">
                                  {machine?.serialNumber.slice(-2)}
                                </div>
                                <div className="space-y-0.5 overflow-hidden">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black text-slate-900 uppercase truncate">{machine?.model}</span>
                                    <span className="text-[8px] font-bold text-slate-400 bg-slate-200/50 px-1.5 rounded uppercase">{machine?.serialNumber}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Users className="w-3 h-3 text-slate-400" />
                                    <span className="text-[9px] font-bold text-slate-500 truncate">
                                      {activeOp.operatorNames.join(', ')}
                                    </span>
                                  </div>
                                </div>
                              </div>
 
                              <div className="flex items-center justify-between sm:justify-end gap-3 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/50">
                                <div className="text-left sm:text-right mr-2">
                                  <p className="text-[8px] font-black text-slate-400 uppercase leading-none">Desde</p>
                                  <p className="text-[10px] font-bold text-slate-900 mt-0.5">{formatTime(activeOp.timestamp)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => {
                                      setActiveModalForkliftId(activeOp.forkliftId);
                                      setPendingAction('change');
                                      setShowProductionModal(true);
                                    }}
                                    className="w-9 h-9 md:w-10 md:h-10 bg-white border border-slate-200 text-slate-400 rounded-lg flex items-center justify-center hover:text-blue-600 hover:border-blue-200 transition-all"
                                  >
                                    <Layers className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setActiveModalForkliftId(activeOp.forkliftId);
                                      setPendingAction('stop');
                                      setShowProductionModal(true);
                                    }}
                                    className="w-9 h-9 md:w-10 md:h-10 bg-white border border-slate-200 text-slate-400 rounded-lg flex items-center justify-center hover:text-amber-600 hover:border-amber-200 transition-all"
                                  >
                                    <Pause className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    
                    <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2">Total Acumulado</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-black text-slate-700">
                          {events
                            .filter(e => 
                              e.operationType === op.id && 
                              e.shift === getCurrentShift() && 
                              typeof e.timestamp === 'string' &&
                              e.timestamp.startsWith(new Date().toISOString().split('T')[0])
                            )
                            .reduce((acc, e) => acc + (e.production || 0), 0)}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">fardos</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Assignment Modal (Overlay) */}
              {assigningToOp && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setAssigningToOp(null)} />
                  <div className="relative bg-white w-full max-w-xl rounded-[2.5rem] md:rounded-[3.5rem] shadow-2xl p-6 md:p-10 animate-in fade-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
                    <div className="text-center mb-6 md:mb-8">
                       <div className="w-16 h-16 md:w-20 md:h-20 bg-slate-900 text-white rounded-[1.5rem] md:rounded-[2.5rem] flex items-center justify-center mx-auto mb-4 md:mb-6 shadow-2xl shadow-slate-900/40">
                         <Play className="w-8 h-8 md:w-10 md:h-10 ml-1" />
                       </div>
                       <h3 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight uppercase">Iniciar OPERAÇÃO</h3>
                       <p className="text-slate-500 font-bold uppercase text-[9px] md:text-[10px] tracking-widest mt-1">
                        {assigningToOp === 'tirar_producao' ? 'Tirar Produção' : 
                         assigningToOp === 'quebra' ? 'Quebra / Retrabalho' :
                         assigningToOp === 'emblocamento' ? 'Emblocamento' : 'Carregamento'}
                       </p>
                    </div>

                    <div className="space-y-6 md:space-y-8">
                      <div className="space-y-2 md:space-y-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Selecionar MÁQUINA Disponível</label>
                        <select
                          className="w-full p-4 md:p-5 bg-slate-50 border border-slate-200 rounded-2xl md:rounded-3xl text-sm font-bold outline-none ring-offset-2 focus:ring-4 focus:ring-slate-900/5 transition-all appearance-none"
                          value={selectedForkliftId}
                          onChange={(e) => setSelectedForkliftId(e.target.value)}
                        >
                          <option value="">Escolha uma...</option>
                          {uniqueForklifts.filter(f => !busyForkliftIds.has(f.id)).map(f => (
                            <option key={f.id} value={f.id}>{f.model} • {f.serialNumber}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Selecionar EQUIPE (Máx 2)</label>
                          <div className="relative">
                             <input 
                               type="text"
                               placeholder="BUSCAR NOME..."
                               className="bg-slate-100 border-none rounded-lg px-3 py-1 text-[9px] font-black uppercase outline-none focus:ring-2 focus:ring-slate-400 w-32"
                               value={operatorSearch}
                               onChange={(e) => setOperatorSearch(e.target.value)}
                             />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[30vh] md:max-h-[25vh] overflow-y-auto p-1 no-scrollbar">
                          {uniqueOperators
                            .filter(op => 
                              !operatorSearch || 
                              op.displayName?.toLowerCase().includes(operatorSearch.toLowerCase()) || 
                              op.email?.toLowerCase().includes(operatorSearch.toLowerCase())
                            )
                            .map(op => {
                            const isBusy = busyOperatorIds.has(op.uid);
                            const isSelected = selectedOperatorIds.includes(op.uid);
                            return (
                              <button
                                key={op.uid}
                                disabled={isBusy && !isSelected}
                                onClick={() => handleToggleOperator(op.uid)}
                                className={cn(
                                  "p-3 md:p-4 rounded-2xl md:rounded-3xl border-2 flex items-center gap-3 transition-all text-left",
                                  isSelected 
                                    ? "bg-slate-900 border-slate-900 text-white shadow-xl translate-y-[-2px]" 
                                    : "bg-white border-slate-100 text-slate-600 hover:border-slate-200",
                                  isBusy && !isSelected && "opacity-40 grayscale pointer-events-none"
                                )}
                              >
                                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] uppercase", isSelected ? "bg-white/20" : "bg-slate-50")}>
                                  {op.displayName?.slice(0, 2) || op.email?.slice(0, 2)}
                                </div>
                                <span className="text-[10px] font-black uppercase truncate leading-tight">
                                  {op.displayName || op.email?.split('@')[0]}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      
                      <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                        <button 
                          onClick={() => setAssigningToOp(null)}
                          className="w-full sm:flex-1 py-4 md:py-5 rounded-2xl md:rounded-3xl font-black text-[11px] uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-all"
                        >
                          Cancelar
                        </button>
                        <button 
                          disabled={isUploading || !selectedForkliftId || selectedOperatorIds.length === 0}
                          onClick={async () => {
                            const targets = [{ forkliftId: selectedForkliftId, operatorIds: selectedOperatorIds }];
                            await handleAction('start', targets, assigningToOp as AppOperationType);
                            setAssigningToOp(null);
                            setSelectedForkliftId('');
                            setSelectedOperatorIds([]);
                          }}
                          className={cn(
                            "w-full sm:flex-[1.5] py-4 md:py-5 rounded-2xl md:rounded-3xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all shadow-2xl",
                            (!selectedForkliftId || selectedOperatorIds.length === 0)
                              ? "bg-slate-100 text-slate-300 shadow-none cursor-not-allowed"
                              : "bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/30"
                          )}
                        >
                          {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 ml-1" />}
                          Confirmar Início
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Link Activity Selection Modal */}
              {quickLinkForklift && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => {
                    setQuickLinkForklift(null);
                    setSelectedForkliftId('');
                  }} />
                  <div className="relative bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-6 md:p-8 animate-in fade-in zoom-in-95 duration-300 border border-slate-100">
                    <div className="text-center mb-6">
                      <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
                        <Plus className="w-6 h-6" />
                      </div>
                      <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Vincular Atividade</h3>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                        Máquina: {quickLinkForklift.model} ({quickLinkForklift.serialNumber})
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2 mb-6">
                      {[
                        { id: 'tirar_producao', label: 'Tirar Produção', icon: <Package className="w-4 h-4" />, bg: 'bg-emerald-500' },
                        { id: 'quebra', label: 'Quebra / Retrabalho', icon: <Layers className="w-4 h-4" />, bg: 'bg-blue-500' },
                        { id: 'emblocamento', label: 'Emblocamento', icon: <BoxSelect className="w-4 h-4" />, bg: 'bg-purple-500' },
                        { id: 'carregamento', label: 'Carregamento', icon: <Truck className="w-4 h-4" />, bg: 'bg-amber-500' }
                      ].map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            setAssigningToOp(item.id as AppOperationType);
                            setQuickLinkForklift(null);
                          }}
                          className="flex items-center justify-between p-4 bg-slate-50 hover:bg-white border border-slate-100 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/40 rounded-2xl transition-all group"
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm",
                              item.bg
                            )}>
                              {item.icon}
                            </div>
                            <span className="text-[10px] font-black text-slate-700 uppercase tracking-tight">{item.label}</span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        setQuickLinkForklift(null);
                        setSelectedForkliftId('');
                      }}
                      className="w-full py-3 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] hover:bg-slate-50 rounded-xl transition-all"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'report_occurrence' && (
            <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl space-y-8">
                <div className="flex flex-col items-center text-center space-y-2">
                  <div className="w-16 h-16 bg-orange-50 rounded-[2rem] flex items-center justify-center text-orange-500 mb-2">
                    <AlertTriangle className="w-8 h-8" />
                  </div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">Nova Ocorrência</h2>
                  <p className="text-sm font-medium text-slate-500">Registre problemas técnicos ou incidentes em tempo real</p>
                </div>

                <div className="space-y-6">
                   <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Vínculo de Máquina</label>
                    <select
                      value={selectedForkliftId}
                      onChange={(e) => setSelectedForkliftId(e.target.value)}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/10 outline-none transition-all appearance-none cursor-pointer"
                    >
                      <option value="">Selecione a Empilhadeira</option>
                      {uniqueForklifts.map(f => (
                        <option key={f.id} value={f.id}>{f.model} • {f.serialNumber}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Equipe de Operação ({selectedOperatorIds.length})</label>
                    <div className="flex flex-wrap gap-2 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                      {uniqueOperators.filter(o => selectedOperatorIds.includes(o.uid)).map(o => (
                        <span key={o.uid} className="bg-slate-900 text-white px-3 py-1 rounded-lg text-[10px] font-black uppercase">
                          {o.displayName || o.email?.split('@')[0]}
                        </span>
                      ))}
                      {selectedOperatorIds.length === 0 && <span className="text-slate-400 text-[10px] font-bold italic">Nenhum operador selecionado</span>}
                    </div>
                  </div>

                    <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Tipo de Ocorrência</label>
                    <div className="grid grid-cols-2 gap-2">
                       {[
                         { id: 'chuva', label: 'Chuva', icon: <CloudRain className="w-4 h-4" /> },
                         { id: 'sem_producao', label: 'Sem Prod.', icon: <BoxSelect className="w-4 h-4" /> },
                         { id: 'sem_classificacao', label: 'S/ Classif.', icon: <BoxSelect className="w-4 h-4" /> },
                         { id: 'sem_caminhao', label: 'S/ Caminhão', icon: <Truck className="w-4 h-4" /> },
                         { id: 'algodoeira', label: 'Algodoeira', icon: <Package className="w-4 h-4" /> },
                         { id: 'mecanico', label: 'Mecânico', icon: <Wrench className="w-4 h-4" /> },
                         { id: 'entre_safra', label: 'Entre Safra', icon: <Leaf className="w-4 h-4" /> },
                         { id: 'intervalo', label: 'Intervalo', icon: <Timer className="w-4 h-4" /> },
                         { id: 'outro', label: 'Outro', icon: <HelpCircle className="w-4 h-4" /> }
                       ].map((reason) => (
                         <button
                           key={reason.id}
                           onClick={() => setStopReason(reason.id as LowProductionReason)}
                           className={cn(
                             "flex items-center gap-2 p-3 rounded-xl border text-[10px] font-black uppercase tracking-tighter transition-all text-left",
                             stopReason === reason.id 
                               ? "bg-slate-900 border-slate-900 text-white shadow-lg" 
                               : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                           )}
                         >
                           {reason.icon}
                           {reason.label}
                         </button>
                       ))}
                    </div>
                  </div>

                  <div className="space-y-3 pt-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Nível de Severidade</label>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { id: 'low', label: 'Reparo (Operando)', icon: <Wrench className="w-4 h-4" />, color: 'blue', status: 'Operando' },
                        { id: 'medium', label: 'Falha Iminente (Risco)', icon: <AlertTriangle className="w-4 h-4" />, color: 'amber', status: 'Operando com risco' },
                        { id: 'high', label: 'Parada (Indisponível)', icon: <Ban className="w-4 h-4" />, color: 'red', status: 'Máquina Indisponível' }
                      ].map(sev => (
                        <button
                          key={sev.id}
                          onClick={() => setSeverity(sev.id as OccurrenceSeverity)}
                          className={cn(
                            "flex items-center gap-3 p-4 rounded-2xl border transition-all text-left",
                            severity === sev.id 
                              ? "bg-slate-900 border-slate-900 text-white shadow-xl translate-y-[-2px]" 
                              : "border-slate-200 bg-white hover:border-slate-300"
                          )}
                        >
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center",
                            severity === sev.id ? "bg-white/10" : "bg-slate-50 text-slate-400"
                          )}>
                            {sev.icon}
                          </div>
                          <div>
                            <p className="text-[10px] font-black leading-none uppercase">{sev.label}</p>
                            <p className={cn("text-[9px] font-bold mt-1 uppercase", severity === sev.id ? "text-slate-300" : "text-slate-500")}>
                              {sev.status}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setIsOccurrence(true);
                      handleAction('stop');
                    }}
                    disabled={isUploading || !selectedForkliftId || selectedOperatorIds.length === 0 || !stopReason}
                    className="w-full py-4 bg-orange-600 text-white rounded-[1.5rem] font-black uppercase text-xs tracking-widest shadow-xl shadow-orange-100 hover:bg-orange-700 transition-all disabled:opacity-50 disabled:grayscale"
                  >
                    {isUploading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Confirmar Ocorrência'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'occurrences' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden">
                <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">Ocorrências Ativas</h2>
                    <p className="text-sm font-medium text-slate-500 italic">Equipamentos parados ou aguardando reparo</p>
                  </div>
                  <span className="bg-blue-600 text-white text-[10px] font-black px-4 py-2 rounded-xl">
                    {activeStops.length} ATIVAS
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {activeStops.map(stop => {
                    const directForklift = forklifts.find(f => f.id === stop.forkliftId);
                    const forklift = uniqueForklifts.find(f => f.serialNumber?.trim().toLowerCase() === directForklift?.serialNumber?.trim().toLowerCase()) || directForklift;
                    const isAwaitingParts = stop.status === 'awaiting_parts';
                    
                    return (
                      <div key={stop.id} className={cn(
                        "p-6 hover:bg-slate-50 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4",
                        isAwaitingParts && "bg-amber-50/20"
                      )}>
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-12 h-12 rounded-2xl flex items-center justify-center text-white",
                            isAwaitingParts ? "bg-amber-500" :
                            stop.severity === 'high' ? "bg-red-500" : 
                            stop.severity === 'medium' ? "bg-amber-500" : "bg-blue-500"
                          )}>
                            {isAwaitingParts ? <PauseCircle className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                          </div>
                          <div>
                             <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-slate-900">{forklift?.model} ({forklift?.serialNumber})</span>
                              <span className={cn(
                                "text-[10px] px-2 py-0.5 rounded-full font-black uppercase",
                                stop.severity === 'high' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                              )}>
                                {stop.severity === 'high' ? 'Parada Crítica' : 'Atenção'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 font-medium italic mt-1 leading-tight">
                              "{stop.description}"
                            </p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                              {stop.operatorName} • {stop.stopTime ? (
                                typeof stop.stopTime === 'string' 
                                  ? `${formatDate(stop.stopTime)} ${formatTime(stop.stopTime)}`
                                  : (stop.stopTime as any).toDate?.().toLocaleString() || '-'
                              ) : '-'}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                           <div className={cn(
                             "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest",
                             isAwaitingParts ? "bg-amber-600 text-white" :
                             stop.status === 'in_progress' ? "bg-blue-500 text-white" :
                             "bg-slate-100 text-slate-400"
                           )}>
                             {isAwaitingParts ? 'Aguardando Peça' : 
                              stop.status === 'in_progress' ? 'Em Manutenção' : 
                              'Aguardando Mecânico'}
                           </div>
                           {isAwaitingParts && stop.pendingPartsList && (
                             <div className="flex flex-wrap justify-end gap-1 max-w-[200px]">
                               {stop.pendingPartsList.map((p, i) => (
                                 <span key={i} className="text-[8px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase">{p}</span>
                               ))}
                             </div>
                           )}
                        </div>
                      </div>
                    );
                  })}
                  {activeStops.length === 0 && (
                    <div className="p-12 text-center text-slate-400 font-bold italic opacity-40">
                      Nenhuma ocorrência ativa no momento.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden">
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">Histórico Geral</h2>
                    <p className="text-sm font-medium text-slate-500 italic">Todos os eventos operacionais recentes</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                   <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 font-black uppercase tracking-widest text-[10px] text-slate-400">
                        <th className="px-8 py-4 font-black">Timestamp</th>
                        <th className="px-8 py-4 font-black">Recurso</th>
                        <th className="px-8 py-4 font-black">Operador</th>
                        <th className="px-8 py-4 font-black">Evento</th>
                        <th className="px-8 py-4 font-black text-right">Info Adicional</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {events.map((event) => {
                        const directForklift = forklifts.find(f => f.id === event.forkliftId);
                        const forklift = uniqueForklifts.find(f => f.serialNumber?.trim().toLowerCase() === directForklift?.serialNumber?.trim().toLowerCase()) || directForklift;
                        return (
                        <tr key={event.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-8 py-6">
                            <span className="block text-xs font-black text-slate-900">
                              {formatDate(event.timestamp)}
                            </span>
                            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                              {formatTime(event.timestamp)}
                            </span>
                          </td>
                          <td className="px-8 py-6">
                            <span className="text-xs font-black text-slate-900">
                              {event.forkliftId.startsWith('global_') 
                                ? 'STATUS OPERAÇÃO' 
                                : (event.forkliftId === 'system_consolidated' ? 'SISTEMA' : (forklift?.model || 'Máquina'))}
                            </span>
                            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                              {event.forkliftId.startsWith('global_') 
                                ? event.operationType.replace('_', ' ') 
                                : (forklift?.serialNumber || (event.forkliftId === 'system_consolidated' ? 'CONSOLIDAÇÃO' : ''))}
                            </span>
                          </td>
                          <td className="px-8 py-6">
                            <span className="text-xs font-black text-slate-900">
                              {event.operatorNames && event.operatorNames.length > 0 
                                ? event.operatorNames.join(', ') 
                                : (event.operatorName || 'Líder / Sistema')}
                            </span>
                            <span className="block text-[10px] font-bold text-slate-400 uppercase">Turno {event.shift}</span>
                          </td>
                          <td className="px-8 py-6">
                             <div className={cn(
                               "inline-flex items-center gap-2 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest",
                               getActionColor(event.action)
                             )}>
                               {getActionIcon(event.action)}
                               {event.action.replace('_', ' ')}
                             </div>
                          </td>
                          <td className="px-8 py-6 text-right">
                            {event.production ? (
                              <span className="text-xs font-black text-green-600">+{event.production} Fardos</span>
                            ) : event.stopReason ? (
                              <span className="text-[10px] font-bold text-amber-600 uppercase tracking-tight">{getStopReasonLabel(event.stopReason)}</span>
                            ) : '-'}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                   </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Production Modal */}
      {showProductionModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200 max-h-[95vh] flex flex-col">
            <div className="p-6 overflow-y-auto no-scrollbar flex-1 space-y-6 text-center">
              <div className="flex justify-end">
                <button onClick={() => setShowProductionModal(false)} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mx-auto w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
                <Package className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">
                  {pendingAction === 'stop' || pendingAction === 'occurrence' ? 'Parar Atividade' : pendingAction === 'consolidation' as any ? 'Lançar Produção' : 'Trocar Atividade'}
                </h3>
                <p className="text-slate-500 text-sm font-medium mt-1">
                  {(pendingAction === 'stop' || pendingAction === 'occurrence') ? 'Selecione o motivo da parada:' : 
                   pendingAction === 'change' ? 'Selecione a nova atividade:' :
                   'Informe o total de produção apurado:'}
                </p>
                <span className="inline-block mt-2 px-3 py-1 bg-slate-100 text-slate-700 text-[10px] font-black uppercase rounded-lg border border-slate-200">
                  {activeModalForkliftId === 'system_consolidated' 
                    ? operationType?.replace('_', ' ') 
                    : activeModalForkliftId?.startsWith('global_')
                        ? 'Status Global: ' + operationType?.replace('_', ' ')
                        : forklifts.find(f => f.id === activeModalForkliftId)?.serialNumber}
                </span>

                {(pendingAction === 'stop' || pendingAction === 'occurrence') && (
                  <div className="mt-8 space-y-4 text-left animate-in fade-in slide-in-from-top-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 italic">Motivo da Parada *</label>
                    <div className="grid grid-cols-2 gap-2">
                       {[
                         { id: 'chuva', label: 'Chuva', icon: <CloudRain className="w-4 h-4" /> },
                         { id: 'sem_producao', label: 'Sem Prod.', icon: <BoxSelect className="w-4 h-4" /> },
                         { id: 'sem_classificacao', label: 'S/ Classif.', icon: <BoxSelect className="w-4 h-4" /> },
                         { id: 'sem_caminhao', label: 'S/ Caminhão', icon: <Truck className="w-4 h-4" /> },
                         { id: 'algodoeira', label: 'Algodoeira', icon: <Package className="w-4 h-4" /> },
                         { id: 'mecanico', label: 'Mecânico', icon: <Wrench className="w-4 h-4" /> },
                         { id: 'entre_safra', label: 'Entre Safra', icon: <Leaf className="w-4 h-4" /> },
                         { id: 'intervalo', label: 'Intervalo', icon: <Timer className="w-4 h-4" /> },
                         { id: 'outro', label: 'Outro', icon: <HelpCircle className="w-4 h-4" /> }
                       ].map((reason) => (
                         <button
                           key={reason.id}
                           type="button"
                           onClick={() => setStopReason(reason.id as LowProductionReason)}
                           className={cn(
                             "flex items-center gap-2 p-3 rounded-xl border text-[10px] font-black uppercase tracking-tighter transition-all",
                             stopReason === reason.id 
                               ? "bg-amber-600 border-amber-600 text-white shadow-lg shadow-amber-200" 
                               : "bg-slate-50 border-slate-200 text-slate-400 hover:border-amber-200"
                           )}
                         >
                           {reason.icon}
                           {reason.label}
                         </button>
                       ))}
                    </div>
                  </div>
                )}

                {pendingAction === 'change' && (
                  <div className="mt-8 space-y-4 text-left animate-in fade-in slide-in-from-top-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nova Atividade *</label>
                    <div className="grid grid-cols-2 gap-2">
                       {[
                         { id: 'tirar_producao', label: 'Produção', icon: <Package className="w-4 h-4" /> },
                         { id: 'quebra', label: 'Quebra', icon: <Activity className="w-4 h-4" /> },
                         { id: 'emblocamento', label: 'Emblocam.', icon: <Layers className="w-4 h-4" /> },
                         { id: 'carregamento', label: 'Carregar', icon: <Truck className="w-4 h-4" /> }
                       ].map((op) => (
                         <button
                           key={op.id}
                           type="button"
                           onClick={() => setModalNextOperationType(op.id as AppOperationType)}
                           className={cn(
                             "flex items-center gap-2 p-3 rounded-xl border text-[10px] font-black uppercase tracking-tighter transition-all",
                             modalNextOperationType === op.id 
                               ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200" 
                               : "bg-slate-50 border-slate-200 text-slate-400 hover:border-blue-200"
                           )}
                         >
                           {op.icon}
                           {op.label}
                         </button>
                       ))}
                    </div>
                  </div>
                )}
              </div>

              {(pendingAction === 'consolidation' as any) && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Fardos Produzidos</label>
                  <input
                    type="number"
                    autoFocus
                    value={modalProduction}
                    onChange={(e) => setModalProduction(e.target.value)}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-3xl text-3xl font-black text-center outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                    placeholder="0"
                  />
                  <p className="text-[10px] text-slate-400 font-medium italic">Se não houve produção, informe 0.</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowProductionModal(false);
                    setPendingAction(null);
                  }}
                  className="p-4 rounded-2xl border border-slate-200 text-slate-500 font-bold text-sm hover:bg-slate-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (pendingAction === 'consolidation' as any) {
                      const val = parseInt(modalProduction);
                      if (isNaN(val) || val < 0) {
                        showToast('Informe um valor válido.', 'error');
                        return;
                      }
                      try {
                        setIsUploading(true);
                        const path = 'operational_events';
                        const currentShift = getCurrentShift();
                        const consolidationTimestamp = new Date().toISOString();

                        const docData = {
                          forkliftId: 'system_consolidated',
                          operatorIds: [],
                          operatorNames: ['Consolidação Global'],
                          operationType: operationType || 'tirar_producao',
                          action: 'consolidation',
                          production: val,
                          timestamp: consolidationTimestamp,
                          shift: currentShift,
                          leaderId: profile!.uid,
                          leaderName: profile?.displayName || profile?.email || 'Líder'
                        };
                        
                        await addDoc(collection(db, path), docData);

                        const machinesToStop = activeOperationsByType[operationType || 'tirar_producao'];
                        for (const opToStop of machinesToStop) {
                          const { id: _, ...opData } = opToStop;

                          await addDoc(collection(db, 'operational_events'), {
                            ...opData,
                            action: 'stop',
                            timestamp: consolidationTimestamp,
                            stopReason: 'consolidacao',
                            production: 0, // Production already consolidated globally
                            leaderId: profile!.uid,
                            leaderName: profile?.displayName || profile?.email || 'Líder'
                          });

                          // CRITICAL FIX: Also update the forklift status to available
                          if (opData.forkliftId) {
                            await updateDoc(doc(db, 'forklifts', opData.forkliftId), {
                              status: 'available',
                              lastUpdate: consolidationTimestamp
                            });
                          }
                        }

                        showToast(`Lançado ${val} fardos e máquinas liberadas em ${operationType?.replace('_', ' ') || 'Produção'}`, 'success');
                        setShowProductionModal(false);
                        setModalProduction('');
                        refreshGlobalData();
                      } catch (error: any) {
                         console.error('Consolidation error:', error);
                         if (error?.code === 'resource-exhausted' || error?.message?.includes('Quota exceeded')) {
                           setQuotaExceeded(true);
                         }
                         handleFirestoreError(error, FirestoreOperationType.CREATE, 'operational_events');
                      } finally {
                        setIsUploading(false);
                      }
                      return;
                    }

                    if (pendingAction) {
                      if (activeModalForkliftId?.startsWith('global_')) {
                        handleAction(pendingAction, [{ forkliftId: activeModalForkliftId, operatorIds: [] }], operationType as AppOperationType);
                        setShowProductionModal(false);
                        setPendingAction(null);
                        setStopReason('');
                      } else {
                        const op = activeOperations.find(o => o.forkliftId === activeModalForkliftId);
                        if (op) {
                          handleAction(pendingAction, [{ forkliftId: op.forkliftId, operatorIds: op.operatorIds }]);
                          setShowProductionModal(false);
                          setPendingAction(null);
                        }
                      }
                    }
                  }}
                  disabled={((pendingAction === 'stop' || pendingAction === 'occurrence') && !stopReason) || (pendingAction === 'change' && !modalNextOperationType) || (pendingAction === 'consolidation' as any && !modalProduction)}
                  className="p-4 rounded-2xl bg-slate-900 text-white font-bold text-sm shadow-xl shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shift Summary Modal */}
      {showShiftSummaryModal && shiftSummary && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 space-y-8">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">Resumo do Turno</h3>
                  <p className="text-slate-500 font-medium italic">Consolidado operacional antes do fechamento</p>
                </div>
                <div className="bg-green-50 px-4 py-2 rounded-2xl border border-green-100">
                  <span className="text-[10px] font-black text-green-700 uppercase">Turno {shiftSummary.shift}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center gap-3">
                  <Users className="w-5 h-5 text-blue-500" />
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase">Equipe de Operação</p>
                    <p className="text-xs font-bold text-slate-900">
                      {operators.filter(o => selectedOperatorIds.includes(o.uid)).map(o => o.displayName || o.email?.split('@')[0]).join(', ') || 'Sem operadores'}
                    </p>
                  </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center gap-3">
                  <Truck className="w-5 h-5 text-indigo-500" />
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase">Máquina</p>
                    <p className="text-xs font-bold text-slate-900">
                      {forklifts.find(f => f.id === shiftSummary.forkliftId)?.model} ({forklifts.find(f => f.id === shiftSummary.forkliftId)?.serialNumber})
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Activity className="w-3 h-3" /> Métricas Consolidadas
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 bg-white border border-slate-100 rounded-2xl text-center shadow-sm">
                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Tempo Produtivo</p>
                    <p className="text-lg font-black text-slate-900">{formatDuration(shiftSummary.totalProductiveMinutes! * 60000)}</p>
                  </div>
                  <div className="p-4 bg-white border border-slate-100 rounded-2xl text-center shadow-sm">
                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Tempo Parado</p>
                    <p className="text-lg font-black text-slate-900">{formatDuration(shiftSummary.totalDowntimeMinutes! * 60000)}</p>
                  </div>
                  <div className="p-4 bg-white border border-slate-100 rounded-2xl text-center shadow-sm">
                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Intervalo</p>
                    <p className="text-lg font-black text-blue-600">{formatDuration((shiftSummary as any).totalIntervalMinutes! * 60000)}</p>
                  </div>
                  <div className="p-4 bg-white border border-slate-100 rounded-2xl text-center shadow-sm">
                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Produção Total</p>
                    <p className="text-lg font-black text-green-600">{shiftSummary.totalProduction} <span className="text-[8px]">Fardos</span></p>
                  </div>
                  <div className="p-4 bg-white border border-slate-100 rounded-2xl text-center shadow-sm">
                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Paradas</p>
                    <p className="text-lg font-black text-amber-500">{shiftSummary.stopCount}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Timer className="w-3 h-3" /> Distribuição por Operação
                </h4>
                <div className="bg-slate-50 rounded-2xl overflow-hidden border border-slate-100">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-100/50">
                        <th className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase">Operação</th>
                        <th className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase text-center">Tempo</th>
                        <th className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase text-center">Op (Média)</th>
                        <th className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase text-right">Prod.</th>
                        <th className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase text-right">Prod/HM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(shiftSummary.operationsBreakdown || {}).map(([op, data]: [string, any]) => (
                        <tr key={op}>
                          <td className="px-4 py-3 text-[10px] font-bold text-slate-700 uppercase tracking-tight">{op.replace('_', ' ')}</td>
                          <td className="px-4 py-3 text-[10px] font-black text-slate-900 text-center">{formatDuration((data.minutes || 0) * 60000)}</td>
                          <td className="px-4 py-3 text-[10px] font-black text-slate-600 text-center">{data.averageOperators || '-'}</td>
                          <td className="px-4 py-3 text-[10px] font-black text-green-600 text-right">{data.production || 0}</td>
                          <td className="px-4 py-3 text-[10px] font-black text-blue-600 text-right font-mono">{data.productivityPerManHour || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100 space-y-4">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="text-xs font-black text-amber-800 uppercase tracking-tight">Verificação de Horímetro Final</p>
                    <p className="text-[10px] text-amber-600 font-medium">Insira a leitura atual do horímetro para cálculo de horas da máquina.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 items-end">
                   <div className="bg-white p-3 rounded-xl border border-amber-200">
                      <p className="text-[8px] font-black text-slate-400 uppercase">H. Inicial (Checklist)</p>
                      <p className="text-sm font-black text-slate-900">{shiftSummary.initialHourMeter}</p>
                   </div>
                   <div className="relative">
                      <p className="text-[8px] font-black text-amber-500 uppercase mb-1 ml-1">H. Final do Turno *</p>
                      <input 
                        type="number"
                        step="0.1"
                        value={finalHourMeterInput}
                        onChange={(e) => setFinalHourMeterInput(e.target.value)}
                        className="w-full p-3 bg-white border-2 border-amber-200 rounded-xl text-lg font-black text-center outline-none focus:border-amber-500 transition-all text-amber-700"
                        placeholder="0.0"
                      />
                   </div>
                </div>

                {parseFloat(finalHourMeterInput) > (shiftSummary.initialHourMeter || 0) && (
                  <div className="text-center pt-2 border-t border-amber-100">
                    <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                      Tempo de Máquina: <span className="text-sm">{(parseFloat(finalHourMeterInput) - (shiftSummary.initialHourMeter || 0)).toFixed(1)}h</span>
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-4 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowShiftSummaryModal(false)}
                  className="flex-1 p-4 rounded-2xl border border-slate-200 text-slate-500 font-bold text-sm hover:bg-slate-50 transition-all"
                >
                  Voltar e Editar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmFinalize}
                  disabled={isFinalizing}
                  className="flex-1 p-4 rounded-2xl bg-slate-900 text-white font-bold text-sm shadow-xl shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {isFinalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirmar Finalização
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
