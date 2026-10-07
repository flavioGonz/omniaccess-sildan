"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Server, Clock, Camera } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, horaCorta, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { CanalEnAlarma } from "@/components/intrusion/CanalEnAlarma";
import { GeomOverlay, metaDe, type Geom } from "@/components/intrusion/comun";
import { ResumenArmado } from "@/components/intrusion/HorarioArmado";
import { sonar } from "@/lib/sonido-monitor";
import { getImagePath } from "@/lib/image-path";
import { cn } from "@/lib/utils";

/**
 * La vista Intrusión de la pared.
 *
 * Calma cuando no pasa nada: el mosaico de las cámaras de intrusión llenando la pantalla,
 * con su línea y su zona y el armado de cada regla. Una sola cosa cuando pasa: el canal en
 * alarma toma el overlay rojo (la misma pieza que el panel) y crece hasta ocupar media
 * pantalla; las demás se corren al costado. Nada se toca desde acá: aceptar o resolver es
 * del panel.
 */

/** Cada cuánto se repite la consulta completa; el socket adelanta lo urgente, y esto es lo que hace que una alarma aceptada en el panel se apague acá. */
const INTERVALO_MS = 15_000;
/** Cadencia del snapshot de cada canal: más lenta sin alarma, para no castigar las cámaras. */
const SNAPSHOT_CALMA_MS = 8000;
const SNAPSHOT_ALARMA_MS = 4000;
/** Cada cuánto vuelve a sonar una alarma en modo "repetir". */
const REPETIR_MS = 8000;

type Cam = { id: string; name: string; nvrName: string | null; ch: number | null; geom: Geom | null; horarios: any; ultima: { id: string; type: string; timestamp: string; snapshotPath: string | null } | null };
type Alarma = { deviceId: string; id: string; type: string; ts: string };
type Datos = { camaras: Cam[]; pendientes: Alarma[]; atendiendo: string[]; franja: any[]; ahora: string };

