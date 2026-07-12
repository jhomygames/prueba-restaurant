import React, { useState } from 'react';
import { Reservation, Table } from '../types';
import { Calendar, Search, Users, Clock, AlertCircle, Edit, Trash2, CheckCircle2, UserCheck, HelpCircle } from 'lucide-react';

interface CalendarViewProps {
  reservations: Reservation[];
  tables: Table[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onEditReservation: (res: Reservation) => void;
  onCancelReservation: (id: string) => void;
  onSeatedReservation: (id: string) => void;
  onCompleteReservation: (id: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  reservations,
  tables,
  selectedDate,
  onSelectDate,
  onEditReservation,
  onCancelReservation,
  onSeatedReservation,
  onCompleteReservation,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Helper to find table name
  const getTableName = (tableId: string) => {
    const table = tables.find(t => t.id === tableId);
    return table ? table.name : 'Sin asignar';
  };

  // Generate a list of 7 days starting from today for quick selection
  const getQuickDaysList = () => {
    const list = [];
    const today = new Date();
    for (let i = -2; i < 5; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const yyyymmdd = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('es-ES', { weekday: 'short' });
      const dayNum = d.getDate();
      list.push({ yyyymmdd, dayName, dayNum });
    }
    return list;
  };

  const quickDays = getQuickDaysList();

  // Filter reservations based on date and search query
  const filteredReservations = reservations.filter((r) => {
    const matchesDate = r.date === selectedDate;
    const matchesSearch = 
      r.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.customerPhone.includes(searchQuery);
    return matchesDate && matchesSearch;
  });

  // Calculate quick stats for selected date
  const totalGuests = filteredReservations
    .filter(r => r.status !== 'cancelled')
    .reduce((sum, r) => sum + r.pax, 0);

  const pendingCount = filteredReservations.filter(r => r.status === 'pending' || r.status === 'confirmed').length;
  const seatedCount = filteredReservations.filter(r => r.status === 'seated').length;
  const completedCount = filteredReservations.filter(r => r.status === 'completed').length;

  return (
    <div className="bg-brand-surface border border-brand-outline rounded-2xl overflow-hidden shadow-xl flex flex-col h-full">
      {/* Search & Date Controls Header */}
      <div className="p-4 bg-brand-surface-low border-b border-brand-outline space-y-4">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-sans font-bold text-base text-brand-text flex items-center gap-2">
              <Calendar className="w-5 h-5 text-brand-primary" />
              Agenda de Reservas
            </h3>
            <p className="text-xs text-brand-muted">Monitorea y edita la afluencia de comensales del día.</p>
          </div>

          {/* Quick Search */}
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="absolute top-2.5 left-3 w-4 h-4 text-brand-muted" />
            <input
              type="text"
              placeholder="Buscar por cliente o tlf..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-brand-surface border border-brand-outline rounded-lg pl-9 pr-3 py-2 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
            />
          </div>
        </div>

        {/* Quick Date Carousel */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {quickDays.map((day) => {
            const isSelected = day.yyyymmdd === selectedDate;
            const hasReservations = reservations.some(r => r.date === day.yyyymmdd && r.status !== 'cancelled');

            return (
              <button
                key={day.yyyymmdd}
                onClick={() => onSelectDate(day.yyyymmdd)}
                className={`flex flex-col items-center p-2 rounded-lg border min-w-[55px] cursor-pointer transition-all relative ${
                  isSelected
                    ? 'bg-brand-primary/10 border-brand-primary text-brand-primary'
                    : 'bg-brand-surface border-brand-outline text-brand-muted hover:border-brand-muted/40'
                }`}
              >
                <span className="text-[9px] uppercase font-mono font-bold leading-none">{day.dayName}</span>
                <span className="text-sm font-sans font-bold mt-1 leading-none">{day.dayNum}</span>
                {hasReservations && !isSelected && (
                  <span className="absolute bottom-1 w-1.5 h-1.5 bg-brand-tertiary rounded-full" />
                )}
              </button>
            );
          })}

          {/* Custom Date Selector */}
          <div className="ml-auto flex items-center gap-2 pl-3 border-l border-brand-outline shrink-0">
            <span className="text-xs font-mono text-brand-muted">Salto:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onSelectDate(e.target.value)}
              className="bg-brand-surface border border-brand-outline rounded px-2.5 py-1.5 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Date Overview Stats */}
      <div className="grid grid-cols-4 border-b border-brand-outline bg-brand-surface-low/50 text-center py-2.5">
        <div>
          <span className="text-[9px] uppercase font-mono text-brand-muted block">Cubiertos Totales</span>
          <strong className="text-brand-text text-sm font-mono flex items-center justify-center gap-1 mt-0.5">
            <Users className="w-3.5 h-3.5 text-brand-primary" />
            {totalGuests}
          </strong>
        </div>
        <div>
          <span className="text-[9px] uppercase font-mono text-brand-muted block">Pendientes</span>
          <strong className="text-brand-tertiary text-sm font-mono block mt-0.5">
            {pendingCount}
          </strong>
        </div>
        <div>
          <span className="text-[9px] uppercase font-mono text-brand-muted block">Sentados</span>
          <strong className="text-brand-secondary text-sm font-mono block mt-0.5">
            {seatedCount}
          </strong>
        </div>
        <div>
          <span className="text-[9px] uppercase font-mono text-brand-muted block">Completados</span>
          <strong className="text-brand-primary text-sm font-mono block mt-0.5">
            {completedCount}
          </strong>
        </div>
      </div>

      {/* Reservation Rows List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[400px] md:max-h-none">
        {filteredReservations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-brand-muted">
            <AlertCircle className="w-10 h-10 text-brand-outline mb-2" />
            <p className="text-sm font-sans font-medium">No se encontraron reservas</p>
            <p className="text-xs text-brand-muted/60 mt-1">
              Para {new Date(selectedDate).toLocaleDateString('es-ES', { month: 'long', day: 'numeric' })}.
            </p>
          </div>
        ) : (
          filteredReservations.map((res) => {
            const hasAllergies = res.allergies && res.allergies.length > 0;
            const tableName = getTableName(res.tableId);

            return (
              <div
                key={res.id}
                className={`p-3.5 border rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all relative overflow-hidden group ${
                  res.status === 'completed'
                    ? 'border-brand-outline bg-brand-surface-high/30 opacity-70'
                    : res.status === 'seated'
                    ? 'border-brand-secondary/30 bg-brand-secondary/5'
                    : 'border-brand-outline bg-brand-surface-high hover:border-brand-muted/30'
                }`}
              >
                {/* Left: Client name & notes */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-sans font-bold text-sm text-brand-text">
                      {res.customerName}
                    </span>
                    <span className="text-[10px] font-mono text-brand-muted">
                      {res.customerPhone}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-brand-muted">
                    <span className="flex items-center gap-1 font-mono text-brand-primary">
                      <Clock className="w-3.5 h-3.5" />
                      {res.time}
                    </span>
                    <span className="flex items-center gap-1 font-mono text-brand-text font-semibold">
                      <Users className="w-3.5 h-3.5 text-brand-primary" />
                      {res.pax} Comensales
                    </span>
                    <span className="text-[10px] font-mono bg-brand-surface-low border border-brand-outline px-1.5 py-0.5 rounded text-brand-text">
                      Mesa: <strong className="text-brand-primary">{tableName}</strong>
                    </span>
                    
                    {/* Status Badge */}
                    <span className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded font-bold ${
                      res.status === 'completed'
                        ? 'bg-brand-outline text-brand-muted'
                        : res.status === 'seated'
                        ? 'bg-brand-secondary/15 text-brand-secondary border border-brand-secondary/30'
                        : 'bg-brand-tertiary/15 text-brand-tertiary border border-brand-tertiary/30'
                    }`}>
                      {res.status === 'completed' ? 'Completado' : res.status === 'seated' ? 'Sentado' : 'Confirmado'}
                    </span>
                  </div>

                  {/* Notes / Allergies row */}
                  {(res.notes || hasAllergies) && (
                    <div className="pt-1.5 border-t border-brand-outline/40 space-y-1">
                      {res.notes && (
                        <p className="text-xs text-brand-muted italic leading-relaxed">
                          "{res.notes}"
                        </p>
                      )}
                      {hasAllergies && (
                        <div className="flex flex-wrap gap-1">
                          {res.allergies.map(a => (
                            <span key={a} className="bg-brand-secondary/10 border border-brand-secondary/20 text-brand-secondary px-1.5 py-0.5 rounded text-[8px] font-mono uppercase font-bold">
                              {a}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: Quick actions panel */}
                <div className="flex items-center gap-2 sm:self-center">
                  
                  {/* Mark Seated */}
                  {res.status === 'confirmed' && (
                    <button
                      onClick={() => onSeatedReservation(res.id)}
                      title="Sentar cliente"
                      className="flex items-center justify-center p-2 bg-brand-secondary/10 hover:bg-brand-secondary/20 border border-brand-secondary/30 text-brand-secondary rounded-lg cursor-pointer transition-colors"
                    >
                      <UserCheck className="w-4 h-4" />
                    </button>
                  )}

                  {/* Mark Completed */}
                  {res.status === 'seated' && (
                    <button
                      onClick={() => onCompleteReservation(res.id)}
                      title="Finalizar servicio (Liberar mesa)"
                      className="flex items-center justify-center p-2 bg-brand-primary/10 hover:bg-brand-primary/20 border border-brand-primary/30 text-brand-primary rounded-lg cursor-pointer transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  )}

                  {/* Edit */}
                  <button
                    onClick={() => onEditReservation(res)}
                    title="Editar reserva"
                    className="flex items-center justify-center p-2 bg-brand-surface-high hover:bg-brand-surface-highest border border-brand-outline hover:border-brand-muted/40 text-brand-text rounded-lg cursor-pointer transition-all"
                  >
                    <Edit className="w-4 h-4" />
                  </button>

                  {/* Delete */}
                  {res.status !== 'completed' && (
                    <button
                      onClick={() => {
                        if (confirm('¿Estás seguro de cancelar esta reserva?')) {
                          onCancelReservation(res.id);
                        }
                      }}
                      title="Cancelar reserva"
                      className="flex items-center justify-center p-2 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 text-red-400 rounded-lg cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}

                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
