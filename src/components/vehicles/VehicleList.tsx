"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Vehicle, User } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Search, Edit, Trash2, History, Car, Filter, X, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VehicleDialog } from "./VehicleDialog";
import { getImagePath } from "@/lib/image-path";
import { deleteVehicle, getVehicles, getVehicleHistory } from "@/app/actions/vehicles";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { getCarLogo } from "@/lib/car-logos";
import { fecha, hora } from "@/lib/fechas";

function timeAgo(d: string | Date | null): string {
    if (!d) return "";
    const ms = Date.now() - new Date(d).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "recién";
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const days = Math.floor(h / 24);
    if (days < 30) return `hace ${days} d`;
    return fecha(new Date(d));
}

interface VehicleListProps {
    initialVehicles: (Vehicle & { user: User })[];
    initialTotal: number;
    users: User[];
}

// Simple useDebounce hook
function useDebounce<T>(value: T, delay?: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedValue(value), delay || 500);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debouncedValue;
}

export function VehicleList({ initialVehicles, initialTotal, users }: VehicleListProps) {
    const [vehicles, setVehicles] = useState<(Vehicle & { user: User })[]>(initialVehicles);
    const [total, setTotal] = useState(initialTotal);
    const [searchTerm, setSearchTerm] = useState("");
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(initialVehicles.length < initialTotal);
    const [skip, setSkip] = useState(initialVehicles.length);
    const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [history, setHistory] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [triggerFetch, setTriggerFetch] = useState(0);

    const observer = useRef<IntersectionObserver | null>(null);
    const lastElementRef = useCallback((node: HTMLDivElement) => {
        if (loading) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                loadMore();
            }
        });
        if (node) observer.current.observe(node);
    }, [loading, hasMore]);

    const debouncedSearch = useDebounce(searchTerm, 500);

    // Initial load/search
    useEffect(() => {
        const fetchInitial = async () => {
            setLoading(true);
            const { vehicles: newVehicles, total: newTotal } = await getVehicles(0, 20, debouncedSearch);
            setVehicles(newVehicles as any);
            setTotal(newTotal);
            setSkip(newVehicles.length);
            setHasMore(newVehicles.length < newTotal);
            setLoading(false);
        };
        fetchInitial();
    }, [debouncedSearch, triggerFetch]);

    // Load history when modal opens
    useEffect(() => {
        if (showHistory && selectedVehicle) {
            const fetchHistory = async () => {
                setHistoryLoading(true);
                const res = await getVehicleHistory(selectedVehicle.plate);
                if (res.success) {
                    setHistory((res as any).events || []);
                }
                setHistoryLoading(false);
            };
            fetchHistory();
        } else {
            setHistory([]);
        }
    }, [showHistory, selectedVehicle]);

    const loadMore = async () => {
        if (loading || !hasMore) return;
        setLoading(true);
        const { vehicles: nextBatch } = await getVehicles(skip, 20, debouncedSearch);

        if (nextBatch.length === 0) {
            setHasMore(false);
        } else {
            setVehicles(prev => [...prev, ...nextBatch] as any);
            setSkip(prev => prev + nextBatch.length);
            setHasMore(vehicles.length + nextBatch.length < total);
        }
        setLoading(false);
    };

    const handleDelete = async (id: string) => {
        if (confirm("¿Estás seguro de eliminar este vehículo?")) {
            await deleteVehicle(id);
            setVehicles(prev => prev.filter(v => v.id !== id));
            setTotal(prev => prev - 1);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <Input
                        placeholder="Buscar por placa, propietario, marca o modelo..."
                        className="pl-10 bg-card border-border h-11 rounded-xl"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="border-border hover:bg-muted">
                        <Filter size={16} className="mr-2" />
                        Filtros
                    </Button>
                    <VehicleDialog users={users} onSuccess={() => setTriggerFetch(prev => prev + 1)} />
                </div>
            </div>

            {/* Table Container with Gradient Fade */}
            <div className="relative bg-card/50 backdrop-blur-sm rounded-lg border border-border/50 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border">
                                <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Matrícula</th>
                                <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Vehículo</th>
                                <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Propietario</th>
                                <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Color</th>
                                <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Última detección</th>
                                <th className="text-left px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                                <th className="text-right px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {vehicles.map((vehicle) => (
                                <tr
                                    key={vehicle.id}
                                    className="hover:bg-muted/30 transition-colors group"
                                >
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-14 h-10 rounded-md overflow-hidden bg-muted flex items-center justify-center border border-border group-hover:border-blue-500/30 transition-colors shrink-0">
                                                {(vehicle as any).lastPhoto ? (
                                                    <img src={(() => { const u = getImagePath((vehicle as any).lastPhoto) || ""; return u ? (u.includes("?") ? `${u}&w=96` : `${u}?w=96`) : ""; })()} alt="" className="w-full h-full object-cover cursor-zoom-in" onClick={(e) => { e.stopPropagation(); const u = getImagePath((vehicle as any).lastPhoto); if (u) setPhotoUrl(u); }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                                ) : (
                                                    <Car size={18} className="text-muted-foreground group-hover:text-blue-400 transition-colors" />
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-foreground font-mono tracking-wider">{vehicle.plate}</p>
                                                <p className="text-[10px] text-muted-foreground font-mono">ID: {vehicle.id.slice(0, 8)}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            {getCarLogo(vehicle.brand) ? (
                                                <div className="relative w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center p-1.5 shrink-0">
                                                    <Image src={getCarLogo(vehicle.brand)!} alt={vehicle.brand || ""} fill sizes="32px" className="object-contain filter brightness-0 invert opacity-60 group-hover:opacity-100 transition-opacity" />
                                                </div>
                                            ) : (
                                                <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                                                    <Car size={14} className="text-muted-foreground" />
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-sm font-bold text-foreground uppercase tracking-tight">{vehicle.brand || 'Genérico'}</p>
                                                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{vehicle.model || 'Sin modelo'}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                                                {vehicle.user.name.charAt(0)}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-foreground">{vehicle.user.name}</p>
                                                <p className="text-xs text-muted-foreground">{vehicle.user.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        {vehicle.color ? (
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full border-2 border-border" style={{ backgroundColor: vehicle.color }} />
                                                <span className="text-xs text-muted-foreground capitalize">{vehicle.color}</span>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                    </td>
                                    <td className="p-4">
                                        {(vehicle as any).lastSeen ? (
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <Clock size={13} className="text-blue-400/70 shrink-0" />
                                                <span title={fecha(new Date((vehicle as any).lastSeen))}>{timeAgo((vehicle as any).lastSeen)}</span>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground/50">Sin detecciones</span>
                                        )}
                                    </td>
                                    <td className="p-4">
                                        <Badge variant="default" className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/20">ACTIVO</Badge>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 rounded-lg hover:bg-blue-500/10 hover:text-blue-400"
                                                onClick={() => { setSelectedVehicle(vehicle); setShowHistory(true); }}
                                            >
                                                <History size={16} />
                                            </Button>
                                            <VehicleDialog
                                                users={users}
                                                vehicle={vehicle}
                                                onSuccess={() => setTriggerFetch(prev => prev + 1)}
                                                trigger={
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg hover:bg-blue-500/10 hover:text-blue-400">
                                                        <Edit size={16} />
                                                    </Button>
                                                }
                                            />
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                onClick={() => handleDelete(vehicle.id)}
                                                className="h-8 w-8 rounded-lg hover:bg-red-500/10 hover:text-red-400"
                                            >
                                                <Trash2 size={16} />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div ref={lastElementRef} className="h-20 flex items-center justify-center">
                        {loading && (
                            <div className="flex items-center gap-2 text-muted-foreground text-xs font-bold uppercase tracking-widest mt-4">
                                <Loader2 className="animate-spin" size={16} />
                                Cargando más...
                            </div>
                        )}
                        {!hasMore && vehicles.length > 0 && (
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-4">
                                Fin del listado
                            </div>
                        )}
                    </div>

                    {!loading && vehicles.length === 0 && (
                        <div className="py-20 text-center">
                            <Car size={48} className="mx-auto text-muted-foreground mb-4 animate-pulse" />
                            <h3 className="text-lg font-bold text-foreground mb-2">No se encontraron vehículos</h3>
                            <p className="text-sm text-muted-foreground">{searchTerm ? 'Intenta con otro término de búsqueda' : 'Agrega tu primer vehículo'}</p>
                        </div>
                    )}
                </div>

                {hasMore && (
                    <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-transparent pointer-events-none z-20 backdrop-blur-[2px]" />
                )}
            </div>

            <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                <p>Mostrando <span className="text-foreground">{vehicles.length}</span> de <span className="text-foreground">{total}</span> registros</p>
            </div>

            {showHistory && selectedVehicle && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-500">
                    <div className="bg-card rounded-xl border border-border max-w-2xl w-full max-h-[85vh] overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] flex flex-col">
                        {/* Header */}
                        <div className="px-8 py-6 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-5">
                                <div className="w-11 h-11 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                                    <History size={22} />
                                </div>
                                <div className="space-y-1">
                                    <h2 className="text-lg font-bold text-foreground tracking-widest uppercase leading-none">
                                        Historial de Accesos
                                    </h2>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="h-4 px-1.5 text-[7px] font-bold uppercase tracking-[0.2em] bg-emerald-500/5 text-emerald-500/60 border-emerald-500/10 rounded">
                                            Matrícula
                                        </Badge>
                                        <span className="text-sm font-mono font-bold text-muted-foreground uppercase tracking-widest">
                                            {selectedVehicle.plate}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setShowHistory(false)}
                                className="w-10 h-10 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-all border border-transparent hover:border-border"
                            >
                                <X size={20} />
                            </Button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                            {historyLoading ? (
                                <div className="py-24 flex flex-col items-center justify-center gap-4">
                                    <Loader2 className="animate-spin text-emerald-500/50" size={32} />
                                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.3em]">Sincronizando registros...</p>
                                </div>
                            ) : history.length > 0 ? (
                                <div className="space-y-3">
                                    {history.map((event, i) => (
                                        <div
                                            key={event.id}
                                            className="group relative bg-[#111] border border-white/[0.03] rounded-lg p-5 hover:bg-[#151515] transition-all hover:border-border animate-in slide-in-from-bottom-2 duration-300"
                                            style={{ animationDelay: `${i * 40}ms` }}
                                        >
                                            <div className="flex items-center justify-between gap-6">
                                                <div className="flex items-center gap-5">
                                                    <div className={cn(
                                                        "w-10 h-10 rounded-md flex items-center justify-center shrink-0 border transition-all duration-500",
                                                        event.decision === 'GRANT'
                                                            ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-400/80 group-hover:bg-emerald-500/10 group-hover:border-emerald-500/20"
                                                            : "bg-red-500/5 border-red-500/10 text-red-400/80 group-hover:bg-red-500/10 group-hover:border-red-500/20"
                                                    )}>
                                                        <Car size={18} />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2 mb-1.5">
                                                            <p className="text-xs font-bold text-foreground uppercase tracking-wider">
                                                                {event.location || event.device?.location || 'Punto de Acceso'}
                                                            </p>
                                                            <div className={cn(
                                                                "text-[7px] font-bold tracking-[0.22em] px-1.5 py-0.5 rounded border-none",
                                                                event.decision === 'GRANT' ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-500"
                                                            )}>
                                                                {event.decision === 'GRANT' ? 'PULSO OK' : 'DENEGADO'}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-[9px] text-muted-foreground font-bold uppercase tracking-widest">
                                                            <span className="opacity-40 whitespace-nowrap">ID DISP:</span>
                                                            <span className="text-muted-foreground truncate max-w-[120px]">{event.device?.name || 'LPR_NODE_01'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-xs font-bold text-foreground leading-none mb-1.5">
                                                        {hora(new Date(event.timestamp))}
                                                    </p>
                                                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.2em] whitespace-nowrap">
                                                        {new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(new Date(event.timestamp))}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-24 text-center">
                                    <div className="w-16 h-16 rounded-full bg-foreground/[0.04] border border-white/[0.05] flex items-center justify-center mx-auto mb-6">
                                        <History size={24} className="text-muted-foreground" />
                                    </div>
                                    <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-[0.2em] mb-3">Sin actividad reciente</h3>
                                    <p className="text-[10px] text-muted-foreground font-bold max-w-[280px] mx-auto uppercase tracking-widest leading-relaxed opacity-60">
                                        No se han detectado eventos para esta matrícula en el historial del servidor.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-8 py-6 bg-card/10 border-t border-border">
                            <Button
                                onClick={() => setShowHistory(false)}
                                className="w-full h-12 rounded-lg bg-card hover:bg-muted text-muted-foreground hover:text-foreground text-[10px] font-bold uppercase tracking-[0.4em] border border-border transition-all"
                            >
                                Cerrar Registro
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            {photoUrl && (
                <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 animate-in fade-in" onClick={() => setPhotoUrl(null)}>
                    <img src={photoUrl.includes("?") ? `${photoUrl}&w=1200` : `${photoUrl}?w=1200`} alt="" className="max-w-full max-h-full rounded-xl shadow-2xl object-contain" onClick={(e) => e.stopPropagation()} />
                    <button onClick={() => setPhotoUrl(null)} className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur">&times;</button>
                </div>
            )}
        </div>
    );
}
