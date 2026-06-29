import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  getDocs,
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  limit,
  writeBatch,
  orderBy
} from 'firebase/firestore';
import { db } from '../firebase';
import { useToast } from './ToastContext';
import { useAuth } from './Auth';
import { InventoryPart, InventoryHistory, InventoryMovementType } from '../types';
import { sendWhatsAppNotification, sendLocalNotification } from '../lib/notifications';
import { 
  Package, 
  Plus, 
  Search, 
  AlertCircle, 
  Edit2, 
  Trash2, 
  ArrowUp, 
  ArrowDown,
  X,
  Check,
  AlertTriangle,
  History,
  Calendar,
  User as UserIcon,
  Filter
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';
import { CACHE_KEYS, CACHE_DURATION } from '../constants/cacheKeys';

export function PartsInventory() {
  const { profile, setQuotaExceeded } = useAuth();
  const { showToast } = useToast();
  const [parts, setParts] = useState<InventoryPart[]>([]);
  const [history, setHistory] = useState<InventoryHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<InventoryPart | null>(null);
  const [partToDelete, setPartToDelete] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<string>('all');

  const isManager = profile?.role === 'manager';

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    quantity: 0,
    minQuantity: 0,
    unit: 'un',
    reason: ''
  });

  const fetchData = async (force = false) => {
    setIsRefreshing(true);
    setLoading(parts.length === 0);

    // 1. Try Loading from Cache
    const CACHE_KEY = CACHE_KEYS.INVENTORY;
    const HISTORY_CACHE_KEY = CACHE_KEYS.INVENTORY + '_history';
    
    if (!force) {
      const cachedParts = localStorage.getItem(CACHE_KEY);
      if (cachedParts) {
        try {
          const { data, timestamp } = JSON.parse(cachedParts);
          if (Date.now() - timestamp < CACHE_DURATION) {
            setParts(data);
            setLoading(false);
            if (!isHistoryOpen) {
              setIsRefreshing(false);
              return;
            }
          }
        } catch (e) {
          localStorage.removeItem(CACHE_KEY);
        }
      }
    }

    try {
      const q = query(
        collection(db, 'parts_inventory'), 
        orderBy('name'),
        limit(500)
      );
      const snapshot = await getDocs(q);
      const newParts = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as InventoryPart));
      setParts(newParts);
      
      // Update Parts Cache
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data: newParts,
        timestamp: Date.now()
      }));

      if (isHistoryOpen) {
        const qH = query(
          collection(db, 'parts_inventory_history'),
          orderBy('timestamp', 'desc'),
          limit(50)
        );
        const hSnap = await getDocs(qH);
        const newHistory = hSnap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryHistory));
        setHistory(newHistory);

        // Update History Cache
        localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify({
          data: newHistory,
          timestamp: Date.now()
        }));
      }
    } catch (error: any) {
      if (error?.code === 'resource-exhausted' || error?.message?.includes('Quota exceeded')) {
        setQuotaExceeded(true);
      }
      handleFirestoreError(error, OperationType.LIST, 'parts_inventory');
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [isHistoryOpen]);

  const handleRefresh = () => fetchData(true);

  const logHistory = (
    batch: any,
    partId: string, 
    partName: string, 
    type: InventoryMovementType, 
    change: number, 
    newQty: number, 
    reason?: string
  ) => {
    const historyRef = doc(collection(db, 'parts_inventory_history'));
    batch.set(historyRef, {
      partId,
      partName,
      type,
      quantityChange: change,
      newQuantity: newQty,
      reason: reason || '',
      userId: profile?.uid,
      userName: profile?.displayName || profile?.email,
      timestamp: new Date().toISOString()
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showToast('O nome da peça é obrigatório.', 'error');
      return;
    }

    // Check for duplicates
    const isDuplicate = parts.some(p => 
      p.name.toLowerCase() === formData.name.trim().toLowerCase() && 
      p.id !== editingPart?.id
    );

    if (isDuplicate) {
      showToast('Já existe uma peça cadastrada com este nome.', 'error');
      return;
    }

    try {
      const batch = writeBatch(db);
      const data = {
        ...formData,
        name: formData.name.trim(),
        lastUpdated: new Date().toISOString()
      };

      if (editingPart) {
        const partRef = doc(db, 'parts_inventory', editingPart.id);
        batch.update(partRef, data);
        
        if (editingPart.quantity !== formData.quantity) {
          logHistory(
            batch,
            editingPart.id,
            data.name,
            'adjustment',
            formData.quantity - editingPart.quantity,
            formData.quantity,
            formData.reason || 'Edição de dados'
          );
        }
        
        // Update local state and cache
        const updatedParts = parts.map(p => p.id === editingPart.id ? { ...p, ...data } : p);
        setParts(updatedParts);
        localStorage.setItem('inventory_parts_cache', JSON.stringify({
          data: updatedParts,
          timestamp: Date.now()
        }));
      } else {
        const newPartRef = doc(collection(db, 'parts_inventory'));
        const newPart = { id: newPartRef.id, ...data } as InventoryPart;
        batch.set(newPartRef, data);
        
        logHistory(
          batch,
          newPartRef.id,
          data.name,
          'creation',
          formData.quantity,
          formData.quantity,
          'Cadastro inicial'
        );

        // Update local state and cache
        const updatedParts = [newPart, ...parts];
        setParts(updatedParts);
        localStorage.setItem('inventory_parts_cache', JSON.stringify({
          data: updatedParts,
          timestamp: Date.now()
        }));
      }

      const commitPromise = batch.commit();
      
      const result = await Promise.race([
        commitPromise,
        new Promise(resolve => setTimeout(() => resolve('offline_timeout'), 2500))
      ]);

      if (result === 'offline_timeout') {
        showToast('Dados salvos localmente (Offline).', 'info');
      } else {
        showToast(editingPart ? 'Peça atualizada com sucesso!' : 'Peça cadastrada com sucesso!');
        // Refresh full data in background to ensure history and consistency
        fetchData(true);
      }

      // Check for low stock notification
      if (formData.quantity <= formData.minQuantity) {
        const notificationTitle = `⚠️ ESTOQUE BAIXO`;
        const notificationBody = `Peça: ${formData.name}\nQtd: ${formData.quantity} ${formData.unit}`;
        
        sendLocalNotification(notificationTitle, notificationBody, true);

        sendWhatsAppNotification(
          `⚠️ *ALERTA DE ESTOQUE BAIXO*\n\n` +
          `*Peça:* ${formData.name}\n` +
          `*Qtd Atual:* ${formData.quantity} ${formData.unit}\n` +
          `*Qtd Mínima:* ${formData.minQuantity} ${formData.unit}\n` +
          `*Status:* Reposição Necessária`
        );
      }

      closeModal();
    } catch (error) {
      console.error('Error in inventory submit:', error);
      showToast('Erro ao processar operação.', 'error');
    }
  };

  const handleDelete = async () => {
    if (!partToDelete) return;
    const part = parts.find(p => p.id === partToDelete);
    if (!part) return;

    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'parts_inventory', partToDelete));
      
      logHistory(
        batch,
        partToDelete,
        part.name,
        'deletion',
        -part.quantity,
        0,
        'Exclusão de item'
      );
      
      const commitPromise = batch.commit();
      
      const result = await Promise.race([
        commitPromise,
        new Promise(resolve => setTimeout(() => resolve('offline_timeout'), 2500))
      ]);

      // Update local state immediately
      const updatedParts = parts.filter(p => p.id !== partToDelete);
      setParts(updatedParts);
      localStorage.setItem('inventory_parts_cache', JSON.stringify({
        data: updatedParts,
        timestamp: Date.now()
      }));

      if (result === 'offline_timeout') {
        showToast('Exclusão registrada localmente (Offline).', 'info');
      } else {
        showToast('Peça excluída com sucesso!');
        fetchData(true);
      }
      
      setPartToDelete(null);
    } catch (error) {
      console.error('Error deleting part:', error);
      showToast('Erro ao excluir peça.', 'error');
    }
  };

  const adjustQuantity = async (part: InventoryPart, amount: number) => {
    const newQty = part.quantity + amount;
    if (newQty < 0) return;

    try {
      const batch = writeBatch(db);
      const partRef = doc(db, 'parts_inventory', part.id);
      
      batch.update(partRef, {
        quantity: newQty,
        lastUpdated: new Date().toISOString()
      });

      logHistory(
        batch,
        part.id,
        part.name,
        amount > 0 ? 'addition' : 'deduction',
        amount,
        newQty,
        'Ajuste rápido'
      );

      // Update local state immediately
      const updatedParts = parts.map(p => p.id === part.id ? { ...p, quantity: newQty, lastUpdated: new Date().toISOString() } : p);
      setParts(updatedParts);
      localStorage.setItem('inventory_parts_cache', JSON.stringify({
        data: updatedParts,
        timestamp: Date.now()
      }));

      const commitPromise = batch.commit();
      
      // For quick adjustments, we don't even need to wait much
      await Promise.race([
        commitPromise,
        new Promise(resolve => setTimeout(resolve, 1000))
      ]);
      
      // Background refresh for history
      if (isHistoryOpen) fetchData(true);
    } catch (error) {
      console.error('Error adjusting quantity:', error);
    }
  };

  const openModal = (part?: InventoryPart) => {
    if (part) {
      setEditingPart(part);
      setFormData({
        name: part.name,
        description: part.description || '',
        quantity: part.quantity,
        minQuantity: part.minQuantity,
        unit: part.unit,
        reason: ''
      });
    } else {
      setEditingPart(null);
      setFormData({
        name: '',
        description: '',
        quantity: 0,
        minQuantity: 0,
        unit: 'un',
        reason: ''
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPart(null);
  };

  const filteredParts = parts.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={handleRefresh}
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
            <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">Estoque de Peças</h1>
            <p className="text-slate-500 font-medium">Gerenciamento de componentes para manutenção</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center justify-center gap-2 bg-white text-slate-600 border border-slate-200 px-6 py-3 rounded-2xl font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm active:scale-95"
          >
            <History className="w-5 h-5" />
            Histórico
          </button>
          <button
            onClick={() => openModal()}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 active:scale-95"
          >
            <Plus className="w-5 h-5" />
            Nova Peça
          </button>
        </div>
      </header>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total de Itens</p>
          <p className="text-3xl font-black text-slate-900">{parts.length}</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Estoque Baixo</p>
          <p className="text-3xl font-black text-amber-500">
            {parts.filter(p => p.quantity <= p.minQuantity).length}
          </p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Sem Estoque</p>
          <p className="text-3xl font-black text-red-500">
            {parts.filter(p => p.quantity === 0).length}
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Buscar peça por nome ou descrição..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all shadow-sm"
        />
      </div>

      {/* Parts Table (Desktop) */}
      <div className="hidden md:block bg-white rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Peça</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Quantidade</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Mínimo</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  </td>
                </tr>
              ) : filteredParts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center text-slate-400 font-medium italic">
                    Nenhuma peça encontrada.
                  </td>
                </tr>
              ) : (
                filteredParts.map((part) => (
                  <tr key={part.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                          <Package className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{part.name}</p>
                          <p className="text-xs text-slate-500 line-clamp-1">{part.description || 'Sem descrição'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => adjustQuantity(part, -1)}
                          className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-red-600 transition-colors"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <span className={cn(
                          "font-mono font-bold text-lg",
                          part.quantity === 0 ? "text-red-600" : 
                          part.quantity <= part.minQuantity ? "text-amber-600" : "text-slate-900"
                        )}>
                          {part.quantity} {part.unit}
                        </span>
                        <button 
                          onClick={() => adjustQuantity(part, 1)}
                          className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-green-600 transition-colors"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                    <td className="px-8 py-5 font-mono text-slate-500 font-bold">
                      {part.minQuantity} {part.unit}
                    </td>
                    <td className="px-8 py-5">
                      {part.quantity === 0 ? (
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-red-600 bg-red-50 px-2 py-1 rounded-lg uppercase tracking-widest">
                          <AlertCircle className="w-3 h-3" />
                          Esgotado
                        </span>
                      ) : part.quantity <= part.minQuantity ? (
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-lg uppercase tracking-widest">
                          <AlertCircle className="w-3 h-3" />
                          Baixo
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-lg uppercase tracking-widest">
                          <Check className="w-3 h-3" />
                          Ok
                        </span>
                      )}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => openModal(part)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {isManager && (
                          <button 
                            onClick={() => setPartToDelete(part.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Parts Cards (Mobile) */}
      <div className="md:hidden space-y-4">
        {loading ? (
          <div className="bg-white p-20 rounded-3xl border border-slate-200 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          </div>
        ) : filteredParts.length === 0 ? (
          <div className="bg-white p-20 rounded-3xl border border-slate-200 text-center text-slate-400 font-medium italic">
            Nenhuma peça encontrada.
          </div>
        ) : (
          filteredParts.map((part) => (
            <div key={part.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                    <Package className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">{part.name}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{part.unit}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button 
                    onClick={() => openModal(part)}
                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  {isManager && (
                    <button 
                      onClick={() => setPartToDelete(part.id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 py-4 border-y border-slate-50">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Quantidade</p>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => adjustQuantity(part, -1)}
                      className="p-1 rounded-lg bg-slate-50 text-slate-400"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <span className={cn(
                      "font-mono font-bold text-lg",
                      part.quantity === 0 ? "text-red-600" : 
                      part.quantity <= part.minQuantity ? "text-amber-600" : "text-slate-900"
                    )}>
                      {part.quantity}
                    </span>
                    <button 
                      onClick={() => adjustQuantity(part, 1)}
                      className="p-1 rounded-lg bg-slate-50 text-slate-400"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Mínimo</p>
                  <p className="font-mono text-slate-500 font-bold text-lg">{part.minQuantity}</p>
                </div>
              </div>

              <div className="flex justify-between items-center">
                {part.quantity === 0 ? (
                  <span className="flex items-center gap-1.5 text-[10px] font-black text-red-600 bg-red-50 px-2 py-1 rounded-lg uppercase tracking-widest">
                    <AlertCircle className="w-3 h-3" />
                    Esgotado
                  </span>
                ) : part.quantity <= part.minQuantity ? (
                  <span className="flex items-center gap-1.5 text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-lg uppercase tracking-widest">
                    <AlertCircle className="w-3 h-3" />
                    Baixo
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[10px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-lg uppercase tracking-widest">
                    <Check className="w-3 h-3" />
                    Ok
                  </span>
                )}
                <p className="text-[10px] text-slate-400 italic truncate max-w-[150px]">{part.description || 'Sem descrição'}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">
                  {editingPart ? 'Editar Peça' : 'Cadastrar Nova Peça'}
                </h2>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Informações do Estoque</p>
              </div>
              <button onClick={closeModal} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Nome da Peça *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    placeholder="Ex: Filtro de Óleo"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Descrição</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all min-h-[100px]"
                    placeholder="Detalhes técnicos ou aplicação..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Qtd Inicial</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={formData.quantity}
                      onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Qtd Mínima</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={formData.minQuantity}
                      onChange={(e) => setFormData({ ...formData, minQuantity: Number(e.target.value) })}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Unidade de Medida</label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                  >
                    <option value="un">Unidade (un)</option>
                    <option value="kg">Quilograma (kg)</option>
                    <option value="l">Litro (l)</option>
                    <option value="m">Metro (m)</option>
                    <option value="par">Par</option>
                    <option value="conj">Conjunto</option>
                  </select>
                </div>
                {editingPart && editingPart.quantity !== formData.quantity && (
                  <div className="animate-in slide-in-from-top-2 duration-300">
                    <label className="block text-[10px] font-black text-amber-500 uppercase tracking-widest mb-2">Motivo da Alteração de Quantidade</label>
                    <input
                      type="text"
                      required
                      value={formData.reason}
                      onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                      className="w-full p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 outline-none transition-all"
                      placeholder="Ex: Correção de inventário, Entrada de NF..."
                    />
                  </div>
                )}
              </div>

              <div className="pt-4 flex gap-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-4 rounded-2xl font-black uppercase tracking-widest text-sm text-slate-400 border border-slate-200 hover:bg-slate-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-blue-700 shadow-xl shadow-blue-200 transition-all active:scale-95"
                >
                  {editingPart ? 'Salvar Alterações' : 'Cadastrar Peça'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {partToDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden p-8 text-center space-y-6 animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Excluir Peça?</h3>
              <p className="text-slate-500 mt-2 font-medium">Esta ação não pode ser desfeita. A peça será removida permanentemente do estoque.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPartToDelete(null)}
                className="flex-1 py-4 rounded-2xl font-black uppercase tracking-widest text-xs text-slate-400 border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-red-700 shadow-xl shadow-red-200 transition-all active:scale-95"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-4xl h-[80vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                  <History className="w-6 h-6 text-blue-600" />
                  Histórico de Movimentações
                </h2>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Rastreabilidade total do estoque</p>
              </div>
              <button onClick={() => setIsHistoryOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            <div className="p-4 border-b border-slate-100 bg-white flex items-center gap-4">
              <div className="flex-1 relative">
                <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <select
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none appearance-none cursor-pointer"
                >
                  <option value="all">Todas as Peças</option>
                  {parts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30">
              {history
                .filter(h => historyFilter === 'all' || h.partId === historyFilter)
                .map((h) => (
                <div key={h.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-blue-200 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center",
                      h.type === 'addition' || h.type === 'creation' ? "bg-green-50 text-green-600" :
                      h.type === 'deduction' || h.type === 'deletion' ? "bg-red-50 text-red-600" :
                      "bg-blue-50 text-blue-600"
                    )}>
                      {h.type === 'addition' || h.type === 'creation' ? <ArrowUp className="w-6 h-6" /> :
                       h.type === 'deduction' || h.type === 'deletion' ? <ArrowDown className="w-6 h-6" /> :
                       <Edit2 className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-black text-slate-900">{h.partName}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          <Calendar className="w-3 h-3" />
                          {new Date(h.timestamp).toLocaleString('pt-BR')}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          <UserIcon className="w-3 h-3" />
                          {h.userName}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-sm font-black px-2 py-1 rounded-lg",
                        h.quantityChange > 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                      )}>
                        {h.quantityChange > 0 ? '+' : ''}{h.quantityChange}
                      </span>
                      <span className="text-xs font-bold text-slate-400">→</span>
                      <span className="text-sm font-black text-slate-900 bg-slate-100 px-2 py-1 rounded-lg">
                        {h.newQuantity}
                      </span>
                    </div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{h.reason}</p>
                  </div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 py-20">
                  <History className="w-12 h-12 mb-4 opacity-20" />
                  <p className="font-bold">Nenhum histórico registrado.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
