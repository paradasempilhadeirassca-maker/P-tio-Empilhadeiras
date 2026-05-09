export type UserRole = 'operator' | 'leader' | 'mechanic' | 'manager';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  password?: string; // Stored for simple recovery (no email)
}

export type ForkliftStatus = 'available' | 'stopped' | 'maintenance' | 'at_risk';

export type ForkliftType = 'empilhadeira' | 'manipulador';

export interface Forklift {
  id: string;
  model: string;
  serialNumber: string;
  type: ForkliftType;
  status: ForkliftStatus;
  lastMaintenance?: string;
  nextPreventive?: string;
  lastPreventiveHorometer?: number;
  nextPreventiveHorometer?: number;
  assignedOperatorId?: string;
  assignedOperatorName?: string;
  assignedOperatorIdShift1?: string;
  assignedOperatorNameShift1?: string;
  assignedOperatorIdShift2?: string;
  assignedOperatorNameShift2?: string;
  lastHourMeter?: number;
  lastHourMeterUpdate?: string;
}

export type MaintenanceType = 'corrective' | 'preventive';
export type MaintenanceStatus = 'pending' | 'in_progress' | 'awaiting_parts' | 'completed';

export interface Part {
  name: string;
  quantity: number;
  replaced: boolean;
  inventoryPartId?: string;
}

export interface InventoryPart {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  lastUpdated: string;
}

export type InventoryMovementType = 'addition' | 'deduction' | 'adjustment' | 'creation' | 'deletion';

export interface InventoryHistory {
  id: string;
  partId: string;
  partName: string;
  type: InventoryMovementType;
  quantityChange: number;
  newQuantity: number;
  reason?: string;
  userId: string;
  userName: string;
  timestamp: string;
}

export type OccurrenceSeverity = 'low' | 'medium' | 'high'; // low: Reparo, medium: Falha Iminente, high: Parada

export interface MaintenanceStop {
  id: string;
  forkliftId: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  operatorId: string;
  operatorName?: string;
  operatorIds?: string[];
  operatorNames?: string[];
  mechanicId?: string;
  stopTime: string;
  startTime?: string;
  endTime?: string;
  waitingPartsStartTime?: string;
  totalWaitingPartsMinutes?: number;
  pendingPartsList?: string[];
  description: string;
  hourMeter?: number;
  approverName?: string;
  repairNotes?: string;
  parts: Part[];
  isIncidentOnly?: boolean;
  severity?: OccurrenceSeverity;
}

export interface ChecklistItem {
  id: string;
  label: string;
  isConform: boolean;
  description?: string;
  isMandatory?: boolean;
}

export interface PreventiveMaintenanceExecution {
  id: string;
  forkliftId: string;
  forkliftModel: string;
  forkliftSerialNumber: string;
  type: ForkliftType;
  preventiveType: number; // 500 or 1000
  horometerAtExecution: number;
  date: string;
  mechanicId: string;
  mechanicName: string;
  checklist: ChecklistItem[];
  observations?: string;
  photosBefore?: string[];
  photosAfter?: string[];
  nextPreventiveHorometer: number;
}

export type ShiftType = '1' | '2';
export type OccurrenceType = 'avaria' | 'mecanico' | 'parada' | 'outro';
export type OperationType = 'tirar_producao' | 'quebra' | 'emblocamento' | 'carregamento';
export type WeatherType = 'normal' | 'chuva' | 'parado_clima';
export type LowProductionReason = 'chuva' | 'sem_producao' | 'sem_classificacao' | 'sem_caminhao' | 'algodoeira' | 'mecanico' | 'intervalo' | 'outro' | 'finalizacao_turno' | 'entre_safra' | 'aguardando_analise' | 'sem_carga' | 'falta_fardo' | 'consolidacao';

export interface OperationGoal {
  id?: string;
  operationType: OperationType;
  shift: ShiftType;
  goal: number; // Quantity of bales (fardos) per shift per forklift
  updatedAt: string;
}

export type EventAction = 'start' | 'change' | 'stop' | 'resume' | 'occurrence' | 'consolidation';

export interface OperationalEvent {
  id: string;
  forkliftId: string;
  operatorIds: string[];
  operatorNames: string[];
  operatorId?: string; // Legacy
  operatorName?: string; // Legacy
  operationType: OperationType;
  action: EventAction;
  stopReason?: LowProductionReason;
  production?: number;
  timestamp: string;
  shift: ShiftType;
  leaderId: string;
  leaderName: string;
  previousEventId?: string;
}

export interface ShiftReport {
  id: string;
  forkliftId: string;
  operatorId?: string; // Legacy
  operatorName?: string; // Legacy
  shift: ShiftType;
  date: string;
  startTime: string;
  endTime: string;
  totalProductiveMinutes: number;
  totalDowntimeMinutes: number;
  totalIntervalMinutes?: number;
  totalProduction: number;
  stopCount: number;
  operationsBreakdown: Record<string, { 
    minutes: number, 
    production: number,
    averageOperators: number,
    productivityPerManHour: number
  }>;
  initialHourMeter: number;
  finalHourMeter: number;
  totalMachineHours?: number;
  efficiency?: number;
  status: 'finalized';
  leaderId: string;
  leaderName: string;
  createdAt: string;
}

export interface Checklist {
  id: string;
  forkliftId: string;
  operatorId: string;
  operatorName: string;
  timestamp: string;
  items: ChecklistItem[];
  notes?: string;
  initialHourMeter: number;
  finalHourMeter: number;
  shift: ShiftType;
  checklistScore: number;
}
