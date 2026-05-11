import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy,
  where,
  doc,
  updateDoc,
  addDoc,
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
import { Checklist, Forklift, MaintenanceStop, UserProfile, OperationalEvent, OperationType as AppOperationType, LowProductionReason, EventAction, ShiftReport, OperationGoal, ShiftType, ForkliftStatus, OperatorAbsence, AbsenceReason } from '../types';
import { handleFirestoreError, OperationType as FirestoreOp } from '../lib/firebaseErrorHandler';
import { motion, AnimatePresence } from 'motion/react';
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
  AreaChart,
  Area,
} from 'recharts';
import { TrendingUp, Clock, Activity, AlertTriangle, Users, Package, Calendar, Filter, Bell, ClipboardCheck, Watch, Layers, BoxSelect, Truck, CloudRain, Info, ArrowLeft, Target, Settings2, Plus, Save, X, Trash2, History as HistoryIcon, Wrench, ShieldAlert, BarChart3, ChevronRight, UserMinus, UserCheck, Timer, Footprints } from 'lucide-react';
import { cn, formatDuration, formatDate, formatTime, formatDateTime } from '../lib/utils';
import { calculateOperatorEfficiency } from '../lib/operationalLogic';
import { sendWhatsAppNotification, sendLocalNotification } from '../lib/notifications';

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];

