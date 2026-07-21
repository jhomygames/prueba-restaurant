import React, { useState } from 'react';
import { UtensilsCrossed, Mail, Lock, LogIn, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import * as api from '../api';
import { Session } from '../api';

interface LoginViewProps {
  onLogin: (session: Session) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const session = await api.login(email.trim(), password);
      onLogin(session);
    } catch (err: any) {
      setError(err.message || 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Marca */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-brand-primary text-brand-surface rounded-2xl flex items-center justify-center shadow-lg shadow-brand-primary/20 mb-3">
            <UtensilsCrossed className="w-7 h-7" />
          </div>
          <h1 className="font-sans font-bold text-xl tracking-tight">DineControl AI</h1>
          <p className="text-xs text-brand-muted mt-1">Panel de reservas y recepción</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-brand-surface border border-brand-outline rounded-2xl p-6 space-y-4 shadow-xl"
        >
          <div>
            <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute top-2.5 left-3 w-4 h-4 text-brand-muted" />
              <input
                type="email"
                required
                autoFocus
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@restaurante.com"
                className="w-full bg-brand-surface-low border border-brand-outline rounded-lg pl-9 pr-3 py-2.5 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="absolute top-2.5 left-3 w-4 h-4 text-brand-muted" />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-brand-surface-low border border-brand-outline rounded-lg pl-9 pr-3 py-2.5 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 text-red-300 rounded-lg p-2.5 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-primary text-brand-surface font-sans font-bold text-xs rounded-xl hover:bg-brand-primary/90 disabled:opacity-60 transition-colors cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            {loading ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="text-[10px] text-brand-muted/70 text-center leading-relaxed pt-1">
            Cada restaurante tiene su propio acceso. Si no recuerdas tu contraseña,
            pídele al administrador que te la restablezca.
          </p>
        </form>
      </motion.div>
    </div>
  );
};
