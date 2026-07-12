import React, { useState, useEffect } from 'react';
import { Table, Reservation } from '../types';
import { ALLERGIES_OPTIONS, AUTO_CONFIRM_TEMPLATES } from '../data';
import { X, Calendar, Clock, User, Phone, Users, FileText, Check, AlertTriangle, MessageSquare, Send, BellRing, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: Table | null;
  activeReservation: Reservation | null;
  onSaveReservation: (reservation: Omit<Reservation, 'id' | 'createdAt'> & { id?: string }) => void;
  onCancelReservation: (id: string) => void;
  onSeatedReservation: (id: string) => void;
  onCompleteReservation: (id: string) => void;
}

export const ReservationModal: React.FC<ReservationModalProps> = ({
  isOpen,
  onClose,
  table,
  activeReservation,
  onSaveReservation,
  onCancelReservation,
  onSeatedReservation,
  onCompleteReservation,
}) => {
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [time, setTime] = useState<string>('');
  const [pax, setPax] = useState<number>(2);
  const [notes, setNotes] = useState<string>('');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [autoConfirmMessage, setAutoConfirmMessage] = useState<boolean>(true);
  const [customDurationMinutes, setCustomDurationMinutes] = useState<number>(120);
  
  // Custom states for message simulator
  const [showMsgSimulator, setShowMsgSimulator] = useState<boolean>(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('whatsapp_standard');
  const [simulatedSendSuccess, setSimulatedSendSuccess] = useState<boolean>(false);

  // Load/reset form based on active reservation
  useEffect(() => {
    if (isOpen) {
      setShowMsgSimulator(false);
      setSimulatedSendSuccess(false);
      
      if (activeReservation) {
        setCustomerName(activeReservation.customerName);
        setCustomerPhone(activeReservation.customerPhone);
        setDate(activeReservation.date);
        setTime(activeReservation.time);
        setPax(activeReservation.pax);
        setNotes(activeReservation.notes);
        setAllergies(activeReservation.allergies);
        setAutoConfirmMessage(activeReservation.autoConfirmMessage);
        setCustomDurationMinutes(activeReservation.customDurationMinutes || 120);
      } else {
        // Create new reservation defaults
        setCustomerName('');
        setCustomerPhone('');
        setDate(new Date().toISOString().split('T')[0]); // Default today
        setTime('20:30'); // Default dinner peak
        setPax(table ? table.seats : 4);
        setNotes('');
        setAllergies([]);
        setAutoConfirmMessage(true);
        const savedDefault = localStorage.getItem('dinecontrol_default_seated_duration');
        setCustomDurationMinutes(savedDefault ? JSON.parse(savedDefault) : 120);
      }
    }
  }, [isOpen, activeReservation, table]);

  // Sin mesa solo tiene sentido si estamos editando una reserva existente
  // (p. ej. una reserva del calendario cuya mesa fue eliminada del plano).
  if (!isOpen || (!table && !activeReservation)) return null;

  const handleQuickSeating = () => {
    if (!table) return;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
    
    onSaveReservation({
      customerName: 'Cliente de Paso',
      customerPhone: '+56 9 1234 5678',
      date: todayStr,
      time: timeStr,
      pax: table.seats, // Default to table capacity
      tableId: table.id,
      status: 'seated',
      seatedAt: now.toISOString(),
      notes: 'Ocupación rápida sin reserva previa',
      allergies: [],
      autoConfirmMessage: false,
      customDurationMinutes: customDurationMinutes
    });
    
    onClose();
  };

  const toggleAllergy = (allergy: string) => {
    setAllergies(prev =>
      prev.includes(allergy) ? prev.filter(a => a !== allergy) : [...prev, allergy]
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) return;

    onSaveReservation({
      ...(activeReservation ? { id: activeReservation.id, seatedAt: activeReservation.seatedAt } : {}),
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || '+56 9 1234 5678',
      date,
      time,
      pax,
      tableId: table ? table.id : (activeReservation?.tableId ?? ''),
      status: activeReservation ? activeReservation.status : 'confirmed',
      notes: notes.trim(),
      allergies,
      autoConfirmMessage,
      customDurationMinutes
    });

    onClose();
  };

  // Compile WhatsApp template string with live variables
  const getCompiledMessageText = () => {
    const template = AUTO_CONFIRM_TEMPLATES.find(t => t.id === selectedTemplate)?.text || '';
    const formattedDate = new Date(date).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return template
      .replace('{{NAME}}', customerName || '[Cliente]')
      .replace('{{DATE}}', formattedDate)
      .replace('{{TIME}}', time)
      .replace('{{PAX}}', pax.toString());
  };

  // Simulate Sending SMS/WhatsApp confirm
  const handleSimulateSend = () => {
    setSimulatedSendSuccess(true);
    setTimeout(() => {
      setSimulatedSendSuccess(false);
      setShowMsgSimulator(false);
    }, 2500);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="w-full max-w-4xl bg-brand-surface border border-brand-outline rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]"
        >
          
          {/* Main Booking Form */}
          <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 bg-brand-surface-low border-b border-brand-outline flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-2 py-0.5 bg-brand-primary/10 border border-brand-primary/30 text-brand-primary rounded font-bold">
                  {table ? table.name : 'Sin mesa asignada'}
                </span>
                <h3 className="font-sans font-bold text-sm text-brand-text">
                  {activeReservation ? 'Gestionar Reserva' : 'Nueva Reserva de Mesa'}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-brand-muted hover:text-brand-secondary transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable form body */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4">
              
              {/* Quick Walk-in Option */}
              {!activeReservation && table && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-sans font-bold text-emerald-300 flex items-center gap-1.5">
                      <Sparkles className="w-4.5 h-4.5 text-emerald-400 animate-pulse" />
                      Ocupación Express (Cliente de Paso)
                    </h4>
                    <p className="text-[10px] text-brand-muted">
                      ¿Llegaron de improviso? Ocupa la mesa de inmediato con datos genéricos sin rellenar el formulario.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleQuickSeating}
                    className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-brand-surface font-sans font-bold text-xs px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 transition-all cursor-pointer whitespace-nowrap"
                  >
                    ⚡ Ocupar Mesa Ya
                  </button>
                </div>
              )}

              {/* Warnings if pax exceeds table capacity */}
              {table && pax > table.seats && (
                <div className="flex items-start gap-2 bg-brand-tertiary/10 border border-brand-tertiary/30 p-2.5 rounded-lg text-xs text-brand-tertiary">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Capacidad excedida:</span> Esta mesa tiene un límite aconsejado de {table.seats} asientos. El comensal solicita {pax} personas. Asegúrate de añadir sillas adicionales.
                  </div>
                </div>
              )}

              {/* Customer Base Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Nombre del Cliente *</label>
                  <div className="relative">
                    <User className="absolute top-2.5 left-3 w-4 h-4 text-brand-muted" />
                    <input
                      type="text"
                      required
                      placeholder="ej. Alejandro Sanz"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full bg-brand-surface-low border border-brand-outline rounded-lg pl-9 pr-3 py-2 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Número de Teléfono</label>
                  <div className="relative">
                    <Phone className="absolute top-2.5 left-3 w-4 h-4 text-brand-muted" />
                    <input
                      type="tel"
                      placeholder="ej. +56 9 8274 1928"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full bg-brand-surface-low border border-brand-outline rounded-lg pl-9 pr-3 py-2 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Booking Details */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Fecha</label>
                  <div className="relative">
                    <Calendar className="absolute top-2.5 left-3 w-4 h-4 text-brand-muted pointer-events-none" />
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full bg-brand-surface-low border border-brand-outline rounded-lg pl-9 pr-2 py-2 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Hora</label>
                  <div className="relative">
                    <Clock className="absolute top-2.5 left-3 w-4 h-4 text-brand-muted pointer-events-none" />
                    <input
                      type="time"
                      required
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full bg-brand-surface-low border border-brand-outline rounded-lg pl-9 pr-2 py-2 text-xs text-brand-text font-mono focus:outline-none focus:border-brand-primary cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Personas (Pax)</label>
                  <div className="relative">
                    <Users className="absolute top-2.5 left-3 w-4 h-4 text-brand-muted pointer-events-none" />
                    <input
                      type="number"
                      required
                      min="1"
                      max="20"
                      value={pax}
                      onChange={(e) => setPax(Number(e.target.value))}
                      className="w-full bg-brand-surface-low border border-brand-outline rounded-lg pl-9 pr-2 py-2 text-xs text-brand-text font-mono focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Diet / Allergies Multi-Selection */}
              <div>
                <span className="text-[10px] uppercase font-mono text-brand-muted block mb-2">Preferencias Alimentarias / Alergias</span>
                <div className="flex flex-wrap gap-1.5">
                  {ALLERGIES_OPTIONS.map((allergy) => {
                    const isSelected = allergies.includes(allergy);
                    return (
                      <button
                        key={allergy}
                        type="button"
                        onClick={() => toggleAllergy(allergy)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-sans transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-brand-secondary/15 border-brand-secondary text-brand-secondary font-semibold'
                            : 'bg-brand-surface-low border-brand-outline text-brand-muted hover:border-brand-muted/40'
                        }`}
                      >
                        {allergy}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Additional Comments */}
              <div>
                <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Observaciones adicionales / Notas</label>
                <div className="relative">
                  <FileText className="absolute top-2.5 left-3 w-4 h-4 text-brand-muted" />
                  <textarea
                    rows={2}
                    placeholder="ej. Velada de aniversario, preparar copa de champagne de bienvenida..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-brand-surface-low border border-brand-outline rounded-lg pl-9 pr-3 py-2 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              {/* Push notifications & confirmation options */}
              <div className="flex items-center gap-2 pt-2 pb-1 border-b border-brand-outline/50">
                <input
                  type="checkbox"
                  id="auto_message_checkbox"
                  checked={autoConfirmMessage}
                  onChange={(e) => setAutoConfirmMessage(e.target.checked)}
                  className="w-4 h-4 accent-brand-primary cursor-pointer bg-brand-surface border-brand-outline rounded"
                />
                <label htmlFor="auto_message_checkbox" className="text-xs text-brand-text font-sans cursor-pointer">
                  Enviar recordatorios push automáticos (15m antes, mañana)
                </label>
              </div>

              {/* Customizable Table Occupied Duration Limit */}
              <div className="bg-brand-surface-low border border-brand-outline rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-brand-text font-sans font-bold text-[11px] uppercase tracking-wider">
                    <Clock className="w-4 h-4 text-brand-primary" />
                    Límite de Tiempo en Mesa
                  </div>
                  <div className="font-mono text-xs font-bold bg-brand-primary/10 text-brand-primary px-2 py-0.5 rounded border border-brand-primary/20">
                    {customDurationMinutes} min ({Math.floor(customDurationMinutes / 60)}h {customDurationMinutes % 60}m)
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[9px] text-brand-muted uppercase font-mono">
                    <span>Ajustar Duración del Comensal</span>
                    <span>15m - 240m</span>
                  </div>
                  <input
                    type="range"
                    min="15"
                    max="240"
                    step="15"
                    value={customDurationMinutes}
                    onChange={(e) => setCustomDurationMinutes(Number(e.target.value))}
                    className="w-full accent-brand-primary cursor-pointer h-1 bg-brand-surface rounded-lg border border-brand-outline"
                  />
                  
                  {/* Quick Preset Buttons */}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {[30, 60, 90, 120, 150, 180, 240].map((mins) => {
                      const isSelected = customDurationMinutes === mins;
                      let label = `${mins}m`;
                      if (mins === 60) label = "1h";
                      if (mins === 120) label = "2h (Estándar)";
                      if (mins === 180) label = "3h";
                      if (mins === 240) label = "4h";
                      
                      return (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => setCustomDurationMinutes(mins)}
                          className={`px-2 py-0.5 rounded text-[9px] font-sans transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-brand-primary text-brand-surface font-bold'
                              : 'bg-brand-surface border border-brand-outline text-brand-muted hover:border-brand-muted/40'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* If the reservation is already seated, show a live ticking countdown in the modal */}
                {activeReservation && activeReservation.status === 'seated' && activeReservation.seatedAt && (
                  <div className="mt-2 pt-2 border-t border-brand-outline/60 flex items-center justify-between text-[11px] bg-brand-surface/45 p-2 rounded-lg border border-brand-outline">
                    <span className="text-brand-muted">Sentado: <strong className="text-brand-text font-mono">{new Date(activeReservation.seatedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</strong></span>
                    <LocalModalCountdown seatedAt={activeReservation.seatedAt} customDurationMinutes={customDurationMinutes} />
                  </div>
                )}
              </div>
            </div>

            {/* Form Footer / Quick Status Actions */}
            <div className="p-4 bg-brand-surface-low border-t border-brand-outline flex flex-wrap gap-3 shrink-0">
              
              {/* Existing Reservation Operations */}
              {activeReservation && (
                <div className="flex gap-2 w-full sm:w-auto border-b sm:border-b-0 sm:border-r border-brand-outline pb-3 sm:pb-0 pr-0 sm:pr-3 mb-1 sm:mb-0">
                  {activeReservation.status === 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => onSeatedReservation(activeReservation.id)}
                      className="flex-1 sm:flex-initial bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs px-3 py-2 rounded-lg font-bold font-sans cursor-pointer transition-all"
                    >
                      Sentar Comensal
                    </button>
                  )}
                  {activeReservation.status === 'seated' && (
                    <button
                      type="button"
                      onClick={() => onCompleteReservation(activeReservation.id)}
                      className="flex-1 sm:flex-initial bg-brand-primary/10 hover:bg-brand-primary/20 border border-brand-primary/30 text-brand-primary text-xs px-3 py-2 rounded-lg font-bold font-sans cursor-pointer transition-all"
                    >
                      Servicio Finalizado
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('¿Seguro de cancelar esta reserva?')) {
                        onCancelReservation(activeReservation.id);
                        onClose();
                      }
                    }}
                    className="flex-1 sm:flex-initial hover:bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3 py-2 rounded-lg font-sans cursor-pointer transition-all"
                  >
                    Cancelar Cita
                  </button>
                </div>
              )}

              {/* Standard actions */}
              <div className="flex-1 flex gap-3 justify-end">
                {customerPhone && (
                  <button
                    type="button"
                    onClick={() => setShowMsgSimulator(true)}
                    className="bg-brand-surface-high border border-brand-outline hover:bg-brand-surface-highest text-brand-text text-xs px-3 py-2 rounded-lg font-sans font-medium flex items-center gap-1.5 cursor-pointer transition-all"
                  >
                    <MessageSquare className="w-4 h-4 text-brand-primary" />
                    Ver Mensaje WhatsApp
                  </button>
                )}
                
                {!activeReservation && table && (
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      onSaveReservation({
                        customerName: customerName.trim() || 'Cliente de Paso',
                        customerPhone: customerPhone.trim() || '+56 9 1234 5678',
                        date: date || now.toISOString().split('T')[0],
                        time: time || now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false }),
                        pax,
                        tableId: table.id,
                        status: 'seated',
                        seatedAt: now.toISOString(),
                        notes: notes.trim() || 'Ocupación directa',
                        allergies,
                        autoConfirmMessage: false,
                        customDurationMinutes
                      });
                      onClose();
                    }}
                    className="bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-sans font-bold text-xs px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    ⚡ Guardar y Sentar
                  </button>
                )}
                
                <button
                  type="submit"
                  className="bg-brand-primary text-brand-surface font-sans font-bold text-xs px-4 py-2 rounded-lg shadow-lg hover:bg-brand-primary/90 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  {activeReservation ? 'Guardar Cambios' : 'Agendar Reserva'}
                </button>
              </div>

            </div>
          </form>

          {/* WhatsApp / SMS Automatic Message Previewer Side-Drawer */}
          {showMsgSimulator && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              className="border-t md:border-t-0 md:border-l border-brand-outline bg-[#0c1221] p-4 flex flex-col justify-between shrink-0 overflow-y-auto"
            >
              <div>
                <div className="flex items-center justify-between border-b border-brand-outline pb-2 mb-4">
                  <span className="font-sans font-bold text-xs text-brand-text flex items-center gap-1.5 uppercase">
                    <MessageSquare className="w-4 h-4 text-brand-primary" />
                    SIMULADOR AUTOMÁTICO
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowMsgSimulator(false)}
                    className="text-brand-muted hover:text-brand-secondary text-xs cursor-pointer"
                  >
                    Cerrar
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-mono text-brand-muted block uppercase mb-1">Seleccionar Plantilla</label>
                    <div className="flex gap-2">
                      {AUTO_CONFIRM_TEMPLATES.map((tmpl) => (
                        <button
                          key={tmpl.id}
                          type="button"
                          onClick={() => setSelectedTemplate(tmpl.id)}
                          className={`flex-1 text-center py-1 rounded text-[10px] font-sans border cursor-pointer ${
                            selectedTemplate === tmpl.id
                              ? 'bg-brand-primary/15 border-brand-primary text-brand-primary font-semibold'
                              : 'bg-brand-surface border-brand-outline text-brand-muted hover:bg-brand-surface-high'
                          }`}
                        >
                          {tmpl.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* WhatsApp Box Layout Mock */}
                  <div className="bg-[#0b141a] rounded-xl border border-brand-outline overflow-hidden shadow-inner">
                    {/* Phone Header */}
                    <div className="bg-[#075e54] text-white px-3 py-2 flex items-center gap-2">
                      <div className="w-7 h-7 bg-brand-surface-high rounded-full flex items-center justify-center font-bold text-xs uppercase font-sans text-brand-text">
                        {customerName ? customerName.slice(0, 2) : 'CL'}
                      </div>
                      <div>
                        <p className="font-sans font-bold text-[11px] leading-tight">{customerName || 'Cliente'}</p>
                        <p className="text-[8px] font-mono opacity-80 leading-none">{customerPhone || '+56 9 1234 5678'}</p>
                      </div>
                    </div>
                    {/* Phone Body */}
                    <div className="p-3 bg-[#e5ddd5] min-h-[160px] relative flex flex-col justify-end">
                      <div className="absolute inset-0 opacity-[0.06] bg-cover pointer-events-none" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')" }} />
                      
                      <div className="relative bg-white text-black p-2.5 rounded-lg rounded-tr-none shadow text-[11px] leading-relaxed max-w-[90%] self-end">
                        <p>{getCompiledMessageText()}</p>
                        <span className="text-[8px] text-gray-500 block text-right mt-1">
                          {time} ✓✓
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Simulation triggers */}
              <div className="pt-4 border-t border-brand-outline mt-6">
                <button
                  type="button"
                  disabled={simulatedSendSuccess}
                  onClick={handleSimulateSend}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-sans font-bold text-xs cursor-pointer transition-all ${
                    simulatedSendSuccess
                      ? 'bg-brand-primary text-brand-surface'
                      : 'bg-[#25D366] text-white hover:bg-[#20ba5a]'
                  }`}
                >
                  {simulatedSendSuccess ? (
                    <>
                      <Check className="w-4 h-4 stroke-[3]" />
                      ¡Mensaje Enviado al Celular!
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Simular Envío WhatsApp
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

const LocalModalCountdown: React.FC<{ seatedAt: string; customDurationMinutes: number }> = ({ seatedAt, customDurationMinutes }) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const seatedTime = new Date(seatedAt).getTime();
  const limitMs = customDurationMinutes * 60 * 1000;
  const elapsedMs = now.getTime() - seatedTime;
  const remainingMs = limitMs - elapsedMs;

  if (remainingMs > 0) {
    const totalSecs = Math.floor(remainingMs / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const formatted = `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;

    return (
      <div className="flex items-center gap-1.5 font-sans">
        <span className="text-brand-muted">Restan:</span>
        <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${
          remainingMs < 15 * 60 * 1000 
            ? 'bg-red-500/25 text-red-200 border border-red-500/40 animate-pulse' 
            : 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/40'
        }`}>
          {formatted}
        </span>
      </div>
    );
  } else {
    return (
      <span className="font-mono font-bold text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded animate-pulse">
        ¡TIEMPO AGOTADO!
      </span>
    );
  }
};
