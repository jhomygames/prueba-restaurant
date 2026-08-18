import React, { useEffect, useState } from 'react';
import { CalendarClock, Check, Loader2, Plus, Trash2, AlertCircle, Clock } from 'lucide-react';
import * as api from '../api';
import type { Turno } from '../api';

/**
 * Horario de servicio de COCINA.
 *
 * Un restaurante en España no abre "de X a Y": sirve a mediodía, para, y vuelve
 * a servir por la noche. Por eso esto son FRANJAS y no un intervalo: con un solo
 * tramo de 13:00 a 23:30 se podría reservar a las seis de la tarde, cuando la
 * cocina está apagada.
 *
 * OJO CON LO QUE ESTO **NO** ES: no es la hora a la que se cierra el local. Lo
 * único que limita es a qué hora puede EMPEZAR una reserva. Una mesa que entra a
 * las 23:30 sigue ocupada hasta la 01:30 y eso es correcto: la cocina ha cerrado
 * pero la gente sigue sentada. El cálculo de ocupación no se recorta por el
 * horario a propósito.
 *
 * Lo que se guarda aquí lo respetan por igual el panel, WhatsApp y el agente de
 * voz, porque los tres preguntan al mismo sitio antes de aceptar una reserva. A
 * Vapi no hay que tocarle nada.
 */

// La base guarda 1 = lunes … 7 = domingo. Cuidado al mezclarlo con
// `Date.getDay()`, que cuenta 0 = domingo.
const DIAS = [
  { n: 1, corto: 'L', largo: 'lunes' },
  { n: 2, corto: 'M', largo: 'martes' },
  { n: 3, corto: 'X', largo: 'miércoles' },
  { n: 4, corto: 'J', largo: 'jueves' },
  { n: 5, corto: 'V', largo: 'viernes' },
  { n: 6, corto: 'S', largo: 'sábado' },
  { n: 7, corto: 'D', largo: 'domingo' },
];

type Franja = Omit<Turno, 'id'>;

const FRANJA_NUEVA: Franja = {
  nombre: 'comida',
  horaInicio: '13:00',
  horaFin: '16:30',
  dias: [1, 2, 3, 4, 5, 6, 7],
  activo: true,
};

/** Frase corrida con el horario, para leerlo de un vistazo sin descifrar la tabla. */
function resumir(franjas: Franja[]): { texto: string; cerrados: string[] } {
  const activas = franjas.filter((f) => f.activo);
  const abiertos = new Set(activas.flatMap((f) => f.dias));
  const cerrados = DIAS.filter((d) => !abiertos.has(d.n)).map((d) => d.largo);

  if (activas.length === 0) {
    return { texto: 'No hay ninguna franja activa: ahora mismo no se admite ninguna reserva.', cerrados };
  }

  const texto = activas
    .map((f) => `${f.nombre} de ${f.horaInicio} a ${f.horaFin}`)
    .join(' · ');

  return { texto, cerrados };
}

interface Props {
  onNotify: (title: string, message: string) => void;
  /**
   * Avisa al panel de que el horario cambió.
   *
   * Hace falta porque el calendario de cada mesa se dibuja con los turnos que
   * el panel cargó al arrancar: sin este aviso seguiría enseñando el horario
   * viejo hasta el siguiente sondeo, justo cuando el usuario acaba de cambiarlo
   * y va a comprobarlo.
   */
  onHorarioGuardado?: () => void;
}

