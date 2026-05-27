import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  if (isNaN(ms) || ms < 0) return '0m';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (days >= 1) {
    const totalDays = ms / (1000 * 60 * 60 * 24);
    return `${totalDays.toFixed(1)} Dias`;
  }

  if (hours >= 1) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export function parseDateSafe(val: any): Date {
  if (!val) return new Date(NaN);
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
}

export function formatDate(dateVal: any): string {
  if (!dateVal) return '-';
  try {
    const date = parseDateSafe(dateVal);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
  } catch (e) {
    return '-';
  }
}

export function formatTime(dateVal: any): string {
  if (!dateVal) return '-';
  try {
    const date = parseDateSafe(dateVal);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '-';
  }
}

export function formatDateTime(dateVal: any): string {
  if (!dateVal) return '-';
  try {
    const date = parseDateSafe(dateVal);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } catch (e) {
    return '-';
  }
}

export function formatNumber(val: number, decimals: number = 0): string {
  if (val === undefined || val === null || isNaN(val)) return '0';
  const formatted = val.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true
  });
  // Standardize thousands separator to dot. Some browsers use a space or thin space in pt-BR locale.
  // We replace any whitespace character with a dot.
  return formatted.replace(/\s|[\u00A0\u202F]/g, '.');
}

export function formatCurrency(val: number): string {
  if (val === undefined || val === null || isNaN(val)) return 'R$ 0,00';
  return `R$ ${formatNumber(val, 2)}`;
}
