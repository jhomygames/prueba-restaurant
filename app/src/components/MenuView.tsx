import React, { useState } from 'react';
import { 
  Upload, 
  BookOpen, 
  FileText, 
  Search, 
  Filter, 
  Trash2, 
  Download, 
  Check, 
  Sparkles,
  Utensils,
  Coffee,
  Wine,
  ChevronRight,
  Eye
} from 'lucide-react';

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: 'entrante' | 'principal' | 'postre' | 'bebida';
  allergens: string[];
  recommended: boolean;
}

const DEFAULT_MENU_ITEMS: MenuItem[] = [
  {
    id: '1',
    name: 'Croquetas de Jamón Ibérico',
    description: 'Crujientes por fuera y extremadamente cremosas por dentro, preparadas con leche fresca de granja y el mejor jamón ibérico de bellota.',
    price: 12.50,
    category: 'entrante',
    allergens: ['Gluten', 'Lactosa'],
    recommended: true
  },
  {
    id: '2',
    name: 'Ceviche de Corvina Salvaje',
    description: 'Fresca corvina marinada al momento en lima, cebolla morada crujiente, cilantro fresco, ají amarillo y batata dulce.',
    price: 18.00,
    category: 'entrante',
    allergens: ['Mariscos'],
    recommended: false
  },
  {
    id: '3',
    name: 'Burrata de Andria con Pesto de Pistacho',
    description: 'Cremosa burrata fresca servida sobre una cama de tomates cherry confitados, pesto de pistacho casero y reducción de Módena.',
    price: 15.00,
    category: 'entrante',
    allergens: ['Lactosa', 'Frutos Secos', 'Vegetariano'],
    recommended: true
  },
  {
    id: '4',
    name: 'Solomillo de Ternera al Carbón',
    description: 'Solomillo madurado a la brasa al punto deseado, servido con puré de patata trufado, chalotas glaseadas y salsa de vino de Oporto.',
    price: 26.50,
    category: 'principal',
    allergens: ['Lactosa'],
    recommended: true
  },
  {
    id: '5',
    name: 'Lomo de Bacalao Confitado',
    description: 'Bacalao confitado a baja temperatura sobre pisto tradicional manchego y emulsión de su propio pil-pil aromático.',
    price: 23.00,
    category: 'principal',
    allergens: [],
    recommended: false
  },
  {
    id: '6',
    name: 'Risotto de Setas Silvestres y Trufa',
    description: 'Arroz Carnaroli cremoso con selección de setas de temporada, parmesano curado de 24 meses y lascas de trufa negra fresca.',
    price: 19.50,
    category: 'principal',
    allergens: ['Lactosa', 'Vegetariano'],
    recommended: true
  },
  {
    id: '7',
    name: 'Coulant de Chocolate Belga',
    description: 'Volcán de chocolate templado con corazón fluido de cacao belga al 70%, acompañado de helado artesanal de vainilla de Madagascar.',
    price: 8.50,
    category: 'postre',
    allergens: ['Gluten', 'Lactosa', 'Huevo'],
    recommended: false
  },
  {
    id: '8',
    name: 'Tarta de Queso "Estilo San Sebastián"',
    description: 'Nuestra famosa tarta de queso horneada, tostada por fuera y con un corazón súper cremoso y fluido.',
    price: 9.00,
    category: 'postre',
    allergens: ['Lactosa', 'Huevo', 'Gluten', 'Vegetariano'],
    recommended: true
  },
  {
    id: '9',
    name: 'Cóctel Signature "DineControl"',
    description: 'Mezcla secreta de ginebra premium, infusión de frutos rojos, tónica artesanal, aroma de romero fresco y un toque de cítricos silvestres.',
    price: 11.00,
    category: 'bebida',
    allergens: [],
    recommended: true
  },
  {
    id: '10',
    name: 'Vino Tinto Ribera del Duero Crianza',
    description: 'Copa de vino tinto elegante, estructurado, con notas de frutos negros y un sutil paso por barrica de roble francés.',
    price: 5.50,
    category: 'bebida',
    allergens: [],
    recommended: false
  }
];

interface MenuViewProps {
  pdfFile: string | null;
  pdfFileName: string | null;
  onPdfUpload: (base64: string, name: string) => void;
  onPdfRemove: () => void;
}

export const MenuView: React.FC<MenuViewProps> = ({
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

  // Available filters
  const categories = [
    { id: 'all', name: 'Todos', icon: <Utensils className="w-3.5 h-3.5" /> },
    { id: 'entrante', name: 'Entrantes', icon: <Utensils className="w-3.5 h-3.5" /> },
    { id: 'principal', name: 'Principales', icon: <Utensils className="w-3.5 h-3.5" /> },
    { id: 'postre', name: 'Postres', icon: <Coffee className="w-3.5 h-3.5" /> },
    { id: 'bebida', name: 'Bebidas', icon: <Wine className="w-3.5 h-3.5" /> }
  ];

  const allergenFilters = [
    { id: 'all', name: 'Sin restricción' },
    { id: 'Vegetariano', name: 'Vegetariano' },
    { id: 'Vegano', name: 'Vegano' },
    { id: 'Gluten', name: 'Sin Gluten (Aviso)' },
    { id: 'Lactosa', name: 'Sin Lactosa (Aviso)' }
  ];

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

  // Filter items
  const filteredItems = DEFAULT_MENU_ITEMS.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    
    let matchesAllergen = true;
    if (selectedAllergenFilter !== 'all') {
      if (selectedAllergenFilter === 'Vegetariano' || selectedAllergenFilter === 'Vegano') {
        matchesAllergen = item.allergens.includes(selectedAllergenFilter);
      } else {
        // e.g. "Gluten" - means we avoid items that contain Gluten
        matchesAllergen = !item.allergens.includes(selectedAllergenFilter);
      }
    }

    return matchesSearch && matchesCategory && matchesAllergen;
  });

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
                        {cat.icon}
                        <span>{cat.name}</span>
                      </div>
                      <ChevronRight className={`w-3.5 h-3.5 text-brand-muted transition-transform ${isSel ? 'rotate-90 text-brand-primary' : ''}`} />
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
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-brand-muted font-bold">
                  Mostrando {filteredItems.length} de {DEFAULT_MENU_ITEMS.length} platos
                </span>
                {selectedCategory !== 'all' && (
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
                      className="group bg-brand-surface-low border border-brand-outline rounded-2xl p-4 flex flex-col justify-between hover:border-brand-primary/30 hover:bg-brand-surface transition-all duration-350 shadow-sm hover:shadow-md"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-sans font-bold text-xs text-brand-text group-hover:text-brand-primary transition-colors flex items-center gap-1.5">
                            {item.name}
                            {item.recommended && (
                              <span className="bg-brand-primary/15 text-brand-primary text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-brand-primary/25 uppercase font-mono flex items-center gap-0.5">
                                <Sparkles className="w-2 h-2" />
                                Top
                              </span>
                            )}
                          </h3>
                          <span className="font-mono font-bold text-brand-text text-xs bg-brand-surface-high border border-brand-outline px-2 py-0.5 rounded-lg whitespace-nowrap">
                            {item.price.toFixed(2)}€
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
    </div>
  );
};
