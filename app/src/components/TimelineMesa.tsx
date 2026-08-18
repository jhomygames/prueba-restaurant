import React, { useMemo } from 'react';
import { CalendarClock, AlertTriangle, Lock } from 'lucide-react';
import type { Reservation } from '../types';
import type { Turno } from '../api';
import { minutosDe } from '../turnos';

/**
 * Ocupación de UNA mesa a lo largo de UN día.
 *
 * Es la pieza que faltaba para reservar sin adivinar: una reserva no es un
 * instante, es un tramo. Que la mesa 4 esté "reservada a las 17:00" no dice nada
 * hasta que se ve que eso ocupa hasta las 19:00 y que a las 18:00 no cabe nadie.
 *
 * Solo se dibujan las horas en las que la cocina sirve. Los huecos entre comida
 * y cena no aparecen en gris: no aparecen. Es la forma más clara de enseñar el
 * horario, y coincide con lo que el servidor va a aceptar.
 *
 * Pero la rejilla es solo de ENTRADAS. Que la cocina cierre a las 23:30 no
 * significa que la sala se vacíe: una mesa que entra a esa hora sigue ocupada
 * hasta la 01:30, y eso hay que verlo. Por eso, cuando una reserva se alarga más
 * allá de su franja, se anota debajo en vez de dejar que desaparezca al llegar
 * al borde de la rejilla.
 *
 * El servidor vuelve a comprobarlo todo al guardar; esto pinta, no decide. Aun
 * así el cálculo de tramos es el mismo que el suyo a propósito, para que no
 * pueda enseñar una cosa y aceptarse otra.
 */

const PASO = 15; // minutos por casilla