function Canal({ cam, pendientes, confirmada, grande }: { cam: Cam; pendientes: Alarma[]; confirmada: boolean; grande: boolean }) {
    const enAlarma = pendientes.length > 0 || confirmada;
    const [k, setK] = useState(0);
    useEffect(() => { const iv = setInterval(() => setK((x) => x + 1), enAlarma ? SNAPSHOT_ALARMA_MS : SNAPSHOT_CALMA_MS); return () => clearInterval(iv); }, [enAlarma]);
    const m = cam.ultima ? metaDe(cam.ultima.type) : null;
    return (
        <motion.div layout transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className={cn("relative rounded-2xl overflow-hidden bg-neutral-900 ring-1 ring-white/10", grande ? "col-span-2 row-span-2" : "")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/snapshot/${cam.id}?t=${k}`} alt={cam.name} className="absolute inset-0 w-full h-full object-cover" />
            <GeomOverlay geom={cam.geom} alert={enAlarma} />
            {enAlarma && (
                <CanalEnAlarma escala={grande ? "pared" : "panel"} estado={pendientes.length ? "pendiente" : "confirmada"}
                    tipo={pendientes.length ? metaDe(pendientes[0].type).label : m ? m.label : "Intrusión"}
                    desde={pendientes.length ? pendientes[0].ts : cam.ultima?.timestamp || null} eventos={pendientes.length}
                    camara={`${cam.name}${cam.nvrName ? ` · ${cam.nvrName}` : ""}${cam.ch != null ? ` · CH ${cam.ch}` : ""}`} />
            )}
            <div className="absolute top-0 inset-x-0 px-4 pt-3 pb-8 bg-gradient-to-b from-black/80 via-black/30 to-transparent">
                <div className={cn("font-bold text-white drop-shadow leading-tight", grande ? "text-[28px]" : "text-[20px]")}>{cam.name}</div>
                <div className="flex items-center gap-3 mt-0.5 text-[13px] text-white/70">
                    {cam.nvrName && <span className="inline-flex items-center gap-1"><Server size={12} /> {cam.nvrName}{cam.ch != null ? ` · CH ${cam.ch}` : ""}</span>}
                </div>
                {cam.horarios && <div className="mt-1 [&_span]:!text-[12px]"><ResumenArmado h={cam.horarios} /></div>}
            </div>
            {!enAlarma && (
                <div className="absolute bottom-0 inset-x-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-2 text-[14px] text-white/80">
                    {cam.ultima && m ? <><m.Icon size={15} className={m.cls.split(" ")[0]} /> <span className="font-semibold">{m.label}</span> <span className="text-white/55">· {hace(cam.ultima.timestamp)}</span></> : <><Camera size={15} className="text-white/40" /> <span className="text-white/55">Sin detecciones</span></>}
                </div>
            )}
        </motion.div>
    );
}

export function VistaIntrusion() {
    const { latir, setTitulo, ajustes, silencio } = useMarco();
    useEffect(() => { setTitulo("Intrusión"); }, [setTitulo]);
    usarReloj();
    const { datos, error, recargar } = usarDatos<Datos>("/api/monitor/intrusion", INTERVALO_MS, latir);
    const [vivas, setVivas] = useState<Alarma[]>([]);
    useEffect(() => { if (datos) setVivas(datos.pendientes); }, [datos]);
    // El socket adelanta la alarma: no se espera a la próxima consulta para ponerse rojo.
    useTiempoReal("general_detection", (d: any) => {
        if (!d?.id || !d.deviceId || d.type === "MOTION") return;
        setVivas((p) => (p.some((a) => a.id === d.id) ? p : [{ id: d.id, deviceId: d.deviceId, type: d.type, ts: d.timestamp || new Date().toISOString() }, ...p]));
        latir();
        setTimeout(recargar, 1500);
    });

    const porCamara = useMemo(() => { const m = new Map<string, Alarma[]>(); for (const a of vivas) m.set(a.deviceId, [...(m.get(a.deviceId) || []), a]); return m; }, [vivas]);
    const atendiendo = useMemo(() => new Set(datos?.atendiendo || []), [datos]);
    const camaras = datos?.camaras || [];
    // La cámara en alarma más reciente va al lugar grande.
    const grandeId = useMemo(() => {
        const conAlarma = camaras.filter((c) => porCamara.has(c.id) || atendiendo.has(c.id));
        if (!conAlarma.length) return null;
        conAlarma.sort((a, b) => (porCamara.get(b.id)?.[0]?.ts || "").localeCompare(porCamara.get(a.id)?.[0]?.ts || ""));
        return conAlarma[0].id;
    }, [camaras, porCamara, atendiendo]);
    const ordenadas = useMemo(() => grandeId ? [camaras.find((c) => c.id === grandeId)!, ...camaras.filter((c) => c.id !== grandeId)] : camaras, [camaras, grandeId]);

    // Sonido según el ajuste: una vez por alarma nueva, o repetir mientras haya pendientes.
    const modo = ajustes?.sonido?.intrusion || "off";
    const vistas = useRef(new Set<string>());
    useEffect(() => {
        if (modo === "off" || silencio) return;
        const nuevas = vivas.filter((a) => !vistas.current.has(a.id));
        if (nuevas.length) { sonar("alarma"); nuevas.forEach((a) => vistas.current.add(a.id)); }
        if (modo !== "repetir" || !vivas.length) return;
        const iv = setInterval(() => sonar("alarma"), REPETIR_MS);
        return () => clearInterval(iv);
    }, [vivas, modo, silencio]);

    const n = camaras.length;
    const cols = grandeId ? 4 : n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;

    return (
        <div className="absolute inset-0 flex gap-4 p-4">
            <div className="flex-1 min-w-0 grid gap-4 auto-rows-fr" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {!datos && !error && <div className="col-span-full grid place-items-center text-[20px] text-muted-foreground">Cargando cámaras…</div>}
                {error && !datos && <div className="col-span-full grid place-items-center text-[20px] text-[var(--mal-texto)]">No se pudo leer el monitor: {error}</div>}
                {datos && n === 0 && <div className="col-span-full grid place-items-center text-[20px] text-muted-foreground">No hay cámaras de intrusión dadas de alta.</div>}
                {ordenadas.map((c) => <Canal key={c.id} cam={c} pendientes={porCamara.get(c.id) || []} confirmada={atendiendo.has(c.id)} grande={c.id === grandeId} />)}
            </div>
            {/* Franja: las últimas detecciones con su foto y su estado. */}
            <aside className="w-[300px] shrink-0 flex flex-col gap-2 overflow-hidden">
                <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground px-1">Últimas detecciones</div>
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2">
                    <AnimatePresence initial={false}>
                        {(datos?.franja || []).map((d: any) => {
                            const m = metaDe(d.type);
                            const estado = !d.acknowledged ? { t: "Pendiente", c: "chip-aviso" } : d.ackKind === "false" ? { t: "Falsa", c: "chip-quieto" } : { t: "Real", c: "chip-mal" };
                            const foto = getImagePath(d.snapshotPath) || (d.deviceId ? `/api/snapshot/${d.deviceId}?t=${d.id}` : null);
                            return (
                                <motion.div key={d.id} layout initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                                    className="relative rounded-xl overflow-hidden bg-neutral-900 ring-1 ring-white/10 aspect-[16/7] shrink-0">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    {foto && <img src={foto} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                                    <span className={cn("absolute top-2 right-2 px-2 py-0.5 rounded-full border text-[11px] font-bold uppercase", estado.c)}>{estado.t}</span>
                                    <div className="absolute bottom-2 left-3 right-3">
                                        <div className="flex items-center gap-1.5 text-[13px] font-bold text-white"><m.Icon size={14} className={m.cls.split(" ")[0]} /> {m.label}</div>
                                        <div className="text-[12px] text-white/70 truncate">{d.deviceName || "—"} · <span className="tabular-nums">{horaCorta(d.timestamp)}</span> · {hace(d.timestamp)}</div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                    {datos && datos.franja.length === 0 && <div className="text-[15px] text-muted-foreground px-1 inline-flex items-center gap-2"><Clock size={16} /> Sin detecciones recientes</div>}
                </div>
            </aside>
        </div>
    );
}
