"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Siren, ShieldCheck, ShieldOff, Wrench, FlaskConical, HeartPulse, CircleHelp, RotateCcw, Copy, Radio } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Filtros } from "@/components/ui/filtros";
import { Estado, Momento, type Tono } from "@/components/ui/celdas";
import { useTiempoReal } from "@/lib/tiempo-real";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";

/**
 * La pestaña «Centrales» de Gestión de alarmas (22/10, Nico: «¿no debe tener un módulo para mostrar
 * los mensajes que llegan, estilizados?»): lo que contaron las centrales de alarma, en lenguaje de
 * guardia — «Desarmado · usuario 5», «Robo · Zona 20 · Portón» — y no la trama cruda, que queda en
 * el detalle para quien la necesite.
 *
 * Es el registro del receptor, no la lista de alarmas: también entran el armado, las fallas, las
 * pruebas y lo que se confirmó sin usarse (una cuenta que no está dada de alta). Un robo aparece
 * acá Y en «Alarmas»; acá para ver la historia de la central, allá para atenderlo.
 */

export type Evento = { categoria: string; tipo: string; texto: string; codigo: string | null; zona?: number | null; particion?: number | null; usuario?: number | null; modulo?: number | null };
export type Mensaje = {
    id: string; recibido: string; centralId: string | null; cuenta: string | null; ip: string | null; transporte: string | null; idMensaje: string | null;
    cifrado: boolean; crudo: string | null; datos: string | null; horaCentral: string | null; respuesta: string; error: string | null; eventos: Evento[] | null; detectionId: string | null;
};
export type CentralCorta = { id: string; cuenta: string; deviceId: string; nombre: string; estado: string; prueba: boolean; zonas: { zona: number; nombre: string | null; areaId: string | null }[] };
type Datos = { horas: number; tope: boolean; centrales: CentralCorta[]; mensajes: Mensaje[] };

/** Qué se mira: los grupos de categorías del traductor (lib-dc09-codigos). */
export type QueCentral = "eventos" | "alarmas" | "armado" | "fallas" | "pruebas" | "sin-usar";
const CATEGORIAS: Record<Exclude<QueCentral, "eventos" | "sin-usar">, string[]> = {
    alarmas: ["ALARMA", "RESTAURACION"], armado: ["ARMADO", "DESARMADO"], fallas: ["FALLA", "FALLA_FIN"], pruebas: ["PRUEBA"],
};

const ESTILO: Record<string, { icono: typeof Siren; tono: Tono }> = {
    ALARMA: { icono: Siren, tono: "mal" }, RESTAURACION: { icono: RotateCcw, tono: "quieto" },
    ARMADO: { icono: ShieldCheck, tono: "info" }, DESARMADO: { icono: ShieldOff, tono: "neutro" },
    FALLA: { icono: Wrench, tono: "aviso" }, FALLA_FIN: { icono: Wrench, tono: "bien" },
    PRUEBA: { icono: FlaskConical, tono: "quieto" }, OTRO: { icono: CircleHelp, tono: "neutro" },
};
const TONO_TEXTO: Record<Tono, string> = { mal: "tono-mal", aviso: "tono-aviso", info: "tono-info", bien: "tono-bien", quieto: "text-muted-foreground", neutro: "text-muted-foreground" };

const ERROR_TXT: Record<string, string> = {
    "cuenta-desconocida": "Cuenta no dada de alta", "sin-cifrar": "Llegó sin cifrar", "hora-fuera-de-ventana": "Hora de la central desfasada",
    descifrado: "No se pudo descifrar", "sin-clave": "Cifrado sin clave", crc: "Trama dañada", largo: "Trama demasiado larga", forma: "Trama ilegible", id: "Protocolo no soportado", hora: "Hora ilegible",
};
const VIA: Record<string, string> = { cms: "Receptor", tcp: "TCP", udp: "UDP" };

const primero = (m: Mensaje): Evento | null => (Array.isArray(m.eventos) && m.eventos.length ? m.eventos[0] : null);
/** La supervisión («sigo vivo», NULL en DC-09): cuenta como vida de la central, no como evento. */
const esVida = (m: Mensaje) => m.idMensaje === "NULL" && !m.error;
const sinUsar = (m: Mensaje) => !!m.error || m.respuesta !== "ACK";

