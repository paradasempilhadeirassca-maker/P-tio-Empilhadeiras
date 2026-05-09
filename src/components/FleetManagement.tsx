import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  where,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { useToast } from './ToastContext';
import { Forklift, UserProfile } from '../types';
import { requiresPreventiveMaintenance, formatHourMeter } from '../lib/operationalLogic';
import { getMaintenanceStatus } from '../lib/maintenanceLogic';
import { 
  Truck, 
  Plus, 
  Search, 
  UserPlus, 
  Trash2, 
  X, 
  Check, 
  AlertTriangle,
  Settings,
  Loader2,
  Wrench,
  Clock,
  Activity
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';

export function FleetManagement() {
  const { setQuotaExceeded } = useAuth();
  const { showToast } = useToast();
  const { forklifts, operators, refreshGlobalData, loading: dataLoading } = useData();
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state for new machine
  const [formData, setFormData] = useState({
    model: '',
    serialNumber: '',
    type: 'empilhadeira',
    initialHourMeter: '',
    nextPreventiveHorometer: '500',
    assignedOperatorIdShift1: '',
    assignedOperatorIdShift2: ''
  });

  const [editingHourMeter, setEditingHourMeter] = useState<{ id: string, value: string, field: 'last' | 'next' } | null>(null);

  useEffect(() => {
    refreshGlobalData();
  }, []);

  const handleAddMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.model || !formData.serialNumber) return;

    // Check for duplicates by serial number
    const isDuplicate = forklifts.some(f => f.serialNumber.trim().toLowerCase() === formData.serialNumber.trim().toLowerCase());
    if (isDuplicate) {
      showToast('Esta máquina já está cadastrada (Número de Série duplicado).', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const op1 = operators.find(o => o.uid === formData.assignedOperatorIdShift1);
      const op2 = operators.find(o => o.uid === formData.assignedOperatorIdShift2);
      
      await addDoc(collection(db, 'forklifts'), {
        model: formData.model.trim(),
        serialNumber: formData.serialNumber.trim(),
        type: formData.type,
        status: 'available',
        lastHourMeter: Number(formData.initialHourMeter) || 0,
        nextPreventiveHorometer: Number(formData.nextPreventiveHorometer) || (Number(formData.initialHourMeter) + 500),
        assignedOperatorIdShift1: formData.assignedOperatorIdShift1 || null,
        assignedOperatorNameShift1: op1?.displayName || null,
        assignedOperatorIdShift2: formData.assignedOperatorIdShift2 || null,
        assignedOperatorNameShift2: op2?.displayName || null,
        createdAt: new Date().toISOString()
      });

      await refreshGlobalData(true);
      showToast('Máquina cadastrada com sucesso!');
      setIsModalOpen(false);
      setFormData({ 
        model: '', 
        serialNumber: '', 
        type: 'empilhadeira',
        initialHourMeter: '',
        nextPreventiveHorometer: '500',
        assignedOperatorIdShift1: '', 
        assignedOperatorIdShift2: '' 
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'forklifts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignOperator = async (forkliftId: string, operatorId: string, shift: '1' | '2') => {
    const operator = operators.find(o => o.uid === operatorId);
    
    try {
      const updateData: any = {};
      if (shift === '1') {
        updateData.assignedOperatorIdShift1 = operatorId || null;
        updateData.assignedOperatorNameShift1 = operator?.displayName || null;
      } else {
        updateData.assignedOperatorIdShift2 = operatorId || null;
        updateData.assignedOperatorNameShift2 = operator?.displayName || null;
      }
      
      await updateDoc(doc(db, 'forklifts', forkliftId), updateData);
      await refreshGlobalData(true);
      showToast(`Operador do Turno ${shift} atribuído!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'forklifts');
    }
  };

  const handleDeleteMachine = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta máquina?')) return;

    try {
      await deleteDoc(doc(db, 'forklifts', id));
      await refreshGlobalData(true);
      showToast('Máquina excluída com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'forklifts');
    }
  };

  const handleUpdateHourMeter = async (id: string) => {
    if (!editingHourMeter || editingHourMeter.id !== id) return;
    
    const newValue = Number(editingHourMeter.value);
    if (isNaN(newValue)) {
      showToast('O valor deve ser um número.', 'error');
      return;
    }

    try {
      const updateField = editingHourMeter.field === 'last' ? 'lastHourMeter' : 'nextPreventiveHorometer';
      await updateDoc(doc(db, 'forklifts', id), {
        [updateField]: newValue
      });
      await refreshGlobalData(true);
      showToast('Horímetro atualizado com sucesso!');
      setEditingHourMeter(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'forklifts');
    }
  };

  const uniqueForklifts = useMemo(() => {
    const fleetMap = new Map<string, Forklift>();
    forklifts.forEach(f => {
      const serial = (f.serialNumber || '').trim().toLowerCase();
      if (!serial) return;
      
      const existing = fleetMap.get(serial);
      // Prefer available machines, then most recently created
      if (!existing || (existing.status !== 'available' && f.status === 'available')) {
        fleetMap.set(serial, f);
      }
    });
    return Array.from(fleetMap.values());
  }, [forklifts]);

  const uniqueOperators = useMemo(() => {
    const nameMap = new Map<string, UserProfile>();
    operators.forEach(o => {
      const nameKey = (o.displayName || o.email || o.uid).toLowerCase().trim();
      if (!nameMap.has(nameKey)) {
        nameMap.set(nameKey, o);
      }
    });
    return Array.from(nameMap.values()).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }, [operators]);

  const filteredForklifts = uniqueForklifts.filter(f => 
    f.model.toLowerCase().includes(searchTerm.toLowerCase()) || 
    f.serialNumber.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestão de Frota</h1>
          <p className="text-slate-500">Cadastre máquinas e atribua operadores responsáveis</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
        >
          <Plus className="w-4 h-4" />
          Nova Máquina
        </button>
      </header>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input 
          type="text" 
          placeholder="Buscar por modelo ou série..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(loading || dataLoading) ? (
          <div className="col-span-full py-12 flex justify-center">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        ) : filteredForklifts.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
            Nenhuma máquina encontrada.
          </div>
        ) : (
            filteredForklifts.map(f => {
              const prevMaintStatus = getMaintenanceStatus(f.lastHourMeter || 0, f.nextPreventiveHorometer || 0);
              const isMaintenanceRequired = prevMaintStatus === 'vencida' || prevMaintStatus === 'proxima';
              
              return (
                <div key={f.id} className={cn(
                  "bg-white p-6 rounded-3xl border transition-all space-y-4 shadow-sm hover:shadow-xl",
                  isMaintenanceRequired ? (prevMaintStatus === 'vencida' ? "border-red-200" : "border-amber-200") : "border-slate-200"
                )}>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-3 rounded-2xl",
                        f.status === 'available' ? "bg-green-50 text-green-600" : 
                        f.status === 'at_risk' ? "bg-amber-50 text-amber-600" : 
                        "bg-red-50 text-red-600"
                      )}>
                        <Truck className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 leading-tight">{f.model}</h4>
                        <div className="flex items-center gap-2 mt-0.5">
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{f.serialNumber}</p>
                           <span className="text-[8px] font-black text-slate-300 uppercase tracking-tighter px-1.5 py-0.5 rounded border border-slate-100">{f.type || 'Empilhadeira'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {isMaintenanceRequired && (
                        <div className="group relative">
                          <AlertTriangle className={cn("w-5 h-5 animate-pulse", prevMaintStatus === 'vencida' ? "text-red-500" : "text-amber-500")} />
                          <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-slate-900 text-[10px] text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 leading-tight font-medium">
                            {prevMaintStatus === 'vencida' ? 'Manutenção preventiva vencida!' : 'Manutenção preventiva próxima.'}
                          </div>
                        </div>
                      )}
                      <button 
                        onClick={() => handleDeleteMachine(f.id)}
                        className="p-2 text-slate-300 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 group/meter relative">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-tight">Leitura<br/>Atual</span>
                        {editingHourMeter?.id === f.id && editingHourMeter.field === 'last' ? (
                          <div className="flex items-center gap-1">
                            <input 
                              type="number"
                              step="0.1"
                              autoFocus
                              value={editingHourMeter.value}
                              onChange={(e) => setEditingHourMeter({ ...editingHourMeter, value: e.target.value })}
                              className="w-16 px-2 py-1 bg-white border border-blue-200 rounded-lg text-xs font-black outline-none focus:ring-2 focus:ring-blue-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateHourMeter(f.id);
                                if (e.key === 'Escape') setEditingHourMeter(null);
                              }}
                            />
                            <button 
                              onClick={() => handleUpdateHourMeter(f.id)}
                              className="text-green-600 hover:bg-green-50 rounded-lg p-0.5"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-black text-slate-900">{formatHourMeter(f.lastHourMeter)}</span>
                            <button 
                              onClick={() => setEditingHourMeter({ id: f.id, value: String(f.lastHourMeter || 0), field: 'last' })}
                              className="p-1 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                            >
                              <Settings className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 group/meter relative">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-tight">Próxima<br/>Prev.</span>
                        {editingHourMeter?.id === f.id && editingHourMeter.field === 'next' ? (
                          <div className="flex items-center gap-1">
                            <input 
                              type="number"
                              step="1"
                              autoFocus
                              value={editingHourMeter.value}
                              onChange={(e) => setEditingHourMeter({ ...editingHourMeter, value: e.target.value })}
                              className="w-16 px-2 py-1 bg-white border border-blue-200 rounded-lg text-xs font-black outline-none focus:ring-2 focus:ring-blue-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateHourMeter(f.id);
                                if (e.key === 'Escape') setEditingHourMeter(null);
                              }}
                            />
                            <button 
                              onClick={() => handleUpdateHourMeter(f.id)}
                              className="text-green-600 hover:bg-green-50 rounded-lg p-0.5"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-black text-blue-600">{f.nextPreventiveHorometer || 0}h</span>
                            <button 
                              onClick={() => setEditingHourMeter({ id: f.id, value: String(f.nextPreventiveHorometer || 0), field: 'next' })}
                              className="p-1 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                            >
                              <Settings className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <UserPlus className="w-3 h-3 text-blue-500" />
                    Diurno
                  </label>
                  <select 
                    value={f.assignedOperatorIdShift1 || ''}
                    onChange={(e) => handleAssignOperator(f.id, e.target.value, '1')}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Não atribuído</option>
                    {uniqueOperators.map(o => (
                      <option key={o.uid} value={o.uid}>{o.displayName}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <UserPlus className="w-3 h-3 text-orange-500" />
                    Noturno
                  </label>
                  <select 
                    value={f.assignedOperatorIdShift2 || ''}
                    onChange={(e) => handleAssignOperator(f.id, e.target.value, '2')}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Não atribuído</option>
                    {uniqueOperators.map(o => (
                      <option key={o.uid} value={o.uid}>{o.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-50 flex justify-between items-center">
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                  f.status === 'available' ? "bg-green-100 text-green-600" : 
                  f.status === 'at_risk' ? "bg-amber-100 text-amber-600" :
                  "bg-red-100 text-red-600"
                )}>
                  {f.status === 'available' ? 'Disponível' : 
                   f.status === 'at_risk' ? 'Operando com Risco' :
                   f.status === 'stopped' ? 'Parada' : 'Em Manutenção'}
                </span>
                <div className="flex flex-col items-end gap-1">
                  {f.assignedOperatorNameShift1 && (
                    <span className="text-[8px] font-bold text-blue-600 uppercase">
                      Diurno: {f.assignedOperatorNameShift1}
                    </span>
                  )}
                  {f.assignedOperatorNameShift2 && (
                    <span className="text-[8px] font-bold text-orange-600 uppercase">
                      Noturno: {f.assignedOperatorNameShift2}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })
        )}
      </div>

      {/* Add Machine Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-600" />
                Cadastrar Nova Máquina
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleAddMachine} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Modelo</label>
                <input 
                  type="text" 
                  value={formData.model}
                  onChange={(e) => setFormData({...formData, model: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Mx25, Manipulador..."
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Número de Série</label>
                <input 
                  type="text" 
                  value={formData.serialNumber}
                  onChange={(e) => setFormData({...formData, serialNumber: e.target.value})}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: 91005-01"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Tipo</label>
                  <select 
                    value={formData.type}
                    onChange={(e) => setFormData({...formData, type: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="empilhadeira">Empilhadeira</option>
                    <option value="manipulador">Manipulador</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Próxima Prev. (H)</label>
                  <input 
                    type="number" 
                    value={formData.nextPreventiveHorometer}
                    onChange={(e) => setFormData({...formData, nextPreventiveHorometer: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: 500, 1000..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Diurno (Opcional)</label>
                  <select 
                    value={formData.assignedOperatorIdShift1}
                    onChange={(e) => setFormData({...formData, assignedOperatorIdShift1: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Nenhum</option>
                    {uniqueOperators.map(o => (
                      <option key={o.uid} value={o.uid}>{o.displayName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Noturno (Opcional)</label>
                  <select 
                    value={formData.assignedOperatorIdShift2}
                    onChange={(e) => setFormData({...formData, assignedOperatorIdShift2: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Nenhum</option>
                    {uniqueOperators.map(o => (
                      <option key={o.uid} value={o.uid}>{o.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