export const HorarioServicio: React.FC<Props> = ({ onNotify, onHorarioGuardado }) => {
  const [franjas, setFranjas] = useState<Franja[]>([]);
  const [duracion, setDuracion] = useState(120);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Franja señalada por el backend como culpable, para marcarla en su sitio en
  // vez de soltar el error suelto arriba y que el usuario lo busque.
  const [filaMala, setFilaMala] = useState<number | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    api
      .fetchTurnos()
      .then((c) => {
        setFranjas(c.turnos.map(({ id, ...resto }) => resto));
        setDuracion(c.duracionReservaMin);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);

  const cambiar = (i: number, patch: Partial<Franja>) => {
    setFranjas((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    setGuardado(false);
  };

  const alternarDia = (i: number, dia: number) => {
    const actual = franjas[i].dias;
    cambiar(i, {
      dias: actual.includes(dia) ? actual.filter((d) => d !== dia) : [...actual, dia].sort((a, b) => a - b),
    });
  };

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    setFilaMala(null);
    try {
      const c = await api.saveTurnos({ duracionReservaMin: duracion, turnos: franjas });
      setFranjas(c.turnos.map(({ id, ...resto }) => resto));
      setDuracion(c.duracionReservaMin);
      setGuardado(true);
      onNotify('Horario actualizado', `${resumir(c.turnos).texto}. Ya lo aplican el panel y el agente de voz.`);
      onHorarioGuardado?.();
    } catch (e: any) {
      setError(e.message);
      const i = e.cuerpo?.indice;
      if (typeof i === 'number') setFilaMala(i);
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) {
    return (
      <div className="bg-brand-surface border border-brand-outline rounded-2xl p-6 flex items-center gap-2 text-xs text-brand-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando el horario...
      </div>
    );
  }

  const { texto, cerrados } = resumir(franjas);

  return (
    <div className="bg-brand-surface border border-brand-outline rounded-2xl overflow-hidden">
      <div className="px-5 py-4 bg-brand-surface-low border-b border-brand-outline flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary">
          <CalendarClock className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-sans font-bold text-sm text-brand-text">Horario de servicio de cocina</h3>
          <p className="text-[10px] text-brand-muted">A qué horas puede empezar una reserva. Lo respetan el panel y el agente de voz</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Resumen legible: es lo que se consulta el 90% de las veces */}
        <div className="bg-brand-surface-low border border-brand-outline rounded-xl p-3.5 space-y-1.5">
          <p className="text-xs text-brand-text font-sans leading-relaxed">{texto}</p>
          {cerrados.length > 0 && (
            <p className="text-[11px] text-brand-muted">
              Cerrado: <span className="text-brand-secondary font-medium">{cerrados.join(', ')}</span>
            </p>
          )}
          <p className="text-[10px] text-brand-muted/70 pt-1 border-t border-brand-outline/50">
            Fuera de estas horas ni el panel ni el agente de voz dejan <strong>empezar</strong> una
            reserva. No es la hora de cierre del local: una mesa que entra a última hora sigue
            ocupada después, y eso se cuenta como debe ser.
          </p>
        </div>

        {/* Franjas */}
        <div className="space-y-2.5">
          {franjas.map((f, i) => (
            <div
              key={i}
              className={`rounded-xl border p-3 space-y-2.5 ${
                filaMala === i
                  ? 'border-red-500/50 bg-red-500/5'
                  : f.activo
                    ? 'border-brand-outline bg-brand-surface-low'
                    : 'border-brand-outline/50 bg-brand-surface-low/40 opacity-60'
              }`}
            >
              <div className="flex flex-wrap items-end gap-2.5">
                <div>
                  <label className="text-[9px] uppercase font-mono text-brand-muted block mb-1">Turno</label>
                  <select
                    value={f.nombre}
                    onChange={(e) => cambiar(i, { nombre: e.target.value as 'comida' | 'cena' })}
                    className="bg-brand-surface border border-brand-outline rounded-lg px-2.5 py-1.5 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary cursor-pointer"
                  >
                    <option value="comida">Comida</option>
                    <option value="cena">Cena</option>
                  </select>
                </div>

                <div>
                  <label className="text-[9px] uppercase font-mono text-brand-muted block mb-1">Desde</label>
                  <input
                    type="time"
                    value={f.horaInicio}
                    onChange={(e) => cambiar(i, { horaInicio: e.target.value })}
                    className="bg-brand-surface border border-brand-outline rounded-lg px-2.5 py-1.5 text-xs text-brand-text font-mono focus:outline-none focus:border-brand-primary cursor-pointer"
                  />
                </div>

                <div>
                  <label className="text-[9px] uppercase font-mono text-brand-muted block mb-1">Hasta</label>
                  <input
                    type="time"
                    value={f.horaFin}
                    onChange={(e) => cambiar(i, { horaFin: e.target.value })}
                    className="bg-brand-surface border border-brand-outline rounded-lg px-2.5 py-1.5 text-xs text-brand-text font-mono focus:outline-none focus:border-brand-primary cursor-pointer"
                  />
                  <p className="text-[9px] text-brand-muted/70 mt-1">Última entrada, no el cierre</p>
                </div>

                <div className="flex-1 flex items-center justify-end gap-2">
                  <label className="flex items-center gap-1.5 text-[10px] text-brand-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={f.activo}
                      onChange={(e) => cambiar(i, { activo: e.target.checked })}
                      className="w-3.5 h-3.5 accent-brand-primary cursor-pointer"
                    />
                    Activa
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setFranjas((prev) => prev.filter((_, j) => j !== i));
                      setGuardado(false);
                    }}
                    title="Eliminar esta franja"
                    className="text-brand-muted hover:text-red-400 transition-colors cursor-pointer p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <span className="text-[9px] uppercase font-mono text-brand-muted block mb-1.5">Días</span>
                <div className="flex gap-1">
                  {DIAS.map((d) => {
                    const puesto = f.dias.includes(d.n);
                    return (
                      <button
                        key={d.n}
                        type="button"
                        onClick={() => alternarDia(i, d.n)}
                        title={d.largo}
                        className={`w-7 h-7 rounded-lg text-[11px] font-sans font-bold border transition-all cursor-pointer ${
                          puesto
                            ? 'bg-brand-primary/15 border-brand-primary text-brand-primary'
                            : 'bg-brand-surface border-brand-outline text-brand-muted hover:border-brand-muted/40'
                        }`}
                      >
                        {d.corto}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              setFranjas((prev) => [...prev, { ...FRANJA_NUEVA }]);
              setGuardado(false);
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-brand-outline text-brand-muted hover:text-brand-text hover:border-brand-muted/50 text-xs font-sans transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Añadir franja
          </button>
        </div>

        {/* Duración estándar */}
        <div className="bg-brand-surface-low border border-brand-outline rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-brand-text font-sans font-bold text-[11px] uppercase tracking-wider">
              <Clock className="w-4 h-4 text-brand-primary" />
              Duración estándar de una mesa
            </div>
            <div className="font-mono text-xs font-bold bg-brand-primary/10 text-brand-primary px-2 py-0.5 rounded border border-brand-primary/20">
              {duracion} min ({Math.floor(duracion / 60)}h {duracion % 60}m)
            </div>
          </div>
          <input
            type="range"
            min="15"
            max="240"
            step="15"
            value={duracion}
            onChange={(e) => {
              setDuracion(Number(e.target.value));
              setGuardado(false);
            }}
            className="w-full accent-brand-primary cursor-pointer h-1 bg-brand-surface rounded-lg border border-brand-outline"
          />
          <p className="text-[10px] text-brand-muted/80 leading-relaxed">
            Cuánto se da por ocupada una mesa cuando la reserva no trae una duración propia.
            Es lo que decide si dos reservas de la misma mesa se pisan. Puede pasar de la hora
            de cierre de cocina sin problema: la última mesa de la noche se levanta cuando toca.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg p-2.5 text-[11px] border bg-red-500/10 border-red-500/25 text-red-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}
        {guardado && !error && (
          <div className="flex items-start gap-2 rounded-lg p-2.5 text-[11px] border bg-emerald-500/10 border-emerald-500/25 text-emerald-300">
            <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="leading-relaxed">Horario guardado. Ya lo aplican el panel y el agente de voz.</span>
          </div>
        )}

        <button
          onClick={guardar}
          disabled={guardando}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-sans font-bold cursor-pointer transition-all disabled:opacity-50 bg-brand-primary text-brand-surface hover:bg-brand-primary/90"
        >
          {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar horario
        </button>
      </div>
    </div>
  );
};
