/**
 * Extrae alérgenos estructurados de una nota escrita a mano.
 *
 * El agente de voz recoge las alergias hablando, así que llegan como texto
 * libre: "Alergia al marisco y al pescado", "Intolerancia al gluten y la
 * lactosa". Así no se puede filtrar la carta ni avisar a cocina de forma fiable.
 * Esto traduce esa frase a los 14 alérgenos oficiales que ya usa el campo
 * `Alergias` de las reservas.
 *
 * DOS REGLAS DE SEGURIDAD, porque aquí equivocarse manda a alguien al hospital:
 *
 *   1. La nota original NUNCA se sustituye. Esto AÑADE información estructurada
 *      encima; el personal sigue leyendo literalmente lo que dijo el cliente.
 *   2. Ante la duda se marca de MÁS, nunca de menos. "Marisco" en el habla
 *      corriente cubre crustáceos y moluscos, así que se marcan los dos.
 *
 * Lo que no se reconoce se devuelve en `sinReconocer` para que quede A LA VISTA
 * en vez de darse por entendido. En los datos reales de n8n había un "Alergia al
 * boco" que no corresponde a ningún alérgeno conocido: eso tiene que llegar al
 * personal como pendiente de aclarar, no desaparecer.
 *
 * Limitación conocida: no interpreta negaciones. "No tiene alergia al gluten"
 * marcaría Gluten. Es el error en la dirección segura y no se corrige con
 * heurísticas frágiles: el personal lee la nota original de todos modos.
 */

// Prefijos desde principio de palabra: "crustace" cubre "crustáceos",
// "vegetarian" cubre "vegetariana". Los acentos se quitan antes de comparar.
const REGLAS = [
  // OJO con los prefijos: casan desde principio de palabra, así que "torta"
  // casaría con "tortilla" (que aquí es de maíz) y "tarta" con "tártara". Por
  // eso no están: en su lugar van palabras que no se solapan con nada.
  {
    alergenos: ["Gluten"],
    claves: [
      "gluten", "trigo", "celiac", "espelta", "cebada", "centeno", "harina",
      // Rebozados y empanados. "empanad" NO está: la empanada venezolana es de
      // maíz, y marcarla con gluten sería una alarma falsa en media carta.
      "empaniz", "rebozad", "crujiente", "panko",
      // Bollería y masas
      "bizcocho", "brownie", "galleta", "hojaldre", "pasta ",
      // El pan de la hamburguesa
      "hamburgues", "burger",
      // Cebada: la cerveza y la malta la llevan
      "cerveza", "malta", "birra",
    ],
  },
  // "Marisco" coloquial = crustáceos + moluscos. Marcar ambos es la opción segura.
  { alergenos: ["Crustáceos", "Moluscos"], claves: ["marisco"] },
  { alergenos: ["Crustáceos"], claves: ["crustace", "gamba", "langostino", "cigala", "cangrejo", "langosta", "bogavante", "camaron", "necora", "percebe"] },
  { alergenos: ["Moluscos"], claves: ["molusco", "mejillon", "almeja", "calamar", "chipiron", "pulpo", "ostra", "berberecho", "vieira", "sepia", "zamburi"] },
  { alergenos: ["Pescado"], claves: ["pescado", "pescaito", "anchoa", "boqueron", "atun", "merluza", "salmon", "bacalao", "sardina", "lubina", "dorada", "rape", "trucha", "anguila", "cazon"] },
  { alergenos: ["Huevos"], claves: ["huevo", "clara de", "yema", "mayonesa", "tartara", "merengue", "alioli"] },
  { alergenos: ["Cacahuetes"], claves: ["cacahuete", "cacahuate", "mani"] },
  { alergenos: ["Soja"], claves: ["soja", "soya", "tofu", "edamame"] },
  {
    alergenos: ["Lácteos"],
    claves: [
      "lactosa", "lacteo", "leche", "nata", "mantequilla", "yogur", "crema de leche",
      // "ques" cubre queso, quesos, quesito y quesillo de una vez
      "ques", "cheddar", "parmesano", "mozzarella", "guayanes", "llanero",
      "helado", "merengue", "bechamel",
      // Cafés que llevan leche aunque su nombre no la nombre. Un intolerante
      // que pide un cortado tiene el mismo problema que con un vaso de leche.
      "capuccino", "capuchino", "cortado", "manchado", "bombon", "latte",
    ],
  },
  // El tequeño es masa de trigo rellena de queso: los dos a la vez.
  { alergenos: ["Gluten", "Lácteos"], claves: ["teque"] },
  // El vino declara sulfitos por norma.
  { alergenos: ["Sulfitos"], claves: ["vino", "verdejo", "rioja", "crianza", "tinto de verano"] },
  { alergenos: ["Frutos de cáscara"], claves: ["fruto seco", "frutos seco", "nuez", "nueces", "almendra", "avellana", "pistacho", "anacardo", "cascara", "pinon", "macadamia"] },
  { alergenos: ["Apio"], claves: ["apio"] },
  { alergenos: ["Mostaza"], claves: ["mostaza"] },
  { alergenos: ["Sésamo"], claves: ["sesamo", "ajonjoli", "tahini"] },
  { alergenos: ["Sulfitos"], claves: ["sulfito", "sulfuroso"] },
  { alergenos: ["Altramuces"], claves: ["altramuz", "altramuce", "lupino"] },
  { alergenos: ["Vegano"], claves: ["vegano", "vegana"] },
  { alergenos: ["Vegetariano"], claves: ["vegetarian"] },
  { alergenos: ["Sin Sal"], claves: ["sin sal", "hiposodic"] },
];

