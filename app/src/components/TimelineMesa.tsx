import React, { useMemo, useState } from 'react';
import { CalendarClock, AlertTriangle, Lock, ChevronDown, Plus } from 'lucide-react';
import type { Reservation } from '../types';
import type { Turno } from '../api';
import { minutosDe } from '../turnos';

/**
 * Agenda vertical de UNA mesa a lo largo de UN día.
 *
 * Una reserva no es un instante sino un tramo: que la mesa 4 esté "reservada a
 * las 17:00" no dice nada hasta que se ve que eso ocupa hasta las 19:00 y que a
 * las 18:00 no cabe nadie. Por eso los bloques se dibujan a escala sobre una
 * columna de horas, y no como una lista.
 *
 * Es INTERACTIVA, y esa es la parte que importa:
 *   - pulsar una hora libre lleva la reserva que se está creando a esa hora
 *   - pulsar un bloque ocupado abre ESA reserva para editarla
 *   - el botón de abajo empieza una reserva nueva sin salir de aquí
 *
 * Sin eso, una mesa con una reserva a las 14:00 quedaba bloqueada el día entero:
 * el panel abría siempre esa reserva y no había forma de añadir la cena. Ese era
 * justo el caso para el que se hizo todo esto.
 *
 * Solo se dibujan las horas en las que la cocina sirve; el hueco entre comida y
 * cena no aparece en gris, no aparece. Pero un bloque SÍ puede salirse por abajo:
 * que la cocina cierre a las 23:30 no vacía la sala, y una mesa que entra a esa
 * hora sigue ocupada hasta la 01:30.
 *
 * Pinta, no decide: el servidor revalida al guardar. Aun así el cálculo de
 * tramos es el mismo que el suyo, para que no pueda enseñar una cosa y aceptarse
 * otra.
 */

const PASO = 30;      // minutos por fila
const ALTO_FILA = 30; // px por fila

interface Props {
  turnos: Turno[];
  fecha: string;
  /** Reservas vivas de ESTA mesa en ESTE día. */
  reservasDelDia: Reservation[];
  duracionPorDefecto: number;
  horaSeleccionada: string;
  duracionSeleccionada: number;
  /** La que se está editando: se resalta, y no se cuenta como obstáculo de sí misma. */
  reservaEditandoId?: string;
  onElegirHora: (hora: string) => void;
  /** Pulsar un bloque ocupado: pasa a editar esa reserva. */
  onElegirReserva: (r: Reservation) => void;
  /** Empezar una reserva nueva en esta mesa. */
  onNuevaReserva: () => void;
}

/** 1 = lunes … 7 = domingo, como en la base. `getDay()` cuenta 0 = domingo. */
function diaSemana(fecha: string): number {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60) % 24;
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface Bloque {
  reserva: Reservation;
  ini: number;
  fin: number;
}

