"use client";

// Capa de "Flujo en vivo" para el mapa del barrio: columnas de ENTRADAS/SALIDAS
// (overlay glass colapsable) + autitos animados recorriendo la red de calles.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { LogIn, LogOut, ChevronLeft, ChevronRight, Car } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconoCacheado } from "@/lib/iconos-leaflet";
import { buildStreetGraph, attachPoint, route, walkInward, pathLengthM, pointAlong, type Graph, type LL } from "@/lib/street-graph";
import { getAccessEvents } from "@/app/actions/history";

/**
 * El vidrio de las columnas de flujo.
 *
 * Estaba escrito con colores fijos — #0a0d12 de fondo, blancos para el texto y el filo — y
 * eso lo ataba al tema oscuro: en tema claro las columnas quedaban como dos rectángulos
 * negros flotando sobre un mapa claro, con el texto de la aplicación adentro. Ahora usa
 * los tokens del proyecto, que ya saben cambiar solos.
 *
 * El `/85` se queda: estas columnas flotan sobre el mapa y tienen que dejar ver algo de lo
 * que tapan, en los dos temas.
 */
const glass = "bg-card/85 backdrop-blur-2xl border border-border shadow-2xl shadow-black/20 dark:shadow-black/40";

interface FlowEvent {
    id: string;
    plateDetected?: string | null;
    decision?: string | null;
    direction?: string | null;
    timestamp: string;
    device?: { id: string; name?: string } | null;
}

interface Anim {
    key: string;
    path: LL[];
    startedAt: number;
    durMs: number;
    plate: string;
    color: string; // emerald | orange
}

const carIconHtml = (plate: string, bearing: number, color: string) => `
<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
  <span style="margin-bottom:2px;padding:1px 5px;border-radius:5px;background:${color};color:#fff;font-size:9px;font-weight:800;font-family:var(--font-sans);letter-spacing:.5px;box-shadow:0 2px 6px rgba(0,0,0,.5)">${plate}</span>
  <span style="width:26px;height:26px;border-radius:50%;background:${color};border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.5);transform:rotate(${bearing}deg)">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M12 2l4 7H8l4-7zM8 10h8v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10z"/></svg>
  </span>
</div>`;

const pulseHtml = (color: string) => `
<style>@keyframes omniPing{0%{transform:scale(.22);opacity:.95}75%{opacity:.2}100%{transform:scale(1);opacity:0}}</style>
<div style="position:relative;width:64px;height:64px;pointer-events:none">
  <span style="position:absolute;inset:0;border-radius:50%;border:3px solid ${color};animation:omniPing 1.1s ease-out infinite"></span>
  <span style="position:absolute;inset:12px;border-radius:50%;border:3px solid ${color};animation:omniPing 1.1s .35s ease-out infinite"></span>
  <span style="position:absolute;inset:26px;border-radius:50%;background:${color};opacity:.85;box-shadow:0 0 14px ${color}"></span>
</div>`;

interface Pulse { key: string; lat: number; lng: number; color: string }

function AnimatedCar({ anim, now, onDone }: { anim: Anim; now: number; onDone: (k: string) => void }) {
    const f = Math.min(1, (now - anim.startedAt) / anim.durMs);
    useEffect(() => { if (f >= 1) { const t = setTimeout(() => onDone(anim.key), 900); return () => clearTimeout(t); } }, [f >= 1]);
    const { pt, bearing } = pointAlong(anim.path, f);
    const opacity = f >= 1 ? 0.15 : f > 0.92 ? 1 - (f - 0.92) * 8 : 1;
    return (
        <>
            <Polyline positions={anim.path} interactive={false} pathOptions={{ color: anim.color, weight: 5, opacity: 0.55 * opacity, dashArray: "10 8", lineCap: "round", interactive: false }} />
            <Marker position={pt} interactive={false} zIndexOffset={1000}
                icon={iconoCacheado(
                    /* La opacidad y el rumbo se redondean: el ojo no distingue un paso de
                       0,01 ni medio grado, y sin redondear cada cuadro sería un icono
                       nuevo — que es justamente lo que se vino a evitar. */
                    `flujo:${anim.plate}:${Math.round(bearing)}:${Math.round(opacity * 20)}:${anim.color}`,
                    () => ({
                        className: "bg-transparent border-0",
                        html: `<div style="opacity:${opacity}">${carIconHtml(anim.plate, bearing, anim.color)}</div>`,
                        iconSize: [56, 46], iconAnchor: [28, 30],
                    }),
                )} />
        </>
    );
}

