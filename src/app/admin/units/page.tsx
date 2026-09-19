"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Unit, UnitType, User } from "@prisma/client";
import {
    Building2, Home, MapPin, LayoutGrid, Pencil, Trash2, Plus, Info, Server,
    Users, ChevronRight, Search, Video, ScanFace, MoreVertical, ArrowRight,
    Check, Layers, Phone, Hash, Monitor, ChevronLeft, Globe, UserCircle,
    Building, ExternalLink, Map as MapIcon, Navigation, LocateFixed, Mail,
    Contact, Clock, Activity, MapPin as MapPinIcon, X, Car, IdCard
} from "lucide-react";
import dynamic from 'next/dynamic';

const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
    ssr: false,
    loading: () => <div className="h-64 w-full bg-card animate-pulse rounded-xl" />
});

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getUnits, deleteUnit, createUnit, updateUnit, getUnitsWithDetails, bulkCreateSubUnits, getAvailableUsers, assignUserToUnit, unassignUserFromUnit } from "@/app/actions/units";
import { getLotes } from "@/app/actions/barriomap";
import { CajonUnidad } from "@/components/units/CajonUnidad";
import { getUsers } from "@/app/actions/users";
import { cn } from "@/lib/utils";
import { TablaUnidades } from "@/components/units/TablaUnidades";
import { Filtros } from "@/components/ui/filtros";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import Image from "next/image";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { sileo as toast } from "sileo";

interface ExtendedUser extends User {
    vehicles: { plate: string }[];
    credentials?: any[];
}

interface ExtendedUnit extends Unit {
    users: ExtendedUser[];
    children?: ExtendedUnit[];
}

/** Cuántas unidades entran de una tanda. */
const PAGINA = 50;

