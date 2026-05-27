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
  if (typeof val === 'string') {
    // 1. Check for standard ISO YYYY-MM-DD format (no time) to avoid UTC day shift
    const yyyyMmDdOnly = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yyyyMmDdOnly) {
      const year = parseInt(yyyyMmDdOnly[1], 10);
      const month = parseInt(yyyyMmDdOnly[2], 10) - 1;
      const day = parseInt(yyyyMmDdOnly[3], 10);
      return new Date(year, month, day, 12, 0, 0); // Local noon
    }

    // 2. Check for DD/MM/YYYY format with optional time (standard Brazilian format)
    const ddMmYyyyMatch = val.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (ddMmYyyyMatch) {
      const day = parseInt(ddMmYyyyMatch[1], 10);
      const month = parseInt(ddMmYyyyMatch[2], 10) - 1;
      const year = parseInt(ddMmYyyyMatch[3], 10);
      const hours = ddMmYyyyMatch[4] ? parseInt(ddMmYyyyMatch[4], 10) : 12;
      const minutes = ddMmYyyyMatch[5] ? parseInt(ddMmYyyyMatch[5], 10) : 0;
      const seconds = ddMmYyyyMatch[6] ? parseInt(ddMmYyyyMatch[6], 10) : 0;
      return new Date(year, month, day, hours, minutes, seconds);
    }
  }
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    return d;
  }
  return new Date();
};

