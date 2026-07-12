import React from 'react';
import { NotificationLog } from '../types';
import { Bell, X, Info, PhoneCall, Clock, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NotificationCenterProps {
  notifications: NotificationLog[];
  onDismiss: (id: string) => void;
  onClearAll: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  onDismiss,
  onClearAll,
}) => {
  const getIcon = (type: string) => {
    switch (type) {
      case 'daily_reminder':
        return <CheckCircle2 className="w-5 h-5 text-brand-primary" />;
      case '15_min_before':
        return <Clock className="w-5 h-5 text-brand-tertiary" />;
      case 'incoming_call':
        return <PhoneCall className="w-5 h-5 text-brand-secondary animate-pulse" />;
      default:
        return <Info className="w-5 h-5 text-brand-text" />;
    }
  };

  const getBgColor = (type: string) => {
    switch (type) {
      case 'daily_reminder':
        return 'border-brand-primary/20 bg-brand-primary/5';
      case '15_min_before':
        return 'border-brand-tertiary/20 bg-brand-tertiary/5';
      case 'incoming_call':
        return 'border-brand-secondary/20 bg-brand-secondary/5';
      default:
        return 'border-brand-outline bg-brand-surface-high';
    }
  };

  return (
    <div className="flex flex-col h-full bg-brand-surface border border-brand-outline rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-brand-surface-low border-b border-brand-outline">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Bell className="w-5 h-5 text-brand-text" />
            {notifications.some(n => !n.read) && (
              <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-brand-secondary rounded-full border border-brand-surface" />
            )}
          </div>
          <h3 className="font-sans font-bold text-sm tracking-wide text-brand-text">
            NOTIFICACIONES PUSH
          </h3>
        </div>
        {notifications.length > 0 && (
          <button
            onClick={onClearAll}
            className="text-xs text-brand-muted hover:text-brand-primary transition-colors cursor-pointer"
          >
            Limpiar todo
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 max-h-[350px] md:max-h-none">
        <AnimatePresence initial={false}>
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="w-10 h-10 text-brand-outline mb-2" />
              <p className="text-sm text-brand-muted font-sans">No hay notificaciones recientes</p>
              <p className="text-xs text-brand-muted/60 mt-1">Usa los simuladores para activar alertas</p>
            </div>
          ) : (
            notifications.map((notif) => (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 15, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 50, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={`flex gap-3 p-3 border rounded-lg relative overflow-hidden transition-all group ${getBgColor(notif.type)}`}
              >
                <div className="mt-0.5 shrink-0">{getIcon(notif.type)}</div>
                
                <div className="flex-1 pr-4">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-sans font-semibold text-xs text-brand-text">
                      {notif.title}
                    </span>
                    <span className="text-[10px] text-brand-muted font-mono">
                      {notif.timestamp}
                    </span>
                  </div>
                  <p className="text-xs text-brand-muted leading-relaxed">
                    {notif.message}
                  </p>
                </div>

                <button
                  onClick={() => onDismiss(notif.id)}
                  className="absolute top-2 right-2 text-brand-muted/50 hover:text-brand-secondary transition-colors cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
