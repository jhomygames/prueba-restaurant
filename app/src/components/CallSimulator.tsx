import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, User, Sparkles, Volume2, Calendar, Users, FileText, Check, AlertCircle, Clock } from 'lucide-react';
import { Reservation } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface CallSimulatorProps {
  isOpen: boolean;
  onClose: () => void;
  onAddReservation: (res: Omit<Reservation, 'id' | 'createdAt'>) => void;
  onAddNotification: (title: string, message: string, type: 'incoming_call') => void;
}

interface Message {
  sender: 'attendant' | 'customer';
  text: string;
}

export const CallSimulator: React.FC<CallSimulatorProps> = ({
  isOpen,
  onClose,
  onAddReservation,
  onAddNotification,
}) => {
  const [callState, setCallState] = useState<'ringing' | 'connected' | 'completed' | 'failed'>('ringing');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Scripted responses for our automated receptionist (attendant) to keep the flow intuitive
  const attendantScripts = [
    "Hola, gracias por llamar a DineControl AI, la recepción inteligente de nuestro restaurante. ¿Para cuántas personas y qué fecha le gustaría reservar?",
    "Excelente. ¿Y en qué horario prefiere su mesa? También, por favor indíquenos su nombre y número de teléfono.",
    "Entendido. ¿Tiene alguna observación especial, como alergias, restricciones dietéticas o si celebra alguna ocasión especial?",
    "Perfecto. Toda la información ha sido recopilada. Estoy confirmando su reserva en nuestro plano de mesas de forma automática y enviándole un mensaje SMS/WhatsApp de confirmación. ¡Le esperamos!"
  ];

  useEffect(() => {
    if (isOpen) {
      setCallState('ringing');
      setMessages([]);
      setExtractedData(null);
      setCurrentStep(0);
      // Play a soft ring sounds simulation or vibration if desired (visual only here)
    }
  }, [isOpen]);

  // Start call session
  const handleAnswer = () => {
    setCallState('connected');
    setMessages([{ sender: 'attendant', text: attendantScripts[0] }]);
    triggerCustomerResponse([], attendantScripts[0], 1);
  };

  const handleDecline = () => {
    onClose();
  };

  // Call server-side Gemini to simulate the customer
  const triggerCustomerResponse = async (history: Message[], lastAttendant: string, nextStep: number) => {
    setIsTyping(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch('/api/call/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: history,
          lastAttendantResponse: lastAttendant,
          targetDate: today
        })
      });

      if (!res.ok) throw new Error("Error simulating client conversation");
      const data = await res.json();
      
      setIsTyping(false);
      setMessages(prev => [...prev, { sender: 'customer', text: data.text }]);
      setCurrentStep(nextStep);

      // If Gemini extracted structured data, update it
      if (data.extractedData && Object.keys(data.extractedData).length > 0) {
        setExtractedData((prev: any) => ({
          ...prev,
          ...data.extractedData
        }));
      }
    } catch (err) {
      console.error(err);
      setIsTyping(false);
      // Fallback local mock in case server has issues
      setMessages(prev => [...prev, { 
        sender: 'customer', 
        text: "Hola, me gustaría una mesa para 4 personas para hoy a las 21:00 a nombre de Carlos Delgado. Teléfono +56 9 8274 1928. Sin mariscos por favor." 
      }]);
      setExtractedData({
        customerName: "Carlos Delgado",
        customerPhone: "+56 9 8274 1928",
        pax: 4,
        date: new Date().toISOString().split('T')[0],
        time: "21:00",
        notes: "Sin mariscos",
        allergies: ["Mariscos"]
      });
      setCurrentStep(nextStep);
    }
  };

  // Operator advances the receptionist script
  const handleNextAttendantTurn = () => {
    if (currentStep >= attendantScripts.length) return;
    
    const nextAttendantText = attendantScripts[currentStep];
    const updatedHistory = [...messages, { sender: 'attendant', text: nextAttendantText }];
    setMessages(updatedHistory);
    
    if (currentStep === attendantScripts.length - 1) {
      // Final turn
      setCallState('completed');
      onAddNotification(
        "Llamada Auto-Confirmada",
        `Reserva para ${extractedData?.customerName || 'Cliente'} (${extractedData?.pax || 2} pax) procesada por voz.`,
        'incoming_call'
      );
    } else {
      triggerCustomerResponse(updatedHistory, nextAttendantText, currentStep + 1);
    }
  };

  const handleConfirmReservation = () => {
    if (!extractedData) return;

    // Default dates if empty
    const today = new Date().toISOString().split('T')[0];
    
    onAddReservation({
      customerName: extractedData.customerName || 'Cliente por Teléfono',
      customerPhone: extractedData.customerPhone || '+34 600 000 000',
      date: extractedData.date || today,
      time: extractedData.time || '20:30',
      pax: Number(extractedData.pax) || 4,
      tableId: '', // Will be assigned on the floor plan
      status: 'confirmed',
      notes: extractedData.notes || 'Reservado por asistente telefónico AI.',
      allergies: extractedData.allergies || [],
      autoConfirmMessage: true
    });
    
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="w-full max-w-lg bg-brand-surface border border-brand-outline rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            {/* Call State: Ringing */}
            {callState === 'ringing' && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-brand-secondary/20 rounded-full animate-ping scale-150" />
                  <div className="relative w-20 h-20 bg-brand-secondary rounded-full flex items-center justify-center border-4 border-brand-surface">
                    <Phone className="w-10 h-10 text-brand-surface animate-bounce" />
                  </div>
                </div>
                
                <h3 className="font-sans font-bold text-2xl text-brand-text mb-1">
                  LLAMADA ENTRANTE
                </h3>
                <p className="text-sm font-mono text-brand-secondary tracking-widest mb-4">
                  CLIENTE AI SIMULADOR
                </p>
                <div className="bg-brand-surface-low border border-brand-outline rounded-lg p-3 max-w-sm mb-8">
                  <p className="text-xs text-brand-muted">
                    El sistema de voz de DineControl AI simula la recepción telefónica de un cliente real mediante el modelo Gemini 3.5. Al contestar, podrás ver el diálogo y cómo se confirman los datos automáticamente.
                  </p>
                </div>

                <div className="flex gap-6 w-full max-w-xs">
                  <button
                    onClick={handleDecline}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-surface-high border border-brand-outline hover:bg-brand-surface-highest transition-colors rounded-xl font-sans font-medium text-brand-text cursor-pointer"
                  >
                    <PhoneOff className="w-5 h-5 text-brand-secondary" />
                    Rechazar
                  </button>
                  <button
                    onClick={handleAnswer}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-primary text-brand-surface hover:bg-brand-primary/90 transition-colors rounded-xl font-sans font-bold cursor-pointer"
                  >
                    <Phone className="w-5 h-5" />
                    Contestar
                  </button>
                </div>
              </div>
            )}

            {/* Call State: Connected */}
            {callState === 'connected' && (
              <div className="flex flex-col h-full overflow-hidden">
                {/* Header with Call Status */}
                <div className="flex items-center justify-between p-4 bg-brand-surface-low border-b border-brand-outline">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-brand-primary/10 rounded-full flex items-center justify-center border border-brand-primary/30">
                      <Sparkles className="w-5 h-5 text-brand-primary animate-pulse" />
                    </div>
                    <div>
                      <h4 className="font-sans font-bold text-sm text-brand-text">Recepción Telefónica AI</h4>
                      <p className="text-[10px] text-brand-primary font-mono tracking-wider">LLAMADA EN CURSO</p>
                    </div>
                  </div>
                  
                  {/* Bouncing Audio Waves */}
                  <div className="flex items-center gap-1 h-6">
                    <div className="w-1 bg-brand-primary rounded animate-[bounce_1s_infinite_100ms]" style={{ height: '50%' }} />
                    <div className="w-1 bg-brand-primary rounded animate-[bounce_1s_infinite_300ms]" style={{ height: '100%' }} />
                    <div className="w-1 bg-brand-primary rounded animate-[bounce_1s_infinite_500ms]" style={{ height: '70%' }} />
                    <div className="w-1 bg-brand-primary rounded animate-[bounce_1s_infinite_200ms]" style={{ height: '40%' }} />
                  </div>
                </div>

                {/* Conversation Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[250px] max-h-[350px]">
                  {messages.map((m, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col ${m.sender === 'attendant' ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {m.sender === 'attendant' ? (
                          <>
                            <span className="text-[10px] text-brand-muted font-sans font-medium">Asistente AI (Tú)</span>
                            <Sparkles className="w-3 h-3 text-brand-primary" />
                          </>
                        ) : (
                          <>
                            <User className="w-3 h-3 text-brand-secondary" />
                            <span className="text-[10px] text-brand-muted font-sans font-medium">Cliente (Llamando)</span>
                          </>
                        )}
                      </div>
                      <div
                        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                          m.sender === 'attendant'
                            ? 'bg-brand-surface-high border border-brand-outline text-brand-text rounded-tr-none'
                            : 'bg-brand-secondary/15 border border-brand-secondary/30 text-brand-text rounded-tl-none'
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  ))}

                  {isTyping && (
                    <div className="flex flex-col items-start">
                      <div className="flex items-center gap-1.5 mb-1">
                        <User className="w-3 h-3 text-brand-secondary" />
                        <span className="text-[10px] text-brand-muted font-sans font-medium">Cliente hablando...</span>
                      </div>
                      <div className="bg-brand-secondary/15 border border-brand-secondary/30 px-4 py-3 rounded-2xl rounded-tl-none flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-brand-secondary rounded-full animate-bounce" />
                        <span className="w-1.5 h-1.5 bg-brand-secondary rounded-full animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 bg-brand-secondary rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Live Extraction Panel */}
                {extractedData && (
                  <div className="p-3 mx-4 mb-4 bg-brand-surface-low border border-brand-outline rounded-xl">
                    <h5 className="font-sans font-bold text-xs text-brand-text mb-2 flex items-center gap-1.5">
                      <Volume2 className="w-4 h-4 text-brand-primary" />
                      Extracción de datos en tiempo real
                    </h5>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="flex items-center gap-1 text-brand-muted">
                        <User className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                        <span className="truncate">
                          Nombre: <strong className="text-brand-text font-sans">{extractedData.customerName || 'Buscando...'}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-brand-muted">
                        <Phone className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                        <span className="truncate">
                          Teléfono: <strong className="text-brand-text font-sans">{extractedData.customerPhone || 'Buscando...'}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-brand-muted">
                        <Users className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                        <span className="truncate">
                          Personas: <strong className="text-brand-text font-sans">{extractedData.pax || 'Buscando...'}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-brand-muted">
                        <Clock className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                        <span className="truncate">
                          Hora: <strong className="text-brand-text font-sans">{extractedData.time || 'Buscando...'}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions Footer */}
                <div className="p-4 bg-brand-surface-low border-t border-brand-outline flex gap-4">
                  <button
                    onClick={handleDecline}
                    className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-brand-surface-high border border-brand-outline hover:bg-brand-surface-highest transition-colors rounded-lg font-sans text-xs text-brand-secondary cursor-pointer"
                  >
                    <PhoneOff className="w-4 h-4" />
                    Colgar
                  </button>
                  
                  <button
                    disabled={isTyping || currentStep >= attendantScripts.length}
                    onClick={handleNextAttendantTurn}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-primary text-brand-surface hover:bg-brand-primary/90 disabled:opacity-50 transition-colors rounded-lg font-sans font-bold text-xs cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    {currentStep === attendantScripts.length - 1 
                      ? "Confirmar y Finalizar Llamada" 
                      : "Siguiente Pregunta del Asistente"}
                  </button>
                </div>
              </div>
            )}

            {/* Call State: Completed */}
            {callState === 'completed' && (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="w-16 h-16 bg-brand-primary/10 rounded-full flex items-center justify-center border border-brand-primary/30 mb-4 animate-bounce">
                  <Check className="w-8 h-8 text-brand-primary" />
                </div>
                
                <h3 className="font-sans font-bold text-xl text-brand-text mb-1">
                  LLAMADA COMPLETADA
                </h3>
                <p className="text-xs text-brand-primary font-mono tracking-widest mb-6">
                  RESERVA EXTRAÍDA POR AI
                </p>

                {/* Ticket view */}
                <div className="w-full max-w-sm bg-brand-surface-low border border-brand-outline rounded-xl p-4 text-left space-y-3.5 mb-8 relative">
                  <div className="absolute top-3 right-3 flex items-center gap-1 bg-brand-primary/10 border border-brand-primary/30 px-2 py-0.5 rounded text-[9px] font-mono text-brand-primary">
                    <Sparkles className="w-3 h-3" /> AUTO-CONFIRMADA
                  </div>

                  <h4 className="font-sans font-bold text-xs text-brand-muted tracking-wider uppercase border-b border-brand-outline pb-1.5">
                    Detalles de la Cita
                  </h4>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-brand-muted block">Cliente</span>
                      <strong className="text-brand-text font-sans text-sm">{extractedData?.customerName || 'Carlos Delgado'}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-brand-muted block">Teléfono</span>
                      <strong className="text-brand-text font-sans">{extractedData?.customerPhone || '+56 9 8274 1928'}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-brand-muted block">Comensales</span>
                      <strong className="text-brand-text font-mono text-sm flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-brand-primary" /> {extractedData?.pax || 4} Personas
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-brand-muted block">Fecha &amp; Hora</span>
                      <strong className="text-brand-text font-sans flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-brand-primary" /> {extractedData?.time || '21:00'} hrs
                      </strong>
                    </div>
                  </div>

                  {extractedData?.notes && (
                    <div className="border-t border-brand-outline pt-2">
                      <span className="text-[10px] text-brand-muted block">Observaciones</span>
                      <p className="text-xs text-brand-text italic mt-0.5">"{extractedData.notes}"</p>
                    </div>
                  )}

                  {extractedData?.allergies && extractedData.allergies.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {extractedData.allergies.map((a: string) => (
                        <span key={a} className="bg-brand-secondary/10 border border-brand-secondary/30 text-brand-secondary px-1.5 py-0.5 rounded text-[9px] font-sans">
                          Alergia: {a}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-4 w-full max-w-sm">
                  <button
                    onClick={onClose}
                    className="flex-1 py-3 bg-brand-surface-high border border-brand-outline hover:bg-brand-surface-highest transition-colors rounded-xl font-sans text-xs text-brand-text cursor-pointer"
                  >
                    Descartar
                  </button>
                  <button
                    onClick={handleConfirmReservation}
                    className="flex-2 py-3 bg-brand-primary text-brand-surface hover:bg-brand-primary/90 transition-colors rounded-xl font-sans font-bold text-xs flex items-center justify-center gap-1 cursor-pointer shadow-lg shadow-brand-primary/10"
                  >
                    <Calendar className="w-4 h-4" />
                    Asignar Mesa en Plano
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
