import React, { useState, useEffect, createContext, useContext } from 'react';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged, 
  signOut, 
  User 
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from './ToastContext';
import { UserProfile, UserRole } from '../types';
import { LogIn, Loader2, User as UserIcon, Lock, UserPlus } from 'lucide-react';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  quotaExceeded: boolean;
  setQuotaExceeded: (value: boolean) => void;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string, role: UserRole) => Promise<void>;
  updateUserPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const handleQuotaError = (err: any) => {
    if (err?.code === 'resource-exhausted' || err?.message?.includes('Quota exceeded')) {
      console.warn("Firestore Quota Exceeded. Using cache where possible.");
      setQuotaExceeded(true);
      // Auto-reset after 10 minutes to allow trying again
      setTimeout(() => setQuotaExceeded(false), 10 * 60 * 1000);
    }
  };

  useEffect(() => {
    const authUnsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      
      if (u) {
        const cacheKey = `profile_${u.uid}`;
        const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos
        
        // 1. Tentar carregar do Cache Local (LocalStorage)
        const cached = localStorage.getItem(cacheKey);
        let validCache = false;

        if (cached) {
          try {
            const { data, timestamp } = JSON.parse(cached);
            const now = Date.now();
            
            // Validar expiração
            if (now - timestamp < CACHE_DURATION) {
              setProfile(data);
              setLoading(false);
              validCache = true;
              console.log("Perfil carregado do cache (Válido - 0 leituras Firestore)");
            }
          } catch (e) {
            localStorage.removeItem(cacheKey);
          }
        }

        // 2. Se não houver cache válido, buscar do Firestore
        if (!validCache) {
          try {
            const docRef = doc(db, 'users', u.uid);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
              const profileData = docSnap.data() as UserProfile;
              setProfile(profileData);
              // Salvar no Cache com Timestamp
              localStorage.setItem(cacheKey, JSON.stringify({
                data: profileData,
                timestamp: Date.now()
              }));
              console.log("Perfil carregado do Firestore (Cache expirado ou inexistente)");
            } else {
              console.warn("Perfil não encontrado no Firestore para UID:", u.uid);
              setProfile(null);
            }
          } catch (err: any) {
            handleQuotaError(err);
            console.error("Erro ao buscar perfil do Firestore:", err);
          } finally {
            setLoading(false);
          }
        }
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      authUnsubscribe();
    };
  }, []);

  const login = async (username: string, password: string) => {
    const sanitizedUsername = username.trim().toLowerCase().replace(/\s+/g, '.');
    const email = sanitizedUsername.includes('@') ? sanitizedUsername : `${sanitizedUsername}@manutemp.local`;
    await signInWithEmailAndPassword(auth, email, password);
    showToast('Bem-vindo ao Manutemp!');
  };

  const register = async (username: string, password: string, displayName: string, role: UserRole) => {
    const sanitizedUsername = username.trim().toLowerCase().replace(/\s+/g, '.');
    const email = `${sanitizedUsername}@manutemp.local`;
    const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password);
    
    const newProfile: UserProfile = {
      uid: newUser.uid,
      email: email,
      displayName: displayName,
      role: role,
      createdAt: new Date().toISOString()
    };
    
    await setDoc(doc(db, 'users', newUser.uid), newProfile);
    setProfile(newProfile);
    localStorage.setItem(`profile_${newUser.uid}`, JSON.stringify({
      data: newProfile,
      timestamp: Date.now()
    }));
    showToast('Conta criada com sucesso!');
  };

  const updateUserPassword = async (currentPassword: string, newPassword: string) => {
    if (!user) throw new Error('Usuário não autenticado');
    if (newPassword.length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
    
    try {
      const credential = EmailAuthProvider.credential(user.email!, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      showToast('Senha alterada com sucesso!');
    } catch (err: any) {
      if (err.code === 'auth/wrong-password') {
        throw new Error('Senha atual incorreta.');
      }
      throw err;
    }
  };

  const logout = async () => {
    if (user) {
      localStorage.removeItem(`profile_${user.uid}`);
    }
    await signOut(auth);
    setProfile(null);
    showToast('Sessão encerrada.');
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, quotaExceeded, setQuotaExceeded, login, register, updateUserPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function LoginScreen() {
  const { login, register, loading } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      if (isRegistering) {
        await register(username, password, displayName, role);
      } else {
        await login(username, password);
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(err.message || 'Ocorreu um erro ao processar sua solicitação.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg rotate-3">
            <LogIn className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Manutemp</h1>
          <p className="text-slate-500 text-sm mt-1">Sistema de Manutenção</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs font-medium border border-red-100">
              {error}
            </div>
          )}

          {message && (
            <div className="bg-green-50 text-green-600 p-3 rounded-lg text-xs font-medium border border-green-100">
              {message}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Nome de Usuário</label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="ex: joao.silva"
                required
              />
            </div>
          </div>

          {isRegistering && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Nome Completo</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  placeholder="Nome do funcionário"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Função</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                >
                  <option value="operator">Operador</option>
                  <option value="leader">Líder de Pátio</option>
                  <option value="mechanic">Mecânico</option>
                  <option value="manager">Gestor</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Senha</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              isRegistering ? <><UserPlus className="w-5 h-5" /> Criar Conta</> : <><LogIn className="w-5 h-5" /> Entrar</>
            )}
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <button
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError('');
            }}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {isRegistering ? 'Já tem uma conta? Entre aqui' : 'Não tem conta? Registre-se'}
          </button>
        </div>
      </div>
    </div>
  );
}

