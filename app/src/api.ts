/**
 * Capa de datos del panel: todo va contra la API del backend Express
 * (src/routes/staffApi.js), que a su vez lee/escribe en Airtable.
 * Airtable es la única base de datos: aquí no hay estado persistente local.
 */

import { Table, Reservation } from './types';

export interface Customer {
  id: string;
  phone: string;
  name: string;
  knownAllergies: string[];
  preferences: string;
  lastVisit: string;
  visits: number;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = localStorage.getItem('dinecontrol_staff_key');
  if (key) h['x-staff-key'] = key;
  return h;
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { headers: headers(), ...options });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${options.method || 'GET'} ${path} -> ${res.status}: ${body}`);
  }
  return res.json();
}

// ---------- Mesas ----------

export const fetchTables = () => req<Table[]>('/api/tables');

export const createTable = (t: Omit<Table, 'id'>) =>
  req<Table>('/api/tables', { method: 'POST', body: JSON.stringify(t) });

export const updateTable = (id: string, patch: Partial<Table>) =>
  req<Table>(`/api/tables/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteTable = (id: string) =>
  req<{ deleted: boolean }>(`/api/tables/${id}`, { method: 'DELETE' });

// ---------- Reservas ----------

export const fetchReservations = () => req<Reservation[]>('/api/reservations');

export const createReservation = (r: Omit<Reservation, 'id' | 'createdAt'>) =>
  req<Reservation>('/api/reservations', { method: 'POST', body: JSON.stringify(r) });

export const updateReservation = (id: string, patch: Partial<Reservation>) =>
  req<Reservation>(`/api/reservations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

// ---------- Clientes ----------

export const fetchCustomers = () => req<Customer[]>('/api/customers');

// Persistencia con debounce para el drag del plano: agrupa los updates de una
// misma mesa y solo envía el último cuando el usuario deja de moverla.
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function updateTableDebounced(table: Table, delayMs = 700): void {
  const prev = pendingTimers.get(table.id);
  if (prev) clearTimeout(prev);
  pendingTimers.set(
    table.id,
    setTimeout(() => {
      pendingTimers.delete(table.id);
      const { id, ...fields } = table;
      updateTable(id, fields).catch((err) => console.error('updateTable failed:', err));
    }, delayMs)
  );
}
