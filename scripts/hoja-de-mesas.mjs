/**
 * Genera una hoja con el catálogo de mesas para revisarlo sin abrir el panel.
 *
 * Dibuja llamando al componente de verdad (`TableModels.tsx`), no a una copia:
 * una lámina que se hace a mano deja de parecerse al panel a la primera
 * corrección, y entonces sirve para engañarse, no para revisar.
 *
 *   node scripts/hoja-de-mesas.mjs [salida.html]
 */

import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');
// esbuild, react y react-dom viven en app/, no en la raíz del proyecto.
const require = createRequire(join(raiz, 'app', 'package.json'));
const { build } = require('esbuild');

const salida = process.argv[2] || join(raiz, 'catalogo-de-mesas.html');

// Se compila el TSX a un módulo que Node pueda cargar. El resultado tiene que
// quedar DENTRO de app/ aunque sea temporal: si no, `react` no se resuelve,
// porque node busca node_modules subiendo desde donde está el fichero.
const bundle = join(raiz, 'app', `.hoja-de-mesas-${process.pid}.mjs`);

await build({
  entryPoints: [join(raiz, 'app', 'src', 'components', 'TableModels.tsx')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  logLevel: 'silent',
});

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { TABLE_MODELS } = await import(pathToFileURL(bundle).href);

// Se dibuja cada modelo a varias capacidades porque las sillas salen de ahí:
// una mesa de dos y una de ocho son el mismo modelo y no se parecen.
const CAPACIDADES = [2, 4, 6, 8];

const ESTADOS = [
  ['Libre', '#a1a1aa', 1],
  ['Reservada', '#fbbf24', 1],
  ['Ocupada', '#f87171', 1],
  ['Fuera de servicio', '#52525b', 0.6],
];

const svg = (modelo, plazas) =>
  renderToStaticMarkup(
    React.createElement(
      'svg',
      { viewBox: modelo.viewBox, preserveAspectRatio: 'xMidYMid meet', width: '100%', height: '100%' },
      modelo.render(plazas)
    )
  );

const filaModelo = (m) => `
<section class="modelo">
  <header><b>${m.name}</b><span>${m.description}</span></header>
  <div class="capacidades">
    ${CAPACIDADES.map(
      (n) => `<figure><div class="lienzo">${svg(m, n)}</div><figcaption>${n} pax</figcaption></figure>`
    ).join('')}
  </div>
</section>`;

const redonda = TABLE_MODELS[0];

const html = `<!doctype html><meta charset="utf-8"><title>Catálogo de mesas — DineControl</title>
<style>
  :root{color-scheme:dark}
  body{background:#0b0b0e;color:#e4e4e7;font:14px/1.6 system-ui,-apple-system,sans-serif;margin:0;padding:40px}
  h1{font-size:22px;margin:0 0 6px;letter-spacing:-.01em}
  p.sub{color:#8b8b93;margin:0 0 8px;max-width:62ch}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#8b8b93;
     margin:44px 0 18px;border-bottom:1px solid #26262b;padding-bottom:10px}
  .modelo{background:#141418;border:1px solid #26262b;border-radius:16px;padding:18px 20px;margin-bottom:14px}
  .modelo header b{font-size:14px}
  .modelo header span{color:#71717a;font-size:12px;margin-left:10px}
  .capacidades{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:14px}
  .lienzo{height:104px;display:flex;align-items:center;justify-content:center;color:#fbbf24}
  figure{margin:0;text-align:center}
  figcaption{font:11px/1 ui-monospace,monospace;color:#71717a;margin-top:6px}
  .estados{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .estados .modelo{margin:0}
</style>
<h1>Catálogo de mesas — vista cenital</h1>
<p class="sub">Generado con el mismo componente que dibuja el plano del panel. Las sillas
no se colocan a mano: salen de la capacidad de cada mesa, así que cambiar el aforo
cambia el dibujo.</p>

<h2>Los ocho modelos, a distintas capacidades</h2>
${TABLE_MODELS.map(filaModelo).join('')}

<h2>El mismo mueble según el estado de la mesa</h2>
<div class="estados">
  ${ESTADOS.map(
    ([nombre, color, op]) => `
    <section class="modelo">
      <div class="lienzo" style="color:${color};opacity:${op}">${svg(redonda, 4)}</div>
      <figcaption>${nombre}</figcaption>
    </section>`
  ).join('')}
</div>`;

writeFileSync(salida, html, 'utf8');
rmSync(bundle, { force: true });
console.log(`Hoja escrita en ${salida} (${TABLE_MODELS.length} modelos).`);