export function useMensajesCentrales(horas: number) {
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const traer = useCallback(() => {
        fetch(`/api/centrales/mensajes?h=${horas}`, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j as Datos; })
            .then((j) => { setDatos(j); setError(null); })
            .catch((e) => setError(e?.message || "No se pudieron leer los mensajes."))
            .finally(() => setCargando(false));
    }, [horas]);
    useEffect(() => { setCargando(true); traer(); const iv = setInterval(traer, 30_000); return () => clearInterval(iv); }, [traer]);
    // Cada mensaje que entra lo avisa el receptor (alarm-receiver → central_mensaje): se pide con un
    // respiro, porque un receptor que descarga su cola manda uno cada pocos segundos.
    const [pulso, setPulso] = useState(0);
    useTiempoReal("central_mensaje", useCallback(() => setPulso((n) => n + 1), []));
    useEffect(() => { if (!pulso) return; const t = setTimeout(traer, 1500); return () => clearTimeout(t); }, [pulso, traer]);
    return { datos, error, cargando, traer };
}

/** Qué central es un mensaje, y cómo se llama su zona. */
function useCentrales(datos: Datos | null) {
    return useMemo(() => {
        const porId = new Map((datos?.centrales || []).map((c) => [c.id, c]));
        const zona = (m: Mensaje, n: number | null | undefined) => {
            if (n == null) return null;
            const z = m.centralId ? porId.get(m.centralId)?.zonas.find((x) => x.zona === n) : null;
            return z?.nombre ? `Zona ${n} · ${z.nombre}` : `Zona ${n}`;
        };
        return { porId, zona };
    }, [datos]);
}

/** «Zona 20 · Portón», «Partición 1 · usuario 5», …: dónde pasó, en palabras. */
function dondeDe(m: Mensaje, e: Evento | null, zona: (m: Mensaje, n: number | null | undefined) => string | null) {
    if (!e) return null;
    const partes = [zona(m, e.zona), e.particion ? `Partición ${e.particion}` : null, e.usuario ? `usuario ${e.usuario}` : null, e.modulo ? `módulo ${e.modulo}` : null].filter(Boolean);
    return partes.length ? partes.join(" · ") : null;
}

