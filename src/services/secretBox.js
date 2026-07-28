/**
 * Cifrado de secretos por restaurante (credenciales de Twilio/Vapi que el staff
 * pega en la pestaña Configuración).
 *
 * Airtable NO es un gestor de secretos: cualquiera con acceso de lectura a la
 * base del Registro vería los tokens en claro. Por eso se guardan cifrados con
 * AES-256-GCM usando TENANT_SECRETS_KEY (32 bytes en hex, solo en el entorno).
 *
 * Formato almacenado: "v1.<iv_b64>.<tag_b64>.<ciphertext_b64>"
 */

const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const PREFIX = "v1";

function getKey() {
  const raw = process.env.TENANT_SECRETS_KEY;
  if (!raw) {
    throw new Error(
      "TENANT_SECRETS_KEY no está configurada: no se pueden cifrar/descifrar credenciales de restaurante."
    );
  }
  // Acepta hex de 64 chars (32 bytes); si no, deriva por SHA-256 para tolerar
  // claves con otro formato sin romper el arranque.
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === "") return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

function decrypt(stored) {
  if (!stored) return "";
  const parts = String(stored).split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    console.error("[secretBox] formato de secreto no reconocido, se ignora");
    return "";
  }
  try {
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    // Suele significar que TENANT_SECRETS_KEY cambió: el secreto es irrecuperable
    // y el staff tendrá que volver a pegarlo. Nunca loguear el contenido.
    console.error("[secretBox] no se pudo descifrar un secreto:", err.message);
    return "";
  }
}

/**
 * Compara dos secretos sin filtrar información por el tiempo que tarda.
 * Una comparación normal (`===`) se detiene en el primer carácter distinto, lo
 * que permitiría a un atacante deducir el secreto midiendo respuestas.
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false; // timingSafeEqual lo exige
  return crypto.timingSafeEqual(bufA, bufB);
}

/** "SK1234...cdef" -> "SK12…cdef" para mostrar en el panel sin exponer el valor. */
function mask(value) {
  if (!value) return "";
  const s = String(value);
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

module.exports = { encrypt, decrypt, mask, safeCompare };
