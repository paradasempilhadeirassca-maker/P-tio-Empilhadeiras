import { ForkliftType, ChecklistItem } from '../types';

export const getNextMaintenanceType = (nextHorometer: number): '500h' | '1000h' => {
  // Se for múltiplo de 1000, é 1000h. Caso contrário (sendo múltiplo de 500), é 500h.
  return nextHorometer % 1000 === 0 ? '1000h' : '500h';
};

export const getMaintenanceStatus = (currentHorometer: number, nextPreventiveHorometer: number, lastUpdateDate?: any) => {
  const diff = nextPreventiveHorometer - currentHorometer;
  
  // Verificar se o horímetro está desatualizado (mais de 7 dias sem atualização)
  if (lastUpdateDate) {
    const lastUpdate = lastUpdateDate.toDate ? lastUpdateDate.toDate() : new Date(lastUpdateDate);
    const now = new Date();
    const daysSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate > 7) return 'desatualizado';
  }

  if (diff <= 0) return 'vencida';
  if (diff <= 50) return 'proxima';
  return 'em_dia';
};

export const getPreventiveChecklist = (forkliftType: ForkliftType, nextHours: number): ChecklistItem[] => {
  const maintenanceType = getNextMaintenanceType(nextHours);
  const items: string[] = [];

  // Itens padrão (500h)
  items.push('Óleo do motor');
  items.push('Filtro de óleo');
  items.push('Filtro combustível');
  items.push('Verificar filtro de ar');
  items.push('Conferência geral');

  // Itens adicionais para 1000h
  if (maintenanceType === '1000h') {
    items.push('Óleo transmissão');
    items.push('Óleo diferencial');
    items.push('Filtro da transmissão');
    
    if (forkliftType === 'manipulador') {
      items.push('Óleo hidráulico');
      items.push('Lubrificação completa do braço');
    }
  }

  return items.map(label => ({
    id: label.toLowerCase().replace(/\s+/g, '_'),
    label,
    isConform: false,
    isMandatory: true
  }));
};
