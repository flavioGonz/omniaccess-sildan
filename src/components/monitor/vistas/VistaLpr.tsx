"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, LogOut, ShieldCheck, ShieldX, ShieldAlert, Search, Repeat, Camera, Clock, Users } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, horaCorta, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { sonar } from "@/lib/sonido-monitor";
import { getImagePath } from "@/lib/image-path";
import { metodoDeLectura } from "@/lib/lectura-metodo";
import { cn } from "@/lib/utils";

/**
 * La vista Control LPR de la pared: la última lectura grande y clara, si se abrió y por qué,
 * la tira de las últimas, los números del día y la fila de atención.
 *
 * Lo urgente llega por el socket (`access_event`) y reemplaza la protagonista en el acto;
 * la consulta periódica trae los contadores y la fila de atención, que necesitan la base.
 */
const INTERVALO_MS = 20_000;
const ULTIMAS_EN_TIRA = 10;

type Lectura = { id: string; ts: string; plate: string | null; persona: string | null; camara: string | null; sentido: string; decision: string; accessType: string | null; foto: string | null; detalles: string | null; metodo: { metodo: string | null; confianza: number | null } };
type Datos = { ultima: Lectura | null; tira: Lectura[]; contadores: { entradas: number; salidas: number; denegados: number; adentro: number; actualizado: string; dia: string }; atencion: { plate: string; tipo: "LISTA_NEGRA" | "EN_BUSQUEDA" | "MERODEO"; motivo: string; ts: string; camara: string | null }[]; ahora: string };

const desdeEvento = (e: any): Lectura | null => e?.id && e?.timestamp ? ({
    id: e.id, ts: e.timestamp, plate: (e.plateDetected || e.plateNumber || "").toUpperCase() || null, persona: e.user?.name || null,
    camara: e.device?.name || e.location || null, sentido: e.direction || "ENTRY", decision: e.decision || "DENY", accessType: e.accessType || null,
    foto: e.snapshotPath || e.imagePath || null, detalles: e.details || null, metodo: metodoDeLectura(e.details || null),
}) : null;

const esListaNegra = (l: Lectura) => /lista negra/i.test(l.detalles || "");
const motivoDenegado = (l: Lectura) => {
    const d = l.detalles || "";
    const m = d.match(/Lista negra:\s*([^·|]+)/i); if (m) return `Lista negra: ${m[1].trim()}`;
    const partes = d.split(/[·|]/).map((x) => x.trim()).filter((x) => x && !/^Metodo|^Método|^Confianza/i.test(x));
    return partes[0] || "Sin credencial vigente";
};

function Contador({ rotulo, valor, Icono, tono }: { rotulo: string; valor: number; Icono: any; tono?: "bien" | "mal" | "info" }) {
    return (
        <div className="flex items-center gap-4 rounded-2xl bg-card border border-border px-5 py-4">
            <span className={cn("grid h-12 w-12 place-items-center rounded-full shrink-0", tono === "bien" ? "pleno-bien" : tono === "mal" ? "pleno-mal" : tono === "info" ? "pleno-info" : "bg-muted text-muted-foreground")}><Icono size={24} /></span>
            <div>
                <div className="text-[40px] font-bold leading-none tabular-nums">{valor}</div>
                <div className="text-[14px] text-muted-foreground mt-1">{rotulo}</div>
            </div>
        </div>
    );
}

