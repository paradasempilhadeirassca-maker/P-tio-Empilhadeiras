import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy,
  where,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
  QueryConstraint
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { Checklist, Forklift, MaintenanceStop, UserProfile, OperationalEvent, OperationType as AppOperationType, LowProductionReason, EventAction, ShiftReport, OperationGoal, ShiftType, ForkliftStatus } from '../types';
import { handleFirestoreError, OperationType as FirestoreOp } from '../lib/firebaseErrorHandler';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  LabelList,
  PieChart,
  Pie,
  Legend,
  ComposedChart,
  Line,
} from 'recharts';
import { TrendingUp, Clock, Activity, AlertTriangle, Users, Package, Calendar, Filter, Bell, ClipboardCheck, Watch, Layers, BoxSelect, Truck, CloudRain, Info, ArrowLeft, Target, Settings2, Plus, Save, X, Trash2, History as HistoryIcon } from 'lucide-react';
import { formatDuration, cn } from '../lib/utils';
import { calculateOperatorEfficiency } from '../lib/operationalLogic';
import { sendWhatsAppNotification, sendLocalNotification } from '../lib/notifications';

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];

export function ManagerDashboard() {
  const { profile, loading: authLoading, setQuotaExceeded } = useAuth();
  const { forklifts, activeStops, goals: operationGoals, refreshGlobalData } = useData();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [maintenanceHistory, setMaintenanceHistory] = useState<MaintenanceStop[]>([]);
  const [operationalEvents, setOperationalEvents] = useState<OperationalEvent[]>([]);
  const [shiftReports, setShiftReports] = useState<ShiftReport[]>([]);
  const [lastEventDoc, setLastEventDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreEvents, setHasMoreEvents] = useState(true);
  
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<{operationType: AppOperationType, shift: '1' | '2', value: string} | null>(null);
  
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterForklift, setFilterForklift] = useState<string>('all');
  const [filterOperator, setFilterOperator] = useState<string>('all');
  const [filterShift, setFilterShift] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [useDateFilter, setUseDateFilter] = useState<boolean>(true);
  const [activeView, setActiveView] = useState<'production' | 'mechanical' | 'reports'>('production');

  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async (isLoadMore = false) => {
    if (!profile) return;
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    const cacheKeys = {
      checklists: 'manager_checklists_cache',
      maintenance: 'manager_maintenance_cache',
      events: 'manager_events_cache',
      reports: 'manager_reports_cache'
    };

    setIsRefreshing(true);
    try {
      if (!isLoadMore) {
        await refreshGlobalData();

        // 1. Tentar ler do Cache para carregamento instantâneo
        const cachedChecklists = localStorage.getItem(cacheKeys.checklists);
        const cachedMaintenance = localStorage.getItem(cacheKeys.maintenance);
        const cachedEvents = localStorage.getItem(cacheKeys.events);
        const cachedReports = localStorage.getItem(cacheKeys.reports);

        if (cachedChecklists) {
          const { data, timestamp } = JSON.parse(cachedChecklists);
          if (Date.now() - timestamp < CACHE_DURATION) setChecklists(data);
        }
        if (cachedMaintenance) {
          const { data, timestamp } = JSON.parse(cachedMaintenance);
          if (Date.now() - timestamp < CACHE_DURATION) setMaintenanceHistory(data);
        }
        if (cachedEvents) {
          const { data, timestamp } = JSON.parse(cachedEvents);
          if (Date.now() - timestamp < CACHE_DURATION) setOperationalEvents(data);
        }
        if (cachedReports) {
          const { data, timestamp } = JSON.parse(cachedReports);
          if (Date.now() - timestamp < CACHE_DURATION) setShiftReports(data);
        }
      }

      // 2. Fetch em Background (Back-to-back fetching com limites rígidos)
      
      // Checklists
      const qC = query(collection(db, 'checklists'), orderBy('timestamp', 'desc'), limit(150));
      const cSnap = await getDocs(qC);
      const cData = cSnap.docs.map(d => ({ id: d.id, ...d.data() } as Checklist));
      setChecklists(cData);
      localStorage.setItem(cacheKeys.checklists, JSON.stringify({ data: cData, timestamp: Date.now() }));

      // Maintenance
      const qM = query(collection(db, 'maintenance'), orderBy('stopTime', 'desc'), limit(150));
      const mSnap = await getDocs(qM);
      const mData = mSnap.docs.map(d => ({ id: d.id, ...d.data() } as MaintenanceStop));
      setMaintenanceHistory(mData);
      localStorage.setItem(cacheKeys.maintenance, JSON.stringify({ data: mData, timestamp: Date.now() }));

      // Paginated Events
      const eLimitSize = 250;
      const eQueryContraints: QueryConstraint[] = [orderBy('timestamp', 'desc'), limit(eLimitSize)];
      if (isLoadMore && lastEventDoc) {
        eQueryContraints.push(startAfter(lastEventDoc));
      }

      const qE = query(collection(db, 'operational_events'), ...eQueryContraints);
      const eSnap = await getDocs(qE);
      
      const newEvents = eSnap.docs.map(d => ({ id: d.id, ...d.data() } as OperationalEvent));
      
      let finalEvents: OperationalEvent[];
      if (isLoadMore) {
        finalEvents = [...operationalEvents, ...newEvents].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        setOperationalEvents(finalEvents);
      } else {
        finalEvents = newEvents.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        setOperationalEvents(finalEvents);
      }
      localStorage.setItem(cacheKeys.events, JSON.stringify({ data: finalEvents, timestamp: Date.now() }));

      setLastEventDoc(eSnap.docs[eSnap.docs.length - 1] || null);
      setHasMoreEvents(eSnap.docs.length === eLimitSize);

      // Reports
      const qR = query(collection(db, 'shift_reports'), orderBy('createdAt', 'desc'), limit(30));
      const rSnap = await getDocs(qR);
      const rData = rSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftReport));
      setShiftReports(rData);
      localStorage.setItem(cacheKeys.reports, JSON.stringify({ data: rData, timestamp: Date.now() }));

    } catch (err: any) {
      console.error("Manager Data Fetch Error:", err);
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
  }, [authLoading, profile, setQuotaExceeded]);

  const handleUpdateGoal = async () => {
    if (!editingGoal) return;
    
    const goalValue = parseFloat(editingGoal.value);
    if (isNaN(goalValue)) return;
    const path = 'operation_goals';

    try {
      const q = query(
        collection(db, path), 
        where('operationType', '==', editingGoal.operationType),
        where('shift', '==', editingGoal.shift)
      );
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        await updateDoc(doc(db, path, snapshot.docs[0].id), {
          goal: goalValue,
          updatedAt: new Date().toISOString()
        });
      } else {
        const batch = writeBatch(db);
        const newGoalRef = doc(collection(db, path));
        batch.set(newGoalRef, {
          operationType: editingGoal.operationType,
          shift: editingGoal.shift,
          goal: goalValue,
          updatedAt: new Date().toISOString()
        });
        await batch.commit();
      }
      setEditingGoal(null);
    } catch (error) {
      handleFirestoreError(error, FirestoreOp.WRITE, path);
    }
  };

  const handleResetGoal = async (goalId: string) => {
    try {
      await deleteDoc(doc(db, 'operation_goals', goalId));
    } catch (error) {
      handleFirestoreError(error, FirestoreOp.DELETE, `operation_goals/${goalId}`);
    }
  };

  const uniqueForklifts = useMemo(() => {
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
    
    // Deduplicate by serial using most recent createdAt
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

    return Array.from(fleetMap.values()).sort((a, b) => (a.serialNumber || '').localeCompare(b.serialNumber || ''));
  }, [forklifts, activeStops]);

  const filteredChecklists = useMemo(() => {
    return checklists.filter(cl => {
      const date = new Date(cl.timestamp);
      
      if (useDateFilter) {
        return cl.timestamp.startsWith(filterDate) && 
               (filterForklift === 'all' || cl.forkliftId === filterForklift) &&
               (filterOperator === 'all' || cl.operatorId === filterOperator);
      }

      const matchesYear = date.getFullYear().toString() === filterYear;
      const matchesMonth = filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth;
      const matchesForklift = filterForklift === 'all' || cl.forkliftId === filterForklift;
      const matchesOperator = filterOperator === 'all' || cl.operatorId === filterOperator;
      return matchesYear && matchesMonth && matchesForklift && matchesOperator;
    });
  }, [checklists, filterYear, filterMonth, filterForklift, filterDate, useDateFilter]);

  const filteredHistory = useMemo(() => {
    return maintenanceHistory.filter(h => {
      const date = new Date(h.stopTime);

      if (useDateFilter) {
        return h.stopTime.startsWith(filterDate) && 
               (filterForklift === 'all' || h.forkliftId === filterForklift) &&
               (filterOperator === 'all' || h.operatorId === filterOperator);
      }

      const matchesYear = date.getFullYear().toString() === filterYear;
      const matchesMonth = filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth;
      const matchesForklift = filterForklift === 'all' || h.forkliftId === filterForklift;
      const matchesOperator = filterOperator === 'all' || h.operatorId === filterOperator;
      return matchesYear && matchesMonth && matchesForklift && matchesOperator;
    });
  }, [maintenanceHistory, filterYear, filterMonth, filterForklift, filterDate, useDateFilter]);

  const startDate = useMemo(() => {
    const year = parseInt(filterYear);
    const month = filterMonth === 'all' ? 0 : parseInt(filterMonth) - 1;
    return new Date(year, month, 1).toISOString();
  }, [filterYear, filterMonth]);

  const endDate = useMemo(() => {
    const year = parseInt(filterYear);
    const month = filterMonth === 'all' ? 12 : parseInt(filterMonth);
    return new Date(year, month, 0, 23, 59, 59).toISOString();
  }, [filterYear, filterMonth]);

  const kpis = useMemo(() => {
    // Availability, MTTR, MTBF
    const completed = filteredHistory.filter(h => h.status === 'completed' && h.startTime && h.endTime);
    
    // MTTR: Mean Time To Repair
    const totalRepairTime = completed.reduce((acc, h) => {
      return acc + (new Date(h.endTime!).getTime() - new Date(h.startTime!).getTime());
    }, 0);
    const mttr = completed.length > 0 ? totalRepairTime / completed.length : 0;

    // MTBF: Mean Time Between Failures
    const corrective = completed.filter(h => h.type === 'corrective');
    
    // Calculate total time for the period in days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    const totalTime = diffDays * 24 * 60 * 60 * 1000;

    const mtbf = corrective.length > 0 ? totalTime / corrective.length : totalTime;

    // Availability
    const totalDowntime = filteredHistory
      .reduce((acc, h) => {
        const hEnd = h.endTime ? new Date(h.endTime).getTime() : Date.now();
        return acc + (hEnd - new Date(h.stopTime).getTime());
      }, 0);
    const availability = Math.max(0, Math.min(100, ((totalTime - totalDowntime) / totalTime) * 100));

    return { mttr, mtbf, availability, totalStops: filteredHistory.length, correctiveCount: corrective.length };
  }, [filteredHistory, startDate, endDate]);

  const machinesMissingChecklist = useMemo(() => {
    const machinesWithChecklist = new Set(filteredChecklists.map(c => c.forkliftId));
    return forklifts
      .filter(f => filterForklift === 'all' || f.id === filterForklift)
      .filter(f => f.status === 'available' && !machinesWithChecklist.has(f.id));
  }, [forklifts, filteredChecklists, filterForklift]);

  const handleSendReminders = async () => {
    if (machinesMissingChecklist.length === 0) {
      alert("Todas as máquinas operantes já possuem check-list hoje!");
      return;
    }

    const message = `⚠️ *LEMBRETE DE CHECK-LIST*\n\n` +
      `As seguintes máquinas ainda não realizaram o check-list diário:\n\n` +
      machinesMissingChecklist.map(f => {
        const assigned = f.assignedOperatorNameShift1 ? ` (Resp: ${f.assignedOperatorNameShift1})` : '';
        return `• ${f.model} ${f.serialNumber}${assigned}`;
      }).join('\n') +
      `\n\nFavor realizar a inspeção o quanto antes.`;

    sendLocalNotification(`⚠️ LEMBRETE DE CHECK-LIST`, `Existem ${machinesMissingChecklist.length} máquinas sem check-list hoje.`);
    await sendWhatsAppNotification(message);
    alert("Lembretes enviados!");
  };

  const partsData = useMemo(() => {
    const partsMap: Record<string, number> = {};
    filteredHistory.forEach(h => {
      h.parts?.forEach(p => {
        partsMap[p.name] = (partsMap[p.name] || 0) + p.quantity;
      });
    });
    return Object.entries(partsMap)
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [filteredHistory]);

  const operatorData = useMemo(() => {
    const opMap: Record<string, number> = {};
    filteredHistory.forEach(h => {
      const name = h.operatorName || 'Desconhecido';
      opMap[name] = (opMap[name] || 0) + 1;
    });
    return Object.entries(opMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredHistory]);

  const filteredEvents = useMemo(() => {
    return operationalEvents.filter(e => {
      const date = new Date(e.timestamp);
      
      if (useDateFilter) {
        return e.timestamp.startsWith(filterDate) && 
               (filterForklift === 'all' || e.forkliftId === filterForklift) &&
               (filterOperator === 'all' || (e.operatorIds && e.operatorIds.includes(filterOperator)) || e.operatorId === filterOperator) &&
               (filterShift === 'all' || e.shift === filterShift);
      }

      const matchesYear = date.getFullYear().toString() === filterYear;
      const matchesMonth = filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth;
      const matchesForklift = filterForklift === 'all' || e.forkliftId === filterForklift;
      const matchesOperator = filterOperator === 'all' || (e.operatorIds && e.operatorIds.includes(filterOperator)) || e.operatorId === filterOperator;
      const matchesShift = filterShift === 'all' || e.shift === filterShift;
      return matchesYear && matchesMonth && matchesForklift && matchesOperator && matchesShift;
    });
  }, [operationalEvents, filterYear, filterMonth, filterForklift, filterOperator, filterShift, filterDate, useDateFilter]);

  // Process Events into Time Segments
  const operationStats = useMemo(() => {
    const segments: Record<string, { productiveMinutes: number, downtimeMinutes: number, intervalMinutes: number, production: number, count: number, stops: Record<string, number> }> = {
      'tirar_producao': { productiveMinutes: 0, downtimeMinutes: 0, intervalMinutes: 0, production: 0, count: 0, stops: {} },
      'quebra': { productiveMinutes: 0, downtimeMinutes: 0, intervalMinutes: 0, production: 0, count: 0, stops: {} },
      'emblocamento': { productiveMinutes: 0, downtimeMinutes: 0, intervalMinutes: 0, production: 0, count: 0, stops: {} },
      'carregamento': { productiveMinutes: 0, downtimeMinutes: 0, intervalMinutes: 0, production: 0, count: 0, stops: {} },
    };

    // Group events by forklift
    const forkliftEvents: Record<string, OperationalEvent[]> = {};
    filteredEvents.forEach(e => {
      if (!forkliftEvents[e.forkliftId]) forkliftEvents[e.forkliftId] = [];
      forkliftEvents[e.forkliftId].push(e);
    });

    let totalRecordedMinutes = 0;

    Object.values(forkliftEvents).forEach(fEvents => {
      const timelineEvents = fEvents.filter(e => e.action !== 'occurrence');
      const sorted = [...timelineEvents].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i+1];
        const duration = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / (1000 * 60);
        
        const type = current.operationType;
        if (segments[type]) {
          const isConsolidation = current.action === 'consolidation' || current.forkliftId === 'system_consolidated';
          
          if (current.action === 'stop' || current.action === 'change') {
            if (current.action === 'stop') {
              const isNaturalStop = current.stopReason === 'consolidacao' || current.stopReason === 'finalizacao_turno' || current.stopReason === 'entre_safra';
              if (!isNaturalStop) {
                segments[type].downtimeMinutes += duration;
                if (current.stopReason) {
                  segments[type].stops[current.stopReason] = (segments[type].stops[current.stopReason] || 0) + duration;
                }
              } else if (current.stopReason !== 'entre_safra') {
                // Natural stops except Entre Safra count as productive time context here
                segments[type].productiveMinutes += duration;
              }
              // If Entre Safra, we don't add to productive nor downtime - essentially ignoring the period
            } else {
              segments[type].productiveMinutes += duration;
            }
          } else {
             segments[type].productiveMinutes += duration;
          }
          
          if (current.production) {
            if (isConsolidation) {
              // Special case: for dashboard we don't want to wipe previous data here 
              // but system_consolidated IS the total. 
              // However, since we are iterating per forklift, 
              // the 'system_consolidated' should be handled once.
            } else {
              segments[type].production += current.production;
            }
          }
          segments[type].count += 1;
          totalRecordedMinutes += duration;
        }
      }
    });

    // Handle system_consolidated separately to avoid double counting
    const consolidationEvents = filteredEvents.filter(e => e.forkliftId === 'system_consolidated' || e.action === 'consolidation');
    const consolidatedTotals: Record<string, number> = {};
    consolidationEvents.forEach(e => {
        const key = `${e.operationType}_${e.shift}_${e.timestamp.split('T')[0]}`;
        consolidatedTotals[key] = (consolidatedTotals[key] || 0) + (e.production || 0);
        // Add to production but we must subtract what we added individually
    });

    // For simplicity in this complex segment logic, if any consolidation exists for the type in the filtered view, 
    // we use the consolidation total for production if it's greater than 0
    Object.keys(segments).forEach(type => {
        const typeConsolidations = consolidationEvents.filter(e => e.operationType === type);
        if (typeConsolidations.length > 0) {
            segments[type].production = typeConsolidations.reduce((acc, e) => acc + (e.production || 0), 0);
        }
    });

    const labels: Record<string, string> = {
      'tirar_producao': 'Tirar Produção',
      'quebra': 'Quebra',
      'emblocamento': 'Emblocamento',
      'carregamento': 'Carregamento',
    };

    return Object.entries(segments).map(([key, data]) => {
      const productiveHours = data.productiveMinutes / 60;
      const downtimeHours = data.downtimeMinutes / 60;
      const intervalHours = data.intervalMinutes / 60;
      const totalHours = productiveHours + downtimeHours + intervalHours;
      const percentage = totalRecordedMinutes > 0 ? (totalHours * 60 / totalRecordedMinutes) * 100 : 0;

      // Calculate target production based on goals per shift (total for the activity/shift)
      let targetProduction = 0;
      let activeForkliftsCount = 0;

      const shiftsToProcess: ('1' | '2')[] = filterShift === 'all' ? ['1', '2'] : [filterShift as '1' | '2'];
      
      shiftsToProcess.forEach(s => {
        const goal = operationGoals.find(g => g.operationType === key && g.shift === s)?.goal || 0;
        
        targetProduction += goal;
        
        const forkliftsInShift = new Set(
          filteredEvents
            .filter(e => e.operationType === key && e.shift === s)
            .map(e => e.forkliftId)
        ).size;
        activeForkliftsCount += forkliftsInShift;
      });

      // For calculating hourly goal for efficiency indicator (per machine)
      // Since the goal is now a total for the shift, we estimate the hourly rate per machine
      const hourlyGoal = activeForkliftsCount > 0 ? (targetProduction / (shiftsToProcess.length * 12 * activeForkliftsCount)) : 125;

      return {
        key,
        name: labels[key] || key,
        hours: parseFloat(productiveHours.toFixed(1)),
        downtimeHours: parseFloat(downtimeHours.toFixed(1)),
        intervalHours: parseFloat(intervalHours.toFixed(1)),
        totalHours: parseFloat(totalHours.toFixed(1)),
        percentage: parseFloat(percentage.toFixed(1)),
        productivity: productiveHours > 0 ? parseFloat((data.production / productiveHours).toFixed(2)) : 0,
        production: data.production,
        goal: targetProduction,
        count: data.count,
        efficiency: productiveHours > 0 ? Math.min(100, Math.floor((data.production / (productiveHours * hourlyGoal)) * 100)) : 0,
        stops: data.stops
      };
    }).sort((a, b) => b.totalHours - a.totalHours);
  }, [filteredEvents, operationGoals, filterShift]);

  const bottleneckInfo = useMemo(() => {
    // Bottleneck: High time spent AND low productivity (below average)
    if (operationStats.length === 0) return null;
    
    const avgProductivity = operationStats.reduce((acc, s) => acc + s.productivity, 0) / operationStats.length;
    const sortedByTime = [...operationStats].sort((a, b) => b.totalHours - a.totalHours);
    
    // An operation is a bottleneck if it's the one with most time and productivity is below average
    const critical = sortedByTime.find(s => s.totalHours > 0 && s.productivity < avgProductivity * 0.9);
    
    return critical || null;
  }, [operationStats]);

  const stoppedTimeData = useMemo(() => {
    const reasonsMap: Record<string, number> = {};
    operationStats.forEach(stat => {
      Object.entries(stat.stops as Record<string, number>).forEach(([reason, duration]) => {
        reasonsMap[reason] = (reasonsMap[reason] || 0) + duration;
      });
    });

    const totalDowntime = Object.values(reasonsMap).reduce((acc, v) => acc + v, 0);

    const labels: Record<string, string> = {
      'chuva': 'Chuva',
      'intervalo': 'Intervalo (Almoço)',
      'aguardando_analise': 'Aguardando Análise',
      'falta_fardo': 'Sem Carga',
      'mecanico': 'Problema Mecânico',
      'finalizacao_turno': 'Finalização Turno',
      'outro': 'Outro'
    };

    return Object.entries(reasonsMap).map(([key, minutes]) => ({
      name: labels[key] || key,
      value: parseFloat((minutes / 60).toFixed(1)),
      percentage: totalDowntime > 0 ? parseFloat(((minutes / totalDowntime) * 100).toFixed(1)) : 0
    })).sort((a, b) => b.value - a.value);
  }, [operationStats]);

  const shiftComparisonData = useMemo(() => {
    const processEventsForShift = (shift: string) => {
      const shiftEvents = operationalEvents.filter(e => {
         const date = new Date(e.timestamp);
         if (useDateFilter) return e.timestamp.startsWith(filterDate) && e.shift === shift;
         return date.getFullYear().toString() === filterYear && 
                (filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth) &&
                e.shift === shift;
      });

      const totalProd = shiftEvents.reduce((acc, e) => acc + (e.production || 0), 0);
      let totalMinutes = 0;
      
      const forkliftEvents: Record<string, OperationalEvent[]> = {};
      shiftEvents.forEach(e => {
        if (!forkliftEvents[e.forkliftId]) forkliftEvents[e.forkliftId] = [];
        forkliftEvents[e.forkliftId].push(e);
      });

      Object.values(forkliftEvents).forEach(fEvents => {
        const sorted = [...fEvents].filter(e => e.action !== 'occurrence').sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        for(let i=0; i<sorted.length-1; i++){
          totalMinutes += (new Date(sorted[i+1].timestamp).getTime() - new Date(sorted[i].timestamp).getTime()) / (1000 * 60);
        }
      });

      const hours = totalMinutes / 60;
      return {
        production: totalProd,
        productivity: hours > 0 ? parseFloat((totalProd / hours).toFixed(2)) : 0,
        hours: parseFloat(hours.toFixed(1))
      };
    };

    return [
      { name: 'Shift 1 (Dia)', ...processEventsForShift('1') },
      { name: 'Shift 2 (Noite)', ...processEventsForShift('2') }
    ];
  }, [operationalEvents, filterYear, filterMonth, filterDate, useDateFilter]);

  const machineIndicators = useMemo(() => {
     const machineMap: Record<string, { productiveMinutes: number, downtimeMinutes: number, production: number, count: number }> = {};
     
     const forkliftEvents: Record<string, OperationalEvent[]> = {};
     filteredEvents.forEach(e => {
       if (!forkliftEvents[e.forkliftId]) forkliftEvents[e.forkliftId] = [];
       forkliftEvents[e.forkliftId].push(e);
     });

     Object.entries(forkliftEvents).forEach(([fId, fEvents]) => {
       const forklift = forklifts.find(f => f.id === fId);
       const name = forklift ? `${forklift.model} (${forklift.serialNumber})` : fId;
       if (!machineMap[name]) machineMap[name] = { productiveMinutes: 0, downtimeMinutes: 0, production: 0, count: 0 };
       
       const sorted = [...fEvents].filter(e => e.action !== 'occurrence').sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
       for (let i = 0; i < sorted.length - 1; i++) {
         const current = sorted[i];
         const next = sorted[i+1];
         const duration = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / (1000 * 60);
         
         if (current.action === 'stop') {
           machineMap[name].downtimeMinutes += duration;
         } else {
           machineMap[name].productiveMinutes += duration;
         }
         if (current.production) machineMap[name].production += current.production;
       }
       machineMap[name].count = fEvents.length;
     });

     return Object.entries(machineMap).map(([name, data]) => {
       const totalHours = (data.productiveMinutes + data.downtimeMinutes) / 60;
       return {
         name,
         productiveHours: parseFloat((data.productiveMinutes / 60).toFixed(1)),
         downtimeHours: parseFloat((data.downtimeMinutes / 60).toFixed(1)),
         production: data.production,
         opsCount: data.count,
         downtimePercentage: totalHours > 0 ? (data.downtimeMinutes / (totalHours * 60)) * 100 : 0
       };
     }).sort((a, b) => b.production - a.production);
  }, [filteredEvents, forklifts]);

  const dailyProductionData = useMemo(() => {
    const dailyMap: Record<string, Record<string, number>> = {};
    const operationTypes = ['tirar_producao', 'quebra', 'emblocamento', 'carregamento'];

    filteredEvents.forEach(e => {
      const date = e.timestamp.split('T')[0];
      if (!dailyMap[date]) {
        dailyMap[date] = {};
        operationTypes.forEach(type => dailyMap[date][type] = 0);
      }
      if (e.production && e.operationType && operationTypes.includes(e.operationType)) {
        dailyMap[date][e.operationType] += e.production;
      }
    });

    return Object.entries(dailyMap)
      .map(([date, data]) => ({
        date: date.split('-').reverse().slice(0, 2).join('/'),
        fullDate: date,
        ...data
      }))
      .sort((a, b) => a.fullDate.localeCompare(b.fullDate))
      .slice(-7); // Mostrar os últimos 7 dias
  }, [filteredEvents]);

  const totalProduction = useMemo(() => operationStats.reduce((acc, s) => acc + s.production, 0), [operationStats]);
  const avgProductivity = useMemo(() => {
    const totalHours = operationStats.reduce((acc, s) => acc + s.hours, 0);
    return totalHours > 0 ? parseFloat((totalProduction / totalHours).toFixed(2)) : 0;
  }, [totalProduction, operationStats]);
  const uniqueOperators = useMemo(() => {
    const nameMap = new Map<string, { id: string, name: string }>();
    
    operationalEvents.forEach(e => {
      // Legacy single operator
      if (e.operatorId && e.operatorName) {
        const nameKey = e.operatorName.toLowerCase();
        if (!nameMap.has(nameKey)) {
          nameMap.set(nameKey, { id: e.operatorId, name: e.operatorName });
        }
      }
      
      // New multi-operator
      if (e.operatorIds && e.operatorNames) {
        e.operatorIds.forEach((id, idx) => {
          const name = e.operatorNames![idx];
          if (name) {
            const nameKey = name.toLowerCase();
            if (!nameMap.has(nameKey)) {
              nameMap.set(nameKey, { id: id, name: name });
            }
          }
        });
      }
    });

    // Also include from shift reports just in case
    shiftReports.forEach(sr => {
      if (sr.operatorId && sr.operatorName) {
        const nameKey = sr.operatorName.toLowerCase();
        if (!nameMap.has(nameKey)) {
          nameMap.set(nameKey, { id: sr.operatorId, name: sr.operatorName });
        }
      }
    });

    return Array.from(nameMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [operationalEvents, shiftReports]);

  const totalStoppedPercent = useMemo(() => {
    const totalProdTime = operationStats.reduce((acc, s) => acc + s.hours, 0);
    const totalStopTime = operationStats.reduce((acc, s) => acc + s.downtimeHours, 0);
    const totalIntervalTime = operationStats.reduce((acc, s) => acc + (s.intervalHours || 0), 0);
    const total = totalProdTime + totalStopTime + totalIntervalTime;
    return total > 0 ? parseFloat(((totalStopTime / total) * 100).toFixed(1)) : 0;
  }, [operationStats]);

  const efficiencyData = useMemo(() => {
    const machineMap: Record<string, { productiveMinutes: number, production: number, count: number }> = {};
    
    // Group events by forklift
    const forkliftEvents: Record<string, OperationalEvent[]> = {};
    filteredEvents.forEach(e => {
      if (!forkliftEvents[e.forkliftId]) forkliftEvents[e.forkliftId] = [];
      forkliftEvents[e.forkliftId].push(e);
    });

    Object.entries(forkliftEvents).forEach(([fId, fEvents]) => {
      const forklift = forklifts.find(f => f.id === fId);
      const name = forklift ? `${forklift.model} (${forklift.serialNumber})` : 'Máquina';
      if (!machineMap[name]) machineMap[name] = { productiveMinutes: 0, production: 0, count: 0 };
      
      const sorted = [...fEvents].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i+1];
        const duration = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / (1000 * 60);
        
        if (current.action !== 'stop') {
          machineMap[name].productiveMinutes += duration;
        }
        if (current.production) machineMap[name].production += current.production;
      }
      machineMap[name].count = fEvents.length;
    });

    return Object.entries(machineMap)
      .map(([name, data]) => {
        const hours = data.productiveMinutes / 60;
        const efficiency = hours > 0 ? Math.min(100, Math.floor((data.production / (hours * 15)) * 100)) : 0;
        return { name, efficiency };
      })
      .sort((a, b) => b.efficiency - a.efficiency);
  }, [filteredEvents, forklifts]);

  const operatorPerformanceData = useMemo(() => {
    const opMap: Record<string, { productiveMinutes: number, production: number, checklist: number, checklistsCount: number, eventsCount: number, weightedProductivity: number, totalWeight: number, weightedTarget: number }> = {};
    
    // Process Checklists for compliance score
    filteredChecklists.forEach(cl => {
      const name = cl.operatorName || 'Desconhecido';
      if (!opMap[name]) opMap[name] = { productiveMinutes: 0, production: 0, checklist: 0, checklistsCount: 0, eventsCount: 0, weightedProductivity: 0, totalWeight: 0, weightedTarget: 0 };
      opMap[name].checklist += cl.checklistScore || 0;
      opMap[name].checklistsCount += 1;
    });

    // Process Events for productivity
    const forkliftEvents: Record<string, OperationalEvent[]> = {};
    filteredEvents.forEach(e => {
      if (!forkliftEvents[e.forkliftId]) forkliftEvents[e.forkliftId] = [];
      forkliftEvents[e.forkliftId].push(e);
    });

    Object.values(forkliftEvents).forEach(fEvents => {
      const sorted = [...fEvents].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i+1];
        const duration = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / (1000 * 60);
        
        if (duration <= 0) continue;

        // Effective participating operators
        const participants: { id: string, name: string }[] = [];
        if (current.operatorIds && current.operatorNames) {
          current.operatorIds.forEach((id, idx) => {
            participants.push({ id, name: current.operatorNames![idx] || 'Desconhecido' });
          });
        } else if (current.operatorId && current.operatorName) {
          participants.push({ id: current.operatorId, name: current.operatorName });
        }

        if (participants.length === 0) continue;

        const numOps = participants.length;
        const production = current.production || 0;
        
        // Find specific goal for this operation and shift
        const shiftGoal = operationGoals.find(g => g.operationType === current.operationType && g.shift === current.shift)?.goal || 1200;
        const hourlyTarget = shiftGoal / 12;
        
        const productivityRate = (duration > 0) ? (production / ((duration / 60) * numOps)) : 0;

        participants.forEach(p => {
          if (!opMap[p.name]) {
            opMap[p.name] = { productiveMinutes: 0, production: 0, checklist: 0, checklistsCount: 0, eventsCount: 0, weightedProductivity: 0, totalWeight: 0, weightedTarget: 0 };
          }
          
          if (current.action !== 'stop' && current.action !== 'occurrence') {
            opMap[p.name].productiveMinutes += duration;
            // Weighted average of productivity
            opMap[p.name].weightedProductivity += productivityRate * duration;
            opMap[p.name].weightedTarget += hourlyTarget * duration;
            opMap[p.name].totalWeight += duration;
          }
          
          // Allocate production share for total stats
          opMap[p.name].production += production / numOps;
          opMap[p.name].eventsCount += 1;
        });
      }
    });

    return Object.entries(opMap)
      .map(([name, data]) => {
        const hours = data.productiveMinutes / 60;
        // Average productivity weighted by the duration of each operation
        const productivity = data.totalWeight > 0 ? parseFloat((data.weightedProductivity / data.totalWeight).toFixed(2)) : 0;
        const avgTarget = data.totalWeight > 0 ? data.weightedTarget / data.totalWeight : 15;
        const checklistScore = data.checklistsCount > 0 ? parseFloat((data.checklist / data.checklistsCount).toFixed(1)) : 0;
        
        // Efficiency relative to weighted goal
        const efficiency = avgTarget > 0 ? Math.min(100, Math.floor((productivity / avgTarget) * 100)) : 0;
        
        return {
          name,
          productivity,
          checklist: checklistScore,
          efficiency,
          occurrences: data.checklistsCount 
        };
      })
      .sort((a, b) => b.efficiency - a.efficiency);
  }, [filteredChecklists, filteredEvents]);

  const checklistVolumeData = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return forklifts
      .filter(f => filterForklift === 'all' || f.id === filterForklift)
      .map(f => {
        const name = `${f.model} (${f.serialNumber})`;
        const count = filteredChecklists.filter(cl => cl.forkliftId === f.id).length;
        const isDoneToday = filteredChecklists.some(cl => 
          cl.forkliftId === f.id && cl.timestamp.startsWith(today)
        );
        return { name, count, isDoneToday, status: f.status };
      })
      .sort((a, b) => b.count - a.count);
  }, [filteredChecklists, forklifts, filterForklift]);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return [currentYear, currentYear - 1, currentYear - 2];
  }, []);

  const months = [
    { value: 'all', label: 'Todos os meses' },
    { value: '1', label: 'Janeiro' },
    { value: '2', label: 'Fevereiro' },
    { value: '3', label: 'Março' },
    { value: '4', label: 'Abril' },
    { value: '5', label: 'Maio' },
    { value: '6', label: 'Junho' },
    { value: '7', label: 'Julho' },
    { value: '8', label: 'Agosto' },
    { value: '9', label: 'Setembro' },
    { value: '10', label: 'Outubro' },
    { value: '11', label: 'Novembro' },
    { value: '12', label: 'Dezembro' },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={fetchData}
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
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 leading-tight">Dashboard de Gestão</h1>
            <p className="text-slate-500 text-sm md:text-base">Monitoramento {activeView === 'production' ? 'de Produção e Eficiência' : 'Mecânico e Disponibilidade de Frota'}</p>
          </div>
        </div>
        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">
            <button 
              onClick={() => setActiveView('production')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2",
                activeView === 'production' 
                  ? "bg-white text-blue-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <TrendingUp className="w-4 h-4" />
              Produção
            </button>
            <button 
              onClick={() => setActiveView('mechanical')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2",
                activeView === 'mechanical' 
                  ? "bg-white text-blue-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Truck className="w-4 h-4" />
              Mecânica
            </button>
            <button 
              onClick={() => setActiveView('reports')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2",
                activeView === 'reports' 
                  ? "bg-white text-blue-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <ClipboardCheck className="w-4 h-4" />
              Fechamentos
            </button>
          </div>
          <button 
            onClick={() => setShowGoalModal(true)}
            className="p-2.5 rounded-xl text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-all border border-slate-200"
            title="Configurações de Metas"
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Goal Modal */}
      {showGoalModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                  <Target className="w-6 h-6 text-blue-600" />
                  Gerenciar Metas
                </h2>
                <p className="text-sm font-medium text-slate-500">Defina o objetivo total de fardos por atividade e turno</p>
              </div>
              <button onClick={() => setShowGoalModal(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>
            
            <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-1 gap-4">
                {['tirar_producao', 'quebra', 'emblocamento', 'carregamento'].map((type) => (
                  <div key={type} className="space-y-3 bg-slate-50 p-6 rounded-3xl border border-slate-100">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       {type === 'tirar_producao' && <Package className="w-3 h-3" />}
                       {type === 'quebra' && <Layers className="w-3 h-3" />}
                       {type === 'emblocamento' && <BoxSelect className="w-3 h-3" />}
                       {type === 'carregamento' && <Truck className="w-3 h-3" />}
                       {type.replace('_', ' ')}
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {['1', '2'].map((shift) => {
                        const existingGoal = operationGoals.find(g => g.operationType === type && g.shift === shift);
                        const isEditing = editingGoal?.operationType === type && editingGoal?.shift === shift;
                        
                        return (
                          <div key={shift} className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Turno {shift}</label>
                            {isEditing ? (
                              <div className="flex gap-2">
                                <input 
                                  type="number"
                                  value={editingGoal.value}
                                  onChange={(e) => setEditingGoal({...editingGoal, value: e.target.value})}
                                  className="w-full bg-white border border-blue-200 rounded-xl px-4 py-2 text-sm font-black outline-none focus:ring-2 focus:ring-blue-500/20"
                                  autoFocus
                                />
                                <button 
                                  onClick={handleUpdateGoal}
                                  className="p-2 bg-green-500 text-white rounded-xl hover:bg-green-600 shadow-lg shadow-green-100"
                                >
                                  <Save className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => setEditingGoal(null)}
                                  className="p-2 bg-slate-200 text-slate-600 rounded-xl hover:bg-slate-300"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => setEditingGoal({ operationType: type as AppOperationType, shift: shift as any, value: existingGoal?.goal?.toString() || '' })}
                                  className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-black text-slate-700 flex justify-between items-center hover:border-blue-300 transition-all group"
                                >
                                  <span>{existingGoal?.goal || 'Não definido'} <span className="text-[10px] text-slate-400 font-bold ml-1">Fardos Total</span></span>
                                  <Settings2 className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500" />
                                </button>
                                {existingGoal && (
                                  <button 
                                    onClick={() => existingGoal.id && handleResetGoal(existingGoal.id)}
                                    className="p-2.5 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition-colors"
                                    title="Redefinir Meta"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button 
                onClick={() => setShowGoalModal(false)}
                className="px-8 py-3 bg-slate-900 text-white font-black text-sm rounded-2xl shadow-xl shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2 text-slate-500">
          <Filter className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">Filtros:</span>
        </div>
        
        <div className="flex items-center gap-3 bg-slate-50 p-1.5 rounded-xl border border-slate-100">
          <button 
            onClick={() => setUseDateFilter(true)}
            className={cn("px-3 py-1.5 text-xs font-bold rounded-lg transition-all", useDateFilter ? "bg-white shadow-sm text-blue-600" : "text-slate-500")}
          >
            Data Específica
          </button>
          <button 
            onClick={() => setUseDateFilter(false)}
            className={cn("px-3 py-1.5 text-xs font-bold rounded-lg transition-all", !useDateFilter ? "bg-white shadow-sm text-blue-600" : "text-slate-500")}
          >
            Mês/Ano
          </button>
        </div>

        {useDateFilter ? (
          <input 
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        ) : (
          <div className="flex gap-2">
            <select 
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {years.map(y => <option key={y} value={y.toString()}>{y}</option>)}
            </select>

            <select 
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        )}

        <select 
          value={filterShift}
          onChange={(e) => setFilterShift(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="all">Filtro: Turno (Todos)</option>
          <option value="1">Turno 1 (Dia)</option>
          <option value="2">Turno 2 (Noite)</option>
        </select>

        <select 
          value={filterForklift}
          onChange={(e) => setFilterForklift(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 max-w-[180px]"
        >
          <option value="all">Máquinas (Todas)</option>
          {uniqueForklifts.map(f => (
            <option key={f.id} value={f.id}>{f.model} ({f.serialNumber})</option>
          ))}
        </select>

        <select 
          value={filterOperator}
          onChange={(e) => setFilterOperator(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 max-w-[180px]"
        >
          <option value="all">Operadores (Todos)</option>
          {uniqueOperators.map(o => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {/* View Content */}
      {activeView === 'production' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Bottleneck Alert */}
          {bottleneckInfo && (
            <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-2xl flex items-center justify-between shadow-lg shadow-red-100">
               <div className="flex items-center gap-4">
                 <div className="p-3 bg-red-500 rounded-xl">
                   <AlertTriangle className="w-6 h-6 text-white" />
                 </div>
                 <div>
                   <h3 className="text-xl font-bold text-red-900 tracking-tight">Atenção: Gargalo em {bottleneckInfo.name}</h3>
                   <p className="text-red-700 text-sm font-medium">Esta operação está com produtividade ({bottleneckInfo.productivity} fardos/h) abaixo da média.</p>
                 </div>
               </div>
            </div>
          )}

          {/* Production Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <StatCard 
              title="Produção Total" 
              value={totalProduction.toString()}
              icon={<Package className="w-6 h-6 text-blue-600" />}
              trend="Fardos Total"
            />
            <StatCard 
              title="Eficiência Média" 
              value={`${avgProductivity}/h`}
              icon={<TrendingUp className="w-6 h-6 text-green-600" />}
              trend="Fardos p/ Hora"
            />
            <StatCard 
              title="Tempo de Parada" 
              value={`${totalStoppedPercent}%`}
              icon={<Clock className="w-6 h-6 text-amber-600" />}
              trend="Impacto na Produção"
            />
          </div>

          {/* Objective vs Real Chart */}
          <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-indigo-500" />
                <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Objetivo x Real (Total Fardos)</h3>
              </div>
              <div className="flex gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Objetivo</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Realizado</span>
                </div>
              </div>
            </div>
            <div className="h-[350px] w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={operationStats} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 900, fill: '#64748b' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontBold: true, fill: '#64748b' }}
                  />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }}
                  />
                  <Bar dataKey="goal" name="Objetivo" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={40} />
                  <Bar dataKey="production" name="Realizado" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={25} />
                  <Line type="monotone" dataKey="goal" stroke="#94a3b8" strokeDasharray="5 5" dot={false} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Daily Production Grouped Chart */}
          <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-xl space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart className="w-5 h-5 text-blue-500" />
                <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Produção Diária por Operação</h3>
              </div>
              <div className="flex gap-4">
                {[
                  { label: 'Produção', color: '#10b981' },
                  { label: 'Quebra', color: '#3b82f6' },
                  { label: 'Emblocam.', color: '#8b5cf6' },
                  { label: 'Carregam.', color: '#f59e0b' }
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="h-[350px] w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyProductionData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 900, fill: '#64748b' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontBold: true, fill: '#64748b' }}
                  />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }}
                  />
                  <Bar dataKey="tirar_producao" name="Produção" fill="#10b981" radius={[4, 4, 0, 0]} barSize={12} />
                  <Bar dataKey="quebra" name="Quebra" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={12} />
                  <Bar dataKey="emblocamento" name="Emblocamento" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={12} />
                  <Bar dataKey="carregamento" name="Carregamento" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-xl space-y-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-500" />
                  <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Produtividade/Hora por Operação</h3>
                </div>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={operationStats} layout="vertical" margin={{ left: 20, right: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" hide />
                      <YAxis 
                        type="category" 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fontSize: 10, fontWeight: 900, fill: '#1e293b'}} 
                        width={90} 
                      />
                      <Bar dataKey="productivity" radius={[0, 8, 8, 0]} barSize={24}>
                        {operationStats.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.key === bottleneckInfo?.key ? '#ef4444' : '#10b981'} 
                          />
                        ))}
                        <LabelList 
                          dataKey="productivity" 
                          position="right" 
                          style={{ fontSize: '11px', fontWeight: '900', fill: '#475569' }} 
                          formatter={(val: any) => `${val}/h`}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-500" />
                  <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Performance Individual dos Operadores</h3>
                </div>
                <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Operador</th>
                        <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Produtiv.</th>
                        <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Fardos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {operatorPerformanceData.map((op, idx) => (
                        <tr key={idx}>
                          <td className="py-3 font-bold text-xs text-slate-900">{op.name}</td>
                          <td className="py-3 text-center text-xs font-bold text-green-600">{op.productivity}/h</td>
                          <td className="py-3 text-right text-xs font-black text-slate-900">{operationalEvents.filter(e => e.operatorName === op.name).reduce((acc,e) => acc + (e.production || 0), 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeView === 'mechanical' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <StatCard 
              title="Disponibilidade de Frota" 
              value={`${kpis.availability.toFixed(1)}%` }
              icon={<Activity className="w-6 h-6 text-blue-600" />}
              trend="Tempo Operante"
            />
            <StatCard 
              title="MTTR (Tempo de Reparo)" 
              value={formatDuration(kpis.mttr)}
              icon={<Clock className="w-6 h-6 text-orange-600" />}
              trend="Média p/ Conserto"
            />
            <StatCard 
              title="Conformidade Checklist" 
              value={`${((filteredChecklists.length / (forklifts.filter(f => f.status === 'available').length || 1)) * 100).toFixed(0)}%`}
              icon={<ClipboardCheck className="w-6 h-6 text-indigo-600" />}
              trend="Inspeções Diárias"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white p-8 rounded-[2rem] border border-slate-200 shadow-xl space-y-8">
              <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-500" /> Saúde Individual das Máquinas
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {machineIndicators.map((m, idx) => (
                  <div key={idx} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex justify-between items-center">
                    <div>
                      <p className="text-xs font-black text-slate-900">{m.name}</p>
                      <p className="text-[10px] font-bold text-slate-400">Produtivo: {m.productiveHours}h</p>
                    </div>
                    <div className="text-right">
                      <span className={cn(
                        "text-[10px] font-black px-2 py-1 rounded-lg",
                        m.downtimePercentage > 20 ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                      )}>
                        {(100 - m.downtimePercentage).toFixed(0)}% Disponível
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-xl space-y-6">
              <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                <CloudRain className="w-4 h-4 text-amber-500" /> Motivos de Parada
              </h3>
              <div className="h-[250px]">
                {stoppedTimeData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stoppedTimeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                      >
                        {stoppedTimeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-300 italic text-[10px] uppercase font-black">Nenhuma parada</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeView === 'reports' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <StatCard 
              title="Turnos Finalizados" 
              value={shiftReports.length.toString()}
              icon={<ClipboardCheck className="w-6 h-6 text-blue-600" />}
              trend="Checkouts"
            />
            <StatCard 
              title="Produção Acumulada" 
              value={shiftReports.reduce((acc, r) => acc + (r.totalProduction || 0), 0).toString()}
              icon={<Package className="w-6 h-6 text-green-600" />}
              trend="Total do Período"
            />
            <StatCard 
              title="Horas Máquina" 
              value={`${shiftReports.reduce((acc, r) => acc + (r.totalMachineHours || 0), 0).toFixed(1)}h`}
              icon={<Clock className="w-6 h-6 text-amber-600" />}
              trend="Uso Efetivo"
            />
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">Histórico de Fechamentos</h2>
                <p className="text-sm font-medium text-slate-500 italic">Relatórios detalhados de finalização de turno</p>
              </div>
              <div className="flex gap-2">
                <div className="px-4 py-2 bg-white rounded-xl border border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  Turno 1
                </div>
                <div className="px-4 py-2 bg-white rounded-xl border border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-500" />
                  Turno 2
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Data / Hora</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Operador / Máquina</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Horímetro (I/F)</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">T. Máquina</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Produção</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Eficiência</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shiftReports
                    .filter(r => {
                      if (useDateFilter) return r.createdAt.startsWith(filterDate);
                      return true; // Use common filters if needed
                    })
                    .map((report) => (
                    <tr key={report.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-8 py-6">
                        <span className="block text-xs font-black text-slate-900">
                          {new Date(report.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                          {new Date(report.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • Turno {report.shift}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black",
                            report.shift === '1' ? "bg-blue-50 text-blue-600" : "bg-indigo-50 text-indigo-600"
                          )}>
                            {report.operatorName?.charAt(0)}
                          </div>
                          <div>
                            <span className="block text-xs font-black text-slate-900">{report.operatorName}</span>
                            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                              {forklifts.find(f => f.id === report.forkliftId)?.model} ({forklifts.find(f => f.id === report.forkliftId)?.serialNumber})
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400">{report.initialHourMeter}</span>
                          <ArrowLeft className="w-3 h-3 text-slate-300 rotate-180" />
                          <span className="text-xs font-black text-slate-900">{report.finalHourMeter}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-center">
                        <span className="px-3 py-1 bg-amber-50 text-amber-700 text-[10px] font-black rounded-lg border border-amber-100">
                          {report.totalMachineHours?.toFixed(1)}h
                        </span>
                      </td>
                      <td className="px-8 py-6 text-center">
                        <span className="text-xs font-black text-slate-900">{report.totalProduction}</span>
                        <span className="ml-1 text-[8px] font-bold text-slate-400 uppercase">Fardos</span>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={cn("h-full", (report.efficiency || 0) >= 80 ? "bg-green-500" : "bg-amber-500")} 
                              style={{ width: `${report.efficiency || 0}%` }} 
                            />
                          </div>
                          <span className="text-xs font-black text-slate-900">{(report.efficiency || 0).toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {shiftReports.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-8 py-12 text-center">
                        <div className="flex flex-col items-center gap-3 opacity-20">
                          <ClipboardCheck className="w-12 h-12" />
                          <span className="text-sm font-black uppercase tracking-widest">Nenhum fechamento encontrado</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function StatCard({ title, value, icon, trend }: { title: string, value: string, icon: React.ReactNode, trend: string }) {
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-slate-50 rounded-xl">
          {icon}
        </div>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded-lg">
          {trend}
        </span>
      </div>
      <h4 className="text-sm font-medium text-slate-500 mb-1">{title}</h4>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
