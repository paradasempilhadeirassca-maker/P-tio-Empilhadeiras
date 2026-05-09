import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react';
import { cn } from '../lib/utils';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
}

export function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-green-500" />,
    error: <AlertCircle className="w-5 h-5 text-red-500" />,
    info: <Info className="w-5 h-5 text-blue-500" />,
  };

  const bgColors = {
    success: 'bg-green-50 border-green-100',
    error: 'bg-red-50 border-red-100',
    info: 'bg-blue-50 border-blue-100',
  };

  return (
    <div className={cn(
      "fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300",
      bgColors[type]
    )}>
      {icons[type]}
      <p className="text-sm font-bold text-slate-800 pr-4">{message}</p>
      <button 
        onClick={onClose}
        className="p-1 hover:bg-black/5 rounded-lg transition-colors"
      >
        <X className="w-4 h-4 text-slate-400" />
      </button>
    </div>
  );
}
