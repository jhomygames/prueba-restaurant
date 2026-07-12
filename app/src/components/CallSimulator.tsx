import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, User, Sparkles, Users, Calendar, Check, Clock, Wrench } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CallSimulatorProps {
  isOpen: boolean;
  onClose: () => void;
  // Se dispara cuando el agente crea la reserva en Airtable, para refrescar el plano.
  onReservationCreated: () => void;
  onAddNotification: (title: string, message: string, type: 'incoming_call') => void;
}

type Sender = 'attendant' | 'customer' | 'system';
interface Message {
  sender: Sender;
  text: string;
}

interface Persona {
  name: string;
  phone: string;
  pax: number;
  dayPhrase: string;
  time: string;
  allergy: string;
  occasion: string;
}

interface AgentTurn {
  text: string;
  toolActivity: { name: string; args: any }[];
  reservationCreated: boolean;
  reservation: any | null;
}

const MAX_TURNS = 8;

const TOOL_LABELS: Record<string, string> = {
  check_availability: 'consultó la disponibilidad de mesas',
  create_reservation: 'registró la reserva en el sistema',
  cancel_reservation: 'canceló la reserva',
  get_menu_info: 'revisó la carta y los alérgenos',
  get_customer_memory: 'consultó la ficha del cliente',
  transfer_to_human: 'avisó al equipo humano',
};

// Personas de ejemplo para el cliente simulado. El agente real procesará la
// reserva con sus herramientas; la persona solo da coherencia al rol-play.
const PERSONAS: Persona[] = [
  { name: 'Carlos Delgado', phone: '+34 682 741 928', pax: 4, dayPhrase: 'hoy', time: '21:00', allergy: 'ninguna', occasion: 'cena familiar' },
  { name: 'Julia Vera', phone: '+34 699 188 277', pax: 2, dayPhrase: 'mañana', time: '14:00', allergy: 'ninguna', occasion: 'aniversario de bodas' },
  { name: 'Silvia Olmedo', phone: '+34 611 987 654', pax: 6, dayPhrase: 'hoy', time: '20:30', allergy: 'gluten (celíaca)', occasion: 'cena entre amigos' },
  { name: 'Marcos Ferrer', phone: '+34 645 220 913', pax: 3, dayPhrase: 'el viernes', time: '22:00', allergy: 'lácteos', occasion: 'cumpleaños' },
];

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const k = localStorage.getItem('dinecontrol_staff_key');
  if (k) h['x-staff-key'] = k;
  return h;
}

