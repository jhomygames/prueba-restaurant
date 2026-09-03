import React, { useMemo } from 'react';
import { Reservation, Table } from '../types';
import { estaViva, esDelTurno, minutosDe, VistaTurno, ETIQUETA_TURNO } from '../turnos';
import { CalendarDays, Users, Armchair } from 'lucide-react';

interface AgendaDelDiaProps {
  reservations: Reservation[];
  tables: Table[];
  selectedDate: string;
  selectedShift: VistaTurno;
  onEditReservation: (reservation: Reservation) => void;
}

/**
 * Lista de reservas del día en la barra lateral del plano.
 *
 * El plano solo enseña una mesa cuando se selecciona; esto responde a la
 * pregunta previa, la que se hace antes de tocar nada: "¿qué tengo hoy?". Se
 * respeta el mismo filtro de turno que el plano (COMIDA / CENA / TODO), así
 * que ambos cuentan siempre la misma historia.
 *
 * Un clic en una fila abre esa reserva para gestionarla — mismo callback que
 * ya usan el plano y la agenda mensual, no un camino nuevo.
 */
export const AgendaDelDia: React.FC<AgendaDelDiaProps> = ({
  reservations,
  tables,
  selectedDate,
  selectedShift,
  onEditReservation,
}) => {
  const delDia = useMemo(() => {
    return reservations
      .filter((r) => r.date === selectedDate && estaViva(r) && esDelTurno(r, selectedShift))
      .sort((a, b) => minutosDe(a.time) - minutosDe(b.time));
  }, [reservations, selectedDate, selectedShift]);

  const nombreMesa = (tableId: string) => tables.find((t) => t.id === tableId)?.name || 'Sin mesa';

  const fechaLegible = useMemo(() => {
    // Fecha en YYYY-MM-DD tratada como local, no UTC: si no, un día que empieza
    // a medianoche puede leerse como el día anterior según la zona del navegador.
    const [y, m, d] = selectedDate.split('-').map(Number);
    const f = new Date(y, (m || 1) - 1, d || 1);
    return f.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }, [selectedDate]);

  return (
    <div className="bg-brand-surface border border-brand-outline rounded-2xl p-4 space-y-3 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <h3 className="font-sans font-bold text-xs text-brand-text uppercase tracking-wider flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5 text-brand-primary" />
          Agenda del Día
        </h3>
        <span className="text-[9px] font-mono font-bold text-brand-muted bg-brand-surface-low border border-brand-outline px-2 py-0.5 rounded-full whitespace-nowrap">
          {delDia.length}
        </span>
      </div>

      <p className="text-[10px] text-brand-muted capitalize -mt-1 shrink-0">
        {fechaLegible}
        {selectedShift !== 'dia' && <span className="text-brand-muted/70"> · {ETIQUETA_TURNO[selectedShift]}</span>}
      </p>

      {delDia.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-6">
          <p className="text-[11px] text-brand-muted text-center leading-relaxed">
            Sin reservas
            {selectedShift !== 'dia' ? ` de ${ETIQUETA_TURNO[selectedShift].toLowerCase()}` : ''}
            <br />
            para este día.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto -mr-1 pr-1 space-y-1.5">
          {delDia.map((r) => {
            const enServicio = r.status === 'seated';
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onEditReservation(r)}
                className="w-full flex items-center gap-2.5 p-2 rounded-xl bg-brand-surface-low border border-brand-outline hover:border-brand-primary/50 hover:bg-brand-surface-high transition-all cursor-pointer text-left group"
              >
                {/* Hora, lo primero que se lee al bajar la lista */}
                <div className="shrink-0 w-11 text-center">
                  <span className="block font-mono text-xs font-bold text-brand-text leading-none">
                    {r.time}
                  </span>
                  <span
                    className={`block mt-1 w-1.5 h-1.5 rounded-full mx-auto ${
                      enServicio ? 'bg-brand-secondary' : 'bg-brand-tertiary'
                    }`}
                    title={enServicio ? 'En servicio' : 'Reservada'}
                  />
                </div>

                <div className="w-px self-stretch bg-brand-outline shrink-0" />

                {/* Cliente y mesa */}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-sans font-bold text-brand-text truncate group-hover:text-brand-primary transition-colors">
                    {r.customerName}
                  </p>
                  <p className="text-[10px] font-mono text-brand-muted flex items-center gap-1 mt-0.5">
                    <Armchair className="w-3 h-3 shrink-0" />
                    {nombreMesa(r.tableId)}
                    {r.secondaryTableId && ` + ${nombreMesa(r.secondaryTableId)}`}
                  </p>
                </div>

                {/* Personas */}
                <div className="shrink-0 flex items-center gap-1 text-brand-muted bg-brand-surface border border-brand-outline rounded-lg px-1.5 py-1">
                  <Users className="w-3 h-3" />
                  <span className="text-[10px] font-mono font-bold text-brand-text">{r.pax}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