// Palabras que solo indican QUE hay una restricción, no CUÁL. Si la nota se
// queda en esto, no hay nada que estructurar y tampoco es un fallo de lectura.
const PALABRAS_VACIAS = [
  "alergia", "alergias", "alergico", "alergica", "intolerancia", "intolerante",
  "no", "puede", "come", "comer", "sin", "al", "a", "la", "el", "los", "las",
  "de", "del", "y", "o", "con", "es", "tiene", "ninguna", "nada",
];

// Señales de que la nota HABLA de una restricción alimentaria. Sin ellas, una
// nota como "Cumpleaños" no es un fallo de lectura: simplemente no va de comida,
// y avisar de que no se entendió "cumpleaños" sería ruido que tapa los avisos
// que sí importan.
const SENALES_ALERGIA = [
  "alergi", "alergic", "intoleran", "celiac", "no puede comer", "no come",
  "sin gluten", "sin lactosa", "sin sal", "vegano", "vegana", "vegetarian", "dieta",
];

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // fuera acentos
}

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @returns {{ alergenos, sinReconocer, reconocido, contextoAlergia }}
 *   alergenos       — valores listos para el campo `Alergias` de Airtable
 *   contextoAlergia — la nota habla de una restricción alimentaria
 *   sinReconocer    — palabras a revisar A MANO (solo con contexto de alergia)
 *   reconocido      — se entendió al menos un alérgeno
 */
function extraer(nota) {
  const texto = normalizar(nota);
  const vacio = { alergenos: [], sinReconocer: [], reconocido: false, contextoAlergia: false };
  if (!texto.trim()) return vacio;

  const contextoAlergia = SENALES_ALERGIA.some((s) => texto.includes(normalizar(s)));

  const encontrados = new Set();
  const clavesQueCasaron = [];

  for (const regla of REGLAS) {
    for (const clave of regla.claves) {
      // \b + prefijo: casa desde principio de palabra y tolera plurales/géneros
      if (new RegExp(`\\b${escaparRegex(normalizar(clave))}`).test(texto)) {
        regla.alergenos.forEach((a) => encontrados.add(a));
        clavesQueCasaron.push(normalizar(clave));
        break;
      }
    }
  }

  // Palabras que ninguna regla explicó. Solo se reportan si la nota iba de
  // comida: en "Cumpleaños" no hay nada que revisar, y avisar de ello restaría
  // credibilidad a los avisos reales como el "boco" de los datos de n8n.
  const sinReconocer = contextoAlergia
    ? [
        ...new Set(
          texto
            .split(/[^a-z0-9]+/)
            .filter((p) => p.length > 2)
            .filter((p) => !PALABRAS_VACIAS.includes(p))
            .filter((p) => !SENALES_ALERGIA.some((s) => p.startsWith(normalizar(s).slice(0, 6))))
            .filter((p) => !clavesQueCasaron.some((c) => p.startsWith(c) || c.startsWith(p)))
        ),
      ]
    : [];

  return {
    alergenos: [...encontrados],
    sinReconocer,
    reconocido: encontrados.size > 0,
    contextoAlergia,
  };
}

module.exports = { extraer, REGLAS };
