import React, { useEffect, useState } from 'react';
import {
  Store,
  PhoneCall,
  MessageSquare,
  KeyRound,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  Sparkles,
  Send,
  RefreshCw,
} from 'lucide-react';
import * as api from '../api';
import { RestaurantSettings } from '../api';

interface SettingsViewProps {
  onNotify: (title: string, message: string) => void;
  onRestaurantRenamed: (nombre: string) => void;
}

type Estado = { tipo: 'ok' | 'error'; texto: string } | null;

const Tarjeta: React.FC<{
  icono: React.ReactNode;
  titulo: string;
  subtitulo: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icono, titulo, subtitulo, badge, children }) => (
  <div className="bg-brand-surface border border-brand-outline rounded-2xl overflow-hidden">
    <div className="px-5 py-4 bg-brand-surface-low border-b border-brand-outline flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center text-brand-primary">
          {icono}
        </div>
        <div>
          <h3 className="font-sans font-bold text-sm text-brand-text">{titulo}</h3>
          <p className="text-[10px] text-brand-muted">{subtitulo}</p>
        </div>
      </div>
      {badge}
    </div>
    <div className="p-5 space-y-4">{children}</div>
  </div>
);

const Badge: React.FC<{ activo: boolean; textoActivo: string }> = ({ activo, textoActivo }) => (
  <span
    className={`text-[10px] font-mono font-bold px-2 py-1 rounded-full border whitespace-nowrap ${
      activo
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
        : 'bg-brand-surface-high text-brand-muted border-brand-outline'
    }`}
  >
    {activo ? textoActivo : 'Sin configurar'}
  </span>
);

const Campo: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}> = ({ label, value, onChange, type = 'text', placeholder, hint }) => (
  <div>
    <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">{label}</label>
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-brand-surface-low border border-brand-outline rounded-lg px-3 py-2 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
    />
    {hint && <p className="text-[9px] text-brand-muted/70 mt-1">{hint}</p>}
  </div>
);

const Aviso: React.FC<{ estado: Estado }> = ({ estado }) =>
  estado ? (
    <div
      className={`flex items-start gap-2 rounded-lg p-2.5 text-[11px] border ${
        estado.tipo === 'ok'
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
          : 'bg-red-500/10 border-red-500/25 text-red-300'
      }`}
    >
      {estado.tipo === 'ok' ? (
        <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      )}
      <span className="leading-relaxed">{estado.texto}</span>
    </div>
  ) : null;

