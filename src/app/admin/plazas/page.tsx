"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
    LayoutGrid,
    Upload,
    Plus,
    Trash2,
    Save,
    Pencil,
    Warehouse,
    Info,
    CheckCircle2,
    XCircle,
    Map,
    Home,
    Square,
    Pentagon,
    X,
    Search,
    User as UserIcon,
    Car,
    LogIn,
    LogOut,
    Spline,
    Hand,
    ZoomIn,
    ZoomOut,
    Maximize2,
    MousePointer2,
    Move,
    Edit3,
    ChevronDown,
    Video
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getParkingSlots, saveParkingSlots, getParkingMap, uploadParkingMap, getParkingElements, saveParkingElements, getParkingOccupancy } from "@/app/actions/plazas";
import { io } from "socket.io-client";
import { getUnitsWithDetails } from "@/app/actions/units";
import { getDevices } from "@/app/actions/devices";
import { sileo as toast } from "sileo";

interface ParkingSlot {
    id: string;
    points: { x: number; y: number }[]; // Polygon points
    label: string;
    unitId: string | null; // Link to Unit/Lote
    isOccupied: boolean;
}

interface Unit {
    id: string;
    name: string;
    number: string;
    users?: {
        id: string;
        name: string;
    }[];
}

export default function PlazasPage() {
    const [mapImage, setMapImage] = useState<string | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [slots, setSlots] = useState<ParkingSlot[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [occupancy, setOccupancy] = useState<Record<string, { status: "in" | "out" | "none"; inside: string[]; all: string[] }>>({});
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
    const [hoveredSlot, setHoveredSlot] = useState<string | null>(null);
    const [showUnitSelector, setShowUnitSelector] = useState(false);
    const [searchUnit, setSearchUnit] = useState("");
    const [tool, setTool] = useState<"plaza" | "entrada" | "salida" | "calle" | "pan">("plaza");
    const movingRef = useRef<{ slotId: string; sx: number; sy: number; orig: { x: number; y: number }[] } | null>(null);
    const [listCollapsed, setListCollapsed] = useState(true);
    const [plazaSearch, setPlazaSearch] = useState("");
    const [editSlotId, setEditSlotId] = useState<string | null>(null);
    const [streetEditId, setStreetEditId] = useState<string | null>(null);
    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; type: "slot" | "calle" | "entrada" | "salida"; id: string } | null>(null);
    const streetVtxRef = useRef<{ id: string; idx: number } | null>(null);
    const [cameras, setCameras] = useState<any[]>([]);
    const [pendingElement, setPendingElement] = useState<{ kind: "entrada" | "salida"; x: number; y: number } | null>(null);
    const addPendingElement = (cam: any) => {
        setElements(prev => { const key = pendingElement!.kind === "entrada" ? "entradas" : "salidas"; const arr = (prev as any)[key]; return { ...prev, [key]: [...arr, { id: Math.random().toString(36).slice(2, 9), x: pendingElement!.x, y: pendingElement!.y, label: (pendingElement!.kind === "entrada" ? "E" : "S") + (arr.length + 1), cameraId: cam?.id || null, cameraName: cam?.name || null }] }; });
        setPendingElement(null);
    };
    const openCtx = (e: React.MouseEvent, type: "slot" | "calle" | "entrada" | "salida", id: string) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, type, id }); };
    const renameElement = (kind: "entradas" | "salidas", id: string) => { const v = window.prompt("Etiqueta:"); if (v != null) setElements(prev => ({ ...prev, [kind]: (prev as any)[kind].map((el: any) => el.id === id ? { ...el, label: v } : el) })); };
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number; nx?: number; ny?: number } | null>(null);
    const [hoverCard, setHoverCard] = useState<{ slotId: string; x: number; y: number } | null>(null);
    const renameStreet = (id: string) => { const v = window.prompt("Nombre de la calle:", ""); if (v != null) setElements(prev => ({ ...prev, calles: prev.calles.map((c: any) => c.id === id ? { ...c, name: v } : c) })); };
    const fitView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
    const normPt = (e: React.MouseEvent) => { const r = mapWrapperRef.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    const distToSeg = (p: {x:number;y:number}, a: {x:number;y:number}, b: {x:number;y:number}) => { const dx=b.x-a.x, dy=b.y-a.y; const l2=dx*dx+dy*dy || 1e-9; let t=((p.x-a.x)*dx+(p.y-a.y)*dy)/l2; t=Math.max(0,Math.min(1,t)); const cx=a.x+t*dx, cy=a.y+t*dy; return Math.hypot(p.x-cx,p.y-cy); };
    const deleteVertex = (slotId: string, idx: number) => setSlots(prev => prev.map(s => s.id===slotId ? (s.points.length>3 ? { ...s, points: s.points.filter((_,i)=>i!==idx) } : s) : s));
    const addVertexAt = (slotId: string, e: React.MouseEvent) => { const p = normPt(e); setSlots(prev => prev.map(s => { if (s.id!==slotId) return s; const pts=s.points; let best=0, bestD=Infinity; for (let i=0;i<pts.length;i++){ const d=distToSeg(p, pts[i], pts[(i+1)%pts.length]); if (d<bestD){bestD=d;best=i;} } const np=[...pts]; np.splice(best+1,0,p); return { ...s, points: np }; })); };
    const [elements, setElements] = useState<{ entradas: any[]; salidas: any[]; calles: any[] }>({ entradas: [], salidas: [], calles: [] });
    const [currentLine, setCurrentLine] = useState<{ x: number; y: number }[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const mapWrapperRef = useRef<HTMLDivElement>(null);

    // State for editing vertices
    const [editingVertex, setEditingVertex] = useState<{ slotId: string; pointIndex: number } | null>(null);

    const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

    // Resize Observer for responsive map
    useEffect(() => {
        if (!containerRef.current) return;

        const updateDimensions = () => {
            if (containerRef.current) {
                const { width, height } = containerRef.current.getBoundingClientRect();
                setContainerDimensions({ width, height });
            }
        };

        const resizeObserver = new ResizeObserver(() => {
            updateDimensions();
        });

        resizeObserver.observe(containerRef.current);
        const closeCtx = () => setCtxMenu(null);
        const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { setCtxMenu(null); setEditSlotId(null); setStreetEditId(null); } };
        window.addEventListener("click", closeCtx);
        window.addEventListener("keydown", onKey);
        const el = containerRef.current;
        const onWheelNative = (e: WheelEvent) => { if (!mapWrapperRef.current) return; e.preventDefault(); setZoom((z) => Math.max(1, Math.min(6, +(z - Math.sign(e.deltaY) * 0.25).toFixed(2)))); };
        el.addEventListener("wheel", onWheelNative, { passive: false });
        (containerRef as any)._wheelCleanup = () => el.removeEventListener("wheel", onWheelNative);
        updateDimensions(); // Initial check

        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        const loadData = async () => {
            const [slotsData, unitsData, mapUrl, elemData] = await Promise.all([
                getParkingSlots(),
                getUnitsWithDetails(),
                getParkingMap(),
                getParkingElements()
            ]);

            // Migrate old rectangle format to polygon format
            const migratedSlots = (slotsData as any[]).map(slot => {
                // Only migrate if it's TRULY old format: has x/width but NO points array
                if ((!slot.points || slot.points.length === 0) && slot.x !== undefined && slot.width !== undefined && slot.width > 0) {
                    return {
                        id: slot.id,
                        points: [
                            { x: slot.x, y: slot.y },
                            { x: slot.x + slot.width, y: slot.y },
                            { x: slot.x + slot.width, y: slot.y + slot.height },
                            { x: slot.x, y: slot.y + slot.height }
                        ],
                        label: slot.label,
                        unitId: slot.unitId || null,
                        isOccupied: slot.isOccupied || false
                    };
                }
                // Already in polygon format - use as is
                return slot;
            });

            setSlots(migratedSlots);
            // @ts-ignore
            setUnits(unitsData);
            if (mapUrl) setMapImage(mapUrl);
            if (elemData) setElements(elemData as any);
        };
        loadData();
        getParkingOccupancy().then(setOccupancy).catch(() => {});
        getDevices().then((d: any) => setCameras((d || []).filter((x: any) => x.deviceType === "LPR_CAMERA"))).catch(() => {});
    }, []);

    // Ocupación en vivo por LPR (verde=adentro, rojo=afuera). Socket vía proxy /io.
    useEffect(() => {
        const s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling", "websocket"], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 8000 });
        let t: any = null;
        const refresh = () => { if (t) clearTimeout(t); t = setTimeout(() => { getParkingOccupancy().then(setOccupancy).catch(() => {}); }, 900); };
        s.on("access_event", (ev: any) => { if (ev?.accessType === "PLATE") refresh(); });
        s.on("connect", () => refresh());
        const iv = setInterval(refresh, 60000);
        const onVis = () => { if (document.visibilityState === "visible") refresh(); };
        document.addEventListener("visibilitychange", onVis);
        return () => { clearInterval(iv); if (t) clearTimeout(t); document.removeEventListener("visibilitychange", onVis); s.disconnect(); };
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            if (imageFile) {
                const formData = new FormData();
                formData.append("file", imageFile);
                await uploadParkingMap(formData);
                setImageFile(null);
            }

            // Serialize slots to JSON string to preserve nested structure
            const slotsJson = JSON.stringify(slots);

            const result = await saveParkingSlots(slotsJson);
            await saveParkingElements(JSON.stringify(elements));
            if (result.success) {
                toast.success({
                    title: "¡Configuración Guardada!",
                    description: result.message || "Las plazas se han guardado correctamente",
                    position: "bottom-center"
                });
            } else {
                toast.error({
                    title: "Error al Guardar",
                    description: result.error || "No se pudo guardar la configuración"
                });
            }
        } catch (error: any) {
            toast.error({
                title: "Error Inesperado",
                description: error.message || "Ocurrió un error al guardar"
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const url = URL.createObjectURL(file);
            setMapImage(url);
            setImageFile(file);
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!mapWrapperRef.current || !mapImage) return;
        if (tool === "pan" && e.button === 0) { panRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y, nx: pan.x, ny: pan.y }; if (mapWrapperRef.current) mapWrapperRef.current.style.transition = "none"; return; }
        if (e.button === 0) { // Left click
            const rect = mapWrapperRef.current.getBoundingClientRect();
            // Store as percentage (0-1) relative to the map wrapper
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;

            // Clamp to 0-1 range
            const clampedX = Math.max(0, Math.min(1, x));
            const clampedY = Math.max(0, Math.min(1, y));

            if (tool === "entrada" || tool === "salida") {
                setPendingElement({ kind: tool, x: clampedX, y: clampedY });
            } else if (tool === "calle") {
                setCurrentLine([...currentLine, { x: clampedX, y: clampedY }]);
            } else {
                setCurrentPoints([...currentPoints, { x: clampedX, y: clampedY }]);
            }
        }
    };

    // Drag global via window: si el mouseup cae sobre un overlay/panel, igual se libera (evita la "manito pegajosa").
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!mapWrapperRef.current) return;
            if (panRef.current) {
                const p = panRef.current; const nx = p.ox + (e.clientX - p.sx) / zoom, ny = p.oy + (e.clientY - p.sy) / zoom; p.nx = nx; p.ny = ny;
                mapWrapperRef.current.style.transform = `scale(${zoom}) translate(${nx}px, ${ny}px)`; return;
            }
            const r = mapWrapperRef.current.getBoundingClientRect();
            if (movingRef.current) { const m = movingRef.current; const dx = (e.clientX - m.sx) / r.width, dy = (e.clientY - m.sy) / r.height; setSlots(prev => prev.map(sl => sl.id === m.slotId ? { ...sl, points: m.orig.map(pt => ({ x: Math.max(0, Math.min(1, pt.x + dx)), y: Math.max(0, Math.min(1, pt.y + dy)) })) } : sl)); return; }
            if (streetVtxRef.current) { const nx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), ny = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); const sv = streetVtxRef.current; setElements(prev => ({ ...prev, calles: prev.calles.map((c: any) => c.id === sv.id ? { ...c, points: c.points.map((pp: any, i: number) => i === sv.idx ? { x: nx, y: ny } : pp) } : c) })); return; }
            if (editingVertex) { const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); setSlots(prev => prev.map(sl => sl.id === editingVertex.slotId ? { ...sl, points: sl.points.map((pp, i) => i === editingVertex.pointIndex ? { x, y } : pp) } : sl)); return; }
        };
        const onUp = () => {
            if (panRef.current) { const p = panRef.current; if (mapWrapperRef.current) mapWrapperRef.current.style.transition = ""; setPan({ x: p.nx ?? p.ox, y: p.ny ?? p.oy }); }
            panRef.current = null; movingRef.current = null; streetVtxRef.current = null; if (editingVertex) setEditingVertex(null);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    }, [zoom, editingVertex]);

    const startEditingVertex = (slotId: string, pointIndex: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingVertex({ slotId, pointIndex });
    };

    const finishPolygon = () => {
        if (currentPoints.length >= 3) {
            const newSlot: ParkingSlot = {
                id: Math.random().toString(36).substr(2, 9),
                points: currentPoints,
                label: "P-" + (slots.length + 1),
                unitId: null,
                isOccupied: false
            };
            setSlots([...slots, newSlot]);
        }
        setCurrentPoints([]);
    };

    const cancelDrawing = () => {
        setCurrentPoints([]);
    };

    const finishLine = () => {
        if (currentLine.length >= 2) { const nm = window.prompt("Nombre de la calle (opcional):", ""); setElements(prev => ({ ...prev, calles: [...prev.calles, { id: Math.random().toString(36).slice(2, 9), points: currentLine, name: nm || undefined }] })); }
        setCurrentLine([]);
    };
    const cancelLine = () => setCurrentLine([]);
    const removeElement = (kind: "entradas" | "salidas" | "calles", id: string) => setElements(prev => ({ ...prev, [kind]: (prev as any)[kind].filter((e: any) => e.id !== id) }));

    const removeSlot = (id: string) => {
        setSlots(slots.filter(s => s.id !== id));
        if (selectedSlot === id) setSelectedSlot(null);
        if (editSlotId === id) setEditSlotId(null);
    };

    const linkSlotToUnit = (slotId: string, unitId: string) => {
        setSlots(slots.map(s => s.id === slotId ? { ...s, unitId } : s));
        setShowUnitSelector(false);
        setSelectedSlot(null);
    };

    const updateSlotLabel = (slotId: string, newLabel: string) => {
        setSlots(slots.map(s => s.id === slotId ? { ...s, label: newLabel } : s));
    };

    const getPolygonPath = (points: { x: number; y: number }[]) => {
        if (!points || points.length === 0) return '';
        const { width, height } = containerDimensions;
        if (width === 0 || height === 0) return '';

        return points.map((p, i) => {
            // Check if point is percentage (<= 2.0 to be safe against small pixel values, usually safe assumption for maps > 2px)
            // Or just assume new points are %.
            // Legacy handling: if x > 1, treat as pixels.
            // But we actually want to migrate. For now, strict check:
            const px = p.x <= 2 ? p.x * width : p.x;
            const py = p.y <= 2 ? p.y * height : p.y;
            return (i === 0 ? 'M' : 'L') + ' ' + px + ' ' + py;
        }).join(' ') + ' Z';
    };

    const getPolygonCenter = (points: { x: number; y: number }[]) => {
        if (!points || points.length === 0) return { x: 0, y: 0 };
        const { width, height } = containerDimensions;

        const xs = points.map(p => p.x <= 2 ? p.x * width : p.x);
        const ys = points.map(p => p.y <= 2 ? p.y * height : p.y);

        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        return {
            x: minX + (maxX - minX) / 2,
            y: minY + (maxY - minY) / 2
        };
    };
    const filteredUnits = units.filter(u => {
        const searchLower = searchUnit.toLowerCase();
        const name = (u.name || '').toLowerCase();
        const number = (u.number || '').toLowerCase();
        return name.includes(searchLower) || number.includes(searchLower);
    });

    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { naturalWidth, naturalHeight } = e.currentTarget;
        setImageDimensions({ width: naturalWidth, height: naturalHeight });
    };

    // Calculate wrapper dimensions to fit image within container while preserving aspect ratio
    const getWrapperStyle = () => {
        // Fallback to 100% if dimensions not ready yet
        if (!containerDimensions.width || !containerDimensions.height || !imageDimensions.width) {
            return {
                width: '100%',
                height: '100%',
                position: 'relative' as const,
            };
        }

        const containerRatio = containerDimensions.width / containerDimensions.height;
        const imageRatio = imageDimensions.width / imageDimensions.height;

        let finalWidth, finalHeight;

        if (containerRatio > imageRatio) {
            // Container is wider than image -> constrain by height
            finalHeight = containerDimensions.height;
            finalWidth = finalHeight * imageRatio;
        } else {
            // Container is taller than image -> constrain by width
            finalWidth = containerDimensions.width;
            finalHeight = finalWidth / imageRatio;
        }

        return {
            width: finalWidth,
            height: finalHeight,
            position: 'relative' as const,
            transform: `scale(${zoom}) translate(${panRef.current ? (panRef.current.nx ?? pan.x) : pan.x}px, ${panRef.current ? (panRef.current.ny ?? pan.y) : pan.y}px)`,
            transformOrigin: 'center center' as const,
            transition: panRef.current ? 'none' : 'transform 0.12s ease-out',
            willChange: 'transform' as const,
        };
    };

    const TOOLS: { id: "plaza" | "entrada" | "salida" | "calle" | "pan"; icon: any; label: string; active: string }[] = [
        { id: "plaza", icon: Pentagon, label: "Dibujar plaza", active: "bg-blue-600 text-white" },
        { id: "entrada", icon: LogIn, label: "Marcar entrada", active: "bg-emerald-600 text-white" },
        { id: "salida", icon: LogOut, label: "Marcar salida", active: "bg-orange-600 text-white" },
        { id: "calle", icon: Spline, label: "Dibujar calle", active: "bg-sky-600 text-white" },
        { id: "pan", icon: Hand, label: "Mover / desplazar", active: "bg-violet-600 text-white" },
    ];

    return (
        <TooltipProvider delayDuration={150}>
        <div className="w-full h-full relative bg-background overflow-hidden animate-in fade-in duration-700 flex items-center justify-center">
            {/* Barra central de acciones (estilo /admin/mapa) */}
            {mapImage && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-card/50 backdrop-blur-2xl border border-white/10 ring-1 ring-white/5 rounded-full shadow-lg px-1.5 py-1.5">
                    {TOOLS.map((t) => (
                        <Tooltip key={t.id}><TooltipTrigger asChild>
                            <button type="button" onClick={() => { setTool(t.id); setCurrentPoints([]); setCurrentLine([]); }} className={cn("p-2 rounded-full transition-all", tool === t.id ? cn(t.active, "shadow-md ring-1 ring-white/25 scale-105") : "text-muted-foreground hover:bg-accent hover:scale-105")}><t.icon size={16} /></button>
                        </TooltipTrigger><TooltipContent>{t.label}</TooltipContent></Tooltip>
                    ))}
                    <div className="w-px h-6 bg-border mx-0.5" />
                    <Tooltip><TooltipTrigger asChild>
                        <button type="button" onClick={() => setZoom((z) => Math.max(1, +(z - 0.3).toFixed(2)))} className="p-2 rounded-full text-muted-foreground hover:bg-accent transition-colors"><ZoomOut size={16} /></button>
                    </TooltipTrigger><TooltipContent>Alejar</TooltipContent></Tooltip>
                    <span className="text-[10px] font-bold text-muted-foreground tabular-nums w-9 text-center select-none">{Math.round(zoom * 100)}%</span>
                    <Tooltip><TooltipTrigger asChild>
                        <button type="button" onClick={() => setZoom((z) => Math.min(6, +(z + 0.3).toFixed(2)))} className="p-2 rounded-full text-muted-foreground hover:bg-accent transition-colors"><ZoomIn size={16} /></button>
                    </TooltipTrigger><TooltipContent>Acercar</TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                        <button type="button" onClick={fitView} className="p-2 rounded-full text-muted-foreground hover:bg-accent transition-colors"><Maximize2 size={16} /></button>
                    </TooltipTrigger><TooltipContent>Ajustar a pantalla</TooltipContent></Tooltip>
                    <div className="w-px h-6 bg-border mx-0.5" />
                    <Tooltip><TooltipTrigger asChild>
                        <button type="button" onClick={() => { if (window.confirm("¿Quitar el plano y borrar plazas/calles/entradas dibujadas de la vista? (No se guarda hasta que uses Guardar)")) { setMapImage(null); setSlots([]); setImageDimensions({ width: 0, height: 0 }); setElements({ entradas: [], salidas: [], calles: [] }); setCurrentLine([]); setCurrentPoints([]); } }} className="p-2 rounded-full text-muted-foreground hover:bg-red-500/15 hover:text-red-400 transition-colors"><Trash2 size={16} /></button>
                    </TooltipTrigger><TooltipContent>Resetear plano</TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild>
                        <button type="button" onClick={handleSave} disabled={isSaving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50">{isSaving ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Save size={14} />} Guardar</button>
                    </TooltipTrigger><TooltipContent>Guardar cambios</TooltipContent></Tooltip>
                </div>
            )}
            {/* Floating Controls - Top Left */}
            <div className="absolute top-6 left-6 z-20 space-y-3">
                {!mapImage ? (
                    <div className="relative">
                        <input
                            type="file"
                            onChange={handleImageUpload}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            accept="image/*"
                        />
                        <Button className="bg-blue-600 hover:bg-blue-700 text-foreground font-bold px-6 h-12 rounded-xl flex items-center gap-2 shadow-lg shadow-blue-500/20 uppercase text-xs tracking-widest">
                            <Upload size={16} /> Cargar Plano
                        </Button>
                    </div>
                ) : (
                    <>
                        {currentLine.length > 0 && (
                            <div className="bg-card/90 backdrop-blur-xl border border-sky-500/30 rounded-xl p-4 shadow-lg">
                                <div className="flex items-center gap-2 mb-3"><span className="text-xs font-bold text-foreground uppercase tracking-widest">Calle ({currentLine.length} puntos)</span></div>
                                <div className="flex gap-2">
                                    <Button onClick={finishLine} disabled={currentLine.length < 2} className="bg-sky-600 hover:bg-sky-700 text-foreground h-10 px-4 rounded-lg text-xs font-bold uppercase"><CheckCircle2 size={14} className="mr-1" /> Finalizar</Button>
                                    <Button onClick={cancelLine} variant="outline" className="border-border bg-muted text-muted-foreground h-10 px-4 rounded-lg text-xs font-bold uppercase">Cancelar</Button>
                                </div>
                            </div>
                        )}

                        {currentPoints.length > 0 && (
                            <div className="bg-card/90 backdrop-blur-xl border border-blue-500/30 rounded-xl p-4 shadow-lg">
                                <div className="flex items-center gap-2 mb-3">
                                    <Pentagon size={16} className="text-blue-400" />
                                    <span className="text-xs font-bold text-foreground uppercase tracking-widest">
                                        Dibujando ({currentPoints.length} puntos)
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        onClick={finishPolygon}
                                        disabled={currentPoints.length < 3}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-foreground h-10 px-4 rounded-lg text-xs font-bold uppercase"
                                    >
                                        <CheckCircle2 size={14} className="mr-1" /> Finalizar
                                    </Button>
                                    <Button
                                        onClick={cancelDrawing}
                                        variant="outline"
                                        className="border-border bg-muted text-muted-foreground h-10 px-4 rounded-lg text-xs font-bold uppercase"
                                    >
                                        Cancelar
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Right Side Panel - Stats & List */}
            {mapImage && (
                <div className="absolute top-6 right-6 bottom-6 z-20 flex flex-col w-64 gap-4 pointer-events-none">
                    {/* Stats Card */}
                    <div className="bg-card/50 backdrop-blur-2xl border border-white/10 ring-1 ring-white/5 rounded-xl p-4 shadow-lg pointer-events-auto shrink-0">
                        <div className="flex items-center gap-2 mb-3">
                            <LayoutGrid size={16} className="text-orange-500" />
                            <span className="text-xs font-bold text-foreground uppercase tracking-widest">Estadísticas</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground font-bold">Total Plazas:</span>
                                <span className="text-foreground font-bold">{slots.length}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground font-bold">Asignadas:</span>
                                <span className="text-emerald-400 font-bold">{slots.filter(s => s.unitId).length}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground font-bold">Sin Asignar:</span>
                                <span className="text-red-400 font-bold">{slots.filter(s => !s.unitId).length}</span>
                            </div>
                        </div>
                    </div>

                    {/* Slots List */}
                    <div className={cn("bg-card/50 backdrop-blur-2xl border border-white/10 ring-1 ring-white/5 rounded-xl shadow-lg overflow-hidden flex flex-col pointer-events-auto min-h-0", listCollapsed ? "shrink-0" : "flex-1")}>
                        <button type="button" onClick={() => setListCollapsed(v => !v)} className="p-4 border-b border-white/10 bg-foreground/5 backdrop-blur-sm w-full text-left hover:bg-foreground/10 transition-colors">
                            <div className="flex items-center justify-between mb-0">
                                <h4 className="text-xs font-bold text-foreground uppercase tracking-widest flex items-center gap-2">
                                    <Square size={14} className="text-blue-400" />
                                    Lista de Plazas
                                </h4>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] bg-foreground/10 px-1.5 py-0.5 rounded text-muted-foreground font-mono">{slots.length}</span>
                                    <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", listCollapsed ? "-rotate-90" : "rotate-0")} />
                                </div>
                            </div>
                        </button>
                        {!listCollapsed && (<>

                        <div className="p-2 border-b border-white/10">
                            <div className="relative">
                                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input value={plazaSearch} onChange={(e) => setPlazaSearch(e.target.value)} placeholder="Buscar plaza…" className="w-full bg-background/60 border border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500/40" />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1 bg-muted/40">
                            {slots.filter(s => !plazaSearch || (s.label || "").toLowerCase().includes(plazaSearch.toLowerCase())).map(slot => {
                                const unit = units.find(u => u.id === slot.unitId);
                                const firstUser = unit?.users?.[0];

                                return (
                                    <button
                                        key={slot.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedSlot(slot.id);
                                        }}
                                        onMouseEnter={() => setHoveredSlot(slot.id)}
                                        onMouseLeave={() => setHoveredSlot(null)}
                                        className={cn(
                                            "w-full text-left p-2.5 rounded-lg flex items-center justify-between transition-all group border",
                                            selectedSlot === slot.id
                                                ? "bg-blue-600/20 border-blue-500/50 shadow-[0_0_15px_rgba(37,99,235,0.2)]"
                                                : (hoveredSlot === slot.id ? "bg-foreground/10 border-border" : "border-transparent hover:bg-accent hover:border-border")
                                        )}
                                    >
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            {/* User Avatar or Status Dot */}
                                            {slot.unitId && firstUser ? (
                                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-[10px] font-bold text-foreground shrink-0 shadow-lg shadow-emerald-500/20">
                                                    {firstUser.name?.charAt(0) || 'U'}
                                                </div>
                                            ) : (
                                                <div className={cn(
                                                    "w-6 h-6 rounded-full shrink-0 flex items-center justify-center",
                                                    slot.unitId ? "bg-emerald-500/20" : "bg-orange-500/20"
                                                )}>
                                                    <div className={cn(
                                                        "w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]",
                                                        slot.unitId ? "bg-emerald-500 text-emerald-500" : "bg-orange-500 text-orange-500"
                                                    )} />
                                                </div>
                                            )}
                                            <div className="flex flex-col min-w-0">
                                                <span className={cn(
                                                    "text-xs font-bold uppercase tracking-wider truncate transition-colors",
                                                    selectedSlot === slot.id ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                                                )}>
                                                    {slot.label}
                                                </span>
                                                {unit && (
                                                    <span className="text-[9px] text-muted-foreground font-bold truncate">
                                                        {unit.number} {firstUser ? `• ${firstUser.name}` : ''}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {selectedSlot === slot.id && (
                                            <div
                                                className="h-6 w-6 flex items-center justify-center rounded-md text-blue-400 hover:text-foreground hover:bg-blue-500/20 transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowUnitSelector(true);
                                                }}
                                                title="Editar"
                                            >
                                                <Pencil size={12} />
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Integrated Save Button */}
                        <div className="p-4 border-t border-white/10 bg-card/40 backdrop-blur-xl">
                            <Button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-foreground font-bold h-10 rounded-lg shadow-lg shadow-blue-500/20 uppercase tracking-widest text-[10px]"
                            >
                                <Save size={14} className="mr-2" />
                                {isSaving ? "Guardando..." : "Guardar"}
                            </Button>
                        </div>
                        </>)}
                    </div>
                </div>
            )}



            {/* Leyenda de presencia LPR */}
            {mapImage && (
                <div className="absolute bottom-4 left-4 z-20 bg-card/50 backdrop-blur-2xl border border-white/10 ring-1 ring-white/5 rounded-xl px-3 py-2 shadow-lg text-[11px] space-y-1 pointer-events-none">
                    <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(16,185,129,0.7)", border: "1px solid #34d399" }} /> Auto en casa <span className="ml-1">🚗</span></div>
                    <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(239,68,68,0.7)", border: "1px solid #ef4444" }} /> Auto afuera</div>
                    <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(16,185,129,0.35)", border: "1px solid #34d399" }} /> Asignada, sin vehículo</div>
                    <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "repeating-linear-gradient(45deg,transparent,transparent 2px,#f97316 2px,#f97316 3px)", border: "1px solid #f97316" }} /> Libre / sin asignar</div>
                </div>
            )}

            {/* Map Canvas */}
            <div
                ref={containerRef}
                className={cn("absolute inset-0 bg-transparent border-none overflow-hidden transition-all duration-300 flex items-center justify-center p-2 select-none", tool === "pan" ? (panRef.current ? "cursor-grabbing" : "cursor-grab") : "cursor-crosshair")}
                onMouseDown={handleMouseDown}
                onDragStart={(e) => e.preventDefault()}
                style={{ WebkitUserSelect: "none", userSelect: "none" }}
            >
                {mapImage ? (
                    <div ref={mapWrapperRef} style={getWrapperStyle()}>
                        <img
                            src={mapImage}
                            alt="Parking Map"
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                            className="w-full h-full object-contain grayscale opacity-50 invert select-none pointer-events-none"
                            style={{ WebkitUserDrag: "none" } as any}
                            onLoad={handleImageLoad}
                        />

                        <svg
                            className="absolute inset-0 w-full h-full pointer-events-none"
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                        >
                            <defs>
                                <pattern id="diagonalHatchOrange" patternUnits="userSpaceOnUse" width="2" height="2" patternTransform="rotate(45)">
                                    <rect width="2" height="2" fill="rgba(249, 115, 22, 0.1)" />
                                    <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="rgba(249, 115, 22, 0.8)" strokeWidth="0.5" />
                                </pattern>
                            </defs>

                            {/* Existing Polygons */}
                            {slots.filter(slot => slot.points && slot.points.length > 0).map((slot) => {
                                // Convert points to 0-100 scale for viewBox
                                const scaledPoints = slot.points.map(p => ({
                                    x: p.x <= 1 ? p.x * 100 : p.x,
                                    y: p.y <= 1 ? p.y * 100 : p.y
                                }));

                                const center = getPolygonCenter(slot.points); // Pass original 0-1 points logic or update helper
                                const textX = center.x <= 1 ? center.x * 100 : center.x;
                                const textY = center.y <= 1 ? center.y * 100 : center.y;

                                const unit = units.find(u => u.id === slot.unitId);
                                const isSelected = selectedSlot === slot.id;
                                const isHovered = hoveredSlot === slot.id;
                                const occData = occupancy[slot.id];
                                const occ = occData?.status; // "in" | "out" | "none" | undefined
                                const insidePlates = occData?.inside || [];
                                const occFill = occ === "in" ? "rgba(16, 185, 129, 0.55)" : occ === "out" ? "rgba(239, 68, 68, 0.55)" : (slot.unitId ? "rgba(16, 185, 129, 0.5)" : "url(#diagonalHatchOrange)");
                                const occStroke = occ === "in" ? "#34d399" : occ === "out" ? "#ef4444" : (slot.unitId ? "#34d399" : "#f97316");

                                return (
                                    <g
                                        key={slot.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (editSlotId === slot.id) { setSelectedSlot(slot.id); return; }
                                            setSelectedSlot(slot.id);
                                            setShowUnitSelector(true);
                                        }}
                                        onContextMenu={(e) => openCtx(e, "slot", slot.id)}
                                        onMouseEnter={(e) => { setHoveredSlot(slot.id); const r = (e.currentTarget as SVGGElement).getBoundingClientRect(); setHoverCard({ slotId: slot.id, x: r.left + r.width / 2, y: r.top }); }}
                                        onMouseLeave={() => { setHoveredSlot(null); setHoverCard(null); }}
                                        className="cursor-pointer group pointer-events-auto"
                                    >
                                                    <path
                                                        onMouseDown={(e) => { if (editSlotId !== slot.id) return; e.stopPropagation(); movingRef.current = { slotId: slot.id, sx: e.clientX, sy: e.clientY, orig: slot.points.map(p => ({ ...p })) }; setSelectedSlot(slot.id); }}
                                                        onDoubleClick={(e) => { if (editSlotId !== slot.id) return; e.stopPropagation(); addVertexAt(slot.id, e); }}
                                                        d={scaledPoints.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p.x + ' ' + p.y).join(' ') + ' Z'}
                                                        fill={occFill}
                                                        stroke={editSlotId === slot.id ? "#6366f1" : isSelected ? "#3b82f6" : occStroke}
                                                        strokeWidth={editSlotId === slot.id ? 1.2 : isSelected ? 1 : 0.5}
                                                        vectorEffect="non-scaling-stroke"
                                                        strokeLinejoin="round"
                                                        className="transition-all duration-300"
                                                        style={{
                                                            filter: isSelected ? "drop-shadow(0 0 8px rgba(59, 130, 246, 0.6))" : "drop-shadow(0 0 2px rgba(0,0,0,0.5))",
                                                            animation: (isSelected || isHovered) ? "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite" : undefined
                                                        }}
                                                    />

                                                    {/* Vértices editables: solo con "Editar polígono" del menú contextual. Doble-clic borra. */}
                                                    {editSlotId === slot.id && scaledPoints.map((point, idx) => (
                                                        <circle
                                                            key={idx}
                                                            cx={point.x}
                                                            cy={point.y}
                                                            r="0.45"
                                                            fill="#6366f1"
                                                            stroke="white"
                                                            strokeWidth="0.6"
                                                            vectorEffect="non-scaling-stroke"
                                                            className="cursor-move pointer-events-auto hover:fill-indigo-300 transition-colors"
                                                            onMouseDown={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedSlot(slot.id);
                                                                startEditingVertex(slot.id, idx, e);
                                                            }}
                                                            onDoubleClick={(e) => { e.stopPropagation(); deleteVertex(slot.id, idx); }}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    ))}

                                                    {/* Slot Label */}
                                                    <text
                                                        x={textX}
                                                        y={textY - (unit ? 2 : 0)}
                                                        fontSize="3"
                                                        className="font-bold fill-white pointer-events-none select-none"
                                                        textAnchor="middle"
                                                        dominantBaseline="middle"
                                                        style={{ textShadow: "0px 1px 3px rgba(0,0,0,0.9)" }}
                                                    >
                                                        {slot.label}
                                                    </text>

                                                    {/* Unit/User Info */}
                                                    {unit && (
                                                        <>
                                                            <text
                                                                x={textX}
                                                                y={textY + 2}
                                                                fontSize="2"
                                                                className="font-bold fill-emerald-300 pointer-events-none select-none"
                                                                textAnchor="middle"
                                                                dominantBaseline="middle"
                                                                style={{ textShadow: "0px 1px 2px rgba(0,0,0,0.9)" }}
                                                            >
                                                                {unit.number || unit.name}
                                                            </text>
                                                            {unit.users?.[0] && (
                                                                <text
                                                                    x={textX}
                                                                    y={textY + 5}
                                                                    fontSize="1.8"
                                                                    className="font-medium fill-white/70 pointer-events-none select-none"
                                                                    textAnchor="middle"
                                                                    dominantBaseline="middle"
                                                                    style={{ textShadow: "0px 1px 2px rgba(0,0,0,0.9)" }}
                                                                >
                                                                    {unit.users[0].name}
                                                                </text>
                                                            )}
                                                        </>
                                                    )}

                                                    {/* Presencia dinámica: un auto por casa + matrículas apiladas */}
                                                    {occ === "in" && (
                                                        <g className="pointer-events-none">
                                                            {insidePlates.slice().reverse().map((pl, pi) => (
                                                                <text key={pl + pi} x={textX} y={textY - 6.5 - pi * 2.6} fontSize="2" textAnchor="middle" dominantBaseline="middle"
                                                                    className="font-bold fill-white select-none" style={{ textShadow: "0 0 2px #000, 0 0 3px #000, 0 1px 2px #000" }}>
                                                                    {pl}
                                                                </text>
                                                            ))}
                                                            <text x={textX} y={textY - 3} fontSize="4.5" textAnchor="middle" dominantBaseline="middle" className="select-none"
                                                                style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))" }}>
                                                                🚗
                                                            </text>
                                                        </g>
                                                    )}
                                                </g>
                                );
                            })}

                            {/* Calles — trazo profesional (casing + vía), editables por menú contextual */}
                            {elements.calles.map((c: any) => {
                                const d = c.points.map((p: any, i: number) => { const x = p.x <= 1 ? p.x * 100 : p.x; const y = p.y <= 1 ? p.y * 100 : p.y; return (i === 0 ? 'M' : 'L') + ' ' + x + ' ' + y; }).join(' ');
                                const editing = streetEditId === c.id;
                                return (
                                    <g key={c.id}>
                                        <path d={d} fill="none" stroke="#0b1220" strokeOpacity={0.6} strokeWidth={editing ? 8 : 6.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }} />
                                        <path d={d} fill="none" stroke={editing ? "#6366f1" : "#38bdf8"} strokeWidth={editing ? 4 : 3.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"
                                            onContextMenu={(e) => openCtx(e, "calle", c.id)}
                                            className="pointer-events-auto cursor-pointer transition-colors" style={{ pointerEvents: "stroke" as any }} />
                                        {editing && c.points.map((p: any, idx: number) => { const x = p.x <= 1 ? p.x * 100 : p.x; const y = p.y <= 1 ? p.y * 100 : p.y; return (
                                            <circle key={idx} cx={x} cy={y} r="0.5" fill="#6366f1" stroke="white" strokeWidth="0.6" vectorEffect="non-scaling-stroke"
                                                className="cursor-move pointer-events-auto hover:fill-indigo-300 transition-colors"
                                                onMouseDown={(e) => { e.stopPropagation(); streetVtxRef.current = { id: c.id, idx }; }}
                                                onDoubleClick={(e) => { e.stopPropagation(); setElements(prev => ({ ...prev, calles: prev.calles.map((cc: any) => cc.id === c.id ? (cc.points.length > 2 ? { ...cc, points: cc.points.filter((_: any, i: number) => i !== idx) } : cc) : cc) })); }} />
                                        ); })}
                                        {c.name && (() => { const mid = c.points[Math.floor(c.points.length / 2)]; const mx = mid.x <= 1 ? mid.x * 100 : mid.x; const my = mid.y <= 1 ? mid.y * 100 : mid.y; return (<text x={mx} y={my - 1.4} fontSize="2.2" textAnchor="middle" className="font-bold fill-white select-none pointer-events-none" style={{ textShadow: "0 0 2px #000, 0 1px 2px #000" }}>{c.name}</text>); })()}
                                    </g>
                                );
                            })}
                            {currentLine.length > 0 && (
                                <>
                                    <path d={currentLine.map((p, i) => { const x = p.x <= 1 ? p.x * 100 : p.x; const y = p.y <= 1 ? p.y * 100 : p.y; return (i === 0 ? 'M' : 'L') + ' ' + x + ' ' + y; }).join(' ')} fill="none" stroke="#0b1220" strokeOpacity={0.5} strokeWidth={6.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }} />
                                    <path d={currentLine.map((p, i) => { const x = p.x <= 1 ? p.x * 100 : p.x; const y = p.y <= 1 ? p.y * 100 : p.y; return (i === 0 ? 'M' : 'L') + ' ' + x + ' ' + y; }).join(' ')} fill="none" stroke="#38bdf8" strokeWidth={3.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4,3" style={{ pointerEvents: "none" }} />
                                    {currentLine.map((p, i) => { const x = p.x <= 1 ? p.x * 100 : p.x; const y = p.y <= 1 ? p.y * 100 : p.y; return <circle key={i} cx={x} cy={y} r="0.5" fill="#7dd3fc" stroke="white" strokeWidth="0.5" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />; })}
                                </>
                            )}

                            {/* Polígono en dibujo */}
                            {currentPoints.length > 0 && (
                                <>
                                    <path
                                        d={currentPoints.map((p, i) => { const x = p.x <= 1 ? p.x * 100 : p.x; const y = p.y <= 1 ? p.y * 100 : p.y; return (i === 0 ? 'M' : 'L') + ' ' + x + ' ' + y; }).join(' ') + (isDrawing ? "" : " Z")}
                                        fill="rgba(59,130,246,0.18)" stroke="#3b82f6" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeDasharray="4,3" style={{ pointerEvents: "none" }} />
                                    {currentPoints.map((p, i) => { const x = p.x <= 1 ? p.x * 100 : p.x; const y = p.y <= 1 ? p.y * 100 : p.y; return <circle key={i} cx={x} cy={y} r="0.4" fill="#3b82f6" stroke="white" strokeWidth="0.5" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />; })}
                                </>
                            )}
                        </svg>
                        {[...elements.entradas.map((e: any) => ({ ...e, kind: "entradas", color: "emerald" })), ...elements.salidas.map((e: any) => ({ ...e, kind: "salidas", color: "orange" }))].map((m: any) => (
                            <div key={m.id} style={{ left: `${m.x <= 1 ? m.x * 100 : m.x}%`, top: `${m.y <= 1 ? m.y * 100 : m.y}%` }} className="absolute -translate-x-1/2 -translate-y-1/2 z-30 group"
                                onContextMenu={(e) => openCtx(e, m.kind === "entradas" ? "entrada" : "salida", m.id)}
                                title={m.cameraName ? `${m.kind === "entradas" ? "Entrada" : "Salida"} · ${m.cameraName}` : undefined}>
                                <div className={cn("w-6 h-6 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-[9px] font-bold text-white", m.color === "emerald" ? "bg-emerald-500" : "bg-orange-500")}>{m.label}</div>
                                {m.cameraName && (<div className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 whitespace-nowrap px-1.5 py-0.5 rounded bg-black/70 text-white text-[7px] font-bold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-center gap-0.5"><Video size={7} /> {m.cameraName}</div>)}
                                <button type="button" onClick={(e) => { e.stopPropagation(); removeElement(m.kind, m.id); }} onMouseDown={(e) => e.stopPropagation()} className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-600 text-white text-[8px] opacity-0 group-hover:opacity-100 flex items-center justify-center leading-none">&times;</button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-6">
                        <div className="w-24 h-24 bg-card rounded-lg border border-border flex items-center justify-center">
                            <Map size={40} className="text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground font-bold uppercase tracking-widest text-sm">
                            Carga un plano para comenzar
                        </p>
                    </div>
                )}
            </div>

            {/* Unit Selector Modal - Enhanced */}
            {showUnitSelector && selectedSlot && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="bg-card/70 backdrop-blur-2xl border border-white/10 ring-1 ring-white/5 rounded-2xl w-full max-w-lg shadow-2xl shadow-black/40 animate-in zoom-in-95 duration-300 overflow-hidden">
                        {/* Header with Gradient */}
                        <div className="relative p-6 border-b border-white/10 bg-gradient-to-br from-blue-500/10 via-transparent to-indigo-500/10 overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-16 -mt-16" />
                            <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -ml-16 -mb-16" />

                            <div className="relative flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg border border-blue-500/30 shadow-lg shadow-blue-500/10">
                                        <Home size={24} className="text-blue-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-neutral-300 uppercase tracking-tight">
                                            Gestionar Plaza
                                        </h3>
                                        <p className="text-xs text-muted-foreground font-bold mt-1 flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                            Plaza: {slots.find(s => s.id === selectedSlot)?.label}
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                        setShowUnitSelector(false);
                                        setSelectedSlot(null);
                                    }}
                                    className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-xl transition-all"
                                >
                                    <X size={20} />
                                </Button>
                            </div>

                            {/* Controls */}
                            <div className="mt-6 space-y-4">
                                {/* Name Input */}
                                <div>
                                    <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1.5 block">Identificador</label>
                                    <input
                                        type="text"
                                        value={slots.find(s => s.id === selectedSlot)?.label || ''}
                                        onChange={(e) => updateSlotLabel(selectedSlot!, e.target.value)}
                                        className="w-full h-10 px-4 bg-background/40 border border-white/10 rounded-xl text-sm text-foreground focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all font-bold uppercase tracking-widest"
                                    />
                                </div>

                                {/* Current Assignment - Show if assigned */}
                                {slots.find(s => s.id === selectedSlot)?.unitId && (
                                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                                                    <Home size={16} className="text-emerald-400" />
                                                </div>
                                                <div>
                                                    <p className="text-xs text-emerald-300 font-bold">Asignado a:</p>
                                                    <p className="text-sm text-foreground font-bold">
                                                        {units.find(u => u.id === slots.find(s => s.id === selectedSlot)?.unitId)?.number ||
                                                            units.find(u => u.id === slots.find(s => s.id === selectedSlot)?.unitId)?.name}
                                                    </p>
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setSlots(slots.map(s =>
                                                        s.id === selectedSlot ? { ...s, unitId: null } : s
                                                    ));
                                                }}
                                                className="text-red-400 hover:text-red-300 hover:bg-red-500/20 text-xs font-bold"
                                            >
                                                <Trash2 size={14} className="mr-1" />
                                                Desasignar
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {/* Search Bar */}
                                <div>
                                    <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1.5 block">
                                        {slots.find(s => s.id === selectedSlot)?.unitId ? 'Cambiar Unidad / Lote' : 'Asignar Unidad / Lote'}
                                    </label>
                                    <div className="relative">
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <input
                                            type="text"
                                            placeholder="Buscar por número o nombre..."
                                            value={searchUnit}
                                            onChange={(e) => setSearchUnit(e.target.value)}
                                            className="w-full h-10 pl-10 pr-4 bg-background/40 border border-white/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                                            autoFocus
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Units List with Scroll */}
                        <div className="p-4 max-h-[400px] overflow-y-auto custom-scrollbar space-y-2">
                            {filteredUnits.length === 0 ? (
                                <div className="py-16 text-center">
                                    <div className="w-16 h-16 mx-auto mb-4 bg-muted/50 rounded-lg flex items-center justify-center">
                                        <Search size={24} className="text-muted-foreground" />
                                    </div>
                                    <p className="text-muted-foreground text-sm font-bold">No se encontraron unidades</p>
                                    <p className="text-muted-foreground text-xs mt-1">Intenta con otro término de búsqueda</p>
                                </div>
                            ) : (
                                filteredUnits.map((unit: any, index) => {
                                    const plates = unit.users?.flatMap((u: any) =>
                                        u.credentials?.map((c: any) => c.value) || []
                                    ) || [];
                                    const userCount = unit.users?.length || 0;

                                    return (
                                        <button
                                            key={unit.id}
                                            onClick={() => linkSlotToUnit(selectedSlot, unit.id)}
                                            className="w-full p-4 bg-white/[0.03] hover:bg-blue-500/10 border border-white/10 hover:border-blue-500/40 rounded-xl text-left transition-all group relative overflow-hidden animate-in slide-in-from-bottom-2 duration-300"
                                            style={{ animationDelay: (index * 30) + "ms" }}
                                        >
                                            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 to-purple-500/0 group-hover:from-blue-500/5 group-hover:to-purple-500/5 transition-all duration-500" />
                                            <div className="relative space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg flex items-center justify-center border border-blue-500/20 group-hover:scale-110 transition-transform">
                                                            <Home size={16} className="text-blue-400" />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-bold text-foreground group-hover:text-blue-300 transition-colors">{unit.number || unit.name}</p>
                                                            <p className="text-xs text-muted-foreground font-bold mt-0.5">{unit.name}</p>
                                                        </div>
                                                    </div>
                                                    <CheckCircle2 size={18} className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-all scale-0 group-hover:scale-100" />
                                                </div>

                                                {/* Users and Plates Info */}
                                                {(userCount > 0 || plates.length > 0) && (
                                                    <div className="pl-13 space-y-1.5 pt-2 border-t border-border">
                                                        {userCount > 0 && (
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <UserIcon size={12} className="text-muted-foreground" />
                                                                <span className="text-muted-foreground font-bold">
                                                                    {userCount} {userCount === 1 ? 'residente' : 'residentes'}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {plates.length > 0 && (
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <Car size={12} className="text-muted-foreground" />
                                                                <div className="flex flex-wrap gap-1">
                                                                    {plates.slice(0, 3).map((plate: string, i: number) => (
                                                                        <span key={i} className="px-1.5 py-0.5 bg-muted/50 rounded text-[10px] font-mono text-muted-foreground">
                                                                            {plate}
                                                                        </span>
                                                                    ))}
                                                                    {plates.length > 3 && (
                                                                        <span className="text-muted-foreground text-[10px] font-bold">
                                                                            +{plates.length - 3}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>

                        {/* Footer Actions */}
                        <div className="p-4 border-t border-white/10 bg-black/20 backdrop-blur-xl flex gap-3">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    if (selectedSlot) {
                                        linkSlotToUnit(selectedSlot, '');
                                    }
                                }}
                                className="flex-1 border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground h-11 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                            >
                                <XCircle size={16} className="mr-2" />
                                Desasignar
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => removeSlot(selectedSlot)}
                                className="border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/50 h-11 px-6 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                            >
                                <Trash2 size={16} className="mr-2" />
                                Eliminar Plaza
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: linear-gradient(to bottom, #3b82f6, #8b5cf6);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: linear-gradient(to bottom, #2563eb, #7c3aed);
                }
            `}</style>

            {/* Selector de cámara para entrada/salida */}
            {pendingElement && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={() => setPendingElement(null)}>
                    <div className="bg-card/70 backdrop-blur-2xl border border-white/10 ring-1 ring-white/5 rounded-2xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b border-white/10 flex items-center gap-2.5">
                            {pendingElement.kind === "entrada" ? <LogIn size={18} className="text-emerald-400" /> : <LogOut size={18} className="text-orange-400" />}
                            <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">¿Qué cámara es esta {pendingElement.kind}?</h3>
                        </div>
                        <div className="p-2 max-h-[50vh] overflow-y-auto custom-scrollbar space-y-1">
                            {cameras.length === 0 ? (
                                <div className="p-6 text-center text-xs text-muted-foreground font-bold">No hay cámaras LPR registradas</div>
                            ) : cameras.map((cam) => (
                                <button key={cam.id} type="button" onClick={() => addPendingElement(cam)} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-white/10 flex items-center gap-3 transition-colors group">
                                    <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0"><Video size={15} className="text-blue-400" /></div>
                                    <div className="min-w-0"><p className="text-sm font-bold text-foreground truncate group-hover:text-blue-300 transition-colors">{cam.name}</p><p className="text-[10px] text-muted-foreground font-mono truncate">{cam.ipAddress || cam.direction || ""}</p></div>
                                </button>
                            ))}
                        </div>
                        <div className="p-3 border-t border-white/10 flex justify-end gap-2">
                            <button type="button" onClick={() => addPendingElement(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-muted-foreground hover:bg-white/10 transition-colors">Sin cámara</button>
                            <button type="button" onClick={() => setPendingElement(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-muted-foreground hover:bg-white/10 transition-colors">Cancelar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hover card con datos de la unidad */}
            {hoverCard && !ctxMenu && !pendingElement && (() => {
                const sl = slots.find(x => x.id === hoverCard.slotId); if (!sl) return null;
                const u = units.find((x: any) => x.id === sl.unitId);
                const occd = occupancy[hoverCard.slotId];
                const inside = occd?.inside || []; const all = occd?.all || [];
                const statusLabel = occd?.status === "in" ? "Auto en casa" : occd?.status === "out" ? "Auto afuera" : (sl.unitId ? "Asignada" : "Libre");
                const statusColor = occd?.status === "in" ? "text-emerald-400" : occd?.status === "out" ? "text-red-400" : "text-muted-foreground";
                return (
                    <div className="fixed z-[3500] pointer-events-none -translate-x-1/2 -translate-y-full" style={{ left: hoverCard.x, top: hoverCard.y - 10 }}>
                        <div className="w-60 bg-card/80 backdrop-blur-2xl border border-white/10 ring-1 ring-white/5 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2">
                                <span className="text-sm font-bold text-foreground uppercase tracking-wider">{sl.label}</span>
                                <span className={cn("text-[10px] font-bold uppercase tracking-widest flex items-center gap-1", statusColor)}>{occd?.status === "in" && <Car size={11} />}{statusLabel}</span>
                            </div>
                            <div className="p-3 space-y-2">
                                {u ? (<>
                                    <div className="flex items-center gap-2"><Home size={13} className="text-blue-400" /><span className="text-xs font-bold text-foreground">{u.number || u.name}</span></div>
                                    {u.users?.length ? (
                                        <div className="space-y-1">
                                            {u.users.slice(0, 3).map((r: any, i: number) => (<div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground"><div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px] font-bold text-foreground">{(r.name || "?").charAt(0)}</div><span className="truncate">{r.name}</span></div>))}
                                            {u.users.length > 3 && <p className="text-[10px] text-muted-foreground pl-6">+{u.users.length - 3} más</p>}
                                        </div>
                                    ) : <p className="text-[11px] text-muted-foreground italic">Sin residentes</p>}
                                    {all.length > 0 && (
                                        <div className="flex flex-wrap gap-1 pt-2 border-t border-white/10">
                                            {all.map((p: string, i: number) => (<span key={i} className={cn("px-1.5 py-0.5 rounded text-[9px] font-mono", inside.includes(p) ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-muted-foreground")}>{p}</span>))}
                                        </div>
                                    )}
                                </>) : <p className="text-[11px] text-muted-foreground italic flex items-center gap-2"><Info size={12} /> Plaza sin asignar</p>}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Menú contextual de elementos */}
            {ctxMenu && (
                <div className="fixed z-[4000] min-w-[180px] bg-card/70 backdrop-blur-2xl border border-white/15 ring-1 ring-white/5 rounded-xl shadow-2xl py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100"
                    style={{ left: Math.min(ctxMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200), top: ctxMenu.y }}
                    onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
                    {ctxMenu.type === "slot" && (<>
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{slots.find(s => s.id === ctxMenu.id)?.label || "Plaza"}</div>
                        <button onClick={() => { setEditSlotId(ctxMenu.id); setSelectedSlot(ctxMenu.id); setCtxMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-white/10 flex items-center gap-2 text-foreground"><Edit3 size={13} className="text-indigo-400" /> Editar polígono</button>
                        <button onClick={() => { setSelectedSlot(ctxMenu.id); setShowUnitSelector(true); setCtxMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-white/10 flex items-center gap-2 text-foreground"><UserIcon size={13} className="text-emerald-400" /> Asignar unidad</button>
                        <div className="h-px bg-white/10 my-1" />
                        <button onClick={() => { removeSlot(ctxMenu.id); setCtxMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-red-500/15 flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar plaza</button>
                    </>)}
                    {ctxMenu.type === "calle" && (<>
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{elements.calles.find((c: any) => c.id === ctxMenu.id)?.name || "Calle"}</div>
                        <button onClick={() => { renameStreet(ctxMenu.id); setCtxMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-white/10 flex items-center gap-2 text-foreground"><Pencil size={13} className="text-sky-400" /> Renombrar</button>
                        <button onClick={() => { setStreetEditId(streetEditId === ctxMenu.id ? null : ctxMenu.id); setCtxMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-white/10 flex items-center gap-2 text-foreground"><Edit3 size={13} className="text-indigo-400" /> {streetEditId === ctxMenu.id ? "Terminar edición" : "Editar puntos"}</button>
                        <div className="h-px bg-white/10 my-1" />
                        <button onClick={() => { removeElement("calles", ctxMenu.id); setCtxMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-red-500/15 flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar calle</button>
                    </>)}
                    {(ctxMenu.type === "entrada" || ctxMenu.type === "salida") && (<>
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{ctxMenu.type === "entrada" ? "Entrada" : "Salida"}</div>
                        <button onClick={() => { renameElement(ctxMenu.type === "entrada" ? "entradas" : "salidas", ctxMenu.id); setCtxMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-white/10 flex items-center gap-2 text-foreground"><Pencil size={13} className="text-sky-400" /> Renombrar</button>
                        <div className="h-px bg-white/10 my-1" />
                        <button onClick={() => { removeElement(ctxMenu.type === "entrada" ? "entradas" : "salidas", ctxMenu.id); setCtxMenu(null); }} className="w-full text-left px-3 py-2 hover:bg-red-500/15 flex items-center gap-2 text-red-400"><Trash2 size={13} /> Borrar</button>
                    </>)}
                </div>
            )}
        </div>
        </TooltipProvider>
    );
}
