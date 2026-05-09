import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
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
