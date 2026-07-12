import React, { useState, useRef } from 'react';
import { Table, TableShape, TableStatus, Reservation, Decoration, DecorationType } from '../types';
import { Plus, Trash2, RotateCw, Edit3, Check, Eye, HelpCircle, Sprout, Sofa, Columns3, ZoomIn, Maximize2, Minus } from 'lucide-react';
import { motion } from 'motion/react';

export interface PlantModelInfo {
  id: string;
  name: string;
  description: string;
  render: (colorClass?: string) => React.ReactNode;
}

export const PLANT_MODELS: PlantModelInfo[] = [
  {
    id: 'rosette',
    name: 'Roseta de Hojas 💮',
    description: 'Follaje tupido con flores radiales',
    render: (colorClass = "text-emerald-400") => (
      <svg className={`w-full h-full ${colorClass}`} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="50" cy="50" r="44" strokeDasharray="3 3" className="opacity-30" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          const x = 50 + Math.cos(rad) * 20;
          const y = 50 + Math.sin(rad) * 20;
          return <circle key={angle} cx={x} cy={y} r="16" className="opacity-80 fill-emerald-900/40" strokeWidth="2" />;
        })}
        {[22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          const x = 50 + Math.cos(rad) * 12;
          const y = 50 + Math.sin(rad) * 12;
          return <circle key={angle} cx={x} cy={y} r="10" className="fill-emerald-950/60" strokeWidth="1.5" />;
        })}
        <circle cx="50" cy="50" r="6" className="fill-emerald-400/30" strokeWidth="2" />
        <circle cx="50" cy="50" r="1.5" className="fill-emerald-300" />
      </svg>
    )
  },
  {
    id: 'radial',
    name: 'Palmera Radial 🌴',
    description: 'Hojas spiky en forma de estrella',
    render: (colorClass = "text-emerald-400") => (
      <svg className={`w-full h-full ${colorClass}`} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="50" cy="50" r="44" strokeDasharray="4 4" className="opacity-20" />
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 360) / 12;
          const rad = (angle * Math.PI) / 180;
          const x1 = 50 + Math.cos(rad) * 6;
          const y1 = 50 + Math.sin(rad) * 6;
          const x2 = 50 + Math.cos(rad) * 44;
          const y2 = 50 + Math.sin(rad) * 44;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} Q ${50 + Math.cos(rad + 0.15) * 25} ${50 + Math.sin(rad + 0.15) * 25} ${x2} ${y2} Q ${50 + Math.cos(rad - 0.15) * 25} ${50 + Math.sin(rad - 0.15) * 25} ${x1} ${y1}`}
              className="fill-emerald-900/30"
              strokeWidth="1.8"
            />
          );
        })}
        <circle cx="50" cy="50" r="5" className="fill-emerald-950" />
      </svg>
    )
  },
  {
    id: 'flowery',
    name: 'Arbusto de Flores 🌸',
    description: 'Ramilletes de hojas con capullos',
    render: (colorClass = "text-emerald-400") => (
      <svg className={`w-full h-full ${colorClass}`} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="50" cy="50" r="42" className="opacity-40" strokeWidth="1.5" />
        <circle cx="50" cy="50" r="32" className="opacity-20" strokeWidth="1" strokeDasharray="3 3" />
        {[0, 60, 120, 180, 240, 300].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          const cx = 50 + Math.cos(rad) * 22;
          const cy = 50 + Math.sin(rad) * 22;
          return (
            <g key={i} transform={`translate(${cx}, ${cy})`}>
              {[0, 72, 144, 216, 288].map((pAngle) => {
                const prad = (pAngle * Math.PI) / 180;
                const px = Math.cos(prad) * 7;
                const py = Math.sin(prad) * 7;
                return <circle key={pAngle} cx={px} cy={py} r="4" className="fill-emerald-900/30" strokeWidth="1.2" />;
              })}
              <circle cx="0" cy="0" r="3.5" className="fill-amber-400" stroke="none" />
            </g>
          );
        })}
        <circle cx="50" cy="50" r="10" className="fill-emerald-950/50" />
        <path d="M 46 50 A 4 4 0 1 1 54 50" strokeWidth="2" />
      </svg>
    )
  },
  {
    id: 'concentric',
    name: 'Árbol Concéntrico 🌀',
    description: 'Anillos ondulados bosquejados',
    render: (colorClass = "text-emerald-400") => (
      <svg className={`w-full h-full ${colorClass}`} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
        <path
          d="M 50 4 C 77 3, 97 23, 96 50 C 95 77, 77 97, 50 96 C 23 95, 3 77, 4 50 C 5 23, 23 5, 50 4 Z"
          className="fill-emerald-900/10"
          strokeWidth="3"
        />
        <path
          d="M 50 16 C 70 15, 86 31, 85 50 C 84 69, 70 86, 50 85 C 30 84, 14 69, 15 50 C 16 30, 30 17, 50 16 Z"
          className="fill-emerald-900/20 opacity-90"
          strokeWidth="2"
          strokeDasharray="4 2"
        />
        <path
          d="M 50 28 C 63 27, 73 37, 72 50 C 71 63, 63 73, 50 72 C 37 71, 27 63, 28 50 C 29 37, 37 29, 50 28 Z"
          className="fill-emerald-950/40"
          strokeWidth="1.8"
        />
        <path
          d="M 50 40 C 56 39, 61 44, 60 50 C 59 56, 56 61, 50 60 C 44 59, 39 56, 40 50 C 41 44, 44 41, 50 40 Z"
          className="fill-emerald-400/10"
          strokeWidth="1.5"
        />
        <circle cx="50" cy="50" r="3" className="fill-emerald-400" />
        <path d="M 50 50 L 58 42 M 50 50 L 44 56 M 50 50 L 55 55" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    id: 'fern',
    name: 'Helecho Estrella 🌿',
    description: 'Hojas radiales súper detalladas',
    render: (colorClass = "text-emerald-400") => (
      <svg className={`w-full h-full ${colorClass}`} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="50" cy="50" r="44" strokeDasharray="1 3" className="opacity-25" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
          return (
            <g key={i} transform={`translate(50, 50) rotate(${angle})`}>
              <line x1="0" y1="0" x2="43" y2="0" strokeWidth="2.5" />
              {[8, 16, 24, 32].map((dist) => {
                const size = 9 - dist * 0.15;
                return (
                  <g key={dist}>
                    <line x1={dist} y1="0" x2={dist + 3} y2={size} strokeWidth="1.8" />
                    <line x1={dist} y1="0" x2={dist + 3} y2={-size} strokeWidth="1.8" />
                  </g>
                );
              })}
            </g>
          );
        })}
        <circle cx="50" cy="50" r="6" className="fill-emerald-950" strokeWidth="2.5" />
      </svg>
    )
  },
  {
    id: 'starburst',
    name: 'Diente de León 🌾',
    description: 'Delineado geométrico de puntas finas',
    render: (colorClass = "text-emerald-400") => (
      <svg className={`w-full h-full ${colorClass}`} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
        <circle cx="50" cy="50" r="44" strokeDasharray="5 5" className="opacity-10" />
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i * 360) / 24;
          const rad = (angle * Math.PI) / 180;
          const len = i % 2 === 0 ? 43 : 30;
          const x2 = 50 + Math.cos(rad) * len;
          const y2 = 50 + Math.sin(rad) * len;
          return (
            <g key={i}>
              <line x1="50" y1="50" x2={x2} y2={y2} strokeWidth={i % 2 === 0 ? '1.5' : '0.8'} />
              {i % 2 === 0 && (
                <circle cx={x2} cy={y2} r="1.8" className="fill-emerald-400" stroke="none" />
              )}
            </g>
          );
        })}
        <circle cx="50" cy="50" r="7" className="fill-emerald-950" strokeWidth="1.8" />
        <circle cx="50" cy="50" r="2.5" className="fill-emerald-300" stroke="none" />
      </svg>
    )
  }
];

interface FloorPlanProps {
  tables: Table[];
  reservations: Reservation[];
  selectedTableId: string | null;
  onSelectTable: (id: string) => void;
  isEditMode: boolean;
  onUpdateTable: (table: Table) => void;
  onAddTable: (table: Table) => void;
  onDeleteTable: (id: string) => void;
  decorations: Decoration[];
  onUpdateDecoration: (dec: Decoration) => void;
  onAddDecoration: (dec: Decoration) => void;
  onDeleteDecoration: (id: string) => void;
  selectedDate?: string;
  currentTime?: Date;
  isToleranceEnabled?: boolean;
}

export const FloorPlan: React.FC<FloorPlanProps> = ({
  tables,
  reservations,
  selectedTableId,
  onSelectTable,
  isEditMode,
  onUpdateTable,
  onAddTable,
  onDeleteTable,
  decorations = [],
  onUpdateDecoration,
  onAddDecoration,
  onDeleteDecoration,
  selectedDate = new Date().toISOString().split('T')[0],
  currentTime = new Date(),
  isToleranceEnabled = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Zoom del plano: en pantallas estrechas (móvil) el lienzo mantiene sus
  // proporciones (ancho/alto mínimos) y se puede desplazar y ampliar para que
  // las mesas no se solapen. En escritorio, a zoom 1 ocupa el 100% como antes.
  const ZOOM_MIN = 0.7;
  const ZOOM_MAX = 2;
  const BASE_W = 600; // ancho de referencia del plano (px) a zoom 1
  const BASE_H = 460; // alto de referencia del plano (px) a zoom 1
  const [zoom, setZoom] = useState<number>(1);
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + 0.2).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - 0.2).toFixed(2)));
  const zoomReset = () => setZoom(1);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<'table' | 'decoration' | null>(null);
  const [editingPropertiesId, setEditingPropertiesId] = useState<string | null>(null);
  const [editingDecorationId, setEditingDecorationId] = useState<string | null>(null);
  const [editToolType, setEditToolType] = useState<'table' | 'decoration'>('table');

  // Quick state for creating a new table
  const [newTableName, setNewTableName] = useState<string>('');
  const [newTableSeats, setNewTableSeats] = useState<number>(4);
  const [newTableShape, setNewTableShape] = useState<TableShape>('square');

  // Quick state for creating a new decoration
  const [newDecName, setNewDecName] = useState<string>('');
  const [newDecType, setNewDecType] = useState<DecorationType>('plant');
  const [newDecWidth, setNewDecWidth] = useState<number>(40);
  const [newDecHeight, setNewDecHeight] = useState<number>(40);

  // Find active reservation for a table (specifically today's active bookings)
  const getActiveReservationForTable = (tableId: string): Reservation | undefined => {
    return reservations.find(
      r => r.tableId === tableId && r.date === selectedDate && r.status !== 'completed' && r.status !== 'cancelled'
    );
  };

  // Drag and Drop implementation relative to canvas percentage
  const handlePointerDown = (e: React.PointerEvent, id: string, type: 'table' | 'decoration') => {
    if (!isEditMode) return;
    e.preventDefault();
    setActiveDragId(id);
    setActiveDragType(type);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isEditMode || !activeDragId || !containerRef.current || !activeDragType) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    // Bound positions between 1% and 95% to avoid overflowing borders
    const boundedX = Math.max(1, Math.min(95, Math.round(x)));
    const boundedY = Math.max(1, Math.min(95, Math.round(y)));
    
    if (activeDragType === 'table') {
      const tableToUpdate = tables.find(t => t.id === activeDragId);
      if (tableToUpdate) {
        onUpdateTable({
          ...tableToUpdate,
          x: boundedX,
          y: boundedY
        });
      }
    } else if (activeDragType === 'decoration') {
      const decToUpdate = decorations.find(d => d.id === activeDragId);
      if (decToUpdate) {
        onUpdateDecoration({
          ...decToUpdate,
          x: boundedX,
          y: boundedY
        });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (activeDragId) {
      setActiveDragId(null);
      setActiveDragType(null);
    }
  };

  // Rotate a table
  const handleRotate = (table: Table) => {
    onUpdateTable({
      ...table,
      rotation: (table.rotation + 90) % 360
    });
  };

  // Rotate a decoration
  const handleRotateDecoration = (dec: Decoration) => {
    onUpdateDecoration({
      ...dec,
      rotation: (dec.rotation + 45) % 360
    });
  };

  // Fast change seats
  const handleSeatsChange = (table: Table, increment: boolean) => {
    const nextSeats = increment ? table.seats + 2 : Math.max(1, table.seats - 1);
    onUpdateTable({
      ...table,
      seats: nextSeats
    });
  };

  // Fast change shape
  const handleShapeChange = (table: Table) => {
    const shapes: TableShape[] = ['square', 'circle', 'rectangle', 'bar'];
    const currIdx = shapes.indexOf(table.shape);
    const nextShape = shapes[(currIdx + 1) % shapes.length];
    onUpdateTable({
      ...table,
      shape: nextShape
    });
  };

  // Add customized table
  const handleCreateNewTable = () => {
    const id = 'table-' + Date.now();
    const name = newTableName.trim() || `Mesa ${tables.length + 1}`;
    
    const newTable: Table = {
      id,
      name,
      seats: newTableSeats,
      status: 'free',
      x: 45, // Spawn at the center
      y: 45,
      shape: newTableShape,
      rotation: 0
    };

    onAddTable(newTable);
    setNewTableName('');
    setEditingPropertiesId(null);
  };

  // Add customized decoration
  const handleCreateNewDecoration = () => {
    const id = 'dec-' + Date.now();
    const defaultLabels: Record<DecorationType, string> = {
      wall: 'Pared/Muro',
      furniture: 'Mueble/Sillón',
      plant: 'Planta',
      bar_counter: 'Barra Cocina'
    };
    const name = newDecName.trim() || `${defaultLabels[newDecType]} ${decorations.length + 1}`;

    // Setup typical default widths/heights based on the type
    let width = 40;
    let height = 40;
    if (newDecType === 'wall') {
      width = 100;
      height = 12;
    } else if (newDecType === 'bar_counter') {
      width = 60;
      height = 150;
    }

    const newDec: Decoration = {
      id,
      name,
      type: newDecType,
      x: 45,
      y: 45,
      width,
      height,
      rotation: 0,
      plantModel: newDecType === 'plant' ? 'rosette' : undefined
    };

    onAddDecoration(newDec);
    setNewDecName('');
    setEditingDecorationId(null);
  };

  // Helpers for table display style
  const getTableShapeClass = (shape: TableShape) => {
    switch (shape) {
      case 'circle':
        return 'rounded-full aspect-square';
      case 'rectangle':
        return 'rounded-lg w-24 h-16';
      case 'bar':
        return 'rounded w-10 h-10 border-b-8 border-brand-outline';
      default: // square
        return 'rounded-xl w-16 h-16';
    }
  };

  const getStatusBorderColor = (status: TableStatus, tableId: string) => {
    const activeRes = getActiveReservationForTable(tableId);
    const effectiveStatus: TableStatus = activeRes ? 'reserved' : status;

    switch (effectiveStatus) {
      case 'occupied':
        return 'border-red-500/30 text-red-400 bg-red-500/10 shadow-red-500/5 hover:border-red-500/50';
      case 'reserved':
        return 'border-amber-500/30 text-amber-400 bg-amber-500/10 shadow-amber-500/5 hover:border-amber-500/50';
      default: // free
        return 'border-zinc-500/30 text-zinc-400 bg-zinc-500/10 shadow-zinc-500/5 hover:border-zinc-500/50';
    }
  };

  return (
    <div className="flex flex-col h-full bg-brand-surface border border-brand-outline rounded-2xl overflow-hidden shadow-xl">
      {/* Map Control Bar */}
      <div className="flex flex-wrap items-center justify-between p-4 bg-brand-surface-low border-b border-brand-outline gap-4">
        <div>
          <h3 className="font-sans font-bold text-base text-brand-text flex items-center gap-2">
            Plano del Restaurante
            {isEditMode && <span className="bg-brand-secondary/15 border border-brand-secondary/30 text-brand-secondary px-2 py-0.5 rounded text-[10px] font-mono tracking-wider animate-pulse">EDICIÓN</span>}
          </h3>
          <p className="text-xs text-brand-muted">
            {isEditMode 
              ? 'Mantén presionado y arrastra para reubicar. Haz clic en una mesa para cambiar su tamaño, forma o eliminarla.' 
              : 'Selecciona una mesa para gestionar su reserva o cambiar su estado.'}
          </p>
        </div>

        {/* Edit mode quick panel */}
        {isEditMode && (
          <div className="flex flex-wrap items-center gap-3 bg-brand-surface-high border border-brand-outline p-2 rounded-xl text-xs">
            {/* Tool Toggler */}
            <div className="flex bg-brand-surface-low p-0.5 rounded border border-brand-outline">
              <button
                onClick={() => setEditToolType('table')}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                  editToolType === 'table'
                    ? 'bg-brand-primary text-brand-surface'
                    : 'text-brand-muted hover:text-brand-text'
                }`}
              >
                Mesas
              </button>
              <button
                onClick={() => setEditToolType('decoration')}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                  editToolType === 'decoration'
                    ? 'bg-brand-primary text-brand-surface'
                    : 'text-brand-muted hover:text-brand-text'
                }`}
              >
                Decoraciones
              </button>
            </div>

            {editToolType === 'table' ? (
              <>
                <input
                  type="text"
                  placeholder="Nombre (ej. Mesa 9)"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  className="bg-brand-surface-low border border-brand-outline rounded px-2 py-1 text-xs text-brand-text w-28 focus:outline-none focus:border-brand-primary font-sans"
                />
                <select
                  value={newTableShape}
                  onChange={(e) => setNewTableShape(e.target.value as TableShape)}
                  className="bg-brand-surface-low border border-brand-outline rounded px-1.5 py-1 text-xs text-brand-text cursor-pointer"
                >
                  <option value="square">Cuadrada</option>
                  <option value="circle">Redonda</option>
                  <option value="rectangle">Rectangular</option>
                  <option value="bar">Barra</option>
                </select>
                <div className="flex items-center gap-1">
                  <span className="text-brand-muted text-[10px]">Asientos:</span>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={newTableSeats}
                    onChange={(e) => setNewTableSeats(Number(e.target.value))}
                    className="bg-brand-surface-low border border-brand-outline rounded w-10 text-center py-0.5 text-xs text-brand-text font-sans"
                  />
                </div>
                <button
                  onClick={handleCreateNewTable}
                  className="flex items-center gap-1 bg-brand-primary text-brand-surface px-2.5 py-1 rounded font-bold font-sans text-xs transition-colors hover:bg-brand-primary/90 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Añadir Mesa
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Nombre (ej. Muro 1)"
                  value={newDecName}
                  onChange={(e) => setNewDecName(e.target.value)}
                  className="bg-brand-surface-low border border-brand-outline rounded px-2 py-1 text-xs text-brand-text w-36 focus:outline-none focus:border-brand-primary font-sans"
                />
                <select
                  value={newDecType}
                  onChange={(e) => setNewDecType(e.target.value as DecorationType)}
                  className="bg-brand-surface-low border border-brand-outline rounded px-1.5 py-1 text-xs text-brand-text cursor-pointer capitalize"
                >
                  <option value="plant">Planta 🌿</option>
                  <option value="wall">Pared / Muro 🧱</option>
                  <option value="furniture">Mueble / Sofá 🛋️</option>
                  <option value="bar_counter">Barra Cocina 🎛️</option>
                </select>
                <button
                  onClick={handleCreateNewDecoration}
                  className="flex items-center gap-1 bg-brand-primary text-brand-surface px-2.5 py-1 rounded font-bold font-sans text-xs transition-colors hover:bg-brand-primary/90 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Añadir Decoración
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Floor Grid Area */}
      <div className="flex-1 relative overflow-hidden flex flex-col md:flex-row h-full min-h-[450px]">

        {/* Canvas area: scrolleable, con el escenario dimensionado por zoom dentro */}
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-0 overflow-auto">
            <div
              ref={containerRef}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{
                width: `max(100%, ${Math.round(BASE_W * zoom)}px)`,
                height: `max(100%, ${Math.round(BASE_H * zoom)}px)`,
              }}
              className="relative grid-canvas bg-brand-surface-lowest p-6 select-none"
              id="floor-plan-canvas"
            >
          {/* Section labels */}
          <div className="absolute top-4 left-6 pointer-events-none text-[10px] font-mono text-brand-muted/30 tracking-widest uppercase">
            SALA PRINCIPAL
          </div>
          <div className="absolute bottom-6 left-6 pointer-events-none text-[10px] font-mono text-brand-muted/30 tracking-widest uppercase">
            TERRAZA EXTERIOR
          </div>
          <div className="absolute bottom-6 right-6 pointer-events-none text-[10px] font-mono text-brand-muted/30 tracking-widest uppercase">
            BARRA DE TRAGOS
          </div>

          {/* Render Tables */}
          {tables.map((table) => {
            const activeRes = getActiveReservationForTable(table.id);
            const isSelected = selectedTableId === table.id;
            const isEditingProperties = editingPropertiesId === table.id;

            return (
              <div
                key={table.id}
                style={{
                  position: 'absolute',
                  left: `${table.x}%`,
                  top: `${table.y}%`,
                  transform: `rotate(${table.rotation}deg)`,
                  touchAction: 'none',
                }}
                onPointerDown={(e) => handlePointerDown(e, table.id, 'table')}
                onClick={() => {
                  if (isEditMode) {
                    setEditingPropertiesId(isEditingProperties ? null : table.id);
                    setEditingDecorationId(null);
                  } else {
                    onSelectTable(table.id);
                  }
                }}
                className={`flex flex-col items-center justify-center border-2 cursor-pointer transition-all duration-150 relative shadow-lg ${getTableShapeClass(
                  table.shape
                )} ${
                  isSelected
                    ? 'border-4 border-brand-primary bg-brand-primary/20 shadow-[0_0_20px_rgba(245,158,11,0.2)] text-brand-primary scale-105 z-10'
                    : getStatusBorderColor(table.status, table.id)
                } ${isEditMode ? 'hover:scale-105 hover:shadow-brand-primary/5 active:scale-95' : ''}`}
                id={`dom-table-${table.id}`}
              >
                {/* Table details (Un-rotated text wrapper) */}
                <div
                  style={{ transform: `rotate(-${table.rotation}deg)` }}
                  className="flex flex-col items-center justify-center text-center p-1 pointer-events-none"
                >
                  <span className="font-sans font-bold text-[11px] tracking-tight leading-tight text-brand-text">
                    {table.name}
                  </span>
                  
                  {/* Seat icons/number */}
                  <span className="font-mono text-[9px] text-brand-muted/70 font-semibold leading-none mt-0.5">
                    {table.seats} Pax
                  </span>

                  {/* Active Booking Badge */}
                  {activeRes && (
                    <div className="mt-1 bg-brand-tertiary text-brand-surface font-sans font-bold text-[8px] px-1 rounded uppercase tracking-wider shadow-sm shrink-0">
                      {activeRes.customerName.split(' ')[0]}
                    </div>
                  )}

                  {/* Countdown Timer for Seated Reservations */}
                  {activeRes && activeRes.status === 'seated' && activeRes.seatedAt && (
                    (() => {
                      const seatedTime = new Date(activeRes.seatedAt).getTime();
                      const limitMs = (activeRes.customDurationMinutes || 120) * 60 * 1000;
                      const elapsedMs = currentTime.getTime() - seatedTime;
                      const remainingMs = limitMs - elapsedMs;

                      if (remainingMs > 0) {
                        const totalSecs = Math.floor(remainingMs / 1000);
                        const h = Math.floor(totalSecs / 3600);
                        const m = Math.floor((totalSecs % 3600) / 60);
                        const s = totalSecs % 60;
                        const formatted = `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                        
                        return (
                          <div className={`mt-1 font-mono text-[8px] font-bold px-1 py-0.5 rounded flex items-center gap-0.5 shadow-sm shrink-0 ${
                            remainingMs < 15 * 60 * 1000 
                              ? 'bg-red-500/25 text-red-200 border border-red-500/40 animate-pulse font-extrabold' 
                              : 'bg-emerald-500/25 text-emerald-200 border border-emerald-500/40'
                          }`}>
                            <span className="inline-block w-1 h-1 rounded-full bg-current animate-ping" />
                            {formatted}
                          </div>
                        );
                      } else {
                        return (
                          <div className="mt-1 bg-red-600 text-white font-mono font-bold text-[8px] px-1 py-0.5 rounded border border-red-500 animate-pulse shrink-0">
                            ¡TIEMPO!
                          </div>
                        );
                      }
                    })()
                  )}

                  {/* Late Tolerance Countdown Timer for Confirmed Reservations */}
                  {isToleranceEnabled && activeRes && activeRes.status === 'confirmed' && (
                    (() => {
                      const today = new Date().toISOString().split('T')[0];
                      if (activeRes.date !== today) return null;

                      const [hours, minutes] = activeRes.time.split(':').map(Number);
                      const resDateTime = new Date();
                      resDateTime.setHours(hours, minutes, 0, 0);

                      const diffMs = currentTime.getTime() - resDateTime.getTime();

                      if (diffMs >= 0) {
                        const toleranceLimitMs = 15 * 60 * 1000;
                        const remainingToleranceMs = toleranceLimitMs - diffMs;

                        if (remainingToleranceMs > 0) {
                          const totalSecs = Math.floor(remainingToleranceMs / 1000);
                          const m = Math.floor(totalSecs / 60);
                          const s = totalSecs % 60;
                          const formatted = `${m}:${s.toString().padStart(2, '0')}`;

                          return (
                            <div className="mt-1 bg-amber-500/25 text-amber-200 border border-amber-500/40 font-mono font-bold text-[8px] px-1 py-0.5 rounded flex items-center gap-0.5 animate-pulse shrink-0">
                              <span>⏱️ Tol:</span>
                              {formatted}
                            </div>
                          );
                        } else {
                          return (
                            <div className="mt-1 bg-red-600 text-white font-mono font-bold text-[8px] px-1 py-0.5 rounded border border-red-500 animate-pulse shrink-0">
                              LIBERANDO
                            </div>
                          );
                        }
                      }
                      return null;
                    })()
                  )}
                  
                  {/* Occupied sign */}
                  {!activeRes && table.status === 'occupied' && (
                    <div className="mt-1 bg-brand-secondary text-brand-surface font-sans font-bold text-[8px] px-1 rounded uppercase tracking-wider shadow-sm shrink-0">
                      Ocupado
                    </div>
                  )}
                </div>

                {/* Table selection helper */}
                {isSelected && !isEditMode && (
                  <span className="absolute -top-1.5 -right-1.5 bg-brand-text text-brand-surface rounded-full p-0.5 shadow-md flex items-center justify-center z-10">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </span>
                )}
              </div>
            );
          })}

          {/* Render Decorations */}
          {decorations.map((dec) => {
            const isSelected = editingDecorationId === dec.id;

            return (
              <div
                key={dec.id}
                style={{
                  position: 'absolute',
                  left: `${dec.x}%`,
                  top: `${dec.y}%`,
                  width: `${dec.width}px`,
                  height: `${dec.height}px`,
                  transform: `rotate(${dec.rotation}deg)`,
                  touchAction: 'none',
                }}
                onPointerDown={(e) => handlePointerDown(e, dec.id, 'decoration')}
                onClick={() => {
                  if (isEditMode) {
                    setEditingDecorationId(isSelected ? null : dec.id);
                    setEditingPropertiesId(null); // Deselect table
                  }
                }}
                className={`flex flex-col items-center justify-center cursor-pointer transition-all duration-150 relative shadow-md select-none overflow-hidden
                  ${dec.type === 'wall' ? 'bg-zinc-700/60 border border-zinc-500/80 rounded' : ''}
                  ${dec.type === 'plant' ? 'bg-emerald-950/40 border border-emerald-600/40 rounded-full' : ''}
                  ${dec.type === 'furniture' ? 'bg-amber-950/30 border border-amber-800/40 rounded-xl' : ''}
                  ${dec.type === 'bar_counter' ? 'bg-slate-800 border-2 border-slate-700 rounded-lg shadow-inner' : ''}
                  ${isSelected && isEditMode ? 'ring-2 ring-brand-primary border-brand-primary scale-105 z-20 shadow-[0_0_15px_rgba(245,158,11,0.4)]' : ''}
                  ${isEditMode ? 'hover:scale-105' : ''}
                `}
                title={dec.name}
              >
                {/* Visual indicator / Icon */}
                <div
                  style={{ transform: `rotate(-${dec.rotation}deg)` }}
                  className="flex flex-col items-center justify-center text-center p-1 pointer-events-none text-brand-text/90 w-full h-full relative"
                >
                  {dec.type === 'plant' && (() => {
                    const model = PLANT_MODELS.find(m => m.id === dec.plantModel) || PLANT_MODELS[0];
                    return (
                      <div className="w-full h-full absolute inset-0 p-1 flex items-center justify-center">
                        {model.render("text-emerald-400")}
                      </div>
                    );
                  })()}
                  {dec.type === 'furniture' && (
                    <Sofa className="w-5 h-5 text-amber-400/90 z-10" />
                  )}
                  {dec.type === 'bar_counter' && (
                    <Columns3 className="w-5 h-5 text-slate-400 z-10" />
                  )}
                  {dec.type === 'wall' && (
                    <span className="w-full h-1 bg-zinc-400/40 rounded z-10" />
                  )}
                  
                  {/* Name */}
                  {dec.type !== 'wall' && (
                    <span className="text-[8px] font-mono tracking-tight text-brand-muted/90 font-bold truncate max-w-full px-1 mt-0.5 z-10 bg-brand-surface-high/80 rounded border border-brand-outline/25 shadow-sm">
                      {dec.name}
                    </span>
                  )}
                  {dec.type === 'wall' && (
                    <span className="text-[7px] font-mono font-bold text-zinc-400 z-10">Muro</span>
                  )}
                </div>
              </div>
            );
          })}
            </div>
          </div>

          {/* Controles de Zoom (flotan sobre el lienzo) */}
          <div className="absolute bottom-3 right-3 z-30 flex flex-col items-center bg-brand-surface/90 backdrop-blur border border-brand-outline rounded-xl shadow-lg overflow-hidden">
            <button
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              title="Acercar"
              className="p-2 text-brand-text hover:bg-brand-surface-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-full px-2 py-1 text-center text-[9px] font-mono text-brand-muted border-y border-brand-outline/60 tabular-nums">
              {Math.round(zoom * 100)}%
            </div>
            <button
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              title="Alejar"
              className="p-2 text-brand-text hover:bg-brand-surface-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={zoomReset}
              title="Ajustar / restablecer"
              className="p-2 text-brand-primary hover:bg-brand-surface-high border-t border-brand-outline/60 transition-colors cursor-pointer"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sidebar property editor in Edit Mode */}
        {isEditMode && editingPropertiesId && (
          <div className="w-full md:w-64 bg-brand-surface-high border-t md:border-t-0 md:border-l border-brand-outline p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-brand-outline pb-2 mb-4">
                <h4 className="font-sans font-bold text-xs text-brand-text uppercase tracking-wider">
                  Mesa Seleccionada
                </h4>
                <button
                  onClick={() => setEditingPropertiesId(null)}
                  className="text-brand-muted hover:text-brand-secondary text-xs cursor-pointer"
                >
                  Cerrar
                </button>
              </div>

              {(() => {
                const table = tables.find(t => t.id === editingPropertiesId);
                if (!table) return <p className="text-xs text-brand-muted">Mesa no encontrada</p>;

                return (
                  <div className="space-y-4">
                    {/* Rename */}
                    <div>
                      <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Nombre Identificador</label>
                      <input
                        type="text"
                        value={table.name}
                        onChange={(e) => onUpdateTable({ ...table, name: e.target.value })}
                        className="w-full bg-brand-surface-low border border-brand-outline rounded px-2.5 py-1.5 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
                      />
                    </div>

                    {/* Shape Toggle */}
                    <div>
                      <span className="text-[10px] uppercase font-mono text-brand-muted block mb-1.5">Geometría de Mesa</span>
                      <button
                        onClick={() => handleShapeChange(table)}
                        className="w-full flex items-center justify-between bg-brand-surface-low border border-brand-outline rounded px-2.5 py-1.5 text-xs text-brand-text cursor-pointer hover:bg-brand-surface-highest transition-colors"
                      >
                        <span className="capitalize">{table.shape === 'square' ? 'Cuadrada' : table.shape === 'circle' ? 'Circular' : table.shape === 'rectangle' ? 'Rectangular' : 'Barra de Stool'}</span>
                        <RotateCw className="w-3.5 h-3.5 text-brand-primary" />
                      </button>
                    </div>

                    {/* Capacity Seats */}
                    <div>
                      <span className="text-[10px] uppercase font-mono text-brand-muted block mb-1.5">Capacidad Máxima (Comensales)</span>
                      <div className="flex items-center justify-between bg-brand-surface-low border border-brand-outline rounded p-1">
                        <button
                          onClick={() => handleSeatsChange(table, false)}
                          className="px-2 py-1 text-xs font-bold text-brand-secondary hover:bg-brand-surface-high rounded cursor-pointer"
                        >
                          -
                        </button>
                        <span className="text-xs font-mono font-bold text-brand-text">{table.seats} pax</span>
                        <button
                          onClick={() => handleSeatsChange(table, true)}
                          className="px-2 py-1 text-xs font-bold text-brand-primary hover:bg-brand-surface-high rounded cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Rotate */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRotate(table)}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-brand-surface-low border border-brand-outline hover:bg-brand-surface-highest text-brand-text py-2 rounded text-xs transition-colors cursor-pointer"
                      >
                        <RotateCw className="w-3.5 h-3.5 text-brand-primary" />
                        Rotar 90°
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Danger Zone: Delete */}
            <div className="pt-4 border-t border-brand-outline mt-6">
              <button
                onClick={() => {
                  if (confirm('¿Estás seguro de que quieres eliminar esta mesa del plano?')) {
                    onDeleteTable(editingPropertiesId);
                    setEditingPropertiesId(null);
                  }
                }}
                className="w-full flex items-center justify-center gap-1.5 bg-brand-secondary/10 border border-brand-secondary/20 hover:bg-brand-secondary/25 text-brand-secondary py-2 rounded text-xs transition-colors font-sans cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar Mesa
              </button>
            </div>
          </div>
        )}

        {/* Sidebar decoration property editor in Edit Mode */}
        {isEditMode && editingDecorationId && (
          <div className="w-full md:w-64 bg-brand-surface-high border-t md:border-t-0 md:border-l border-brand-outline p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-brand-outline pb-2 mb-4">
                <h4 className="font-sans font-bold text-xs text-brand-text uppercase tracking-wider">
                  Decoración
                </h4>
                <button
                  onClick={() => setEditingDecorationId(null)}
                  className="text-brand-muted hover:text-brand-secondary text-xs cursor-pointer"
                >
                  Cerrar
                </button>
              </div>

              {(() => {
                const dec = decorations.find(d => d.id === editingDecorationId);
                if (!dec) return <p className="text-xs text-brand-muted">Decoración no encontrada</p>;

                return (
                  <div className="space-y-4">
                    {/* Rename */}
                    <div>
                      <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Nombre</label>
                      <input
                        type="text"
                        value={dec.name}
                        onChange={(e) => onUpdateDecoration({ ...dec, name: e.target.value })}
                        className="w-full bg-brand-surface-low border border-brand-outline rounded px-2.5 py-1.5 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
                      />
                    </div>

                    {/* Width adjustment */}
                    <div>
                      <span className="text-[10px] uppercase font-mono text-brand-muted block mb-1.5">Ancho (px): {dec.width}</span>
                      <input
                        type="range"
                        min="10"
                        max="400"
                        value={dec.width}
                        onChange={(e) => onUpdateDecoration({ ...dec, width: Number(e.target.value) })}
                        className="w-full accent-brand-primary cursor-pointer"
                      />
                    </div>

                    {/* Height adjustment */}
                    <div>
                      <span className="text-[10px] uppercase font-mono text-brand-muted block mb-1.5">Alto (px): {dec.height}</span>
                      <input
                        type="range"
                        min="10"
                        max="400"
                        value={dec.height}
                        onChange={(e) => onUpdateDecoration({ ...dec, height: Number(e.target.value) })}
                        className="w-full accent-brand-primary cursor-pointer"
                      />
                    </div>

                    {/* Rotation */}
                    <div>
                      <span className="text-[10px] uppercase font-mono text-brand-muted block mb-1.5 font-bold">Rotación ({dec.rotation}°)</span>
                      <button
                        onClick={() => handleRotateDecoration(dec)}
                        className="w-full flex items-center justify-center gap-1.5 bg-brand-surface-low border border-brand-outline hover:bg-brand-surface-highest text-brand-text py-2 rounded text-xs transition-colors cursor-pointer"
                      >
                        <RotateCw className="w-3.5 h-3.5 text-brand-primary" />
                        Rotar 45°
                      </button>
                    </div>

                    {/* Plant Model Selection Menu */}
                    {dec.type === 'plant' && (
                      <div className="border-t border-brand-outline/50 pt-4 mt-2">
                        <span className="text-[10px] uppercase font-mono text-brand-muted block mb-2 font-bold flex items-center gap-1">
                          <span>Estilo de Planta (Icono Top-down)</span>
                        </span>
                        <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                          {PLANT_MODELS.map((model) => {
                            const isSelectedModel = (dec.plantModel || 'rosette') === model.id;
                            return (
                              <button
                                key={model.id}
                                type="button"
                                onClick={() => onUpdateDecoration({ ...dec, plantModel: model.id })}
                                className={`flex flex-col items-center justify-between p-2 rounded-xl border transition-all text-center cursor-pointer relative group bg-brand-surface-low/50 hover:bg-brand-surface-low
                                  ${isSelectedModel 
                                    ? 'border-brand-primary ring-1 ring-brand-primary/50 bg-brand-primary/5' 
                                    : 'border-brand-outline hover:border-brand-primary/40'
                                  }`}
                              >
                                <div className="w-12 h-12 flex items-center justify-center p-1 bg-emerald-950/20 rounded-lg mb-1">
                                  {model.render(isSelectedModel ? "text-brand-primary" : "text-emerald-400")}
                                </div>
                                <div className="text-[9px] font-sans font-bold text-brand-text truncate w-full leading-tight">
                                  {model.name}
                                </div>
                                <div className="text-[7px] text-brand-muted font-sans line-clamp-1 w-full leading-tight mt-0.5">
                                  {model.description}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Danger Zone: Delete */}
            <div className="pt-4 border-t border-brand-outline mt-6">
              <button
                onClick={() => {
                  if (confirm('¿Estás seguro de que quieres eliminar esta decoración?')) {
                    onDeleteDecoration(editingDecorationId);
                    setEditingDecorationId(null);
                  }
                }}
                className="w-full flex items-center justify-center gap-1.5 bg-brand-secondary/10 border border-brand-secondary/20 hover:bg-brand-secondary/25 text-brand-secondary py-2 rounded text-xs transition-colors font-sans cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar Decoración
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend Status indicators */}
      <div className="px-4 py-2 bg-brand-surface-low border-t border-brand-outline flex flex-wrap gap-4 text-xs font-sans text-brand-muted">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 bg-zinc-500/10 border border-zinc-500/30 rounded" />
          <span>Libre / Disponible</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 bg-brand-tertiary/10 border border-brand-tertiary rounded" />
          <span>Reservada (Para Hoy)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 bg-brand-secondary/10 border border-brand-secondary rounded" />
          <span>Ocupada en Servicio</span>
        </div>
        <div className="ml-auto text-[10px] text-brand-muted/50 font-mono hidden sm:block">
          DineControl AI v1.0 • Floor Plan Editor
        </div>
      </div>
    </div>
  );
};