export const SettingsView: React.FC<SettingsViewProps> = ({ onNotify, onRestaurantRenamed }) => {
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [cargando, setCargando] = useState(true);

  // Restaurante
  const [nombre, setNombre] = useState('');
  const [reviewUrl, setReviewUrl] = useState('');
  const [staffWhatsApp, setStaffWhatsApp] = useState('');
  const [estadoLocal, setEstadoLocal] = useState<Estado>(null);
  const [guardandoLocal, setGuardandoLocal] = useState(false);

  // Vapi
  const [vapiKey, setVapiKey] = useState('');
  const [estadoVoz, setEstadoVoz] = useState<Estado>(null);
  const [ocupadoVoz, setOcupadoVoz] = useState<string | null>(null);

  // Twilio
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [from, setFrom] = useState('');
  const [destinoPrueba, setDestinoPrueba] = useState('');
  const [estadoWa, setEstadoWa] = useState<Estado>(null);
  const [ocupadoWa, setOcupadoWa] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Cuenta
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [estadoPass, setEstadoPass] = useState<Estado>(null);

  const aplicar = (s: RestaurantSettings) => {
    setSettings(s);
    setNombre(s.nombre);
    setReviewUrl(s.googleReviewUrl || '');
    setStaffWhatsApp(s.staffWhatsApp || '');
    setAccountSid(s.whatsapp.accountSid || '');
    setFrom(s.whatsapp.from || '');
  };

  useEffect(() => {
    api
      .fetchSettings()
      .then(aplicar)
      .catch((e) => setEstadoLocal({ tipo: 'error', texto: e.message }))
      .finally(() => setCargando(false));
  }, []);

  const guardarLocal = async () => {
    setGuardandoLocal(true);
    setEstadoLocal(null);
    try {
      const s = await api.saveSettings({ nombre, googleReviewUrl: reviewUrl, staffWhatsApp });
      aplicar(s);
      onRestaurantRenamed(s.nombre);
      setEstadoLocal({ tipo: 'ok', texto: 'Datos guardados. El agente usará el nombre nuevo en menos de un minuto.' });
      onNotify('Configuración guardada', `Datos del restaurante actualizados (${s.nombre}).`);
    } catch (e: any) {
      setEstadoLocal({ tipo: 'error', texto: e.message });
    } finally {
      setGuardandoLocal(false);
    }
  };

  const guardarVapiKey = async () => {
    setOcupadoVoz('key');
    setEstadoVoz(null);
    try {
      const s = await api.saveVapiKey(vapiKey.trim() || null);
      aplicar(s);
      setVapiKey('');
      setEstadoVoz({
        tipo: 'ok',
        texto: s.voz.apiKeyPropia
          ? 'API key guardada y cifrada.'
          : 'Se usará la configuración central de voz.',
      });
    } catch (e: any) {
      setEstadoVoz({ tipo: 'error', texto: e.message });
    } finally {
      setOcupadoVoz(null);
    }
  };

  const crearAgente = async () => {
    setOcupadoVoz('provision');
    setEstadoVoz(null);
    try {
      const s = await api.provisionVapi();
      aplicar(s);
      setEstadoVoz({
        tipo: 'ok',
        texto: s.aviso || `Agente de voz creado${s.voz.telefono ? ` y número asignado: ${s.voz.telefono}` : ''}.`,
      });
      onNotify('Agente de voz creado', `${s.nombre} ya tiene recepcionista telefónica.`);
    } catch (e: any) {
      setEstadoVoz({ tipo: 'error', texto: e.message });
    } finally {
      setOcupadoVoz(null);
    }
  };

  const sincronizarPrompt = async () => {
    setOcupadoVoz('sync');
    setEstadoVoz(null);
    try {
      await api.syncVapiPrompt();
      setEstadoVoz({ tipo: 'ok', texto: 'Instrucciones del agente actualizadas en Vapi.' });
    } catch (e: any) {
      setEstadoVoz({ tipo: 'error', texto: e.message });
    } finally {
      setOcupadoVoz(null);
    }
  };

  const probarVoz = async () => {
    setOcupadoVoz('test');
    setEstadoVoz(null);
    try {
      const r = await api.testVapi();
      setEstadoVoz({ tipo: 'ok', texto: `Conexión correcta: "${r.nombre}" (modelo ${r.modelo}).` });
    } catch (e: any) {
      setEstadoVoz({ tipo: 'error', texto: e.message });
    } finally {
      setOcupadoVoz(null);
    }
  };

  const guardarWhatsApp = async () => {
    setOcupadoWa('save');
    setEstadoWa(null);
    try {
      const s = await api.saveWhatsApp({
        accountSid: accountSid.trim(),
        authToken: authToken.trim() || undefined,
        from: from.trim(),
      });
      aplicar(s);
      setAuthToken('');
      setEstadoWa({ tipo: 'ok', texto: 'Credenciales validadas con Twilio y guardadas (cifradas).' });
      onNotify('WhatsApp conectado', 'La integración de WhatsApp quedó configurada.');
    } catch (e: any) {
      setEstadoWa({ tipo: 'error', texto: e.message });
    } finally {
      setOcupadoWa(null);
    }
  };

  const desconectarWhatsApp = async () => {
    if (!confirm('¿Desconectar la cuenta de Twilio de este restaurante?')) return;
    setOcupadoWa('save');
    try {
      const s = await api.saveWhatsApp({});
      aplicar(s);
      setAuthToken('');
      setEstadoWa({ tipo: 'ok', texto: 'WhatsApp desconectado.' });
    } catch (e: any) {
      setEstadoWa({ tipo: 'error', texto: e.message });
    } finally {
      setOcupadoWa(null);
    }
  };

  const probarWhatsApp = async () => {
    if (!destinoPrueba.trim()) {
      setEstadoWa({ tipo: 'error', texto: 'Escribe un número de destino para la prueba.' });
      return;
    }
    setOcupadoWa('test');
    setEstadoWa(null);
    try {
      const r = await api.testWhatsApp(destinoPrueba.trim());
      setEstadoWa({ tipo: 'ok', texto: `Mensaje enviado (estado: ${r.estado}).` });
    } catch (e: any) {
      setEstadoWa({ tipo: 'error', texto: e.message });
    } finally {
      setOcupadoWa(null);
    }
  };

  const cambiarPassword = async () => {
    setEstadoPass(null);
    if (passNueva.length < 8) {
      setEstadoPass({ tipo: 'error', texto: 'La contraseña nueva debe tener al menos 8 caracteres.' });
      return;
    }
    try {
      await api.changePassword(passActual, passNueva);
      setPassActual('');
      setPassNueva('');
      setEstadoPass({ tipo: 'ok', texto: 'Contraseña actualizada.' });
    } catch (e: any) {
      setEstadoPass({ tipo: 'error', texto: 'No se pudo cambiar (¿contraseña actual incorrecta?).' });
    }
  };

  const copiarWebhook = () => {
    if (!settings) return;
    navigator.clipboard.writeText(settings.whatsapp.webhookUrl);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  if (cargando) {
    return (
      <div className="bg-brand-surface border border-brand-outline rounded-2xl p-10 flex items-center justify-center gap-2 text-brand-muted text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando configuración…
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="bg-brand-surface border border-brand-outline rounded-2xl p-6">
        <Aviso estado={estadoLocal} />
      </div>
    );
  }

  const btn =
    'flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-sans font-bold cursor-pointer transition-all disabled:opacity-50';

  return (
    <div className="space-y-5 overflow-y-auto">
      {/* --- Restaurante --- */}
      <Tarjeta
        icono={<Store className="w-4 h-4" />}
        titulo="Restaurante"
        subtitulo="Datos del local que usa el agente al atender"
        badge={
          <span className="text-[10px] font-mono text-brand-muted bg-brand-surface-high border border-brand-outline px-2 py-1 rounded-full">
            {settings.slug}
          </span>
        }
      >
        <Campo label="Nombre del restaurante" value={nombre} onChange={setNombre} hint="María lo dirá al contestar el teléfono." />
        <Campo label="URL de reseñas de Google" value={reviewUrl} onChange={setReviewUrl} placeholder="https://g.page/..." hint="Se envía a los clientes tras su visita." />
        <Campo label="WhatsApp del encargado" value={staffWhatsApp} onChange={setStaffWhatsApp} placeholder="+34600000000" hint="Recibe los avisos cuando el agente transfiere a un humano." />
        <Aviso estado={estadoLocal} />
        <button onClick={guardarLocal} disabled={guardandoLocal} className={`${btn} bg-brand-primary text-brand-surface hover:bg-brand-primary/90`}>
          {guardandoLocal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar cambios
        </button>
      </Tarjeta>

      {/* --- Voz (Vapi) --- */}
      <Tarjeta
        icono={<PhoneCall className="w-4 h-4" />}
        titulo="Agente de Voz (Vapi)"
        subtitulo="Recepcionista telefónica 24/7 de este local"
        badge={<Badge activo={settings.voz.configured} textoActivo={settings.voz.telefono ? `Activo · ${settings.voz.telefono}` : 'Activo'} />}
      >
        {settings.voz.telefono && (
          <div className="bg-brand-surface-low border border-brand-outline rounded-xl p-3 text-center">
            <span className="text-[10px] uppercase font-mono text-brand-muted block">Teléfono del restaurante</span>
            <strong className="text-brand-primary font-mono text-lg">{settings.voz.telefono}</strong>
          </div>
        )}

        <Campo
          label={settings.voz.apiKeyPropia ? `API key propia (guardada: ${settings.voz.apiKeyMasked})` : 'API key de Vapi (opcional)'}
          value={vapiKey}
          onChange={setVapiKey}
          type="password"
          placeholder={settings.voz.apiKeyPropia ? 'Escribe una nueva para reemplazarla' : 'Déjalo vacío para usar la cuenta central'}
          hint="Si este local tiene su propia cuenta de Vapi, pégala aquí. Se guarda cifrada."
        />

        <div className="flex flex-wrap gap-2">
          <button onClick={guardarVapiKey} disabled={ocupadoVoz !== null} className={`${btn} bg-brand-surface-high border border-brand-outline text-brand-text hover:border-brand-primary/40`}>
            {ocupadoVoz === 'key' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4 text-brand-primary" />} Guardar key
          </button>

          {!settings.voz.configured ? (
            <button onClick={crearAgente} disabled={ocupadoVoz !== null} className={`${btn} bg-brand-primary text-brand-surface hover:bg-brand-primary/90`}>
              {ocupadoVoz === 'provision' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Crear agente de voz
            </button>
          ) : (
            <>
              <button onClick={sincronizarPrompt} disabled={ocupadoVoz !== null} className={`${btn} bg-brand-surface-high border border-brand-outline text-brand-text hover:border-brand-primary/40`}>
                {ocupadoVoz === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 text-brand-primary" />} Sincronizar instrucciones
              </button>
              <button onClick={probarVoz} disabled={ocupadoVoz !== null} className={`${btn} bg-brand-surface-high border border-brand-outline text-brand-text hover:border-brand-primary/40`}>
                {ocupadoVoz === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 text-brand-primary" />} Probar conexión
              </button>
            </>
          )}
        </div>
        <Aviso estado={estadoVoz} />
      </Tarjeta>

      {/* --- WhatsApp (Twilio) --- */}
      <Tarjeta
        icono={<MessageSquare className="w-4 h-4" />}
        titulo="WhatsApp (Twilio)"
        subtitulo="Reservas y recordatorios por WhatsApp"
        badge={<Badge activo={settings.whatsapp.configured} textoActivo="Conectado" />}
      >
        <Campo label="Account SID" value={accountSid} onChange={setAccountSid} placeholder="AC..." />
        <Campo
          label={settings.whatsapp.authTokenMasked ? 'Auth Token (guardado)' : 'Auth Token'}
          value={authToken}
          onChange={setAuthToken}
          type="password"
          placeholder={settings.whatsapp.authTokenMasked ? 'Déjalo vacío para conservar el actual' : 'Tu auth token de Twilio'}
          hint="Se valida con Twilio antes de guardarse, y se almacena cifrado."
        />
        <Campo label="Número emisor de WhatsApp" value={from} onChange={setFrom} placeholder="+14155238886" />

        <div className="bg-brand-surface-low border border-brand-outline rounded-xl p-3 space-y-1.5">
          <span className="text-[10px] uppercase font-mono text-brand-muted block">
            Webhook para Twilio (Messaging → When a message comes in)
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[10px] font-mono text-brand-text bg-brand-surface border border-brand-outline rounded px-2 py-1.5 truncate">
              {settings.whatsapp.webhookUrl}
            </code>
            <button onClick={copiarWebhook} className="p-1.5 rounded-lg border border-brand-outline hover:border-brand-primary/40 text-brand-text cursor-pointer" title="Copiar">
              {copiado ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[9px] text-brand-muted/70">
            Es la misma para todos los locales: el sistema reconoce el restaurante por el número que recibe el mensaje.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={guardarWhatsApp} disabled={ocupadoWa !== null} className={`${btn} bg-brand-primary text-brand-surface hover:bg-brand-primary/90`}>
            {ocupadoWa === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar y validar
          </button>
          {settings.whatsapp.configured && (
            <button onClick={desconectarWhatsApp} disabled={ocupadoWa !== null} className={`${btn} border border-red-500/25 text-red-400 hover:bg-red-500/10`}>
              Desconectar
            </button>
          )}
        </div>

        <div className="pt-3 border-t border-brand-outline/60 space-y-2">
          <Campo label="Enviar mensaje de prueba a" value={destinoPrueba} onChange={setDestinoPrueba} placeholder="+34600000000" />
          <button onClick={probarWhatsApp} disabled={ocupadoWa !== null} className={`${btn} bg-brand-surface-high border border-brand-outline text-brand-text hover:border-brand-primary/40`}>
            {ocupadoWa === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-brand-primary" />} Enviar prueba
          </button>
        </div>
        <Aviso estado={estadoWa} />
      </Tarjeta>

      {/* --- Cuenta --- */}
      <Tarjeta icono={<KeyRound className="w-4 h-4" />} titulo="Cuenta" subtitulo="Tu acceso al panel">
        <Campo label="Contraseña actual" value={passActual} onChange={setPassActual} type="password" />
        <Campo label="Contraseña nueva" value={passNueva} onChange={setPassNueva} type="password" hint="Mínimo 8 caracteres." />
        <Aviso estado={estadoPass} />
        <button onClick={cambiarPassword} className={`${btn} bg-brand-primary text-brand-surface hover:bg-brand-primary/90`}>
          <Check className="w-4 h-4" /> Cambiar contraseña
        </button>
      </Tarjeta>
    </div>
  );
};
