/**
 * Esquema de herramientas (functions) compartido entre el agente de voz (Vapi)
 * y el agente de WhatsApp (Claude tool-use). Un solo lugar para definir qué
 * puede hacer el agente; toolDispatcher.js las ejecuta por nombre.
 *
 * Formato: cada tool tiene { name, description, parameters } compatible tanto
 * con el JSON Schema de Anthropic tool-use como con el formato de Vapi
 * (que usa la misma estructura "function calling" estilo OpenAI).
 */

const tools = [
  {
    name: "check_availability",
    description:
      "Consulta disponibilidad de mesas para una fecha, hora y número de comensales dados.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
        time: { type: "string", description: "Hora en formato HH:mm (24h)" },
        party_size: { type: "integer", description: "Número de comensales" },
      },
      required: ["date", "time", "party_size"],
    },
  },
  {
    name: "create_reservation",
    description: "Crea una reserva confirmada en el sistema de reservas del restaurante.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
        time: { type: "string", description: "Hora en formato HH:mm (24h)" },
        party_size: { type: "integer", description: "Número de comensales" },
        customer_name: { type: "string", description: "Nombre del cliente" },
        customer_phone: {
          type: "string",
          description: "Teléfono del cliente en formato internacional, ej. +58...",
        },
        notes: { type: "string", description: "Notas adicionales (alergias, ocasión especial, etc.)" },
      },
      required: ["date", "time", "party_size", "customer_name", "customer_phone"],
    },
  },
  {
    name: "cancel_reservation",
    description: "Cancela una reserva existente identificada por su ID o por teléfono + fecha.",
    parameters: {
      type: "object",
      properties: {
        reservation_id: { type: "string", description: "ID de la reserva, si se conoce" },
        customer_phone: { type: "string", description: "Teléfono del cliente" },
        date: { type: "string", description: "Fecha de la reserva en formato YYYY-MM-DD" },
      },
      required: [],
    },
  },
  {
    name: "get_menu_info",
    description:
      "Devuelve información de la carta: platos por categoría, precios y los 14 alérgenos obligatorios de cada plato. Puede filtrar por categoría o por alérgeno a evitar.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "Categoría del menú, ej. 'Entrantes'" },
        exclude_allergen: {
          type: "string",
          description: "Alérgeno a excluir de los resultados, ej. 'gluten'",
        },
      },
      required: [],
    },
  },
  {
    name: "transfer_to_human",
    description:
      "Transfiere la conversación a un miembro del staff humano. Usar cuando el cliente lo pida explícitamente, cuando haya una queja, o cuando la solicitud no pueda resolverse con las demás herramientas.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Motivo breve de la transferencia" },
        customer_phone: { type: "string", description: "Teléfono de contacto del cliente" },
        channel: {
          type: "string",
          enum: ["voice", "whatsapp"],
          description: "Canal desde el que se solicita la transferencia",
        },
      },
      required: ["reason", "channel"],
    },
  },
  {
    name: "get_customer_memory",
    description:
      "Recupera datos de un cliente habitual (preferencias, alergias conocidas, última visita) por su teléfono, si existe en la base de datos.",
    parameters: {
      type: "object",
      properties: {
        customer_phone: { type: "string", description: "Teléfono del cliente en formato internacional" },
      },
      required: ["customer_phone"],
    },
  },
];

module.exports = { tools };