export function ManagerDashboard() {
  const { profile, loading: authLoading, setQuotaExceeded } = useAuth();
  const { forklifts, uniqueForklifts, activeStops, goals: operationGoals, refreshGlobalData } = useData();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [maintenanceHistory, setMaintenanceHistory] = useState<MaintenanceStop[]>([]);
  const [operationalEvents, setOperationalEvents] = useState<OperationalEvent[]>([]);
  const [shiftReports, setShiftReports] = useState<ShiftReport[]>([]);
  const [absences, setAbsences] = useState<OperatorAbsence[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [lastEventDoc, setLastEventDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreEvents, setHasMoreEvents] = useState(true);
  
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterForklift, setFilterForklift] = useState<string>('all');
  const [filterOperator, setFilterOperator] = useState<string>('all');
  const [activeView, setActiveView] = useState<'maintenance' | 'production' | 'team'>('maintenance');
  const [teamSubView, setTeamSubView] = useState<'operation' | 'maintenance'>('operation');
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [newAbsence, setNewAbsence] = useState<Partial<OperatorAbsence>>({
    reason: AbsenceReason.VACATION,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });

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

      // 2. Fetch em Background
      
      // Checklists
      const qC = query(collection(db, 'checklists'), orderBy('timestamp', 'desc'), limit(300));
      const cSnap = await getDocs(qC);
      const cData = cSnap.docs.map(d => ({ id: d.id, ...d.data() } as Checklist));
      setChecklists(cData);
      localStorage.setItem(cacheKeys.checklists, JSON.stringify({ data: cData, timestamp: Date.now() }));

      // Maintenance
      const qM = query(collection(db, 'maintenance'), orderBy('stopTime', 'desc'), limit(500));
      const mSnap = await getDocs(qM);
      const mData = mSnap.docs.map(d => ({ id: d.id, ...d.data() } as MaintenanceStop));
      setMaintenanceHistory(mData);
      localStorage.setItem(cacheKeys.maintenance, JSON.stringify({ data: mData, timestamp: Date.now() }));

      // Events
      const eLimitSize = 500;
      const qE = query(collection(db, 'operational_events'), orderBy('timestamp', 'desc'), limit(eLimitSize));
      const eSnap = await getDocs(qE);
      const newEvents = eSnap.docs.map(d => ({ id: d.id, ...d.data() } as OperationalEvent));
      setOperationalEvents(newEvents);
      localStorage.setItem(cacheKeys.events, JSON.stringify({ data: newEvents, timestamp: Date.now() }));

      // Reports
      const qR = query(collection(db, 'shift_reports'), orderBy('createdAt', 'desc'), limit(100));
      const rSnap = await getDocs(qR);
      const rData = rSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftReport));
      setShiftReports(rData);
      localStorage.setItem(cacheKeys.reports, JSON.stringify({ data: rData, timestamp: Date.now() }));

      // Absences
      const qA = query(collection(db, 'operator_absences'));
      const aSnap = await getDocs(qA);
      setAbsences(aSnap.docs.map(d => ({ id: d.id, ...d.data() } as OperatorAbsence)));

      // Users
      const qU = query(collection(db, 'users'));
      const uSnap = await getDocs(qU);
      setUsers(uSnap.docs.map(d => ({ ...d.data() } as UserProfile)));

    } catch (err: any) {
      console.error("Manager Data Fetch Error:", err);
      handleFirestoreError(err, FirestoreOp.LIST, 'ManagerDashboard/Data');
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
  }, [authLoading, profile]);

  const filteredChecklists = useMemo(() => {
    return checklists.filter(cl => {
      const date = new Date(cl.timestamp);
      
      const matchesYear = date.getFullYear().toString() === filterYear;
      const matchesMonth = filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth;
      const matchesForklift = filterForklift === 'all' || cl.forkliftId === filterForklift;
      const matchesOperator = filterOperator === 'all' || cl.operatorId === filterOperator;
      return matchesYear && matchesMonth && matchesForklift && matchesOperator;
    });
  }, [checklists, filterYear, filterMonth, filterForklift, filterOperator]);

  const filteredHistory = useMemo(() => {
    return maintenanceHistory.filter(h => {
      const date = new Date(h.stopTime);

      const matchesYear = date.getFullYear().toString() === filterYear;
      const matchesMonth = filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth;
      const matchesForklift = filterForklift === 'all' || h.forkliftId === filterForklift;
      const matchesOperator = filterOperator === 'all' || h.operatorId === filterOperator || (h.operatorIds && h.operatorIds.includes(filterOperator));
      return matchesYear && matchesMonth && matchesForklift && matchesOperator;
    });
  }, [maintenanceHistory, filterYear, filterMonth, filterForklift, filterOperator]);

  const startDate = useMemo(() => {
    const year = parseInt(filterYear);
    const month = filterMonth === 'all' ? 0 : parseInt(filterMonth) - 1;
    return new Date(year, month, 1).toISOString();
  }, [filterYear, filterMonth]);

  const endDate = useMemo(() => {
    const year = parseInt(filterYear);
    if (filterMonth === 'all') {
      return new Date(year, 11, 31, 23, 59, 59).toISOString();
    }
    const month = parseInt(filterMonth);
    return new Date(year, month, 0, 23, 59, 59).toISOString();
  }, [filterYear, filterMonth]);

  // --- NEW STATUS-BASED MAINTENANCE LOGIC ---

  const currentStatusStats = useMemo(() => {
    const now = new Date();
    const stopped = activeStops.filter(s => s.status !== 'completed');
    
    const aging = {
      upTo3: 0,
      fourTo7: 0,
      eightTo15: 0,
      over15: 0,
      over30: 0
    };

    const backlog = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      status: {
        awaiting_parts: 0,
        in_progress: 0,
        pending: 0,
        interdicted: 0
      }
    };

    let totalLostHours = 0;
    const criticalMachines: any[] = [];

    stopped.forEach(stop => {
      const stopDate = new Date(stop.stopTime);
      const diffDays = Math.floor((now.getTime() - stopDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Aging
      if (diffDays <= 3) aging.upTo3++;
      else if (diffDays <= 7) aging.fourTo7++;
      else if (diffDays <= 15) aging.eightTo15++;
      else aging.over15++;

      if (diffDays > 30) aging.over30++;

      // Backlog & Severity
      const severity = stop.severity || 'high';
      if (severity === 'high') backlog.critical++;
      else if (severity === 'medium') backlog.high++;
      else backlog.medium++;

      if (stop.status === 'awaiting_parts') backlog.status.awaiting_parts++;
      else if (stop.status === 'in_progress') backlog.status.in_progress++;
      else backlog.status.pending++;

      // Lost Hours (Assuming 12h planned per day as per request example)
      const lostHours = diffDays * 12;
      totalLostHours += lostHours;

      if (diffDays >= 30) {
        const forklift = forklifts.find(f => f.id === stop.forkliftId);
        criticalMachines.push({
          id: stop.id,
          code: forklift?.model || 'UNK',
          serial: forklift?.serialNumber || 'UNK',
          days: diffDays,
          reason: stop.description,
          status: stop.status,
          lostHours,
          severity
        });
      }
    });

    return { aging, backlog, totalLostHours, criticalMachines, totalStopped: stopped.length };
  }, [activeStops, forklifts]);

  const kpis = useMemo(() => {
    // Current fleet availability (Instant check)
    const totalFleetUnits = uniqueForklifts.length || 1;
    const stoppedUnits = activeStops.length;
    const currentAvailability = ((totalFleetUnits - stoppedUnits) / totalFleetUnits) * 100;

    // Monthly View KPIs
    const start = new Date(startDate);
    const end = new Date(endDate);
    const now = new Date();
    const effectiveEndForPeriod = Math.min(end.getTime(), now.getTime());
    const totalPeriodDays = Math.max(1, (effectiveEndForPeriod - start.getTime()) / (1000 * 60 * 60 * 24));
    const totalPlannedHours = uniqueForklifts.length * 12 * totalPeriodDays;

    // Calculate total downtime in the period for ALL relevant stops (even if they started before the period)
    const allStopsInPeriod = maintenanceHistory.filter(h => {
      const hStop = new Date(h.stopTime).getTime();
      const hEnd = h.endTime ? new Date(h.endTime).getTime() : now.getTime();
      return hStop < effectiveEndForPeriod && hEnd > start.getTime();
    });

    const totalDowntimeHours = allStopsInPeriod.reduce((acc, h) => {
      const hStop = new Date(h.stopTime).getTime();
      const hEnd = h.endTime ? new Date(h.endTime).getTime() : now.getTime();
      const effectiveStart = Math.max(start.getTime(), hStop);
      const effectiveEnd = Math.min(effectiveEndForPeriod, hEnd);
      const durationMs = Math.max(0, effectiveEnd - effectiveStart);
      
      // Convert to "operational hours lost" (assuming 12h planned per day, so we scale the actual duration)
      // Actually, if we want availability as (Available/Planned), and we know Planned is 12h/day.
      // If a machine is stopped for a full 24h day, it loses 12 operational hours.
      // So we scale the duration by 12/24 = 0.5.
      return acc + (durationMs / (1000 * 60 * 60)) * 0.5;
    }, 0);

    const monthlyAvailability = totalPlannedHours > 0 
      ? Math.max(0, ((totalPlannedHours - totalDowntimeHours) / totalPlannedHours) * 100) 
      : 100;

    const monthlyCompleted = maintenanceHistory.filter(h => {
      const date = new Date(h.endTime || h.stopTime);
      return date.getFullYear().toString() === filterYear && 
             (filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth) &&
             h.status === 'completed';
    });

    const monthlyNewFailures = maintenanceHistory.filter(h => {
      const date = new Date(h.stopTime);
      return date.getFullYear().toString() === filterYear && 
             (filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth);
    });

    // MTTR calculation
    const totalRepairTime = monthlyCompleted.reduce((acc, h) => {
      const repairStart = h.startTime ? new Date(h.startTime).getTime() : new Date(h.stopTime).getTime();
      const repairEnd = h.endTime ? new Date(h.endTime).getTime() : now.getTime();
      return acc + (repairEnd - repairStart);
    }, 0);
    const mttr = monthlyCompleted.length > 0 ? totalRepairTime / monthlyCompleted.length : 0;

    // MTBF & Confiabilidade (Estimado p/ o período)
    // Confiabilidade R(t) = e^(-t/MTBF) -> Simplificando para score 0-100
    const totalOperatingHours = uniqueForklifts.length * 12 * totalPeriodDays;
    const failuresCount = monthlyNewFailures.filter(f => f.type === 'corrective').length;
    const mtbf = failuresCount > 0 ? totalOperatingHours / failuresCount : totalOperatingHours;
    
    // NOVO CÁLCULO DE CONFIABILIDADE (Hardened)
    // Considera: Disponibilidade do mês, tempo parado atual, penalização por criticidade
    const currentStoppedPenalty = activeStops.reduce((acc, s) => {
      const stopDate = new Date(s.stopTime);
      const diffDays = Math.floor((now.getTime() - stopDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 30) return acc + 40; // Grave
      if (diffDays > 15) return acc + 20;
      if (diffDays > 7) return acc + 10;
      return acc + 5;
    }, 0);

    const avgStoppedPenalty = activeStops.length > 0 ? currentStoppedPenalty / activeStops.length : 0;
    
    // Score de Confiabilidade (40% MTBF / 40% Disponibilidade / 20% Penalização de Parada Atual)
    const availabilityImpact = (monthlyAvailability / 100) * 40;
    const mtbfImpact = Math.min(40, (mtbf / 500) * 40); 
    const penaltyImpact = Math.max(0, 20 - avgStoppedPenalty);
    
    const reliabilityScore = availabilityImpact + mtbfImpact + penaltyImpact;

    return { 
      mttr, 
      mtbf,
      reliabilityScore: Math.max(0, reliabilityScore),
      currentAvailability,
      monthlyAvailability,
      monthlyNewFailures: monthlyNewFailures.length,
      monthlyCompleted: monthlyCompleted.length,
      correctiveCount: monthlyNewFailures.filter(h => h.type === 'corrective').length,
      preventiveCount: monthlyNewFailures.filter(h => h.type === 'preventive').length
    };
  }, [maintenanceHistory, uniqueForklifts, activeStops, filterYear, filterMonth]);

  const topAffectedMachines = useMemo(() => {
    const map: Record<string, { count: number, downtime: number, name: string }> = {};
    filteredHistory.forEach(h => {
      const f = forklifts.find(fork => fork.id === h.forkliftId);
      const serial = (f?.serialNumber || '').trim();
      const key = serial || h.forkliftId;
      const name = f ? `${f.model} (${f.serialNumber})` : h.forkliftId;
      
      if (!map[key]) map[key] = { count: 0, downtime: 0, name };
      map[key].count += 1;
      const hEnd = h.endTime ? new Date(h.endTime).getTime() : Date.now();
      map[key].downtime += (hEnd - new Date(h.stopTime).getTime());
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filteredHistory, forklifts]);

  const maintenanceReasons = useMemo(() => {
    const map: Record<string, number> = {};
    filteredHistory.forEach(h => {
      // Basic grouping by common keywords if description is unstructured
      const desc = (h.description || '').toLowerCase();
      let category = 'Outros';
      if (desc.includes('pneu') || desc.includes('roda')) category = 'Pneus/Rodas';
      else if (desc.includes('hidraulico') || desc.includes('vazamento')) category = 'Sistema Hidráulico';
      else if (desc.includes('eletrico') || desc.includes('bateria') || desc.includes('partida')) category = 'Elétrica/Bateria';
      else if (desc.includes('freio')) category = 'Freios';
      else if (desc.includes('motor')) category = 'Motor/Transmissão';
      else if (desc.includes('torre') || desc.includes('garfo')) category = 'Torre/Garfos';
      else if (h.type === 'preventive') category = 'Revisão Preventiva';
      
      map[category] = (map[category] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredHistory]);

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

  const machinesMissingChecklist = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const machinesWithChecklist = new Set(checklists.filter(c => c.timestamp.startsWith(today)).map(c => c.forkliftId));
    return forklifts
      .filter(f => filterForklift === 'all' || f.id === filterForklift)
      .filter(f => f.status === 'available' && !machinesWithChecklist.has(f.id));
  }, [forklifts, checklists, filterForklift]);

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
      .slice(0, 10);
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
      .slice(0, 10);
  }, [filteredHistory]);

  const teamStats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const activeAbsences = absences.filter(a => today >= a.startDate && today <= a.endDate);
    
    // Operation Stats
    const totalOperators = users.filter(u => u.role === 'operator' || u.role === 'production').length;
    const operatorAbsences = activeAbsences.filter(a => a.role === 'operator' || a.role === 'production' || !a.role); // Fallback for old data
    const availableOperators = totalOperators - operatorAbsences.length;
    const activeForklifts = uniqueForklifts.filter(f => f.status === 'available').length;
    
    const operationalCapacity = totalOperators > 0 ? (availableOperators / totalOperators) * 100 : 0;
    const machineOperatorImbalance = activeForklifts > availableOperators;
    
    let opRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (operationalCapacity < 60 || operatorAbsences.length > 5 || machineOperatorImbalance) opRiskLevel = 'CRITICAL';
    else if (operationalCapacity < 80 || operatorAbsences.length > 3) opRiskLevel = 'HIGH';
    else if (operationalCapacity < 90) opRiskLevel = 'MEDIUM';

    // Maintenance Stats
    const totalMechanics = users.filter(u => u.role === 'mechanic').length || 1;
    const mechanicAbsences = activeAbsences.filter(a => a.role === 'mechanic');
    const availableMechanics = totalMechanics - mechanicAbsences.length;
    const maintenanceCapacity = (availableMechanics / totalMechanics) * 100;
    
    const backlogCount = activeStops.length;
    const awaitingMaintenance = activeStops.filter(s => s.status === 'pending').length;
    
    const preventivesAtRisk = uniqueForklifts.filter(f => {
      if (!f.nextPreventiveHorometer || !f.lastHourMeter) return false;
      return f.nextPreventiveHorometer - f.lastHourMeter < 50;
    }).length;

    // Calculate Maintenance Risk Score (0-100)
    // Formula: Capacity Impact (40) + Backlog Weight (30) + Preventive Risk (30)
    const capacityScore = (1 - (availableMechanics / totalMechanics)) * 40;
    const backlogScore = Math.min(30, (backlogCount / 5) * 30);
    const preventiveScore = Math.min(30, (preventivesAtRisk / 3) * 30);
    const totalMaintRiskValue = capacityScore + backlogScore + preventiveScore;

    let maintRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (totalMaintRiskValue > 70) maintRiskLevel = 'CRITICAL';
    else if (totalMaintRiskValue > 50) maintRiskLevel = 'HIGH';
    else if (totalMaintRiskValue > 30) maintRiskLevel = 'MEDIUM';

    const estimatedDelayDays = availableMechanics > 0 
      ? Math.ceil((backlogCount + preventivesAtRisk) / (availableMechanics * 1.5))
      : 7;

    return {
      operation: {
        totalOperators,
        availableOperators,
        absentOperators: operatorAbsences.length,
        operationalCapacity,
        riskLevel: opRiskLevel,
        machineOperatorImbalance,
        activeAbsences: operatorAbsences
      },
      maintenance: {
        totalMechanics,
        availableMechanics,
        absentMechanics: mechanicAbsences.length,
        capacity: maintenanceCapacity,
        riskLevel: maintRiskLevel,
        backlog: backlogCount,
        awaitingMaintenance,
        preventivesAtRisk,
        estimatedDelayDays,
        activeAbsences: mechanicAbsences
      }
    };
  }, [absences, users, uniqueForklifts, activeStops]);

  const capacityTrend = useMemo(() => {
    const trend = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      const dayAbsences = absences.filter(a => 
        (a.role === 'operator' || a.role === 'production' || !a.role) && 
        dateStr >= a.startDate && dateStr <= a.endDate
      );
      
      const totalOps = users.filter(u => u.role === 'operator' || u.role === 'production').length || 1;
      const capacity = Math.max(0, ((totalOps - dayAbsences.length) / totalOps) * 100);
      
      trend.push({
        date: d.toLocaleDateString('pt-BR', { weekday: 'short' }),
        cap: Math.round(capacity)
      });
    }
    return trend;
  }, [absences, users]);

  const handleSaveAbsence = async () => {
    if (!newAbsence.operatorId || !newAbsence.startDate || !newAbsence.endDate) return;
    try {
      const op = users.find(u => u.uid === newAbsence.operatorId);
      const data = {
        ...newAbsence,
        operatorName: op?.displayName || 'Desconhecido',
        role: op?.role,
        sector: op?.role === 'mechanic' ? 'Manutenção' : (op as any)?.sector || 'Operacional',
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'operator_absences'), data);
      setAbsences([...absences, { id: 'temp', ...data } as OperatorAbsence]);
      setShowAbsenceModal(false);
    } catch (err) {
      console.error("Error saving absence:", err);
      handleFirestoreError(err, FirestoreOp.WRITE, 'operator_absences');
    }
  };

  const filteredEvents = useMemo(() => {
    return operationalEvents.filter(e => {
      const date = new Date(e.timestamp);
      
      const matchesYear = date.getFullYear().toString() === filterYear;
      const matchesMonth = filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth;
      const matchesForklift = filterForklift === 'all' || e.forkliftId === filterForklift;
      const matchesOperator = filterOperator === 'all' || (e.operatorIds && e.operatorIds.includes(filterOperator)) || e.operatorId === filterOperator;
      return matchesYear && matchesMonth && matchesForklift && matchesOperator;
    });
  }, [operationalEvents, filterYear, filterMonth, filterForklift, filterOperator]);

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

      const shiftsToProcess: ('1' | '2')[] = ['1', '2'];
      
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
  }, [filteredEvents, operationGoals]);

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
  }, [operationalEvents, filterYear, filterMonth]);

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
    const idMap = new Map<string, { id: string, name: string }>();
    
    operationalEvents.forEach(e => {
      // Legacy single operator
      if (e.operatorId && e.operatorName) {
        const id = e.operatorId;
        if (!idMap.has(id)) {
          idMap.set(id, { id, name: e.operatorName });
        }
      }
      
      // New multi-operator
      if (e.operatorIds && e.operatorNames) {
        e.operatorIds.forEach((id, idx) => {
          const name = e.operatorNames![idx];
          if (id && name) {
            if (!idMap.has(id)) {
              idMap.set(id, { id, name });
            }
          }
        });
      }
    });

    // Also include from shift reports just in case
    shiftReports.forEach(sr => {
      if (sr.operatorId && sr.operatorName) {
        const id = sr.operatorId;
        if (!idMap.has(id)) {
          idMap.set(id, { id, name: sr.operatorName });
        }
      }
    });

    return Array.from(idMap.values()).sort((a, b) => a.name.localeCompare(b.name));
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
            <p className="text-slate-500 text-sm md:text-base">
              {activeView === 'production' ? 'Monitoramento de Produção e Eficiência' : 
               activeView === 'maintenance' ? 'Monitoramento Mecânico e Disponibilidade de Frota' :
               teamSubView === 'operation' ? 'Gestão de Capital Humano e Capacidade Operativa' : 'Gestão de Squads e Backlog de Manutenção'}
            </p>
          </div>
        </div>
        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">
            <button 
              onClick={() => setActiveView('maintenance')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2",
                activeView === 'maintenance' 
                  ? "bg-white text-blue-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Wrench className="w-4 h-4" />
              Manutenção
            </button>
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
              onClick={() => setActiveView('team')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2",
                activeView === 'team' 
                  ? "bg-white text-blue-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Users className="w-4 h-4" />
              Gestão Operacional
            </button>
          </div>
        </div>
      </header>

      {/* Goal Modal Removed - Moved to HomeMenu */}

      {/* Filters */}
      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2 text-slate-500">
          <Filter className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">Filtros:</span>
        </div>
        
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

      {activeView === 'team' && (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          
          {/* Sub-view Toggle */}
          <div className="flex gap-4 border-b border-slate-200 pb-px">
            <button
              onClick={() => setTeamSubView('operation')}
              className={cn(
                "pb-4 px-2 text-sm font-black transition-all relative",
                teamSubView === 'operation' ? "text-blue-600" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span>Gestão da Operação</span>
              </div>
              {teamSubView === 'operation' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-t-full" />}
            </button>
            <button
              onClick={() => setTeamSubView('maintenance')}
              className={cn(
                "pb-4 px-2 text-sm font-black transition-all relative",
                teamSubView === 'maintenance' ? "text-indigo-600" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4" />
                <span>Gestão da Manutenção</span>
              </div>
              {teamSubView === 'maintenance' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-600 rounded-t-full" />}
            </button>
          </div>

          {teamSubView === 'operation' ? (
            <div className="space-y-10 animate-in fade-in duration-300">
              {/* Operation Team Section */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2">
                    <Users className="w-7 h-7 text-blue-600" />
                    Equipa de Operação
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden group">
                     <div className="p-4 bg-emerald-50 rounded-2xl w-fit mb-4">
                       <UserCheck className="w-6 h-6 text-emerald-600" />
                     </div>
                     <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Operadores Ativos</h4>
                     <p className="text-4xl font-black text-slate-900">{teamStats.operation.availableOperators} <span className="text-sm text-slate-400">/ {teamStats.operation.totalOperators}</span></p>
                     <div className="mt-4 flex items-center gap-2">
                       <div className="flex -space-x-2">
                         {users.filter(u => u.role === 'operator' || u.role === 'production').slice(0, 5).map((u, i) => (
                           <div key={i} className="w-6 h-6 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[8px] font-black">{u.displayName?.charAt(0)}</div>
                         ))}
                       </div>
                       <span className="text-[10px] font-bold text-slate-400">Disponível Hoje</span>
                     </div>
                  </div>

                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                     <div className="p-4 bg-red-50 rounded-2xl w-fit mb-4">
                       <UserMinus className="w-6 h-6 text-red-600" />
                     </div>
                     <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Ausências (Op)</h4>
                     <p className="text-4xl font-black text-red-600">{teamStats.operation.absentOperators}</p>
                     <button 
                       onClick={() => setShowAbsenceModal(true)}
                       className="mt-4 text-[10px] font-black text-blue-600 hover:underline uppercase flex items-center gap-1"
                     >
                       <Plus className="w-3 h-3" /> Registrar Ausência
                     </button>
                  </div>

                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                     <div className="p-4 bg-blue-50 rounded-2xl w-fit mb-4">
                       <Timer className="w-6 h-6 text-blue-600" />
                     </div>
                     <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Capacidade Operacional</h4>
                     <p className="text-4xl font-black text-slate-900">{teamStats.operation.operationalCapacity.toFixed(0)}%</p>
                     <div className="mt-4 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                       <div className="h-full bg-blue-600" style={{ width: `${teamStats.operation.operationalCapacity}%` }} />
                     </div>
                  </div>

                  <div className={cn(
                    "p-8 rounded-[2.5rem] border-2 shadow-sm transition-all",
                    teamStats.operation.riskLevel === 'CRITICAL' ? "bg-red-50 border-red-200" :
                    teamStats.operation.riskLevel === 'HIGH' ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"
                  )}>
                     <div className={cn(
                       "p-4 rounded-2xl w-fit mb-4",
                       teamStats.operation.riskLevel === 'CRITICAL' ? "bg-red-100" : "bg-emerald-100"
                     )}>
                       <ShieldAlert className={cn("w-6 h-6", teamStats.operation.riskLevel === 'CRITICAL' ? "text-red-600" : "text-emerald-600")} />
                     </div>
                     <h4 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-1">Risco Operacional</h4>
                     <p className={cn(
                       "text-4xl font-black",
                       teamStats.operation.riskLevel === 'CRITICAL' ? "text-red-600" : "text-emerald-600"
                     )}>{teamStats.operation.riskLevel}</p>
                     {teamStats.operation.machineOperatorImbalance && (
                       <p className="mt-4 text-[9px] font-black text-red-700 uppercase animate-pulse">⚠️ Máquinas {'>'} Operadores</p>
                     )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                   <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-xl space-y-8">
                     <div className="flex items-center justify-between">
                       <div className="flex items-center gap-3">
                         <Users className="w-6 h-6 text-slate-900" />
                         <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Status da Equipa de Operação</h3>
                       </div>
                     </div>
                     
                     <div className="space-y-4">
                       {users.filter(u => u.role === 'operator' || u.role === 'production').map(user => {
                         const absence = teamStats.operation.activeAbsences.find(a => a.operatorId === user.uid);
                         return (
                           <div key={user.uid} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                             <div className="flex items-center gap-4">
                                <div className={cn(
                                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-black border-2",
                                  absence ? "bg-red-50 border-red-200 text-red-600" : "bg-emerald-50 border-emerald-200 text-emerald-600"
                                )}>
                                  {user.displayName?.charAt(0)}
                                </div>
                                <div>
                                  <p className="text-sm font-black text-slate-900">{user.displayName}</p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{user.sector || 'INDETERMINADO'}</p>
                                </div>
                             </div>
                             <div className="text-right">
                                <span className={cn(
                                  "text-[10px] font-black px-3 py-1 rounded-full uppercase",
                                  absence ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                                )}>
                                  {absence ? absence.reason : 'Disponível'}
                                </span>
                                {absence && <p className="text-[9px] font-black text-slate-400 mt-1 uppercase">Até {new Date(absence.endDate).toLocaleDateString()}</p>}
                             </div>
                           </div>
                         );
                       })}
                     </div>
                   </div>

                   <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-xl space-y-8">
                     <div className="flex items-center gap-3">
                       <BarChart3 className="w-6 h-6 text-blue-600" />
                       <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Impacto na Operação</h3>
                     </div>
                     <div className="h-[300px]">
                       <ResponsiveContainer width="100%" height="100%">
                         <AreaChart data={capacityTrend}>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                           <XAxis dataKey="date" tick={{ fontSize: 10, fontBold: true }} axisLine={false} tickLine={false} />
                           <YAxis domain={[0, 100]} tick={{ fontSize: 10, fontBold: true }} axisLine={false} tickLine={false} />
                           <Tooltip />
                           <Area type="monotone" dataKey="cap" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={4} />
                         </AreaChart>
                       </ResponsiveContainer>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-slate-900 text-white rounded-3xl">
                          <p className="text-[10px] font-black opacity-60 uppercase tracking-widest mb-1">Backlog Estimado (Op)</p>
                          <p className="text-2xl font-black">+{teamStats.operation.absentOperators * 12}H</p>
                        </div>
                        <div className="p-4 bg-slate-50 border border-slate-200 rounded-3xl">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Eficiência de Frota</p>
                          <p className="text-2xl font-black text-slate-900">-{ (100 - teamStats.operation.operationalCapacity).toFixed(0)}%</p>
                        </div>
                     </div>
                   </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-10 animate-in fade-in duration-300">
              {/* Maintenance Team Section */}
              <div className="space-y-6">
                <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2">
                  <Wrench className="w-7 h-7 text-indigo-600" />
                  Gestão da Manutenção
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                     <div className="p-4 bg-indigo-50 rounded-2xl w-fit mb-4">
                       <Activity className="w-6 h-6 text-indigo-600" />
                     </div>
                     <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Capacidade de Reparo</h4>
                     <p className="text-4xl font-black text-slate-900">{teamStats.maintenance.capacity.toFixed(0)}%</p>
                     <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                       {teamStats.maintenance.availableMechanics} de {teamStats.maintenance.totalMechanics} Mecânicos Ativos
                     </p>
                  </div>

                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden">
                     <div className="p-4 bg-amber-50 rounded-2xl w-fit mb-4">
                       <Layers className="w-6 h-6 text-amber-600" />
                     </div>
                     <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Impacto no Backlog</h4>
                     <p className="text-4xl font-black text-slate-900">{teamStats.maintenance.backlog}</p>
                     <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                       {teamStats.maintenance.awaitingMaintenance} aguardando início
                     </p>
                     {teamStats.maintenance.backlog > 0 && (
                       <div className="absolute top-0 right-0 p-4">
                         <AlertTriangle className={cn("w-5 h-5", teamStats.maintenance.backlog > 5 ? "text-red-500 animate-pulse" : "text-amber-500")} />
                       </div>
                     )}
                  </div>

                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                     <div className="p-4 bg-red-50 rounded-2xl w-fit mb-4">
                       <AlertTriangle className="w-6 h-6 text-red-600" />
                     </div>
                     <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">Preventivas em Risco</h4>
                     <p className="text-4xl font-black text-red-600">{teamStats.maintenance.preventivesAtRisk}</p>
                     <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                       Máquinas próximas do limite
                     </p>
                  </div>

                  <div className={cn(
                    "p-8 rounded-[2.5rem] border-2 shadow-sm transition-all",
                    teamStats.maintenance.riskLevel === 'CRITICAL' ? "bg-red-50 border-red-200" :
                    teamStats.maintenance.riskLevel === 'HIGH' ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"
                  )}>
                     <div className={cn(
                       "p-4 rounded-2xl w-fit mb-4",
                       teamStats.maintenance.riskLevel === 'CRITICAL' ? "bg-red-100" : "bg-emerald-100"
                     )}>
                       <ShieldAlert className={cn("w-6 h-6", teamStats.maintenance.riskLevel === 'CRITICAL' ? "text-red-600" : "text-emerald-600")} />
                     </div>
                     <h4 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-1">Previsão de Atraso</h4>
                     <p className={cn(
                       "text-4xl font-black",
                       teamStats.maintenance.riskLevel === 'CRITICAL' ? "text-red-600" : "text-emerald-600"
                     )}>~{teamStats.maintenance.estimatedDelayDays} Dias</p>
                     <p className="mt-2 text-[9px] font-black text-slate-400 uppercase">Impacto na disponibilidade preventiva</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 bg-white p-10 rounded-[3rem] border border-slate-200 shadow-xl space-y-8">
                    <div className="flex items-center gap-3">
                      <Wrench className="w-6 h-6 text-slate-900" />
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Status da Equipe Mecânica</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {users.filter(u => u.role === 'mechanic').map(user => {
                        const absence = teamStats.maintenance.activeAbsences.find(a => a.operatorId === user.uid);
                        return (
                          <div key={user.uid} className="flex items-center justify-between p-5 bg-slate-50 rounded-3xl border border-slate-100 hover:border-indigo-200 transition-colors">
                            <div className="flex items-center gap-4">
                               <div className={cn(
                                 "w-12 h-12 rounded-full flex items-center justify-center text-lg font-black border-2",
                                 absence ? "bg-red-50 border-red-200 text-red-600" : "bg-indigo-50 border-indigo-200 text-indigo-600"
                               )}>
                                 {user.displayName?.charAt(0)}
                               </div>
                               <div>
                                 <p className="text-sm font-black text-slate-900">{user.displayName}</p>
                                 <div className="flex items-center gap-2 mt-1">
                                    <span className={cn(
                                      "w-2 h-2 rounded-full",
                                      absence ? "bg-red-500" : "bg-emerald-500"
                                    )} />
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                      {absence ? 'Indisponível' : 'Disponível'}
                                    </p>
                                 </div>
                               </div>
                            </div>
                            <div className="text-right">
                               {absence ? (
                                 <span className="text-[10px] font-black px-3 py-1 rounded-full bg-red-100 text-red-700 uppercase">
                                   {absence.reason}
                                 </span>
                               ) : (
                                 <span className="text-[10px] font-black px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 uppercase">
                                   Ativo
                                 </span>
                               )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bg-slate-900 p-10 rounded-[3rem] text-white space-y-8 shadow-2xl relative overflow-hidden">
                    <div className="relative z-10 space-y-8">
                      <div className="flex items-center gap-3">
                        <Target className="w-6 h-6 text-blue-400" />
                        <h3 className="text-xl font-black uppercase tracking-tighter">Impacto Estimado</h3>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="p-6 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-md">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Acréscimo no Backlog</p>
                          <p className="text-3xl font-black text-blue-400">+{teamStats.maintenance.absentMechanics * 8}H / Dia</p>
                        </div>

                        <div className="p-6 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-md">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Criticidade da Frota</p>
                          <p className={cn(
                            "text-3xl font-black",
                            teamStats.maintenance.riskLevel === 'CRITICAL' ? "text-red-400" : "text-emerald-400"
                          )}>{teamStats.maintenance.riskLevel}</p>
                        </div>

                        <div className="p-6 bg-blue-600 rounded-3xl shadow-xl shadow-blue-900/50">
                          <p className="text-[10px] font-black text-white/60 uppercase tracking-widest mb-2">Velocidade de Atendimento</p>
                          <p className="text-3xl font-black text-white">-{ (100 - teamStats.maintenance.capacity).toFixed(0)}% <span className="text-sm font-normal opacity-60">Vel.</span></p>
                        </div>
                      </div>
                    </div>
                    
                    <Activity className="absolute -bottom-10 -right-10 w-64 h-64 text-white/5 rotate-12" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeView === 'maintenance' && (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
          
          {/* CRITICAL MACHINES ALERT - HIGH IMPACT VIEW */}
          {currentStatusStats.criticalMachines.length > 0 && (
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-red-50 border-2 border-red-200 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <AlertTriangle className="w-48 h-48 text-red-600 rotate-12" />
              </div>

              <div className="flex items-center gap-6 mb-10 relative">
                <div className="p-5 bg-red-600 text-white rounded-[1.5rem] shadow-xl shadow-red-200 bubble-animate">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-3xl font-black text-red-950 tracking-tight uppercase">Blacklist Operacional</h2>
                  <p className="text-red-600/80 font-black uppercase text-[10px] tracking-[0.2em]">Equipamentos com parada superior a 30 dias - Atenção Imediata</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 relative">
                {currentStatusStats.criticalMachines.map((m: any, idx: number) => (
                  <motion.div 
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: idx * 0.1 }}
                    key={m.id} 
                    className="bg-white/80 backdrop-blur-md p-8 rounded-[2.5rem] shadow-xl shadow-red-900/5 border border-red-100 flex flex-col justify-between group/card hover:bg-white transition-all"
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div className="w-12 h-12 bg-slate-950 text-white rounded-2xl flex items-center justify-center font-black text-xs uppercase shadow-lg">
                        {m.code.slice(0, 3)}
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-2xl font-black text-slate-950 tracking-tighter">{m.code}</span>
                        <span className="px-3 py-1 bg-red-600 text-white text-[9px] font-black rounded-full uppercase mt-1">{m.days} DIAS</span>
                      </div>
                    </div>

                    <div className="space-y-4 mb-8">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Motivo Crítico</span>
                        <p className="text-sm text-slate-700 font-bold leading-tight">{m.reason || 'Falha Técnica Não Especificada'}</p>
                      </div>
                      <div className="bg-red-50/50 p-4 rounded-2xl border border-red-100/50 flex justify-between items-center">
                        <div>
                          <p className="text-[8px] font-black text-red-400 uppercase tracking-widest">Impacto</p>
                          <p className="text-lg font-black text-red-600 leading-none">{m.lostHours}h</p>
                        </div>
                        <Activity className="w-5 h-5 text-red-200" />
                      </div>
                    </div>

                    <div className="pt-6 border-t border-red-50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-red-600 rounded-full animate-ping" />
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-tight">{m.status.replace('_', ' ')}</span>
                      </div>
                      <ArrowLeft className="w-4 h-4 text-slate-300 rotate-180 group-hover/card:translate-x-1 transition-transform" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* AREA 1: ANALYTICAL FLEET SUMMARY */}
          <section>
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-200">
                  <BarChart3 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-3xl font-black text-slate-950 tracking-tight uppercase">Performance da Frota</h2>
                  <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">Tempo Real e Disponibilidade Sistemática</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {/* STATUS CARDS WITH NEW DESIGN */}
              {[
                { 
                  label: 'Disponibilidade', 
                  value: `${kpis.currentAvailability.toFixed(1)}%`, 
                  sub: `Frota: ${uniqueForklifts.length} Maq.`,
                  icon: Activity, 
                  color: kpis.currentAvailability >= 90 ? 'emerald' : kpis.currentAvailability >= 85 ? 'amber' : 'red',
                  desc: 'Equipamentos prontos p/ uso'
                },
                { 
                  label: 'Horas Perdidas', 
                  value: currentStatusStats.totalLostHours, 
                  sub: 'Impacto Acumulado',
                  icon: Timer, 
                  color: 'slate',
                  desc: 'Capacidade não utilizada'
                },
                { 
                  label: 'Backlog Ativo', 
                  value: currentStatusStats.totalStopped, 
                  sub: `${currentStatusStats.backlog.critical} Críticos`,
                  icon: Layers, 
                  color: 'amber',
                  desc: 'Aguardando intervenção'
                },
                { 
                  label: 'Aging Médio', 
                  value: currentStatusStats.aging.over15 + currentStatusStats.aging.eightTo15, 
                  sub: 'Maquinas > 7 dias',
                  icon: Clock, 
                  color: 'red',
                  desc: 'Inércia de Manutenção'
                }
              ].map((card, idx) => (
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: idx * 0.1 }}
                  key={card.label}
                  className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm transition-all hover:shadow-2xl hover:shadow-slate-200/50 group"
                >
                  <div className="flex justify-between items-start mb-8">
                    <div className={cn(
                      "w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:rotate-12",
                      card.color === 'emerald' ? "bg-emerald-600 text-white" :
                      card.color === 'amber' ? "bg-amber-600 text-white" :
                      card.color === 'red' ? "bg-red-600 text-white" : "bg-slate-900 text-white"
                    )}>
                      <card.icon className="w-6 h-6" />
                    </div>
                    <div className="text-right">
                       <p className="text-[10px] font-black text-slate-400 tracking-widest uppercase">{card.label}</p>
                       <p className="text-[10px] font-bold text-slate-300 uppercase tracking-tighter mt-1">{card.desc}</p>
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-5xl font-black text-slate-950 tracking-tighter tabular-nums mb-2">{card.value}</h3>
                    <div className="flex items-center gap-2">
                       <span className={cn(
                         "w-1.5 h-1.5 rounded-full",
                         card.color === 'emerald' ? "bg-emerald-500" :
                         card.color === 'amber' ? "bg-amber-500" :
                         card.color === 'red' ? "bg-red-500" : "bg-slate-400"
                       )} />
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{card.sub}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          {/* AREA 2: ANALYTICAL HISTORY */}
          <section className="bg-white p-12 rounded-[4rem] border border-slate-100 shadow-xl shadow-slate-200/50">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-xl shadow-emerald-100">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                   <h2 className="text-2xl font-black text-slate-950 tracking-tight uppercase">Saúde Operacional</h2>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ciclo Mensal de Disponibilidade & Confiabilidade</p>
                </div>
              </div>
              <div className="px-6 py-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-4">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-black text-slate-800 uppercase tracking-widest">
                  {months.find(m => m.value === filterMonth)?.label || 'Anual'} {filterYear}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
              {/* ANALYTICAL TILES */}
              <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100/60 lg:col-span-1">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Confiabilidade</p>
                <h4 className={cn(
                  "text-5xl font-black tracking-tighter mb-4",
                  kpis.reliabilityScore >= 80 ? "text-emerald-600" : kpis.reliabilityScore >= 60 ? "text-amber-500" : "text-red-600"
                )}>
                  {kpis.reliabilityScore.toFixed(0)}<span className="text-xl font-medium text-slate-400">/100</span>
                </h4>
                <div className="space-y-1">
                   <p className="text-[10px] font-black text-slate-900 uppercase">Score MTBF</p>
                   <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${kpis.reliabilityScore}%` }} className="h-full bg-slate-900" />
                   </div>
                </div>
              </div>

              <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100/60 lg:col-span-1 flex flex-col justify-between">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Reparo Médio</p>
                  <h4 className="text-3xl font-black text-slate-950">{formatDuration(kpis.mttr)}</h4>
                </div>
                <div className="pt-4 border-t border-slate-200/50">
                   <span className="text-[10px] font-black text-slate-400 uppercase">Meta MTTR: {'<'} 04:00h</span>
                </div>
              </div>

              <div className="p-8 bg-blue-50/50 rounded-[2.5rem] border border-blue-100/50 lg:col-span-1">
                <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-4">Disponibilidade</p>
                <h4 className={cn(
                  "text-5xl font-black tracking-tighter mb-4",
                  kpis.monthlyAvailability >= 90 ? "text-emerald-600" : kpis.monthlyAvailability >= 85 ? "text-amber-600" : "text-red-600"
                )}>
                  {kpis.monthlyAvailability.toFixed(1)}%
                </h4>
                <p className="text-[9px] font-black text-blue-600/60 uppercase">Resultado Período</p>
              </div>

              <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100/60 lg:col-span-2 flex flex-col justify-center">
                 <div className="flex items-center justify-between mb-6">
                    <div>
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Novas Falhas</p>
                       <p className="text-4xl font-black text-slate-950">{kpis.monthlyNewFailures}</p>
                    </div>
                    <div>
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Concluídos</p>
                       <p className="text-4xl font-black text-emerald-600">{kpis.monthlyCompleted}</p>
                    </div>
                 </div>
                 <div className="flex items-center gap-4">
                    <div className="flex-1 h-3 bg-red-100 rounded-lg overflow-hidden flex">
                       <div className="h-full bg-red-500" style={{ width: `${(kpis.correctiveCount / (kpis.monthlyNewFailures || 1)) * 100}%` }} />
                       <div className="h-full bg-blue-500" style={{ width: `${(kpis.preventiveCount / (kpis.monthlyNewFailures || 1)) * 100}%` }} />
                    </div>
                    <div className="flex gap-4">
                       <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 bg-red-500 rounded-full" />
                          <span className="text-[8px] font-black text-slate-600 uppercase">CORR</span>
                       </div>
                       <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 bg-blue-500 rounded-full" />
                          <span className="text-[8px] font-black text-slate-600 uppercase">PREV</span>
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          </section>

          {/* Machine Analysis and Reliability Ranking */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-slate-900" />
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Ranking de Indisponibilidade</h3>
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">Top 5 Reincidentes</span>
              </div>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topAffectedMachines} layout="vertical" margin={{ left: 20, right: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                    <XAxis type="number" hide />
                    <YAxis 
                      type="category" 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontWeight: 900, fill: '#64748b' }}
                      width={120}
                    />
                    <Tooltip 
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '16px', border: 'none', shadow: 'xl' }}
                    />
                    <Bar dataKey="count" fill="#1e293b" radius={[0, 8, 8, 0]} barSize={24}>
                      <LabelList 
                        dataKey="count" 
                        position="right" 
                        offset={10}
                        style={{ fontSize: '11px', fontWeight: '900', fill: '#1e293b' }} 
                        formatter={(v: any) => `${v} Quebras`} 
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-blue-500" />
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Ranking de Confiabilidade (Score)</h3>
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">Score 0-100 (Disponibilidade + MTBF)</span>
              </div>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={uniqueForklifts.map(f => {
                       const fHistory = maintenanceHistory.filter(h => h.forkliftId === f.id && h.type === 'corrective');
                       const activeStop = activeStops.find(s => s.forkliftId === f.id);
                       
                       // Calculate Individual MTBF
                       const totalHrs = (f.lastHourMeter || 0);
                       const mtbf = fHistory.length > 0 ? totalHrs / fHistory.length : totalHrs;
                       
                       // Penalty for currently stopped
                       let penalty = 0;
                       if (activeStop) {
                         const diffDays = Math.floor((new Date().getTime() - new Date(activeStop.stopTime).getTime()) / (1000 * 60 * 60 * 24));
                         penalty = 50 + (diffDays * 2); // Heavy initial penalty + daily increase
                       }

                       // Simple score: normalized mtbf (0-50) + availability proxy (0-50) - penalty
                       const mtbfScore = Math.min(50, (mtbf / 500) * 50);
                       const availabilityScore = activeStop ? 0 : 50;
                       const finalScore = Math.max(0, mtbfScore + availabilityScore - penalty);

                       return { 
                         name: f.model, 
                         score: Math.round(finalScore),
                         mtbf: Math.round(mtbf),
                         isStopped: !!activeStop
                       };
                    }).sort((a, b) => b.score - a.score).slice(0, 5)} 
                    layout="vertical" 
                    margin={{ left: 20, right: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="#f1f5f9" />
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis 
                      type="category" 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontBold: true, fill: '#64748b' }}
                      width={100}
                    />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none' }} />
                    <Bar dataKey="score" radius={[0, 8, 8, 0]} barSize={24}>
                       {uniqueForklifts.map((f, index) => (
                         <Cell key={`cell-${index}`} fill={f.status === 'available' ? '#10b981' : '#f59e0b'} />
                       ))}
                       <LabelList 
                         dataKey="score" 
                         position="right" 
                         style={{ fontSize: '10px', fontBold: true, fill: '#1e293b' }}
                         formatter={(v: any) => `${v}/100`}
                       />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Reasons and Parts Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Motivos Recorrentes</h3>
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">Por Categoria</span>
              </div>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={maintenanceReasons} layout="vertical" margin={{ left: 20, right: 60, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="#f1f5f9" />
                    <XAxis type="number" hide />
                    <YAxis 
                      type="category" 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontWeight: 900, fill: '#64748b' }}
                      width={120}
                    />
                    <Tooltip 
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '16px', border: 'none', shadow: 'xl' }}
                    />
                    <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={24}>
                      {maintenanceReasons.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                      <LabelList 
                        dataKey="value" 
                        position="right" 
                        offset={10}
                        style={{ fontSize: '12px', fontWeight: '900', fill: '#1e293b' }} 
                        formatter={(v: any) => `${v}`} 
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-amber-500" />
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Consumo de Peças</h3>
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">Top 10 Itens</span>
              </div>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={partsData} layout="vertical" margin={{ left: 20, right: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="#f1f5f9" />
                    <XAxis type="number" hide />
                    <YAxis 
                      type="category" 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontWeight: 900, fill: '#64748b' }}
                      width={120}
                    />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none' }} />
                    <Bar dataKey="quantity" fill="#f59e0b" radius={[0, 8, 8, 0]} barSize={20}>
                      <LabelList 
                        dataKey="quantity" 
                        position="right" 
                        style={{ fontSize: '10px', fontBold: true, fill: '#1e293b' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          <section>
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="h-8 w-1.5 bg-slate-900 rounded-full" />
                <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Cards de Frota</h2>
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-black rounded-lg border border-emerald-100">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  OPERANTE
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-red-50 text-red-700 text-[10px] font-black rounded-lg border border-red-100">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  PARADA
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {uniqueForklifts.map(forklift => {
                const activeStop = activeStops.find(s => s.forkliftId === forklift.id);
                const isStopped = forklift.status === 'stopped' || forklift.status === 'maintenance' || forklift.status === 'interdicted' || forklift.status === 'external';
                
                const now = new Date();
                const daysStopped = isStopped && activeStop 
                  ? Math.floor((now.getTime() - new Date(activeStop.stopTime).getTime()) / (1000 * 60 * 60 * 24))
                  : 0;

                // Advanced Analytics per Machine
                const fHistory = maintenanceHistory.filter(h => h.forkliftId === forklift.id);
                const correctiveHistory = fHistory.filter(h => h.type === 'corrective');
                
                // Unavailability YTD (Year to Date)
                const currentYear = new Date().getFullYear();
                const ytdHistory = fHistory.filter(h => new Date(h.stopTime).getFullYear() === currentYear);
                const ytdDowntimeDays = ytdHistory.reduce((acc, h) => {
                  const hStart = new Date(h.stopTime).getTime();
                  const hEnd = h.endTime ? new Date(h.endTime).getTime() : now.getTime();
                  return acc + ((hEnd - hStart) / (1000 * 60 * 60 * 24));
                }, 0);

                // Reincidence (Same category failures in last 90 days)
                const ninetyDaysAgoMoment = new Date();
                ninetyDaysAgoMoment.setDate(ninetyDaysAgoMoment.getDate() - 90);
                const ninetyDaysAgo = ninetyDaysAgoMoment.toISOString();
                
                const reincidenceMap: Record<string, number> = {};
                correctiveHistory.filter(h => h.stopTime > ninetyDaysAgo).forEach(h => {
                   const cat = h.category || 'Geral';
                   reincidenceMap[cat] = (reincidenceMap[cat] || 0) + 1;
                });
                const topReincidence = Object.entries(reincidenceMap).sort((a,b) => b[1] - a[1])[0];
                
                const hoursToPreventive = (forklift.nextPreventiveHorometer || 0) - (forklift.lastHourMeter || 0);
                const estCost = fHistory.reduce((acc, h) => acc + (h.estimatedCost || 0), 0);
                
                let riskScore: 'low' | 'medium' | 'high' | 'critical' = 'low';
                if (daysStopped > 15 || correctiveHistory.length > 5 || hoursToPreventive < 0) riskScore = 'critical';
                else if (daysStopped > 7 || correctiveHistory.length > 3 || hoursToPreventive < 20) riskScore = 'high';
                else if (daysStopped > 3 || correctiveHistory.length > 1 || hoursToPreventive < 50) riskScore = 'medium';

                const getAlertColor = () => {
                  if (!isStopped) {
                      if (riskScore === 'critical') return "border-red-400 bg-red-50/20";
                      if (riskScore === 'high') return "border-amber-400 bg-amber-50/20";
                      return "border-slate-200 bg-white";
                  }
                  if (daysStopped >= 30) return "border-red-600 bg-red-50 shadow-2xl shadow-red-200";
                  if (daysStopped >= 15) return "border-red-500 bg-red-50 shadow-red-100";
                  if (daysStopped >= 8) return "border-orange-500 bg-orange-50 shadow-orange-100";
                  if (daysStopped >= 4) return "border-amber-500 bg-amber-50 shadow-amber-100";
                  return "border-emerald-500 bg-emerald-50 shadow-emerald-100";
                };

                return (
                  <div key={forklift.id} className={cn(
                    "p-8 rounded-[3rem] border-2 transition-all duration-500 hover:scale-[1.01] cursor-default flex flex-col justify-between h-full shadow-xl relative overflow-hidden group",
                    getAlertColor()
                  )}>
                    {isStopped && <div className={cn("absolute top-0 right-0 w-32 h-32 rounded-bl-[5rem] pointer-events-none opacity-20", daysStopped >= 15 ? "bg-red-600" : "bg-amber-600")} />}
                    
                    <div>
                      <div className="flex justify-between items-start mb-8">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-3xl font-black text-slate-900 tracking-tighter">{forklift.model}</h3>
                            {riskScore === 'critical' && <ShieldAlert className="w-5 h-5 text-red-600 animate-pulse" />}
                          </div>
                          <div className="flex items-center gap-2">
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{forklift.serialNumber}</p>
                             <span className="w-1 h-1 bg-slate-200 rounded-full" />
                             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{forklift.sector || 'OPERACIONAL'}</p>
                          </div>
                        </div>
                        <div className={cn(
                          "px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-tighter shadow-sm flex items-center gap-2",
                          isStopped ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
                        )}>
                          <div className={cn("w-2 h-2 rounded-full", isStopped ? "bg-white animate-pulse" : "bg-emerald-200")} />
                          {isStopped ? (daysStopped >= 30 ? 'CRÍTICO' : 'PARADA') : 'OPERANDO'}
                        </div>
                      </div>

                      {isStopped && activeStop ? (
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <div className="bg-white/60 backdrop-blur-sm p-4 rounded-2xl border border-white/50">
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3 text-red-500" /> Motivo da Parada
                                    </p>
                                    <p className="text-sm font-black text-slate-900 leading-tight">{activeStop.description}</p>
                                    <p className="text-[8px] font-bold text-slate-400 uppercase mt-2">Quebra em: {formatDate(activeStop.stopTime)}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-red-600 text-white rounded-2xl shadow-lg shadow-red-100">
                                        <p className="text-[8px] font-black opacity-80 uppercase tracking-widest mb-1">Dias Parada</p>
                                        <p className="text-2xl font-black">{daysStopped}d</p>
                                    </div>
                                    <div className="p-4 bg-slate-900 text-white rounded-2xl">
                                        <p className="text-[8px] font-black opacity-60 uppercase tracking-widest mb-1">Horas Perdidas</p>
                                        <p className="text-2xl font-black">{daysStopped * 12}h</p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center bg-white/40 p-3 rounded-xl border border-white/40">
                                    <span className="text-[9px] font-black text-slate-500 uppercase">Status Operacional</span>
                                    <span className="text-[10px] font-black text-slate-800 uppercase px-2 py-0.5 bg-white/60 rounded-lg">{activeStop.status.replace('_', ' ')}</span>
                                </div>
                                <div className="flex justify-between items-center bg-white/40 p-3 rounded-xl border border-white/40">
                                    <span className="text-[9px] font-black text-slate-500 uppercase">Indisponibilidade YTD</span>
                                    <span className="text-[10px] font-black text-red-600 uppercase">{ytdDowntimeDays.toFixed(0)} Dias no Ano</span>
                                </div>
                                {topReincidence && topReincidence[1] > 1 && (
                                    <div className="flex justify-between items-center bg-red-50/50 p-3 rounded-xl border border-red-100">
                                        <span className="text-[9px] font-black text-red-500 uppercase">Reincidência</span>
                                        <span className="text-[10px] font-black text-red-600 uppercase px-2 py-0.5 bg-red-100 rounded-lg">{topReincidence[1]}x {topReincidence[0]}</span>
                                    </div>
                                )}
                            </div>
                            
                            <div className="flex items-center justify-between px-1">
                                <div className="flex items-center gap-2">
                                    <Package className="w-4 h-4 text-slate-400" />
                                    <span className="text-[10px] font-bold text-slate-500 uppercase">Peças: {activeStop.status === 'awaiting_parts' ? 'Aguardando' : 'Em Mãos'}</span>
                                </div>
                                <span className={cn(
                                    "text-[10px] font-black px-3 py-1 rounded-full uppercase",
                                    riskScore === 'critical' ? "bg-red-600 text-white" : "bg-amber-100 text-amber-700"
                                )}>
                                    Criticidade {riskScore.toUpperCase()}
                                </span>
                            </div>
                        </div>
                      ) : (
                        <div className="space-y-6">
                           <div className="grid grid-cols-2 gap-4">
                              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Disponibilidade</p>
                                  <p className="text-xl font-black text-emerald-600 tracking-tighter">98.5%</p>
                              </div>
                              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Horímetro Atual</p>
                                  <p className="text-xl font-black text-slate-900 tracking-tighter">{forklift.lastHourMeter || 0}h</p>
                              </div>
                           </div>

                           <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center px-1">
                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Próxima Preventiva</span>
                                        <span className="text-[10px] font-black text-slate-900 uppercase">Em {hoursToPreventive}h</span>
                                    </div>
                                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                        <div 
                                          className={cn("h-full transition-all duration-1000", hoursToPreventive < 50 ? "bg-red-500" : "bg-blue-600")} 
                                          style={{ width: `${Math.max(0, Math.min(100, 100 - (hoursToPreventive / 500 * 100)))}%` }} 
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 text-center">
                                    <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                                        <p className="text-[8px] font-black text-slate-400 uppercase">Utilização</p>
                                        <p className="text-xs font-black text-slate-700">8.4h/dia</p>
                                    </div>
                                    <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                                        <p className="text-[8px] font-black text-slate-400 uppercase">Produtividade</p>
                                        <p className="text-xs font-black text-slate-700">92pk/h</p>
                                    </div>
                                </div>
                                
                                <div className="flex justify-between items-center px-1 pt-2">
                                    <div className="flex items-center gap-2">
                                        <Activity className="w-4 h-4 text-emerald-500" />
                                        <span className="text-[10px] font-black text-slate-500 uppercase">Efic. Operacional</span>
                                    </div>
                                    <span className="text-[10px] font-black text-emerald-600">ALTA</span>
                                </div>
                           </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-10 pt-6 border-t border-slate-100/50 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
                                <Users className="w-4 h-4 text-slate-400" />
                            </div>
                            {checklists.some(c => c.forkliftId === forklift.id && c.timestamp.startsWith(new Date().toISOString().split('T')[0])) && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full flex items-center justify-center">
                                    <UserCheck className="w-2 h-2 text-white" />
                                </div>
                            )}
                        </div>
                        <div>
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Responsável Atual</p>
                            <p className="text-[10px] font-black text-slate-900 truncate max-w-[120px] uppercase">{forklift.assignedOperatorName || '--'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                         <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Custo Est. YTD</p>
                         <p className="text-xs font-black text-slate-900">R$ {estCost.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Parts Analysis */}
          <div className="bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-xl space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-50 rounded-2xl text-blue-600">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Análise de Peças e Componentes</h3>
                  <p className="text-sm font-medium text-slate-500">Itens com maior índice de substituição no período</p>
                </div>
              </div>
            </div>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={partsData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 11, fontWeight: 900, fill: '#64748b' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 800, fill: '#94a3b8' }} 
                  />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '20px', border: 'none', shadow: '2xl', padding: '16px' }}
                  />
                  <Bar dataKey="quantity" fill="#3b82f6" radius={[12, 12, 0, 0]} barSize={45}>
                    <LabelList dataKey="quantity" position="top" style={{ fontSize: '12px', fontWeight: '900', fill: '#3b82f6' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Absence Management Modal */}
      {showAbsenceModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Registrar Ausência</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão de Equipa Operacional</p>
              </div>
              <button onClick={() => setShowAbsenceModal(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Operador / Colaborador</label>
                <select 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-bold outline-none focus:ring-4 focus:ring-blue-500/10"
                  onChange={(e) => setNewAbsence({ ...newAbsence, operatorId: e.target.value })}
                >
                  <option value="">Selecione o operador...</option>
                  {users.filter(u => u.role === 'operator' || u.role === 'production' || u.role === 'mechanic').map(u => (
                    <option key={u.uid} value={u.uid}>{u.displayName} ({u.role === 'mechanic' ? 'Manutenção' : u.sector || 'Operacional'})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Início</label>
                  <input 
                    type="date"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-bold outline-none focus:ring-4 focus:ring-blue-500/10"
                    value={newAbsence.startDate}
                    onChange={(e) => setNewAbsence({ ...newAbsence, startDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Fim Previsto</label>
                  <input 
                    type="date"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-bold outline-none focus:ring-4 focus:ring-blue-500/10"
                    value={newAbsence.endDate}
                    onChange={(e) => setNewAbsence({ ...newAbsence, endDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Motivo da Ausência</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.values(AbsenceReason).map(reason => (
                    <button
                      key={reason}
                      onClick={() => setNewAbsence({ ...newAbsence, reason })}
                      className={cn(
                        "p-3 rounded-xl border text-[10px] font-black uppercase transition-all",
                        newAbsence.reason === reason 
                          ? "bg-slate-900 border-slate-900 text-white shadow-lg" 
                          : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                      )}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Observações</label>
                <textarea 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/10 min-h-[80px]"
                  placeholder="Detalhes adicionais..."
                  onChange={(e) => setNewAbsence({ ...newAbsence, notes: e.target.value })}
                />
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
              <button 
                onClick={() => setShowAbsenceModal(false)}
                className="flex-1 px-6 py-4 rounded-2xl text-[11px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-200 transition-colors"
                disabled={isRefreshing}
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveAbsence}
                className="flex-1 px-6 py-4 rounded-2xl text-[11px] font-black text-white bg-blue-600 uppercase tracking-widest hover:bg-blue-700 shadow-xl shadow-blue-100 transition-all disabled:opacity-50"
                disabled={isRefreshing || !newAbsence.operatorId}
              >
                Confirmar Registro
              </button>
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