export function TablaMensajesCentrales({ horas, setHoras, datos, error, cargando, traer, sel, alElegir, enArea, que, setQue }: {
    horas: number; setHoras: (h: number) => void;
    datos: Datos | null; error: string | null; cargando: boolean; traer: () => void;
    sel: string | null; alElegir: (id: string | null) => void;
    /** El filtro de área de la página, por el equipo de la central (y el área de la zona, si la tiene). */
    enArea: (deviceId: string | null, areaZona?: string | null) => boolean;
    que: QueCentral; setQue: (q: QueCentral) => void;
}) {
    const { porId, zona } = useCentrales(datos);
    const [busqueda, setBusqueda] = useState("");
    const [conVida, setConVida] = useState(false);
    const t = busqueda.trim().toUpperCase();

    const delArea = useCallback((m: Mensaje) => {
        const c = m.centralId ? porId.get(m.centralId) : null;
        if (!c) return enArea(null);
        const e = primero(m);
        const z = e?.zona != null ? c.zonas.find((x) => x.zona === e.zona) : null;
        return enArea(c.deviceId, z?.areaId || null);
    }, [porId, enArea]);

    const base = useMemo(() => (datos?.mensajes || []).filter(delArea), [datos, delArea]);
    const encaja = useCallback((m: Mensaje, q: QueCentral) => {
        if (q === "sin-usar") return sinUsar(m);
        if (sinUsar(m)) return false;
        if (esVida(m)) return q === "eventos" && conVida;
        if (q === "eventos") return true;
        const e = primero(m);
        return !!e && CATEGORIAS[q].includes(e.categoria);
    }, [conVida]);
    const filas = useMemo(() => base.filter((m) => encaja(m, que)).filter((m) => {
        if (!t) return true;
        const c = m.centralId ? porId.get(m.centralId) : null;
        const e = primero(m);
        return [c?.nombre, m.cuenta, e?.texto, e?.codigo, dondeDe(m, e, zona), m.crudo].some((x) => (x || "").toUpperCase().includes(t));
    }), [base, que, t, encaja, porId, zona]);
    const cuenta = (q: QueCentral) => base.filter((m) => encaja(m, q)).length;

    const columnas = useMemo<ColumnaTabla<Mensaje>[]>(() => [
        { clave: "hora", titulo: "Hora", ancho: 92, ordenable: true, valor: (m) => m.recibido, celda: (m) => <Momento t={m.recibido} /> },
        { clave: "evento", titulo: "Evento", valor: (m) => primero(m)?.texto || (esVida(m) ? "Supervisión" : ERROR_TXT[m.error || ""] || m.error || "—"), celda: (m) => {
            const e = primero(m);
            if (sinUsar(m)) return (
                <div className="flex items-center gap-2.5 min-w-0"><CircleHelp size={15} className="shrink-0 tono-aviso" />
                    <div className="min-w-0 leading-tight"><div className="text-[13px] font-semibold truncate">{ERROR_TXT[m.error || ""] || m.error || "Rechazado"}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{e ? `${e.texto} · sin usar` : m.respuesta === "ACK" ? "Se confirmó y no se usó" : `Se contestó ${m.respuesta}`}</div></div></div>);
            if (!e) return <div className="flex items-center gap-2.5"><HeartPulse size={15} className="shrink-0 text-muted-foreground" /><span className="text-[13px] text-muted-foreground">Supervisión: la central sigue en línea</span></div>;
            const st = ESTILO[e.categoria] || ESTILO.OTRO; const I = st.icono;
            const mas = (m.eventos?.length || 0) - 1;
            return (
                <div className="flex items-center gap-2.5 min-w-0"><I size={15} className={cn("shrink-0", TONO_TEXTO[st.tono])} />
                    <div className="min-w-0 leading-tight"><div className={cn("text-[13px] font-semibold truncate", e.categoria === "ALARMA" && "tono-mal")}>{e.texto}{mas > 0 ? <span className="text-muted-foreground font-normal"> · y {mas} más</span> : null}</div>
                        {e.codigo && <div className="text-[11px] text-muted-foreground tabular-nums">{e.codigo}</div>}</div></div>);
        } },
        { clave: "donde", titulo: "Dónde", ancho: 220, valor: (m) => dondeDe(m, primero(m), zona) || "", celda: (m) => <span className="text-[12px] text-muted-foreground line-clamp-2">{dondeDe(m, primero(m), zona) || "—"}</span> },
        { clave: "central", titulo: "Central", ancho: 210, valor: (m) => (m.centralId && porId.get(m.centralId)?.nombre) || `Cuenta ${m.cuenta || "?"}`, celda: (m) => {
            const c = m.centralId ? porId.get(m.centralId) : null;
            return (
                <div className="min-w-0 leading-tight">
                    <div className={cn("text-[13px] truncate", c ? "font-semibold" : "text-muted-foreground")}>{c ? c.nombre : m.cuenta ? `Cuenta ${m.cuenta}` : "Sin cuenta"}</div>
                    <div className="text-[11px] text-muted-foreground truncate tabular-nums">{c ? `cuenta ${c.cuenta}${c.prueba ? " · de prueba" : ""}` : m.cuenta ? "sin dar de alta" : m.ip || ""}</div>
                </div>);
        } },
        { clave: "via", titulo: "Llegó por", ancho: 150, valor: (m) => `${VIA[m.transporte || ""] || m.transporte || ""} ${m.ip || ""}`, celda: (m) => (
            <div className="leading-tight min-w-0"><div className="text-[12px]">{VIA[m.transporte || ""] || (m.transporte || "—").toUpperCase()}{m.cifrado ? " · cifrado" : ""}</div><div className="text-[11px] text-muted-foreground tabular-nums truncate">{m.ip || ""}</div></div>) },
        { clave: "resp", titulo: "", ancho: 70, auxiliar: true, alinear: "der", valor: (m) => m.respuesta, celda: (m) => <Estado tono={m.respuesta === "ACK" ? (m.error ? "aviso" : "bien") : "mal"}>{m.respuesta}</Estado> },
    ], [porId, zona]);

    return (
        <Tabla<Mensaje> alto="100%" className="flex-1 min-h-0" seleccionCeldas={false} cargando={cargando && !datos} error={!datos ? error : null} alReintentar={traer}
            id="alarmas-centrales" filas={filas} clave={(m) => m.id} columnas={columnas}
            alClickFila={(m) => alElegir(sel === m.id ? null : m.id)} filaActiva={(m) => m.id === sel}
            filaDestacada={(m) => primero(m)?.categoria === "ALARMA" && Date.now() - new Date(m.recibido).getTime() < 60_000}
            vacio={{ titulo: t ? "Nada con esa búsqueda" : !datos?.centrales.length ? "Todavía no hay centrales dadas de alta" : "Las centrales no mandaron nada en este rango", ayuda: t ? undefined : "Se actualiza sola con cada mensaje que llega." }}
            pie={<span className="tabular-nums">{filas.length} mensajes · últimas {horas} h{datos?.tope ? " · se muestran los 3000 más nuevos" : ""}</span>}
            barra={
                <div className="flex items-center gap-2 flex-wrap">
                    <Filtros busqueda={busqueda} alBuscar={setBusqueda} placeholder="Central, cuenta, zona o evento"
                        grupos={[{ clave: "que", titulo: "Qué mensajes", valor: que, alElegir: (v) => setQue(v as QueCentral), opciones: [
                            { valor: "eventos", rotulo: "Todos", cuenta: cuenta("eventos") },
                            { valor: "alarmas", rotulo: "Alarmas", cuenta: cuenta("alarmas"), tono: cuenta("alarmas") ? "mal" : undefined },
                            { valor: "armado", rotulo: "Armado", cuenta: cuenta("armado") },
                            { valor: "fallas", rotulo: "Fallas", cuenta: cuenta("fallas"), tono: cuenta("fallas") ? "aviso" : undefined },
                            { valor: "pruebas", rotulo: "Pruebas", cuenta: cuenta("pruebas") },
                            { valor: "sin-usar", rotulo: "Sin usar", cuenta: cuenta("sin-usar") },
                        ] }]} />
                    <div className="ml-auto flex items-center gap-2">
                        <button type="button" onClick={() => setConVida((v) => !v)} aria-pressed={conVida}
                            title="La supervisión («sigo vivo») de cada central: llega cada pocos minutos y tapa los eventos, por eso va apagada."
                            className={cn("h-[34px] px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors", conVida ? "bg-[var(--accion)] text-white" : "bg-muted/60 text-muted-foreground hover:text-foreground")}>
                            <HeartPulse size={13} /> Supervisión
                        </button>
                        <span className="w-px h-5 bg-border" />
                        <Filtros grupos={[{ clave: "rango", titulo: "Hasta cuándo para atrás", valor: String(horas), alElegir: (v) => setHoras(Number(v)),
                            opciones: [{ valor: "24", rotulo: "24 h" }, { valor: "72", rotulo: "3 días" }, { valor: "168", rotulo: "7 días" }] }]} />
                    </div>
                </div>
            } />
    );
}

