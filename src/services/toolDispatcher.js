/**
 * Despacha una llamada a herramienta (por nombre) a su implementación real.
 * Punto único usado tanto por el webhook de Vapi (voz) como por el loop de
 * tool-use de WhatsApp, para que el comportamiento sea idéntico en ambos canales.
 */

const reservations = require("./reservations");
const customerMemory = require("./customerMemory");
const { notifyStaff } = require("./transferToHuman");
const menu = require("../config/menu.json");

function getMenuInfo({ category, exclude_allergen }) {
  let categorias = menu.categorias;
  if (category) {
    categorias = categorias.filter(
      (c) => c.nombre.toLowerCase() === category.toLowerCase()
    );
  }
  if (exclude_allergen) {
    categorias = categorias.map((c) => ({
      ...c,
      platos: c.platos.filter((p) => !p.alergenos.includes(exclude_allergen)),
    }));
  }
  return { categorias };
}

async function dispatchTool(name, args, context = {}) {
  switch (name) {
    case "check_availability":
      return reservations.checkAvailability(args);

    case "create_reservation":
      return reservations.createReservation(args);

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
