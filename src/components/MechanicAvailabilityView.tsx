import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  onSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import { useData } from './DataContext';
import { useAuth } from './Auth';
import { useToast } from './ToastContext';
import { cn } from '../lib/utils';
import { 
  Wrench, 
  Calendar, 
  Clock, 
  Trash2, 
  Plus, 
  AlertTriangle,
  CheckCircle2,
  Filter,
  Info
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { UserProfile } from '../types';

interface AccidentRecord {
  id: string;
  date: string;
  timestamp: string;
  mechanicId: string;
  mechanicName: string;
  createdBy: string;
  createdByName: string;
  status: string; // "Ausente"
  motivo: string; // e.g. "Atestado Médico"
  justificativa: string;
  timeEstimate: string; // e.g. "Dia Todo", or HH:MM
  isCompleteWeek?: boolean;
}

export function MechanicAvailabilityView() {
  const { profile } = useAuth();
  const { mechanics: contextMechanics } = useData();
  const { showToast } = useToast();

  // Firestore records state
  const [absences, setAbsences] = useState<AccidentRecord[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);

  // Real-time synchronization of users collection for foolproof lookup
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  // Month and Year filter state
  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth());
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());

  // Form states to record absence
  const [selectedMechanic, setSelectedMechanic] = useState<string>('');
  const [regDate, setRegDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isCompleteWeek, setIsCompleteWeek] = useState<boolean>(false);
  const [selectedMotive, setSelectedMotive] = useState<string>('Buscar peças');
  const [regTime, setRegTime] = useState<string>('08:00');
  const [isAllDay, setIsAllDay] = useState<boolean>(true);
  const [justificativa, setJustificativa] = useState<string>('');
  const [isSubmitLoading, setIsSubmitLoading] = useState(false);

  // Deletion inline confirmation state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Pre-defined motives
  const preDefinedMotives = [
    'Buscar peças',
    'Manutenção Carro',
    'Ausente',
    'Demanda Pessoal',
    'Atendimento Externo',
    'Atestado',
    'Feriado'
  ];

  // Listener for complete user database to map and fallback names securely
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const usersData = snap.docs.map(d => ({
        uid: d.id,
        ...d.data()
      } as UserProfile));
      setAllUsers(usersData);
    }, (error) => {
      console.error("Error reading users list for mechanics view:", error);
    });
    return () => unsub();
  }, []);

  // Compute actual operational mechanics dynamically so list is never blank or missing
  const displayedMechanics = useMemo(() => {
    // 1. Try real-time loaded users with 'mechanic' role
    const filtered = allUsers.filter(u => u.role === 'mechanic');
    if (filtered.length > 0) return filtered;

    // 2. Fall back to context mechanics (if any)
    if (contextMechanics && contextMechanics.length > 0) return contextMechanics;

    // 3. Fall back to non-operator users
    const nonOperators = allUsers.filter(u => u.role !== 'operator' && u.role !== 'production');
    if (nonOperators.length > 0) return nonOperators;

    // 4. Default predefined layout options if system has zero user records
    return [
      { uid: 'mechanic_principal', displayName: 'Mecânico Principal', email: 'principal@manutemp.local', role: 'mechanic', createdAt: '' },
      { uid: 'mechanic_terceirizado', displayName: 'Mecânico Terceirizado', email: 'terco@manutemp.local', role: 'mechanic', createdAt: '' },
      { uid: 'lider_manutencao', displayName: 'Líder de Manutenção', email: 'lider@manutemp.local', role: 'mechanic', createdAt: '' }
    ] as UserProfile[];
  }, [allUsers, contextMechanics]);

  // Load default selected mechanic
  useEffect(() => {
    if (displayedMechanics && displayedMechanics.length > 0) {
      // Find logged in profile or use first
      const defaultMech = displayedMechanics.find(m => m.uid === profile?.uid) || displayedMechanics[0];
      if (defaultMech && !selectedMechanic) {
        setSelectedMechanic(defaultMech.uid);
      }
    }
  }, [displayedMechanics, profile, selectedMechanic]);

  // Firebase Firestore real-time listener for mechanic absences
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'mechanic_availability'), (snap) => {
      const records = snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          date: data.date || '',
          timestamp: data.timestamp || '',
          mechanicId: data.mechanicId || '',
          mechanicName: data.mechanicName || '',
          createdBy: data.createdBy || '',
          createdByName: data.createdByName || '',
          status: data.status || 'Ausente',
          motivo: data.motivo || '',
          justificativa: data.justificativa || '',
          timeEstimate: data.timeEstimate || data.startTime || 'Dia Todo',
          isCompleteWeek: !!data.isCompleteWeek
        } as AccidentRecord;
      });

      // Sort chronological descending
      records.sort((a, b) => b.date.localeCompare(a.date) || b.timestamp.localeCompare(a.timestamp));
      setAbsences(records);
      setIsDataLoading(false);
    }, (error) => {
      console.error("Error reading mechanic absences from Firestore:", error);
      setIsDataLoading(false);
    });

    return () => unsub();
  }, []);

  // Form submission handler
  const handleRecordAbsence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMechanic) {
      showToast('Por favor, selecione um mecânico.', 'error');
      return;
    }

    setIsSubmitLoading(true);
    try {
      const mProfile = displayedMechanics.find(m => m.uid === selectedMechanic);
      const mName = mProfile?.displayName || mProfile?.email?.split('@')[0] || 'Mecânico Terceirizado';

      const baseTimeStr = isAllDay ? 'Dia Todo' : regTime;
      const parsedDate = new Date(regDate + 'T12:00:00');

      let datesToLog: string[] = [];

      if (isCompleteWeek) {
        // Find Monday of the selected week
        const dayOfWeek = parsedDate.getDay(); // 0 Sunday, 1 Monday, etc.
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        
        const monday = new Date(parsedDate);
        monday.setDate(parsedDate.getDate() + diffToMonday);

        // Generate 5 days (Monday to Friday)
        for (let i = 0; i < 5; i++) {
          const nextDay = new Date(monday);
          nextDay.setDate(monday.getDate() + i);
          datesToLog.push(nextDay.toISOString().split('T')[0]);
        }
      } else {
        datesToLog.push(regDate);
      }

      // Add each date to Firestore
      const promises = datesToLog.map(async (d) => {
        const record = {
          date: d,
          timestamp: new Date().toISOString(),
          mechanicId: selectedMechanic,
          mechanicName: mName,
          createdBy: profile?.uid || '',
          createdByName: profile?.displayName || 'Sistema',
          status: 'Ausente',
          motivo: selectedMotive,
          justificativa: justificativa.trim() || 'Sem observações adicionais.',
          timeEstimate: baseTimeStr,
          isCompleteWeek: isCompleteWeek
        };
        return addDoc(collection(db, 'mechanic_availability'), record);
      });

      await Promise.all(promises);

      showToast(
        isCompleteWeek 
          ? `Semana completa de ausência registrada com sucesso! (5 dias úteis)`
          : 'Ausência do mecânico registrada com sucesso!', 
        'success'
      );
      
      // Reset fields
      setJustificativa('');
      setIsCompleteWeek(false);

    } catch (error: any) {
      console.error(error);
      showToast('Erro ao salvar ausência: ' + error.message, 'error');
    } finally {
      setIsSubmitLoading(false);
    }
  };

  // Delete handler - NO window.confirm blocker for iframe compatibility!
  const handleDeleteAbsence = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'mechanic_availability', id));
      showToast('Registro de ausência removido.', 'success');
    } catch (e: any) {
      showToast('Erro ao excluir: ' + e.message, 'error');
    }
  };

  // ==========================================
  // METRICS & CALCULATIONS
  // ==========================================

  // Current year/month filtered absences list
  const currentMonthAbsences = useMemo(() => {
    return absences.filter(abs => {
      if (!abs.date) return false;
      const absDate = new Date(abs.date + 'T12:00:00');
      return absDate.getMonth() === filterMonth && absDate.getFullYear() === filterYear;
    });
  }, [absences, filterMonth, filterYear]);

  // Total Feriados in the month in days
  const totalHolidaysThisMonth = useMemo(() => {
    const holidayRecords = currentMonthAbsences.filter(a => a.motivo === 'Feriado');
    const dates = new Set(holidayRecords.map(a => a.date));
    return dates.size;
  }, [currentMonthAbsences]);

  // Total Absences in the Month in days (excluding Feriado)
  const totalDaysAbsentThisMonth = useMemo(() => {
    const nonHolidayRecords = currentMonthAbsences.filter(a => a.motivo !== 'Feriado');
    const dates = new Set(nonHolidayRecords.map(a => a.date));
    return dates.size;
  }, [currentMonthAbsences]);

  // Dynamic calculation of elapsed working days in the month (Mon-Fri)
  const elapsedWorkingDays = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const currentDay = today.getDate();

    // Helper: returns the number of weekdays (Mon-Fri) in a month, optionally up to a certain day
    const getWeekdaysInMonth = (y: number, mIdx: number, limitD?: number) => {
      const lastDay = new Date(y, mIdx + 1, 0).getDate();
      const endDay = limitD !== undefined ? Math.min(limitD, lastDay) : lastDay;
      let count = 0;
      for (let day = 1; day <= endDay; day++) {
        const dateObj = new Date(y, mIdx, day, 12, 0, 0);
        const dow = dateObj.getDay();
        if (dow >= 1 && dow <= 5) {
          count++;
        }
      }
      return count || 1; // avoid division by zero
    };

    if (filterYear < currentYear || (filterYear === currentYear && filterMonth < currentMonth)) {
      // Past month: counts all weekdays of that month
      return getWeekdaysInMonth(filterYear, filterMonth);
    } else if (filterYear === currentYear && filterMonth === currentMonth) {
      // Current month: count weekdays elapsed up to today's date
      return getWeekdaysInMonth(filterYear, filterMonth, currentDay);
    } else {
      // Future month: default to all weekdays of that month
      return getWeekdaysInMonth(filterYear, filterMonth);
    }
  }, [filterMonth, filterYear]);

  // Monthly Mechanic Availability % (calculated incrementally based on elapsed working days subtracting holidays)
  const monthlyAvailabilityPercentage = useMemo(() => {
    const adjustedElapsedDays = Math.max(1, elapsedWorkingDays - totalHolidaysThisMonth);
    const daysAbsent = Math.min(adjustedElapsedDays, totalDaysAbsentThisMonth);
    const availableDays = adjustedElapsedDays - daysAbsent;
    return Number(((availableDays / adjustedElapsedDays) * 100).toFixed(1));
  }, [elapsedWorkingDays, totalHolidaysThisMonth, totalDaysAbsentThisMonth]);

  // Recharts Donut data: Availability vs Absences
  const donutChartData = useMemo(() => {
    const avail = monthlyAvailabilityPercentage;
    const indisponivel = Number((100 - avail).toFixed(1));
    return [
      { name: 'Disponível', value: avail },
      { name: 'Indisponível', value: indisponivel }
    ];
  }, [monthlyAvailabilityPercentage]);

  // Monthly Evolution of Availability
  const monthlyEvolutionData = useMemo(() => {
    const monthsNames = [
      'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 
      'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
    ];

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const currentDay = today.getDate();

    const getWeekdaysInMonth = (y: number, mIdx: number, limitD?: number) => {
      const lastDay = new Date(y, mIdx + 1, 0).getDate();
      const endDay = limitD !== undefined ? Math.min(limitD, lastDay) : lastDay;
      let count = 0;
      for (let day = 1; day <= endDay; day++) {
        const dateObj = new Date(y, mIdx, day, 12, 0, 0);
        const dow = dateObj.getDay();
        if (dow >= 1 && dow <= 5) {
          count++;
        }
      }
      return count || 1;
    };

    return monthsNames.map((m, index) => {
      const monthAbs = absences.filter(abs => {
        if (!abs.date) return false;
        const absDate = new Date(abs.date + 'T12:00:00');
        return absDate.getMonth() === index && absDate.getFullYear() === filterYear;
      });

      const nonHolidayAbs = monthAbs.filter(a => a.motivo !== 'Feriado');
      const uniqueDaysAbsent = new Set(nonHolidayAbs.map(a => a.date)).size;

      const holidayAbs = monthAbs.filter(a => a.motivo === 'Feriado');
      const uniqueHolidays = new Set(holidayAbs.map(a => a.date)).size;

      let monthLimitWorkingDays = 1;
      if (filterYear < currentYear || (filterYear === currentYear && index < currentMonth)) {
        // Past month
        monthLimitWorkingDays = getWeekdaysInMonth(filterYear, index);
      } else if (filterYear === currentYear && index === currentMonth) {
        // Current month
        monthLimitWorkingDays = getWeekdaysInMonth(filterYear, index, currentDay);
      } else {
        // Future month
        monthLimitWorkingDays = getWeekdaysInMonth(filterYear, index);
      }

      const adjustedWorkingDays = Math.max(1, monthLimitWorkingDays - uniqueHolidays);
      const daysAbsent = Math.min(adjustedWorkingDays, uniqueDaysAbsent);
      const finalPercentage = Math.max(0, Math.min(100, Number((((adjustedWorkingDays - daysAbsent) / adjustedWorkingDays) * 100).toFixed(1))));

      // Future month defaults to 100 if no current record exists
      const isFuture = index > currentMonth && filterYear === currentYear;
      const displayVal = (monthAbs.length === 0 && isFuture) ? 100 : finalPercentage;

      return {
        name: m,
        Disponibilidade: displayVal,
        Ausencias: uniqueDaysAbsent
      };
    });
  }, [absences, filterYear]);

  // Pre-defined months
  const monthsList = [
    { value: 0, label: 'Janeiro' },
    { value: 1, label: 'Fevereiro' },
    { value: 2, label: 'Março' },
    { value: 3, label: 'Abril' },
    { value: 4, label: 'Maio' },
    { value: 5, label: 'Junho' },
    { value: 6, label: 'Julho' },
    { value: 7, label: 'Agosto' },
    { value: 8, label: 'Setembro' },
    { value: 9, label: 'Outubro' },
    { value: 10, label: 'Novembro' },
    { value: 11, label: 'Dezembro' }
  ];

  return (
    <div id="mechanic-availability-refactored-main" className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-200 pb-5">
        <div>
          <span className="bg-teal-600 text-white font-black uppercase text-[10px] tracking-widest px-2 py-0.5 rounded-md">
            Operacional
          </span>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 mt-1.5 tracking-tight flex items-center gap-2">
            <Wrench className="w-8 h-8 text-teal-600" />
            Gestão de Disponibilidade do Mecânico
          </h1>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-wider mt-0.5">
            Registro simplificado de afastamentos e monitoramento direto de indisponibilidade
          </p>
        </div>

        {/* Global Filter block */}
        <div className="flex items-center gap-2 bg-slate-100 p-2 rounded-2xl border border-slate-200">
          <Filter className="w-4 h-4 text-slate-500 ml-1" />
          
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(Number(e.target.value))}
            className="bg-white text-slate-700 text-xs font-black border border-slate-200 py-1.5 px-3 rounded-xl cursor-pointer focus:ring-1 focus:ring-teal-500"
          >
            {monthsList.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>

          <select
            value={filterYear}
            onChange={(e) => setFilterYear(Number(e.target.value))}
            className="bg-white text-slate-700 text-xs font-black border border-slate-200 py-1.5 px-3 rounded-xl cursor-pointer focus:ring-1 focus:ring-teal-500"
          >
            <option value={2026}>2026</option>
            <option value={2025}>2025</option>
            <option value={2024}>2024</option>
          </select>
        </div>
      </div>

      {/* DASHBOARD CARDS ROW: Optimized 2-column grid to dynamically enlarge the display graph */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Card 1: Total of Absences */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between lg:col-span-4 md:col-span-5">
          <div>
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">
              Faltas Cadastradas (No Mês)
            </span>
            <h3 id="dispo-absences-count-card" className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight flex items-baseline gap-2">
              {totalDaysAbsentThisMonth}
              <span className="text-sm font-bold text-slate-400">Dias Úteis</span>
            </h3>
            <p className="text-xs text-slate-500 font-semibold mt-3 uppercase leading-relaxed">
              Totalizando <b className="text-slate-800">{totalDaysAbsentThisMonth * 8} horas</b> de parada operacional do mecânico.
            </p>
          </div>
          <div className="mt-6 bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span className="text-[10px] font-bold text-amber-700 leading-tight text-left">
              A ausência do mecânico estende o tempo de reparo (MTTR) das empilhadeiras por escassez de assistência.
            </span>
          </div>
        </div>

        {/* Card 2: Donut Circular Gauge of Availability (REFACTORED - SIGNIFICANTLY ENLARGED) */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6 lg:col-span-8 md:col-span-7">
          <div className="text-left py-2 flex-1 space-y-2">
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">
              Disponibilidade Operacional do Mês
            </span>
            <h3 className="text-4xl md:text-5xl lg:text-6xl font-black text-teal-600 tracking-tight">
              {monthlyAvailabilityPercentage}%
            </h3>
            <div className="text-xs text-slate-500 font-semibold max-w-md leading-relaxed space-y-1.5">
              <p>Proporção de tempo em que a equipe mecânica esteve regularizada na safra.</p>
              <p className="text-[10px] text-slate-400 font-bold uppercase leading-snug">
                Base de {elapsedWorkingDays - totalHolidaysThisMonth} {(elapsedWorkingDays - totalHolidaysThisMonth) === 1 ? 'dia útil ativo transcorrido' : 'dias úteis ativos transcorridos'} no mês selecionado{totalHolidaysThisMonth > 0 ? ` (já deduzidos ${totalHolidaysThisMonth} feriados neutros)` : ''}.
              </p>
            </div>
          </div>
          
          <div className="w-44 h-44 md:w-48 md:h-48 shrink-0 flex items-center justify-center relative bg-slate-50/50 rounded-full border border-slate-100 p-2 shadow-inner">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  <Cell fill="#0d9488" /> {/* Available color */}
                  <Cell fill="#f43f5e" /> {/* Absent color */}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl md:text-2xl font-black text-slate-800">{monthlyAvailabilityPercentage}%</span>
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Disponível</span>
            </div>
          </div>
        </div>

      </div>

      {/* TWO COLUMN GRID: LEFT = LOG FORM; RIGHT = TREND & LOG TABLE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT COLUMN: Absence Log Form */}
        <div className="lg:col-span-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm h-fit">
          <div className="mb-4">
            <span className="bg-rose-50 text-rose-700 font-black text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-md">
              Novo Lançamento
            </span>
            <h2 className="text-lg font-black text-slate-900 mt-1 tracking-tight border-b border-slate-100 pb-2">Registrar Ausência</h2>
            <p className="text-xs text-slate-400 font-semibold mt-1.5">
              Lançamento retroativo ou imediato de afastados operacionais.
            </p>
          </div>

          <form onSubmit={handleRecordAbsence} className="space-y-4">
            
            {/* Mechanic selection with fallback renderers */}
            <div className="space-y-1 text-left">
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">
                Mecânico Requerido
              </label>
              <select
                value={selectedMechanic}
                onChange={(e) => setSelectedMechanic(e.target.value)}
                className="w-full bg-slate-50 text-slate-800 text-xs font-bold border border-slate-200 p-3 rounded-xl focus:ring-1 focus:ring-teal-500 outline-none cursor-pointer"
                required
              >
                <option value="">Selecione...</option>
                {displayedMechanics.map(m => (
                  <option key={m.uid} value={m.uid}>
                    {m.displayName || m.email?.split('@')[0] || `Mecânico #${m.uid.substring(0, 5)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Date selection with COMPLETE WEEK option */}
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="flex justify-between items-center text-left">
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">
                  Data da Falta / Início
                </label>
                
                {/* Complete week toggle */}
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isCompleteWeek}
                    onChange={(e) => setIsCompleteWeek(e.target.checked)}
                    className="w-4.5 h-4.5 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                  />
                  <span className="text-[10px] font-black text-slate-700 uppercase tracking-tight">
                    Semana Completa
                  </span>
                </label>
              </div>

              <input
                type="date"
                value={regDate}
                onChange={(e) => setRegDate(e.target.value)}
                className="w-full bg-slate-50 text-slate-700 text-xs font-bold border border-slate-200 p-3 rounded-xl focus:ring-1 focus:ring-teal-500"
                required
              />
              
              {isCompleteWeek && (
                <p className="text-[9px] font-black text-teal-700 bg-teal-50 p-2.5 rounded-lg border border-teal-100 leading-snug">
                  💡 <b>Atenção:</b> Esta opção gerará automaticamente <b>5 registros</b> de ausência para a semana útil completa (segunda-feira à sexta-feira) correspondente à data escolhida acima!
                </p>
              )}
            </div>

            {/* Hour setup */}
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="flex justify-between items-center">
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">
                  Período da Ausência
                </label>
                
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAllDay}
                    onChange={(e) => setIsAllDay(e.target.checked)}
                    className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                  />
                  <span className="text-[10px] font-bold text-slate-700 uppercase tracking-tight">
                    Dia Inteiro (8h)
                  </span>
                </label>
              </div>

              {!isAllDay && (
                <div className="space-y-1 text-left">
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-2 rounded-xl">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Ex: Turno Manhã (08:00 - 12:00)"
                      value={regTime === '08:00' ? '' : regTime}
                      onChange={(e) => setRegTime(e.target.value)}
                      className="bg-transparent text-slate-700 text-xs font-bold w-full outline-none"
                    />
                  </div>
                  <span className="text-[8px] font-bold text-slate-400 block ml-1 uppercase">Exemplo: "08:00 às 12:00" ou "A partir das 14h"</span>
                </div>
              )}
            </div>

            {/* Predefined motives */}
            <div className="space-y-1 text-left border-t border-slate-100 pt-3">
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">
                Motivo Predefinido
              </label>
              <select
                value={selectedMotive}
                onChange={(e) => setSelectedMotive(e.target.value)}
                className="w-full bg-slate-50 text-slate-800 text-xs font-bold border border-slate-200 p-3 rounded-xl focus:ring-1 focus:ring-teal-500 outline-none cursor-pointer"
                required
              >
                {preDefinedMotives.map(mot => (
                  <option key={mot} value={mot}>{mot}</option>
                ))}
              </select>
            </div>

            {/* Justification details */}
            <div className="space-y-1 text-left">
              <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">
                Observações / Justificativa Detalhada
              </label>
              <textarea
                placeholder="Insira detalhes adicionais do afastamento útil ou número do atestado médico..."
                rows={3}
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                className="w-full bg-slate-50 text-slate-800 text-xs font-semibold border border-slate-200 p-3 rounded-xl focus:ring-1 focus:ring-teal-500 outline-none resize-none"
              ></textarea>
            </div>

            {/* Action button */}
            <button
              type="submit"
              disabled={isSubmitLoading}
              className="w-full py-3 px-4 bg-slate-900 border border-slate-950 hover:bg-slate-800 text-white font-extrabold text-xs uppercase tracking-widest rounded-xl shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {isSubmitLoading ? (
                'Salvando...'
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Salvar Registro de Ausência
                </>
              )}
            </button>

          </form>
        </div>

        {/* RIGHT COLUMN: TREND & TABLE */}
        <div className="lg:col-span-8 space-y-6">

          {/* EVOLUÇÃO MENSAL CHART (Requisito "Evolução Mensal de Disponibilidade do Mecânico") */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                  Evolução Mensal de Disponibilidade do Mecânico
                </h3>
                <p className="text-xs text-slate-400 font-bold uppercase">
                  Tendência anual de assistência na safra para o ano selecionado ({filterYear})
                </p>
              </div>
              <span className="text-[10px] font-black bg-teal-55 text-teal-700 px-2.5 py-0.5 rounded uppercase">
                Ref. 2026/2025
              </span>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyEvolutionData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="refactoredGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0d9488" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#0d9488" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    domain={[60, 100]} 
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '11px', fontWeight: 'bold' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                  <Area 
                    name="Disponibilidade (%)" 
                    type="monotone" 
                    dataKey="Disponibilidade" 
                    stroke="#0d9488" 
                    strokeWidth={3} 
                    fillOpacity={1} 
                    fill="url(#refactoredGrad)" 
                  />
                  <Area 
                    name="Qtd Ausências (dias)" 
                    type="monotone" 
                    dataKey="Ausencias" 
                    stroke="#f43f5e" 
                    strokeWidth={1.5} 
                    fill="none" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* TABLE LOGS LIST OF THE SELECTED MONTH */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden text-left">
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-slate-50/55">
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                  Lista de Ausências do Mês
                </h3>
                <p className="text-xs text-slate-400 font-bold uppercase">
                  Registros de afastamento localizados para o período de {monthsList.find(m => m.value === filterMonth)?.label} de {filterYear}
                </p>
              </div>
              <span className="font-extrabold text-[10px] text-slate-600 bg-slate-200/80 px-2 py-0.5 rounded shadow-sm">
                {currentMonthAbsences.length} Registro(s) Encontrado(s)
              </span>
            </div>

            {isDataLoading ? (
              <div className="p-12 text-center text-xs font-bold text-slate-500">
                Carregando registros de ausências...
              </div>
            ) : currentMonthAbsences.length === 0 ? (
              <div className="p-12 text-center text-xs font-bold text-slate-400 uppercase flex flex-col items-center justify-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                Nenhum afastamento ou ausência registrada neste mês!
                <span className="text-[10px] font-normal text-slate-450 normal-case block mt-0.5">
                  A disponibilidade do mecânico terceirizado está no nível ideal de 100%.
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Data do Afastamento</th>
                      <th className="py-3 px-4">Mecânico</th>
                      <th className="py-3 px-4">Motivo / Razão</th>
                      <th className="py-3 px-4">Período</th>
                      <th className="py-3 px-4">Justificativa / Obs</th>
                      <th className="py-3 px-4 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {currentMonthAbsences.map(abs => {
                      const formattedDate = new Date(abs.date + 'T12:00:00')
                        .toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

                      return (
                        <tr key={abs.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-4 font-black text-slate-900 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              {formattedDate}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-700 whitespace-nowrap">
                            {abs.mechanicName}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={cn(
                              "px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide border",
                              abs.motivo === 'Buscar peças' ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                              abs.motivo === 'Manutenção Carro' ? "bg-indigo-50 text-indigo-700 border-indigo-100" :
                              abs.motivo === 'Ausente' ? "bg-slate-100 text-slate-700 border-slate-300" :
                              abs.motivo === 'Demanda Pessoal' ? "bg-amber-50 text-amber-700 border-amber-100" :
                              abs.motivo === 'Atendimento Externo' ? "bg-sky-50 text-sky-700 border-sky-100" :
                              abs.motivo === 'Atestado' ? "bg-rose-50 text-rose-700 border-rose-100" :
                              abs.motivo === 'Feriado' ? "bg-purple-100 text-purple-800 border-purple-200" :
                              "bg-slate-50 text-slate-700 border-slate-200"
                            )}>
                              {abs.motivo}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-extrabold text-slate-600 whitespace-nowrap">
                            {abs.timeEstimate}
                          </td>
                          <td className="py-3.5 px-4 text-slate-500 max-w-xs truncate font-medium" title={abs.justificativa}>
                            {abs.justificativa}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            {deleteConfirmId === abs.id ? (
                              <div className="flex items-center justify-end gap-1.5 animation-fade-in">
                                <span className="text-[9px] font-black text-rose-600 uppercase tracking-tighter">Apagar?</span>
                                <button
                                  onClick={() => {
                                    handleDeleteAbsence(abs.id);
                                    setDeleteConfirmId(null);
                                  }}
                                  className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-black text-[10px] uppercase cursor-pointer"
                                  title="Confirmar exclusão"
                                >
                                  Sim
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded font-bold text-[10px] uppercase cursor-pointer"
                                  title="Cancelar"
                                >
                                  Não
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirmId(abs.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-55 rounded transition-colors cursor-pointer"
                                title="Remover Registro"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
