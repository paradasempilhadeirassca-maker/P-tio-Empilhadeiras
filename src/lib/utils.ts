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
