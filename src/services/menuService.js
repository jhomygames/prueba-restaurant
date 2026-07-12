/**
 * Fuente única de la carta. La carta vive en la tabla `Carta` de Airtable
 * (editable desde el panel); `src/config/menu.json` queda como semilla y
 * fallback si Airtable no responde.
 *
 * Devuelve el MISMO shape que consumían los agentes (voz/WhatsApp/simulador)
 * a través de toolDispatcher.getMenuInfo, con los alérgenos en el formato del
 * catálogo (minúsculas/underscore) para no romper el filtro exclude_allergen.
 *
 * Caché en memoria con TTL corto: los agentes consultan la carta en cada
 * llamada y no queremos una petición a Airtable por turno. Las escrituras del
 * panel llaman a invalidateCache().
 */

const { listRecords } = require("./airtableClient");
const menuJson = require("../config/menu.json");

const TABLE = "Carta";
const TTL_MS = 60 * 1000;

// Inverso del mapeo del seed: nombre oficial del select -> clave del catálogo.
const LABEL_TO_KEY = {
  "Gluten": "gluten", "Crustáceos": "crustaceos", "Huevos": "huevos",
  "Pescado": "pescado", "Cacahuetes": "cacahuetes", "Soja": "soja",
  "Lácteos": "lacteos", "Frutos de cáscara": "frutos_de_cascara", "Apio": "apio",
  "Mostaza": "mostaza", "Sésamo": "sesamo", "Sulfitos": "sulfitos",
  "Altramuces": "altramuces", "Moluscos": "moluscos",
  // Dietas: no forman parte del catálogo legal, se conservan tal cual.
  "Vegano": "vegano", "Vegetariano": "vegetariano", "Sin Sal": "sin_sal",
};

let cache = null; // { at:number, menu:object }

function alergenoToKey(label) {
  return LABEL_TO_KEY[label] || String(label).toLowerCase();
}

// Agrupa registros planos de Airtable en el shape por categorías del menú.
function recordsToMenu(records) {
  const orden = new Map(menuJson.categorias.map((c, i) => [c.nombre, i]));
  const byCat = new Map();

  for (const rec of records) {
    const f = rec.fields;
    const cat = f.Categoria || "Otros";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({
      nombre: f.Nombre || "",
      precio: typeof f.Precio === "number" ? f.Precio : null,
      descripcion: f.Descripcion || "",
      alergenos: (f.Alergenos || []).map(alergenoToKey),
      _orden: typeof f.Orden === "number" ? f.Orden : 0,
    });
  }

  const categorias = [...byCat.entries()]
    .sort((a, b) => {
      const ia = orden.has(a[0]) ? orden.get(a[0]) : 999;
      const ib = orden.has(b[0]) ? orden.get(b[0]) : 999;
      return ia - ib;
    })
    .map(([nombre, platos]) => ({
      nombre,
      platos: platos.sort((x, y) => x._orden - y._orden).map(({ _orden, ...p }) => p),
    }));

  return {
    categorias,
    alergenos_catalogo: menuJson.alergenos_catalogo,
    nota_alergenos:
      "Alérgenos de ejemplo pendientes de validación por el restaurante. Ante alergias graves, recomendar siempre confirmarlo con el personal en sala.",
  };
}

/**
 * Devuelve la carta agrupada. Por defecto solo platos disponibles (lo que ven
 * los agentes). Cachea el resultado de `disponibles` durante TTL_MS.
 */
async function getMenu({ includeUnavailable = false } = {}) {
  if (!includeUnavailable && cache && Date.now() - cache.at < TTL_MS) {
    return cache.menu;
  }

  try {
    const filter = includeUnavailable ? {} : { filterByFormula: "{Disponible} = TRUE()" };
    const records = await listRecords(TABLE, filter);
    const menu = recordsToMenu(records);
    if (!includeUnavailable) cache = { at: Date.now(), menu };
    return menu;
  } catch (err) {
    console.error("[menuService] Airtable falló, usando menu.json de fallback:", err.message);
    return menuJson;
  }
}

function invalidateCache() {
  cache = null;
}

module.exports = { getMenu, invalidateCache };