function FeedCard({ ev, accent, onClick }: { ev: FlowEvent; accent: "emerald" | "orange"; onClick: () => void }) {
    const ok = ev.decision === "GRANT";
    const t = new Date(ev.timestamp);
    return (
        <button onClick={onClick} className={cn("w-full text-left px-2.5 py-2 rounded-xl transition-colors hover:bg-accent group", "flex items-center gap-2")}>
            <span className={cn("w-1.5 h-8 rounded-full shrink-0", accent === "emerald" ? "bg-emerald-400" : "bg-orange-400", !ok && "bg-red-400")} />
            <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold tracking-wider tabular-nums text-foreground truncate">{ev.plateDetected || "S/L"}</p>
                <p className="text-[9px] text-muted-foreground truncate">{ev.device?.name || ""}</p>
            </div>
            <div className="text-right shrink-0">
                <p className="text-[10px] text-muted-foreground tabular-nums">{t.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
                <p className={cn("text-[8px] font-bold", ok ? "text-emerald-400" : "text-red-400")}>{ok ? "OK" : "DENY"}</p>
            </div>
        </button>
    );
}

// Hijo del MapContainer: renderiza los autitos (necesita contexto Leaflet)
export function FlowAnims({ anims, pulses = [], onDone }: { anims: Anim[]; pulses?: Pulse[]; onDone: (k: string) => void }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (anims.length === 0) return;
        let raf: number;
        const tick = () => { setNow(Date.now()); raf = requestAnimationFrame(tick); };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [anims.length > 0]);
    return (
        <>
            {anims.map((a) => <AnimatedCar key={a.key} anim={a} now={now} onDone={onDone} />)}
            {pulses.map((p) => (
                <Marker key={p.key} position={[p.lat, p.lng]} interactive={false} zIndexOffset={900}
                    icon={L.divIcon({ className: "bg-transparent border-0", html: pulseHtml(p.color), iconSize: [64, 64], iconAnchor: [32, 32] })} />
            ))}
        </>
    );
}

