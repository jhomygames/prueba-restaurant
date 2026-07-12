export type TableShape = 'square' | 'circle' | 'rectangle' | 'bar';
export type TableStatus = 'free' | 'reserved' | 'occupied';

export interface Table {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  x: number; // position from left in percentage (0 to 100) or grid units
  y: number; // position from top in percentage (0 to 100) or grid units
  shape: TableShape;
  rotation: number; // in degrees (0, 90, 180, 270)
  zone?: string; // Interior / Terraza / Barra (campo Zona en Airtable)
}

export type DecorationType = 'wall' | 'furniture' | 'plant' | 'bar_counter';

export interface Decoration {
  id: string;
  name: string;
  type: DecorationType;
  x: number; // position from left in percentage (0 to 100)
  y: number; // position from top in percentage (0 to 100)
  width: number; // arbitrary scale width, e.g. 10 to 100
  height: number; // arbitrary scale height, e.g. 10 to 100
  rotation: number; // in degrees
  plantModel?: string; // model ID for plants, e.g. 'rosette' | 'radial' | 'flowery' | 'concentric' | 'fern' | 'starburst'
}

export type ReservationStatus = 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled';

export interface Reservation {
  id: string;
  customerName: string;
  customerPhone: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  pax: number;
  tableId: string;
  status: ReservationStatus;
  notes: string;
  allergies: string[];
  autoConfirmMessage: boolean;
  createdAt: string;
  seatedAt?: string;
  customDurationMinutes?: number;
}

export type NotificationType = 'daily_reminder' | '15_min_before' | 'incoming_call' | 'system';

export interface NotificationLog {
  id: string;
  timestamp: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  actionable?: boolean;
  meta?: any;
}
