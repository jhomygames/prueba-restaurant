/**
 * Despacha una llamada a herramienta (por nombre) a su implementación real.
 * Punto único usado tanto por el webhook de Vapi (voz) como por el loop de
 * tool-use de WhatsApp, para que el comportamiento sea idéntico en ambos canales.
 */

const reservations = require("./reservations");
const customerMemory = require("./customerMemory");
const { notifyStaff } = require("./transferToHuman");
const menuService = require("./menuService");
const history = require("./history");

// Normaliza para comparar sin acentos ni mayúsculas ("Croquetas" ~ "croquetas", "César" ~ "cesar").
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

async function getMenuInfo(ctx, { category, exclude_allergen, dish_name }) {
  // La carta viene de Airtable (editable desde el panel), solo platos disponibles.
  const menu = await menuService.getMenu(ctx);
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

/**
 * `context.restaurant` es OBLIGATORIO: identifica el tenant (su base de datos y
 * su configuración). Cada canal lo resuelve a su manera antes de llamar aquí
 * (JWT en el panel, assistantId en Vapi, número destino en WhatsApp).
 *
 * `context.channel` indica desde qué canal se llama (`voz` | `whatsapp`), y se
 * guarda en la reserva para poder distinguirla luego de las que llegan de
 * plataformas externas.
 */
async function dispatchTool(name, args, context = {}) {
  const restaurant = context.restaurant;
  if (!restaurant || !restaurant.baseId) {
    console.error(`[toolDispatcher] ${name} sin restaurante en contexto`);
    return { error: "restaurante_no_identificado" };
  }
  const ctx = { baseId: restaurant.baseId };

  switch (name) {
    case "check_availability":
      return reservations.checkAvailability(ctx, args);

    case "create_reservation": {
      const result = await reservations.createReservation(ctx, {
        ...args,
        lopd: args.lopd_accepted,
        source: context.channel || "voz",
      });
      if (result.created) {
        await history.registrar(ctx, {
          accion: "created",
          canal: context.channel || "voz",
          reservaId: result.id,
          codigo: result.code,
          despues: {
            FechaHora: `${args.date} ${args.time}`,
            Personas: args.party_size,
            ClienteNombre: args.customer_name,
          },
        });
        // Guarda/actualiza el cliente en Airtable para que quede en la memoria de
        // clientes habituales, sin importar el canal (voz o WhatsApp).
        await customerMemory
          .upsertCustomer(ctx, args.customer_phone, {
            name: args.customer_name,
            lopd: args.lopd_accepted,
          })
          .catch((err) => console.error("[toolDispatcher] error guardando cliente:", err));
      }
      return result;
    }

    case "cancel_reservation": {
      const result = await reservations.cancelReservation(ctx, args);
      if (result.cancelled) {
        await history.registrar(ctx, {
          accion: "cancelled",
          canal: context.channel || "voz",
          reservaId: result.reservation?.id,
          codigo: result.reservation?.code,
          antes: { Estado: "confirmada" },
          despues: { Estado: "cancelada" },
        });
      }
      return result;
    }

    case "get_menu_info":
      return getMenuInfo(ctx, args);

    case "transfer_to_human":
      return notifyStaff({
        reason: args.reason,
        customer_phone: args.customer_phone || context.customer_phone,
        channel: args.channel,
        restaurant,
      });

    case "get_customer_memory": {
      const phone = args.customer_phone || context.customer_phone;
      const customer = await customerMemory.getCustomer(ctx, phone);
      return { customer: customer || null };
    }

    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = { dispatchTool };