// Hook con toda la lógica de flujo. Se usa desde BarrioMap.
export function useFlow(streets: any[], cameras: { deviceId: string; lat: number; lng: number }[], socket: any) {
    const [entries, setEntries] = useState<FlowEvent[]>([]);
    const [exits, setExits] = useState<FlowEvent[]>([]);
    const [cargando, setCargando] = useState(true);
    const [anims, setAnims] = useState<Anim[]>([]);
    const [pulses, setPulses] = useState<Pulse[]>([]);

    const built = useMemo(() => {
        try {
            if (!streets.length) return null;
            const g = buildStreetGraph(streets);
            // anclar cada cámara UNA vez (attachPoint inserta nodos virtuales en el grafo)
            const camNodes: Record<string, number> = {};
            for (const cam of cameras) {
                const n = attachPoint(g, [cam.lat, cam.lng]);
                if (n != null) camNodes[cam.deviceId] = n;
            }
            return { g, camNodes };
        } catch { return null; }
    }, [streets, cameras]);
    const graph = built?.g || null;

    const camNode = useCallback((deviceId: string): number | null => {
        const n = built?.camNodes?.[deviceId];
        return n == null ? null : n;
    }, [built]);

    const camById = useMemo(() => Object.fromEntries(cameras.map((c: any) => [c.deviceId, c])), [cameras]);

    const pushPulse = useCallback((deviceId: string, color: string) => {
        const cam: any = camById[deviceId];
        if (!cam) return;
        const key = `${deviceId}_${Date.now()}`;
        setPulses((p) => [...p.slice(-5), { key, lat: cam.lat, lng: cam.lng, color }]);
        setTimeout(() => setPulses((p) => p.filter((x) => x.key !== key)), 3600);
    }, [camById]);

    const pushAnim = useCallback((path: LL[], plate: string, color: string) => {
        if (!path || path.length < 2) return;
        const lenM = pathLengthM(path);
        const durMs = Math.max(4000, Math.min(14000, (lenM / 1000) * 9000));
        setAnims((prev) => {
            const next = [...prev, { key: `${plate}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, path, startedAt: Date.now(), durMs, plate, color }];
            return next.length > 6 ? next.slice(next.length - 6) : next; // protección
        });
    }, []);

    // Animar un evento: ENTRY corto hacia adentro; EXIT trayecto completo desde su entrada previa
    const animateEvent = useCallback(async (ev: FlowEvent) => {
        const devId = ev.device?.id || (ev as any).deviceId;
        if (!devId) return;
        const plate = (ev.plateDetected || "S/L").toUpperCase();
        if (["DOOR_OPEN", "DOOR_CLOSE"].includes(plate)) return;
        pushPulse(devId, ev.direction === "ENTRY" ? "#10b981" : "#f97316"); // pulso en la camara que capturo
        if (!graph) return;
        const n = camNode(devId);
        if (n == null) return;
        if (ev.direction === "ENTRY") {
            pushAnim(walkInward(graph, n, 140), plate, "#10b981");
        } else {
            // buscar la cámara del ENTRY previo de esta matrícula
            let fromNode: number | null = null;
            try {
                if (ev.plateDetected) {
                    const r = await fetch(`/api/events?plate=${encodeURIComponent(ev.plateDetected)}&limit=12`);
                    const d = await r.json();
                    const evTime = new Date(ev.timestamp).getTime();
                    const prevEntry = (d.events || []).find((e: any) => e.direction === "ENTRY" && new Date(e.timestamp).getTime() < evTime && (e.device?.id || e.deviceId));
                    if (prevEntry) fromNode = camNode(prevEntry.device?.id || prevEntry.deviceId);
                }
            } catch { }
            if (fromNode != null && fromNode !== n) {
                const p = route(graph, fromNode, n);
                if (p && p.length > 1) { pushAnim(p, plate, "#f97316"); return; }
            }
            // fallback: egreso corto hacia la cámara de salida (invertimos un walkInward)
            pushAnim(walkInward(graph, n, 140).reverse(), plate, "#f97316");
        }
    }, [graph, camNode, pushAnim, pushPulse]);

    // feed inicial + socket
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const r: any = await getAccessEvents({ take: 40, type: "PLATE", omitEnrichment: true });
                if (!alive) return;
                const evs: FlowEvent[] = (r.events || []);
                setEntries(evs.filter((e) => e.direction === "ENTRY").slice(0, 25));
                setExits(evs.filter((e) => e.direction === "EXIT").slice(0, 25));
            } catch { }
            // Se apaga pase lo que pase: si falló, la columna dice "Sin capturas" y no
            // "Cargando…" para siempre, que es peor porque promete algo que no va a llegar.
            if (alive) setCargando(false);
        })();
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        if (!socket) return;
        const onEvent = (raw: any) => {
            if (raw?.accessType !== "PLATE") return;
            const plate = (raw.plateDetected || "").toUpperCase();
            if (plate === "DOOR_OPEN" || plate === "DOOR_CLOSE") return;
            const devId = raw.device?.id || raw.deviceId;
            const ev = raw.device?.name ? raw : { ...raw, device: { id: devId, name: (camById[devId] as any)?.name || "" } };
            if (ev.direction === "ENTRY") setEntries((prev) => [ev, ...prev.filter((p) => p.id !== ev.id)].slice(0, 25));
            else setExits((prev) => [ev, ...prev.filter((p) => p.id !== ev.id)].slice(0, 25));
            animateEvent(ev); // automático en vivo
        };
        socket.on("access_event", onEvent);
        return () => { socket.off("access_event", onEvent); };
    }, [socket, animateEvent, camById]);

    const onDone = useCallback((k: string) => setAnims((prev) => prev.filter((a) => a.key !== k)), []);

    return { entries, exits, anims, pulses, animateEvent, onDone, cargando, graphReady: !!graph };
}

// Columna overlay colapsable
export function FlowColumn({ side, title, icon: Icon, accent, events, cargando, onPick, }: {
    side: "left" | "right"; title: string; icon: any; accent: "emerald" | "orange";
    events: FlowEvent[]; cargando?: boolean; onPick: (ev: FlowEvent) => void;
}) {
    const [open, setOpen] = useState(true);
    return (
        <div className={cn("absolute top-16 z-[500] flex items-start pointer-events-none max-h-[52%]", side === "left" ? "left-3" : "right-3")}>
            {!open ? (
                <button onClick={() => setOpen(true)}
                    className={cn("mt-1 flex flex-col items-center gap-1.5 px-2 py-3 rounded-2xl text-foreground/80 hover:text-foreground transition-colors pointer-events-auto", glass)}>
                    <Icon size={15} className={accent === "emerald" ? "text-emerald-400" : "text-orange-400"} />
                    <span className="text-[10px] font-bold [writing-mode:vertical-rl] tracking-widest uppercase">{title}</span>
                    <span className={cn("text-[10px] font-bold px-1.5 rounded-full", accent === "emerald" ? "bg-emerald-500/30 text-emerald-300" : "bg-orange-500/30 text-orange-300")}>{events.length}</span>
                </button>
            ) : (
                <div className={cn("w-[212px] max-h-full flex flex-col rounded-2xl overflow-hidden pointer-events-auto", glass)}>
                    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
                        <Icon size={13} className={accent === "emerald" ? "text-emerald-400" : "text-orange-400"} />
                        <span className="text-[10px] font-bold text-foreground/80 uppercase tracking-[0.15em]">{title}</span>
                        <span className="ml-auto text-[9px] text-muted-foreground font-bold">{events.length}</span>
                        <button onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                            {side === "left" ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
                        {events.length === 0 ? (
                            /* "Sin capturas" y "todavía no cargó" se veían igual, y no son
                               lo mismo: uno dice que no pasó nadie, el otro que no sabemos. */
                            <div className="flex flex-col items-center gap-1.5 py-8 text-muted-foreground/60">
                                <Car size={20} />
                                <span className="text-[10px]">{cargando ? "Cargando…" : "Sin capturas"}</span>
                            </div>
                        ) : events.map((ev) => <FeedCard key={ev.id} ev={ev} accent={accent} onClick={() => onPick(ev)} />)}
                    </div>
                </div>
            )}
        </div>
    );
}