export const CallSimulator: React.FC<CallSimulatorProps> = ({
  isOpen,
  onClose,
  onReservationCreated,
  onAddNotification,
}) => {
  const [callState, setCallState] = useState<'ringing' | 'connected' | 'completed'>('ringing');
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentThinking, setAgentThinking] = useState(false);
  const [customerThinking, setCustomerThinking] = useState(false);
  const [reservationResult, setReservationResult] = useState<any | null>(null);

  const personaRef = useRef<Persona>(PERSONAS[0]);
  const activeRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCallState('ringing');
      setMessages([]);
      setAgentThinking(false);
      setCustomerThinking(false);
      setReservationResult(null);
      personaRef.current = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
    } else {
      activeRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, agentThinking, customerThinking]);

  const appendMessage = (sender: Sender, text: string) => {
    setMessages((prev) => [...prev, { sender, text }]);
  };

  const callAgent = async (history: { role: string; text: string }[]): Promise<AgentTurn> => {
    const res = await fetch('/api/call/agent', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ history, customer_phone: personaRef.current.phone }),
    });
    if (!res.ok) throw new Error('agent_error');
    return res.json();
  };

  const callCustomer = async (history: { role: string; text: string }[]): Promise<string> => {
    const res = await fetch('/api/call/customer', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ history, persona: personaRef.current }),
    });
    if (!res.ok) throw new Error('customer_error');
    const data = await res.json();
    return data.text;
  };

  const finishCompleted = (reservation: any | null) => {
    activeRef.current = false;
    setReservationResult(reservation);
    setCallState('completed');
    if (reservation) {
      onAddNotification(
        'Reserva por Llamada AI',
        `${reservation.customerName || 'Cliente'} (${reservation.pax || '?'} pax) para el ${reservation.date} a las ${reservation.time}. Creada por el agente de voz.`,
        'incoming_call'
      );
      onReservationCreated();
    }
  };

  // Orquesta la llamada: agente (real, con herramientas) <-> cliente (rol-play).
  const runCall = async () => {
    activeRef.current = true;
    const history: { role: string; text: string }[] = [];

    for (let turn = 0; turn < MAX_TURNS && activeRef.current; turn++) {
      // Turno del agente real
      setAgentThinking(true);
      let agent: AgentTurn;
      try {
        agent = await callAgent(history);
      } catch {
        if (!activeRef.current) return;
        setAgentThinking(false);
        appendMessage('system', 'Se ha perdido la conexión con el agente.');
        finishCompleted(null);
        return;
      }
      if (!activeRef.current) return;
      setAgentThinking(false);

      agent.toolActivity?.forEach((t) => {
        const label = TOOL_LABELS[t.name] || `usó ${t.name}`;
        appendMessage('system', `María ${label}`);
      });
      appendMessage('attendant', agent.text);
      history.push({ role: 'agent', text: agent.text });

      if (agent.reservationCreated) {
        finishCompleted(agent.reservation);
        return;
      }

      // Turno del cliente simulado
      setCustomerThinking(true);
      let customerText: string;
      try {
        customerText = await callCustomer(history);
      } catch {
        if (!activeRef.current) return;
        setCustomerThinking(false);
        finishCompleted(null);
        return;
      }
      if (!activeRef.current) return;
      setCustomerThinking(false);
      appendMessage('customer', customerText);
      history.push({ role: 'customer', text: customerText });
    }

    // Se alcanzó el límite de turnos sin cerrar reserva
    if (activeRef.current) finishCompleted(null);
  };

  const handleAnswer = () => {
    setCallState('connected');
    runCall();
  };

  const handleHangUp = () => {
    activeRef.current = false;
    onClose();
  };

  const p = personaRef.current;

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
            {/* Ringing */}
            {callState === 'ringing' && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-brand-secondary/20 rounded-full animate-ping scale-150" />
                  <div className="relative w-20 h-20 bg-brand-secondary rounded-full flex items-center justify-center border-4 border-brand-surface">
                    <Phone className="w-10 h-10 text-brand-surface animate-bounce" />
                  </div>
                </div>

                <h3 className="font-sans font-bold text-2xl text-brand-text mb-1">LLAMADA ENTRANTE</h3>
                <p className="text-sm font-mono text-brand-secondary tracking-widest mb-4">CLIENTE SIMULADO</p>
                <div className="bg-brand-surface-low border border-brand-outline rounded-lg p-3 max-w-sm mb-8">
                  <p className="text-xs text-brand-muted">
                    Al contestar, la recepcionista <strong className="text-brand-text">María</strong> (el mismo agente de voz de Vapi, con sus herramientas) atenderá a un cliente simulado por Claude. Si todo va bien, <strong className="text-brand-text">la reserva se creará de verdad en Airtable</strong> y aparecerá en el plano.
                  </p>
                </div>

                <div className="flex gap-6 w-full max-w-xs">
                  <button
                    onClick={handleHangUp}
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

            {/* Connected */}
            {callState === 'connected' && (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex items-center justify-between p-4 bg-brand-surface-low border-b border-brand-outline">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-brand-primary/10 rounded-full flex items-center justify-center border border-brand-primary/30">
                      <Sparkles className="w-5 h-5 text-brand-primary animate-pulse" />
                    </div>
                    <div>
                      <h4 className="font-sans font-bold text-sm text-brand-text">María · Recepción de Voz</h4>
                      <p className="text-[10px] text-brand-primary font-mono tracking-wider">LLAMADA EN CURSO · AGENTE REAL</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 h-6">
                    <div className="w-1 bg-brand-primary rounded animate-[bounce_1s_infinite_100ms]" style={{ height: '50%' }} />
                    <div className="w-1 bg-brand-primary rounded animate-[bounce_1s_infinite_300ms]" style={{ height: '100%' }} />
                    <div className="w-1 bg-brand-primary rounded animate-[bounce_1s_infinite_500ms]" style={{ height: '70%' }} />
                    <div className="w-1 bg-brand-primary rounded animate-[bounce_1s_infinite_200ms]" style={{ height: '40%' }} />
                  </div>
                </div>

                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[280px] max-h-[420px]">
                  {messages.map((m, idx) => {
                    if (m.sender === 'system') {
                      return (
                        <div key={idx} className="flex justify-center">
                          <div className="flex items-center gap-1.5 bg-brand-surface-low border border-brand-outline/60 text-brand-muted px-2.5 py-1 rounded-full text-[10px] font-mono">
                            <Wrench className="w-3 h-3 text-brand-primary" />
                            {m.text}
                          </div>
                        </div>
                      );
                    }
                    const isAgent = m.sender === 'attendant';
                    return (
                      <div key={idx} className={`flex flex-col ${isAgent ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          {isAgent ? (
                            <>
                              <span className="text-[10px] text-brand-muted font-sans font-medium">María (Agente)</span>
                              <Sparkles className="w-3 h-3 text-brand-primary" />
                            </>
                          ) : (
                            <>
                              <User className="w-3 h-3 text-brand-secondary" />
                              <span className="text-[10px] text-brand-muted font-sans font-medium">Cliente</span>
                            </>
                          )}
                        </div>
                        <div
                          className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                            isAgent
                              ? 'bg-brand-surface-high border border-brand-outline text-brand-text rounded-tr-none'
                              : 'bg-brand-secondary/15 border border-brand-secondary/30 text-brand-text rounded-tl-none'
                          }`}
                        >
                          {m.text}
                        </div>
                      </div>
                    );
                  })}

                  {(agentThinking || customerThinking) && (
                    <div className={`flex flex-col ${agentThinking ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] text-brand-muted font-sans font-medium">
                          {agentThinking ? 'María está atendiendo...' : 'Cliente hablando...'}
                        </span>
                      </div>
                      <div className={`px-4 py-3 rounded-2xl flex items-center gap-1 ${agentThinking ? 'bg-brand-surface-high border border-brand-outline rounded-tr-none' : 'bg-brand-secondary/15 border border-brand-secondary/30 rounded-tl-none'}`}>
                        <span className="w-1.5 h-1.5 bg-brand-primary rounded-full animate-bounce" />
                        <span className="w-1.5 h-1.5 bg-brand-primary rounded-full animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 bg-brand-primary rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-brand-surface-low border-t border-brand-outline">
                  <button
                    onClick={handleHangUp}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-brand-surface-high border border-brand-outline hover:bg-brand-surface-highest transition-colors rounded-lg font-sans text-xs text-brand-secondary cursor-pointer"
                  >
                    <PhoneOff className="w-4 h-4" />
                    Colgar
                  </button>
                </div>
              </div>
            )}

            {/* Completed */}
            {callState === 'completed' && (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center border mb-4 ${reservationResult ? 'bg-brand-primary/10 border-brand-primary/30 animate-bounce' : 'bg-brand-surface-high border-brand-outline'}`}>
                  {reservationResult ? <Check className="w-8 h-8 text-brand-primary" /> : <Phone className="w-8 h-8 text-brand-muted" />}
                </div>

                <h3 className="font-sans font-bold text-xl text-brand-text mb-1">LLAMADA FINALIZADA</h3>
                <p className="text-xs text-brand-primary font-mono tracking-widest mb-6">
                  {reservationResult ? 'RESERVA CREADA EN AIRTABLE' : 'SIN RESERVA'}
                </p>

                {reservationResult ? (
                  <div className="w-full max-w-sm bg-brand-surface-low border border-brand-outline rounded-xl p-4 text-left space-y-3.5 mb-8 relative">
                    <div className="absolute top-3 right-3 flex items-center gap-1 bg-brand-primary/10 border border-brand-primary/30 px-2 py-0.5 rounded text-[9px] font-mono text-brand-primary">
                      <Sparkles className="w-3 h-3" /> POR EL AGENTE
                    </div>
                    <h4 className="font-sans font-bold text-xs text-brand-muted tracking-wider uppercase border-b border-brand-outline pb-1.5">
                      Detalles de la Reserva
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] text-brand-muted block">Cliente</span>
                        <strong className="text-brand-text font-sans text-sm">{reservationResult.customerName || '—'}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-brand-muted block">Teléfono</span>
                        <strong className="text-brand-text font-sans">{reservationResult.customerPhone || '—'}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-brand-muted block">Comensales</span>
                        <strong className="text-brand-text font-mono text-sm flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-brand-primary" /> {reservationResult.pax || '?'}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-brand-muted block">Fecha &amp; Hora</span>
                        <strong className="text-brand-text font-sans flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-brand-primary" /> {reservationResult.date} · {reservationResult.time}
                        </strong>
                      </div>
                    </div>
                    {reservationResult.notes && (
                      <div className="border-t border-brand-outline pt-2">
                        <span className="text-[10px] text-brand-muted block">Observaciones</span>
                        <p className="text-xs text-brand-text italic mt-0.5">"{reservationResult.notes}"</p>
                      </div>
                    )}
                    <div className="border-t border-brand-outline pt-2 flex items-center gap-1.5 text-[10px] text-brand-muted">
                      <Calendar className="w-3.5 h-3.5 text-brand-primary" />
                      Ya visible en el plano y en el calendario.
                    </div>
                  </div>
                ) : (
                  <div className="w-full max-w-sm bg-brand-surface-low border border-brand-outline rounded-xl p-4 text-xs text-brand-muted mb-8">
                    La llamada terminó sin cerrar una reserva (el cliente no confirmó o pidió otra cosa). Puedes volver a intentarlo.
                  </div>
                )}

                <button
                  onClick={onClose}
                  className="w-full max-w-sm py-3 bg-brand-primary text-brand-surface hover:bg-brand-primary/90 transition-colors rounded-xl font-sans font-bold text-xs cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
