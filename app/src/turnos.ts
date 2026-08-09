import type { Reservation } from './types';

/**
 * Turnos de servicio y pases por mesa.
 *
 * Un día de restaurante no es un bloque: son dos servicios con vida propia. La
 * mesa 4 reservada a las dos de la tarde no dice nada de la mesa 4 a las nueve
 * de la noche, y mirarlas juntas hace que el plano mienta.
 *
 * Y dentro de un mismo turno, una mesa se ocupa varias veces: entra un grupo a
 * las ocho y otro a las diez y media. Un solo estado por mesa tampoco cuenta
 * eso.
 */

export type Turno = 'comida' | 'cena';
export type VistaTurno = Turno | 'dia';

/** Antes de esta hora es comida; a partir de ella, cena. */
const CORTE_COMIDA_CENA = 17;

export function minutosDe(hora: string): number {
  const m = String(hora || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/**
 * Turno al que pertenece una reserva.
 *
 * Se prefiere el que viene guardado, que lo calculó el servidor con los turnos
 * reales del local. La hora es solo el respaldo para las reservas antiguas,
 * anteriores a que ese campo existiera.
 */
export function turnoDe(r: Reservation): Turno {
  if (r.shift === 'comida' || r.shift === 'cena') return r.shift;
  return minutosDe(r.time) < CORTE_COMIDA_CENA * 60 ? 'comida' : 'cena';
}

/** ¿Cuenta esta reserva para lo que se está mirando? */
export function esDelTurno(r: Reservation, vista: VistaTurno): boolean {
  return vista === 'dia' || turnoDe(r) === vista;
}

/** Las que ocupan mesa de verdad: ni anuladas ni ya terminadas. */
export function estaViva(r: Reservation): boolean {
  return r.status !== 'cancelled' && r.status !== 'completed';
}

/**
 * Reservas vivas de una mesa en un día y turno, en orden de hora.
 *
 * Es la lista de pases: cada una es un grupo distinto que se sienta en esa
 * misma mesa a lo largo del servicio.
 */
export function pasesDeMesa(
  reservas: Reservation[],
  mesaId: string,
  fecha: string,
  vista: VistaTurno
): Reservation[] {
  return reservas
    .filter((r) => r.tableId === mesaId && r.date === fecha && estaViva(r) && esDelTurno(r, vista))
    .sort((a, b) => minutosDe(a.time) - minutosDe(b.time));
}

/** Hora a la que se espera que la mesa quede libre. */
export function horaDeSalida(r: Reservation, duracionPorDefecto: number): string {
  const fin = minutosDe(r.time) + (r.customDurationMinutes || duracionPorDefecto);
  const h = Math.floor(fin / 60) % 24;
  const m = fin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * ¿Se pisan dos pases seguidos?
 *
 * Que una mesa tenga dos reservas en el mismo turno es lo normal y lo deseable.
 * El problema es que la segunda empiece antes de que la primera haya terminado:
 * eso significa dos grupos y una sola mesa, y alguien esperando de pie.
 */
export function pasesQueSePisan(
  pases: Reservation[],
  duracionPorDefecto: number
): Array<{ antes: Reservation; despues: Reservation }> {
  const choques: Array<{ antes: Reservation; despues: Reservation }> = [];
  for (let i = 0; i < pases.length - 1; i++) {
    const antes = pases[i];
    const despues = pases[i + 1];
    const finAntes = minutosDe(antes.time) + (antes.customDurationMinutes || duracionPorDefecto);
    if (minutosDe(despues.time) < finAntes) choques.push({ antes, despues });
  }
  return choques;
}

export const ETIQUETA_TURNO: Record<VistaTurno, string> = {
  dia: 'Todo el día',
  comida: 'Comida',
  cena: 'Cena',
};

/** El turno en curso ahora mismo, para abrir el panel por donde toca. */
export function turnoActual(ahora: Date = new Date()): Turno {
  return ahora.getHours() < CORTE_COMIDA_CENA ? 'comida' : 'cena';
}
