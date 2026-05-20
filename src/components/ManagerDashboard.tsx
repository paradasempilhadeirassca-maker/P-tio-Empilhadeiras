import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { TrendingUp, Clock, Activity, AlertTriangle, Users, Package, Calendar, Filter, Bell, ClipboardCheck, Watch, Layers, BoxSelect, Truck, CloudRain, Info, ArrowLeft, Target, Settings2, Plus, Save, X, Trash2, History as HistoryIcon, Wrench, ShieldAlert, BarChart3, ChevronRight, UserMinus, UserCheck, Timer, Footprints, ShieldCheck, Zap, CheckCircle2, AlertCircle, LayoutDashboard } from 'lucide-react';
import { cn, formatDuration, formatDate, formatTime, formatDateTime, formatCurrency, formatNumber } from '../lib/utils';
import { calculateOperatorEfficiency } from '../lib/operationalLogic';
import { sendWhatsAppNotification, sendLocalNotification } from '../lib/notifications';
import { getMaintenanceStatus } from '../lib/maintenanceLogic';

const parseDateSafe = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      return val.toDate();
    }
    if (typeof val.seconds === 'number') {
      return new Date(val.seconds * 1000);
    }
  }
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    return d;
  }
  return new Date();
};

function KPIItem({ label, value, subValue, icon, color, trend, trendType }: { 
  label: string; 
  value: string; 
  subValue: string; 
  icon: React.ReactNode; 
  color: 'blue' | 'emerald' | 'red' | 'amber' | 'indigo'; 
  trend?: string; 
  trendType?: 'up' | 'down' | 'neutral' 
}) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  };

  return (
    <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm transition-all hover:shadow-md group">
      <div className={cn("p-4 rounded-2xl w-fit mb-4 group-hover:scale-110 transition-transform", colorClasses[color] || 'bg-slate-50 text-slate-600')}>
        {icon}
      </div>
      <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">{label}</h4>
      <div className="flex items-baseline gap-2">
        <p className="text-4xl font-black text-slate-900">{value}</p>
        {trend && (
          <span className={cn(
            "text-[10px] font-black uppercase px-2 py-0.5 rounded-lg",
            trendType === 'up' ? "bg-emerald-50 text-emerald-600" : 
            trendType === 'down' ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"
          )}>
            {trend}
          </span>
        )}
      </div>
      <p className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{subValue}</p>
    </div>
  );
}

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
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Mechanic presence/absence (pointing) states
  const [selectedMechanicId, setSelectedMechanicId] = useState<string>('');
  const [absenceStartDate, setAbsenceStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [absenceEndDate, setAbsenceEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [absenceReason, setAbsenceReason] = useState<AbsenceReason>(AbsenceReason.DAY_OFF);
  const [absenceNotes, setAbsenceNotes] = useState<string>('');
  const [isLoggingAbsence, setIsLoggingAbsence] = useState<boolean>(false);

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

  const matchesForkliftFilter = useCallback((itemForkliftId: string, filterVal: string) => {
    if (filterVal === 'all') return true;
    if (!itemForkliftId) return false;
    if (itemForkliftId === filterVal) return true;
    
    // Fallback: Resolve both matching items to their serial numbers for canonical comparison
    const itemForklift = forklifts.find(fork => 
      fork.id === itemForkliftId || 
      (fork.serialNumber && fork.serialNumber.trim().toLowerCase() === itemForkliftId.trim().toLowerCase())
    );
    const filterForkliftObj = forklifts.find(fork => fork.id === filterVal);
    
    if (itemForklift && filterForkliftObj && itemForklift.serialNumber && filterForkliftObj.serialNumber) {
      return itemForklift.serialNumber.trim().toLowerCase() === filterForkliftObj.serialNumber.trim().toLowerCase();
    }
    return false;
  }, [forklifts]);

  const filteredChecklists = useMemo(() => {
    return checklists.filter(cl => {
      const date = parseDateSafe(cl.timestamp);
      
      const matchesYear = date.getFullYear().toString() === filterYear;
      const matchesMonth = filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth;
      const matchesForklift = matchesForkliftFilter(cl.forkliftId, filterForklift);
      const matchesOperator = filterOperator === 'all' || cl.operatorId === filterOperator;
      return matchesYear && matchesMonth && matchesForklift && matchesOperator;
    });
  }, [checklists, filterYear, filterMonth, filterForklift, filterOperator, matchesForkliftFilter]);

  const filteredHistory = useMemo(() => {
    return maintenanceHistory.filter(h => {
      const date = parseDateSafe(h.stopTime);

      const matchesYear = date.getFullYear().toString() === filterYear;
      const matchesMonth = filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth;
      const matchesForklift = matchesForkliftFilter(h.forkliftId, filterForklift);
      const matchesOperator = filterOperator === 'all' || h.operatorId === filterOperator || (h.operatorIds && h.operatorIds.includes(filterOperator));
      return matchesYear && matchesMonth && matchesForklift && matchesOperator;
    });
  }, [maintenanceHistory, filterYear, filterMonth, filterForklift, filterOperator, matchesForkliftFilter]);

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
      const stopDate = parseDateSafe(stop.stopTime);
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
        const forklift = forklifts.find(f => 
          f.id === stop.forkliftId || 
          (f.serialNumber && stop.forkliftId && f.serialNumber.trim().toLowerCase() === stop.forkliftId.trim().toLowerCase())
        );
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
    // Unique list of forklifts filtered if necessary
    const targetUniqueForklifts = filterForklift === 'all' 
      ? uniqueForklifts 
      : uniqueForklifts.filter(f => f.id === filterForklift || (f.serialNumber && filterForklift && f.serialNumber.trim().toLowerCase() === filterForklift.trim().toLowerCase()));

    const totalFleetUnits = targetUniqueForklifts.length || 1;
    
    // Active stops filtered if necessary
    const targetActiveStops = filterForklift === 'all'
      ? activeStops
      : activeStops.filter(s => matchesForkliftFilter(s.forkliftId, filterForklift));
      
    const filteredActiveStops = filterOperator === 'all'
      ? targetActiveStops
      : targetActiveStops.filter(s => s.operatorId === filterOperator || (s.operatorIds && s.operatorIds.includes(filterOperator)));

    const stoppedUnits = filteredActiveStops.length;
    
    // Fleet instant availability
    const currentAvailability = ((totalFleetUnits - stoppedUnits) / totalFleetUnits) * 100;

    // Monthly View KPIs
    const start = parseDateSafe(startDate);
    const end = parseDateSafe(endDate);
    const now = new Date();
    const effectiveEndForPeriod = Math.min(end.getTime(), now.getTime());
    const totalPeriodDays = Math.max(1, (effectiveEndForPeriod - start.getTime()) / (1000 * 60 * 60 * 24));
    
    // Planned hours based on target forklifts only
    const totalPlannedHours = totalFleetUnits * 12 * totalPeriodDays;

    // Calculate total downtime in the period for ALL relevant stops
    const allStopsInPeriod = maintenanceHistory.filter(h => {
      const hStop = parseDateSafe(h.stopTime).getTime();
      const hEnd = h.endTime ? parseDateSafe(h.endTime).getTime() : now.getTime();
      
      const matchesForklift = matchesForkliftFilter(h.forkliftId, filterForklift);
      const matchesOperator = filterOperator === 'all' || h.operatorId === filterOperator || (h.operatorIds && h.operatorIds.includes(filterOperator));

      return hStop < effectiveEndForPeriod && hEnd > start.getTime() && matchesForklift && matchesOperator;
    });

    const totalDowntimeHours = allStopsInPeriod.reduce((acc, h) => {
      const hStop = parseDateSafe(h.stopTime).getTime();
      const hEnd = h.endTime ? parseDateSafe(h.endTime).getTime() : now.getTime();
      const effectiveStart = Math.max(start.getTime(), hStop);
      const effectiveEnd = Math.min(effectiveEndForPeriod, hEnd);
      const durationMs = Math.max(0, effectiveEnd - effectiveStart);
      
      // Convert to "operational hours lost" (assuming 12h planned per day, so we scale the actual duration)
      return acc + (durationMs / (1000 * 60 * 60)) * 0.5;
    }, 0);

    const monthlyAvailability = totalPlannedHours > 0 
      ? Math.max(0, ((totalPlannedHours - totalDowntimeHours) / totalPlannedHours) * 100) 
      : 100;

    // Filter using filteredHistory which already has year, month, forklift and operator filter applied
    const monthlyCompleted = filteredHistory.filter(h => h.status === 'completed');
    const monthlyNewFailures = filteredHistory;

    // MTTR calculation
    const totalRepairTime = monthlyCompleted.reduce((acc, h) => {
      const repairStart = h.startTime ? parseDateSafe(h.startTime).getTime() : parseDateSafe(h.stopTime).getTime();
      const repairEnd = h.endTime ? parseDateSafe(h.endTime).getTime() : now.getTime();
      return acc + (repairEnd - repairStart);
    }, 0);
    const mttr = monthlyCompleted.length > 0 ? totalRepairTime / monthlyCompleted.length : 0;

    // MTBF & Confiabilidade (Estimado p/ o período)
    const totalOperatingHours = totalFleetUnits * 12 * totalPeriodDays;
    const failuresCount = monthlyNewFailures.filter(f => f.type === 'corrective').length;
    const mtbf = failuresCount > 0 ? totalOperatingHours / failuresCount : totalOperatingHours;
    
    // NOVO CÁLCULO DE CONFIABILIDADE (Hardened)
    const currentStoppedPenalty = filteredActiveStops.reduce((acc, s) => {
      const stopDate = parseDateSafe(s.stopTime);
      const diffDays = Math.floor((now.getTime() - stopDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 30) return acc + 40; // Grave
      if (diffDays > 15) return acc + 20;
      if (diffDays > 7) return acc + 10;
      return acc + 5;
    }, 0);

    const avgStoppedPenalty = filteredActiveStops.length > 0 ? currentStoppedPenalty / filteredActiveStops.length : 0;
    
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
  }, [maintenanceHistory, uniqueForklifts, activeStops, filterYear, filterMonth, filterForklift, filterOperator, filteredHistory, matchesForkliftFilter]);

  const topAffectedMachines = useMemo(() => {
    const map: Record<string, { count: number, downtime: number, name: string }> = {};
    filteredHistory.forEach(h => {
      const f = forklifts.find(fork => 
        fork.id === h.forkliftId || 
        (fork.serialNumber && h.forkliftId && fork.serialNumber.trim().toLowerCase() === h.forkliftId.trim().toLowerCase())
      );
      const serial = (f?.serialNumber || '').trim();
      const key = serial || h.forkliftId;
      const name = f ? `${f.model} (${f.serialNumber})` : h.forkliftId;
      
      if (!map[key]) map[key] = { count: 0, downtime: 0, name };
      map[key].count += 1;
      const hEnd = h.endTime ? parseDateSafe(h.endTime).getTime() : Date.now();
      map[key].downtime += (hEnd - parseDateSafe(h.stopTime).getTime());
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

  const mechanicAvailabilityMetrics = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const mechanicUsers = users.filter(u => u.role === 'mechanic');
    const totalMechs = mechanicUsers.length || 2;

    const year = filterYear === 'all' ? new Date().getFullYear() : parseInt(filterYear);
    const currentMonthNum = new Date().getMonth() + 1;
    const month = filterMonth === 'all' ? currentMonthNum : parseInt(filterMonth);
    
    const daysInMonth = new Date(year, month, 0).getDate();
    const totalCapacityDays = totalMechs * daysInMonth;

    const filterStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const filterEndStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    let totalAbsentDays = 0;
    const absentDates = new Set<string>();

    absences.forEach(a => {
      if (a.role === 'mechanic') {
        const overlapStart = a.startDate > filterStartStr ? a.startDate : filterStartStr;
        const overlapEnd = a.endDate < filterEndStr ? a.endDate : filterEndStr;

        if (overlapStart <= overlapEnd) {
          const startD = new Date(overlapStart + 'T00:00:00');
          const endD = new Date(overlapEnd + 'T00:00:00');
          const diffTime = Math.abs(endD.getTime() - startD.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          
          totalAbsentDays += diffDays;

          let currentCursor = new Date(overlapStart + 'T00:00:00');
          while (currentCursor <= endD) {
            const dateCursorStr = currentCursor.toISOString().split('T')[0];
            absentDates.add(dateCursorStr);
            currentCursor.setDate(currentCursor.getDate() + 1);
          }
        }
      }
    });

    totalAbsentDays = Math.min(totalCapacityDays, totalAbsentDays);
    const presentDays = Math.max(0, totalCapacityDays - totalAbsentDays);

    const availablePercentage = totalCapacityDays > 0 
      ? parseFloat(((presentDays / totalCapacityDays) * 100).toFixed(1)) 
      : 100;

    let absentDaysWithPendings = 0;
    
    absentDates.forEach(dateStr => {
      const hadMaintenanceStopOnDay = maintenanceHistory.some(stop => {
        const stopOpenDate = stop.stopTime.split('T')[0];
        const stopCloseDate = stop.endTime ? stop.endTime.split('T')[0] : '9999-12-31';
        return stopOpenDate <= dateStr && stopCloseDate >= dateStr;
      });

      if (hadMaintenanceStopOnDay) {
        absentDaysWithPendings++;
      }
    });

    return {
      availablePercentage,
      totalCapacityDays,
      totalAbsentDays,
      presentDays,
      daysInMonth,
      absentDaysWithPendings
    };
  }, [users, absences, maintenanceHistory, filterYear, filterMonth]);

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

  const handleAddAbsence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMechanicId) {
      alert("Selecione um mecânico.");
      return;
    }
    const mech = users.find(u => u.uid === selectedMechanicId);
    if (!mech) {
      alert("Mecânico não encontrado.");
      return;
    }
    setIsLoggingAbsence(true);
    try {
      const newAbsence: Omit<OperatorAbsence, 'id'> = {
        operatorId: selectedMechanicId,
        operatorName: mech.displayName || mech.email,
        startDate: absenceStartDate,
        endDate: absenceEndDate,
        reason: absenceReason,
        role: 'mechanic',
        sector: mech.sector || 'Geral',
        notes: absenceNotes || '',
        createdAt: new Date().toISOString()
      };
      
      await addDoc(collection(db, 'operator_absences'), newAbsence);
      alert("Apontamento de ausência registrado com sucesso!");
      
      // Reset form fields
      setAbsenceNotes('');
      // Trigger data refresh
      fetchData();
    } catch (err: any) {
      console.error("Error creating absence:", err);
      alert("Erro ao salvar apontamento: " + err.message);
    } finally {
      setIsLoggingAbsence(false);
    }
  };

  const handleDeleteAbsence = async (absenceId: string) => {
    if (!confirm("Tem certeza que deseja remover este apontamento de ausência?")) return;
    try {
      await deleteDoc(doc(db, 'operator_absences', absenceId));
      alert("Apontamento de ausência removido com sucesso!");
      fetchData();
    } catch (err: any) {
      console.error("Error deleting absence:", err);
      alert("Erro ao deletar: " + err.message);
    }
  };

  const mecanicoStatus = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const mechanicUsers = users.filter(u => u.role === 'mechanic');
    const mechanicAbsences = absences.filter(a => a.role === 'mechanic' && today >= a.startDate && today <= a.endDate);
    
    return mechanicUsers.map(m => {
      const absence = mechanicAbsences.find(a => a.operatorId === m.uid);
      const isAbsent = !!absence;
      
      let daysAbsent = 0;
      if (isAbsent) {
        const start = new Date(absence.startDate);
        daysAbsent = Math.floor((new Date().getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      }

      return {
        ...m,
        isAbsent,
        daysAbsent,
        absenceReason: absence?.reason,
        // Impact estimates
        backlogIncrease: isAbsent ? 20 : 0, // Placeholder logic
        preventivesAtRisk: isAbsent ? teamStats.maintenance.preventivesAtRisk : 0,
        machinesAwaiting: isAbsent ? teamStats.maintenance.awaitingMaintenance : 0
      };
    });
  }, [users, absences, teamStats.maintenance]);

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
        percentage: parseFloat(percentage.toFixed(0)),
        productivity: productiveHours > 0 ? parseFloat((data.production / productiveHours).toFixed(1)) : 0,
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
      percentage: totalDowntime > 0 ? parseFloat(((minutes / totalDowntime) * 100).toFixed(0)) : 0
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
        productivity: hours > 0 ? parseFloat((totalProd / hours).toFixed(1)) : 0,
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
       const forklift = forklifts.find(f => 
         f.id === fId || 
         (f.serialNumber && fId && f.serialNumber.trim().toLowerCase() === fId.trim().toLowerCase())
       );
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
    return totalHours > 0 ? parseFloat((totalProduction / totalHours).toFixed(1)) : 0;
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
    return total > 0 ? parseFloat(((totalStopTime / total) * 100).toFixed(0)) : 0;
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
      const forklift = forklifts.find(f => 
        f.id === fId || 
        (f.serialNumber && fId && f.serialNumber.trim().toLowerCase() === fId.trim().toLowerCase())
      );
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
        const productivity = data.totalWeight > 0 ? parseFloat((data.weightedProductivity / data.totalWeight).toFixed(1)) : 0;
        const avgTarget = data.totalWeight > 0 ? data.weightedTarget / data.totalWeight : 15;
        const checklistScore = data.checklistsCount > 0 ? parseFloat((data.checklist / data.checklistsCount).toFixed(0)) : 0;
        
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

  const avgResponseTime = useMemo(() => {
    const eventsWithStart = filteredHistory.filter(h => h.startTime);
    if (eventsWithStart.length === 0) return 0;
    const totalResponse = eventsWithStart.reduce((acc, h) => {
      const stop = parseDateSafe(h.stopTime).getTime();
      const start = parseDateSafe(h.startTime!).getTime();
      return acc + Math.max(0, start - stop);
    }, 0);
    return totalResponse / eventsWithStart.length;
  }, [filteredHistory]);

  const totalStops = filteredHistory.length;
  const completedRepairs = filteredHistory.filter(h => h.status === 'completed').length;
  const inProgressRepairs = filteredHistory.filter(h => h.status === 'in_progress' || h.status === 'awaiting_parts').length;

  // Awaiting Parts metrics
  const awaitingPartsStops = useMemo(() => {
    return activeStops.filter(s => s.status === 'awaiting_parts' && matchesForkliftFilter(s.forkliftId, filterForklift));
  }, [activeStops, filterForklift, matchesForkliftFilter]);

  // Preventive Maintenance stats (Vencidas, A Vencer, OK)
  const preventiveMaintenanceStats = useMemo(() => {
    let vencidas = 0;
    let aVencer = 0; // 'proxima'
    let ok = 0; // 'em_dia'
    let desatualizadas = 0; // 'desatualizado'
    
    const vencidasList: Forklift[] = [];
    const aVencerList: Forklift[] = [];
    const okList: Forklift[] = [];

    uniqueForklifts.forEach(f => {
      const status = getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0, f.lastHourMeterUpdate);
      if (status === 'vencida') {
        vencidas++;
        vencidasList.push(f);
      } else if (status === 'proxima') {
        aVencer++;
        aVencerList.push(f);
      } else if (status === 'desatualizado') {
        desatualizadas++;
      } else {
        ok++;
        okList.push(f);
      }
    });

    return { vencidas, aVencer, ok, desatualizadas, vencidasList, aVencerList, okList };
  }, [uniqueForklifts]);

  // Check-list Compliance stats for today
  const checklistComplianceToday = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const completedToday = checklists.filter(c => c.timestamp.startsWith(today) && (filterForklift === 'all' || c.forkliftId === filterForklift)).length;
    
    // Total operating forklifts (status available in uniqueForklifts)
    const operatingForklifts = uniqueForklifts.filter(f => f.status === 'available' && (filterForklift === 'all' || f.id === filterForklift));
    const totalOperating = operatingForklifts.length;
    const missingCount = machinesMissingChecklist.length;

    const compliancePercentage = totalOperating > 0 
      ? Math.min(100, Math.round((completedToday / totalOperating) * 100))
      : 100;

    return {
      completedToday,
      totalOperating,
      missingCount,
      compliancePercentage
    };
  }, [checklists, uniqueForklifts, machinesMissingChecklist, filterForklift]);

  return (
    <div id="simplified-manager-dashboard" className="max-w-7xl mx-auto p-4 md:p-6 space-y-8 animate-in fade-in duration-500">
      <header id="dashboard-header" className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-slate-100 pb-6">
        <div className="flex items-center gap-4">
          <button
            id="btn-refresh-dashboard"
            onClick={() => fetchData()}
            disabled={isRefreshing}
            className={cn(
              "p-3 rounded-2xl border border-slate-200 transition-all active:scale-95 group",
              isRefreshing ? "bg-slate-50 text-slate-300" : "bg-white text-slate-600 hover:bg-slate-50 hover:border-blue-200"
            )}
            title="Atualizar Dados"
          >
            <HistoryIcon id="icon-refresh-dashboard" className={cn("w-5 h-5 transition-transform duration-700", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
          </button>
          <div>
            <h1 id="dashboard-title" className="text-2xl md:text-3xl font-black text-slate-950 tracking-tight">Painel de Manutenção Simplificado</h1>
            <p id="dashboard-subtitle" className="text-slate-500 text-sm">
              Visão consolidada de indicadores técnicos e indisponibilidades
            </p>
          </div>
        </div>
      </header>

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
      {(() => {
        const REASONS_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6'];

        return (
          <div className="space-y-10 animate-in fade-in duration-500">
            {/* KPI Cards Grid */}
            <div id="dashboard-metrics-grid" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              
              {/* Card 1: Disponibilidade do Período */}
              <div id="metric-card-availability" className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                <div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                        <Activity className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Disponibilidade do Período</p>
                    </div>
                    <span className={cn(
                      "text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider",
                      kpis.monthlyAvailability >= 90 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                    )}>
                      {kpis.monthlyAvailability >= 90 ? "Disponível" : "Abaixo da Meta"}
                    </span>
                  </div>

                  <div className="h-[150px] w-full flex items-center justify-center relative mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Disponível', value: kpis.monthlyAvailability },
                            { name: 'Indisponível', value: Math.max(0, 100 - kpis.monthlyAvailability) }
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={65}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          <Cell key="cell-0" fill="#10b981" />
                          <Cell key="cell-1" fill="#ef4444" />
                        </Pie>
                        <Tooltip 
                          formatter={(value: any) => `${Number(value).toFixed(1)}%`}
                          contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                          itemStyle={{ color: '#fff' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-lg font-black text-slate-900">{kpis.monthlyAvailability.toFixed(1)}%</span>
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Acumulado</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold border-t border-slate-50 pt-2">
                  <span>Inst. (Tempo Real):</span>
                  <span className="text-slate-700 font-bold">{kpis.currentAvailability.toFixed(1)}%</span>
                </div>
              </div>

              {/* Card 2: Total de Paradas e Reparos */}
              <div id="metric-card-stops" className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600">
                    <Wrench className="w-5 h-5" />
                  </div>
                  <div className="flex gap-1.5">
                    <span className="text-[9px] font-black bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full uppercase tracking-wider">
                      {activeStops.length} Ativos
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Paradas & Reparos</p>
                  <p className="text-4xl font-extrabold text-slate-900 tracking-tight mt-1">{totalStops}</p>
                </div>
                <div className="flex gap-4 text-xs font-semibold text-slate-500">
                  <div>
                    <span className="font-extrabold text-slate-900">{completedRepairs}</span> Concluídos
                  </div>
                  <div>
                    <span className="font-extrabold text-slate-900">{inProgressRepairs}</span> Em Andamento
                  </div>
                </div>
              </div>

              {/* Card 3: Tempo Médio de Resposta */}
              <div id="metric-card-avg-response" className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-amber-50 rounded-2xl text-amber-600">
                    <Clock className="w-5 h-5" />
                  </div>
                  <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full uppercase tracking-wider">
                    Tempo Médio
                  </span>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tempo Médio de Resposta</p>
                  <p className="text-2xl font-extrabold text-slate-900 tracking-tight mt-1">
                    {avgResponseTime > 0 ? formatDuration(avgResponseTime) : "---"}
                  </p>
                </div>
                <p className="text-[11px] font-medium text-slate-400">
                  Intervalo entre chamada e início do reparo
                </p>
              </div>

              {/* Card 4: MTTR e MTBF */}
              <div id="metric-card-kpis-technical" className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-[#0f172a] rounded-2xl text-white">
                    <Timer className="w-5 h-5" />
                  </div>
                  <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full uppercase tracking-wider">
                    Métricas MTTR/MTBF
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">MTTR</p>
                    <p className="text-base font-extrabold text-slate-900 truncate mt-0.5">{formatDuration(kpis.mttr)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">MTBF</p>
                    <p className="text-base font-extrabold text-slate-900 mt-0.5">{kpis.mtbf.toFixed(0)}h</p>
                  </div>
                </div>
                <p className="text-[11px] font-medium text-slate-400">
                  MTTR: Tempo de reparo | MTBF: Confiabilidade
                </p>
              </div>
            </div>

            {/* Row 2: Sinalizadores Operacionais */}
            <div id="dashboard-secondary-metrics" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              
              {/* Card 5: Aguardando Peças */}
              <div id="metric-card-parts-waiting" className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-amber-50 rounded-2xl text-amber-600">
                    <Package className="w-5 h-5" />
                  </div>
                  <span className={cn(
                    "text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider",
                    awaitingPartsStops.length > 0 ? "bg-amber-100 text-amber-850 font-bold" : "bg-emerald-50 text-emerald-700"
                  )}>
                    {awaitingPartsStops.length > 0 ? `${awaitingPartsStops.length} Paradas` : "Tudo OK"}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Aguardando Peças</p>
                  <p className="text-4xl font-extrabold text-slate-900 tracking-tight mt-1">{awaitingPartsStops.length}</p>
                </div>
                <div id="awaiting-parts-list" className="space-y-1.5 max-h-[70px] overflow-y-auto pr-1">
                  {awaitingPartsStops.length === 0 ? (
                    <p className="text-[11px] text-slate-400 font-medium">Nenhuma empilhadeira parada por peças hoje.</p>
                  ) : (
                    awaitingPartsStops.map(s => {
                      const fork = uniqueForklifts.find(f => f.id === s.forkliftId);
                      const displayParts = s.pendingPartsList && s.pendingPartsList.length > 0
                        ? s.pendingPartsList.join(', ')
                        : s.description || 'Peças não especificadas';
                      return (
                        <div key={s.id} className="text-xs border-l-2 border-amber-400 pl-2">
                          <span className="font-extrabold text-slate-900">{fork ? `${fork.model} (${fork.serialNumber})` : s.forkliftId}:</span>{' '}
                          <span className="text-slate-500 font-semibold truncate inline-block max-w-[180px] align-bottom" title={displayParts}>
                            {displayParts}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Card 6: Manutenção Preventiva */}
              <div id="metric-card-preventive-status" className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-blue-50 rounded-2xl text-blue-600">
                    <Settings2 className="w-5 h-5" />
                  </div>
                  <span className={cn(
                    "text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider",
                    preventiveMaintenanceStats.vencidas > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                  )}>
                    {preventiveMaintenanceStats.vencidas > 0 ? `${preventiveMaintenanceStats.vencidas} Vencidas` : "Preventivas em Dia"}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Planilha de Preventivas</p>
                  <p className="text-4xl font-extrabold text-slate-900 tracking-tight mt-1">
                    {preventiveMaintenanceStats.vencidas} <span className="text-lg font-bold text-slate-400">Vencidas</span>
                  </p>
                </div>
                <div id="preventive-badge-summary" className="flex flex-wrap gap-2 text-[10px] font-bold">
                  <span className="bg-red-50 text-red-750 px-2 py-0.5 rounded-lg">
                    {preventiveMaintenanceStats.vencidas} Vencidas
                  </span>
                  <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-lg">
                    {preventiveMaintenanceStats.aVencer} À Vencer
                  </span>
                  <span className="bg-emerald-55/15 text-emerald-800 px-2 py-0.5 rounded-lg">
                    {preventiveMaintenanceStats.ok} OK / Em Dia
                  </span>
                </div>
              </div>

              {/* Card 7: Checklist & Compliance */}
              <div id="metric-card-checklist-status" className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600">
                    <ClipboardCheck className="w-5 h-5" />
                  </div>
                  <button
                    id="btn-alert-reminders"
                    onClick={handleSendReminders}
                    className="text-[9px] font-extrabold bg-blue-600 hover:bg-blue-700 active:scale-95 text-white px-2.5 py-1 rounded-full uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Lembrar SMS/WA
                  </button>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Check-lists de Hoje</p>
                  <p className="text-4xl font-extrabold text-slate-900 tracking-tight mt-1">
                    {checklistComplianceToday.completedToday} <span className="text-lg font-bold text-slate-400">/ {checklistComplianceToday.totalOperating}</span>
                  </p>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold border-t border-slate-50 pt-2">
                  <span>Conformidade Hoje:</span>
                  <span className="text-emerald-600 font-black text-xs">{checklistComplianceToday.compliancePercentage}%</span>
                </div>
              </div>

              {/* Card 8: Disponibilidade Física dos Mecânicos */}
              <div id="metric-card-mechanic-availability" className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                <div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                        <Wrench className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Capacidade da Equipe</p>
                    </div>
                    <span className={cn(
                      "text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider",
                      mechanicAvailabilityMetrics.availablePercentage >= 90 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    )}>
                      {mechanicAvailabilityMetrics.availablePercentage >= 90 ? "Ok" : "Falc. Escala"}
                    </span>
                  </div>

                  <div className="h-[150px] w-full flex items-center justify-center relative mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Disponível', value: mechanicAvailabilityMetrics.availablePercentage },
                            { name: 'Indisponível', value: parseFloat((100 - mechanicAvailabilityMetrics.availablePercentage).toFixed(1)) }
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={65}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          <Cell key="cell-0" fill="#3b82f6" />
                          <Cell key="cell-1" fill="#f59e0b" />
                        </Pie>
                        <Tooltip 
                          formatter={(value: any) => `${Number(value).toFixed(1)}%`}
                          contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                          itemStyle={{ color: '#fff' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-lg font-black text-slate-900">{mechanicAvailabilityMetrics.availablePercentage.toFixed(1)}%</span>
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider font-extrabold">Presença</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-50 pt-2 space-y-1">
                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold">
                    <span>Dias Ausentes:</span>
                    <span className="text-slate-700 font-bold">{mechanicAvailabilityMetrics.totalAbsentDays} dias ({mechanicAvailabilityMetrics.totalCapacityDays} total-man)</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold">
                    <span>Impacto Escala:</span>
                    <span className={cn(
                      "font-black text-[11px]",
                      mechanicAvailabilityMetrics.absentDaysWithPendings > 0 ? "text-amber-600" : "text-emerald-600"
                    )}>
                      {mechanicAvailabilityMetrics.absentDaysWithPendings} {mechanicAvailabilityMetrics.absentDaysWithPendings === 1 ? 'dia' : 'dias'} c/ máquina parada
                    </span>
                  </div>
                </div>
              </div>

            </div>

            {/* Main Analysis and Breakdown Sections */}
            <div id="dashboard-breakdown-sections" className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Section B: Principais Motivos de Parada */}
              <div id="section-reasons-distribution" className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200/80 shadow-sm space-y-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-red-50 text-red-600 rounded-2xl">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-950 tracking-tight">Principais Motivos de Parada</h3>
                    <p className="text-xs text-slate-500 font-medium">Distribuição das causas mais frequentes</p>
                  </div>
                </div>

                {maintenanceReasons.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 font-medium text-sm">
                    Nenhuma parada com motivo registrado neste período.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="h-[280px] w-full flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={maintenanceReasons}
                          margin={{ top: 20, right: 10, left: -25, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fill: '#64748b', fontSize: 9, fontWeight: 700 }}
                            interval={0}
                            angle={-15}
                            textAnchor="end"
                            height={50}
                          />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fill: '#64748b', fontSize: 9, fontWeight: 700 }}
                            allowDecimals={false}
                          />
                          <Tooltip 
                            cursor={{ fill: 'rgba(241, 245, 249, 0.4)' }}
                            contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                            itemStyle={{ color: '#fff' }}
                          />
                          <Bar 
                            dataKey="value" 
                            radius={[8, 8, 0, 0]} 
                            barSize={32}
                          >
                            {maintenanceReasons.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={REASONS_COLORS[index % REASONS_COLORS.length]} />
                            ))}
                            <LabelList 
                              dataKey="value" 
                              position="top" 
                              style={{ fill: '#475569', fontSize: 10, fontWeight: 800 }} 
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Legend with details */}
                    <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-50">
                      {maintenanceReasons.map((entry, index) => (
                        <div key={entry.name} className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full shrink-0" 
                            style={{ backgroundColor: REASONS_COLORS[index % REASONS_COLORS.length] }}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-extrabold text-slate-900 truncate">{entry.name}</p>
                            <p className="text-[10px] text-slate-500 font-bold">{entry.value} {entry.value === 1 ? 'ocorrência' : 'ocorrências'}</p>
                          </div>
                      </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Section B: Peças Utilizadas */}
              <div id="section-parts-breakdown" className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-200/80 shadow-sm space-y-6 flex flex-col justify-between">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-slate-950 tracking-tight">Consumo de Peças Substituídas</h3>
                      <p className="text-xs text-slate-500 font-medium">Classificação das peças mais requisitadas para manutenção</p>
                    </div>
                  </div>

                  {partsData.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 font-medium text-sm">
                      Nenhuma utilização de peças registrada para o período selecionado.
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
                      {partsData.map((part) => {
                        const maxQuantity = Math.max(...partsData.map(p => p.quantity));
                        const percentage = maxQuantity > 0 ? (part.quantity / maxQuantity) * 100 : 0;
                        return (
                          <div key={part.name} className="space-y-1 bg-slate-50/55 p-3 rounded-2xl border border-slate-100">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-extrabold text-slate-900 truncate max-w-[200px]">{part.name}</span>
                              <span className="font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md text-[10px]">{part.quantity} un</span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between text-[11px] font-bold text-slate-500">
                  <span>Total de Peças Diferentes</span>
                  <span className="text-slate-950 font-black">{partsData.length} itens</span>
                </div>
              </div>

            </div>

          </div>
        );
      })()}
    </div>
  );
}