export const TimelineMesa: React.FC<Props> = ({
  turnos,
  fecha,
  reservasDelDia,
  duracionPorDefecto,
  horaSeleccionada,
  duracionSeleccionada,
  reservaEditandoId,
  onElegirHora,
  onElegirReserva,
  onNuevaReserva,
}) => {
  const [abierta, setAbierta] = useState(true);
  const dia = diaSemana(fecha);

  const franjas = useMemo(
    () =>
      turnos
        .filter((t) => t.activo && t.dias.includes(dia))
        .sort((a, b) => minutosDe(a.horaInicio) - minutosDe(b.horaInicio)),
    [turnos, dia]
  );

  /**
   * El final se suma en crudo y NO se pasa por `horaDeSalida`: esa devuelve la
   * hora ya envuelta ("01:30"), y volver a convertirla a minutos daba 90 en vez
   * de 1530. Con eso, toda reserva que cruzara medianoche dejaba de contar.
   */
  const bloques: Bloque[] = useMemo(
    () =>
      reservasDelDia
        .map((r) => {
          const ini = minutosDe(r.time);
          return { reserva: r, ini, fin: ini + (r.customDurationMinutes || duracionPorDefecto) };
        })
        .sort((a, b) => a.ini - b.ini),
    [reservasDelDia, duracionPorDefecto]
  );

  const ajenos = bloques.filter((b) => b.reserva.id !== reservaEditandoId);

  const propioIni = minutosDe(horaSeleccionada);
  const propioFin = propioIni + duracionSeleccionada;

  // Fin excluido: una que acaba a las 19:00 y otra que empieza a las 19:00 no
  // chocan. Mismo criterio que aplica el servidor.
  const choque = ajenos.find((b) => propioIni < b.fin && b.ini < propioFin);

  const suFranja = franjas.find(
    (f) => propioIni >= minutosDe(f.horaInicio) && propioIni <= minutosDe(f.horaFin)
  );
  const seAlargaTrasElCierre = Boolean(suFranja) && propioFin > minutosDe(suFranja.horaFin);

  if (franjas.length === 0) {
    return (
      <div className="bg-brand-surface-low border border-brand-outline rounded-xl p-4 flex items-start gap-2.5">
        <Lock className="w-4 h-4 text-brand-secondary shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-xs font-sans font-bold text-brand-text">Ese día el restaurante está cerrado</p>
          <p className="text-[10px] text-brand-muted leading-relaxed">
            No hay ningún turno de servicio configurado para ese día de la semana.
            Se cambia en Configuración → Horario de servicio.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-brand-surface-low border border-brand-outline rounded-xl overflow-hidden">
      {/* Cabecera: el resumen se ve siempre, la agenda se pliega */}
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 hover:bg-brand-surface/40 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5 text-brand-text font-sans font-bold text-[11px] uppercase tracking-wider">
          <CalendarClock className="w-4 h-4 text-brand-primary" />
          Ocupación de la mesa
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-brand-muted normal-case font-sans">
            {bloques.length === 0
              ? 'Sin reservas ese día'
              : `${bloques.length} reserva${bloques.length > 1 ? 's' : ''} ese día`}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-brand-muted transition-transform ${abierta ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {abierta && (
        <div className="px-3.5 pb-3.5 space-y-3 border-t border-brand-outline/60 pt-3">
          <p className="text-[10px] text-brand-muted">
            Pulsa una hora libre para llevar la reserva ahí · pulsa un bloque para abrir esa reserva
          </p>

          {franjas.map((f) => {
            const desde = minutosDe(f.horaInicio);
            const hasta = minutosDe(f.horaFin);
            const filas: number[] = [];
            for (let m = desde; m <= hasta; m += PASO) filas.push(m);
            const alto = filas.length * ALTO_FILA;

            // Píxeles desde el borde superior de esta franja.
            const y = (min: number) => ((min - desde) / PASO) * ALTO_FILA;

            const enEstaFranja = (b: Bloque) => b.fin > desde && b.ini <= hasta;
            const colas = bloques.filter((b) => b.ini <= hasta && b.fin > hasta);

            return (
              <div key={f.id} className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-sans font-bold text-brand-text capitalize">{f.nombre}</span>
                  <span className="text-[9px] font-mono text-brand-muted">
                    {f.horaInicio} – {f.horaFin}
                  </span>
                  <span className="text-[9px] text-brand-muted/60">últimas entradas</span>
                </div>

                <div className="flex">
                  {/* Columna de horas */}
                  <div className="w-11 shrink-0" style={{ height: alto }}>
                    {filas.map((m) => (
                      <div
                        key={m}
                        className="text-[9px] font-mono text-brand-muted/70 text-right pr-2"
                        style={{ height: ALTO_FILA, lineHeight: '10px' }}
                      >
                        {aHora(m)}
                      </div>
                    ))}
                  </div>

                  {/* Pista: filas pulsables debajo, bloques ocupados encima */}
                  <div className="relative flex-1 border-l border-brand-outline" style={{ height: alto }}>
                    {filas.map((m) => {
                      const finSiEmpiezaAqui = m + duracionSeleccionada;
                      const tapada = ajenos.some((b) => m < b.fin && b.ini < m + PASO);
                      // Una hora que empieza libre pero cuya reserva se saldría
                      // encima de la siguiente tampoco vale: avisarlo después de
                      // elegirla sería hacerle perder el tiempo a quien atiende.
                      const noCabe = !tapada && ajenos.some((b) => m < b.fin && b.ini < finSiEmpiezaAqui);
                      const elegida = m === propioIni;

                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={tapada}
                          onClick={() => onElegirHora(aHora(m))}
                          title={
                            tapada
                              ? 'Ocupada'
                              : noCabe
                                ? `A las ${aHora(m)} no caben ${duracionSeleccionada} min sin pisar la siguiente reserva`
                                : `Reservar a las ${aHora(m)}`
                          }
                          className={`absolute left-0 right-0 border-b border-brand-outline/40 transition-colors ${
                            tapada
                              ? 'cursor-default'
                              : elegida
                                ? 'cursor-pointer'
                                : noCabe
                                  ? 'bg-brand-tertiary/5 hover:bg-brand-tertiary/15 cursor-pointer'
                                  : 'hover:bg-brand-primary/10 cursor-pointer'
                          }`}
                          style={{ top: y(m), height: ALTO_FILA }}
                        />
                      );
                    })}

                    {/* La reserva que se está rellenando ahora mismo */}
                    {propioIni >= desde && propioIni <= hasta && (
                      <div
                        className={`absolute left-1 right-1 rounded-md border-2 border-dashed pointer-events-none flex items-center px-2 ${
                          choque ? 'border-red-400/70 bg-red-500/15' : 'border-brand-primary bg-brand-primary/15'
                        }`}
                        style={{
                          top: y(propioIni),
                          height: Math.max(ALTO_FILA * 0.7, y(Math.min(propioFin, hasta + PASO)) - y(propioIni)),
                        }}
                      >
                        <span
                          className={`text-[9px] font-mono font-bold ${choque ? 'text-red-300' : 'text-brand-primary'}`}
                        >
                          {horaSeleccionada}–{aHora(propioFin)} · esta reserva
                        </span>
                      </div>
                    )}

                    {/* Bloques ocupados, a escala */}
                    {bloques.filter(enEstaFranja).map((b) => {
                      const editandose = b.reserva.id === reservaEditandoId;
                      const arriba = Math.max(0, y(b.ini));
                      const abajo = Math.min(y(b.fin), alto);
                      return (
                        <button
                          key={b.reserva.id}
                          type="button"
                          onClick={() => onElegirReserva(b.reserva)}
                          title={`${b.reserva.customerName} · ${b.reserva.pax} pax · ${aHora(b.ini)}–${aHora(b.fin)} · pulsa para abrirla`}
                          className={`absolute left-1 right-1 rounded-md border px-2 py-1 text-left overflow-hidden cursor-pointer transition-colors ${
                            editandose
                              ? 'border-brand-primary bg-brand-primary/25 hover:bg-brand-primary/35'
                              : 'border-brand-secondary/50 bg-brand-secondary/20 hover:bg-brand-secondary/30'
                          }`}
                          style={{ top: arriba, height: Math.max(ALTO_FILA * 0.8, abajo - arriba) }}
                        >
                          <span
                            className={`block text-[10px] font-sans font-bold leading-tight truncate ${
                              editandose ? 'text-brand-primary' : 'text-brand-secondary'
                            }`}
                          >
                            {b.reserva.customerName}
                          </span>
                          <span className="block text-[9px] font-mono text-brand-muted leading-tight">
                            {aHora(b.ini)}–{aHora(b.fin)} · {b.reserva.pax} pax
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* La cocina cierra, la sala no. Sin esto la mesa parecería libre. */}
                {colas.map((c) => (
                  <p key={c.reserva.id} className="text-[10px] text-brand-muted pl-11">
                    <span className="text-brand-secondary">↳</span> {c.reserva.customerName} sigue en
                    mesa hasta las <span className="font-mono text-brand-text">{aHora(c.fin)}</span>,
                    después de la última entrada de {f.nombre}.
                  </p>
                ))}
              </div>
            );
          })}

          <button
            type="button"
            onClick={onNuevaReserva}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-brand-outline text-brand-muted hover:text-brand-text hover:border-brand-primary/60 text-xs font-sans transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Nueva reserva en esta mesa
          </button>

          {choque ? (
            <div className="flex items-start gap-2 rounded-lg p-2.5 text-[11px] border bg-red-500/10 border-red-500/25 text-red-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="leading-relaxed">
                De {horaSeleccionada} a {aHora(propioFin)} choca con la reserva de{' '}
                <strong>{choque.reserva.customerName}</strong> ({aHora(choque.ini)}–{aHora(choque.fin)}).
                Elige otra hora.
              </span>
            </div>
          ) : (
            <p className="text-[10px] text-brand-muted">
              Esta reserva ocuparía de{' '}
              <span className="font-mono text-brand-primary">{horaSeleccionada}</span> a{' '}
              <span className="font-mono text-brand-primary">{aHora(propioFin)}</span>
              {seAlargaTrasElCierre && (
                <span className="text-brand-muted/70"> · acaba después del cierre de cocina, y no pasa nada</span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