export function VistaLpr() {
    const { latir, setTitulo, ajustes, silencio } = useMarco();
    useEffect(() => { setTitulo("Control LPR"); }, [setTitulo]);
    usarReloj();
    const { datos, error, recargar } = usarDatos<Datos>("/api/monitor/lpr", INTERVALO_MS, latir);
    const [ultima, setUltima] = useState<Lectura | null>(null);
    const [tira, setTira] = useState<Lectura[]>([]);
    useEffect(() => { if (!datos) return; setUltima((u) => (u && datos.ultima && u.ts > datos.ultima.ts ? u : datos.ultima)); setTira((t) => { const base = datos.tira; const ids = new Set(base.map((x) => x.id)); return [...t.filter((x) => !ids.has(x.id) && (!datos.ultima || x.id !== datos.ultima.id) && (!base[0] || x.ts > base[0].ts)), ...base].slice(0, ULTIMAS_EN_TIRA); }); }, [datos]);

    const modo = ajustes?.sonido?.lpr || "off";
    useTiempoReal("access_event", (e: any) => {
        const l = desdeEvento(e); if (!l) return;
        latir();
        setUltima((prev) => { if (prev && prev.id !== l.id) setTira((t) => [prev, ...t.filter((x) => x.id !== prev.id)].slice(0, ULTIMAS_EN_TIRA)); return l; });
        if (!silencio && modo !== "off") {
            if (esListaNegra(l)) sonar("lista");
            else if (l.decision === "DENY" && modo === "denegado") sonar("denegado");
        }
        setTimeout(recargar, 1200);
    });

    // Los contadores vuelven a cero a la medianoche del barrio sin recargar: se pide de nuevo al cambiar el día.
    const diaRef = useRef<string>("");
    useEffect(() => { const iv = setInterval(() => { const d = new Date().toDateString(); if (diaRef.current && diaRef.current !== d) recargar(); diaRef.current = d; }, 30_000); return () => clearInterval(iv); }, [recargar]);

    const c = datos?.contadores;
    const foto = ultima ? getImagePath(ultima.foto) : null;
    const negra = ultima ? esListaNegra(ultima) : false;
    const permitido = ultima?.decision === "GRANT";

    return (
        <div className="absolute inset-0 grid grid-cols-[1fr_380px] gap-4 p-4">
            <div className="min-w-0 flex flex-col gap-4">
                {/* Protagonista */}
                <div className={cn("relative flex-1 min-h-0 rounded-2xl overflow-hidden bg-neutral-900 ring-2 transition-colors", !ultima ? "ring-white/10" : negra ? "ring-[var(--mal)]" : permitido ? "ring-[var(--bien)]" : "ring-[var(--mal)]")}>
                    <AnimatePresence mode="wait">
                        {ultima ? (
                            <motion.div key={ultima.id} initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="absolute inset-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {foto ? <img src={foto} alt="" className="absolute inset-0 w-full h-full object-contain bg-black" /> : <div className="absolute inset-0 grid place-items-center text-white/30"><Camera size={64} /></div>}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/40 pointer-events-none" />
                                <div className="absolute top-0 inset-x-0 p-6 flex items-start justify-between gap-4">
                                    <div className="flex items-center gap-3 text-[18px] text-white/85">
                                        {ultima.sentido === "EXIT" ? <LogOut size={22} /> : <LogIn size={22} />}
                                        <span className="font-bold">{ultima.sentido === "EXIT" ? "Salida" : "Entrada"}</span>
                                        <span className="text-white/55">· {ultima.camara || "—"}</span>
                                    </div>
                                    <div className="text-right text-white/85">
                                        <div className="text-[30px] font-bold tabular-nums leading-none">{horaCorta(ultima.ts)}</div>
                                        <div className="text-[14px] text-white/55 mt-1">{hace(ultima.ts)}{ultima.metodo.metodo ? ` · ${ultima.metodo.metodo}` : ""}{ultima.metodo.confianza != null ? ` · ${Math.round(ultima.metodo.confianza)} %` : ""}</div>
                                    </div>
                                </div>
                                <div className="absolute bottom-0 inset-x-0 p-6 flex items-end justify-between gap-6">
                                    <div className="min-w-0">
                                        <div className="inline-block px-5 py-2 rounded-xl bg-white text-black text-[72px] font-bold tabular-nums tracking-[0.14em] leading-none shadow-[0_8px_30px_rgba(0,0,0,.6)]">{ultima.plate || "S/L"}</div>
                                        <div className="mt-3 text-[22px] font-semibold text-white truncate">{ultima.persona || (permitido ? "Autorizado" : "Desconocido")}</div>
                                    </div>
                                    <div className={cn("shrink-0 flex items-center gap-3 px-6 py-4 rounded-2xl text-white", negra || !permitido ? "pleno-mal" : "pleno-bien")}>
                                        {negra ? <ShieldAlert size={40} /> : permitido ? <ShieldCheck size={40} /> : <ShieldX size={40} />}
                                        <div>
                                            <div className="text-[34px] font-black uppercase tracking-[0.08em] leading-none">{negra ? "Lista negra" : permitido ? "Permitido" : "Denegado"}</div>
                                            {!permitido && <div className="text-[16px] font-semibold opacity-90 mt-1 max-w-[420px] truncate">{motivoDenegado(ultima)}</div>}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <div className="absolute inset-0 grid place-items-center text-[22px] text-muted-foreground">{error && !datos ? `No se pudo leer: ${error}` : datos ? "Todavía no hay lecturas" : "Cargando…"}</div>
                        )}
                    </AnimatePresence>
                </div>
                {/* Tira */}
                <div className="shrink-0 h-[120px] flex gap-3 overflow-hidden">
                    <AnimatePresence initial={false}>
                        {tira.map((l) => {
                            const f = getImagePath(l.foto); const ok = l.decision === "GRANT";
                            return (
                                <motion.div key={l.id} layout initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.3 }}
                                    className={cn("relative w-[200px] shrink-0 rounded-xl overflow-hidden bg-neutral-900 ring-1", ok ? "ring-[color-mix(in_oklab,var(--bien)_50%,transparent)]" : "ring-[color-mix(in_oklab,var(--mal)_60%,transparent)]")}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    {f && <img src={f} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent" />
                                    <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2">
                                        <div><div className="text-[18px] font-bold text-white tabular-nums tracking-[0.1em]">{l.plate || "S/L"}</div><div className="text-[12px] text-white/65 tabular-nums">{horaCorta(l.ts)} · {l.sentido === "EXIT" ? "salida" : "entrada"}</div></div>
                                        {ok ? <ShieldCheck size={18} className="text-[var(--bien)]" /> : <ShieldX size={18} className="text-[var(--mal)]" />}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            </div>
            {/* Columna derecha: contadores y atención */}
            <aside className="flex flex-col gap-3 min-h-0">
                <div className="grid grid-cols-2 gap-3">
                    <Contador rotulo="Adentro ahora" valor={c?.adentro ?? 0} Icono={Users} tono="info" />
                    <Contador rotulo="Entradas hoy" valor={c?.entradas ?? 0} Icono={LogIn} tono="bien" />
                    <Contador rotulo="Salidas hoy" valor={c?.salidas ?? 0} Icono={LogOut} />
                    <Contador rotulo="Denegados hoy" valor={c?.denegados ?? 0} Icono={ShieldX} tono="mal" />
                </div>
                <div className="text-[12px] text-muted-foreground px-1 inline-flex items-center gap-1.5"><Clock size={12} /> contadores del día del barrio · actualizados {c ? hace(c.actualizado) : "—"}</div>
                <div className="flex-1 min-h-0 rounded-2xl bg-card border border-border p-4 flex flex-col gap-3 overflow-hidden">
                    <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-2"><ShieldAlert size={14} /> Atención · últimas 24 h</div>
                    {datos && datos.atencion.length === 0 && <div className="text-[18px] text-muted-foreground">Sin novedades</div>}
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2">
                        {(datos?.atencion || []).map((a) => {
                            const est = a.tipo === "LISTA_NEGRA" ? { t: "Lista negra", Ic: ShieldAlert, c: "pleno-mal" } : a.tipo === "EN_BUSQUEDA" ? { t: "En búsqueda", Ic: Search, c: "pleno-aviso" } : { t: "Merodeo", Ic: Repeat, c: "pleno-info" };
                            return (
                                <div key={a.plate + a.tipo} className="flex items-center gap-3 rounded-xl bg-muted/40 border border-border px-3 py-2.5">
                                    <span className={cn("grid h-10 w-10 place-items-center rounded-full shrink-0", est.c)}><est.Ic size={18} /></span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2"><span className="text-[18px] font-bold tabular-nums tracking-[0.1em]">{a.plate}</span><span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{est.t}</span></div>
                                        <div className="text-[13px] text-muted-foreground truncate">{a.motivo} · {hace(a.ts)}{a.camara ? ` · ${a.camara}` : ""}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </aside>
        </div>
    );
}
