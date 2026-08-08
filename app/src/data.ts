import { Table, Reservation, Decoration } from './types';

// Helper to get formatted dates relative to today
const getRelativeDate = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
};

// Catálogo alineado con el campo "Alergias" de Airtable y con los 14
// alérgenos obligatorios de la carta (menu.json del backend), más dietas.
export const ALLERGIES_OPTIONS = [
  'Gluten',
  'Crustáceos',
  'Huevos',
  'Pescado',
  'Cacahuetes',
  'Soja',
  'Lácteos',
  'Frutos de cáscara',
  'Apio',
  'Mostaza',
  'Sésamo',
  'Sulfitos',
  'Altramuces',
  'Moluscos',
  'Vegano',
  'Vegetariano',
  'Sin Sal'
];

export const INITIAL_TABLES: Table[] = [
  // MAIN HALL (Centro / Superior)
  { id: 'm1', name: 'Mesa 1', seats: 4, status: 'reserved', x: 15, y: 15, shape: 'square', rotation: 0 },
  { id: 'm2', name: 'Mesa 2', seats: 2, status: 'free', x: 35, y: 15, shape: 'circle', rotation: 0 },
  { id: 'm3', name: 'Mesa 3', seats: 4, status: 'occupied', x: 55, y: 15, shape: 'square', rotation: 0 },
  { id: 'm4', name: 'Mesa 4', seats: 6, status: 'free', x: 75, y: 15, shape: 'rectangle', rotation: 0 },
  
  { id: 'm5', name: 'Mesa 5', seats: 4, status: 'free', x: 15, y: 40, shape: 'circle', rotation: 0 },
  { id: 'm6', name: 'Mesa 6', seats: 8, status: 'reserved', x: 38, y: 40, shape: 'rectangle', rotation: 90 },
  { id: 'm7', name: 'Mesa 7', seats: 4, status: 'free', x: 65, y: 40, shape: 'square', rotation: 0 },
  
  // BAR (Costado derecho inferior)
  { id: 'b1', name: 'Barra 1', seats: 1, status: 'occupied', x: 88, y: 55, shape: 'bar', rotation: 0 },
  { id: 'b2', name: 'Barra 2', seats: 1, status: 'free', x: 88, y: 65, shape: 'bar', rotation: 0 },
  { id: 'b3', name: 'Barra 3', seats: 1, status: 'free', x: 88, y: 75, shape: 'bar', rotation: 0 },
  { id: 'b4', name: 'Barra 4', seats: 1, status: 'occupied', x: 88, y: 85, shape: 'bar', rotation: 0 },

  // TERRACE (Abajo a la izquierda)
  { id: 't1', name: 'Terraza 1', seats: 2, status: 'free', x: 15, y: 75, shape: 'circle', rotation: 0 },
  { id: 't2', name: 'Terraza 2', seats: 2, status: 'reserved', x: 30, y: 75, shape: 'circle', rotation: 0 },
  { id: 't3', name: 'Terraza 3', seats: 4, status: 'free', x: 48, y: 75, shape: 'square', rotation: 45 },
  { id: 't4', name: 'Terraza 4', seats: 6, status: 'free', x: 65, y: 75, shape: 'rectangle', rotation: 0 },
];

export const INITIAL_RESERVATIONS: Reservation[] = [
  {
    id: 'res-1',
    customerName: 'Alejandro Sanz',
    customerPhone: '+34 612 345 678',
    date: getRelativeDate(0), // today
    time: '13:30',
    pax: 4,
    tableId: 'm1',
    status: 'confirmed',
    notes: 'Preferencia mesa cerca de la ventana si es posible.',
    allergies: ['Gluten'],
    autoConfirmMessage: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'res-2',
    customerName: 'María Pedrosa',
    customerPhone: '+56 9 8765 4321',
    date: getRelativeDate(0), // today
    time: '21:00',
    pax: 8,
    tableId: 'm6',
    status: 'pending',
    notes: 'Celebración de cumpleaños corporativo. Traen pastel.',
    allergies: ['Lactosa'],
    autoConfirmMessage: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'res-3',
    customerName: 'Carlos Gardel',
    customerPhone: '+54 9 11 2233 4455',
    date: getRelativeDate(0), // today
    time: '20:30',
    pax: 2,
    tableId: 't2',
    status: 'confirmed',
    notes: 'Velada romántica, por favor preparar velas.',
    allergies: [],
    autoConfirmMessage: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'res-4',
    customerName: 'Laura Pausini',
    customerPhone: '+39 333 444 5555',
    date: getRelativeDate(1), // tomorrow
    time: '14:00',
    pax: 4,
    tableId: 'm3',
    status: 'confirmed',
    notes: 'Vegetariana estricta, prefiere recomendación del chef.',
    allergies: ['Vegetariano'],
    autoConfirmMessage: false,
    createdAt: new Date().toISOString()
  }
];

export const AUTO_CONFIRM_TEMPLATES = [
  {
    id: 'whatsapp_standard',
    name: 'WhatsApp Estándar',
    text: 'Hola {{NAME}}, te confirmamos tu mesa en DineControl AI para el {{DATE}} a las {{TIME}} hrs para {{PAX}} personas. ¡Te esperamos!'
  },
  {
    id: 'whatsapp_reminder',
    name: 'Recordatorio Diario',
    text: 'Hola {{NAME}}, recuerda tu reserva de hoy a las {{TIME}} en DineControl AI. Si necesitas modificarla o cancelarla, avísanos.'
  }
];

export const INITIAL_DECORATIONS: Decoration[] = [
  { id: 'dec-1', name: 'Planta de Rincón', type: 'plant', x: 5, y: 5, width: 40, height: 40, rotation: 0, plantModel: 'rosette' },
  { id: 'dec-2', name: 'Planta Terraza', type: 'plant', x: 5, y: 65, width: 40, height: 40, rotation: 0, plantModel: 'radial' },
  { id: 'dec-3', name: 'Muro Divisorio', type: 'wall', x: 45, y: 58, width: 140, height: 12, rotation: 0 },
  { id: 'dec-4', name: 'Sofá de Espera', type: 'furniture', x: 45, y: 15, width: 120, height: 45, rotation: 0 },
  { id: 'dec-5', name: 'Barra de Cocina', type: 'bar_counter', x: 80, y: 50, width: 35, height: 260, rotation: 90 }
];

