/**
 * Normalización de teléfonos.
 *
 * En los datos que venían de n8n, el MISMO cliente aparece con formatos
 * distintos: "+34624114533" y "624114533" generaron dos fichas separadas
 * (Antony Bracamonte y Prueba Fixed Mode comparten número). Como la ficha se
 * busca por el teléfono, cada variante partía el historial y las alergias del
 * cliente en dos, que es justo lo que la memoria de clientes debe evitar.
 *
 * Dos operaciones deliberadamente separadas:
 *   normalize()  — con qué formato se GUARDA (E.164 cuando hay certeza)
 *   digitsKey()  — con qué se BUSCA (los 9 últimos dígitos, lo que hace que
 *                  "624114533" y "+34624114533" se reconozcan como el mismo)
 *
 * Principio: si no hay certeza, NO se inventa. Un número "corregido" a mal es
 * peor que uno sin normalizar, porque llamar al cliente equivocado no se nota
 * hasta que ya no hay tiempo de arreglarlo.
 */

const PAIS_DEFECTO = "34"; // España

function soloDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

/**
 * Lleva un teléfono a E.164 ("+34…") cuando se puede afirmar con certeza.
 * Si la longitud no cuadra con nada conocido, devuelve solo los dígitos sin
 * prefijo inventado: se conserva el dato tal cual y `esSospechoso()` permite
 * detectarlo para revisión manual.
 */
function normalize(valor) {
  const bruto = String(valor || "").trim();
  if (!bruto) return "";

  const yaInternacional = bruto.startsWith("+");
  const d = soloDigitos(bruto);
  if (!d) return "";

  if (yaInternacional) return `+${d}`;
  // "34" + 9 dígitos: solo le falta el "+"
  if (d.length === 11 && d.startsWith(PAIS_DEFECTO)) return `+${d}`;
  // 9 dígitos españoles (móvil 6/7, fijo 8/9)
  if (d.length === 9 && /^[6789]/.test(d)) return `+${PAIS_DEFECTO}${d}`;
  return d;
}

/**
 * Clave de búsqueda: los últimos 9 dígitos.
 *
 * Es lo que permite reconocer como la misma persona a "624114533" y
 * "+34624114533" sin tener que adivinar el país. Para números de menos de 9
 * dígitos devuelve lo que haya, y quien busque debe caer a comparación exacta
 * (con 4 dígitos, un sufijo coincidiría con demasiada gente).
 */
function digitsKey(valor) {
  const d = soloDigitos(valor);
  return d.length >= 9 ? d.slice(-9) : d;
}

/** ¿Se puede usar digitsKey() para buscar, o hay que comparar exacto? */
function esClaveFiable(valor) {
  return soloDigitos(valor).length >= 9;
}

/**
 * Marca números con pinta dudosa, para revisarlos a mano en vez de asumir que
 * son correctos. Casos reales encontrados en los datos de n8n:
 *   "6871134476" — 10 dígitos sin prefijo (parece un dígito de más)
 *   "542389123"  — 9 dígitos pero empieza por 5, que no existe en España
 * Un teléfono vacío NO es sospechoso: simplemente no hay dato.
 */
function esSospechoso(valor) {
  const bruto = String(valor || "").trim();
  const d = soloDigitos(bruto);
  if (!d) return false;
  if (bruto.startsWith("+")) return d.length < 8 || d.length > 15; // límite de E.164
  if (d.length === 11 && d.startsWith(PAIS_DEFECTO)) return false;
  if (d.length === 9) return !/^[6789]/.test(d);
  return true;
}

/** "+34624114533" -> "624 11 45 33" para leerlo en el panel. */
function formatoLegible(valor) {
  const d = soloDigitos(valor);
  const nacional = d.length === 11 && d.startsWith(PAIS_DEFECTO) ? d.slice(2) : d;
  if (nacional.length !== 9) return String(valor || "");
  return `${nacional.slice(0, 3)} ${nacional.slice(3, 5)} ${nacional.slice(5, 7)} ${nacional.slice(7)}`;
}

module.exports = { normalize, digitsKey, esClaveFiable, esSospechoso, formatoLegible };
