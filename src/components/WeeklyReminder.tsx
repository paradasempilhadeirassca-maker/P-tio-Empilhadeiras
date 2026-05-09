import React, { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function WeeklyReminder() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const LAST_REMINDER_KEY = 'last_horimeter_reminder';
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const lastReminder = localStorage.getItem(LAST_REMINDER_KEY);

    if (!lastReminder || (now - parseInt(lastReminder)) > ONE_WEEK_MS) {
      setShow(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('last_horimeter_reminder', Date.now().toString());
    setShow(false);
  };

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="bg-blue-600 text-white p-4 rounded-2xl shadow-lg mb-8 flex items-center justify-between gap-4 border border-blue-500/50"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0 animate-pulse">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h4 className="font-black text-sm tracking-tight leading-none mb-1 uppercase">Lembrete de Horímetros</h4>
            <p className="text-xs text-blue-100 font-medium">Momento de atualizar os horímetros de todas as máquinas para garantir a precisão das manutenções.</p>
          </div>
        </div>
        <button 
          onClick={handleDismiss}
          className="p-2 hover:bg-white/10 rounded-xl transition-colors shrink-0"
          title="Dispensar lembrete"
        >
          <X className="w-5 h-5" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
