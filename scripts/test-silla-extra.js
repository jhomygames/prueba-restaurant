require('dotenv').config();
const db = require('../src/services/supabaseClient');
const escribir = require('../src/services/repo/escribir');
const agente = require('../src/services/agente');

const ctx = { restaurante: 'el-sazon-venezolano' };
const F = '2099-10-12';
let fallos = 0;
const creadas = [];

const ok = (d, c, x = '') => { if (c) console.log('  ok   ' + d); else { fallos++; console.log('  FALLA ' + d + (x ? ' - ' + x : '')); } };

async function main() {
  const mesas = await db.listar(ctx, 'mesas', { orden: 'capacidad.desc' });
  const mesaMax = mesas.find(m => m.estado !== 'Fuera de servicio');
  console.log('Mesa más grande disponible:', mesaMax.nombre, '(' + mesaMax.capacidad + ' plazas)');

  console.log('\nEl caso real de la llamada (9 personas, sin mesa que llegue sola):');
  const disp = await escribir.buscarMesaLibre(ctx, { fecha: F, hora: '21:00', personas: 9, duracion: 120 });
  ok('encuentra la mesa más grande con silla extra', disp && disp.id === mesaMax.id && disp.sillasExtra === 1, JSON.stringify(disp));

  const check = await agente._internos.comprobarGrupo(9);
  ok('9 personas no dispara GRUPO_GRANDE (sigue siendo el comportamiento correcto)', check.ok);

  const r = await escribir.crearReserva(ctx, { fecha: F, hora: '21:00', personas: 9, nombre: 'ZZSILLA Cumple', telefono: '', notas: 'Cumpleaños sorpresa.', duracionMin: 120 });
  if (r.creada) creadas.push(r.reserva.id);
  ok('la reserva de 9 se crea', r.creada, JSON.stringify(r).slice(0, 150));
  ok('queda registrado sillasExtra: 1', r.sillasExtra === 1, String(r.sillasExtra));
  ok('las notas mencionan la silla para el personal', r.creada && /silla/i.test(r.reserva.notes), r.creada ? r.reserva.notes : '');

  console.log('\nUna segunda de 9 a la misma hora ya NO cabe (la mesa+silla está ocupada):');
  const choque = await escribir.crearReserva(ctx, { fecha: F, hora: '21:00', personas: 9, nombre: 'ZZSILLA Choque', telefono: '', notas: '' });
  ok('se rechaza por falta de mesa', !choque.creada && choque.motivo === 'sin_mesa', choque.motivo);

  console.log('\n10 personas: sigue sin caber físicamente (8+1 silla = 9, no 10),');
  console.log('pero ya no importa porque comprobarGrupo() la intercepta ANTES de buscar mesa:');
  const diez = await escribir.buscarMesaLibre(ctx, { fecha: F, hora: '13:00', personas: 10, duracion: 120 });
  ok('buscarMesaLibre(10) sigue sin encontrar mesa (correcto, es físico)', diez === null, JSON.stringify(diez));
  const grupoDiez = await agente._internos.comprobarGrupo(10);
  ok('pero comprobarGrupo(10) ya escala a humano (umbral corregido a >=)', !grupoDiez.ok && grupoDiez.grupoGrande, JSON.stringify(grupoDiez));

  console.log('\n11 personas: sigue yendo a un humano, sin tocar mesas (ya lo hacía antes):');
  const once = await agente._internos.comprobarGrupo(11);
  ok('11 personas dispara GRUPO_GRANDE', !once.ok && once.grupoGrande, JSON.stringify(once));

  console.log('\nUn grupo normal de 4 sigue funcionando exactamente igual que antes:');
  const normal = await escribir.buscarMesaLibre(ctx, { fecha: F, hora: '14:00', personas: 4, duracion: 90 });
  ok('encuentra mesa exacta, sin silla extra', normal && !normal.sillasExtra, JSON.stringify(normal));
}

main()
  .catch((err) => { fallos++; console.error('\nERROR:', err.message); })
  .finally(async () => {
    for (const id of creadas) await db.borrar(ctx, 'reservas', id).catch(() => {});
    const restos = await db.listar(ctx, 'reservas', { filtros: { fecha: F } });
    for (const r of restos) await db.borrar(ctx, 'reservas', r.id).catch(() => {});
    console.log('\nLimpio (' + creadas.length + ' + ' + restos.length + ' filas de residuo revisadas).');
    console.log(fallos === 0 ? 'Todo correcto.' : fallos + ' fallo(s).');
    process.exit(fallos === 0 ? 0 : 1);
  });