export default function UnitsPage() {
    const [units, setUnits] = useState<ExtendedUnit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /* Cuántas filas se muestran. Antes se renderizaba el catastro completo de una, con el
       avatar, los chips y el menú de cada fila. */
    const [aLaVista, setALaVista] = useState(PAGINA);
    const [selectedUnit, setSelectedUnit] = useState<ExtendedUnit | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [activeCategory, setActiveCategory] = useState<'all' | 'units' | 'complexes'>('units');
    const [mode, setMode] = useState<'list' | 'wizard'>('list');
    const [availableUsers, setAvailableUsers] = useState<any[]>([]);
    const [searchAvailable, setSearchAvailable] = useState("");
    const [showAssignDialog, setShowAssignDialog] = useState(false);
    const [editingUnit, setEditingUnit] = useState<ExtendedUnit | null>(null);
    const [cajonAbierto, setCajonAbierto] = useState(false);
    /**
     * Los contornos dibujados en el mapa.
     *
     * Se traen acá y no adentro del cajón porque la lista también los quiere: saber cuáles
     * ya están tomados es lo que permite decir, sobre un lote, «ya es Torre A» en vez de
     * dejar al operador descubrirlo al pisarlo.
     */
    const [lotes, setLotes] = useState<{ id: string; label: string; unitId?: string | null }[]>([]);
    const [activeEditTab, setActiveEditTab] = useState<'general' | 'contact' | 'location' | 'map' | 'units' | 'residents' | 'vehicles'>('general');
    const [editingSubUnit, setEditingSubUnit] = useState<ExtendedUnit | null>(null);
    const [showBulkDialog, setShowBulkDialog] = useState(false);
    const [bulkPattern, setBulkPattern] = useState("A-Z, 13");

    // Form State
    const [formData, setFormData] = useState({
        name: "",
        type: "BARRIO" as UnitType,
        floors: "",
        lot: "",
        houseNumber: "",
        address: "",
        adminPhone: "",
        contactName: "",
        contactEmail: "",
        deviceCount: "2",
        deviceType: "BOTH",
        coordinates: "-34.6037, -58.3816",
        parentId: ""
    });

    const [step, setStep] = useState(1);

    const loadUnits = async () => {
        setLoading(true);
        try {
            const data = await getUnitsWithDetails();
            setUnits(data as ExtendedUnit[]);
            setError(null);
            if (data.length > 0) {
                if (selectedUnit) {
                    const updated = data.find(u => u.id === selectedUnit.id);
                    if (updated) setSelectedUnit(updated as ExtendedUnit);
                } else {
                    setSelectedUnit(data[0] as ExtendedUnit);
                }
            }
        } catch (e: any) {
            /* No había `catch` en absoluto: si la consulta fallaba, la pantalla quedaba con
               el catastro vacío y sin decir nada. Un barrio sin unidades cargadas y un
               servidor caído se veían igual. */
            console.error("[unidades] no se pudo traer el catastro:", e);
            setError(e?.message || "No hubo respuesta del servidor.");
        } finally {
            setLoading(false);
        }
    };

    const loadAvailableUsers = async () => {
        const u = await getAvailableUsers();
        setAvailableUsers(u);
    };

    const cargarLotes = useCallback(async () => {
        try { setLotes(await getLotes() as any); } catch { setLotes([]); }
    }, []);
    useEffect(() => { cargarLotes(); }, [cargarLotes]);

    useEffect(() => {
        loadUnits();
        loadAvailableUsers();
    }, []);

    const handleCreateNew = (parentId?: string) => {
        /* Un alta con padre ya elegido (desde «agregar sub-unidad») llega con ese dato
           puesto; el resto lo decide el formulario, que ya no bifurca por clase. */
        setEditingUnit(parentId ? ({ parentId } as any) : null);
        setCajonAbierto(true);
    };

    const handleEdit = (unit: ExtendedUnit) => {
        setEditingUnit(unit);
        setCajonAbierto(true);
    };


    const handleBulkCreate = async () => {
        if (!editingUnit) return;
        try {
            await bulkCreateSubUnits(editingUnit.id, bulkPattern);
            toast.success({ title: "Generación masiva completada" });
            setShowBulkDialog(false);
            loadUnits();
        } catch (e) {
            toast.error({ title: "Error en la generación masiva" });
        }
    };

    /**
     * De qué complejo depende cada unidad, resuelto UNA vez.
     *
     * La columna hacía `units.find(u => u.id === unit.parentId)` por fila: recorrer el
     * catastro entero, por cada fila, en cada render. Con cien unidades son diez mil
     * comparaciones; con mil, un millón, y escribir en el buscador traba la pantalla.
     */
    const indicePadres = useMemo(() => {
        const m = new Map<string, string>();
        for (const u of units) m.set(u.id, u.name);
        return m;
    }, [units]);

    const filteredUnits = units.filter(u => {
        const matchesSearch =
            u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.lot?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.houseNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.contactName?.toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        if (activeCategory === 'units') {
            return u.parentId !== null || u.type === 'CASA';
        }
        if (activeCategory === 'complexes') {
            return u.parentId === null && (u.type === 'BARRIO' || u.type === 'EDIFICIO');
        }
        return true;
    });

    const aMostrar = filteredUnits.slice(0, aLaVista);
    const hayMas = aLaVista < filteredUnits.length;

    // Cambiar de búsqueda o de categoría vuelve a la primera tanda.
    useEffect(() => { setALaVista(PAGINA); }, [searchTerm, activeCategory]);

    const displayedResidents = useMemo(() => {
        if (!selectedUnit) return [];
        const res = [...selectedUnit.users];
        if (selectedUnit.type === 'BARRIO' && selectedUnit.children) {
            selectedUnit.children.forEach(child => {
                res.push(...(child.users || []));
            });
        }
        return res;
    }, [selectedUnit]);

    return (
        <div className="h-full flex flex-col bg-background animate-in fade-in duration-700 overflow-hidden">
            {/* Horizontal Header Menu */}
            <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md flex items-center justify-between shrink-0">
                <div className="flex items-center gap-8">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Unidades</h1>
                        <p className="text-sm text-muted-foreground mt-1">Catastro y Gestión de Propiedades</p>
                    </div>

                </div>

                <Button onClick={() => handleCreateNew()} size="sm" className="accion h-9 px-5 rounded-md font-semibold text-[12px] gap-1.5">
                    <Plus size={16} /> Nueva propiedad
                </Button>
            </header>

            {/* Central Table Content */}
            <main className="flex-1 overflow-hidden p-8 flex flex-col gap-6">
                {/* Sin tarjeta alrededor de la tabla: la tabla es la pantalla. */}
                <div className="flex-1 flex flex-col min-h-0">
                    <TablaUnidades
                        barra={
                            <Filtros
                                busqueda={searchTerm} alBuscar={setSearchTerm}
                                placeholder="Propiedad, lote o contacto"
                                grupos={[{
                                    clave: "categoria", titulo: "Qué clase de propiedad",
                                    valor: activeCategory, alElegir: (v) => setActiveCategory(v as any),
                                    opciones: [
                                        { valor: "all", rotulo: "Todo" },
                                        { valor: "units", rotulo: "Lotes y pisos" },
                                        { valor: "complexes", rotulo: "Barrios y edificios" },
                                    ],
                                }]}
                            />
                        }
                        unidades={aMostrar}
                        indicePadres={indicePadres}
                        cargando={loading}
                        error={error}
                        alReintentar={() => { setError(null); loadUnits(); }}
                        hayMas={hayMas}
                        traerMas={() => setALaVista((n) => n + PAGINA)}
                        seleccionada={selectedUnit?.id}
                        alElegir={(u) => setSelectedUnit(u as any)}
                        alEditar={(u) => handleEdit(u as any)}
                        alRecargar={loadUnits}
                    />

                    {/* Bottom Detail Summary (Conditionally shown if something selected) */}
                    {selectedUnit && (
                        <div className="h-24 bg-card border-t border-border px-8 flex items-center justify-between animate-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center gap-6">
                                <div className="space-y-1">
                                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Unidad Seleccionada</span>
                                    <div className="flex items-center gap-3">
                                        <h3 className="text-xl font-bold text-foreground uppercase tracking-tighter">{selectedUnit.name}</h3>
                                        <Badge className="bg-blue-600 text-foreground border-none text-[8px] font-bold uppercase">{selectedUnit.type}</Badge>
                                    </div>
                                </div>
                                <div className="h-8 w-px bg-foreground/10" />
                                <div className="flex items-center gap-8">
                                    <div className="space-y-1">
                                        <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Ubicación</span>
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">{selectedUnit.address || "S/D"}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Habitantes</span>
                                        <div className="flex -space-x-2">
                                            {selectedUnit.users.slice(0, 5).map((u, i) => (
                                                <div key={i} className="w-6 h-6 rounded-full border border-black bg-muted flex items-center justify-center overflow-hidden ring-1 ring-border">
                                                    {u.cara ? <Image src={u.cara} alt="" width={24} height={24} className="object-cover" /> : <UserCircle size={14} className="text-muted-foreground" />}
                                                </div>
                                            ))}
                                            {selectedUnit.users.length > 5 && (
                                                <div className="w-6 h-6 rounded-full border border-black bg-card border-border flex items-center justify-center text-[8px] font-bold text-muted-foreground">
                                                    +{selectedUnit.users.length - 5}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {(selectedUnit.type === 'BARRIO' || selectedUnit.type === 'EDIFICIO') && (
                                        <div className="space-y-1">
                                            <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Contenido</span>
                                            <p className="text-[10px] font-bold text-blue-500 uppercase">{selectedUnit.children?.length || 0} Sub-unidades</p>
                                        </div>
                                    )}
                                    {selectedUnit.users.some(u => u.vehicles?.length > 0) && (
                                        <div className="space-y-1">
                                            <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest">Matrículas Activas</span>
                                            <div className="flex gap-1.5">
                                                {selectedUnit.users.flatMap(u => u.vehicles || []).slice(0, 4).map((v, idx) => (
                                                    <Badge key={idx} className="bg-muted text-blue-400 border-border text-[8px] font-mono h-4 font-bold">{v.plate}</Badge>
                                                ))}
                                                {selectedUnit.users.flatMap(u => u.vehicles || []).length > 4 && (
                                                    <span className="text-[8px] text-muted-foreground font-bold">+{selectedUnit.users.flatMap(u => u.vehicles || []).length - 4}</span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <Button onClick={() => handleEdit(selectedUnit)} variant="outline" className="h-9 px-5 bg-foreground/10 border-border rounded-xl font-bold text-[9px] uppercase tracking-widest">
                                    <Pencil className="mr-2" size={14} /> Editar Propiedad
                                </Button>
                                <Button
                                    onClick={() => setSelectedUnit(null)}
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 text-muted-foreground hover:text-foreground"
                                >
                                    <X size={18} />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/*
              * La edición vive en un cajón, no en un diálogo.
              *
              * Acá había un diálogo centrado de 6xl con pestañas adentro: tan grande que
              * tapaba la lista, pero sin llegar a ser una pantalla. Lo peor de los dos
              * mundos — perdía el contexto como una pantalla y no daba el lugar de una.
              * Y el alta era otro camino distinto: un asistente por pasos que obligaba a
              * elegir la clase (barrio, edificio, casa) ANTES de tener los datos.
              *
              * Ahora es lo mismo dar de alta y editar, porque es lo mismo: una propiedad.
              */}
            <CajonUnidad
                abierto={cajonAbierto}
                alCerrar={() => { setCajonAbierto(false); setEditingUnit(null); }}
                unidad={editingUnit}
                unidades={units}
                lotes={lotes}
                alGuardar={() => { loadUnits(); cargarLotes(); }}
            />

            {/* Bulk Creation Dialog */}
            <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
                <DialogContent className="bg-card border-border text-foreground max-w-sm p-6 rounded-lg shadow-lg outline-none">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-bold uppercase tracking-tighter">Generación Masiva</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground italic">
                            Se generarán sub-unidades automáticamente siguiendo el patrón definido.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center block">Patrón de Nomenclatura</Label>
                            <Input
                                value={bulkPattern}
                                onChange={(e) => setBulkPattern(e.target.value)}
                                placeholder="A-Z, 13"
                                className="bg-card border-border h-12 text-lg font-bold text-blue-400 uppercase text-center rounded-xl"
                            />
                            <p className="text-[8px] text-muted-foreground uppercase font-bold text-center mt-2 px-4">
                                Ejemplo: "A-Z, 13" generará lotes desde A01 hasta Z13.
                            </p>
                        </div>

                        <Button onClick={handleBulkCreate} className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 font-bold text-[10px] uppercase tracking-widest text-foreground rounded-xl shadow-lg transition-all active:scale-95">
                            <Layers className="mr-2" size={16} /> Iniciar Generación
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #444; }
                .leaflet-container { background: #0a0a0a !important; border-radius: 32px; }
            `}</style>
        </div>
    );
}

function Textarea({ value, onChange, placeholder, className }: { value: string, onChange: (e: any) => void, placeholder?: string, className?: string }) {
    return (
        <textarea
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            className={cn(
                "w-full bg-card border border-border rounded-xl p-4 text-xs text-foreground placeholder:text-neutral-700 focus:outline-none focus:border-blue-500 transition-all",
                className
            )}
        />
    );
}
