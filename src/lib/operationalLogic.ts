/**
 * Operational logic for the Forklift Fleet Management system.
 * This file contains business rules that are independent of the persistence layer.
 */

import { Forklift, Checklist, ShiftType, WeatherType, LowProductionReason } from '../types';
import { formatNumber } from './utils';

/**
 * Determines the current shift based on the time of day.
 * Diurno (Shift 1): 07:00 - 19:00
 * Noturno (Shift 2): 20:00 - 06:00 (Standardized to handle gaps)
 */
export function getCurrentShift(): ShiftType {
  const hour = new Date().getHours();
  // Diurno: 07:00 to 19:00
  if (hour >= 7 && hour < 19) {
    return '1';
  }
  // Noturno: 20:00 to 06:00 (implicitly handled 19-20 and 06-07 as Shift 2 or transition)
  return '2';
}

/**
 * Validates if the final hour meter is logically valid compared to the initial.
 */
export function isValidHourMeterEntry(initial: number, final: number): boolean {
  return final > initial && (final - initial) < 24; // A machine can't work more than 24h in a day
}

/**
 * Calculates efficiency based on user defined scores.
 * Formula: (normalizedProductivity * 0.5) + (checklistScore * 0.3) - occurrencePenalty
 */
export function calculateOperatorEfficiency(
  productivity: number, 
  checklistScore: number, 
  hasOccurrence: boolean,
  weather?: WeatherType,
  lowProductionReason?: LowProductionReason
): number {
  // If weather is bad (rain) or there is an external reason for low production, 
  // we do not penalize for low productivity. We assume full productivity score (100%)
  // for the purpose of the overall efficiency score, effectively focusing the 
  // score on quality (checklist) and safety (occurrences).
  const isExternalFactorBlocking = weather === 'chuva' || weather === 'parado_clima' || (lowProductionReason && lowProductionReason !== undefined);

  const normalizedProductivity = isExternalFactorBlocking
    ? 100 // Full productivity credit when blocked externally
    : Math.min(100, (productivity / 20) * 100);
  
  const occurrencePenalty = hasOccurrence ? 20 : 0;
  
  const score = (normalizedProductivity * 0.5) + (checklistScore * 0.3) - occurrencePenalty;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Checks if a forklift requires preventive maintenance.
 * Logic: Every 250 hours or X days since last maintenance.
 */
export function requiresPreventiveMaintenance(forklift: Forklift, thresholdHours: number = 250): { required: boolean; reason?: string } {
  if (!forklift.lastHourMeter) return { required: false };
  
  // Example: nextPreventive is stored as a date, but we can also use hours
  // If we have a 'lastMaintenanceHourMeter', we could check:
  // forklift.lastHourMeter - forklift.lastMaintenanceHourMeter >= thresholdHours

  // Simple date logic for now
  if (forklift.nextPreventive) {
    const nextDate = new Date(forklift.nextPreventive);
    const now = new Date();
    if (nextDate <= now) {
      return { required: true, reason: 'Data da preventiva atingida ou ultrapassada.' };
    }
  }

  return { required: false };
}

/**
 * Formats hour meter values for display.
 */
export function formatHourMeter(value?: number): string {
  if (value === undefined || value === null) return '---';
  return formatNumber(value, 1) + 'h';
}