/** El panel de la derecha: el mensaje en palabras, cada evento que traía, y la trama tal cual llegó. */
export function DetalleMensajeCentral({ m, datos }: { m: Mensaje; datos: Datos | null }) {
    const { porId, zona } = useCentrales(datos);
    const c = m.centralId ? porId.get(m.centralId) : null;
    const eventos = Array.isArray(m.eventos) ? m.eventos : [];
    const copiar = (s: string) => { navigator.clipboard?.writeText(s).then(() => toast.success({ title: "Trama copiada" })).catch(() => { }); };
    return (
        <div className="p-5 space-y-5">
            <div className="flex items-start gap-3">
                <span className="grid place-items-center w-10 h-10 rounded-[10px] bg-muted/60 shrink-0"><Radio size={18} className="text-muted-foreground" /></span>
                <div className="min-w-0">
                    <div className="text-[15px] font-semibold truncate">{c ? c.nombre : m.cuenta ? `Cuenta ${m.cuenta}` : "Sin cuenta"}</div>
                    <div className="text-[12px] text-muted-foreground"><Momento t={m.recibido} />{c ? ` · cuenta ${c.cuenta}` : ""}</div>
                </div>
            </div>

            {sinUsar(m) && (
                <div className="rounded-[10px] chip-aviso px-3 py-2.5 text-[12.5px] leading-snug">
                    {m.error === "cuenta-desconocida"
                        ? <>La cuenta <b className="tabular-nums">{m.cuenta}</b> no está dada de alta: se le confirmó al receptor para que no se trabe, pero no generó alarma. Para usarla: Dispositivos › Agregar › Central de alarma{m.transporte === "cms" ? " › «Por un receptor»" : ""}, con esta cuenta.</>
                        : <>{ERROR_TXT[m.error || ""] || m.error || "Rechazado"}. Se contestó <b>{m.respuesta}</b>{m.respuesta === "ACK" ? " para que el receptor no se trabe, pero no se usó" : ""}.</>}
                </div>
            )}

            <div className="space-y-2">
                {eventos.length ? eventos.map((e, i) => {
                    const st = ESTILO[e.categoria] || ESTILO.OTRO; const I = st.icono;
                    return (
                        <div key={i} className="rounded-[10px] border border-border p-3 flex items-start gap-3">
                            <I size={16} className={cn("mt-0.5 shrink-0", TONO_TEXTO[st.tono])} />
                            <div className="min-w-0 flex-1 leading-snug">
                                <div className="text-[13.5px] font-semibold">{e.texto}</div>
                                <div className="text-[12px] text-muted-foreground">{dondeDe(m, e, zona) || "La central"}{e.codigo ? ` · ${e.codigo}` : ""}</div>
                            </div>
                            <Estado tono={st.tono}>{e.categoria === "ALARMA" ? "Alarma" : e.categoria === "RESTAURACION" ? "Restauración" : e.categoria === "ARMADO" ? "Armado" : e.categoria === "DESARMADO" ? "Desarmado" : e.categoria === "FALLA" ? "Falla" : e.categoria === "FALLA_FIN" ? "Normal" : e.categoria === "PRUEBA" ? "Prueba" : "Otro"}</Estado>
                        </div>);
                }) : <div className="text-[12.5px] text-muted-foreground">{esVida(m) ? "Supervisión: la central avisa que sigue en línea." : "Sin eventos traducidos."}</div>}
            </div>

            {m.detectionId && <a href={`/admin/alarmas?ver=alarmas&id=d:${m.detectionId}`} className="inline-flex text-[12.5px] font-semibold text-[var(--accion)] hover:underline">Ver la alarma que generó</a>}

            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
                <dt className="text-muted-foreground">Llegó por</dt><dd>{VIA[m.transporte || ""] || m.transporte || "—"}{m.ip ? ` · ${m.ip}` : ""}</dd>
                <dt className="text-muted-foreground">Protocolo</dt><dd>{m.idMensaje === "ADM-CID" ? "Contact ID" : m.idMensaje === "SIA-DCS" ? "SIA" : m.idMensaje || "—"}{m.cifrado ? " · cifrado AES" : ""}</dd>
                <dt className="text-muted-foreground">Respuesta</dt><dd>{m.respuesta}</dd>
                {m.horaCentral && <><dt className="text-muted-foreground">Hora de la central</dt><dd><Momento t={m.horaCentral} /></dd></>}
            </dl>

            {m.crudo && (
                <div>
                    <div className="flex items-center gap-2 mb-1.5"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex-1">Trama</span>
                        <button type="button" onClick={() => copiar(m.crudo!)} className="text-muted-foreground hover:text-foreground" aria-label="Copiar la trama"><Copy size={13} /></button></div>
                    <pre className="rounded-[10px] bg-muted/60 p-3 text-[11.5px] whitespace-pre-wrap break-all tabular-nums">{m.crudo}</pre>
                </div>
            )}
        </div>
    );
}

