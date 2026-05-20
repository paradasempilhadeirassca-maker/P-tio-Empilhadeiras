import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { 
  collection, 
  query, 
  getDocs, 
  orderBy, 
  limit, 
  where,
  onSnapshot,
  DocumentData,
  QueryDocumentSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import { Forklift, UserProfile, OperationGoal, MaintenanceStop, ForkliftStatus, OperatorAbsence, SafraPeriod } from '../types';
import { useAuth } from './Auth';
import { handleFirestoreError, OperationType } from '../lib/firebaseErrorHandler';

interface DataContextType {
  forklifts: Forklift[];
  uniqueForklifts: Forklift[];
  operators: UserProfile[];
  mechanics: UserProfile[];
  goals: OperationGoal[];
  activeStops: MaintenanceStop[];
  absences: OperatorAbsence[];
  safraPeriods: SafraPeriod[];
  loading: boolean;
  refreshGlobalData: (force?: boolean) => Promise<void>;
  quotaExceeded: boolean;
  setQuotaExceeded: (val: boolean) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

import { CACHE_KEYS, CACHE_DURATION } from '../constants/cacheKeys';

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, loading: authLoading, quotaExceeded, setQuotaExceeded } = useAuth();
  const [forklifts, setForklifts] = useState<Forklift[]>([]);
  const [operators, setOperators] = useState<UserProfile[]>([]);
  const [mechanics, setMechanics] = useState<UserProfile[]>([]);
  const [goals, setGoals] = useState<OperationGoal[]>([]);
  const [activeStops, setActiveStops] = useState<MaintenanceStop[]>([]);
  const [absences, setAbsences] = useState<OperatorAbsence[]>([]);
  const [safraPeriods, setSafraPeriods] = useState<SafraPeriod[]>([]);
  const [loading, setLoading] = useState(true);

  const uniqueForklifts = useMemo(() => {
    // Identify machines with active maintenance occurrences
    const machineStatusMap = new Map<string, ForkliftStatus>();
    activeStops.forEach(stop => {
      const f = forklifts.find(fork => fork.id === stop.forkliftId);
      if (f?.serialNumber) {
        const serial = f.serialNumber.trim().toLowerCase();
        const severity = stop.severity || 'high';
        const stopStatus = stop.status || 'pending';
        
        let targetStatus: ForkliftStatus = 'available';

        if (stopStatus === 'in_progress') {
          targetStatus = 'maintenance';
        } else if (severity === 'high') {
          targetStatus = 'stopped';
        } else if (severity === 'medium' || severity === 'low' || stopStatus === 'awaiting_parts') {
          targetStatus = 'at_risk';
        }

        const existingStatus = machineStatusMap.get(serial);
        
        // Priority: maintenance > stopped > at_risk > available
        // Note: maintenance and stopped are both "unavailable", but maintenance implies worker active.
        const statusPriority = { 
          maintenance: 4, 
          stopped: 3, 
          at_risk: 2, 
          available: 1, 
          interdicted: 5, 
          external: 5,
          standby: 1,
          reserva: 1
        };

        if (!existingStatus || (statusPriority[targetStatus as keyof typeof statusPriority] || 0) > (statusPriority[existingStatus as keyof typeof statusPriority] || 0)) {
          machineStatusMap.set(serial, targetStatus);
        }
      }
    });

    const fleetMap = new Map<string, Forklift>();
    
    // Canonical record is the most recently created one for that serial Number
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

  const fetchGlobalData = useCallback(async (force = false) => {
    if (!user) return;
    
    const CACHE_KEY = CACHE_KEYS.GLOBAL_DATA;

    // 1. Tentar carregar do Cache
    if (!force) {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const { forklifts: f, operators: o, goals: g, activeStops: a, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_DURATION) {
            setForklifts(f);
            setOperators(o);
            setGoals(g);
            setActiveStops(a || []);
            setLoading(false);
            console.log("Dados globais carregados do cache (0 leituras)");
            return;
          }
        } catch (e) {
          localStorage.removeItem(CACHE_KEY);
        }
      }
    }

    try {
      setLoading(true);
      
      // Forklifts (Máquinas)
      let fData: Forklift[] = [];
      try {
        const fSnap = await getDocs(query(collection(db, 'forklifts'), limit(150)));
        fData = fSnap.docs.map(d => ({ id: d.id, ...d.data() } as Forklift));
        setForklifts(fData);
      } catch (err) {
        console.error("Error fetching forklifts:", err);
      }

      // Active Maintenance Stops (Ocorrências Ativas)
      let aData: MaintenanceStop[] = [];
      try {
        const aSnap = await getDocs(query(
          collection(db, 'maintenance'), 
          where('status', '!=', 'completed'),
          limit(100)
        ));
        aData = aSnap.docs.map(d => ({ id: d.id, ...d.data() } as MaintenanceStop));
        setActiveStops(aData);
      } catch (err) {
        console.error("Error fetching active stops:", err);
      }

      // Operators
      let oData: UserProfile[] = [];
      try {
        const oSnap = await getDocs(query(
          collection(db, 'users'), 
          where('role', 'in', ['operator', 'production']), 
          limit(1000)
        ));
        oData = oSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
        
        // Deduplicate by UID just in case there are double entries in the DB
        const uniqueOps = new Map<string, UserProfile>();
        oData.forEach(op => {
          if (op.uid) uniqueOps.set(op.uid, op);
        });
        setOperators(Array.from(uniqueOps.values()));
      } catch (err) {
        console.error("Error fetching operators:", err);
      }

      // Mechanics
      try {
        const mSnap = await getDocs(query(
          collection(db, 'users'), 
          where('role', '==', 'mechanic'), 
          limit(50)
        ));
        const mData = mSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
        setMechanics(mData);
      } catch (err) {
        console.error("Error fetching mechanics:", err);
      }

      // Goals
      let gData: OperationGoal[] = [];
      try {
        const gSnap = await getDocs(collection(db, 'operation_goals'));
        gData = gSnap.docs.map(d => ({ id: d.id, ...d.data() } as OperationGoal));
        setGoals(gData);
      } catch (err) {
        console.error("Error fetching goals:", err);
      }

      // Absences
      let abData: OperatorAbsence[] = [];
      try {
        const abSnap = await getDocs(collection(db, 'operator_absences'));
        abData = abSnap.docs.map(d => ({ id: d.id, ...d.data() } as OperatorAbsence));
        setAbsences(abData);
      } catch (err) {
        console.error("Error fetching absences:", err);
      }

      // Safra Periods
      let sData: SafraPeriod[] = [];
      const pathSafra = 'safra_periods';
      try {
        const sSnap = await getDocs(collection(db, pathSafra));
        sData = sSnap.docs.map(d => ({ id: d.id, ...d.data() } as SafraPeriod));
        setSafraPeriods(sData);
      } catch (err) {
        console.error("Error fetching safra periods:", err);
        handleFirestoreError(err, OperationType.LIST, pathSafra);
      }

      // Salvar no Cache
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        forklifts: fData,
        operators: oData,
        mechanics: Array.from(new Set([...mechanics])), // Just a place holder for cache structure
        goals: gData,
        activeStops: aData,
        timestamp: Date.now()
      }));

    } catch (err: any) {
      console.error("Global Data Fetch Error:", err);
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        setQuotaExceeded(true);
      }
    } finally {
      setLoading(false);
    }
  }, [user, setQuotaExceeded]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchGlobalData();

      // Realtime listener for active maintenance stops
      const q = query(
        collection(db, 'maintenance'), 
        where('status', '!=', 'completed'),
        limit(150)
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const stops = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MaintenanceStop));
        setActiveStops(stops);
        
        // Also update cache for consistency on reload
        const cached = localStorage.getItem(CACHE_KEYS.GLOBAL_DATA);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            parsed.activeStops = stops;
            parsed.timestamp = Date.now();
            localStorage.setItem(CACHE_KEYS.GLOBAL_DATA, JSON.stringify(parsed));
          } catch(e) {}
        }
      }, (err) => {
        console.error("Realtime stops error:", err);
      });

      const unsubscribeAbsences = onSnapshot(collection(db, 'operator_absences'), (snapshot) => {
        setAbsences(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as OperatorAbsence)));
      });

      const unsubscribeSafra = onSnapshot(collection(db, 'safra_periods'), (snapshot) => {
        setSafraPeriods(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SafraPeriod)));
      });

      return () => {
        unsubscribe();
        unsubscribeAbsences();
        unsubscribeSafra();
      };
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, fetchGlobalData]);

  return (
    <DataContext.Provider value={{ 
      forklifts, 
      uniqueForklifts,
      operators, 
      mechanics,
      goals, 
      activeStops,
      absences,
      safraPeriods,
      loading, 
      refreshGlobalData: fetchGlobalData,
      quotaExceeded,
      setQuotaExceeded
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
