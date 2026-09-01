"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Car, MapPin, RefreshCw, Loader2, Maximize2, Minus, Plus, Search, X } from "lucide-react";
import { io } from "socket.io-client";
import { getParkingSlots, getParkingMap, getParkingElements, getParkingOccupancy, type SlotOccupancy } from "@/app/actions/plazas";

interface ParkingSlot {
    id: string;
    points: { x: number; y: number }[];
    label: string;
    unitId: string | null;
    isOccupied: boolean;
}

const norm = (s: string) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export default function GuardParkingView() {
    const [mapImage, setMapImage] = useState<string | null>(null);
    const [slots, setSlots] = useState<ParkingSlot[]>([]);
    const [elements, setElements] = useState<{ entradas: any[]; salidas: any[]; calles: any[] }>({ entradas: [], salidas: [], calles: [] });
    const [occupancy, setOccupancy] = useState<Record<string, SlotOccupancy>>({});
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [search, setSearch] = useState("");
    const [isPortrait, setIsPortrait] = useState(false);

    // Orientación: el plano se ve SIEMPRE horizontal; si la tablet está vertical, se rota.
    useEffect(() => {
        const check = () => setIsPortrait(window.innerHeight > window.innerWidth);
        check();
        window.addEventListener("resize", check);
        window.addEventListener("orientationchange", check);
        return () => { window.removeEventListener("resize", check); window.removeEventListener("orientationchange", check); };
    }, []);

    // Carga inicial
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [img, sl, el] = await Promise.all([getParkingMap(), getParkingSlots(), getParkingElements()]);
                if (!alive) return;
                setMapImage(img);
                setSlots(sl as ParkingSlot[]);
                setElements(el);
            } catch { }
            try { const occ = await getParkingOccupancy(); if (alive) setOccupancy(occ); } catch { }
            if (alive) setLoading(false);
        })();
        return () => { alive = false; };
    }, []);

    const refreshOccupancy = useCallback(async () => {
        setRefreshing(true);
        try { const occ = await getParkingOccupancy(); setOccupancy(occ); } catch { }
        setRefreshing(false);
    }, []);

    useEffect(() => {
        const timer = setInterval(refreshOccupancy, 8000);
        let socket: any;
        try {
            socket = io(window.location.origin, { path: "/io/socket.io", transports: ["polling", "websocket"], reconnection: true, reconnectionAttempts: Infinity });
            let deb: any;
            const onEv = () => { clearTimeout(deb); deb = setTimeout(refreshOccupancy, 900); };
            socket.on("access_event", onEv);
        } catch { }
        return () => { clearInterval(timer); try { socket?.disconnect(); } catch { } };
    }, [refreshOccupancy]);

    const stats = useMemo(() => {
        let inside = 0, out = 0, assigned = 0;
        for (const s of slots) {
            const o = occupancy[s.id];
            if (o?.status === "in") inside++;
            else if (o?.status === "out") out++;
            if (s.unitId) assigned++;
        }
        return { total: slots.length, inside, out, assigned };
    }, [slots, occupancy]);

    // Búsqueda de plazas: resalta coincidencias y las selecciona
    const q = norm(search);
    const matchIds = useMemo(() => {
        if (!q) return null;
        return new Set(slots.filter(s => norm(s.label).includes(q)).map(s => s.id));
    }, [q, slots]);

    useEffect(() => {
        if (matchIds && matchIds.size > 0) {
            const first = slots.find(s => matchIds.has(s.id));
            if (first) setSelected(first.id);
        }
    }, [matchIds, slots]);

    const selectedSlot = slots.find(s => s.id === selected);
    const selectedOcc = selected ? occupancy[selected] : undefined;

    // Full-bleed: el plano ocupa TODO el fondo. Si la tablet está vertical, se rota para verse horizontal.
    const blockStyle: React.CSSProperties = isPortrait
        ? { position: "absolute", top: "50%", left: "50%", width: "100vh", height: "100vw", transform: `translate(-50%, -50%) rotate(90deg) scale(${zoom})`, transformOrigin: "center", transition: "transform 0.25s ease" }
        : { position: "absolute", inset: 0, width: "100%", height: "100%", transform: `scale(${zoom})`, transformOrigin: "center", transition: "transform 0.25s ease" };

    return (
        <div className="h-full w-full relative bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden">
            {/* Header glass */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[min(94%,760px)]">
                <div className="rounded-2xl bg-white/60 backdrop-blur-2xl border border-white/70 shadow-[0_8px_32px_rgba(0,0,0,0.12)] px-4 py-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#B20D30] flex items-center justify-center shrink-0 shadow-lg shadow-[#B20D30]/30">
                        <Car size={20} className="text-white" />
                    </div>
                    <div className="min-w-0 hidden md:block">
                        <h2 className="text-sm font-black uppercase tracking-tight text-black leading-none truncate">Plazas de Parking</h2>
                        <p className="text-[9px] text-[#B20D30] font-bold uppercase tracking-[0.25em] mt-1">Ocupación en tiempo real</p>
                    </div>
                    {/* Buscador de plazas */}
                    <div className="flex-1 min-w-0 relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar plaza..."
                            className="w-full h-9 pl-9 pr-8 rounded-xl bg-white/70 border border-black/10 text-sm font-bold text-black placeholder:text-black/30 placeholder:font-semibold outline-none focus:border-[#B20D30]/40"
                        />
                        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/5 flex items-center justify-center text-black/40 active:scale-90"><X size={13} /></button>}
                    </div>
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                        <div className="px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                            <p className="text-base font-black text-emerald-600 leading-none">{stats.inside}</p>
                            <p className="text-[7px] font-bold uppercase text-emerald-600/70 tracking-widest mt-0.5">Adentro</p>
                        </div>
                        <div className="px-2.5 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                            <p className="text-base font-black text-red-600 leading-none">{stats.out}</p>
                            <p className="text-[7px] font-bold uppercase text-red-600/70 tracking-widest mt-0.5">Afuera</p>
                        </div>
                    </div>
                    <button onClick={() => { refreshOccupancy(); }} className="w-9 h-9 rounded-xl bg-white/70 border border-black/5 flex items-center justify-center text-black/50 hover:text-[#B20D30] active:scale-90 transition shrink-0">
                        <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
                    </button>
                </div>
                {matchIds && (
                    <div className="mt-2 mx-auto w-fit px-3 py-1 rounded-full bg-white/60 backdrop-blur-xl border border-white/70 text-[10px] font-bold uppercase tracking-wider text-black/60">
                        {matchIds.size} {matchIds.size === 1 ? "plaza encontrada" : "plazas encontradas"}
                    </div>
                )}
            </div>

            {/* Zoom controls glass */}
            <div className="absolute right-3 bottom-28 z-30 flex flex-col gap-2">
                <button onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} className="w-11 h-11 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/70 shadow-lg flex items-center justify-center text-black/60 active:scale-90 transition"><Plus size={18} /></button>
                <button onClick={() => setZoom(z => Math.max(1, +(z - 0.25).toFixed(2)))} className="w-11 h-11 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/70 shadow-lg flex items-center justify-center text-black/60 active:scale-90 transition"><Minus size={18} /></button>
                <button onClick={() => setZoom(1)} className="w-11 h-11 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/70 shadow-lg flex items-center justify-center text-black/60 active:scale-90 transition"><Maximize2 size={16} /></button>
            </div>

            {/* Legend glass */}
            <div className="absolute left-3 bottom-28 z-30">
                <div className="rounded-2xl bg-white/55 backdrop-blur-xl border border-white/70 shadow-lg px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-[4px] bg-emerald-500/70 border border-emerald-400" /><span className="text-[9px] font-bold text-black/60 uppercase tracking-wider">Auto adentro</span></div>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-[4px] bg-red-500/70 border border-red-400" /><span className="text-[9px] font-bold text-black/60 uppercase tracking-wider">Afuera</span></div>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-[4px] bg-orange-400/40 border border-orange-400" /><span className="text-[9px] font-bold text-black/60 uppercase tracking-wider">Sin asignar</span></div>
                </div>
            </div>

            {/* Map canvas — full bleed */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center gap-5 opacity-30"><Loader2 className="animate-spin" size={54} /><p className="text-base font-bold uppercase tracking-[0.4em]">Cargando plano...</p></div>
                ) : !mapImage ? (
                    <div className="flex flex-col items-center gap-5 opacity-30 text-center px-8"><MapPin size={70} /><p className="text-base font-bold uppercase tracking-[0.3em]">Plano de plazas no configurado</p><p className="text-xs font-semibold text-black/40 normal-case tracking-normal">Cargalo desde /admin/plazas</p></div>
                ) : (
                    <div style={blockStyle}>
                        {/* Fondo en blanco y negro, ocupa todo */}
                        <img src={mapImage} alt="Plano de plazas" className="block w-full h-full object-fill select-none grayscale contrast-[1.05]" draggable={false} />
                        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <defs>
                                <pattern id="guardHatch" patternUnits="userSpaceOnUse" width="2" height="2" patternTransform="rotate(45)">
                                    <rect width="2" height="2" fill="rgba(249,115,22,0.15)" />
                                    <line x1="0" y1="0" x2="0" y2="2" stroke="rgba(249,115,22,0.7)" strokeWidth="0.5" />
                                </pattern>
                            </defs>
                            {/* Calles */}
                            {elements.calles?.map((cl: any, i: number) => {
                                const pts = (cl.points || []).map((p: any) => `${p.x <= 1 ? p.x * 100 : p.x},${p.y <= 1 ? p.y * 100 : p.y}`).join(" ");
                                return <polyline key={`c${i}`} points={pts} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.6" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />;
                            })}
                            {/* Plazas (solo polígonos de color, sin texto) */}
                            {slots.map((slot) => {
                                const sp = slot.points.map(p => ({ x: p.x <= 1 ? p.x * 100 : p.x, y: p.y <= 1 ? p.y * 100 : p.y }));
                                const occ = occupancy[slot.id]?.status;
                                const fill = occ === "in" ? "rgba(16,185,129,0.6)" : occ === "out" ? "rgba(239,68,68,0.6)" : (slot.unitId ? "rgba(16,185,129,0.45)" : "url(#guardHatch)");
                                const stroke = occ === "in" ? "#34d399" : occ === "out" ? "#ef4444" : (slot.unitId ? "#34d399" : "#f97316");
                                const isSel = selected === slot.id;
                                const isMatch = matchIds ? matchIds.has(slot.id) : true;
                                return (
                                    <g key={slot.id} onClick={(e) => { e.stopPropagation(); setSelected(isSel ? null : slot.id); }} className="cursor-pointer" style={{ opacity: isMatch ? 1 : 0.15, transition: "opacity 0.25s ease" }}>
                                        <path
                                            d={sp.map((p, i) => (i === 0 ? "M" : "L") + " " + p.x + " " + p.y).join(" ") + " Z"}
                                            fill={fill}
                                            stroke={isSel ? "#3b82f6" : stroke}
                                            strokeWidth={isSel ? 1.3 : (matchIds && isMatch ? 1.1 : 0.5)}
                                            vectorEffect="non-scaling-stroke"
                                            strokeLinejoin="round"
                                            style={{ filter: isSel ? "drop-shadow(0 0 6px rgba(59,130,246,0.7))" : (matchIds && isMatch ? "drop-shadow(0 0 5px rgba(59,130,246,0.5))" : "drop-shadow(0 0 2px rgba(0,0,0,0.5))"), animation: (isSel || (matchIds && isMatch)) ? "pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite" : undefined }}
                                        />
                                    </g>
                                );
                            })}
                        </svg>
                    </div>
                )}
            </div>

            {/* Selected slot glass card */}
            <AnimatePresence>
                {selectedSlot && (
                    <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40 w-[min(92%,420px)]">
                        <div className="rounded-2xl bg-white/70 backdrop-blur-2xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.18)] p-4 flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${selectedOcc?.status === "in" ? "bg-emerald-500" : selectedOcc?.status === "out" ? "bg-red-500" : "bg-orange-400"}`}>
                                <Car size={22} className="text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg font-black text-black leading-none">{selectedSlot.label}</span>
                                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${selectedOcc?.status === "in" ? "bg-emerald-500/15 text-emerald-600" : selectedOcc?.status === "out" ? "bg-red-500/15 text-red-600" : "bg-orange-400/15 text-orange-600"}`}>
                                        {selectedOcc?.status === "in" ? "Ocupada" : selectedOcc?.status === "out" ? "Libre / afuera" : "Sin asignar"}
                                    </span>
                                </div>
                                {selectedOcc?.all?.length ? (
                                    <p className="text-[11px] font-bold text-black/50 mt-1 truncate">Matrículas: <span className="font-mono">{selectedOcc.all.join(", ")}</span></p>
                                ) : (
                                    <p className="text-[11px] font-semibold text-black/30 mt-1">Sin vehículo asignado</p>
                                )}
                            </div>
                            <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-black/40 active:scale-90 transition shrink-0"><X size={16} /></button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
