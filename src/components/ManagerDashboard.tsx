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
import { TrendingUp, Clock, Activity, AlertTriangle, Users, Package, Calendar, Filter, Bell, ClipboardCheck, Watch, Layers, BoxSelect, Truck, CloudRain, Info, ArrowLeft, Target, Settings2, Plus, Save, X, Trash2, History as HistoryIcon, Wrench, ShieldAlert, BarChart3, ChevronRight, UserMinus, UserCheck, Timer, Footprints, ShieldCheck, Zap, CheckCircle2, AlertCircle, LayoutDashboard } from 'lucide-react';
import { cn, formatDuration, formatDate, formatTime, formatDateTime, formatCurrency, formatNumber } from '../lib/utils';
import { calculateOperatorEfficiency } from '../lib/operationalLogic';
import { sendWhatsAppNotification, sendLocalNotification } from '../lib/notifications';

import { SafraImpactDashboard } from './SafraImpactDashboard';

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
  const [activeView, setActiveView] = useState<'mecanica' | 'disponibilidade' | 'producao' | 'operacao' | 'executiva' | 'safra'>('mecanica');
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

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => fetchData()}
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
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 leading-tight">Central Operacional</h1>
            <p className="text-slate-500 text-sm md:text-base">
              {activeView === 'mecanica' ? '1. Gestão de Manutenção' : 
               activeView === 'disponibilidade' ? '2. Saúde da Frota' :
               activeView === 'producao' ? '3. Performance de Produção' : 
               activeView === 'operacao' ? '4. Equipe e Capacidade' : 'Análise de Impacto de Safra'}
            </p>
          </div>
        </div>
        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
            <button 
              onClick={() => setActiveView('mecanica')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeView === 'mecanica' 
                  ? "bg-white text-indigo-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Wrench className="w-4 h-4" />
              1. Mecânica
            </button>
            <button 
              onClick={() => setActiveView('disponibilidade')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeView === 'disponibilidade' 
                  ? "bg-white text-emerald-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Activity className="w-4 h-4" />
              2. Disponibilidade
            </button>
            <button 
              onClick={() => setActiveView('producao')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeView === 'producao' 
                  ? "bg-white text-blue-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Target className="w-4 h-4" />
              3. Produção
            </button>
            <button 
              onClick={() => setActiveView('operacao')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeView === 'operacao' 
                  ? "bg-white text-orange-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Users className="w-4 h-4" />
              4. Operação
            </button>
            <div className="w-px h-4 bg-slate-300 mx-2" />
            <button 
              onClick={() => setActiveView('safra')}
              className={cn(
                "px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeView === 'safra' 
                  ? "bg-white text-red-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <AlertTriangle className="w-4 h-4" />
              Impacto Safra
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
      {activeView === 'mecanica' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-xl space-y-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-indigo-50 rounded-2xl text-indigo-600">
                    <Users className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight">Equipa Técnica e Disponibilidade</h3>
                    <p className="text-sm font-medium text-slate-500">Gestão de mecânicos e impacto de ausências</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAbsenceModal(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
                >
                  <Plus className="w-4 h-4" /> Registrar Ausência
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="p-8 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-between group">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Capacidade Atual</p>
                      <p className="text-4xl font-black text-slate-900">{teamStats.maintenance.capacity.toFixed(0)}%</p>
                    </div>
                    <div className="w-16 h-16 rounded-full border-4 border-emerald-100 border-t-emerald-500 animate-spin-slow" />
                 </div>
                 <div className="p-8 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Mecânicos Ativos</p>
                      <p className="text-4xl font-black text-slate-900">{teamStats.maintenance.availableMechanics}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                         <div key={i} className={cn("w-2 h-8 rounded-full", i < teamStats.maintenance.availableMechanics ? "bg-emerald-500" : "bg-slate-200")} />
                      ))}
                    </div>
                 </div>
              </div>

              <div className="space-y-4">
                {mecanicoStatus.map((m) => (
                  <div key={m.uid} className={cn(
                    "p-6 rounded-3xl border transition-all",
                    m.isAbsent ? "bg-red-50 border-red-200" : "bg-white border-slate-100"
                  )}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl border-2",
                          m.isAbsent ? "bg-red-100 border-red-200 text-red-600" : "bg-emerald-50 border-emerald-100 text-emerald-600"
                        )}>
                          {m.displayName?.charAt(0)}
                        </div>
                        <div>
                          <p className="text-base font-black text-slate-900">{m.displayName}</p>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{m.isAbsent ? 'Ausente' : 'Disponível'}</p>
                        </div>
                      </div>
                      {m.isAbsent && (
                        <div className="text-right">
                           <p className="text-[9px] font-black text-red-600 uppercase mb-0.5">{m.daysAbsent} Dias Ausente</p>
                           <span className="px-3 py-1 bg-red-100 text-red-700 text-[10px] font-black rounded-lg uppercase">{m.absenceReason}</span>
                        </div>
                      )}
                    </div>
                    {m.isAbsent && (
                      <div className="mt-6 grid grid-cols-2 gap-4">
                        <div className="bg-white/60 p-4 rounded-2xl border border-red-100">
                           <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Impacto Backlog</p>
                           <p className="text-xl font-black text-slate-900">+{m.backlogIncrease}%</p>
                        </div>
                        <div className="bg-white/60 p-4 rounded-2xl border border-red-100">
                           <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Preventivas Atrasadas</p>
                           <p className="text-xl font-black text-red-600">{m.preventivesAtRisk}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 p-10 rounded-[3.5rem] text-white space-y-8 flex flex-col justify-between relative overflow-hidden">
               <div className="relative z-10">
                  <h3 className="text-xl font-black uppercase tracking-tighter mb-2">Impacto Operacional</h3>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Risco e Atraso de Preparação</p>
               </div>
               
               <div className="space-y-6 relative z-10">
                  <div className="p-6 bg-white/5 rounded-3xl border border-white/10">
                     <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Risco Operacional Futuro</p>
                     <div className="flex items-center justify-between">
                        <span className={cn(
                           "text-2xl font-black uppercase",
                           teamStats.maintenance.riskLevel === 'CRITICAL' ? "text-red-400" : "text-emerald-400"
                        )}>{teamStats.maintenance.riskLevel}</span>
                        <ShieldAlert className={cn(
                           "w-6 h-6",
                           teamStats.maintenance.riskLevel === 'CRITICAL' ? "text-red-400" : "text-emerald-400"
                        )} />
                     </div>
                  </div>

                  <div className="p-6 bg-white/5 rounded-3xl border border-white/10">
                     <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Atraso na Preparação (Est.)</p>
                     <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-black text-blue-400">~{teamStats.maintenance.estimatedDelayDays}</span>
                        <span className="text-sm font-black text-slate-400 uppercase">Dias</span>
                     </div>
                  </div>

                  <div className="p-6 bg-white/5 rounded-3xl border border-white/10">
                     <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Preventivas Críticas</p>
                     <div className="flex items-center justify-between">
                        <span className="text-2xl font-black text-amber-400">{teamStats.maintenance.preventivesAtRisk}</span>
                        <AlertTriangle className="w-6 h-6 text-amber-400" />
                     </div>
                  </div>
               </div>

               <div className="pt-6 border-t border-white/10 relative z-10">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 text-center">Gargalo de Manutenção</p>
                  <div className="h-4 bg-white/5 rounded-full overflow-hidden flex">
                     <div className="h-full bg-red-600" style={{ width: `${(currentStatusStats.aging.over15 / (currentStatusStats.totalStopped || 1)) * 100}%` }} />
                     <div className="h-full bg-amber-600" style={{ width: `${(currentStatusStats.aging.eightTo15 / (currentStatusStats.totalStopped || 1)) * 100}%` }} />
                     <div className="h-full bg-blue-600 flex-1" />
                  </div>
               </div>
               <Activity className="absolute -bottom-20 -right-20 w-64 h-64 text-white/5 rotate-12" />
            </div>
          </div>

          <div className="bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-xl overflow-hidden">
             <div className="flex items-center justify-between mb-8">
               <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Máquinas Paradas</h3>
               <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{currentStatusStats.totalStopped} equipamentos em manutenção</span>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full">
                 <thead>
                   <tr className="border-b border-slate-100">
                     <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Máquina</th>
                     <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                     <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Tempo Parado</th>
                     <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Motivo</th>
                     <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Ação</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50">
                   {activeStops.map(stop => {
                     const forklift = forklifts.find(f => f.id === stop.forkliftId);
                     const days = Math.floor((new Date().getTime() - new Date(stop.stopTime).getTime()) / (1000 * 60 * 60 * 24));
                     return (
                       <tr key={stop.id} className="hover:bg-slate-50 transition-colors">
                         <td className="px-4 py-4 font-black text-[12px] text-slate-900">{forklift?.model || '---'}</td>
                         <td className="px-4 py-4">
                           <span className={cn(
                             "px-3 py-1 rounded-full text-[9px] font-black uppercase",
                             stop.status === 'awaiting_parts' ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
                           )}>{stop.status.replace('_', ' ')}</span>
                         </td>
                         <td className="px-4 py-4 font-black text-[12px] text-slate-900">{days} Dias</td>
                         <td className="px-4 py-4 text-[11px] font-bold text-slate-500 max-w-xs truncate">{stop.description}</td>
                         <td className="px-4 py-4 text-right">
                           <button className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
                             <ChevronRight className="w-5 h-5" />
                           </button>
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

      {activeView === 'disponibilidade' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
             <div className="lg:col-span-1 bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-xl space-y-8 flex flex-col justify-between overflow-hidden relative">
                <div>
                   <p className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2">Saúde da Frota</p>
                   <h3 className="text-6xl font-black text-slate-950 tracking-tighter">{kpis.currentAvailability.toFixed(0)}%</h3>
                   <div className="mt-4 flex items-center gap-2">
                      <div className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-black uppercase",
                        kpis.currentAvailability > 90 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                      )}>
                        {kpis.currentAvailability > 90 ? 'Ideal' : 'Crítico'}
                      </div>
                   </div>
                </div>
                <div className="space-y-2">
                   <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <span>Eficiência</span>
                      <span>{kpis.currentAvailability.toFixed(0)}%</span>
                   </div>
                   <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${kpis.currentAvailability}%` }} />
                   </div>
                </div>
                <Activity className="absolute -bottom-10 -right-10 w-48 h-48 text-slate-50 opacity-50" />
             </div>

             <div className="lg:col-span-3 bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-xl space-y-8">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-3">
                      <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
                         <ShieldAlert className="w-6 h-6" />
                      </div>
                      <div>
                         <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Blacklist Operacional</h3>
                         <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Equipamentos com maior indisponibilidade</p>
                      </div>
                   </div>
                   <div className="flex gap-2">
                      <span className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg">Top 5 Reincidentes</span>
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                   {topAffectedMachines.map((m, idx) => (
                      <div key={idx} className="p-6 bg-slate-50 rounded-3xl border border-slate-100 text-center space-y-3 group hover:bg-white hover:border-red-200 transition-all cursor-help" title={`Downtime Total: ${formatDuration(m.downtime)}`}>
                         <div className="w-12 h-12 bg-white rounded-2xl border border-slate-200 mx-auto flex items-center justify-center font-black text-red-600 shadow-sm group-hover:scale-110 transition-transform">
                            #{idx + 1}
                         </div>
                         <p className="text-[12px] font-black text-slate-900 truncate">{m.name}</p>
                         <p className="text-[10px] font-black text-red-600 bg-red-50 rounded-lg py-1 px-2 uppercase tracking-tight">{m.count} Ocorrências</p>
                      </div>
                   ))}
                   {topAffectedMachines.length === 0 && (
                      <div className="col-span-full py-12 text-center">
                         <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                         <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Nenhum equipamento reincidente crítico</p>
                      </div>
                   )}
                </div>
             </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
             <div className="lg:col-span-2 bg-white p-12 rounded-[4rem] border border-slate-200 shadow-xl space-y-12">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-4">
                      <div className="p-4 bg-emerald-50 rounded-2xl text-emerald-600 shadow-lg shadow-emerald-50">
                         <TrendingUp className="w-8 h-8" />
                      </div>
                      <div>
                         <h3 className="text-3xl font-black text-slate-950 tracking-tighter uppercase">Saúde da Frota (Trend)</h3>
                         <p className="text-sm font-medium text-slate-500">Histórico de disponibilidade semanal</p>
                      </div>
                   </div>
                </div>
                <div className="h-[350px]">
                   <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={capacityTrend}>
                         <defs>
                           <linearGradient id="colorAvail" x1="0" y1="0" x2="0" y2="1">
                             <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                             <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                           </linearGradient>
                         </defs>
                         <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                         <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 900, fill: '#64748b' }} />
                         <YAxis domain={[80, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 800, fill: '#94a3b8' }} />
                         <Tooltip contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }} />
                         <Area type="monotone" dataKey="cap" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorAvail)" name="Disponibilidade %" />
                      </AreaChart>
                   </ResponsiveContainer>
                </div>
             </div>

             <div className="bg-slate-900 p-12 rounded-[4rem] text-white space-y-10 relative overflow-hidden">
                <div className="relative z-10">
                   <h3 className="text-xl font-black uppercase tracking-tighter mb-2">KPIs de Manutenção</h3>
                   <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Métricas de performance técnica</p>
                </div>
                
                <div className="space-y-8 relative z-10">
                   <div className="flex items-center justify-between group">
                      <div>
                         <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">MTTR (Reparo Médio)</p>
                         <p className="text-3xl font-black text-white">{formatDuration(kpis.mttr)}</p>
                      </div>
                      <div className="p-3 bg-white/5 rounded-2xl group-hover:bg-blue-500/20 transition-all">
                         <Timer className="w-6 h-6 text-blue-400" />
                      </div>
                   </div>
                   <div className="flex items-center justify-between group">
                      <div>
                         <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">MTBF (Confiabilidade)</p>
                         <p className="text-3xl font-black text-white">{kpis.mtbf.toFixed(0)}h</p>
                      </div>
                      <div className="p-3 bg-white/5 rounded-2xl group-hover:bg-indigo-500/20 transition-all">
                         <Zap className="w-6 h-6 text-indigo-400" />
                      </div>
                   </div>
                   <div className="flex items-center justify-between group">
                      <div>
                         <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Custo Perdido Impacto</p>
                         <p className="text-3xl font-black text-amber-400">{formatCurrency(currentStatusStats.totalLostHours * 150)}</p>
                      </div>
                      <div className="p-3 bg-white/5 rounded-2xl group-hover:bg-amber-500/20 transition-all">
                         <Package className="w-6 h-6 text-amber-400" />
                      </div>
                   </div>
                </div>
                
                <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-white/5 rounded-full blur-[80px]" />
             </div>
          </div>
        </div>
      )}

      {activeView === 'producao' && (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <KPIItem 
              label="Produção Total" 
              value={totalProduction.toString()}
              subValue="Fardos Totalizados"
              icon={<Package className="w-6 h-6" />}
              color="blue"
              trend="Safra 2024"
              trendType="neutral"
            />
            <KPIItem 
              label="Eficiência Média" 
              value={`${avgProductivity}/h`}
              subValue="Produtividade por Equipe"
              icon={<TrendingUp className="w-6 h-6" />}
              color="emerald"
              trend="+12% Meta"
              trendType="up"
            />
            <KPIItem 
              label="Tempo de Espera" 
              value={`${totalStoppedPercent}%`}
              subValue="Impacto na Produção"
              icon={<Clock className="w-6 h-6" />}
              color="amber"
              trend="Baixa Ociosidade"
              trendType="up"
            />
            <KPIItem 
              label="Taxa de Quebra" 
              value="1.2%"
              subValue="Perda de Fardos"
              icon={<AlertCircle className="w-6 h-6" />}
              color="red"
              trend="-0.5% vs Mes Ant."
              trendType="up"
            />
          </div>

          <div className="bg-white p-12 rounded-[3.5rem] border border-slate-200 shadow-xl space-y-10">
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                   <div className="p-4 bg-indigo-50 rounded-2xl text-indigo-600">
                      <Target className="w-8 h-8" />
                   </div>
                   <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Produção por Atividade</h3>
                      <p className="text-sm font-medium text-slate-500">Acompanhamento de metas operacionais por pilar</p>
                   </div>
                </div>
             </div>
             
             <div className="h-[400px] w-full">
               <ResponsiveContainer width="100%" height="100%">
                 <ComposedChart data={operationStats} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                   <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#64748b' }} />
                   <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold', fill: '#64748b' }} />
                   <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '25px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }} />
                   <Bar dataKey="production" name="Realizado" fill="#6366f1" radius={[8, 8, 0, 0]} barSize={40} />
                   <Line type="monotone" dataKey="goal" stroke="#94a3b8" strokeDasharray="8 8" dot={false} strokeWidth={3} name="Objetivo" />
                 </ComposedChart>
               </ResponsiveContainer>
             </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             <div className="bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-xl space-y-8">
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                   <TrendingUp className="w-6 h-6 text-emerald-500" />
                   Evolução Diária (Últimos 7 dias)
                </h3>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyProductionData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#64748b' }} />
                      <Tooltip />
                      <Bar dataKey="tirar_producao" name="Produção" fill="#10b981" radius={[4, 4, 0, 0]} barSize={12} />
                      <Bar dataKey="quebra" name="Quebra" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={12} />
                      <Bar dataKey="emblocamento" name="Emblocamento" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={12} />
                      <Bar dataKey="carregamento" name="Carregamento" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
             </div>

             <div className="bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-xl space-y-8">
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                   <AlertTriangle className="w-6 h-6 text-red-500" />
                   Ganhos vs Perdas (Bottlenecks)
                </h3>
                <div className="space-y-6">
                   {operationStats.map((op, idx) => (
                      <div key={idx} className="space-y-2">
                         <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-widest">
                            <span className="text-slate-500">{op.name}</span>
                            <span className={cn(
                              op.productivity > op.goal / 8 ? "text-emerald-600" : "text-red-600"
                            )}>
                              {op.productivity}/h {op.productivity > op.goal / 8 ? '↑ OK' : '↓ GARGALO'}
                            </span>
                         </div>
                         <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div className={cn(
                              "h-full transition-all duration-1000",
                              op.productivity > op.goal / 8 ? "bg-emerald-500" : "bg-red-500"
                            )} style={{ width: `${Math.min(100, (op.productivity / (op.goal / 8 || 1)) * 100)}%` }} />
                         </div>
                      </div>
                   ))}
                </div>
             </div>
          </div>
        </div>
      )}

      {activeView === 'operacao' && (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <KPIItem 
              label="Eficiência Humana" 
              value={`${teamStats.operation.operationalCapacity.toFixed(0)}%`}
              subValue="Capacidade Efetiva"
              icon={<Users className="w-6 h-6" />}
              color="emerald"
              trend={teamStats.operation.riskLevel === 'CRITICAL' ? 'Risco' : 'Estável'}
              trendType={teamStats.operation.riskLevel === 'CRITICAL' ? 'down' : 'up'}
            />
            <KPIItem 
              label="Absenteísmo" 
              value={teamStats.operation.absentOperators.toString()}
              subValue="Colaboradores Ausentes"
              icon={<UserMinus className="w-6 h-6" />}
              color="red"
              trend={`+${teamStats.operation.absentOperators * 8}h Perda`}
              trendType="down"
            />
             <KPIItem 
              label="Status de Risco" 
              value={teamStats.operation.riskLevel}
              subValue="Impacto na Operação"
              icon={<ShieldAlert className="w-6 h-6" />}
              color={teamStats.operation.riskLevel === 'CRITICAL' ? 'red' : 'indigo'}
              trend={teamStats.operation.machineOperatorImbalance ? 'Imbalance' : 'Equilibrado'}
              trendType="neutral"
            />
            <KPIItem 
              label="Backlog Operacional" 
              value={`${teamStats.operation.absentOperators * 12}h`}
              subValue="Horas em Atraso"
              icon={<Layers className="w-6 h-6" />}
              color="amber"
              trend="Estimado"
              trendType="neutral"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
             <div className="bg-white p-12 rounded-[3.5rem] border border-slate-200 shadow-xl space-y-10">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-4">
                      <div className="p-4 bg-slate-900 text-white rounded-3xl">
                         <Users className="w-8 h-8" />
                      </div>
                      <div>
                         <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Equipe de Operação</h3>
                         <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Status de disponibilidade em tempo real</p>
                      </div>
                   </div>
                </div>

                <div className="space-y-4">
                   {users.filter(u => u.role === 'operator' || u.role === 'production').map(user => {
                     const absence = teamStats.operation.activeAbsences.find(a => a.operatorId === user.uid);
                     return (
                       <div key={user.uid} className="flex items-center justify-between p-6 bg-slate-50 rounded-[2rem] border border-slate-100 hover:bg-white hover:border-blue-200 transition-all group">
                         <div className="flex items-center gap-5">
                            <div className={cn(
                              "w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-black border-2 transition-transform group-hover:scale-110",
                              absence ? "bg-red-50 border-red-100 text-red-600" : "bg-emerald-50 border-emerald-100 text-emerald-600"
                            )}>
                              {user.displayName?.charAt(0)}
                            </div>
                            <div>
                               <p className="text-base font-black text-slate-900">{user.displayName}</p>
                               <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{user.sector || 'INDETERMINADO'}</p>
                            </div>
                         </div>
                         <div className="text-right">
                            <span className={cn(
                              "text-[10px] font-black px-4 py-2 rounded-xl uppercase tracking-widest",
                              absence ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                            )}>
                              {absence ? absence.reason : 'Disponível'}
                            </span>
                            {absence && <p className="text-[9px] font-black text-slate-400 mt-2 uppercase tracking-tight">Retorno: {new Date(absence.endDate).toLocaleDateString()}</p>}
                         </div>
                       </div>
                     );
                   })}
                </div>
             </div>

             <div className="space-y-8">
                <div className="bg-slate-900 p-12 rounded-[4rem] text-white space-y-10 relative overflow-hidden">
                   <div className="relative z-10 space-y-10">
                      <div className="flex items-center gap-4">
                         <div className="p-4 bg-white/10 rounded-2xl">
                           <LayoutDashboard className="w-8 h-8 text-blue-400" />
                         </div>
                         <h3 className="text-2xl font-black uppercase tracking-tighter">Impacto na Capacidade</h3>
                      </div>
                      
                      <div className="h-[250px]">
                         <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={capacityTrend}>
                               <defs>
                                 <linearGradient id="colorCap" x1="0" y1="0" x2="0" y2="1">
                                   <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                   <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                 </linearGradient>
                               </defs>
                               <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff10" />
                               <XAxis dataKey="date" hide />
                               <YAxis domain={[0, 100]} hide />
                               <Tooltip />
                               <Area type="monotone" dataKey="cap" stroke="#3b82f6" strokeWidth={5} fillOpacity={1} fill="url(#colorCap)" />
                            </AreaChart>
                         </ResponsiveContainer>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/10 backdrop-blur-md">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Velocidade Operacional</p>
                            <p className="text-4xl font-black text-white">{teamStats.operation.operationalCapacity.toFixed(0)}%</p>
                            <p className="mt-2 text-[9px] font-bold text-slate-500 uppercase italic">Baseado em operários ativos</p>
                         </div>
                         <div className="p-8 bg-blue-600 rounded-[2.5rem] shadow-2xl shadow-blue-900/50">
                            <p className="text-[10px] font-black text-white/60 uppercase tracking-widest mb-2">Atraso Gerencial</p>
                            <p className="text-4xl font-black text-white">~{teamStats.operation.absentOperators > 0 ? (teamStats.operation.absentOperators * 1.5).toFixed(1) : '0'} Dias</p>
                            <p className="mt-2 text-[9px] font-bold text-white/40 uppercase">Previsão de normalização</p>
                         </div>
                      </div>
                   </div>
                   <Activity className="absolute -bottom-10 -right-10 w-96 h-96 text-white/5 rotate-12" />
                </div>

                <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-xl">
                   <div className="flex items-center gap-4 mb-8">
                      <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                         <ShieldAlert className="w-6 h-6" />
                      </div>
                      <div>
                         <h4 className="text-lg font-black text-slate-900 uppercase">Alertas de Equipe</h4>
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Riscos de sub-dimensionamento</p>
                      </div>
                   </div>
                   <div className="space-y-4">
                      {teamStats.operation.machineOperatorImbalance && (
                        <div className="p-6 bg-red-50 border border-red-100 rounded-3xl flex items-center gap-4">
                           <AlertCircle className="w-8 h-8 text-red-500" />
                           <div>
                              <p className="text-sm font-black text-red-900 uppercase">Gargalo Humano Detectado</p>
                              <p className="text-xs font-bold text-red-700">Existem mais máquinas ativas do que operadores disponíveis para operação simultânea.</p>
                           </div>
                        </div>
                      )}
                      {!teamStats.operation.machineOperatorImbalance && (
                        <div className="p-6 bg-emerald-50 border border-emerald-100 rounded-3xl flex items-center gap-4">
                           <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                           <div>
                              <p className="text-sm font-black text-emerald-900 uppercase">Dimensionamento OK</p>
                              <p className="text-xs font-bold text-emerald-700">A equipe está devidamente dimensionada para a frota atual em campo.</p>
                           </div>
                        </div>
                      )}
                   </div>
                </div>
             </div>
          </div>
        </div>
      )}

      {activeView === 'executiva' && (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
          {/* Executive Overview - Cross-Pillar Dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="bg-white p-10 rounded-[3rem] border-2 border-indigo-100 shadow-2xl relative overflow-hidden group hover:border-indigo-500 transition-all">
                <div className="p-4 bg-indigo-50 rounded-2xl w-fit mb-6">
                    <Wrench className="w-8 h-8 text-indigo-600" />
                </div>
                <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2">Mecânica</h4>
                <div className="flex items-baseline gap-2">
                    <p className="text-5xl font-black text-slate-900">{kpis.reliabilityScore.toFixed(0)}</p>
                    <span className="text-slate-400 font-bold">/100</span>
                </div>
                <p className="mt-4 text-[10px] font-black text-indigo-600 uppercase">Eficiência Técnica</p>
                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-indigo-50 rounded-full opacity-50 group-hover:scale-150 transition-transform" />
            </div>

            <div className="bg-white p-10 rounded-[3rem] border-2 border-emerald-100 shadow-2xl relative overflow-hidden group hover:border-emerald-500 transition-all">
                <div className="p-4 bg-emerald-50 rounded-2xl w-fit mb-6">
                    <Activity className="w-8 h-8 text-emerald-600" />
                </div>
                <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2">Disponibilidade</h4>
                <p className="text-5xl font-black text-slate-900">{kpis.currentAvailability.toFixed(0)}%</p>
                <p className="mt-4 text-[10px] font-black text-emerald-600 uppercase">Frota em Combate</p>
                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-emerald-50 rounded-full opacity-50 group-hover:scale-150 transition-transform" />
            </div>

            <div className="bg-white p-10 rounded-[3rem] border-2 border-blue-100 shadow-2xl relative overflow-hidden group hover:border-blue-500 transition-all">
                <div className="p-4 bg-blue-50 rounded-2xl w-fit mb-6">
                    <TrendingUp className="w-8 h-8 text-blue-600" />
                </div>
                <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2">Produção</h4>
                <p className="text-5xl font-black text-slate-900">{totalProduction}</p>
                <p className="mt-4 text-[10px] font-black text-blue-600 uppercase">Fardos Totais</p>
                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-blue-50 rounded-full opacity-50 group-hover:scale-150 transition-transform" />
            </div>

            <div className="bg-white p-10 rounded-[3rem] border-2 border-orange-100 shadow-2xl relative overflow-hidden group hover:border-orange-500 transition-all">
                <div className="p-4 bg-orange-50 rounded-2xl w-fit mb-6">
                    <Users className="w-8 h-8 text-orange-600" />
                </div>
                <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2">Operação</h4>
                <p className="text-5xl font-black text-slate-900">{teamStats.operation.operationalCapacity.toFixed(0)}%</p>
                <p className="mt-4 text-[10px] font-black text-orange-600 uppercase">Capacidade Humana</p>
                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-orange-50 rounded-full opacity-50 group-hover:scale-150 transition-transform" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
             <div className="bg-slate-950 p-12 rounded-[4rem] text-white space-y-10 relative overflow-hidden">
                <div className="relative z-10 space-y-10">
                    <h3 className="text-3xl font-black uppercase tracking-tighter">Status Gerencial</h3>
                    <div className="space-y-6">
                        <div className="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                            <span className="text-sm font-black uppercase text-slate-400">Eficiência de Safra</span>
                            <span className="text-2xl font-black text-blue-400">{(avgProductivity / (operationStats[0]?.goal / 12 || 100) * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                            <span className="text-sm font-black uppercase text-slate-400">Risco de Preparação</span>
                            <span className={cn(
                                "text-2xl font-black",
                                teamStats.maintenance.riskLevel === 'CRITICAL' ? "text-red-400" : "text-emerald-400"
                            )}>{teamStats.maintenance.riskLevel}</span>
                        </div>
                        <div className="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                            <span className="text-sm font-black uppercase text-slate-400">Máquinas Fora de Combate</span>
                            <span className="text-2xl font-black text-amber-400">{currentStatusStats.criticalMachines.length}</span>
                        </div>
                    </div>
                </div>
                <Activity className="absolute -bottom-20 -right-20 w-96 h-96 text-white/5 rotate-12" />
             </div>

             <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-xl space-y-10">
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Resumo de Produção (Últimos 7 dias)</h3>
                <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={dailyProductionData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip />
                            <Area type="monotone" dataKey="tirar_producao" name="Produção" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={4} />
                            <Area type="monotone" dataKey="quebra" name="Quebra" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={4} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
             </div>
          </div>
        </div>
      )}

      {activeView === 'safra' && <SafraImpactDashboard />}

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
