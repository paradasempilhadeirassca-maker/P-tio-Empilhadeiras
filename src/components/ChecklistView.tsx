import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  addDoc,
  updateDoc,
  doc,
  orderBy,
  limit,
  where,
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './Auth';
import { useData } from './DataContext';
import { useToast } from './ToastContext';
import { Forklift, Checklist, ChecklistItem, ShiftType } from '../types';
import { ClipboardCheck, CheckCircle2, XCircle, Loader2, History, ArrowLeft, Sun, Moon } from 'lucide-react';
import { cn } from '../lib/utils';
import { sendWhatsAppNotification, sendLocalNotification } from '../lib/notifications';
import { getCurrentShift, isValidHourMeterEntry, calculateOperatorEfficiency } from '../lib/operationalLogic';

const DEFAULT_ITEMS = [
  "Freio funcionando corretamente",
  "Direção sem falhas ou folgas",
  "Buzina funcionando",
  "Garfos sem trincas ou desgaste excessivo",
  "Correntes e mastro sem danos visíveis",
  "Sem vazamentos (óleo/hidráulico)",
  "Pneus em bom estado (sem cortes graves / muito gasto)",
  "Sistema hidráulico (sobe/desce/inclina normal)",
  "Luzes e sinalização funcionando",
  "Nível de bateria ou combustível suficiente"
];

