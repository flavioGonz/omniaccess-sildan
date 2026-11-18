"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Clock, X, Check, Search, Loader2, Bike, Wrench, HardHat, Users, Ticket, LogOut, AlertTriangle, BellRing, Timer, Eye, MapPin, Car, Activity } from "lucide-react";
import { getImagePath } from "@/lib/image-path";
import { conAncho } from "@/lib/ancho-foto";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/avisos";
import {
    datosParaRegistrar, registrarVisita, cerrarVisitaAMano, extenderVisitaAMano, visitasEnCurso, avisosPendientes, atenderAvisoAMano,
    registrarVisitaSinLote, asignarLoteAMano, prorrogarSeguimientoAMano, cerrarSinLoteAMano, ultimaEntradaParaSeguimiento,
    type VisitaFila, type AvisoFila,
} from "@/app/actions/visitas";
import { ETIQUETA_AVISO, type TipoAviso } from "@/lib/visitas/presentacion";
import { getEmpresas } from "@/app/actions/empresas";
import { normalizarNombre, type Empresa } from "@/lib/empresas";
import { esPaseLibre } from "@/lib/visitas/ajustes-base";

/**
 * La pestaña "Visitas" de la consola del guardia: registrar a quien para en la garita, ver
 * quién está en el barrio con su cuenta atrás, extender o cerrar, y los avisos pendientes.
 *
 * Pensada para una tablet en la garita: botones grandes, sin hover, tres toques para
 * registrar (tipo → lote → listo; la matrícula y el nombre son opcionales porque a una moto
 * de delivery casi nunca se le ve la chapa). Todo llega en tiempo real por el socket de la
 * consola (`visita`, `aviso_guardia`); la lista se vuelve a pedir igual cada minuto por si el
 * socket se cayó.
 */

const ICONO_TIPO: Record<string, any> = { DELIVERY: Bike, SERVICIO: Wrench, OBRA: HardHat, VISITA: Users };
/** Cada cuánto se repide la lista aunque no llegue nada por el socket. */
const REFRESCO_MS = 60_000;
/** Las extensiones que se ofrecen con un toque. */
const EXTENSIONES = [5, 10, 15];
/** En el último 20 % del tiempo la cuenta atrás pasa a ámbar (spec "Visitas en el barrio a la vista"). */
const FRACCION_AVISO = 0.2;

type Datos = Awaited<ReturnType<typeof datosParaRegistrar>>;

