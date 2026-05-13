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

export function formatDate(dateVal: any): string {
  if (!dateVal) return '-';
  try {
    const date = new Date(dateVal);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
  } catch (e) {
    return '-';
  }
}

export function formatTime(dateVal: any): string {
  if (!dateVal) return '-';
  try {
    const date = new Date(dateVal);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '-';
  }
}

export function formatDateTime(dateVal: any): string {
  if (!dateVal) return '-';
  try {
    const date = new Date(dateVal);
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
