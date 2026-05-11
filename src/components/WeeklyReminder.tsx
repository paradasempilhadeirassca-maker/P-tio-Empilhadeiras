import React, { useState, useEffect, useMemo } from 'react';
import { Bell, X, CheckCircle2, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useData } from './DataContext';
import { Forklift } from '../types';

export function WeeklyReminder() {
  const { uniqueForklifts } = useData();
  const [isDismissed, setIsDismissed] = useState(false);

  const stats = useMemo(() => {
    const now = new Date();
    const fifteenDaysAgo = new Date(now.getTime() - (15 * 24 * 60 * 60 * 1000));
    
    const updated = uniqueForklifts.filter(f => {
      if (!f.lastHourMeterUpdate) return false;
      const updateDate = new Date(f.lastHourMeterUpdate);
      return updateDate >= fifteenDaysAgo;
    }).length;

    return {
      updated,
      total: uniqueForklifts.length,
      allDone: uniqueForklifts.length > 0 && updated === uniqueForklifts.length
    };
  }, [uniqueForklifts]);

  useEffect(() => {
    const LAST_DISMISSAL_KEY = 'horometer_reminder_dismissed_at';
    const DISMISSAL_WINDOW = 24 * 60 * 60 * 1000; // 24 hours
    const lastDismissed = localStorage.getItem(LAST_DISMISSAL_KEY);
    
    if (lastDismissed) {
      if (Date.now() - parseInt(lastDismissed) < DISMISSAL_WINDOW) {
        setIsDismissed(true);
      }
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('horometer_reminder_dismissed_at', Date.now().toString());
    setIsDismissed(true);
  };

  // Se todas estão atualizadas, não mostramos o lembrete de pendência
  // Ou mostramos uma mensagem de sucesso opcional
  if (isDismissed || stats.total === 0) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={`p-5 rounded-[2.5rem] shadow-xl mb-8 flex items-center justify-between gap-6 border-2 transition-colors duration-500 ${
          stats.allDone 
            ? "bg-emerald-50 border-emerald-200 text-emerald-900" 
            : "bg-amber-50 border-amber-200 text-amber-900"
        }`}
      >
        <div className="flex items-center gap-5">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${
            stats.allDone ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
          }`}>
            {stats.allDone ? <CheckCircle2 className="w-7 h-7" /> : <Clock className="w-7 h-7 animate-pulse" />}
          </div>
          <div>
            <h4 className="font-black text-lg tracking-tighter leading-none mb-1 uppercase">
              {stats.allDone ? 'Frota Atualizada' : 'Atualização de Horímetros'}
            </h4>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-black ${stats.allDone ? 'text-emerald-600' : 'text-amber-600'}`}>
                {stats.updated} <span className="text-sm opacity-60">/ {stats.total}</span>
              </span>
              <p className="text-xs font-bold opacity-70 uppercase tracking-wide">
                {stats.allDone 
                  ? 'Todas as máquinas atualizadas nos últimos 15 dias'
                  : 'Máquinas com horímetro em dia (Ciclo de 15 dias)'}
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {!stats.allDone && (
            <div className="hidden md:block px-4 py-2 bg-amber-200/50 rounded-2xl text-[10px] font-black uppercase tracking-widest">
              Ação Requerida
            </div>
          )}
          <button 
            onClick={handleDismiss}
            className="p-3 hover:bg-black/5 rounded-2xl transition-colors shrink-0"
            title="Dispensar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