/** La pestaña entera: la tabla y, a la derecha, el mensaje elegido. Pide sus datos sólo mientras está a la vista. */
export function VistaCentrales({ horas, setHoras, enArea }: { horas: number; setHoras: (h: number) => void; enArea: (deviceId: string | null, areaZona?: string | null) => boolean }) {
    const { datos, error, cargando, traer } = useMensajesCentrales(horas);
    const [sel, setSel] = useState<string | null>(null);
    const [que, setQue] = useState<QueCentral>("eventos");
    const elegido = sel ? datos?.mensajes.find((m) => m.id === sel) || null : null;
    return (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_400px] xl:divide-x divide-border">
            <div className="min-h-0 flex flex-col p-4">
                <TablaMensajesCentrales horas={horas} setHoras={setHoras} datos={datos} error={error} cargando={cargando} traer={traer} sel={sel} alElegir={setSel} enArea={enArea} que={que} setQue={setQue} />
            </div>
            <aside className="hidden xl:flex flex-col min-h-0 overflow-y-auto">
                {elegido ? <DetalleMensajeCentral key={elegido.id} m={elegido} datos={datos} /> : (
                    <div className="flex-1 grid place-items-center p-8 text-center">
                        <div className="max-w-[260px] text-muted-foreground">
                            <Radio size={26} className="mx-auto mb-3 opacity-40" />
                            <div className="text-[13px] font-semibold text-foreground">Elegí un mensaje</div>
                            <div className="text-[12.5px] mt-1">Se ve cada evento que traía, dónde pasó y la trama tal cual llegó. Las alarmas se atienden en la pestaña «Alarmas».</div>
                        </div>
                    </div>
                )}
            </aside>
        </div>
    );
}
