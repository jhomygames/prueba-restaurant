import React, { useState, useMemo } from 'react';
import {
  Upload,
  BookOpen,
  FileText,
  Search,
  Filter,
  Trash2,
  Download,
  Sparkles,
  Utensils,
  ChevronRight,
  Pencil,
  Plus,
  X,
  EyeOff,
  Check
} from 'lucide-react';
import { Dish } from '../api';
import { ALLERGIES_OPTIONS } from '../data';



interface MenuViewProps {
  menu: Dish[];
  onCreateDish: (dish: Omit<Dish, 'id'>) => void;
  onUpdateDish: (id: string, patch: Partial<Dish>) => void;
  onDeleteDish: (id: string) => void;
  pdfFile: string | null;
  pdfFileName: string | null;
  onPdfUpload: (base64: string, name: string) => void;
  onPdfRemove: () => void;
}

// Formulario vacío para "Añadir plato"
const emptyDraft = (order: number): Omit<Dish, 'id'> => ({
  name: '',
  category: '',
  description: '',
  price: null,
  allergens: [],
  recommended: false,
  available: true,
  order,
});

export const MenuView: React.FC<MenuViewProps> = ({
  menu,
  onCreateDish,
  onUpdateDish,
  onDeleteDish,
  pdfFile,
  pdfFileName,
  onPdfUpload,
  onPdfRemove
}) => {
  const [activeViewMode, setActiveViewMode] = useState<'interactive' | 'pdf'>(pdfFile ? 'pdf' : 'interactive');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedAllergenFilter, setSelectedAllergenFilter] = useState<string>('all');
  const [dragOver, setDragOver] = useState(false);

  // Modo edición de la carta (independiente del modo edición del plano)
  const [editMode, setEditMode] = useState(false);
  // Draft en edición: null (cerrado), objeto con id (editar) o sin id (crear)
  const [draft, setDraft] = useState<(Partial<Dish> & { id?: string }) | null>(null);

  // Categorías presentes en la carta real, en el orden en que aparecen.
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const d of menu) {
      if (d.category && !seen.includes(d.category)) seen.push(d.category);
    }
    return [{ id: 'all', name: 'Todas' }, ...seen.map(c => ({ id: c, name: c }))];
  }, [menu]);

  // Filtros de alérgenos: "evitar X" para los alérgenos presentes en la carta.
  const allergenFilters = useMemo(() => {
    const present = new Set<string>();
    menu.forEach(d => d.allergens.forEach(a => present.add(a)));
    const ordered = ALLERGIES_OPTIONS.filter(a => present.has(a));
    return [{ id: 'all', name: 'Sin restricción' }, ...ordered.map(a => ({ id: a, name: `Sin ${a}` }))];
  }, [menu]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (file.type !== 'application/pdf') {
      alert('Por favor, selecciona un archivo PDF válido.');
      return;
    }

    if (file.size > 4.5 * 1024 * 1024) {
      alert('El archivo es demasiado grande (máximo 4.5MB para guardado local en el navegador). Sube un PDF más optimizado.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result && typeof event.target.result === 'string') {
        onPdfUpload(event.target.result, file.name);
        setActiveViewMode('pdf');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // En modo edición se ven todos los platos; en modo consulta, solo los
  // disponibles (lo mismo que ve el cliente y el agente de voz/WhatsApp).
  const baseItems = editMode ? menu : menu.filter(d => d.available);

  const filteredItems = baseItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;

    let matchesAllergen = true;
    if (selectedAllergenFilter !== 'all') {
      if (selectedAllergenFilter === 'Vegetariano' || selectedAllergenFilter === 'Vegano') {
        matchesAllergen = item.allergens.includes(selectedAllergenFilter);
      } else {
        // "Sin Gluten" etc: evitar los platos que contienen ese alérgeno
        matchesAllergen = !item.allergens.includes(selectedAllergenFilter);
      }
    }

    return matchesSearch && matchesCategory && matchesAllergen;
  });

  // Guardar el draft (crear o actualizar)
  const saveDraft = () => {
    if (!draft || !draft.name?.trim() || !draft.category?.trim()) {
      alert('El plato necesita al menos un nombre y una categoría.');
      return;
    }
    const payload: Omit<Dish, 'id'> = {
      name: draft.name.trim(),
      category: draft.category.trim(),
      description: draft.description?.trim() || '',
      price: draft.price === undefined || (draft.price as any) === '' ? null : draft.price ?? null,
      allergens: draft.allergens || [],
      recommended: !!draft.recommended,
      available: draft.available !== false,
      order: draft.order ?? menu.length,
    };
    if (draft.id) {
      onUpdateDish(draft.id, payload);
    } else {
      onCreateDish(payload);
    }
    setDraft(null);
  };

  const toggleDraftAllergen = (a: string) => {
    setDraft(d => {
      if (!d) return d;
      const cur = d.allergens || [];
      return { ...d, allergens: cur.includes(a) ? cur.filter(x => x !== a) : [...cur, a] };
    });
  };

  return (
    <div className="bg-brand-surface border border-brand-outline rounded-3xl overflow-hidden flex flex-col h-full shadow-xl">
      {/* Tab/Mode Header */}
      <div className="px-6 py-4 border-b border-brand-outline bg-brand-surface-low/60 backdrop-blur flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-brand-primary" />
          </div>
          <div>
            <h2 className="font-sans font-bold text-sm text-brand-text">Carta Digital del Restaurante</h2>
            <p className="text-[10px] text-brand-muted">Visualiza el menú interactivo o la carta oficial en PDF.</p>
          </div>
        </div>

        {/* View mode toggle + Upload PDF shortcut */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Botón editar carta: solo tiene sentido en la vista interactiva */}
          {activeViewMode === 'interactive' && (
            <button
              onClick={() => { setEditMode(e => !e); setDraft(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold font-sans cursor-pointer transition-all border ${
                editMode
                  ? 'bg-brand-primary text-brand-surface border-brand-primary shadow'
                  : 'bg-brand-surface border-brand-outline text-brand-text hover:border-brand-primary/40'
              }`}
              title="Editar la carta (añadir, modificar o eliminar platos)"
            >
              {editMode ? <><Check className="w-3.5 h-3.5" /> Editando</> : <><Pencil className="w-3.5 h-3.5" /> Editar carta</>}
            </button>
          )}
          <div className="flex bg-brand-surface border border-brand-outline rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setActiveViewMode('interactive')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                activeViewMode === 'interactive'
                  ? 'bg-brand-surface-high border border-brand-outline text-brand-text font-bold shadow-sm'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              <Utensils className="w-3.5 h-3.5" />
              Menú Interactivo
            </button>
            <button
              onClick={() => {
                if (!pdfFile) {
                  alert('No hay un archivo PDF cargado. Por favor, sube uno en el panel de opciones de la derecha o arrástralo en el visor de PDF.');
                  return;
                }
                setActiveViewMode('pdf');
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium cursor-pointer transition-colors relative ${
                activeViewMode === 'pdf'
                  ? 'bg-brand-surface-high border border-brand-outline text-brand-text font-bold shadow-sm'
                  : 'text-brand-muted hover:text-brand-text'
              } ${!pdfFile ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <FileText className="w-3.5 h-3.5" />
              Carta PDF
              {pdfFile && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 absolute top-1 right-1" />
              )}
            </button>
          </div>

          {pdfFile && (
            <button
              onClick={onPdfRemove}
              className="p-1.5 rounded-lg border border-red-500/20 hover:border-red-500/40 bg-red-500/5 hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-all cursor-pointer"
              title="Eliminar PDF de la carta"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeViewMode === 'interactive' ? (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-[500px]">
            {/* Filter sidebar */}
            <div className="w-full lg:w-60 border-r border-brand-outline bg-brand-surface-low/30 p-4 space-y-4 overflow-y-auto shrink-0">
              {/* Search input */}
              <div className="relative">
                <Search className="w-4 h-4 text-brand-muted absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar platos..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-brand-surface border border-brand-outline hover:border-brand-primary/40 rounded-xl pl-9 pr-4 py-2 text-xs font-sans text-brand-text placeholder-brand-muted focus:outline-none focus:ring-1 focus:ring-brand-primary/50 transition-all"
                />
              </div>

              {/* Categories list */}
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase text-brand-muted font-bold block mb-2 px-1">Categorías</span>
                {categories.map((cat) => {
                  const isSel = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-sans cursor-pointer transition-all ${
                        isSel 
                          ? 'bg-brand-primary/10 border border-brand-primary/25 text-brand-primary font-bold' 
                          : 'border border-transparent hover:bg-brand-surface-high/60 text-brand-text'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Utensils className="w-3.5 h-3.5 opacity-70" />
                        <span className="truncate">{cat.name}</span>
                      </div>
                      <ChevronRight className={`w-3.5 h-3.5 text-brand-muted transition-transform shrink-0 ${isSel ? 'rotate-90 text-brand-primary' : ''}`} />
                    </button>
                  );
                })}
              </div>

              {/* Diet / Allergen Filters */}
              <div className="space-y-1.5 pt-2 border-t border-brand-outline">
                <span className="text-[10px] font-mono uppercase text-brand-muted font-bold block mb-2 px-1 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-brand-muted" />
                  Preferencias / Alérgenos
                </span>
                <div className="space-y-1">
                  {allergenFilters.map((filter) => {
                    const isSel = selectedAllergenFilter === filter.id;
                    return (
                      <button
                        key={filter.id}
                        onClick={() => setSelectedAllergenFilter(filter.id)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-sans cursor-pointer transition-all ${
                          isSel 
                            ? 'bg-brand-secondary/10 border border-brand-secondary/35 text-brand-secondary font-bold' 
                            : 'border border-transparent hover:bg-brand-surface-high/60 text-brand-muted hover:text-brand-text'
                        }`}
                      >
                        {filter.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Promo box to upload PDF */}
              {!pdfFile && (
                <div className="p-3 bg-brand-surface-high border border-brand-outline rounded-2xl space-y-2 mt-4">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-brand-text uppercase font-mono">
                    <Sparkles className="w-3.5 h-3.5 text-brand-primary" />
                    ¿Tienes Carta PDF?
                  </div>
                  <p className="text-[10px] text-brand-muted leading-relaxed">
                    Sube el menú del restaurante en formato PDF en las opciones o arrástralo en la vista PDF para activarla de inmediato.
                  </p>
                </div>
              )}
            </div>

            {/* Menu items grid */}
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-mono text-brand-muted font-bold">
                  Mostrando {filteredItems.length} de {baseItems.length} platos
                </span>
                <div className="flex items-center gap-3">
                  {(selectedCategory !== 'all' || selectedAllergenFilter !== 'all' || searchTerm) && (
                    <button
                      onClick={() => {
                        setSelectedCategory('all');
                        setSelectedAllergenFilter('all');
                        setSearchTerm('');
                      }}
                      className="text-[10px] font-mono text-brand-primary hover:underline font-bold"
                    >
                      Limpiar Filtros
                    </button>
                  )}
                  {editMode && (
                    <button
                      onClick={() => setDraft(emptyDraft(menu.length))}
                      className="flex items-center gap-1.5 bg-brand-primary text-brand-surface px-3 py-1.5 rounded-lg text-xs font-bold font-sans cursor-pointer hover:bg-brand-primary/90 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Añadir plato
                    </button>
                  )}
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <Utensils className="w-12 h-12 text-brand-outline mx-auto animate-pulse" />
                  <div className="text-sm font-sans font-bold text-brand-text">No se encontraron platos</div>
                  <p className="text-xs text-brand-muted max-w-sm mx-auto">
                    Intenta cambiar la búsqueda o desactivar los filtros de alérgenos aplicados.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className={`group bg-brand-surface-low border rounded-2xl p-4 flex flex-col justify-between transition-all duration-350 shadow-sm hover:shadow-md ${
                        editMode && !item.available
                          ? 'border-brand-outline/50 opacity-55'
                          : 'border-brand-outline hover:border-brand-primary/30 hover:bg-brand-surface'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-sans font-bold text-xs text-brand-text group-hover:text-brand-primary transition-colors flex items-center gap-1.5 flex-wrap">
                            {item.name}
                            {item.recommended && (
                              <span className="bg-brand-primary/15 text-brand-primary text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-brand-primary/25 uppercase font-mono flex items-center gap-0.5">
                                <Sparkles className="w-2 h-2" />
                                Top
                              </span>
                            )}
                            {editMode && !item.available && (
                              <span className="bg-brand-secondary/10 text-brand-secondary text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-brand-secondary/25 uppercase font-mono flex items-center gap-0.5">
                                <EyeOff className="w-2 h-2" />
                                No visible
                              </span>
                            )}
                          </h3>
                          <span className="font-mono font-bold text-brand-text text-xs bg-brand-surface-high border border-brand-outline px-2 py-0.5 rounded-lg whitespace-nowrap">
                            {typeof item.price === 'number' ? `${item.price.toFixed(2)}€` : '—'}
                          </span>
                        </div>
                        <p className="text-[11px] text-brand-muted leading-relaxed line-clamp-2">
                          {item.description}
                        </p>
                      </div>

                      {/* Allergen tags */}
                      {item.allergens.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3 pt-2.5 border-t border-brand-outline/40">
                          {item.allergens.map((alg) => (
                            <span
                              key={alg}
                              className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-md ${
                                alg === 'Vegetariano' || alg === 'Vegano'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}
                            >
                              {alg}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Acciones de edición */}
                      {editMode && (
                        <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-brand-outline/40">
                          <button
                            onClick={() => setDraft({ ...item })}
                            className="flex-1 flex items-center justify-center gap-1.5 bg-brand-surface-high border border-brand-outline hover:border-brand-primary/40 text-brand-text text-[11px] font-sans font-bold py-1.5 rounded-lg cursor-pointer transition-all"
                          >
                            <Pencil className="w-3.5 h-3.5 text-brand-primary" /> Editar
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`¿Eliminar "${item.name}" de la carta? Esta acción no se puede deshacer.`)) {
                                onDeleteDish(item.id);
                              }
                            }}
                            className="flex items-center justify-center gap-1.5 hover:bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-sans py-1.5 px-3 rounded-lg cursor-pointer transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* PDF viewer with drag-and-drop support if not loaded */
          <div className="flex-1 flex flex-col p-6 min-h-[500px] overflow-hidden">
            {pdfFile ? (
              <div className="flex-1 flex flex-col gap-4 overflow-hidden h-full">
                {/* PDF Control bar */}
                <div className="flex items-center justify-between bg-brand-surface-high border border-brand-outline px-4 py-2 rounded-2xl text-xs font-sans">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-brand-primary" />
                    <span className="font-mono text-brand-text font-bold truncate max-w-[200px] sm:max-w-md">
                      {pdfFileName}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <a
                      href={pdfFile}
                      download={pdfFileName || 'carta_menu.pdf'}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand-surface border border-brand-outline hover:border-brand-primary/40 text-brand-text hover:text-brand-primary transition-all cursor-pointer text-[10px] font-sans font-bold"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Descargar PDF
                    </a>
                  </div>
                </div>

                {/* PDF Frame */}
                <div className="flex-1 bg-zinc-900 border border-brand-outline rounded-3xl overflow-hidden relative shadow-inner min-h-[400px]">
                  {/* Since simple preview container standard frames can be tricky in sandboxed environments, 
                      we display a nice interactive embedded iframe with fallback link and premium mockup info */}
                  <iframe 
                    src={pdfFile} 
                    className="w-full h-full border-0 absolute inset-0 z-10"
                    title="Visor de PDF de la Carta"
                  />
                  
                  {/* Cover/Loading Indicator or static helper beneath */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-4 text-brand-muted z-0">
                    <FileText className="w-12 h-12 text-brand-outline animate-bounce" />
                    <div className="font-sans font-bold text-sm text-brand-text">Cargando la carta en PDF...</div>
                    <p className="text-xs text-brand-muted max-w-sm">
                      Si el visor de tu navegador no renderiza automáticamente el PDF debido a las políticas de seguridad locales, puedes descargarlo usando el botón superior.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* Drag-and-drop placeholder if no PDF is uploaded */
              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex-1 border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-all min-h-[400px]
                  ${dragOver 
                    ? 'border-brand-primary bg-brand-primary/5 scale-[0.99] ring-2 ring-brand-primary/30' 
                    : 'border-brand-outline/60 bg-brand-surface-low/30 hover:border-brand-primary/30 hover:bg-brand-surface-low/50'
                  }`}
              >
                <div className="w-16 h-16 rounded-2xl bg-brand-primary/10 border border-brand-primary/20 flex items-center justify-center mb-4 shadow-lg shadow-brand-primary/5">
                  <Upload className="w-8 h-8 text-brand-primary" />
                </div>
                
                <h3 className="font-sans font-bold text-base text-brand-text mb-1">Cargar Carta Oficial (.pdf)</h3>
                <p className="text-xs text-brand-muted max-w-md mb-6 leading-relaxed">
                  Arrastra y suelta tu archivo PDF aquí o selecciónalo de tu dispositivo. Una vez cargado, podrás visualizarlo de forma interactiva y habilitar su descarga para tus clientes.
                </p>

                <label className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary hover:bg-brand-primary-hover text-brand-surface rounded-2xl font-sans font-bold text-xs shadow-lg shadow-brand-primary/25 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]">
                  <FileText className="w-4 h-4" />
                  Seleccionar Archivo PDF
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>
                
                <span className="text-[10px] font-mono text-brand-muted mt-3">Tamaño máximo recomendado: 4.5 MB</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Formulario de plato (crear / editar) */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-brand-surface border border-brand-outline rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 bg-brand-surface-low border-b border-brand-outline flex items-center justify-between shrink-0">
              <h3 className="font-sans font-bold text-sm text-brand-text flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-brand-primary" />
                {draft.id ? 'Editar plato' : 'Nuevo plato'}
              </h3>
              <button onClick={() => setDraft(null)} className="text-brand-muted hover:text-brand-secondary cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {/* Nombre + Precio */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Nombre *</label>
                  <input
                    type="text"
                    value={draft.name || ''}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="ej. Space Jam"
                    className="w-full bg-brand-surface-low border border-brand-outline rounded-lg px-3 py-2 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Precio (€)</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    value={draft.price ?? ''}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="s/p"
                    className="w-full bg-brand-surface-low border border-brand-outline rounded-lg px-3 py-2 text-xs text-brand-text font-mono focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              {/* Categoría (elige existente o escribe una nueva) */}
              <div>
                <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Categoría *</label>
                <input
                  type="text"
                  list="menu-categorias"
                  value={draft.category || ''}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  placeholder="Elige una o escribe una nueva"
                  className="w-full bg-brand-surface-low border border-brand-outline rounded-lg px-3 py-2 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
                />
                <datalist id="menu-categorias">
                  {categories.filter(c => c.id !== 'all').map(c => <option key={c.id} value={c.name} />)}
                </datalist>
              </div>

              {/* Descripción */}
              <div>
                <label className="text-[10px] uppercase font-mono text-brand-muted block mb-1">Descripción</label>
                <textarea
                  rows={2}
                  value={draft.description || ''}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Ingredientes principales, elaboración..."
                  className="w-full bg-brand-surface-low border border-brand-outline rounded-lg px-3 py-2 text-xs text-brand-text font-sans focus:outline-none focus:border-brand-primary"
                />
              </div>

              {/* Alérgenos */}
              <div>
                <span className="text-[10px] uppercase font-mono text-brand-muted block mb-2">Alérgenos / dietas</span>
                <div className="flex flex-wrap gap-1.5">
                  {ALLERGIES_OPTIONS.map((a) => {
                    const sel = (draft.allergens || []).includes(a);
                    return (
                      <button
                        key={a}
                        type="button"
                        onClick={() => toggleDraftAllergen(a)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-sans transition-all cursor-pointer ${
                          sel
                            ? 'bg-brand-secondary/15 border-brand-secondary text-brand-secondary font-semibold'
                            : 'bg-brand-surface-low border-brand-outline text-brand-muted hover:border-brand-muted/40'
                        }`}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[9px] text-brand-muted/70 mt-1.5">Los alérgenos son de ejemplo: valídalos con el restaurante (RD 126/2015).</p>
              </div>

              {/* Destacado + Disponible */}
              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs text-brand-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!draft.recommended}
                    onChange={(e) => setDraft({ ...draft, recommended: e.target.checked })}
                    className="w-4 h-4 accent-brand-primary cursor-pointer"
                  />
                  Destacado (TOP)
                </label>
                <label className="flex items-center gap-2 text-xs text-brand-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.available !== false}
                    onChange={(e) => setDraft({ ...draft, available: e.target.checked })}
                    className="w-4 h-4 accent-brand-primary cursor-pointer"
                  />
                  Disponible (visible para el agente y el cliente)
                </label>
              </div>
            </div>

            <div className="p-4 bg-brand-surface-low border-t border-brand-outline flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setDraft(null)}
                className="px-4 py-2 bg-brand-surface-high border border-brand-outline hover:bg-brand-surface-highest text-brand-text text-xs rounded-lg font-sans cursor-pointer transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={saveDraft}
                className="px-4 py-2 bg-brand-primary text-brand-surface font-bold text-xs rounded-lg flex items-center gap-1.5 hover:bg-brand-primary/90 cursor-pointer transition-all"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                {draft.id ? 'Guardar cambios' : 'Añadir a la carta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
