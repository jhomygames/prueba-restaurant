/**
 * Despacha una llamada a herramienta (por nombre) a su implementación real.
 * Punto único usado tanto por el webhook de Vapi (voz) como por el loop de
 * tool-use de WhatsApp, para que el comportamiento sea idéntico en ambos canales.
 */

const reservations = require("./reservations");
const customerMemory = require("./customerMemory");
const { notifyStaff } = require("./transferToHuman");
const menuService = require("./menuService");

// Normaliza para comparar sin acentos ni mayúsculas ("Croquetas" ~ "croquetas", "César" ~ "cesar").
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

async function getMenuInfo({ category, exclude_allergen, dish_name }) {
  // La carta viene de Airtable (editable desde el panel), solo platos disponibles.
  const menu = await menuService.getMenu();
  let categorias = menu.categorias;

  if (category) {
    const target = normalize(category);
    categorias = categorias.filter((c) => normalize(c.nombre).includes(target));
  }

  if (dish_name) {
    const target = normalize(dish_name);
    categorias = categorias
      .map((c) => ({
        ...c,
        platos: c.platos.filter((p) => normalize(p.nombre).includes(target)),
      }))
      .filter((c) => c.platos.length > 0);
  }

  if (exclude_allergen) {
    const target = normalize(exclude_allergen);
    const alergeno = menu.alergenos_catalogo.find((a) => normalize(a).includes(target));
    categorias = categorias
      .map((c) => ({
        ...c,
        platos: c.platos.filter((p) => !p.alergenos.includes(alergeno)),
      }))
      .filter((c) => c.platos.length > 0);
  }

  return {
    categorias,
    alergenos_catalogo: menu.alergenos_catalogo,
    nota_alergenos:
      "Alérgenos de ejemplo pendientes de validación por el restaurante. Ante alergias graves, recomendar siempre confirmarlo con el personal en sala.",
  };
}

async function dispatchTool(name, args, context = {}) {
  switch (name) {
    case "check_availability":
      return reservations.checkAvailability(args);

    case "create_reservation": {
      const result = await reservations.createReservation(args);
      if (result.created) {
        // Guarda/actualiza el cliente en Airtable para que quede en la memoria de
        // clientes habituales, sin importar el canal (voz o WhatsApp).
        await customerMemory
          .upsertCustomer(args.customer_phone, { name: args.customer_name })
          .catch((err) => console.error("[toolDispatcher] error guardando cliente:", err));
      }
      return result;
    }

    case "cancel_reservation":
      return reservations.cancelReservation(args);

    case "get_menu_info":
      return getMenuInfo(args);

    case "transfer_to_human":
      return notifyStaff({
        reason: args.reason,
        customer_phone: args.customer_phone || context.customer_phone,
        channel: args.channel,
      });

    case "get_customer_memory": {
      const phone = args.customer_phone || context.customer_phone;
      const customer = await customerMemory.getCustomer(phone);
      return { customer: customer || null };
    }

    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = { dispatchTool };