interface Props {
  turnos: Turno[];
  fecha: string;
  /** Reservas vivas de ESTA mesa en ESTE día. */
  reservasDelDia: Reservation[];
  duracionPorDefecto: number;
  horaSeleccionada: string;
  duracionSeleccionada: number;
  /** La que se está editando: no se cuenta como obstáculo de sí misma. */
  reservaEditandoId?: string;
  onElegirHora: (hora: string) => void;
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
  ini: number;
  fin: number;
  nombre: string;
  pax: number;
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
}) => {
  const dia = diaSemana(fecha);

  const franjas = useMemo(
    () =>
      turnos
        .filter((t) => t.activo && t.dias.includes(dia))
        .sort((a, b) => minutosDe(a.horaInicio) - minutosDe(b.horaInicio)),
    [turnos, dia]
  );

  const bloques: Bloque[] = useMemo(
    () =>
      reservasDelDia
        .filter((r) => r.id !== reservaEditandoId)
        .map((r) => {
          const ini = minutosDe(r.time);
          return {
            ini,
            // El final se suma en crudo y NO se pasa por `horaDeSalida`: esa
            // devuelve la hora ya envuelta ("01:30"), y volver a convertirla a
            // minutos daba 90 en vez de 1530. Con eso, toda reserva que pasara
            // de medianoche dejaba de contar como ocupada. Se calcula igual que
            // en el servidor; envolver es cosa de `aHora()`, solo al pintar.
            fin: ini + (r.customDurationMinutes || duracionPorDefecto),
            nombre: r.customerName,
            pax: r.pax,
          };
        })
        .sort((a, b) => a.ini - b.ini),
    [reservasDelDia, reservaEditandoId, duracionPorDefecto]
  );

  const propioIni = minutosDe(horaSeleccionada);
  const propioFin = propioIni + duracionSeleccionada;

  // Fin excluido: una que acaba a las 19:00 y otra que empieza a las 19:00 no
  // chocan. Es el mismo criterio que aplica el servidor.
  const choque = bloques.find((b) => propioIni < b.fin && b.ini < propioFin);

  // Que la mesa se levante después de que cierre la cocina es normal, no un
  // problema: se dice para que nadie crea que va a fallar al guardar.
  //
  // Se compara contra la franja en la que ENTRA la reserva, no contra la última
  // del día: una comida que se alarga hasta las 18:00 también se sale de su
  // servicio, y esa es justo la pregunta que se hace quien mira el plano a las
  // cinco y ve la mesa ocupada.
  const suFranja = franjas.find(
    (f) => propioIni >= minutosDe(f.horaInicio) && propioIni <= minutosDe(f.horaFin)
  );
  const seAlargaTrasElCierre = Boolean(suFranja) && propioFin > minutosDe(suFranja!.horaFin);

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
    <div className="bg-brand-surface-low border border-brand-outline rounded-xl p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-brand-text font-sans font-bold text-[11px] uppercase tracking-wider">
          <CalendarClock className="w-4 h-4 text-brand-primary" />
          Ocupación de la mesa
        </div>
        <span className="text-[9px] font-mono text-brand-muted">
          Pulsa un hueco para fijar la hora
        </span>
      </div>

      {franjas.map((f) => {
        const desde = minutosDe(f.horaInicio);
        const hasta = minutosDe(f.horaFin);
        const casillas: number[] = [];
        for (let m = desde; m <= hasta; m += PASO) casillas.push(m);

        // Reservas de esta franja que siguen ocupando mesa después de la última
        // entrada. La rejilla se acaba ahí, pero la mesa no.
        const colas = bloques.filter((b) => b.ini <= hasta && b.fin > hasta);

        return (
          <div key={f.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-sans font-bold text-brand-text capitalize">{f.nombre}</span>
              <span className="text-[9px] font-mono text-brand-muted">
                {f.horaInicio} – {f.horaFin}
              </span>
              <span className="text-[9px] text-brand-muted/60">últimas entradas</span>
            </div>

            <div className="flex flex-wrap gap-1">
              {casillas.map((m) => {
                const fin = m + duracionSeleccionada;
                const ocupada = bloques.find((b) => m < b.fin && b.ini < m + PASO);
                const esLaElegida = m === propioIni;
                // Un hueco que empieza libre pero cuya reserva se saldría encima
                // de la siguiente tampoco vale: avisar después de elegirlo sería
                // hacerle perder el tiempo a quien está delante.
                const noCabe = !ocupada && bloques.some((b) => m < b.fin && b.ini < fin);

                const base =
                  'h-7 min-w-[3.1rem] px-1 rounded text-[10px] font-mono border transition-all';

                if (ocupada) {
                  return (
                    <div
                      key={m}
                      title={`${ocupada.nombre} · ${ocupada.pax} pax · ${aHora(ocupada.ini)}–${aHora(ocupada.fin)}`}
                      className={`${base} bg-brand-secondary/15 border-brand-secondary/40 text-brand-secondary/80 flex items-center justify-center cursor-not-allowed`}
                    >
                      {aHora(m)}
                    </div>
                  );
                }

                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onElegirHora(aHora(m))}
                    title={
                      noCabe
                        ? `A las ${aHora(m)} no caben ${duracionSeleccionada} min sin pisar la siguiente reserva`
                        : `Reservar a las ${aHora(m)}`
                    }
                    className={`${base} cursor-pointer ${
                      esLaElegida
                        ? 'bg-brand-primary border-brand-primary text-brand-surface font-bold'
                        : noCabe
                          ? 'bg-brand-surface border-brand-tertiary/40 text-brand-tertiary/70 hover:border-brand-tertiary'
                          : 'bg-brand-surface border-brand-outline text-brand-muted hover:border-brand-primary/60 hover:text-brand-text'
                    }`}
                  >
                    {aHora(m)}
                  </button>
                );
              })}
            </div>

            {/* La cocina cierra, la sala no. Sin esto la mesa parecería libre. */}
            {colas.map((c, i) => (
              <p key={i} className="text-[10px] text-brand-muted pl-1">
                <span className="text-brand-secondary">↳</span> {c.nombre} sigue en mesa hasta las{' '}
                <span className="font-mono text-brand-text">{aHora(c.fin)}</span>, después de la
                última entrada de {f.nombre}.
              </p>
            ))}
          </div>
        );
      })}

      {/* Qué pasa con la reserva que se está rellenando ahora mismo */}
      {choque ? (
        <div className="flex items-start gap-2 rounded-lg p-2.5 text-[11px] border bg-red-500/10 border-red-500/25 text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            De {horaSeleccionada} a {aHora(propioFin)} choca con la reserva de{' '}
            <strong>{choque.nombre}</strong> ({aHora(choque.ini)}–{aHora(choque.fin)}). Elige otro hueco.
          </span>
        </div>
      ) : (
        <p className="text-[10px] text-brand-muted">
          Esta reserva ocuparía de{' '}
          <span className="font-mono text-brand-primary">{horaSeleccionada}</span> a{' '}
          <span className="font-mono text-brand-primary">{aHora(propioFin)}</span>
          {bloques.length > 0 && ` · ${bloques.length} reserva${bloques.length > 1 ? 's' : ''} más ese día en esta mesa`}
          {seAlargaTrasElCierre && (
            <span className="text-brand-muted/70">
              {' '}· acaba después del cierre de cocina, y no pasa nada
            </span>
          )}
        </p>
      )}
    </div>
  );
};
