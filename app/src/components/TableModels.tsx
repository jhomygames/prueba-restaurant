import React from 'react';
import type { TableShape } from '../types';

/**
 * Catálogo de muebles del plano, vistos desde arriba.
 *
 * Antes una mesa era una caja de CSS con un borde de color: un reservado y una
 * mesa alta de barra se dibujaban igual. Sobre un plano eso no vale, porque lo
 * que se busca de un vistazo es "dónde puedo sentar a seis" y eso se ve en el
 * mueble, no en un número.
 *
 * Convenio de dibujo, el de los planos de arquitecto: relleno plano, contorno
 * fino y sillas separadas del canto de la mesa. El color no se fija aquí — todo
 * usa `currentColor`, para que lo ponga el estado de la mesa (libre, reservada,
 * ocupada, fuera de servicio) desde el componente padre.
 *
 * Las sillas se dibujan a partir de la capacidad: una mesa de cuatro enseña
 * cuatro sillas. Si alguien cambia el aforo, el dibujo se cambia solo.
 */

export interface TableModelInfo {
  id: string;
  name: string;
  description: string;
  /** Tamaño del mueble en px a zoom 1. Da la proporción del hueco que ocupa. */
  size: { w: number; h: number };
  viewBox: string;
  /** Sillas más allá de este número no caben y se dejan de dibujar. */
  maxSillas: number;
  render: (plazas: number) => React.ReactNode;
}

// Sillas y mesa comparten trazo para que el conjunto se lea como un mueble.
const TRAZO = 1.6;

/** Relleno del tablero. Suficiente para leerse sobre el fondo oscuro. */
const tablero = {
  fill: 'currentColor',
  fillOpacity: 0.22,
  stroke: 'currentColor',
  strokeWidth: TRAZO,
};

const asiento = {
  fill: 'currentColor',
  fillOpacity: 0.13,
  stroke: 'currentColor',
  strokeWidth: TRAZO,
};

/**
 * Una silla. Se dibuja mirando hacia arriba y el respaldo es la línea gruesa
 * del fondo; girándola, el respaldo queda siempre en el lado de fuera.
 */
const Silla: React.FC<{ x: number; y: number; giro?: number; ancho?: number }> = ({
  x,
  y,
  giro = 0,
  ancho = 13,
}) => {
  const a = ancho / 2;
  return (
    <g transform={`translate(${x} ${y}) rotate(${giro})`}>
      <rect x={-a} y={-5} width={ancho} height={10} rx={2.5} {...asiento} />
      <path
        d={`M ${-a} -5 L ${a} -5`}
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        opacity={0.75}
      />
    </g>
  );
};

/** Taburete: sin respaldo, que es lo que lo distingue de una silla. */
const Taburete: React.FC<{ x: number; y: number; r?: number }> = ({ x, y, r = 5 }) => (
  <circle cx={x} cy={y} r={r} {...asiento} />
);

/** Reparte n sillas alrededor de un círculo, empezando arriba. */
function sillasEnCirculo(n: number, cx: number, cy: number, radio: number) {
  return Array.from({ length: n }, (_, i) => {
    const ang = (360 / n) * i;
    const rad = (ang * Math.PI) / 180;
    return (
      <Silla
        key={i}
        x={cx + radio * Math.sin(rad)}
        y={cy - radio * Math.cos(rad)}
        giro={ang}
      />
    );
  });
}

/**
 * Reparte n sillas por el perímetro de un rectángulo.
 *
 * Se llenan primero los lados largos, que es como se sienta la gente de verdad;
 * las cabeceras solo cuando ya no caben más a los lados.
 */
function sillasEnRectangulo(
  n: number,
  x: number,
  y: number,
  w: number,
  h: number,
  hueco: number
) {
  const porLado = Math.ceil(n / 2);
  const cabeceras = Math.max(0, n - porLado * 2);
  const arriba = Math.ceil((n - cabeceras) / 2);
  const abajo = n - cabeceras - arriba;

  const enLinea = (cuantas: number, cb: (i: number, t: number) => React.ReactNode) =>
    Array.from({ length: cuantas }, (_, i) => cb(i, (i + 1) / (cuantas + 1)));

  return (
    <>
      {enLinea(arriba, (i, t) => (
        <Silla key={`a${i}`} x={x + w * t} y={y - hueco} giro={0} />
      ))}
      {enLinea(abajo, (i, t) => (
        <Silla key={`b${i}`} x={x + w * t} y={y + h + hueco} giro={180} />
      ))}
      {cabeceras > 0 && <Silla key="i" x={x - hueco} y={y + h / 2} giro={270} />}
      {cabeceras > 1 && <Silla key="d" x={x + w + hueco} y={y + h / 2} giro={90} />}
    </>
  );
}

