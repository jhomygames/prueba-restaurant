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

export interface Dish {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number | null;
  allergens: string[];
  recommended: boolean;
  available: boolean;
  order: number;
}

// ---------- Sesión ----------

const TOKEN_KEY = 'dinecontrol_token';

export interface Session {
  token: string;
  user: { email: string; nombre?: string; rol?: string };
  restaurant: { slug: string; nombre: string };
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Se dispara cuando el backend responde 401: App.tsx vuelve al login.
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler = () => {};
export const setUnauthorizedHandler = (fn: UnauthorizedHandler) => {
  onUnauthorized = fn;
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { headers: headers(), ...options });
  if (res.status === 401) {
    clearToken();
    onUnauthorized();
    throw new Error('sesion_expirada');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${options.method || 'GET'} ${path} -> ${res.status}: ${body}`);
  }
  return res.json();
}

// ---------- Autenticación ----------

export async function login(email: string, password: string): Promise<Session> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const map: Record<string, string> = {
      credenciales_invalidas: 'Email o contraseña incorrectos.',
      demasiados_intentos: 'Demasiados intentos. Espera unos minutos.',
      restaurante_inactivo: 'Este restaurante está desactivado.',
      faltan_credenciales: 'Escribe tu email y tu contraseña.',
    };
    throw new Error(map[body.error] || 'No se pudo iniciar sesión.');
  }
  setToken(body.token);
  return body as Session;
}

export const fetchMe = () =>
  req<{ user: any; restaurant: { slug: string; nombre: string } }>('/api/auth/me');

export const changePassword = (currentPassword: string, newPassword: string) =>
  req<{ ok: boolean }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

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

// ---------- Carta / Menú ----------

export const fetchMenu = () => req<Dish[]>('/api/menu');

export const createDish = (d: Omit<Dish, 'id'>) =>
  req<Dish>('/api/menu', { method: 'POST', body: JSON.stringify(d) });

export const updateDish = (id: string, patch: Partial<Dish>) =>
  req<Dish>(`/api/menu/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteDish = (id: string) =>
  req<{ deleted: boolean }>(`/api/menu/${id}`, { method: 'DELETE' });

// ---------- Configuración del restaurante (integraciones) ----------

export interface IntegrationProvider {
  id: string;
  label: string;
  authMode: string;
}

export interface IntegrationSettings {
  proveedores: IntegrationProvider[];
  proveedor: string;
  activa: boolean;
  restauranteExternoId: string;
  apiKeyMasked: string;
  authMode: string;
  accessToken: string;
  webhookUrl: string;
  ultimaSync: string;
}

export interface RestaurantSettings {
  slug: string;
  nombre: string;
  googleReviewUrl: string;
  staffWhatsApp: string;
  integracion: IntegrationSettings;
  voz: {
    configured: boolean;
    assistantId: string;
    telefono: string;
    apiKeyPropia: boolean;
    apiKeyMasked: string;
  };
  whatsapp: {
    configured: boolean;
    accountSid: string;
    from: string;
    authTokenMasked: string;
    webhookUrl: string;
  };
}

export const fetchSettings = () => req<RestaurantSettings>('/api/settings');

export const saveSettings = (patch: Partial<Pick<RestaurantSettings, 'nombre' | 'googleReviewUrl' | 'staffWhatsApp'>>) =>
  req<RestaurantSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });

export const saveVapiKey = (apiKey: string | null) =>
  req<RestaurantSettings>('/api/settings/vapi', { method: 'PUT', body: JSON.stringify({ apiKey }) });

/** Assistant de la cuenta de Vapi a la que pertenece una clave. */
export type VapiAssistant = { id: string; nombre: string; esElConfigurado: boolean };

/**
 * Prueba una clave SIN guardarla y devuelve los asistentes de esa cuenta.
 * Evita tener que pisar la clave buena para descubrir que la nueva no vale.
 */
export const probeVapiKey = (apiKey: string) =>
  req<{
    ok: boolean;
    forma: { longitud: number; pareceUuid: boolean };
    mensaje?: string;
    assistants?: VapiAssistant[];
    configuradoEstaEnLaCuenta?: boolean;
    error?: string;
    pista?: string;
  }>('/api/settings/vapi/probe', { method: 'POST', body: JSON.stringify({ apiKey }) });

/** Apunta el local a un assistant ya existente en su cuenta de Vapi. */
export const setVapiAssistant = (assistantId: string, apiKey?: string) =>
  req<RestaurantSettings>('/api/settings/vapi', {
    method: 'PUT',
    body: JSON.stringify(apiKey ? { assistantId, apiKey } : { assistantId }),
  });

export const provisionVapi = () =>
  req<RestaurantSettings & { aviso: string | null }>('/api/settings/vapi/provision', { method: 'POST' });

export const syncVapiPrompt = () =>
  req<{ ok: boolean }>('/api/settings/vapi/sync-prompt', { method: 'POST' });

export const testVapi = () =>
  req<{ ok: boolean; nombre?: string; modelo?: string; voz?: string; error?: string }>(
    '/api/settings/vapi/test',
    { method: 'POST' }
  );

export const saveWhatsApp = (data: { accountSid?: string; authToken?: string; from?: string }) =>
  req<RestaurantSettings>('/api/settings/whatsapp', { method: 'PUT', body: JSON.stringify(data) });

export const testWhatsApp = (to: string) =>
  req<{ ok: boolean; sid?: string; estado?: string; error?: string }>('/api/settings/whatsapp/test', {
    method: 'POST',
    body: JSON.stringify({ to }),
  });

// ---------- Plataformas de reservas externas ----------

export const saveIntegration = (data: {
  provider: string | null;
  apiKey?: string;
  restauranteExternoId?: string;
}) =>
  req<IntegrationSettings>('/api/settings/integration', {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const rotateIntegrationToken = () =>
  req<IntegrationSettings & { aviso?: string }>('/api/settings/integration/rotate-token', {
    method: 'POST',
  });

export const testIntegration = () =>
  req<{ ok: boolean; proveedor: string; recibePor: string; problemas: string[]; nota?: string }>(
    '/api/settings/integration/test',
    { method: 'POST' }
  );

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
