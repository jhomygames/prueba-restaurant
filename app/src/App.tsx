import { useState, useEffect, useRef } from 'react';
import { Table, Reservation, NotificationLog, TableStatus, Decoration } from './types';
import { INITIAL_DECORATIONS } from './data';
import * as api from './api';
import { Customer } from './api';
import { FloorPlan } from './components/FloorPlan';
import { CalendarView } from './components/CalendarView';
import { ReservationModal } from './components/ReservationModal';
import { NotificationCenter } from './components/NotificationCenter';
import { CallSimulator } from './components/CallSimulator';
import { MenuView } from './components/MenuView';
import { CustomersView } from './components/CustomersView';
import { 
  UtensilsCrossed, 
  Layers, 
  Calendar, 
  Bell, 
  Sparkles, 
  PhoneCall, 
  Clock, 
  Mail, 
  HelpCircle, 
  SlidersHorizontal,
  PlusCircle,
  TrendingUp,
  RotateCcw,
  BookOpen,
  Upload,
  FileText,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Cada cuánto se refresca el estado desde Airtable (vía la API del backend).
// Así las reservas creadas por el agente de voz o WhatsApp aparecen solas.
const POLL_INTERVAL_MS = 20000;

export default function App() {
  // --- Estado remoto: Airtable es la única base de datos ---
  const [tables, setTables] = useState<Table[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Las decoraciones del plano son cosméticas: se quedan en localStorage.
  const [decorations, setDecorations] = useState<Decoration[]>(() => {
    const saved = localStorage.getItem('dinecontrol_decorations');
    return saved ? JSON.parse(saved) : INITIAL_DECORATIONS;
  });

  const [isToleranceEnabled, setIsToleranceEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('dinecontrol_tolerance_enabled');
    return saved ? JSON.parse(saved) : true;
  });

  const [defaultSeatedDuration, setDefaultSeatedDuration] = useState<number>(() => {
    const saved = localStorage.getItem('dinecontrol_default_seated_duration');
    return saved ? JSON.parse(saved) : 120; // 2 hours by default
  });

  const [notifications, setNotifications] = useState<NotificationLog[]>([]);

  // --- UI Layout States ---
  const [activeTab, setActiveTab] = useState<'floor' | 'calendar' | 'menu' | 'customers'>('floor');
  const [pdfFile, setPdfFile] = useState<string | null>(() => {
    return localStorage.getItem('dinecontrol_pdf_data');
  });
  const [pdfFileName, setPdfFileName] = useState<string | null>(() => {
    return localStorage.getItem('dinecontrol_pdf_name');
  });

  const handlePdfUpload = (base64: string, name: string) => {
    setPdfFile(base64);
    setPdfFileName(name);
    localStorage.setItem('dinecontrol_pdf_data', base64);
    localStorage.setItem('dinecontrol_pdf_name', name);
  };

  const handlePdfRemove = () => {
    setPdfFile(null);
    setPdfFileName(null);
    localStorage.removeItem('dinecontrol_pdf_data');
    localStorage.removeItem('dinecontrol_pdf_name');
  };

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState<boolean>(false);
  const [isCallOpen, setIsCallOpen] = useState<boolean>(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [isConfigDropdownOpen, setIsConfigDropdownOpen] = useState<boolean>(false);

  const handleToggleNotifications = () => {
    setIsNotificationsOpen(prev => {
      const next = !prev;
      if (next) {
        // Mark all as read
        setNotifications(curr => curr.map(n => ({ ...n, read: true })));
      }
      return next;
    });
    setIsConfigDropdownOpen(false);
  };

  const handleToggleConfigDropdown = () => {
    setIsConfigDropdownOpen(prev => !prev);
    setIsNotificationsOpen(false);
  };
  
  // Quick banner alerts state (simulates heads-up floating push notification on browser)
  const [bannerAlert, setBannerAlert] = useState<{ title: string; msg: string; type: string } | null>(null);

  // Pausar el polling mientras el usuario edita el plano o una reserva,
  // para que el refresco no le pise los cambios a medio hacer.
  useEffect(() => {
    isPollingPaused.current = isEditMode || isBookingModalOpen;
  }, [isEditMode, isBookingModalOpen]);

  // --- Carga inicial + polling desde Airtable (vía backend) ---
  const knownReservationIds = useRef<Set<string> | null>(null);
  const isPollingPaused = useRef(false);

  const refreshFromServer = async (silent = true) => {
    // No pisar el estado local mientras el usuario arrastra mesas o edita.
    if (isPollingPaused.current) return;
    try {
      const [remoteTables, remoteReservations, remoteCustomers] = await Promise.all([
        api.fetchTables(),
        api.fetchReservations(),
        api.fetchCustomers(),
      ]);

      // Detectar reservas nuevas llegadas por voz/WhatsApp para notificar
      if (knownReservationIds.current) {
        const fresh = remoteReservations.filter(
          (r) => !knownReservationIds.current!.has(r.id) && r.status !== 'cancelled'
        );
        for (const r of fresh) {
          addNotificationLog(
            'Nueva Reserva Recibida',
            `${r.customerName} (${r.pax} pax) para el ${r.date} a las ${r.time}. Origen: agente de voz, WhatsApp u otro dispositivo.`,
            'incoming_call'
          );
        }
      }
      knownReservationIds.current = new Set(remoteReservations.map((r) => r.id));

      setTables(remoteTables);
      setReservations(remoteReservations);
      setCustomers(remoteCustomers);
      setApiError(null);
      setIsLoaded(true);
    } catch (err: any) {
      console.error('Error sincronizando con Airtable:', err);
      setApiError(err.message || 'Error de conexión con el servidor');
      if (!silent) alert('No se pudo conectar con la base de datos (Airtable). Revisa el servidor.');
    }
  };

  useEffect(() => {
    refreshFromServer();
    const interval = setInterval(refreshFromServer, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem('dinecontrol_decorations', JSON.stringify(decorations));
  }, [decorations]);

  useEffect(() => {
    localStorage.setItem('dinecontrol_tolerance_enabled', JSON.stringify(isToleranceEnabled));
  }, [isToleranceEnabled]);

  useEffect(() => {
    localStorage.setItem('dinecontrol_default_seated_duration', JSON.stringify(defaultSeatedDuration));
  }, [defaultSeatedDuration]);

  // --- Real-Time Background Checker for Auto-Release (Tolerance & Seated Limit) ---
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];

    const itemsToCancel: string[] = [];
    const itemsToComplete: string[] = [];

    reservations.forEach(r => {
      // 1. Check reservation late tolerance (15 mins)
      if (isToleranceEnabled && r.status === 'confirmed' && r.date === today) {
        const rDateTime = new Date(r.date + 'T' + r.time + ':00');
        const diffMs = currentTime.getTime() - rDateTime.getTime();
        
        // If current time is 15 minutes past scheduled time
        if (diffMs > 15 * 60 * 1000) {
          itemsToCancel.push(r.id);
        }
      }

      // 2. Check seated service duration limit (e.g. 2 hours)
      if (r.status === 'seated' && r.seatedAt && r.date === today) {
        const seatedTime = new Date(r.seatedAt).getTime();
        const durationLimitMs = (r.customDurationMinutes || defaultSeatedDuration) * 60 * 1000;
        const elapsedMs = currentTime.getTime() - seatedTime;

        if (elapsedMs >= durationLimitMs) {
          itemsToComplete.push(r.id);
        }
      }
    });

    if (itemsToCancel.length > 0 || itemsToComplete.length > 0) {
      // Persistir en Airtable los cambios de estado automáticos
      itemsToCancel.forEach(id =>
        api.updateReservation(id, { status: 'cancelled' }).catch(err => console.error('auto-cancel:', err))
      );
      itemsToComplete.forEach(id =>
        api.updateReservation(id, { status: 'completed' }).catch(err => console.error('auto-complete:', err))
      );
      setReservations(prev => prev.map(r => {
        if (itemsToCancel.includes(r.id)) {
          const tableObj = tables.find(t => t.id === r.tableId);
          addNotificationLog(
            "Tolerancia Excedida (Mesa Liberada)",
            `La mesa ${tableObj ? tableObj.name : 'asignada'} reservada para ${r.customerName} a las ${r.time} se ha liberado automáticamente por tardanza (tolerancia de 15 min superada).`,
            'system'
          );
          return { ...r, status: 'cancelled' };
        }
        if (itemsToComplete.includes(r.id)) {
          const tableObj = tables.find(t => t.id === r.tableId);
          addNotificationLog(
            "Mesa Liberada (Tiempo Finalizado)",
            `El tiempo de comida (${r.customDurationMinutes || defaultSeatedDuration} min) para ${r.customerName} en la ${tableObj ? tableObj.name : 'mesa'} ha finalizado. La mesa se liberó automáticamente.`,
            'system'
          );
          return { ...r, status: 'completed' };
        }
        return r;
      }));
    }
  }, [currentTime, isToleranceEnabled, defaultSeatedDuration, tables]);

  // --- Sync Table Status dynamically based on active bookings of SELECTED DATE ---
  // If there's an active booking for the selected date, table status is 'reserved'. If a booking is 'seated', status is 'occupied'.
  useEffect(() => {
    // Create copy of tables
    setTables(prevTables => {
      let changed = false;
      const updated = prevTables.map(t => {
        // Find if this table has an active reservation for the selected date
        const activeRes = reservations.find(
          r => r.tableId === t.id && r.date === selectedDate && r.status !== 'completed' && r.status !== 'cancelled'
        );

        let targetStatus: TableStatus = 'free';
        if (activeRes) {
          if (activeRes.status === 'seated') {
            targetStatus = 'occupied';
          } else {
            targetStatus = 'reserved';
          }
        } else {
          // Keep its previous status unless it was occupied/reserved without actual reservation
          if (t.status !== 'free') {
            // Check if there was any manual override or if we should release it
            targetStatus = t.status === 'occupied' ? 'occupied' : 'free';
          }
        }

        if (t.status !== targetStatus) {
          changed = true;
          return { ...t, status: targetStatus };
        }
        return t;
      });

      return changed ? updated : prevTables;
    });
  }, [reservations, selectedDate]);

  // --- Push Notification Handlers ---
  const addNotificationLog = (title: string, message: string, type: 'daily_reminder' | '15_min_before' | 'incoming_call' | 'system') => {
    const newNotif: NotificationLog = {
      id: 'notif-' + Date.now(),
      timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type,
      title,
      message,
      read: false
    };

    setNotifications(prev => [newNotif, ...prev]);

    // Set floating banner alert
    setBannerAlert({ title, msg: message, type });
    // Auto dismiss banner after 5 seconds
    setTimeout(() => {
      setBannerAlert(null);
    }, 5000);
  };

  const handleDismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleClearAllNotifications = () => {
    setNotifications([]);
  };

  // --- Push Notification Simulators ---
  
  // 1. Daily Morning Reminder Simulation
  const handleSimulateDailyReminder = () => {
    const today = new Date().toISOString().split('T')[0];
    const todayBookings = reservations.filter(r => r.date === today && r.status === 'confirmed');

    if (todayBookings.length === 0) {
      addNotificationLog(
        "Recordatorios Diarios",
        "Proceso finalizado. No hay reservas pendientes de confirmar para el día de hoy.",
        'daily_reminder'
      );
      return;
    }

    // Auto update status to confirmed for simulated customers (y persistir)
    reservations
      .filter(r => r.date === today && r.status === 'pending')
      .forEach(r =>
        api.updateReservation(r.id, { status: 'confirmed' }).catch(err => console.error('confirm:', err))
      );
    setReservations(prev =>
      prev.map(r => r.date === today && r.status === 'pending' ? { ...r, status: 'confirmed' } : r)
    );

    addNotificationLog(
      "Recordatorios Diarios Enviados",
      `Se han enviado automáticamente ${todayBookings.length} mensajes SMS/WhatsApp de re-confirmación para el servicio de hoy.`,
      'daily_reminder'
    );
  };

  // 2. 15-Min Arrival Warning Simulation
  const handleSimulate15MinWarning = () => {
    const active = reservations.find(r => r.status === 'confirmed');
    
    if (!active) {
      addNotificationLog(
        "Alerta de Arribo",
        "No hay ninguna reserva confirmada pendiente para activar la alerta de 15 minutos.",
        '15_min_before'
      );
      return;
    }

    const tableAssigned = tables.find(t => t.id === active.tableId);
    addNotificationLog(
      "Llegada Inminente (15 min)",
      `El comensal ${active.customerName} (${active.pax} pax) está programado para llegar en 15 minutos. Su mesa asignada es la ${tableAssigned ? tableAssigned.name : 'Sin asignar'}.`,
      '15_min_before'
    );
  };

  // 3. Receive Incoming Reservation Phone Call Simulation
  const handleReceiveIncomingCall = () => {
    setIsCallOpen(true);
  };

  // --- Table Layout Event Handlers (Floor Plan Editor) ---
  // Cada cambio se refleja localmente al instante y se persiste en Airtable
  // (con debounce, porque el drag dispara updates continuos).
  const handleUpdateTable = (updatedTable: Table) => {
    setTables(prev => prev.map(t => t.id === updatedTable.id ? updatedTable : t));
    api.updateTableDebounced(updatedTable);
  };

  const handleAddTable = async (newTable: Table) => {
    try {
      const { id: _tempId, ...fields } = newTable;
      const created = await api.createTable(fields);
      setTables(prev => [...prev, created]);
      addNotificationLog(
        "Plano Actualizado",
        `Se ha añadido la nueva mesa "${created.name}" (${created.seats} pax) y guardado en Airtable.`,
        'system'
      );
    } catch (err) {
      console.error('createTable:', err);
      alert('No se pudo guardar la mesa nueva en Airtable. Revisa la conexión.');
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    try {
      await api.deleteTable(tableId);
    } catch (err) {
      console.error('deleteTable:', err);
      alert('No se pudo eliminar la mesa en Airtable. Revisa la conexión.');
      return;
    }
    setTables(prev => prev.filter(t => t.id !== tableId));
    // Also clear table assignment of active reservations on this table
    setReservations(prev =>
      prev.map(r => r.tableId === tableId ? { ...r, tableId: '' } : r)
    );
    addNotificationLog(
      "Plano Actualizado",
      "Se ha eliminado la mesa del plano y de Airtable. Las reservas asignadas se han desvinculado.",
      'system'
    );
  };

  const handleUpdateDecoration = (updatedDec: Decoration) => {
    setDecorations(prev => prev.map(d => d.id === updatedDec.id ? updatedDec : d));
  };

  const handleAddDecoration = (newDec: Decoration) => {
    setDecorations(prev => [...prev, newDec]);
    addNotificationLog(
      "Plano Actualizado",
      `Se ha añadido el elemento decorativo: "${newDec.name}".`,
      'system'
    );
  };

  const handleDeleteDecoration = (decId: string) => {
    setDecorations(prev => prev.filter(d => d.id !== decId));
    addNotificationLog(
      "Plano Actualizado",
      "Se ha eliminado el elemento decorativo del plano.",
      'system'
    );
  };

  // --- Reservation Booking Handlers ---
  const handleSelectTable = (tableId: string) => {
    setSelectedTableId(tableId);
    setIsBookingModalOpen(true);
  };

  const handleSaveReservation = async (resData: Omit<Reservation, 'id' | 'createdAt'> & { id?: string }) => {
    try {
      if (resData.id) {
        // Edit existing reservation
        const { id, ...fields } = resData;
        const updated = await api.updateReservation(id, fields);
        setReservations(prev => prev.map(r => r.id === id ? updated : r));

        addNotificationLog(
          "Reserva Modificada",
          `Se actualizaron los datos de la reserva de ${resData.customerName} (${resData.pax} pax).`,
          'system'
        );
      } else {
        // Create new reservation (queda registrada en Airtable, y el cliente
        // se da de alta/actualiza en la tabla Clientes automáticamente)
        const created = await api.createReservation(resData);
        setReservations(prev => [...prev, created]);

        addNotificationLog(
          "Nueva Reserva Creada",
          `Se agendó la mesa para ${resData.customerName} (${resData.pax} pax) el día ${resData.date} a las ${resData.time} hrs.`,
          'system'
        );
      }
    } catch (err) {
      console.error('saveReservation:', err);
      alert('No se pudo guardar la reserva en Airtable. Revisa la conexión.');
    }
  };

  const handleCancelReservation = (resId: string) => {
    const resToCancel = reservations.find(r => r.id === resId);
    setReservations(prev => prev.map(r => r.id === resId ? { ...r, status: 'cancelled' } : r));
    api.updateReservation(resId, { status: 'cancelled' }).catch(err => console.error('cancel:', err));

    if (resToCancel) {
      addNotificationLog(
        "Reserva Cancelada",
        `La reserva a nombre de ${resToCancel.customerName} fue cancelada. La mesa quedó liberada.`,
        'system'
      );
    }
  };

  const handleSeatedReservation = (resId: string) => {
    const seatTime = new Date().toISOString();
    const existing = reservations.find(r => r.id === resId);
    const seatedAt = existing?.seatedAt || seatTime;
    const duration = existing?.customDurationMinutes || defaultSeatedDuration;

    setReservations(prev => prev.map(r => r.id === resId ? {
      ...r,
      status: 'seated',
      seatedAt,
      customDurationMinutes: duration
    } : r));
    api.updateReservation(resId, { status: 'seated', seatedAt, customDurationMinutes: duration })
      .catch(err => console.error('seated:', err));

    if (existing) {
      addNotificationLog(
        "Comensal Sentado",
        `El grupo de ${existing.customerName} (${existing.pax} pax) ya está en servicio. Mesa marcada como ocupada con un límite de ${duration} minutos.`,
        'system'
      );
    }
  };

  const handleCompleteReservation = (resId: string) => {
    setReservations(prev => prev.map(r => r.id === resId ? { ...r, status: 'completed' } : r));
    api.updateReservation(resId, { status: 'completed' }).catch(err => console.error('complete:', err));
    const res = reservations.find(r => r.id === resId);

    if (res) {
      addNotificationLog(
        "Servicio Completado",
        `La mesa de ${res.customerName} finalizó su comida. La mesa ha sido liberada y limpiada para futuros comensales.`,
        'system'
      );
    }
  };

  // Las mesas y reservas viven en Airtable: aquí solo se restauran los
  // elementos locales (decoración del plano) y se fuerza una resincronización.
  const handleResetDefaults = () => {
    if (confirm('¿Restaurar la decoración del plano por defecto y resincronizar con Airtable? (Las mesas, reservas y clientes NO se tocan: viven en Airtable.)')) {
      localStorage.removeItem('dinecontrol_decorations');
      setDecorations(INITIAL_DECORATIONS);
      setNotifications([]);
      refreshFromServer(false);
      addNotificationLog("Sistema Resincronizado", "Decoración restaurada y datos recargados desde Airtable.", 'system');
    }
  };

  // Find active reservation for current selected table (if any)
  const getActiveReservationForSelectedTable = (): Reservation | null => {
    if (!selectedTableId) return null;
    const active = reservations.find(
      r => r.tableId === selectedTableId && r.date === selectedDate && r.status !== 'completed' && r.status !== 'cancelled'
    );
    return active || null;
  };

  // Quick stats calculation
  const totalTables = tables.length;
  const occupiedTablesCount = tables.filter(t => t.status === 'occupied').length;
  const reservedTablesCount = tables.filter(t => t.status === 'reserved').length;
  const freeTablesCount = tables.filter(t => t.status === 'free').length;

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans overflow-x-hidden flex flex-col">
      
      {/* Heads-up Floating Push Notification Banner Alert */}
      <AnimatePresence>
        {bannerAlert && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4 pointer-events-none"
          >
            <div className="bg-brand-surface-high border-2 border-brand-primary rounded-xl p-4 shadow-2xl flex gap-3 pointer-events-auto">
              <div className="mt-0.5 shrink-0 bg-brand-primary/10 p-2 rounded-lg border border-brand-primary/20">
                {bannerAlert.type === 'incoming_call' ? (
                  <PhoneCall className="w-5 h-5 text-brand-secondary animate-pulse" />
                ) : bannerAlert.type === '15_min_before' ? (
                  <Clock className="w-5 h-5 text-brand-tertiary" />
                ) : (
                  <Bell className="w-5 h-5 text-brand-primary" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="font-sans font-bold text-xs text-brand-text uppercase tracking-wider">
                    {bannerAlert.title}
                  </h4>
                  <span className="text-[9px] font-mono bg-brand-primary/10 border border-brand-primary/30 px-1 rounded text-brand-primary font-bold">
                    NOTIFICACIÓN PUSH
                  </span>
                </div>
                <p className="text-xs text-brand-muted mt-1 leading-relaxed">
                  {bannerAlert.msg}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Top Navigation Bar */}
      <header className="border-b border-brand-outline bg-brand-surface-low/80 backdrop-blur sticky top-0 z-40 px-6 py-3 flex flex-col md:flex-row gap-3 md:gap-0 items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-brand-primary text-brand-surface rounded-xl flex items-center justify-center font-bold font-sans shadow-lg shadow-brand-primary/20">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-sans font-bold text-lg leading-none text-brand-text tracking-tight flex items-center gap-1.5">
              DineControl AI
            </h1>
            <p className="text-[10px] text-brand-muted leading-none mt-1">Plano &amp; Recepción de Reservas Avanzadas</p>
          </div>
        </div>

        {/* Central Real-time Clock & Date Control */}
        <div className="flex items-center gap-3 bg-brand-surface-high border border-brand-outline px-4 py-2 rounded-2xl shadow-sm text-xs font-sans">
          {/* Real-time Clock */}
          <div className="flex items-center gap-2 border-r border-brand-outline/60 pr-3">
            <Clock className="w-4 h-4 text-brand-primary animate-pulse" />
            <span className="font-mono font-bold text-brand-text tracking-wider text-[13px] tabular-nums">
              {currentTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            {/* Estado de sincronización con Airtable */}
            <span
              className={`w-2 h-2 rounded-full ${apiError ? 'bg-red-500' : isLoaded ? 'bg-emerald-400' : 'bg-yellow-400 animate-pulse'}`}
              title={apiError ? `Sin conexión con Airtable: ${apiError}` : isLoaded ? 'Sincronizado con Airtable' : 'Conectando con Airtable...'}
            />
          </div>

          {/* Date Control (Input selector + labels) */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                addNotificationLog(
                  "Fecha Cambiada",
                  `Has cambiado la vista del sistema al ${new Date(e.target.value + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
                  'system'
                );
              }}
              className="bg-brand-surface border border-brand-outline hover:border-brand-primary/40 rounded-lg px-2 py-0.5 text-xs font-mono font-bold text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-primary/50 transition-all cursor-pointer"
            />
            {/* Quick Button to return to today's date */}
            {selectedDate !== new Date().toISOString().split('T')[0] && (
              <button
                onClick={() => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  setSelectedDate(todayStr);
                  addNotificationLog(
                    "Retorno a Hoy",
                    "La vista del plano ha vuelto al día de hoy.",
                    'system'
                  );
                }}
                className="bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/25 rounded-lg px-2 py-0.5 text-[9px] font-mono font-bold transition-all cursor-pointer"
                title="Volver a Hoy"
              >
                HOY
              </button>
            )}
          </div>
        </div>

        {/* Navigation Selector */}
        <div className="flex items-center gap-4">
          <div className="flex bg-brand-surface border border-brand-outline rounded-lg p-1 text-xs">
            <button
              onClick={() => setActiveTab('floor')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${
                activeTab === 'floor'
                  ? 'bg-brand-primary text-brand-surface font-bold shadow'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              <Layers className="w-4 h-4" />
              Plano de Mesas
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${
                activeTab === 'calendar'
                  ? 'bg-brand-primary text-brand-surface font-bold shadow'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Calendario &amp; Agenda
            </button>
            <button
              onClick={() => setActiveTab('menu')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${
                activeTab === 'menu'
                  ? 'bg-brand-primary text-brand-surface font-bold shadow'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Ver Carta
            </button>
            <button
              onClick={() => setActiveTab('customers')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${
                activeTab === 'customers'
                  ? 'bg-brand-primary text-brand-surface font-bold shadow'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              <Users className="w-4 h-4" />
              Clientes
            </button>
          </div>

          {/* Campanita / Notification dropdown button */}
          <div className="relative border-l border-brand-outline pl-4 flex items-center">
            <button
              onClick={handleToggleNotifications}
              className={`p-2 rounded-xl border border-brand-outline hover:border-brand-primary/40 bg-brand-surface hover:bg-brand-surface-high transition-all text-brand-text relative cursor-pointer ${
                isNotificationsOpen ? 'ring-2 ring-brand-primary/30 border-brand-primary text-brand-primary' : ''
              }`}
              title="Notificaciones"
            >
              <Bell className={`w-5 h-5 ${notifications.some(n => !n.read) ? 'animate-bounce' : ''}`} />
              {notifications.some(n => !n.read) && (
                <span className="absolute -top-1 -right-1 bg-brand-secondary text-brand-text text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-brand-bg leading-none shadow-md">
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </button>
            
            {/* Dropdown Menu */}
            <AnimatePresence>
              {isNotificationsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-12 z-50 w-80 shadow-2xl"
                >
                  <NotificationCenter
                    notifications={notifications}
                    onDismiss={handleDismissNotification}
                    onClearAll={handleClearAllNotifications}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Configuration & Simulators Dropdown Button */}
          <div className="relative border-l border-brand-outline pl-4 flex items-center">
            <button
              onClick={handleToggleConfigDropdown}
              className={`p-2 rounded-xl border border-brand-outline hover:border-brand-primary/40 bg-brand-surface hover:bg-brand-surface-high transition-all text-brand-text relative cursor-pointer ${
                isConfigDropdownOpen ? 'ring-2 ring-brand-primary/30 border-brand-primary text-brand-primary' : ''
              }`}
              title="Ajustes y Simuladores"
            >
              <SlidersHorizontal className="w-5 h-5" />
            </button>
            
            {/* Dropdown Menu for Configuration & Simulators */}
            <AnimatePresence>
              {isConfigDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-12 z-50 w-80 bg-brand-surface border border-brand-outline rounded-2xl p-4 shadow-2xl space-y-4 text-left"
                >
                  <div className="border-b border-brand-outline pb-2">
                    <h3 className="font-sans font-bold text-xs text-brand-text uppercase tracking-wider flex items-center gap-1.5">
                      <SlidersHorizontal className="w-4 h-4 text-brand-primary" />
                      Configuración y Simuladores
                    </h3>
                    <p className="text-[10px] text-brand-muted mt-0.5">Controla las alertas y el plano del sistema.</p>
                  </div>

                  {/* Config Options section */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] uppercase font-mono text-brand-muted font-bold tracking-wider">Configuración</h4>
                    
                    {/* Edit mode toggle option inside dropdown */}
                    <div className="flex items-center justify-between p-2.5 bg-brand-surface-high border border-brand-outline rounded-xl">
                      <span className="text-xs font-medium text-brand-text">Modo Edición Plano</span>
                      <button
                        onClick={() => {
                          setIsEditMode(!isEditMode);
                          addNotificationLog(
                            isEditMode ? "Modo Lectura Activo" : "Modo Edición Activo",
                            isEditMode ? "El plano ahora está guardado." : "Ahora puedes arrastrar las mesas en el plano y modificar sus propiedades.",
                            'system'
                          );
                        }}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          isEditMode ? 'bg-brand-primary' : 'bg-brand-surface border-brand-outline'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-brand-text shadow ring-0 transition duration-200 ease-in-out ${
                            isEditMode ? 'translate-x-4 bg-brand-surface' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Tolerance Checker Option */}
                    <div className="flex items-center justify-between p-2.5 bg-brand-surface-high border border-brand-outline rounded-xl">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-brand-text">Tolerancia Reserva (15 min)</span>
                        <span className="text-[9px] text-brand-muted">Libera citas atrasadas</span>
                      </div>
                      <button
                        onClick={() => {
                          setIsToleranceEnabled(!isToleranceEnabled);
                          addNotificationLog(
                            !isToleranceEnabled ? "Tolerancia Activada" : "Tolerancia Desactivada",
                            !isToleranceEnabled 
                              ? "Las reservas sin sentar se liberarán automáticamente pasados 15 minutos de su hora."
                              : "Las reservas ya no se cancelarán automáticamente después de 15 minutos de retraso.",
                            'system'
                          );
                        }}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          isToleranceEnabled ? 'bg-brand-primary' : 'bg-brand-surface border-brand-outline'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-brand-text shadow ring-0 transition duration-200 ease-in-out ${
                            isToleranceEnabled ? 'translate-x-4 bg-brand-surface' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Default Seated Table Duration Option */}
                    <div className="p-2.5 bg-brand-surface-high border border-brand-outline rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-brand-text">Límite por Defecto en Mesa</span>
                        <select
                          value={defaultSeatedDuration}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setDefaultSeatedDuration(val);
                            addNotificationLog(
                              "Límite de Ocupación Cambiado",
                              `El límite por defecto para mesas ocupadas se estableció en ${val} minutos.`,
                              'system'
                            );
                          }}
                          className="bg-brand-surface border border-brand-outline text-brand-text text-[11px] rounded px-1.5 py-0.5 focus:outline-none focus:border-brand-primary cursor-pointer font-sans"
                        >
                          <option value={15}>15 minutos</option>
                          <option value={30}>30 minutos</option>
                          <option value={60}>1 hora</option>
                          <option value={90}>1.5 horas</option>
                          <option value={120}>2 horas</option>
                          <option value={150}>2.5 horas</option>
                          <option value={180}>3 horas</option>
                          <option value={240}>4 horas</option>
                        </select>
                      </div>
                      <span className="text-[9px] text-brand-muted block">Tiempo sugerido para liberar mesas automáticamente tras sentarse.</span>
                    </div>

                    {/* PDF upload option */}
                    <div className="p-2.5 bg-brand-surface-high border border-brand-outline rounded-xl space-y-2">
                      <span className="text-[10px] uppercase font-mono text-brand-muted block font-bold">Carta Digital (PDF)</span>
                      {pdfFile ? (
                        <div className="flex items-center justify-between gap-1.5 min-w-0 bg-brand-surface border border-brand-outline p-2 rounded-lg text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                            <span className="font-mono text-brand-text truncate font-bold">{pdfFileName}</span>
                          </div>
                          <button
                            type="button"
                            onClick={handlePdfRemove}
                            className="text-red-400 hover:text-red-300 font-sans font-bold text-[10px] shrink-0 cursor-pointer ml-1"
                          >
                            Quitar
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center border border-dashed border-brand-outline hover:border-brand-primary/40 rounded-lg p-2.5 bg-brand-surface hover:bg-brand-surface/80 transition-colors cursor-pointer text-center">
                          <Upload className="w-4 h-4 text-brand-primary mb-1" />
                          <span className="text-[10px] font-sans font-bold text-brand-text">Cargar archivo .pdf</span>
                          <span className="text-[8px] text-brand-muted mt-0.5">Sube el menú oficial</span>
                          <input
                            type="file"
                            accept=".pdf"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                if (file.type !== 'application/pdf') {
                                  alert('Por favor, selecciona un archivo PDF válido.');
                                  return;
                                }
                                if (file.size > 4.5 * 1024 * 1024) {
                                  alert('El archivo es demasiado grande (máximo 4.5MB). Sube un PDF más optimizado.');
                                  return;
                                }
                                const reader = new FileReader();
                                reader.onload = (event) => {
                                  if (event.target?.result && typeof event.target.result === 'string') {
                                    handlePdfUpload(event.target.result, file.name);
                                    setActiveTab('menu');
                                    setIsConfigDropdownOpen(false);
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Simulator Options section */}
                  <div className="space-y-2.5">
                    <h4 className="text-[10px] uppercase font-mono text-brand-muted font-bold tracking-wider">Simuladores Push &amp; Voz</h4>
                    
                    {/* Daily reminder confirmation sender */}
                    <button
                      onClick={handleSimulateDailyReminder}
                      className="w-full flex items-center justify-between p-2.5 bg-brand-surface-high hover:bg-brand-surface-highest border border-brand-outline hover:border-brand-primary/30 rounded-xl transition-all text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-2">
                        <div className="bg-brand-primary/10 p-1.5 rounded-lg border border-brand-primary/20">
                          <Mail className="w-4 h-4 text-brand-primary" />
                        </div>
                        <div>
                          <h4 className="font-sans font-bold text-xs text-brand-text group-hover:text-brand-primary transition-colors">Recordatorios Diarios</h4>
                          <p className="text-[9px] text-brand-muted">Reconfirmación SMS/WhatsApp</p>
                        </div>
                      </div>
                      <span className="text-[9px] font-mono text-brand-primary font-bold shrink-0">Enviar</span>
                    </button>

                    {/* 15 min before alert trigger */}
                    <button
                      onClick={handleSimulate15MinWarning}
                      className="w-full flex items-center justify-between p-2.5 bg-brand-surface-high hover:bg-brand-surface-highest border border-brand-outline hover:border-brand-tertiary/30 rounded-xl transition-all text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-2">
                        <div className="bg-brand-tertiary/10 p-1.5 rounded-lg border border-brand-tertiary/20">
                          <Clock className="w-4 h-4 text-brand-tertiary" />
                        </div>
                        <div>
                          <h4 className="font-sans font-bold text-xs text-brand-text group-hover:text-brand-tertiary transition-colors">Arribo Inminente</h4>
                          <p className="text-[9px] text-brand-muted">Aviso de llegada en 15m</p>
                        </div>
                      </div>
                      <span className="text-[9px] font-mono text-brand-tertiary font-bold shrink-0">Ejecutar</span>
                    </button>

                    {/* Incoming Voice call simulator button */}
                    <button
                      onClick={() => {
                        handleReceiveIncomingCall();
                        setIsConfigDropdownOpen(false); // Close dropdown to view simulator overlay
                      }}
                      className="w-full flex items-center justify-between p-2.5 bg-brand-secondary/10 hover:bg-brand-secondary/20 border border-brand-secondary/30 rounded-xl transition-all text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-2">
                        <div className="bg-brand-secondary/20 p-1.5 rounded-lg border border-brand-secondary/30">
                          <PhoneCall className="w-4 h-4 text-brand-secondary" />
                        </div>
                        <div>
                          <h4 className="font-sans font-bold text-xs text-brand-text">Simular LLAMADA AI</h4>
                          <p className="text-[9px] text-brand-muted">Reserva telefónica con Gemini</p>
                        </div>
                      </div>
                      <span className="text-[9px] font-mono text-brand-secondary font-bold animate-pulse shrink-0">
                        Ring!
                      </span>
                    </button>
                  </div>

                  {/* Reset Defaults button */}
                  <div className="pt-2 border-t border-brand-outline flex justify-between items-center text-[10px] text-brand-muted/70">
                    <span>Restablecer sistema:</span>
                    <button
                      onClick={() => {
                        handleResetDefaults();
                        setIsConfigDropdownOpen(false);
                      }}
                      className="hover:text-brand-secondary underline cursor-pointer flex items-center gap-0.5"
                    >
                      <RotateCcw className="w-3 h-3" /> Restaurar por defecto
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Main Core View Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        
        {/* Left Side: Operations Sidebar & Simulators Panel (lg:span-3) */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          
          {/* Quick Metrics Dashboard Card */}
          <div className="bg-brand-surface border border-brand-outline rounded-2xl p-4 space-y-4">
            <h3 className="font-sans font-bold text-xs text-brand-text uppercase tracking-wider">
              Estado de Ocupación
            </h3>
            
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-brand-surface-low border border-brand-outline p-2.5 rounded-xl">
                <span className="text-[9px] uppercase font-mono text-brand-muted block">Mesas Libres</span>
                <strong className="text-zinc-400 text-xl font-mono mt-1 block">{freeTablesCount}</strong>
              </div>
              <div className="bg-brand-surface-low border border-brand-outline p-2.5 rounded-xl">
                <span className="text-[9px] uppercase font-mono text-brand-muted block">Ocupadas</span>
                <strong className="text-brand-secondary text-xl font-mono mt-1 block">{occupiedTablesCount}</strong>
              </div>
              <div className="bg-brand-surface-low border border-brand-outline p-2.5 rounded-xl">
                <span className="text-[9px] uppercase font-mono text-brand-muted block">Reservadas</span>
                <strong className="text-brand-tertiary text-xl font-mono mt-1 block">{reservedTablesCount}</strong>
              </div>
              <div className="bg-brand-surface-low border border-brand-outline p-2.5 rounded-xl">
                <span className="text-[9px] uppercase font-mono text-brand-muted block">Capacidad</span>
                <strong className="text-brand-text text-xl font-mono mt-1 block">{totalTables}</strong>
              </div>
            </div>

            {/* Quick action: Book a table manually */}
            <button
              onClick={() => {
                // Find first free table
                const freeT = tables.find(t => t.status === 'free');
                if (freeT) {
                  handleSelectTable(freeT.id);
                } else {
                  alert('Todas las mesas están ocupadas. Puedes liberar alguna o añadir más mesas en el switch "Editar Plano" superior.');
                }
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-surface-high hover:bg-brand-surface-highest border border-brand-outline text-brand-text font-sans font-bold text-xs rounded-xl cursor-pointer transition-colors"
            >
              <PlusCircle className="w-4.5 h-4.5 text-brand-primary" />
              Nueva Reserva Rápida
            </button>
          </div>
        </div>

        {/* Center: Main View Area (FloorPlan / CalendarView) (lg:span-9) */}
        <div className="lg:col-span-9 flex flex-col gap-6">
          {activeTab === 'floor' ? (
            <div className="flex-1 h-full min-h-[450px]">
              <FloorPlan
                tables={tables}
                reservations={reservations}
                selectedTableId={selectedTableId}
                onSelectTable={handleSelectTable}
                isEditMode={isEditMode}
                onUpdateTable={handleUpdateTable}
                onAddTable={handleAddTable}
                onDeleteTable={handleDeleteTable}
                decorations={decorations}
                onUpdateDecoration={handleUpdateDecoration}
                onAddDecoration={handleAddDecoration}
                onDeleteDecoration={handleDeleteDecoration}
                selectedDate={selectedDate}
                currentTime={currentTime}
                isToleranceEnabled={isToleranceEnabled}
              />
            </div>
          ) : activeTab === 'calendar' ? (
            <div className="flex-1 h-full min-h-[450px]">
              <CalendarView
                reservations={reservations}
                tables={tables}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onEditReservation={(res) => {
                  setSelectedTableId(res.tableId);
                  setIsBookingModalOpen(true);
                }}
                onCancelReservation={handleCancelReservation}
                onSeatedReservation={handleSeatedReservation}
                onCompleteReservation={handleCompleteReservation}
              />
            </div>
          ) : activeTab === 'menu' ? (
            <div className="flex-1 h-full min-h-[450px]">
              <MenuView
                pdfFile={pdfFile}
                pdfFileName={pdfFileName}
                onPdfUpload={handlePdfUpload}
                onPdfRemove={handlePdfRemove}
              />
            </div>
          ) : (
            <div className="flex-1 h-full min-h-[450px]">
              <CustomersView customers={customers} />
            </div>
          )}
        </div>

      </main>

      {/* Popups Overlays */}
      
      {/* 1. Reservation Modal Details Form */}
      <ReservationModal
        isOpen={isBookingModalOpen}
        onClose={() => {
          setIsBookingModalOpen(false);
          setSelectedTableId(null);
        }}
        table={tables.find(t => t.id === selectedTableId) || null}
        activeReservation={getActiveReservationForSelectedTable()}
        onSaveReservation={handleSaveReservation}
        onCancelReservation={handleCancelReservation}
        onSeatedReservation={handleSeatedReservation}
        onCompleteReservation={handleCompleteReservation}
      />

      {/* 2. Telefonía AI Calling Simulator Screen (agente real sobre Claude) */}
      <CallSimulator
        isOpen={isCallOpen}
        onClose={() => setIsCallOpen(false)}
        onReservationCreated={() => {
          // El agente ya creó la reserva en Airtable; refrescamos el plano.
          refreshFromServer(false);
        }}
        onAddNotification={addNotificationLog}
      />

    </div>
  );
}