const mmss = (ms: number) => { const s = Math.floor(Math.abs(ms) / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return `${ms < 0 ? "-" : ""}${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(ss).padStart(2, "0")}`; };
const tocable = "transition-transform duration-150 active:scale-[0.97] touch-manipulation";

export function PanelVisitas({ guardName, socket, onPendientes }: { guardName: string; socket: any; onPendientes?: (n: number) => void }) {
    const [visitas, setVisitas] = useState<VisitaFila[]>([]);
    const [avisos, setAvisos] = useState<AvisoFila[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [alta, setAlta] = useState(false);
    const [altaSinLote, setAltaSinLote] = useState(false);
    const [asignando, setAsignando] = useState<VisitaFila | null>(null);
    const [cerrandoSL, setCerrandoSL] = useState<VisitaFila | null>(null);
    const [plazos, setPlazos] = useState({ min: 10, prorroga: 5 });
    useEffect(() => { datosParaRegistrar().then((d) => setPlazos({ min: d.sinLoteMin, prorroga: d.sinLoteProrrogaMin })).catch(() => { }); }, []);
    const [, tick] = useState(0);

    const cargar = useCallback(async () => {
        try {
            const [v, a] = await Promise.all([visitasEnCurso(), avisosPendientes()]);
            setVisitas(v); setAvisos(a); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);
    useEffect(() => { const iv = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(iv); }, []);
    useEffect(() => { onPendientes?.(avisos.length); }, [avisos.length, onPendientes]);
    useEffect(() => {
        if (!socket) return;
        const alCambio = () => cargar();
        // El aviso emergente lo muestra la consola (también cuando esta pestaña no está abierta).
        const alAviso = () => cargar();
        socket.on("visita", alCambio); socket.on("aviso_guardia", alAviso);
        return () => { socket.off("visita", alCambio); socket.off("aviso_guardia", alAviso); };
    }, [socket, cargar]);

    const ahora = Date.now();
    // Las visitas sin lote en seguimiento van aparte, arriba de todo (change visita-sin-lote).
    const enSeguimiento = useMemo(() => visitas.filter((v) => v.seguimientoVence && !v.loteNombre).sort((a, b) => +new Date(a.seguimientoVence!) - +new Date(b.seguimientoVence!)), [visitas]);
    const ordenadas = useMemo(() => visitas.filter((v) => !(v.seguimientoVence && !v.loteNombre)).sort((a, b) => +new Date(a.vence) - +new Date(b.vence)), [visitas]);
    // Al vencer un seguimiento: pitido y vibración, una vez por visita.
    const yaAvisadas = useRef<Set<string>>(new Set());
    useEffect(() => {
        for (const v of enSeguimiento) {
            const vencida = +new Date(v.seguimientoVence!) <= ahora;
            if (vencida && !yaAvisadas.current.has(v.id)) { yaAvisadas.current.add(v.id); pitar(); }
            if (!vencida) yaAvisadas.current.delete(v.id);
        }
    });
    async function prorrogar(v: VisitaFila) {
        const r = await prorrogarSeguimientoAMano(v.id, guardName);
        if (!r.ok) { toast.error("No se pudo prorrogar", { description: r.error }); return; }
        toast.success(`${v.plate || "Visita"} · +${r.minutos} min para el lote`); cargar();
    }

    async function extender(v: VisitaFila, m: number) {
        const r = await extenderVisitaAMano(v.id, m, guardName);
        if (!r.ok) { toast.error("No se pudo extender", { description: r.error }); return; }
        toast.success(`${v.plate || v.nombre || v.tipoNombre} · +${m} min`); cargar();
    }
    async function cerrar(v: VisitaFila) {
        const r = await cerrarVisitaAMano(v.id, guardName);
        if (!r.ok) { toast.error("No se pudo cerrar", { description: r.error }); return; }
        toast.success("Visita cerrada"); cargar();
    }
    async function atender(a: AvisoFila) {
        const r = await atenderAvisoAMano(a.id, null, guardName);
        if (!r.ok) { toast.error("No se pudo marcar", { description: r.error }); return; }
        cargar();
    }

    return (
        <div className="h-full w-full overflow-y-auto p-4 md:p-8 pb-40 custom-scrollbar">
            <div className="max-w-5xl mx-auto space-y-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <h2 className="text-2xl font-bold text-black">En el barrio</h2>
                        <p className="text-sm text-black/50">{ordenadas.length} visita{ordenadas.length === 1 ? "" : "s"} en curso · se cierran solas cuando la cámara de Salida lee la matrícula</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setAltaSinLote(true)} className={cn("h-14 px-5 rounded-2xl border-2 border-black/10 bg-white text-black font-bold text-base inline-flex items-center gap-2", tocable)}>
                            <Timer size={22} /> Visita sin lote
                        </button>
                        <button onClick={() => setAlta(true)} className={cn("h-14 px-6 rounded-2xl bg-[#B20D30] text-white font-bold text-base inline-flex items-center gap-2 shadow-lg shadow-[#B20D30]/20", tocable)}>
                            <Plus size={22} /> Registrar visita
                        </button>
                    </div>
                </div>

                {/* Visitas sin lote en seguimiento: lo más urgente, arriba de todo. */}
                {enSeguimiento.length > 0 && (
                    <section className="space-y-2">
                        <div className="text-xs font-bold uppercase tracking-widest text-black/40 inline-flex items-center gap-2"><Activity size={14} /> En seguimiento · {enSeguimiento.length}</div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <AnimatePresence initial={false}>
                                {enSeguimiento.map((v) => <TarjetaSeguimiento key={v.id} v={v} ahora={ahora} plazoMin={plazos.min} prorrogaMin={plazos.prorroga} alAsignar={() => setAsignando(v)} alProrrogar={() => prorrogar(v)} alCerrar={() => setCerrandoSL(v)} />)}
                            </AnimatePresence>
                        </div>
                    </section>
                )}

                {/* Avisos pendientes: arriba de todo, que es lo que hay que atender. */}
                {avisos.length > 0 && (
                    <section className="space-y-2">
                        <div className="text-xs font-bold uppercase tracking-widest text-black/40 inline-flex items-center gap-2"><BellRing size={14} /> Avisos · {avisos.length}</div>
                        <AnimatePresence initial={false}>
                            {avisos.map((a) => {
                                const et = ETIQUETA_AVISO[a.tipo as TipoAviso] || { titulo: a.tipo, tono: "neutro" };
                                return (
                                    <motion.div key={a.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.2 }}
                                        className={cn("flex items-center gap-4 rounded-2xl border p-4 bg-white", et.tono === "mal" ? "border-red-300" : et.tono === "aviso" ? "border-amber-300" : "border-black/10")}>
                                        <span className={cn("grid h-11 w-11 place-items-center rounded-full shrink-0", et.tono === "mal" ? "bg-red-600 text-white" : et.tono === "aviso" ? "bg-amber-400 text-black" : "bg-black/10 text-black/60")}><AlertTriangle size={20} /></span>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap"><span className="font-bold text-black">{et.titulo}</span>{a.plate && <span className="px-2 py-0.5 rounded-md bg-black/5 font-bold tracking-widest tabular-nums text-sm">{a.plate}</span>}<span className="text-xs text-black/40 tabular-nums">{new Date(a.creado).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}</span></div>
                                            <div className="text-sm text-black/70">{a.motivo}</div>
                                        </div>
                                        <button onClick={() => atender(a)} className={cn("h-12 px-5 rounded-xl bg-black text-white font-bold inline-flex items-center gap-2 shrink-0", tocable)}><Check size={18} /> Atendido</button>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </section>
                )}

                {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between gap-3">No se pudo leer: {error}<button onClick={cargar} className="font-bold underline">Reintentar</button></div>}
                {cargando && !visitas.length ? <div className="py-16 grid place-items-center text-black/40"><Loader2 className="animate-spin" /></div> : !ordenadas.length && !error ? (
                    <div className="rounded-3xl border-2 border-dashed border-black/10 p-12 text-center text-black/40">
                        <Clock size={32} className="mx-auto mb-2" />Nadie registrado en el barrio ahora.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <AnimatePresence initial={false}>
                            {ordenadas.map((v) => {
                                const vence = +new Date(v.vence), entra = +new Date(v.entra);
                                const resta = vence - ahora, total = Math.max(1, vence - entra);
                                // Pase libre: sin cuenta atrás ni prórrogas; se ve cuánto lleva adentro.
                                const libre = esPaseLibre(v.tipo);
                                const estado = libre ? "ok" : resta < 0 ? "excedida" : resta < total * FRACCION_AVISO ? "cerca" : "ok";
                                const Ic = v.origen === "INVITACION" ? Ticket : ICONO_TIPO[v.tipo] || Users;
                                return (
                                    <motion.div key={v.id} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}
                                        className={cn("rounded-2xl border bg-white p-4 flex flex-col gap-3", estado === "excedida" ? "border-red-400 ring-2 ring-red-200" : estado === "cerca" ? "border-amber-300" : "border-black/10")}>
                                        <div className="flex items-start gap-3">
                                            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-black/5 text-black/70 shrink-0"><Ic size={22} /></span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-black">{v.tipoNombre}</span>
                                                    {v.plate && <span className="px-2 py-0.5 rounded-md bg-black/5 font-bold tracking-widest tabular-nums text-sm">{v.plate}</span>}
                                                </div>
                                                <div className="text-sm text-black/60 truncate">{v.loteNombre ? `→ ${v.loteNombre}` : "sin lote"}{v.nombre ? ` · ${v.nombre}` : ""}{v.empresa ? ` · ${v.empresa}` : ""}</div>
                                                <div className="text-xs text-black/40">entró {new Date(v.entra).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}{v.registradaPor ? ` · ${v.registradaPor}` : ""}</div>
                                            </div>
                                            <div className={cn("text-right tabular-nums font-bold leading-none", estado === "excedida" ? "text-red-600" : estado === "cerca" ? "text-amber-600" : "text-black")}>
                                                <div className="text-3xl">{libre ? mmss(ahora - entra) : mmss(resta)}</div>
                                                <div className="text-[10px] uppercase tracking-widest mt-1 opacity-60">{libre ? "adentro" : estado === "excedida" ? "excedida" : "restan"}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {!libre && EXTENSIONES.map((m) => <button key={m} onClick={() => extender(v, m)} className={cn("h-12 flex-1 rounded-xl border border-black/10 bg-black/[0.03] font-bold text-black", tocable)}>+{m}</button>)}
                                            <button onClick={() => cerrar(v)} className={cn("h-12 px-4 rounded-xl bg-black text-white font-bold inline-flex items-center gap-2", tocable)}><LogOut size={18} /> Salió</button>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            <AltaVisita abierta={alta} alCerrar={() => setAlta(false)} guardName={guardName} alRegistrar={() => { setAlta(false); cargar(); }} />
            <AltaSinLote abierta={altaSinLote} alCerrar={() => setAltaSinLote(false)} guardName={guardName} alRegistrar={() => { setAltaSinLote(false); cargar(); }} />
            <AsignarLote v={asignando} alCerrar={() => setAsignando(null)} guardName={guardName} alListo={() => { setAsignando(null); cargar(); }} />
            <CerrarSinLote v={cerrandoSL} alCerrar={() => setCerrandoSL(null)} guardName={guardName} alListo={() => { setCerrandoSL(null); cargar(); }} />
        </div>
    );
}

/** El formulario de alta, a pantalla casi completa: tipo, lote, y lo opcional. */
function AltaVisita({ abierta, alCerrar, guardName, alRegistrar }: { abierta: boolean; alCerrar: () => void; guardName: string; alRegistrar: () => void }) {
    const [datos, setDatos] = useState<Datos | null>(null);
    const [tipo, setTipo] = useState<string>("");
    const [lote, setLote] = useState<{ id: string; nombre: string } | null>(null);
    const [busca, setBusca] = useState("");
    const [plate, setPlate] = useState("");
    const [nombre, setNombre] = useState("");
    const [empresa, setEmpresa] = useState("");
    const [guardando, setGuardando] = useState(false);
    useEffect(() => {
        if (!abierta) return;
        setTipo(""); setLote(null); setBusca(""); setPlate(""); setNombre(""); setEmpresa("");
        datosParaRegistrar().then((d) => { setDatos(d); setTipo(d.tipos[0]?.clave || ""); }).catch((e) => toast.error("No se pudo abrir", { description: e?.message }));
    }, [abierta]);
    const [empresas, setEmpresas] = useState<Empresa[]>([]);
    useEffect(() => { if (abierta) getEmpresas().then((l) => setEmpresas(l.filter((e) => e.activa))).catch(() => setEmpresas([])); }, [abierta]);
    const lotes = useMemo(() => { const q = busca.trim().toLowerCase(); return (datos?.lotes || []).filter((l) => !q || l.nombre.toLowerCase().includes(q) || (l.numero || "").toLowerCase().includes(q)).slice(0, 60); }, [datos, busca]);

    async function guardar() {
        if (!tipo) return;
        setGuardando(true);
        try {
            const r = await registrarVisita({ tipo, unitId: lote?.id || null, plate: plate.trim() || null, nombre, empresa, guardia: guardName });
            if (!r.ok) { toast.error("No se pudo registrar", { description: r.error }); return; }
            toast.success(`${r.visita.tipoNombre} registrado`, { description: `${r.visita.loteNombre || "Sin lote"} · ${r.visita.minutosTipo} min` });
            alRegistrar();
        } finally { setGuardando(false); }
    }

    return (
        <AnimatePresence>
            {abierta && (
                <motion.div key="alta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="fixed inset-0 z-[300] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6" onClick={alCerrar}>
                    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 38 }}
                        onClick={(e) => e.stopPropagation()} className="w-full md:max-w-3xl max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl md:rounded-3xl p-5 md:p-7 space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-2xl font-bold text-black">Registrar visita</h3>
                            <button onClick={alCerrar} className={cn("grid h-12 w-12 place-items-center rounded-2xl bg-black/5", tocable)} aria-label="Cerrar"><X size={24} /></button>
                        </div>
                        {!datos ? <div className="py-12 grid place-items-center text-black/40"><Loader2 className="animate-spin" /></div> : (
                            <>
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-widest text-black/40 mb-2">1 · Qué es</div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        {datos.tipos.map((t) => { const Ic = ICONO_TIPO[t.clave] || Users; return (
                                            <button key={t.clave} onClick={() => setTipo(t.clave)} className={cn("h-24 rounded-2xl border-2 flex flex-col items-center justify-center gap-1", tocable, tipo === t.clave ? "border-[#B20D30] bg-[#B20D30]/5 text-[#B20D30]" : "border-black/10 text-black/70")}>
                                                <Ic size={26} /><span className="font-bold">{t.nombre}</span><span className="text-xs opacity-60 tabular-nums">{t.minutos} min</span>
                                            </button>
                                        ); })}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-widest text-black/40 mb-2">2 · A qué lote va {lote && <span className="normal-case tracking-normal text-black font-bold ml-1">· {lote.nombre}</span>}</div>
                                    <div className="relative mb-2">
                                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30" />
                                        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar lote" className="w-full h-14 pl-11 pr-4 rounded-2xl border border-black/10 bg-black/[0.02] text-lg outline-none focus:border-[#B20D30]" />
                                    </div>
                                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 max-h-[30vh] overflow-y-auto">
                                        {lotes.map((l) => (
                                            <button key={l.id} onClick={() => setLote(lote?.id === l.id ? null : l)} className={cn("h-14 rounded-xl border-2 font-bold text-sm truncate px-2", tocable, lote?.id === l.id ? "border-[#B20D30] bg-[#B20D30] text-white" : "border-black/10 text-black/70")}>{l.nombre}</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-widest text-black/40 mb-2">3 · Si se ve (opcional)</div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                        <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="MATRÍCULA" className="h-14 px-4 rounded-2xl border border-black/10 text-lg font-bold tracking-widest uppercase outline-none focus:border-[#B20D30]" />
                                        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className="h-14 px-4 rounded-2xl border border-black/10 text-lg outline-none focus:border-[#B20D30]" />
                                        <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Empresa (Rappi, PedidosYa…)" className="h-14 px-4 rounded-2xl border border-black/10 text-lg outline-none focus:border-[#B20D30]" />
                                    </div>
                                    <p className="text-xs text-black/40 mt-2">Con matrícula, la visita se cierra sola cuando la cámara de Salida la lee. Sin matrícula, la cerrás vos con «Salió».</p>
                                </div>
                                {/* Las empresas del catálogo, para tocar en vez de tipear: así la visita queda
                                    con el nombre del catálogo y su logo sale sobre la captura. */}
                                {empresas.length > 0 && (
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-widest text-black/40 mb-2">4 · De qué empresa (opcional)</div>
                                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 max-h-[24vh] overflow-y-auto">
                                            {empresas.map((e) => {
                                                const si = normalizarNombre(empresa) === normalizarNombre(e.nombre);
                                                return (
                                                    <button key={e.clave} onClick={() => setEmpresa(si ? "" : e.nombre)} aria-pressed={si}
                                                        className={cn("h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 px-1.5", tocable, si ? "border-[#B20D30] bg-[#B20D30]/5" : "border-black/10")}>
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        {e.logo ? <img src={e.logo} alt="" className="max-h-7 max-w-full object-contain" /> : null}
                                                        <span className={cn("text-[11px] font-bold truncate max-w-full", si ? "text-[#B20D30]" : "text-black/70")}>{e.nombre}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                <button onClick={guardar} disabled={!tipo || guardando} className={cn("w-full h-16 rounded-2xl bg-[#B20D30] text-white text-lg font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40", tocable)}>
                                    {guardando ? <Loader2 className="animate-spin" /> : <Check size={22} />} Registrar
                                </button>
                            </>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// ─────────────────── Visita sin lote, con seguimiento (change visita-sin-lote) ───────────────────

/** Fracción del plazo en la que la tarjeta pasa de verde a ámbar (la mitad: 5 de 10 min). */
const FRACCION_SEG = 0.5;
const MOTIVOS: { clave: string; texto: string }[] = [
    { clave: "SALIO_SIN_LOTE", texto: "Se fue / salió" },
    { clave: "NO_INGRESO", texto: "No lo dejaron entrar" },
    { clave: "SE_EQUIVOCO", texto: "Se equivocó de barrio" },
    { clave: "OTRO", texto: "Otro" },
];

/** Un pitido corto (sin archivos): al vencer un seguimiento, una vez. */
function pitar() {
    try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctx) return;
        const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = "square"; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
        o.start(); o.stop(ctx.currentTime + 0.6);
    } catch { }
    try { navigator.vibrate?.([300, 120, 300]); } catch { }
}

const horaCorta = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false });

function TarjetaSeguimiento({ v, ahora, plazoMin, alAsignar, alProrrogar, alCerrar, prorrogaMin }: { v: VisitaFila; ahora: number; plazoMin: number; prorrogaMin: number; alAsignar: () => void; alProrrogar: () => void; alCerrar: () => void }) {
    const vence = +new Date(v.seguimientoVence!);
    const resta = vence - ahora;
    const total = Math.max(1, plazoMin * 60_000);
    const estado = resta < 0 ? "vencida" : resta < total * FRACCION_SEG ? "cerca" : "ok";
    const pct = Math.max(0, Math.min(100, (resta / total) * 100));
    const foto = v.foto ? getImagePath(v.foto) : null;
    const color = estado === "vencida" ? "text-red-600" : estado === "cerca" ? "text-amber-600" : "text-emerald-600";
    const barra = estado === "vencida" ? "bg-red-600" : estado === "cerca" ? "bg-amber-500" : "bg-emerald-500";
    return (
        <motion.div layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}
            className={cn("rounded-3xl border-2 p-4 flex flex-col gap-3",
                estado === "vencida" ? "border-red-500 bg-gradient-to-b from-red-50 to-white animate-[pulse_1.4s_ease-in-out_infinite]" : estado === "cerca" ? "border-amber-400 bg-gradient-to-b from-amber-50 to-white" : "border-emerald-300 bg-gradient-to-b from-emerald-50 to-white")}>
            <div className="flex items-start gap-3">
                <div className="relative w-28 h-[72px] rounded-2xl bg-neutral-800 overflow-hidden shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {foto && <img src={conAncho(foto, 320) || undefined} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                    {!foto && <span className="absolute inset-0 grid place-items-center text-white/40"><Car size={26} /></span>}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-0.5 rounded-lg bg-black text-white font-black tracking-[0.14em] tabular-nums text-lg">{v.plate || "SIN MATRÍCULA"}</span>
                        <span className={cn("px-2.5 py-0.5 rounded-full text-[11px] font-extrabold", estado === "vencida" ? "bg-red-100 text-red-800" : estado === "cerca" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>{estado === "vencida" ? "VENCIDA · asigná el lote" : "SIN LOTE"}</span>
                    </div>
                    <div className="text-sm text-black/60 mt-1 truncate">{v.tipoNombre}{v.nombre ? ` · ${v.nombre}` : ""} · entró {horaCorta(v.entra)}{v.registradaPor ? ` · ${v.registradaPor}` : ""}</div>
                    {v.vistoEn && <div className="text-[13px] text-black/80 mt-1 inline-flex items-center gap-1.5"><Eye size={14} /> Visto en: {v.vistoEn}{v.vistoAt ? ` · ${horaCorta(v.vistoAt)}` : ""}</div>}
                </div>
                <div className={cn("text-right tabular-nums font-black leading-none shrink-0", color)}>
                    <div className="text-4xl">{mmss(resta)}</div>
                    <div className="text-[10px] uppercase tracking-widest mt-1 opacity-70 font-extrabold">{resta < 0 ? "pasado" : "para el lote"}</div>
                </div>
            </div>
            <div className="h-2 rounded-full bg-black/[0.07] overflow-hidden"><div className={cn("h-full rounded-full transition-[width] duration-1000 ease-linear", barra)} style={{ width: `${pct}%` }} /></div>
            <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
                <button onClick={alAsignar} className={cn("h-14 rounded-2xl bg-[#B20D30] text-white font-bold text-base inline-flex items-center justify-center gap-2", tocable)}><MapPin size={20} /> Asignar lote</button>
                <button onClick={alProrrogar} className={cn("h-14 rounded-2xl border-2 border-black/10 bg-white font-bold text-base", tocable)}>+{prorrogaMin} min</button>
                <button onClick={alCerrar} className={cn("h-14 rounded-2xl bg-black text-white font-bold text-base", tocable)}>Cerrar</button>
            </div>
        </motion.div>
    );
}

function AltaSinLote({ abierta, alCerrar, guardName, alRegistrar }: { abierta: boolean; alCerrar: () => void; guardName: string; alRegistrar: () => void }) {
    const [datos, setDatos] = useState<Datos | null>(null);
    const [tipo, setTipo] = useState("");
    const [plate, setPlate] = useState("");
    const [nombre, setNombre] = useState("");
    const [lectura, setLectura] = useState<Awaited<ReturnType<typeof ultimaEntradaParaSeguimiento>>>(null);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => {
        if (!abierta) return;
        setTipo(""); setPlate(""); setNombre(""); setLectura(null);
        datosParaRegistrar().then((d) => { setDatos(d); setTipo(d.tipos.find((t) => t.clave === "VISITA")?.clave || d.tipos[0]?.clave || ""); }).catch((e) => toast.error("No se pudo abrir", { description: e?.message }));
        // La última lectura de la Entrada: casi siempre es el auto que está parado en la garita.
        ultimaEntradaParaSeguimiento().then((l) => { setLectura(l); if (l) setPlate(l.plate); }).catch(() => { });
    }, [abierta]);
    async function guardar() {
        if (!tipo) return;
        setGuardando(true);
        try {
            const r = await registrarVisitaSinLote({ tipo, plate: plate.trim() || null, nombre, guardia: guardName, accessEventId: lectura && lectura.plate === plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ? lectura.id : null });
            if (!r.ok) { toast.error("No se pudo registrar", { description: r.error }); return; }
            toast.success("Seguimiento iniciado", { description: `${r.visita.plate || "Sin matrícula"} · ${datos?.sinLoteMin ?? 10} min para asignar el lote` });
            alRegistrar();
        } finally { setGuardando(false); }
    }
    const fotoL = lectura?.foto ? getImagePath(lectura.foto) : null;
    const hace = lectura ? Math.max(0, Math.round((Date.now() - +new Date(lectura.ts)) / 1000)) : 0;
    return (
        <AnimatePresence>
            {abierta && (
                <motion.div key="alta-sl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[300] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={alCerrar}>
                    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 38 }}
                        onClick={(e) => e.stopPropagation()} className="w-full md:max-w-3xl max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl md:rounded-3xl p-5 md:p-7 space-y-5">
                        <div className="flex items-start justify-between gap-3">
                            <div><h3 className="text-2xl font-bold text-black">Visita sin lote</h3><p className="text-sm text-black/50">Entra, pero todavía no se sabe a qué lote va. Le hacés seguimiento y le asignás el lote cuando se sepa.</p></div>
                            <button onClick={alCerrar} className={cn("grid h-12 w-12 place-items-center rounded-2xl bg-black/5 shrink-0", tocable)} aria-label="Cerrar"><X size={24} /></button>
                        </div>
                        {!datos ? <div className="py-12 grid place-items-center text-black/40"><Loader2 className="animate-spin" /></div> : (
                            <>
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-widest text-black/40 mb-2">1 · Matrícula</div>
                                    <div className={cn("flex items-center gap-3 rounded-2xl p-3", lectura ? "border-2 border-[#B20D30] bg-[#B20D30]/[0.04]" : "border border-black/10")}>
                                        {lectura && (
                                            <div className="relative w-36 h-24 rounded-xl bg-neutral-800 overflow-hidden shrink-0">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                {fotoL && <img src={conAncho(fotoL, 320) || undefined} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs text-black/50 mb-1">{lectura ? `Última lectura de la Entrada${lectura.camara ? ` · ${lectura.camara}` : ""} · hace ${hace < 60 ? `${hace} s` : `${Math.round(hace / 60)} min`}` : "No hay una lectura reciente de la Entrada: escribila."}</div>
                                            <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="MATRÍCULA" className="w-full h-14 px-4 rounded-2xl border border-black/10 text-xl font-black tracking-[0.14em] uppercase outline-none focus:border-[#B20D30]" />
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-widest text-black/40 mb-2">2 · Qué es</div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        {datos.tipos.filter((t) => !esPaseLibre(t.clave)).map((t) => { const Ic = ICONO_TIPO[t.clave] || Users; return (
                                            <button key={t.clave} onClick={() => setTipo(t.clave)} className={cn("h-20 rounded-2xl border-2 flex flex-col items-center justify-center gap-1", tocable, tipo === t.clave ? "border-[#B20D30] bg-[#B20D30]/5 text-[#B20D30]" : "border-black/10 text-black/70")}>
                                                <Ic size={24} /><span className="font-bold">{t.nombre}</span>
                                            </button>
                                        ); })}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-widest text-black/40 mb-2">3 · Si se sabe (opcional)</div>
                                    <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de quien entra, o a quién dice que viene" className="w-full h-14 px-4 rounded-2xl border border-black/10 text-lg outline-none focus:border-[#B20D30]" />
                                </div>
                                <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                                    <Timer size={22} className="shrink-0" />
                                    <div>Tenés <b className="text-lg tabular-nums">{datos.sinLoteMin}:00</b> para asignarle el lote. La tarjeta queda arriba de todo acá y en el monitor LPR, con el tiempo corriendo.</div>
                                </div>
                                <button onClick={guardar} disabled={!tipo || guardando} className={cn("w-full h-16 rounded-2xl bg-[#B20D30] text-white text-lg font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40", tocable)}>
                                    {guardando ? <Loader2 className="animate-spin" /> : <Timer size={22} />} Registrar y empezar seguimiento
                                </button>
                            </>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function AsignarLote({ v, alCerrar, guardName, alListo }: { v: VisitaFila | null; alCerrar: () => void; guardName: string; alListo: () => void }) {
    const [lotes, setLotes] = useState<Datos["lotes"]>([]);
    const [busca, setBusca] = useState("");
    const [sel, setSel] = useState<{ id: string; nombre: string } | null>(null);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (!v) return; setBusca(""); setSel(null); datosParaRegistrar().then((d) => setLotes(d.lotes)).catch(() => setLotes([])); }, [v]);
    const filtrados = useMemo(() => {
        const q = busca.trim().toLowerCase();
        return lotes.filter((l) => !q || l.nombre.toLowerCase().includes(q) || (l.numero || "").toLowerCase().includes(q) || (l.titular || "").toLowerCase().includes(q)).slice(0, 90);
    }, [lotes, busca]);
    async function asignar() {
        if (!v || !sel) return;
        setGuardando(true);
        try {
            const r = await asignarLoteAMano(v.id, sel.id, guardName);
            if (!r.ok) { toast.error("No se pudo asignar", { description: r.error }); return; }
            toast.success(`${v.plate || "Visita"} → ${sel.nombre}`, { description: "Seguimiento cerrado" });
            alListo();
        } finally { setGuardando(false); }
    }
    return (
        <AnimatePresence>
            {v && (
                <motion.div key="asig" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[300] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={alCerrar}>
                    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 38 }}
                        onClick={(e) => e.stopPropagation()} className="w-full md:max-w-3xl max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl md:rounded-3xl p-5 md:p-7 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                            <div><h3 className="text-2xl font-bold text-black">Asignar lote · {v.plate || "sin matrícula"}</h3><p className="text-sm text-black/50">Buscá por lote o por el nombre del residente. Al elegirlo, el seguimiento se cierra y la visita sigue con su tiempo normal.</p></div>
                            <button onClick={alCerrar} className={cn("grid h-12 w-12 place-items-center rounded-2xl bg-black/5 shrink-0", tocable)} aria-label="Cerrar"><X size={24} /></button>
                        </div>
                        <div className="relative">
                            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30" />
                            <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="G17, Pérez…" className="w-full h-14 pl-11 pr-4 rounded-2xl border border-black/10 bg-black/[0.02] text-lg outline-none focus:border-[#B20D30]" />
                        </div>
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-2 max-h-[40vh] overflow-y-auto">
                            {filtrados.map((l) => (
                                <button key={l.id} onClick={() => setSel(sel?.id === l.id ? null : l)} className={cn("min-h-[60px] rounded-xl border-2 px-2 py-1.5 text-left", tocable, sel?.id === l.id ? "border-[#B20D30] bg-[#B20D30] text-white" : "border-black/10 text-black")}>
                                    <span className="block font-bold">{l.nombre}</span>
                                    {l.titular && <span className={cn("block text-[11px] truncate", sel?.id === l.id ? "text-white/80" : "text-black/50")}>{l.titular}</span>}
                                </button>
                            ))}
                            {!filtrados.length && <div className="col-span-full py-6 text-center text-black/40">Ningún lote con «{busca}»</div>}
                        </div>
                        <button onClick={asignar} disabled={!sel || guardando} className={cn("w-full h-16 rounded-2xl bg-[#B20D30] text-white text-lg font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40", tocable)}>
                            {guardando ? <Loader2 className="animate-spin" /> : <Check size={22} />} {sel ? `Asignar ${sel.nombre}` : "Elegí el lote"}
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function CerrarSinLote({ v, alCerrar, guardName, alListo }: { v: VisitaFila | null; alCerrar: () => void; guardName: string; alListo: () => void }) {
    const [motivo, setMotivo] = useState("SALIO_SIN_LOTE");
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (v) setMotivo("SALIO_SIN_LOTE"); }, [v]);
    async function cerrar() {
        if (!v) return;
        setGuardando(true);
        try {
            const r = await cerrarSinLoteAMano(v.id, motivo, guardName);
            if (!r.ok) { toast.error("No se pudo cerrar", { description: r.error }); return; }
            toast.success(`${v.plate || "Visita"} · cerrada sin lote`);
            alListo();
        } finally { setGuardando(false); }
    }
    return (
        <AnimatePresence>
            {v && (
                <motion.div key="cerr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[300] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={alCerrar}>
                    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 38 }}
                        onClick={(e) => e.stopPropagation()} className="w-full md:max-w-xl bg-white rounded-t-3xl md:rounded-3xl p-5 md:p-7 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                            <div><h3 className="text-2xl font-bold text-black">Cerrar sin lote</h3><p className="text-sm text-black/50">Queda en la bitácora como cerrada sin lote, con el motivo y tu nombre.</p></div>
                            <button onClick={alCerrar} className={cn("grid h-12 w-12 place-items-center rounded-2xl bg-black/5 shrink-0", tocable)} aria-label="Cerrar"><X size={24} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {MOTIVOS.map((m) => <button key={m.clave} onClick={() => setMotivo(m.clave)} className={cn("h-16 rounded-2xl border-2 font-bold", tocable, motivo === m.clave ? "border-black bg-black text-white" : "border-black/10 text-black")}>{m.texto}</button>)}
                        </div>
                        <button onClick={cerrar} disabled={guardando} className={cn("w-full h-16 rounded-2xl bg-black text-white text-lg font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40", tocable)}>
                            {guardando ? <Loader2 className="animate-spin" /> : <LogOut size={22} />} Cerrar sin lote
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