export const TABLE_MODELS: TableModelInfo[] = [
  {
    id: 'redonda',
    name: 'Redonda',
    description: 'La de toda la vida, con sillas alrededor',
    size: { w: 78, h: 78 },
    viewBox: '0 0 100 100',
    maxSillas: 10,
    render: (plazas) => (
      <>
        {sillasEnCirculo(Math.min(plazas, 10), 50, 50, 40)}
        <circle cx={50} cy={50} r={26} {...tablero} />
      </>
    ),
  },
  {
    id: 'cuadrada',
    name: 'Cuadrada',
    description: 'Para dos o cuatro, una silla por lado',
    size: { w: 78, h: 78 },
    viewBox: '0 0 100 100',
    maxSillas: 8,
    render: (plazas) => (
      <>
        {sillasEnRectangulo(Math.min(plazas, 8), 28, 28, 44, 44, 11)}
        <rect x={28} y={28} width={44} height={44} rx={4} {...tablero} />
      </>
    ),
  },
  {
    id: 'rectangular',
    name: 'Rectangular',
    description: 'Alargada, con sillas a los lados y en las cabeceras',
    size: { w: 108, h: 74 },
    viewBox: '0 0 150 100',
    maxSillas: 10,
    render: (plazas) => (
      <>
        {sillasEnRectangulo(Math.min(plazas, 10), 32, 32, 86, 36, 11)}
        <rect x={32} y={32} width={86} height={36} rx={4} {...tablero} />
      </>
    ),
  },
  {
    id: 'ovalada',
    name: 'Ovalada',
    description: 'Cantos redondeados, se pasa mejor alrededor',
    size: { w: 108, h: 74 },
    viewBox: '0 0 150 100',
    maxSillas: 10,
    render: (plazas) => (
      <>
        {sillasEnRectangulo(Math.min(plazas, 10), 32, 32, 86, 36, 11)}
        <rect x={32} y={32} width={86} height={36} rx={18} {...tablero} />
      </>
    ),
  },
  {
    id: 'corrida',
    name: 'Corrida',
    description: 'Mesa larga de grupo, para banquetes',
    size: { w: 140, h: 66 },
    viewBox: '0 0 200 100',
    maxSillas: 16,
    render: (plazas) => (
      <>
        {sillasEnRectangulo(Math.min(plazas, 16), 20, 34, 160, 32, 11)}
        <rect x={20} y={34} width={160} height={32} rx={3} {...tablero} />
        {/* La junta del centro: dos tableros unidos, como se montan de verdad. */}
        <path d="M 100 34 L 100 66" stroke="currentColor" strokeWidth={1} opacity={0.4} />
      </>
    ),
  },
  {
    id: 'reservado',
    name: 'Reservado',
    description: 'Mesa entre dos bancos corridos',
    size: { w: 100, h: 84 },
    viewBox: '0 0 130 110',
    maxSillas: 8,
    render: () => (
      <>
        {/* Los bancos no se cuentan por sillas: se sienta quien quepa. */}
        <rect x={18} y={10} width={94} height={20} rx={7} {...asiento} />
        <path d="M 18 10 L 112 10" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" opacity={0.75} />
        <rect x={18} y={80} width={94} height={20} rx={7} {...asiento} />
        <path d="M 18 100 L 112 100" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" opacity={0.75} />
        <rect x={26} y={38} width={78} height={34} rx={4} {...tablero} />
      </>
    ),
  },
  {
    id: 'alta',
    name: 'Alta',
    description: 'Mesa alta de pie, con taburetes',
    size: { w: 66, h: 66 },
    viewBox: '0 0 100 100',
    maxSillas: 6,
    render: (plazas) => {
      const n = Math.min(Math.max(plazas, 1), 6);
      return (
        <>
          {Array.from({ length: n }, (_, i) => {
            const rad = ((360 / n) * i * Math.PI) / 180;
            return <Taburete key={i} x={50 + 38 * Math.sin(rad)} y={50 - 38 * Math.cos(rad)} />;
          })}
          <circle cx={50} cy={50} r={22} {...tablero} />
          {/* El pie central, que es lo que la distingue de una mesa normal. */}
          <circle cx={50} cy={50} r={7} fill="currentColor" fillOpacity={0.3} />
        </>
      );
    },
  },
  {
    id: 'barra',
    name: 'Barra',
    description: 'Tramo de barra con taburetes por fuera',
    size: { w: 124, h: 56 },
    viewBox: '0 0 180 80',
    maxSillas: 8,
    render: (plazas) => {
      const n = Math.min(Math.max(plazas, 1), 8);
      return (
        <>
          {Array.from({ length: n }, (_, i) => (
            <Taburete key={i} x={(180 / (n + 1)) * (i + 1)} y={62} r={6} />
          ))}
          <rect x={10} y={18} width={160} height={26} rx={3} {...tablero} />
          {/* El canto por el que se atiende. */}
          <path d="M 10 44 L 170 44" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" opacity={0.6} />
        </>
      );
    },
  },
];

/** Las formas de siempre, traducidas al mueble que más se les parece. */
const DESDE_FORMA: Record<TableShape, string> = {
  square: 'cuadrada',
  circle: 'redonda',
  rectangle: 'rectangular',
  bar: 'alta',
};

/**
 * Modelo de una mesa. Si no tiene ninguno elegido se deduce de su forma, para
 * que las mesas de antes del catálogo se sigan viendo sin tocarlas.
 */
export function modeloDeMesa(model: string | undefined, shape: TableShape): TableModelInfo {
  const id = model || DESDE_FORMA[shape] || 'cuadrada';
  return TABLE_MODELS.find((m) => m.id === id) || TABLE_MODELS[1];
}
