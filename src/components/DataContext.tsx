import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
import { Forklift, UserProfile, OperationGoal, MaintenanceStop } from '../types';
import { useAuth } from './Auth';

interface DataContextType {
  forklifts: Forklift[];
  operators: UserProfile[];
  goals: OperationGoal[];
  activeStops: MaintenanceStop[];
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
  const [goals, setGoals] = useState<OperationGoal[]>([]);
  const [activeStops, setActiveStops] = useState<MaintenanceStop[]>([]);
  const [loading, setLoading] = useState(true);

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
        const oSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'operator'), limit(200)));
        oData = oSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
        setOperators(oData);
      } catch (err) {
        console.error("Error fetching operators:", err);
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

      // Salvar no Cache
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        forklifts: fData,
        operators: oData,
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

      return () => unsubscribe();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, fetchGlobalData]);

  return (
    <DataContext.Provider value={{ 
      forklifts, 
      operators, 
      goals, 
      activeStops,
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