const getLocalDateString = (d: Date = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const [absenceStartDate, setAbsenceStartDate] = useState<string>(getLocalDateString());
  const [absenceEndDate, setAbsenceEndDate] = useState<string>(getLocalDateString());
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
      // Backlog & Severity
      const severity = stop.severity || 'high';
      if (severity === 'high') backlog.critical++;
      else if (severity === 'medium') backlog.high++;
      else backlog.medium++;

      if (stop.status === 'awaiting_parts') backlog.status.awaiting_parts++;
      else if (stop.status === 'in_progress') backlog.status.in_progress++;
      else backlog.status.pending++;

      // Indisponibilidade calculations
      const sev = stop.severity || (stop.type === 'preventive' ? 'low' : 'high');
      const isParada = sev === 'high' || sev === 'critical';
      
      let startMs: number | null = null;
      if (isParada) {
        startMs = parseDateSafe(stop.stopTime).getTime();
      } else if (stop.startTime) {
        startMs = parseDateSafe(stop.startTime).getTime();
      }

      // If not Parada and not started yet, it doesn't represent indisponibilidade, lost hours or aging
      if (startMs === null) {
        return;
      }

      const diffDays = Math.floor((now.getTime() - startMs) / (1000 * 60 * 60 * 24));
      
      // Aging
      if (diffDays <= 3) aging.upTo3++;
      else if (diffDays <= 7) aging.fourTo7++;
      else if (diffDays <= 15) aging.eightTo15++;
      else aging.over15++;

      if (diffDays > 30) aging.over30++;

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

    const stoppedUnits = filteredActiveStops.filter(s => {
      const sev = s.severity || (s.type === 'preventive' ? 'low' : 'high');
      const isParada = sev === 'high' || sev === 'critical';
      return isParada || !!s.startTime;
    }).length;
    
    // Fleet instant availability
    const currentAvailability = ((totalFleetUnits - stoppedUnits) / totalFleetUnits) * 100;

    // Monthly View KPIs
    const start = parseDateSafe(startDate);
    const end = parseDateSafe(endDate);
    const now = new Date();
    const effectiveEndForPeriod = Math.min(end.getTime(), now.getTime());
    const totalPeriodDays = Math.max(1, (effectiveEndForPeriod - start.getTime()) / (1000 * 60 * 60 * 24));
    
    // Calculate total planned hours and downtime hours capped per machine
    let totalPlannedHours = 0;
    let totalDowntimeHours = 0;
    let totalForkliftMtbfHours = 0;

    targetUniqueForklifts.forEach(f => {
      const plannedHoursForMachine = 24 * totalPeriodDays;
      totalPlannedHours += plannedHoursForMachine;

      // Find all stops for this specific machine in the period
      const machineStops = maintenanceHistory.filter(h => {
        const matchesForklift = matchesForkliftFilter(h.forkliftId, f.id);
        const matchesOperator = filterOperator === 'all' || h.operatorId === filterOperator || (h.operatorIds && h.operatorIds.includes(filterOperator));
        if (!matchesForklift || !matchesOperator) return false;

        const sev = h.severity || (h.type === 'preventive' ? 'low' : 'high');
        const isParada = sev === 'high' || sev === 'critical';
        
        let startMs: number;
        if (isParada) {
          startMs = parseDateSafe(h.stopTime).getTime();
        } else {
          if (!h.startTime) return false;
          startMs = parseDateSafe(h.startTime).getTime();
        }

        const hEnd = h.endTime ? parseDateSafe(h.endTime).getTime() : now.getTime();

        return startMs < effectiveEndForPeriod && hEnd > start.getTime();
      });

      // Sum downtime of these stops
      let machineDowntimeMs = 0;
      machineStops.forEach(h => {
        const sev = h.severity || (h.type === 'preventive' ? 'low' : 'high');
        const isParada = sev === 'high' || sev === 'critical';
        const startMs = isParada ? parseDateSafe(h.stopTime).getTime() : parseDateSafe(h.startTime!).getTime();
        const hEnd = h.endTime ? parseDateSafe(h.endTime).getTime() : now.getTime();
        
        const effectiveStart = Math.max(start.getTime(), startMs);
        const effectiveEnd = Math.min(effectiveEndForPeriod, hEnd);
        machineDowntimeMs += Math.max(0, effectiveEnd - effectiveStart);
      });

      const machineDowntimeHours = machineDowntimeMs / (1000 * 60 * 60);
      const cappedDowntimeHours = Math.min(plannedHoursForMachine, machineDowntimeHours);
      totalDowntimeHours += cappedDowntimeHours;

      // Calculate MTBF for this individual forklift (in hours)
      const forkliftOperatingHours = Math.max(0, plannedHoursForMachine - cappedDowntimeHours);
      const forkliftFailuresCount = machineStops.length;
      // If no failures, MTBF is the progression time of the period
      const forkliftMtbf = forkliftFailuresCount > 0 ? forkliftOperatingHours / forkliftFailuresCount : forkliftOperatingHours;
      totalForkliftMtbfHours += forkliftMtbf;
    });

    const totalOperatingHours = Math.max(0, totalPlannedHours - totalDowntimeHours);

    // Calculate MTTR only for the chosen month's started/completed maintenance records
    // This matches standard MTTR calculation of the spreadsheet and avoids prior-month overlaps
    const failuresCount = filteredHistory.length;

    let totalRepairTimeMs = 0;
    filteredHistory.forEach(h => {
      const sev = h.severity || (h.type === 'preventive' ? 'low' : 'high');
      const isParada = sev === 'high' || sev === 'critical';
      let repairStart: number;
      if (isParada) {
        repairStart = parseDateSafe(h.stopTime).getTime();
      } else {
        if (!h.startTime) return;
        repairStart = parseDateSafe(h.startTime).getTime();
      }

      const repairEnd = h.endTime ? parseDateSafe(h.endTime).getTime() : now.getTime();
      totalRepairTimeMs += Math.max(0, repairEnd - repairStart);
    });

    const mttr = failuresCount > 0 ? totalRepairTimeMs / failuresCount : 0;

    // MTBF is the average of individual forklift MTBFs in hours
    const mtbf = targetUniqueForklifts.length > 0 ? totalForkliftMtbfHours / targetUniqueForklifts.length : 0;

    // Physical availability = (planned hours - downtime) / planned hours * 100
    const monthlyAvailability = totalPlannedHours > 0 
      ? Math.max(0, Math.min(100, ((totalPlannedHours - totalDowntimeHours) / totalPlannedHours) * 100)) 
      : 100;
    
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
      monthlyNewFailures: filteredHistory.length,
      monthlyCompleted: filteredHistory.filter(h => h.status === 'completed').length,
      correctiveCount: filteredHistory.filter(h => h.type === 'corrective').length,
      preventiveCount: filteredHistory.filter(h => h.type === 'preventive').length
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
      
      const sev = h.severity || (h.type === 'preventive' ? 'low' : 'high');
      const isParada = sev === 'high' || sev === 'critical';
      
      let startMs: number | null = null;
      if (isParada) {
        startMs = parseDateSafe(h.stopTime).getTime();
      } else if (h.startTime) {
        startMs = parseDateSafe(h.startTime).getTime();
      }

      if (startMs !== null) {
        if (!map[key]) map[key] = { count: 0, downtime: 0, name };
        map[key].count += 1;
        const hEnd = h.endTime ? parseDateSafe(h.endTime).getTime() : Date.now();
        map[key].downtime += Math.max(0, hEnd - startMs);
      }
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
    const today = getLocalDateString();
    const machinesWithChecklist = new Set(
      checklists
        .filter(c => getLocalDateString(parseDateSafe(c.timestamp)) === today)
        .map(c => c.forkliftId)
    );
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
    const today = getLocalDateString();
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
    const today = getLocalDateString();
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
        const stopOpenDate = parseDateSafe(stop.stopTime).toISOString().split('T')[0];
        const stopCloseDate = stop.endTime ? parseDateSafe(stop.endTime).toISOString().split('T')[0] : '9999-12-31';
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
    const today = getLocalDateString();
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
    const today = getLocalDateString();
    return forklifts
      .filter(f => filterForklift === 'all' || f.id === filterForklift)
      .map(f => {
        const name = `${f.model} (${f.serialNumber})`;
        const count = filteredChecklists.filter(cl => cl.forkliftId === f.id).length;
        const isDoneToday = filteredChecklists.some(cl => 
          cl.forkliftId === f.id && getLocalDateString(parseDateSafe(cl.timestamp)) === today
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

  // Breakdown of stops by severity/type (Parada, Reparo, Falha Iminente) for Card 2
  const stopsSeverityStats = useMemo(() => {
    let paradas = 0;
    let falhasIminentes = 0;
    let reparos = 0;

    filteredHistory.forEach(h => {
      // severity types -> low: Reparo, medium: Falha Iminente, high: Parada, critical: Parada Critica
      const sev = h.severity || (h.type === 'preventive' ? 'low' : 'high');
      if (sev === 'high' || sev === 'critical') {
        paradas++;
      } else if (sev === 'medium') {
        falhasIminentes++;
      } else {
        reparos++;
      }
    });

    return { paradas, falhasIminentes, reparos };
  }, [filteredHistory]);

  // Active stops stats breakdown for Card 5 (Relação de Paradas Atuais)
  const activeStopsStats = useMemo(() => {
    const stops = activeStops.filter(s => {
      // Filter severity: High/Critical means 'Parada' (não queremos reparo 'low' ou falha iminente 'medium')
      const sev = s.severity || (s.type === 'preventive' ? 'low' : 'high');
      const isParada = sev === 'high' || sev === 'critical';

      return isParada;
    });

    const awaitingParts = stops.filter(s => s.status === 'awaiting_parts');
    const inProgress = stops.filter(s => s.status === 'in_progress');
    const onStandby = stops.filter(s => s.status !== 'awaiting_parts' && s.status !== 'in_progress');

    // Get list of unique fleets / models of active stops
    const affectedFleets = Array.from(new Set(stops.map(s => {
      const f = uniqueForklifts.find(fork => fork.id === s.forkliftId);
      return f ? `${f.model}` : s.forkliftId;
    })));

    const falhasIminentesCount = activeStops.filter(s => {
      const sev = s.severity || (s.type === 'preventive' ? 'low' : 'high');
      return sev === 'medium';
    }).length;

    const reparosCount = activeStops.filter(s => {
      const sev = s.severity || (s.type === 'preventive' ? 'low' : 'high');
      return sev === 'low';
    }).length;

    return {
      stops,
      awaitingParts,
      inProgress,
      onStandby,
      affectedFleets,
      falhasIminentesCount,
      reparosCount
    };
  }, [activeStops, uniqueForklifts]);

  const awaitingPartsStops = activeStopsStats.awaitingParts;

  // Preventive Maintenance stats (Vencidas, A Vencer, OK)
  const preventiveMaintenanceStats = useMemo(() => {
    let vencidas = 0;
    let aVencer = 0; // 'proxima'
    let ok = 0; // 'em_dia'
    let desatualizadas = 0; // 'desatualizado'
    
    const vencidasList: Forklift[] = [];
    const aVencerList: Forklift[] = [];
    const okList: Forklift[] = [];
    
    const targetedForklifts = filterForklift === 'all' 
      ? uniqueForklifts 
      : uniqueForklifts.filter(f => f.id === filterForklift);

    if (filterMonth === 'all') {
      targetedForklifts.forEach(f => {
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
    } else {
      // Monthly views: compute metrics from filtered range maintenance stops of type 'preventive'
      const completedPreventives = filteredHistory.filter(h => h.type === 'preventive' && h.status === 'completed');
      const pendingPreventives = filteredHistory.filter(h => h.type === 'preventive' && h.status !== 'completed');

      ok = completedPreventives.length;
      vencidas = pendingPreventives.filter(h => h.status === 'pending' || h.status === 'interdicted').length;
      aVencer = pendingPreventives.filter(h => h.status === 'in_progress' || h.status === 'awaiting_parts').length;
      desatualizadas = 0;
    }

    return { vencidas, aVencer, ok, desatualizadas, vencidasList, aVencerList, okList };
  }, [uniqueForklifts, filterMonth, filteredHistory, filterForklift]);

  // Check-list Compliance stats for today (unaffected by filters)
  const checklistComplianceToday = useMemo(() => {
    const today = getLocalDateString();
    const completedTodayForkliftIds = new Set(
      checklists
        .filter(c => getLocalDateString(parseDateSafe(c.timestamp)) === today)
        .map(c => c.forkliftId)
    );
    const completedTodayCount = completedTodayForkliftIds.size;
    const totalRegistered = uniqueForklifts.length;
    const compliancePercentage = totalRegistered > 0
      ? Math.min(100, Math.round((completedTodayCount / totalRegistered) * 100))
      : 100;

    const pendingForklifts = uniqueForklifts.filter(f => !completedTodayForkliftIds.has(f.id));

    return {
      completedToday: completedTodayCount,
      totalOperating: totalRegistered,
      compliancePercentage,
      pendingForklifts,
      isMonthly: false
    };
  }, [checklists, uniqueForklifts]);

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
          <div className="space-y-10 animate-in fade-in duration-500 font-sans">
            {/* Seção 1: Indicadores do Período Selecionado */}
            <div id="section-period-indicators" className="space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-full" />
                <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                  Métricas & Indicadores do Período Selecionado (Afetados por Filtros)
                </h3>
              </div>

              <div id="dashboard-period-metrics-grid" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

                    <div className="h-[230px] w-full flex items-center justify-center relative mt-4">
                      {/* Central Percentage Badge */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-2xl font-black text-slate-800 tracking-tight leading-none">
                          {Number(kpis.monthlyAvailability).toFixed(1)}%
                        </span>
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1.5">
                          Disp.
                        </span>
                      </div>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Disponível', value: kpis.monthlyAvailability },
                              { name: 'Indisponível', value: Math.max(0, 100 - kpis.monthlyAvailability) }
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
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
                    </div>

                    {/* Custom HTML responsive legend */}
                    <div className="flex justify-center gap-6 mt-2 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Disponível</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Indisponível</span>
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
                      <span className="text-[9px] font-black bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full uppercase tracking-wider">
                        {totalStops} Total no Período
                      </span>
                    </div>
                  </div>
                  
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Histórico de Manutenções</p>
                    
                    {/* Categorized Breakdown */}
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                          <span className="text-slate-650 font-semibold">Paradas (Crítica/Geral)</span>
                        </div>
                        <span className="font-extrabold text-slate-900 bg-red-50 text-red-600 px-2 py-0.5 rounded-md min-w-[28px] text-center">{stopsSeverityStats.paradas}</span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                          <span className="text-slate-650 font-semibold">Falhas Iminentes</span>
                        </div>
                        <span className="font-extrabold text-slate-900 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-md min-w-[28px] text-center">{stopsSeverityStats.falhasIminentes}</span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                          <span className="text-slate-650 font-semibold">Reparos / Preventivas</span>
                        </div>
                        <span className="font-extrabold text-slate-900 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md min-w-[28px] text-center">{stopsSeverityStats.reparos}</span>
                      </div>
                    </div>

                    {/* Visual Proportion Bar */}
                    {totalStops > 0 && (
                      <div className="w-full h-1.5 bg-slate-100 rounded-full flex overflow-hidden mt-3">
                        <div className="bg-red-500 h-full transition-all" style={{ width: `${(stopsSeverityStats.paradas / totalStops) * 100}%` }} title={`Paradas: ${stopsSeverityStats.paradas}`} />
                        <div className="bg-amber-500 h-full transition-all" style={{ width: `${(stopsSeverityStats.falhasIminentes / totalStops) * 100}%` }} title={`Falhas Iminentes: ${stopsSeverityStats.falhasIminentes}`} />
                        <div className="bg-emerald-500 h-full transition-all" style={{ width: `${(stopsSeverityStats.reparos / totalStops) * 100}%` }} title={`Reparos/Preventivas: ${stopsSeverityStats.reparos}`} />
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold border-t border-slate-50 pt-2">
                    <span>Concluídas: <strong className="text-slate-700">{completedRepairs}</strong></span>
                    <span>Andamento: <strong className="text-slate-700">{inProgressRepairs + activeStops.length}</strong></span>
                  </div>
                </div>

                {/* Card 3: Tempo Médio de Resposta */}
                <div id="metric-card-avg-response" className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="p-3 bg-amber-50 rounded-2xl text-amber-600">
                      <Clock className="w-5 h-5" />
                    </div>
                    <span className={cn(
                      "text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider",
                      avgResponseTime <= 30 * 60000 ? "bg-emerald-50 text-emerald-700" : (avgResponseTime <= 60 * 60000 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700")
                    )}>
                      {avgResponseTime > 0 
                        ? (avgResponseTime <= 30 * 60000 ? "Excelente" : (avgResponseTime <= 60 * 60000 ? "Apropriado" : "Acima da Meta"))
                        : "Sem Registros"
                      }
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tempo Médio de Resposta (TMR)</p>
                    <p className="text-3xl font-black text-slate-900 tracking-tight mt-1">
                      {avgResponseTime > 0 ? formatDuration(avgResponseTime) : "---"}
                    </p>
                  </div>
                  
                  {/* Visual Target Bar for TMR */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                      <span>Meta: &lt; 30 min</span>
                      <span>TMR Atual</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden relative">
                      {avgResponseTime > 0 ? (
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            avgResponseTime <= 30 * 60000 ? "bg-emerald-500" : (avgResponseTime <= 60 * 60000 ? "bg-amber-500" : "bg-red-500")
                          )}
                          style={{ width: `${Math.min(100, (avgResponseTime / (60 * 60 * 1000)) * 100)}%` }}
                        />
                      ) : (
                        <div className="w-0 h-full bg-slate-200" />
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold border-t border-slate-50 pt-2 shrink-0">
                    <span>Atendimento:</span>
                    <span className="text-slate-600 font-extrabold">Chamada ⇒ Início Reparo</span>
                  </div>
                </div>

                {/* Card 4: MTTR e MTBF */}
                <div id="metric-card-kpis-technical" className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="p-3 bg-slate-900 rounded-2xl text-white">
                      <Timer className="w-5 h-5 animate-pulse" />
                    </div>
                    <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full uppercase tracking-wider">
                      Indicadores de Confiabilidade
                    </span>
                  </div>

                  {/* Styled Columns for MTTR and MTBF */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50/80 hover:bg-slate-50 border border-slate-100 rounded-2xl p-3 flex flex-col justify-between transition-colors font-sans w-full">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">MTTR</p>
                        <p className="text-lg font-black text-slate-900 truncate mt-1">
                          {kpis.mttr > 0 ? formatDuration(kpis.mttr) : "---"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md w-fit uppercase">
                        <span>↓ Rápido</span>
                      </div>
                    </div>

                    <div className="bg-slate-50/80 hover:bg-slate-50 border border-slate-100 rounded-2xl p-3 flex flex-col justify-between transition-colors font-sans w-full font-sans">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">MTBF</p>
                        <p className="text-lg font-black text-slate-900 truncate mt-1">
                          {kpis.mtbf > 0 ? `${(kpis.mtbf / 24).toFixed(1)} dias` : "---"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md w-fit uppercase">
                        <span>↑ Confiável</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold border-t border-slate-50 pt-2 shrink-0">
                    <span className="truncate">MTTR: Tempo Médio de Reparo</span>
                    <span className="text-slate-500 font-extrabold truncate">MTBF: Entre Falhas</span>
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
                      {filterMonth === 'all' 
                        ? (preventiveMaintenanceStats.vencidas > 0 ? `${preventiveMaintenanceStats.vencidas} Vencidas` : "Preventivas em Dia")
                        : (preventiveMaintenanceStats.vencidas > 0 ? `${preventiveMaintenanceStats.vencidas} Pendentes` : "Preventivas em Dia")
                      }
                    </span>
                  </div>
                  
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      {filterMonth === 'all' ? "Planilha de Preventivas (Frota)" : "Preventivas do Período"}
                    </p>
                    
                    {/* Categorized Breakdown */}
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                          <span className="text-slate-650 font-semibold animate-pulse">
                            {filterMonth === 'all' ? "Em Dia" : "Realizadas (OK)"}
                          </span>
                        </div>
                        <span className="font-extrabold text-slate-900 bg-emerald-55/15 text-emerald-800 px-2 py-0.5 rounded-md min-w-[28px] text-center">
                          {preventiveMaintenanceStats.ok}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                          <span className="text-slate-650 font-semibold animate-pulse">
                            {filterMonth === 'all' ? "À Vencer" : "Em Execução"}
                          </span>
                        </div>
                        <span className="font-extrabold text-slate-950 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md min-w-[28px] text-center">
                          {preventiveMaintenanceStats.aVencer}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                          <span className="text-slate-650 font-semibold animate-pulse">
                            {filterMonth === 'all' ? "Vencidas" : "Atrasadas / Pendentes"}
                          </span>
                        </div>
                        <span className="font-extrabold text-red-700 bg-red-50 px-2 py-0.5 rounded-md min-w-[28px] text-center">
                          {preventiveMaintenanceStats.vencidas}
                        </span>
                      </div>
                    </div>

                    {/* Visual Proportion Bar */}
                    {(() => {
                      const total = preventiveMaintenanceStats.ok + preventiveMaintenanceStats.aVencer + preventiveMaintenanceStats.vencidas;
                      if (total > 0) {
                        const okPct = (preventiveMaintenanceStats.ok / total) * 100;
                        const aVencerPct = (preventiveMaintenanceStats.aVencer / total) * 100;
                        const vencidasPct = (preventiveMaintenanceStats.vencidas / total) * 100;
                        return (
                          <div className="w-full h-1.5 bg-slate-100 rounded-full flex overflow-hidden mt-3">
                            <div className="bg-emerald-500 h-full transition-all" style={{ width: `${okPct}%` }} title={`OK/Realizadas: ${preventiveMaintenanceStats.ok}`} />
                            <div className="bg-amber-500 h-full transition-all" style={{ width: `${aVencerPct}%` }} title={`Planejadas/Execução: ${preventiveMaintenanceStats.aVencer}`} />
                            <div className="bg-red-500 h-full transition-all" style={{ width: `${vencidasPct}%` }} title={`Vencidas/Pendentes: ${preventiveMaintenanceStats.vencidas}`} />
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold border-t border-slate-50 pt-2">
                    <span>Visualização:</span>
                    <span className="text-blue-605 uppercase tracking-widest font-black text-[9px]">
                      {filterMonth === 'all' ? "Snapshot Frota" : "Acumulado Mês"}
                    </span>
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
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Disponibilidade do Mecânico</p>
                      </div>
                      <span className={cn(
                        "text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider",
                        mechanicAvailabilityMetrics.availablePercentage >= 90 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      )}>
                        {mechanicAvailabilityMetrics.availablePercentage >= 90 ? "Ok" : "Falc. Escala"}
                      </span>
                    </div>

                    <div className="h-[230px] w-full flex items-center justify-center relative mt-4">
                      {/* Central Percentage Badge */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-2xl font-black text-slate-800 tracking-tight leading-none">
                          {Number(mechanicAvailabilityMetrics.availablePercentage).toFixed(1)}%
                        </span>
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1.5">
                          Mecânicos
                        </span>
                      </div>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Disponível', value: mechanicAvailabilityMetrics.availablePercentage },
                              { name: 'Indisponível', value: parseFloat((100 - mechanicAvailabilityMetrics.availablePercentage).toFixed(1)) }
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
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
                    </div>

                    {/* Custom HTML responsive legend */}
                    <div className="flex justify-center gap-6 mt-2 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Disponível</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Indisponível</span>
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

              {/* Seção de Análise e Detalhamento de Filtros - Gráficos de Motivos e Peças */}
              <div id="dashboard-filtered-charts" className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-6">
                
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
                    <div className="py-12 text-center text-slate-400 font-medium text-sm font-sans">
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
                              cursor={{ fill: 'rgba(241, 145, 149, 0.1)' }}
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
                      <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-50 font-sans">
                        {maintenanceReasons.map((entry, index) => (
                          <div key={entry.name} className="flex items-center gap-2 font-sans">
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
                      <div className="py-12 text-center text-slate-400 font-medium text-sm font-sans">
                        Nenhuma utilização de peças registrada para o período selecionado.
                      </div>
                    ) : (
                      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
                        {partsData.map((part) => {
                          const maxQuantity = Math.max(...partsData.map(p => p.quantity));
                          const percentage = maxQuantity > 0 ? (part.quantity / maxQuantity) * 100 : 0;
                          return (
                            <div key={part.name} className="space-y-1 bg-slate-50/55 p-3 rounded-2xl border border-slate-105 font-sans">
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

                  <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between text-[11px] font-bold text-slate-500 font-sans">
                    <span>Total de Peças Diferentes</span>
                    <span className="text-slate-950 font-black">{partsData.length} itens</span>
                  </div>
                </div>

              </div>
            </div>

            {/* Seção 2: Sinalizadores de Hoje & Tempo Real */}
            <div id="section-realtime-indicators" className="space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-1.5 h-4 bg-indigo-500 rounded-full" />
                <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider">
                  Status de Hoje & Tempo Real (Não Afetados por Filtros)
                </h3>
              </div>

              <div id="dashboard-realtime-metrics-grid" className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {/* Card 5: Status das Paradas Ativas */}
                <div id="metric-card-parts-waiting" className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
                      <Layers className="w-5 h-5" />
                    </div>
                    <span className={cn(
                      "text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider",
                      activeStopsStats.stops.length > 0 ? "bg-red-50 text-red-700 font-bold border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    )}>
                      {activeStopsStats.stops.length > 0 ? `${activeStopsStats.stops.length} Ativas` : "Sem Paradas"}
                    </span>
                  </div>
                  
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Status das Paradas Ativas</p>
                    
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-4xl font-extrabold text-red-600 tracking-tight">
                        {activeStopsStats.stops.length}
                      </span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">
                        Paradas Ativas Atualmente
                      </span>
                    </div>
                  </div>

                  {/* Summary of Execution States for Stopped Machines */}
                  <div className="flex flex-wrap gap-2 text-[9px] font-bold text-slate-500 my-1 font-sans">
                    <span className="bg-rose-50 text-rose-700 px-2 py-1 rounded-lg border border-rose-105 flex items-center gap-1">
                      Aguardando Início: <strong className="text-rose-850 font-black">{activeStopsStats.onStandby.length}</strong>
                    </span>
                    <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-lg border border-blue-105 flex items-center gap-1">
                      Iniciadas: <strong className="text-blue-800 font-black">{activeStopsStats.inProgress.length}</strong>
                    </span>
                    <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-lg border border-amber-205 flex items-center gap-1">
                      Aguardando Peças: <strong className="text-amber-800 font-black">{activeStopsStats.awaitingParts.length}</strong>
                    </span>
                  </div>

                  {/* List of Stopped Machines & Execution Status */}
                  <div id="active-paradas-status-list" className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1 border border-slate-100 p-2 rounded-xl bg-slate-50/30">
                    {activeStopsStats.stops.length === 0 ? (
                      <p className="text-[11px] text-slate-400 font-medium pt-2 text-center">Nenhuma empilhadeira parada ativamente.</p>
                    ) : (
                      activeStopsStats.stops.map(s => {
                        const fork = uniqueForklifts.find(f => f.id === s.forkliftId) || forklifts.find(f => f.id === s.forkliftId);
                        
                        let badgeColor = "bg-rose-50 text-rose-700 border-rose-200";
                        let statusLabel = "Não Iniciada (Aguardando Início)";
                        if (s.status === 'awaiting_parts') {
                          badgeColor = "bg-amber-50 text-amber-700 border-amber-200";
                          statusLabel = "Aguardando Peças (Iniciado)";
                        } else if (s.status === 'in_progress') {
                          badgeColor = "bg-blue-50 text-blue-700 border-blue-100";
                          statusLabel = "Iniciada";
                        }

                        return (
                          <div key={s.id} className="text-[11px] flex flex-col gap-1 border-b border-slate-100 pb-1.5 last:border-0 hover:bg-slate-50/85 p-1 rounded-lg transition-colors text-left font-sans">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-extrabold text-slate-900 flex-1 pr-1 leading-snug break-words font-sans" title={fork ? `Frota: ${fork.serialNumber || 'Sem número'} | ${fork.model} (${fork.id})` : s.forkliftId}>
                                {fork ? (
                                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                                    <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-black tracking-tight border border-blue-105" title={`ID: ${fork.id}`}>
                                      Nº {fork.serialNumber || fork.id}
                                    </span>
                                    <span className="text-slate-705 font-bold">{fork.model}</span>
                                  </span>
                                ) : (
                                  <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[10px] font-black">Nº {s.forkliftId}</span>
                                )}
                              </span>
                            </div>
                            <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0 w-fit", badgeColor)}>
                              {statusLabel}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold border-t border-slate-100 pt-2 shrink-0">
                    <span className="truncate">Frotas Afetadas:</span>
                    <span className="text-slate-705 font-extrabold truncate max-w-[150px] inline-block" title={activeStopsStats.affectedFleets.join(', ')}>
                      {activeStopsStats.affectedFleets.length > 0 ? activeStopsStats.affectedFleets.join(', ') : 'Nenhuma'}
                    </span>
                  </div>

                  {/* Title and stats for Outras Manutenções */}
                  <div className="border-t border-slate-100 pt-3 mt-1.5">
                    <p className="text-xs font-black text-slate-700 uppercase tracking-wider mb-2 text-left">Outras Manutenções</p>
                    <div className="grid grid-cols-2 gap-2 font-sans">
                      <div className="bg-amber-50/45 p-2.5 rounded-xl border border-amber-100/30 text-left">
                        <p className="text-[8px] font-black text-amber-800 uppercase tracking-wider">Falha Iminente</p>
                        <p className="text-base font-extrabold text-amber-950 mt-1">{activeStopsStats.falhasIminentesCount} hoje</p>
                      </div>
                      <div className="bg-blue-50/30 p-2.5 rounded-xl border border-blue-100/35 text-left">
                        <p className="text-[8px] font-black text-blue-800 uppercase tracking-wider">Reparos</p>
                        <p className="text-base font-extrabold text-blue-950 mt-1">{activeStopsStats.reparosCount} hoje</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 7: Checklist & Compliance */}
                <div id="metric-card-checklist-status" className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
                  <div className="flex justify-between items-center">
                    <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                      <ClipboardCheck className="w-5 h-5" />
                    </div>
                    <button
                      id="btn-alert-reminders"
                      onClick={handleSendReminders}
                      className="text-[9px] font-extrabold bg-blue-600 hover:bg-blue-700 active:scale-95 text-white px-3 py-1.5 rounded-full uppercase tracking-wider transition-all cursor-pointer"
                    >
                      Lembrar SMS/WA
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Check-lists de Hoje
                      </p>
                      <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-4xl font-extrabold text-slate-900 tracking-tight">
                          {checklistComplianceToday.completedToday}
                        </span>
                        <span className="text-sm font-bold text-slate-400">
                          realizados hoje
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                        <span>Progresso de Conformidade</span>
                        <span>{checklistComplianceToday.completedToday} / {checklistComplianceToday.totalOperating} Máquinas</span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${checklistComplianceToday.compliancePercentage}%` }}
                        />
                      </div>
                    </div>

                    {/* Detailed Indicators */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col justify-between">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">FROTA TOTAL</span>
                        <span className="text-base font-black text-slate-800">
                          {checklistComplianceToday.totalOperating} máquinas
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col justify-between">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">PENDENTES HOJE</span>
                        <span className={cn(
                          "text-base font-black",
                          (checklistComplianceToday.totalOperating - checklistComplianceToday.completedToday) > 0 ? "text-amber-600" : "text-emerald-600"
                        )}>
                          {Math.max(0, checklistComplianceToday.totalOperating - checklistComplianceToday.completedToday)} pendentes
                        </span>
                      </div>
                    </div>

                    {/* Lista de Máquinas Pendentes */}
                    {checklistComplianceToday.pendingForklifts.length > 0 ? (
                      <div className="space-y-1.5 pt-1 border-t border-slate-100/60">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                          Máquinas Faltando:
                        </span>
                        <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto pr-1">
                          {checklistComplianceToday.pendingForklifts.map(f => {
                            const val = (f.serialNumber || f.id).trim();
                            const display = val.length > 2 ? val.slice(-2) : val;
                            return (
                              <span 
                                key={f.id} 
                                className="inline-flex items-center bg-amber-50 text-amber-700 hover:bg-amber-100 text-[10px] font-black px-2 py-0.5 rounded-lg border border-amber-200 transition-colors select-none cursor-help"
                                title={`Frota: ${f.serialNumber || 'Sem número'} | ${f.model} (ID: ${f.id})`}
                              >
                                {display}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-2 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-100 text-[9px] font-semibold uppercase tracking-wider">
                        ✨ Toda frota preencheu hoje!
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold border-t border-slate-100 pt-2 shrink-0">
                    <span>Taxa de Conformidade:</span>
                    <span className="text-emerald-600 font-black text-xs">{checklistComplianceToday.compliancePercentage}%</span>
                  </div>
                </div>
              </div>
            </div>



            {/* Debug panel specifically designed to transparently audit database records live inside the container preview */}
            <div className="mt-8 mx-auto max-w-7xl px-4 py-6 bg-slate-900 border border-slate-800 rounded-3xl text-slate-100 select-text overflow-hidden font-mono text-xs">
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer font-black text-slate-200 uppercase tracking-widest select-none p-2 hover:bg-slate-800 rounded-xl transition-colors">
                  <span>🛠️ PAINEL DE AUDITORIA DE DADOS BI (FIREBASE)</span>
                  <span className="text-[10px] bg-slate-800 px-2 py-1 rounded-lg group-open:hidden">Expandir (Ver Ocorrências & Máquinas)</span>
                  <span className="text-[10px] bg-slate-800 px-2 py-1 rounded-lg hidden group-open:inline">Recolher</span>
                </summary>
                
                <div className="mt-6 space-y-8 pt-4 border-t border-slate-800 max-h-[600px] overflow-y-auto pr-2">
                  <div>
                    <h4 className="text-sm font-black text-blue-400 mb-3 border-b border-bold border-blue-900 pb-1">1. TODOS OS REGISTROS DE MANUTENÇÃO (ÚLTIMOS {maintenanceHistory.length})</h4>
                    <p className="text-[10px] text-slate-400 mb-4 font-sans">Listagem crua da coleção `maintenance` contendo paradas concluídas, pendentes e em andamento.</p>
                    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-900 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                            <th className="p-3">#</th>
                            <th className="p-3">ID Documento</th>
                            <th className="p-3">ID Máquina (Cadastrada)</th>
                            <th className="p-3">Item Resolvido</th>
                            <th className="p-3">Tipo</th>
                            <th className="p-3">Severidade</th>
                            <th className="p-3">Histórico de Datas</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Descrição / Observações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-[11px]">
                          {maintenanceHistory.map((h, i) => {
                            const forkliftObj = forklifts.find(f => f.id === h.forkliftId || (f.serialNumber && h.forkliftId && f.serialNumber.trim().toLowerCase() === h.forkliftId.trim().toLowerCase()));
                            return (
                              <tr key={h.id} className="hover:bg-slate-900/50">
                                <td className="p-3 text-slate-500 font-bold">{i+1}</td>
                                <td className="p-3 text-emerald-400 font-bold">{h.id}</td>
                                <td className="p-3 text-amber-400 font-bold">{h.forkliftId || 'N/A'}</td>
                                <td className="p-3 text-slate-300">
                                  {forkliftObj ? `${forkliftObj.model} (${forkliftObj.serialNumber})` : '⚠️ NÃO ENCONTRADA (Órfã/Dummy)'}
                                </td>
                                <td className="p-3 text-slate-300 capitalize">{h.type || 'N/A'}</td>
                                <td className="p-3">
                                  <span className={`px-1.5 py-0.5 rounded-md font-bold uppercase text-[9px] ${
                                    h.severity === 'high' || h.severity === 'critical' || (!h.severity && h.type !== 'preventive') 
                                      ? 'bg-red-950 text-red-400 border border-red-900' 
                                      : h.severity === 'medium' ? 'bg-amber-950 text-amber-400 border border-amber-900' 
                                      : 'bg-emerald-950 text-emerald-400 border border-emerald-900'
                                  }`}>
                                    {h.severity || (h.type === 'preventive' ? 'low' : 'high')}
                                  </span>
                                </td>
                                <td className="p-3 space-y-1 font-mono text-[10px]">
                                  <div>⏱️ Parada: <span className="text-indigo-400">{h.stopTime || 'Não definida'}</span></div>
                                  <div>🔧 Início: <span className="text-amber-400">{h.startTime || 'Não iniciada'}</span></div>
                                  <div>🏁 Fim: <span className="text-emerald-400">{h.endTime || 'Em andamento'}</span></div>
                                </td>
                                <td className="p-3">
                                  <span className={`px-1.5 py-0.5 rounded font-black text-[9px] uppercase ${
                                    h.status === 'completed' 
                                      ? 'bg-emerald-900 text-emerald-200' 
                                      : h.status === 'in_progress' ? 'bg-indigo-900 text-indigo-150' 
                                      : h.status === 'awaiting_parts' ? 'bg-amber-900 text-amber-200'
                                      : 'bg-yellow-900 text-yellow-105'
                                  }`}>
                                    {h.status || 'pending'}
                                  </span>
                                </td>
                                <td className="p-3 max-w-xs truncate text-slate-300" title={h.description}>
                                  {h.description || '-'}
                                  {h.repairNotes && <p className="text-[10px] text-slate-500 mt-1 italic">Obs: {h.repairNotes}</p>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-black text-rose-400 mb-3 border-b border-bold border-rose-900 pb-1">2. TABELA CANÔNICA DE MÁQUINAS DA FROTA (FROTA TOTAL: {uniqueForklifts.length} MÁQUINAS FILTRADAS)</h4>
                    <p className="text-[10px] text-slate-400 mb-4 font-sans">Lista definitiva exposta a todos os cálculos de BI, excluindo registros de teste/lixo por serial.</p>
                    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-900 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                            <th className="p-3">#</th>
                            <th className="p-3">ID Documento</th>
                            <th className="p-3">Modelo</th>
                            <th className="p-3">Nº de Série</th>
                            <th className="p-3">Status Atual</th>
                            <th className="p-3">Operador Designado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-[11px]">
                          {uniqueForklifts.map((f, i) => (
                            <tr key={f.id} className="hover:bg-slate-900/50">
                              <td className="p-3 text-slate-500 font-bold">{i+1}</td>
                              <td className="p-3 text-emerald-400">{f.id}</td>
                              <td className="p-3 text-slate-200 font-bold capitalize">{f.model}</td>
                              <td className="p-3 text-amber-400 font-bold">{f.serialNumber || 'N/A'}</td>
                              <td className="p-3 text-slate-300 capitalize">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  f.status === 'stopped' ? 'bg-red-950 text-red-400 border border-red-900' :
                                  f.status === 'maintenance' ? 'bg-indigo-950 text-indigo-400 border border-indigo-900' :
                                  'bg-emerald-950 text-emerald-400 border border-emerald-900'
                                }`}>
                                  {f.status}
                                </span>
                              </td>
                              <td className="p-3 text-slate-400">{f.assignedOperatorName || f.assignedOperatorId || 'Sem designação'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </details>
            </div>

          </div>
        );
      })()}
    </div>
  );
}
