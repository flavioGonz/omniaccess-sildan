"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Clock, X, Check, Search, Loader2, Bike, Wrench, HardHat, Users, Ticket, LogOut, AlertTriangle, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/avisos";
import {
    datosParaRegistrar, registrarVisita, cerrarVisitaAMano, extenderVisitaAMano, visitasEnCurso, avisosPendientes, atenderAvisoAMano,
    type VisitaFila, type AvisoFila,
} from "@/app/actions/visitas";
import { ETIQUETA_AVISO, type TipoAviso } from "@/lib/visitas/presentacion";
import { getEmpresas } from "@/app/actions/empresas";
import { normalizarNombre, type Empresa } from "@/lib/empresas";

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
    const ordenadas = useMemo(() => [...visitas].sort((a, b) => +new Date(a.vence) - +new Date(b.vence)), [visitas]);

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
                    <button onClick={() => setAlta(true)} className={cn("h-14 px-6 rounded-2xl bg-[#B20D30] text-white font-bold text-base inline-flex items-center gap-2 shadow-lg shadow-[#B20D30]/20", tocable)}>
                        <Plus size={22} /> Registrar visita
                    </button>
                </div>

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
                                const estado = resta < 0 ? "excedida" : resta < total * FRACCION_AVISO ? "cerca" : "ok";
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
                                                <div className="text-3xl">{mmss(resta)}</div>
                                                <div className="text-[10px] uppercase tracking-widest mt-1 opacity-60">{estado === "excedida" ? "excedida" : "restan"}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {EXTENSIONES.map((m) => <button key={m} onClick={() => extender(v, m)} className={cn("h-12 flex-1 rounded-xl border border-black/10 bg-black/[0.03] font-bold text-black", tocable)}>+{m}</button>)}
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
