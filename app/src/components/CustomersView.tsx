import { Customer } from '../api';
import { Users, Phone, AlertTriangle, CalendarClock, Repeat } from 'lucide-react';

interface CustomersViewProps {
  customers: Customer[];
}

export function CustomersView({ customers }: CustomersViewProps) {
  return (
    <div className="bg-brand-surface border border-brand-outline rounded-2xl p-5 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-brand-outline pb-3 mb-4">
        <h2 className="font-sans font-bold text-sm text-brand-text uppercase tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4 text-brand-primary" />
          Clientes Registrados
        </h2>
        <span className="text-[10px] font-mono text-brand-muted bg-brand-surface-high border border-brand-outline px-2 py-0.5 rounded-full">
          {customers.length} en Airtable
        </span>
      </div>

      {customers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-brand-muted gap-2 py-10">
          <Users className="w-8 h-8 opacity-40" />
          <p className="text-xs">
            Aún no hay clientes registrados. Se crean automáticamente al reservar
            por teléfono, WhatsApp o desde este panel.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase font-mono text-brand-muted border-b border-brand-outline">
                <th className="py-2 pr-3">Nombre</th>
                <th className="py-2 pr-3">Teléfono</th>
                <th className="py-2 pr-3">Alergias conocidas</th>
                <th className="py-2 pr-3">Preferencias</th>
                <th className="py-2 pr-3">Última visita</th>
                <th className="py-2">Visitas</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-brand-outline/40 hover:bg-brand-surface-high transition-colors">
                  <td className="py-2.5 pr-3 font-bold text-brand-text">{c.name || '—'}</td>
                  <td className="py-2.5 pr-3 font-mono text-brand-muted">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3 h-3 text-brand-primary/70" />
                      {c.phone}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    {c.knownAllergies.length ? (
                      <span className="inline-flex flex-wrap gap-1">
                        {c.knownAllergies.map((a) => (
                          <span
                            key={a}
                            className="inline-flex items-center gap-0.5 bg-brand-secondary/10 border border-brand-secondary/30 text-brand-secondary px-1.5 py-0.5 rounded text-[10px] font-bold"
                          >
                            <AlertTriangle className="w-2.5 h-2.5" />
                            {a}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-brand-muted/60">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-brand-muted max-w-[220px] truncate" title={c.preferences}>
                    {c.preferences || '—'}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-brand-muted">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="w-3 h-3 text-brand-tertiary/70" />
                      {c.lastVisit ? c.lastVisit.split('T')[0] : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 font-mono font-bold text-brand-text">
                    <span className="inline-flex items-center gap-1">
                      <Repeat className="w-3 h-3 text-brand-primary/70" />
                      {c.visits}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