export function ChecklistView() {
  const { profile, loading: authLoading, setQuotaExceeded } = useAuth();
  const { showToast } = useToast();
  const { forklifts } = useData();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [selectedForklift, setSelectedForklift] = useState<string>('');
  const [items, setItems] = useState<ChecklistItem[]>(
    DEFAULT_ITEMS.map((label, index) => ({
      id: `item-${index}`,
      label,
      isConform: true,
      description: ''
    }))
  );
  const [notes, setNotes] = useState('');
  const [initialHourMeter, setInitialHourMeter] = useState<string>('');
  const [finalHourMeter, setFinalHourMeter] = useState<string>('');
  const [selectedShift, setSelectedShift] = useState<ShiftType>(getCurrentShift());
  const [isUploading, setIsUploading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async () => {
    if (!profile) return;
    setIsRefreshing(true);
    try {
      const qC = query(collection(db, 'checklists'), orderBy('timestamp', 'desc'), limit(50));
      const cSnap = await getDocs(qC);
      setChecklists(cSnap.docs.map(d => ({ id: d.id, ...d.data() } as Checklist)));
    } catch (err: any) {
      if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
        setQuotaExceeded(true);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!authLoading && profile) {
      fetchData();
    }
  }, [authLoading, profile, setQuotaExceeded]);

  // Pre-select assigned forklift
  useEffect(() => {
    if (profile && forklifts.length > 0 && !selectedForklift) {
      const assigned = forklifts.find(f => 
        (selectedShift === '1' && f.assignedOperatorIdShift1 === profile.uid) ||
        (selectedShift === '2' && f.assignedOperatorIdShift2 === profile.uid)
      );
      if (assigned) {
        setSelectedForklift(assigned.id);
      }
    }
  }, [profile, forklifts.length > 0, selectedShift]); // Only run when forklifts array presence or shift changes

  // Fetch last hour meter when selection changes
  useEffect(() => {
    async function fetchLastHourMeter(forkliftId: string) {
      if (!forkliftId) return;
      try {
        const q = query(
          collection(db, 'checklists'), 
          where('forkliftId', '==', forkliftId),
          orderBy('timestamp', 'desc'),
          limit(1)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const lastChecklist = snapshot.docs[0].data() as Checklist;
          if (lastChecklist.finalHourMeter) {
            setInitialHourMeter(lastChecklist.finalHourMeter.toString());
          } else {
            setInitialHourMeter('');
          }
        } else {
          setInitialHourMeter('');
        }
      } catch (error: any) {
        if (error.code === 'resource-exhausted' || error.message?.includes('Quota exceeded')) {
          // Handled globally but logging here for context
          console.warn("Quota exceeded while fetching hour meter");
        } else {
          console.error("Error fetching last hour meter:", error);
        }
      }
    }

    if (selectedForklift) {
      fetchLastHourMeter(selectedForklift);
    }
  }, [selectedForklift, setQuotaExceeded]); // Strictly on selection change

  const uniqueForklifts = useMemo(() => {
    const fleetMap = new Map<string, Forklift>();
    forklifts.forEach(f => {
      const existing = fleetMap.get(f.serialNumber);
      // Prefer the one that is available if there are duplicates
      if (!existing || (existing.status !== 'available' && f.status === 'available')) {
        fleetMap.set(f.serialNumber, f);
      }
    });
    return Array.from(fleetMap.values()).sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
  }, [forklifts]);

  const filteredForklifts = useMemo(() => {
    return uniqueForklifts.filter(f => 
      (selectedShift === '1' && f.assignedOperatorIdShift1 === profile?.uid) ||
      (selectedShift === '2' && f.assignedOperatorIdShift2 === profile?.uid)
    );
  }, [uniqueForklifts, selectedShift, profile]);

  const handleSetConformity = (id: string, isConform: boolean) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, isConform, description: isConform ? '' : item.description } : item
    ));
  };

  const handleItemDescriptionChange = (id: string, description: string) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, description } : item
    ));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedForklift || !profile) return;

    // Check if all "Não" items have descriptions
    const missingDescriptions = items.filter(i => !i.isConform && !i.description?.trim());
    if (missingDescriptions.length > 0) {
      showToast(`Por favor, descreva os problemas nos itens marcados como Não.`, 'error');
      return;
    }

    const currentMeter = parseFloat(finalHourMeter);
    const fetchedInitial = initialHourMeter ? parseFloat(initialHourMeter) : currentMeter;

    if (isNaN(currentMeter) || !selectedForklift) {
      showToast('Por favor, informe o horímetro atual corretamente.', 'error');
      return;
    }

    if (currentMeter < fetchedInitial) {
      showToast(`O horímetro não pode ser menor que o último registro (${fetchedInitial}).`, 'error');
      return;
    }

    setIsUploading(true);
    try {
      const hasMajorIssues = items.some(i => !i.isConform);
      const checklistScore = (items.filter(i => i.isConform).length / items.length) * 100;

      const checklistData: Omit<Checklist, 'id'> = {
        forkliftId: selectedForklift,
        operatorId: profile.uid,
        operatorName: profile.displayName || profile.email.split('@')[0],
        timestamp: new Date().toISOString(),
        items,
        notes: notes.trim(),
        initialHourMeter: fetchedInitial,
        finalHourMeter: currentMeter,
        shift: selectedShift,
        checklistScore
      };

      // Add checklist
      const addPromise = addDoc(collection(db, 'checklists'), checklistData);
      
      // Update forklift last hour meter and status
      const updatePromise = updateDoc(doc(db, 'forklifts', selectedForklift), {
        lastHourMeter: currentMeter,
        status: hasMajorIssues ? 'at_risk' : 'available'
      });

      const result = await Promise.race([
        Promise.all([addPromise, updatePromise]),
        new Promise(resolve => setTimeout(() => resolve('offline_timeout'), 3500))
      ]);

      if (result === 'offline_timeout') {
        showToast('Check-list salvo localmente (Offline).', 'info');
      } else {
        showToast('Check-list registrado com sucesso!', 'success');
      }

      // Send WhatsApp Notification
      const forklift = forklifts.find(f => f.id === selectedForklift);
      const machineName = forklift ? `${forklift.model} ${forklift.serialNumber}` : 'Máquina';
      
      const notificationTitle = `📋 CHECK-LIST OPERACIONAL`;
      const notificationBody = `Máquina: ${machineName}\nStatus: ${hasMajorIssues ? 'COM IRREGULARIDADES' : 'OK'}`;
      
      sendLocalNotification(notificationTitle, notificationBody);

      sendWhatsAppNotification(
        `📋 *CHECK-LIST OPERACIONAL*\n\n` +
        `*Máquina:* ${machineName}\n` +
        `*Operador:* ${profile.displayName || profile.email}\n` +
        `*Horímetro:* ${currentMeter}\n` +
        `*Conformidade:* ${checklistScore.toFixed(0)}%\n` +
        `*Status:* ${hasMajorIssues ? '⚠️ IRREGULAR' : '✅ OK'}\n` +
        (hasMajorIssues ? `*Irregularidades:* ${items.filter(i => !i.isConform).map(i => `\n- ${i.label}: ${i.description}`).join('')}\n` : '') +
        `*Data:* ${new Date().toLocaleString('pt-BR')}`
      );

      setSelectedForklift('');
      setNotes('');
      setInitialHourMeter('');
      setFinalHourMeter('');
      setItems(DEFAULT_ITEMS.map((label, index) => ({
        id: `item-${index}`,
        label,
        isConform: true,
        description: ''
      })));
    } catch (error) {
      console.error("Error saving checklist:", error);
      showToast('Erro ao salvar check-list.', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <header className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button
            onClick={fetchData}
            disabled={isRefreshing}
            className={cn(
              "p-3 rounded-2xl border border-slate-200 transition-all active:scale-95 group",
              isRefreshing ? "bg-slate-50 text-slate-300" : "bg-white text-slate-600 hover:bg-slate-50 hover:border-blue-200"
            )}
            title="Atualizar Dados"
          >
            <History className={cn("w-5 h-5 transition-transform duration-700", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
          </button>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">Check-list Diário</h1>
            <p className="text-slate-500 text-sm font-medium">Inspeção de conformidade da máquina</p>
          </div>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 bg-white text-slate-600 border border-slate-200 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
        >
          {showHistory ? <ArrowLeft className="w-4 h-4" /> : <ClipboardCheck className="w-4 h-4" />}
          {showHistory ? 'Voltar' : 'Ver Histórico'}
        </button>
      </header>

      {showHistory ? (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {checklists.length === 0 ? (
            <div className="bg-slate-100 p-12 rounded-3xl text-center text-slate-400">
              Nenhum check-list registrado ainda.
            </div>
          ) : (
            checklists.map(cl => {
              const forklift = forklifts.find(f => f.id === cl.forkliftId);
              const nonConformCount = cl.items.filter(i => !i.isConform).length;
              
              return (
                <div key={cl.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-slate-900">{forklift?.model} {forklift?.serialNumber}</h3>
                      <p className="text-xs text-slate-500">{new Date(cl.timestamp).toLocaleString()}</p>
                      <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-1 italic">
                        Operador: {cl.operatorName} • {cl.shift === '1' ? 'Diurno' : 'Noturno'}
                      </p>
                      {(cl.initialHourMeter !== undefined || cl.finalHourMeter !== undefined) && (
                        <div className="flex gap-4 mt-2 bg-blue-50 p-2 rounded-lg border border-blue-100">
                          <div>
                            <p className="text-[8px] font-black text-blue-400 uppercase">H. Inicial</p>
                            <p className="text-xs font-bold text-blue-700">{cl.initialHourMeter || '-'}</p>
                          </div>
                          <div>
                            <p className="text-[8px] font-black text-blue-400 uppercase">H. Final</p>
                            <p className="text-xs font-bold text-blue-700">{cl.finalHourMeter || '-'}</p>
                          </div>
                          {cl.initialHourMeter && cl.finalHourMeter && (
                            <div className="ml-auto text-right">
                              <p className="text-[8px] font-black text-green-400 uppercase">Total</p>
                              <p className="text-xs font-black text-green-700">{(cl.finalHourMeter - cl.initialHourMeter).toFixed(1)}h</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                      nonConformCount > 0 ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"
                    )}>
                      {nonConformCount > 0 ? `${nonConformCount} Irregularidades` : 'Conforme'}
                    </span>
                  </div>
                  
                  {nonConformCount > 0 && (
                    <div className="bg-red-50/50 p-3 rounded-xl border border-red-100">
                      <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-2">Itens Não Conformes:</p>
                      <ul className="space-y-3">
                        {cl.items.filter(i => !i.isConform).map(i => (
                          <li key={i.id} className="text-xs text-red-700 flex flex-col gap-1">
                            <div className="flex items-center gap-2 font-bold">
                              <XCircle className="w-3 h-3" />
                              {i.label}
                            </div>
                            {i.description && (
                              <p className="text-[10px] text-red-600 ml-5 italic">
                                Descrição: {i.description}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {cl.notes && (
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Observações:</p>
                      <p className="text-xs text-slate-600 italic">"{cl.notes}"</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/50 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-end">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Máquina *</label>
                <select
                  value={selectedForklift}
                  onChange={(e) => setSelectedForklift(e.target.value)}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                  required
                >
                  <option value="">Selecione a Máquina</option>
                  {filteredForklifts.length > 0 && (
                    <optgroup label="Sua Frota (Este Turno)">
                      {filteredForklifts.map(f => (
                        <option key={f.id} value={f.id}>{f.model} {f.serialNumber}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Todas as Máquinas">
                    {uniqueForklifts
                      .filter(uf => !filteredForklifts.some(ff => ff.id === uf.id))
                      .map(f => (
                        <option key={f.id} value={f.id}>{f.model} {f.serialNumber}</option>
                      ))}
                  </optgroup>
                </select>
              </div>

              <div className="flex bg-slate-50 p-4 rounded-2xl border border-slate-200 items-center justify-between gap-3">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Turno Ativo</span>
                {selectedShift === '1' ? (
                  <div className="flex items-center gap-2 text-blue-600 font-black uppercase text-xs">
                    <Sun className="w-4 h-4" /> Diurno
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-orange-600 font-black uppercase text-xs">
                    <Moon className="w-4 h-4" /> Noturno
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 pb-4 text-center">Inspecionar Máquina</h3>
              <div className="space-y-4">
                {items.map((item) => (
                  <div 
                    key={item.id}
                    className="p-5 rounded-3xl border border-slate-100 bg-slate-50/30 space-y-4 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <span className="text-sm font-black text-slate-700">
                        {item.label}
                      </span>
                      <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSetConformity(item.id, true)}
                          className={cn(
                            "px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                            item.isConform 
                              ? "bg-green-500 text-white shadow-lg shadow-green-100" 
                              : "text-slate-400 hover:bg-slate-50"
                          )}
                        >
                          Sim
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetConformity(item.id, false)}
                          className={cn(
                            "px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                            !item.isConform 
                              ? "bg-red-500 text-white shadow-lg shadow-red-100" 
                              : "text-slate-400 hover:bg-slate-50"
                          )}
                        >
                          Não
                        </button>
                      </div>
                    </div>
                    
                    {!item.isConform && (
                      <div className="animate-in slide-in-from-top-2 duration-300">
                        <label className="block text-[8px] font-black text-red-400 uppercase tracking-widest mb-1 ml-1">Descreva o problema *</label>
                        <input
                          type="text"
                          value={item.description || ''}
                          onChange={(e) => handleItemDescriptionChange(item.id, e.target.value)}
                          placeholder="Ex: Vazamento no mangote esquerdo..."
                          className="w-full p-3 bg-white border border-red-100 rounded-xl text-xs font-medium focus:ring-4 focus:ring-red-500/5 focus:border-red-500 outline-none transition-all placeholder:text-slate-300 italic"
                          required
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 font-black">Horímetro Atual *</label>
                <input
                  type="number"
                  step="0.1"
                  value={finalHourMeter}
                  onChange={(e) => setFinalHourMeter(e.target.value)}
                  className="w-full p-6 bg-slate-50 border border-slate-200 rounded-[2rem] text-2xl font-black text-center outline-none border-b-8 border-b-blue-200 focus:border-b-blue-500 transition-all shadow-inner"
                  placeholder="0.0"
                  required
                />
                <p className="text-[10px] text-slate-400 font-bold mt-2 text-center uppercase tracking-widest">Informe a leitura do painel da máquina</p>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Comentários do Operador</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all min-h-[100px]"
                placeholder="Alguma observação geral sobre o turno?"
              />
            </div>

            <button
              type="submit"
              disabled={isUploading || !selectedForklift}
              className={cn(
                "w-full py-5 rounded-2xl font-black uppercase tracking-widest text-sm transition-all shadow-xl active:scale-95 flex items-center justify-center gap-3",
                isUploading || !selectedForklift
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100 ring-4 ring-blue-50"
              )}
            >
              {isUploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ClipboardCheck className="w-6 h-6" />}
              {isUploading ? 'Enviando...' : 'Finalizar Check-list'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
