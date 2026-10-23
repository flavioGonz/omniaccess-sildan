"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Siren, ShieldCheck, ShieldOff, Wrench, FlaskConical, HeartPulse, CircleHelp, RotateCcw, Copy, Radio } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Filtros } from "@/components/ui/filtros";
import { Estado, Momento, type Tono } from "@/components/ui/celdas";
import { useTiempoReal } from "@/lib/tiempo-real";
import { useAreas } from "@/lib/use-areas";
import { PRIORIDADES_DEFECTO, prioridadDe, nivel, type Prioridades } from "@/lib/centrales/prioridades";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { abrirEventoCentral } from "@/lib/centrales/abrir-evento";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { segATexto } from "@/lib/centrales/tratamiento-tipos";
import { Timer, ExternalLink, Layers, X } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { partesTrama, type TonoParte } from "@/lib/centrales/trama-partes";

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
type Datos = { horas: number; tope: boolean; centrales: CentralCorta[]; mensajes: Mensaje[]; prioridades?: Prioridades; sinTratar?: string[] };

/** Qué se mira: los grupos de categorías del traductor (lib-dc09-codigos). */
export type QueCentral = "eventos" | "alarmas" | "armado" | "fallas" | "pruebas" | "sin-usar";
const CATEGORIAS: Record<Exclude<QueCentral, "eventos" | "sin-usar">, string[]> = {
    alarmas: ["ALARMA", "RESTAURACION"], armado: ["ARMADO", "DESARMADO"], fallas: ["FALLA", "FALLA_FIN"], pruebas: ["PRUEBA"],
};

/** Los botones de «qué mensajes», iconográficos (22/10): el ícono es el mismo de la fila. */
const QUE_ICONOS: { q: QueCentral; I: typeof Siren; rotulo: string; tono?: string }[] = [
    { q: "eventos", I: Layers, rotulo: "Todos los mensajes" }, { q: "alarmas", I: Siren, rotulo: "Alarmas y restauraciones", tono: "pleno-mal" },
    { q: "armado", I: ShieldCheck, rotulo: "Armado y desarmado" }, { q: "fallas", I: Wrench, rotulo: "Fallas", tono: "pleno-aviso" },
    { q: "pruebas", I: FlaskConical, rotulo: "Pruebas" }, { q: "sin-usar", I: CircleHelp, rotulo: "Sin usar: cuenta no dada de alta, trama ilegible, rechazos" },
];
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
const sinTratarDe = (d: Datos | null, detId: string) => !!d?.sinTratar?.includes(detId);
/** La prioridad del mensaje: la de su evento más urgente (un mensaje SIA puede traer varios). Sin evento, ninguna. */
const prioridadMensaje = (m: Mensaje, p: Prioridades): number | null => {
    const evs = Array.isArray(m.eventos) ? m.eventos : [];
    return evs.length ? Math.min(...evs.map((e) => prioridadDe(p, e))) : null;
};
/** «P1 Crítica»: el chip de la prioridad, en el tono de su nivel. */
export function ChipPrioridad({ n, corto }: { n: number | null | undefined; corto?: boolean }) {
    if (n == null) return <span className="text-muted-foreground/50 text-[12px]">—</span>;
    const v = nivel(n);
    return <Estado tono={v.tono}>{corto ? `P${n}` : `P${n} · ${v.nombre}`}</Estado>;
}

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
    const { areas, equipoArea } = useAreas();
    return useMemo(() => {
        const porId = new Map((datos?.centrales || []).map((c) => [c.id, c]));
        const nombreArea = new Map(areas.map((a) => [a.id, a.nombre]));
        /** El área del mensaje: la de su zona si la tiene, si no la del equipo de la central. */
        const areaDe = (m: Mensaje): string | null => {
            const c = m.centralId ? porId.get(m.centralId) : null;
            if (!c) return null;
            const n = primero(m)?.zona;
            const z = n != null && n > 0 ? c.zonas.find((x) => x.zona === n) : null;
            const id = z?.areaId || equipoArea[c.deviceId] || null;
            return id ? nombreArea.get(id) || null : null;
        };
        const zona = (m: Mensaje, n: number | null | undefined) => {
            // «000» / 0 es «la central», no una zona: los mensajes guardados antes del arreglo del 21/10 la traen.
            if (n == null || n <= 0) return null;
            const z = m.centralId ? porId.get(m.centralId)?.zonas.find((x) => x.zona === n) : null;
            return z?.nombre ? `Zona ${n} · ${z.nombre}` : `Zona ${n}`;
        };
        return { porId, zona, areaDe };
    }, [datos, areas, equipoArea]);
}

/** «Zona 20 · Portón», «Partición 1 · usuario 5», …: dónde pasó, en palabras. */
function dondeDe(m: Mensaje, e: Evento | null, zona: (m: Mensaje, n: number | null | undefined) => string | null) {
    if (!e) return null;
    const partes = [zona(m, e.zona), e.particion ? `Partición ${e.particion}` : null, e.usuario ? `usuario ${e.usuario}` : null, e.modulo ? `módulo ${e.modulo}` : null].filter(Boolean);
    return partes.length ? partes.join(" · ") : null;
}

export function TablaMensajesCentrales({ horas, setHoras, datos, error, cargando, traer, sel, alElegir, enArea, que, setQue, area }: {
    horas: number; setHoras: (h: number) => void;
    datos: Datos | null; error: string | null; cargando: boolean; traer: () => void;
    sel: string | null; alElegir: (id: string | null) => void;
    /** El filtro de área de la página, por el equipo de la central (y el área de la zona, si la tiene). */
    enArea: (deviceId: string | null, areaZona?: string | null) => boolean;
    /** El área elegida arriba (Gestión de alarmas): para decir cuántos mensajes deja afuera y ofrecer verlos. */
    area?: { nombre: string | null; filtrando: boolean; verTodas: () => void };
    que: QueCentral; setQue: (q: QueCentral) => void;
}) {
    const { porId, zona, areaDe } = useCentrales(datos);
    const prio = datos?.prioridades || PRIORIDADES_DEFECTO;
    const sinTratarSet = useMemo(() => new Set(datos?.sinTratar || []), [datos]);
    const [busqueda, setBusqueda] = useState("");
    /** Prioridades elegidas; ninguna = todas. */
    const [niveles, setNiveles] = useState<string[]>([]);
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
    /*
     * Los que deja afuera el área elegida. 23/10, Nico: «¿no tengo alarmas?» — con el área de San
     * Nicolás elegida, la central de IES (de otra área) no mostraba nada y la pantalla decía «las
     * centrales no mandaron nada», que era falso: habían llegado 125 mensajes.
     */
    const fueraDeArea = area?.filtrando ? (datos?.mensajes.length || 0) - base.length : 0;
    const encaja = useCallback((m: Mensaje, q: QueCentral) => {
        if (q === "sin-usar") return sinUsar(m);
        if (sinUsar(m)) return false;
        if (esVida(m)) return q === "eventos" && conVida;
        if (q === "eventos") return true;
        const e = primero(m);
        return !!e && CATEGORIAS[q].includes(e.categoria);
    }, [conVida]);
    const filas = useMemo(() => base.filter((m) => encaja(m, que)).filter((m) => !niveles.length || niveles.includes(String(prioridadMensaje(m, prio)))).filter((m) => {
        if (!t) return true;
        const c = m.centralId ? porId.get(m.centralId) : null;
        const e = primero(m);
        return [c?.nombre, m.cuenta, areaDe(m), e?.texto, e?.codigo, dondeDe(m, e, zona), m.crudo].some((x) => (x || "").toUpperCase().includes(t));
    }), [base, que, t, encaja, porId, zona, areaDe, niveles, prio]);
    const cuentaNivel = (n: number) => base.filter((m) => encaja(m, que) && prioridadMensaje(m, prio) === n).length;
    const cuenta = (q: QueCentral) => base.filter((m) => encaja(m, q)).length;

    const columnas = useMemo<ColumnaTabla<Mensaje>[]>(() => [
        { clave: "hora", titulo: "Hora", ancho: 92, ordenable: true, valor: (m) => m.recibido, celda: (m) => <Momento t={m.recibido} /> },
        // La prioridad que eligió el administrador para la clase del evento (Ajustes › Centrales de alarma).
        { clave: "prio", titulo: "Prioridad", ancho: 128, ordenable: true, valor: (m) => prioridadMensaje(m, prio) ?? 9, celda: (m) => sinUsar(m) ? <span className="text-muted-foreground/50 text-[12px]">—</span> : <ChipPrioridad n={prioridadMensaje(m, prio)} /> },
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
        { clave: "donde", titulo: "Dónde", ancho: 180, valor: (m) => dondeDe(m, primero(m), zona) || "", celda: (m) => <span className="text-[12px] text-muted-foreground line-clamp-2">{dondeDe(m, primero(m), zona) || "—"}</span> },
        { clave: "central", titulo: "Central", ancho: 200, valor: (m) => (m.centralId && porId.get(m.centralId)?.nombre) || `Cuenta ${m.cuenta || "?"}`, celda: (m) => {
            const c = m.centralId ? porId.get(m.centralId) : null;
            return (
                <div className="min-w-0 leading-tight">
                    <div className={cn("text-[13px] truncate", c ? "font-semibold" : "text-muted-foreground")}>{c ? c.nombre : m.cuenta ? `Cuenta ${m.cuenta}` : "Sin cuenta"}</div>
                    {(c?.prueba || !c) && <div className="text-[11px] text-muted-foreground truncate">{c ? "de prueba" : m.cuenta ? "sin dar de alta" : m.ip || ""}</div>}
                </div>);
        } },
        // La cuenta en su columna (22/10, Nico): es lo que se lee en el receptor y en la central, y con
        // varias centrales detrás de un mismo IPC10 es como se las distingue.
        { clave: "cuenta", titulo: "Cuenta", ancho: 104, ordenable: true, valor: (m) => m.cuenta || "", celda: (m) => <span className={cn("text-[12.5px] font-semibold tabular-nums", !m.centralId && "text-muted-foreground font-normal")}>{m.cuenta || "—"}</span> },
        { clave: "area", titulo: "Área", ancho: 140, ordenable: true, valor: (m) => areaDe(m) || "", celda: (m) => <span className="text-[12px] text-muted-foreground truncate">{areaDe(m) || "—"}</span> },
        { clave: "via", titulo: "Llegó por", ancho: 150, valor: (m) => `${VIA[m.transporte || ""] || m.transporte || ""} ${m.ip || ""}`, celda: (m) => (
            <div className="leading-tight min-w-0"><div className="text-[12px]">{VIA[m.transporte || ""] || (m.transporte || "—").toUpperCase()}{m.cifrado ? " · cifrado" : ""}</div><div className="text-[11px] text-muted-foreground tabular-nums truncate">{m.ip || ""}</div></div>) },
        { clave: "resp", titulo: "", ancho: 70, auxiliar: true, alinear: "der", valor: (m) => m.respuesta, celda: (m) => <Estado tono={m.respuesta === "ACK" ? (m.error ? "aviso" : "bien") : "mal"}>{m.respuesta}</Estado> },
    ], [porId, zona, areaDe, prio]);

    return (
        <Tabla<Mensaje> alto="100%" className="flex-1 min-h-0" seleccionCeldas={false} cargando={cargando && !datos} error={!datos ? error : null} alReintentar={traer}
            id="alarmas-centrales" filas={filas} clave={(m) => m.id} columnas={columnas}
            alClickFila={(m) => alElegir(sel === m.id ? null : m.id)} filaActiva={(m) => m.id === sel}
            filaDestacada={(m) => primero(m)?.categoria === "ALARMA" && Date.now() - new Date(m.recibido).getTime() < 60_000}
            // P1 (22/10, Nico): la fila entera en rojo con el texto en blanco, latiendo mientras el evento siga sin tratar.
            claseFila={(m) => !sinUsar(m) && prioridadMensaje(m, prio) === 1 ? cn("omni-fila-p1", m.detectionId && sinTratarSet.has(m.detectionId) && "omni-fila-p1-viva") : undefined}
            vacio={{
                titulo: t ? "Nada con esa búsqueda" : !datos?.centrales.length ? "Todavía no hay centrales dadas de alta"
                    : !base.length && fueraDeArea > 0 ? `${fueraDeArea.toLocaleString("es-UY")} mensajes, de centrales fuera del área «${area?.nombre || "elegida"}»` : "Las centrales no mandaron nada en este rango",
                ayuda: t ? undefined : !base.length && fueraDeArea > 0 ? "Elegí «Todas las áreas» arriba, o tocá «ver todas» abajo." : "Se actualiza sola con cada mensaje que llega.",
            }}
            pie={<span className="tabular-nums">{filas.length} mensajes · últimas {horas} h{datos?.tope ? " · se muestran los 3000 más nuevos" : ""}
                {fueraDeArea > 0 && <> · {fueraDeArea.toLocaleString("es-UY")} fuera del área «{area?.nombre || "elegida"}» <button type="button" onClick={area?.verTodas} className="font-semibold text-[var(--accion)] hover:underline">ver todas</button></>}
            </span>}
            barra={
                /*
                 * Los filtros en UN renglón (22/10, Nico: «acomodá los controles de filtros, ocupan mucho
                 * espacio»), como el origen de la pestaña Alarmas: íconos con su cuenta y la explicación al
                 * pasar el mouse, en vez de seis palabras y cinco «P» con texto.
                 */
                <div className="flex items-center gap-2">
                    <Filtros busqueda={busqueda} alBuscar={setBusqueda} placeholder="Central, cuenta, zona…" anchoBusqueda={220} />
                    <div className="flex items-center h-[34px] rounded-lg bg-muted/60 p-0.5 gap-0.5" role="group" aria-label="Qué mensajes">
                        {QUE_ICONOS.map(({ q, I, rotulo, tono }) => {
                            const on = que === q, k = cuenta(q);
                            return (
                                <button key={q} type="button" onClick={() => setQue(q)} aria-pressed={on} aria-label={rotulo}
                                    data-tooltip-id="tt-alarmas" data-tooltip-content={`${rotulo} · ${k}`}
                                    className={cn("relative h-[30px] w-[34px] rounded-md grid place-items-center transition-colors",
                                        on ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground hover:bg-background", !k && !on && "opacity-40")}>
                                    <I size={15} />
                                    {k > 0 && q !== "eventos" && <span className={cn("absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9.5px] font-bold tabular-nums grid place-items-center", on ? "bg-white text-[var(--accion)]" : tono || "bg-foreground text-background")}>{k > 99 ? "99+" : k}</span>}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex items-center h-[34px] rounded-lg bg-muted/60 p-0.5 gap-0.5" role="group" aria-label="Prioridad">
                        {[1, 2, 3, 4, 5].map((n) => {
                            const on = niveles.includes(String(n)), k = cuentaNivel(n);
                            return (
                                <button key={n} type="button" onClick={() => setNiveles((xs) => (xs.includes(String(n)) ? xs.filter((x) => x !== String(n)) : [...xs, String(n)]))} aria-pressed={on}
                                    data-tooltip-id="tt-alarmas" data-tooltip-content={`P${n} · ${nivel(n).nombre} · ${k}. ${on ? "Tocá para quitarla." : "Tocá para ver sólo esta (se pueden sumar varias)."}`}
                                    className={cn("relative h-[30px] w-[32px] rounded-md text-[11.5px] font-bold tabular-nums transition-colors",
                                        on ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground hover:bg-background", !k && !on && "opacity-40")}>
                                    P{n}
                                    {k > 0 && <span className={cn("absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9.5px] font-bold grid place-items-center", on ? "bg-white text-[var(--accion)]" : n === 1 ? "pleno-mal" : n <= 3 ? "pleno-aviso" : "bg-foreground text-background")}>{k > 99 ? "99+" : k}</span>}
                                </button>
                            );
                        })}
                        {niveles.length > 0 && <button type="button" onClick={() => setNiveles([])} aria-label="Toda prioridad" data-tooltip-id="tt-alarmas" data-tooltip-content="Ver toda prioridad" className="h-[30px] w-[24px] rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-background"><X size={13} /></button>}
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                        <InformeTiempos />
                        <button type="button" onClick={() => setConVida((v) => !v)} aria-pressed={conVida} aria-label="Supervisión"
                            data-tooltip-id="tt-alarmas" data-tooltip-content={`Supervisión («sigo vivo») de las centrales: ${conVida ? "se ve. Tocá para ocultarla." : "oculta, porque llega cada pocos minutos y tapa los eventos. Tocá para verla."}`}
                            className={cn("h-[34px] w-[34px] rounded-lg grid place-items-center transition-colors", conVida ? "bg-[var(--accion)] text-white" : "bg-muted/60 text-muted-foreground hover:text-foreground")}>
                            <HeartPulse size={15} />
                        </button>
                        <span className="w-px h-5 bg-border mx-0.5" />
                        <Filtros grupos={[{ clave: "rango", titulo: "Hasta cuándo para atrás", valor: String(horas), alElegir: (v) => setHoras(Number(v)),
                            opciones: [{ valor: "24", rotulo: "24 h" }, { valor: "72", rotulo: "3 d" }, { valor: "168", rotulo: "7 d" }] }]} />
                    </div>
                </div>
            } />
    );
}

const NOMBRE_CAT: Record<string, string> = { ALARMA: "Alarma", RESTAURACION: "Restauración", ARMADO: "Armado", DESARMADO: "Desarmado", FALLA: "Falla", FALLA_FIN: "Normal", PRUEBA: "Prueba", OTRO: "Otro" };
/** El color de cada pieza de la trama: el significado, no el adorno (control gris, cuenta en el azul de acción…). */
const COLOR_PARTE: Record<TonoParte, string> = {
    control: "text-muted-foreground", protocolo: "tono-info font-semibold", cuenta: "text-[var(--accion)] font-bold", evento: "tono-mal font-bold",
    lugar: "tono-aviso font-semibold", hora: "tono-bien", cifrado: "text-muted-foreground/70 italic", neutro: "text-muted-foreground",
};

/**
 * El panel de la derecha (22/10, Nico: «estilizalo más»; «falta abrir la ficha desde el evento»).
 *
 * Arriba, la franja del evento en el color de su prioridad: qué pasó en grande, dónde y cuándo, y
 * el botón que abre su ficha (para tratarlo o ver cómo se trató). Después, cada evento que traía el
 * mensaje como una tarjeta; la central y por dónde llegó; y la trama, pieza por pieza, con su color y
 * su explicación al pasar el mouse.
 */
export function DetalleMensajeCentral({ m, datos }: { m: Mensaje; datos: Datos | null }) {
    const { porId, zona, areaDe } = useCentrales(datos);
    const prio = datos?.prioridades || PRIORIDADES_DEFECTO;
    const c = m.centralId ? porId.get(m.centralId) : null;
    const eventos = Array.isArray(m.eventos) ? m.eventos : [];
    const e0 = eventos[0] || null;
    const n = sinUsar(m) ? null : prioridadMensaje(m, prio);
    const st = e0 ? ESTILO[e0.categoria] || ESTILO.OTRO : null;
    const I = sinUsar(m) ? CircleHelp : st?.icono || HeartPulse;
    const sinTratar = !!m.detectionId && sinTratarDe(datos, m.detectionId);
    const partes = useMemo(() => partesTrama(m.crudo), [m.crudo]);
    const copiar = (x: string) => { navigator.clipboard?.writeText(x).then(() => toast.success({ title: "Trama copiada" })).catch(() => { }); };
    // La franja: P1 rojo lleno, P2 ámbar lleno; el resto, la superficie con un filo del tono.
    const lleno = n === 1 ? { background: "var(--mal)", color: "#fff" } : n === 2 ? { background: "var(--aviso)", color: "#16120a" } : undefined;
    const titulo = sinUsar(m) ? ERROR_TXT[m.error || ""] || m.error || "Rechazado" : e0 ? e0.texto : esVida(m) ? "Supervisión" : "Sin eventos";
    const donde = e0 ? dondeDe(m, e0, zona) : null;
    return (
        <div className="flex flex-col min-h-full">
            <div className={cn("px-5 pt-5 pb-4", !lleno && "border-b border-border")} style={lleno}>
                <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] opacity-80">
                    {n != null ? <span>P{n} · {nivel(n).nombre}</span> : <span>{sinUsar(m) ? "Sin usar" : "Mensaje"}</span>}
                    {e0 && <><span>·</span><span>{NOMBRE_CAT[e0.categoria] || e0.categoria}</span></>}
                </div>
                <div className="mt-2 flex items-start gap-3">
                    <span className={cn("grid place-items-center w-12 h-12 rounded-[12px] shrink-0", lleno ? "bg-black/15" : "bg-muted/60", !lleno && st && TONO_TEXTO[st.tono], n === 1 && sinTratar && "animate-pulse")}><I size={24} /></span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[20px] font-bold tracking-tight leading-tight">{titulo}</div>
                        <div className={cn("text-[12.5px] mt-0.5", lleno ? "opacity-85" : "text-muted-foreground")}>{donde || (e0 ? "La central" : m.cuenta ? `Cuenta ${m.cuenta}` : "—")}</div>
                    </div>
                </div>
                <div className={cn("mt-3 text-[12px] tabular-nums flex items-center gap-1.5", lleno ? "opacity-85" : "text-muted-foreground")}><Momento t={m.recibido} /></div>
                {m.detectionId && (
                    <button type="button" onClick={() => abrirEventoCentral(m.detectionId!)}
                        className={cn("mt-3 w-full h-10 rounded-[10px] text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-[filter] hover:brightness-110",
                            lleno ? "bg-white text-[var(--mal)]" : "bg-[var(--accion)] text-white")}
                        style={lleno && n === 2 ? { color: "#16120a" } : undefined}>
                        <ExternalLink size={15} /> {sinTratar ? "Abrir ficha y tratar" : "Abrir ficha"}
                    </button>
                )}
            </div>

            <div className="p-5 space-y-5">
                {sinUsar(m) && (
                    <div className="rounded-[10px] chip-aviso px-3 py-2.5 text-[12.5px] leading-snug">
                        {m.error === "cuenta-desconocida"
                            ? <>La cuenta <b className="tabular-nums">{m.cuenta}</b> no está dada de alta: se le confirmó al receptor para que no se trabe, pero no generó alarma. Para usarla: Dispositivos › Agregar › Central de alarma{m.transporte === "cms" ? " › «Por un receptor»" : ""}, con esta cuenta.</>
                            : <>{ERROR_TXT[m.error || ""] || m.error || "Rechazado"}. Se contestó <b>{m.respuesta}</b>{m.respuesta === "ACK" ? " para que el receptor no se trabe, pero no se usó" : ""}.</>}
                    </div>
                )}

                {eventos.length > 1 && (
                    <section>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Los {eventos.length} eventos del mensaje</div>
                        <div className="space-y-1.5">
                            {eventos.map((e, i) => {
                                const s2 = ESTILO[e.categoria] || ESTILO.OTRO; const I2 = s2.icono;
                                return (
                                    <div key={i} className="rounded-[10px] bg-muted/40 px-3 py-2 flex items-center gap-2.5">
                                        <I2 size={15} className={cn("shrink-0", TONO_TEXTO[s2.tono])} />
                                        <div className="min-w-0 flex-1 leading-tight"><div className="text-[13px] font-semibold truncate">{e.texto}</div><div className="text-[11.5px] text-muted-foreground truncate">{dondeDe(m, e, zona) || "La central"}</div></div>
                                        <ChipPrioridad n={prioridadDe(prio, e)} corto />
                                    </div>);
                            })}
                        </div>
                    </section>
                )}

                {/* La central y por dónde llegó: dos tarjetas lado a lado. */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-[10px] bg-muted/40 px-3 py-2.5 min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Central</div>
                        <div className="text-[13.5px] font-semibold truncate mt-1">{c ? c.nombre : "Sin dar de alta"}</div>
                        <div className="text-[12px] text-muted-foreground tabular-nums truncate">{m.cuenta ? `Cuenta ${m.cuenta}` : "—"}{areaDe(m) ? ` · ${areaDe(m)}` : ""}</div>
                        {c?.prueba && <div className="mt-1"><Estado tono="info">De prueba</Estado></div>}
                    </div>
                    <div className="rounded-[10px] bg-muted/40 px-3 py-2.5 min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Llegó por</div>
                        <div className="text-[13.5px] font-semibold truncate mt-1">{VIA[m.transporte || ""] || m.transporte || "—"}{m.idMensaje ? ` · ${m.idMensaje === "ADM-CID" ? "Contact ID" : m.idMensaje === "SIA-DCS" ? "SIA" : m.idMensaje}` : ""}</div>
                        <div className="text-[12px] text-muted-foreground tabular-nums truncate">{m.ip || "—"}{m.cifrado ? " · cifrado AES" : ""}</div>
                        <div className="mt-1 flex items-center gap-1.5"><Estado tono={m.respuesta === "ACK" ? (m.error ? "aviso" : "bien") : "mal"}>{m.respuesta}</Estado>{m.horaCentral && <span className="text-[11px] text-muted-foreground">hora central <Momento t={m.horaCentral} /></span>}</div>
                    </div>
                </div>

                {m.crudo && (
                    <section>
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex-1">Trama</span>
                            <span className="text-[11px] text-muted-foreground">pasá el mouse por cada parte</span>
                            <button type="button" onClick={() => copiar(m.crudo!)} className="text-muted-foreground hover:text-foreground" aria-label="Copiar la trama"><Copy size={13} /></button>
                        </div>
                        <div className="rounded-[10px] bg-muted/60 p-3 font-mono text-[12.5px] leading-relaxed break-all">
                            {partes.map((x, i) => x.rotulo
                                ? <span key={i} data-tooltip-id="tt-trama" data-tooltip-html={`<b>${x.rotulo}</b><br/>${x.ayuda.replace(/</g, "&lt;")}`}
                                    className={cn("rounded-[3px] px-[1px] cursor-help hover:bg-foreground/10 hover:outline hover:outline-1 hover:outline-foreground/20", COLOR_PARTE[x.tono])}>{x.texto}</span>
                                : <span key={i} className="whitespace-pre">{x.texto}</span>)}
                        </div>
                        {/* La leyenda: qué color es qué, sin tener que pasar por cada pieza. */}
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                            {([["cuenta", "Cuenta"], ["evento", "Evento"], ["lugar", "Partición / zona"], ["protocolo", "Protocolo"], ["hora", "Hora"], ["control", "Control"]] as const)
                                .filter(([k]) => partes.some((x) => x.tono === k)).map(([k, l]) => <span key={k} className={cn("font-mono", COLOR_PARTE[k])}>■ <span className="font-sans">{l}</span></span>)}
                        </div>
                        <Tooltip id="tt-trama" place="top" positionStrategy="fixed" className="!max-w-[300px] !text-[12px] !leading-snug !rounded-lg !z-[9999]" />
                    </section>
                )}
            </div>
        </div>
    );
}

/** La pestaña entera: la tabla y, a la derecha, el mensaje elegido. Pide sus datos sólo mientras está a la vista. */
export function VistaCentrales({ horas, setHoras, enArea, area }: { horas: number; setHoras: (h: number) => void; enArea: (deviceId: string | null, areaZona?: string | null) => boolean; area?: { nombre: string | null; filtrando: boolean; verTodas: () => void } }) {
    const { datos, error, cargando, traer } = useMensajesCentrales(horas);
    const [sel, setSel] = useState<string | null>(null);
    const [que, setQue] = useState<QueCentral>("eventos");
    const elegido = sel ? datos?.mensajes.find((m) => m.id === sel) || null : null;
    return (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_400px] xl:divide-x divide-border">
            <div className="min-h-0 flex flex-col p-4">
                <TablaMensajesCentrales horas={horas} setHoras={setHoras} datos={datos} error={error} cargando={cargando} traer={traer} sel={sel} alElegir={setSel} enArea={enArea} que={que} setQue={setQue} area={area} />
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

/**
 * Cuánto se tarda en tomar y en tratar los eventos de central, por operador (22/10, Nico: «tiempos
 * medidos»). Medianas, no promedios: un evento olvidado una noche no tiene que tapar cómo se trabaja.
 */
function InformeTiempos() {
    const [abierto, setAbierto] = useState(false);
    const [h, setH] = useState(168);
    const [d, setD] = useState<{ total: number; sinTratar: number; operadores: { nombre: string; tratados: number; reales: number; falsas: number; tomarSeg: number | null; tratarSeg: number | null }[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!abierto) return;
        setD(null); setError(null);
        fetch(`/api/centrales/eventos/informe?h=${h}`, { cache: "no-store" }).then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`); setD(j); }).catch((e) => setError(e?.message || "No se pudo leer."));
    }, [abierto, h]);
    const columnas: ColumnaTabla<NonNullable<typeof d>["operadores"][number]>[] = [
        { clave: "nombre", titulo: "Operador", valor: (o) => o.nombre, celda: (o) => <span className="text-[13px] font-semibold">{o.nombre}</span> },
        { clave: "tratados", titulo: "Tratados", ancho: 90, alinear: "der", ordenable: true, valor: (o) => o.tratados, celda: (o) => <span className="tabular-nums">{o.tratados}</span> },
        { clave: "reales", titulo: "Reales", ancho: 80, alinear: "der", valor: (o) => o.reales, celda: (o) => <span className="tabular-nums">{o.reales}</span> },
        { clave: "falsas", titulo: "Falsas", ancho: 80, alinear: "der", valor: (o) => o.falsas, celda: (o) => <span className="tabular-nums">{o.falsas}</span> },
        { clave: "tomar", titulo: "Lo toma en", ancho: 110, alinear: "der", ordenable: true, valor: (o) => o.tomarSeg ?? 1e9, celda: (o) => <span className="tabular-nums">{segATexto(o.tomarSeg)}</span> },
        { clave: "tratar", titulo: "Lo cierra en", ancho: 110, alinear: "der", ordenable: true, valor: (o) => o.tratarSeg ?? 1e9, celda: (o) => <span className="tabular-nums">{segATexto(o.tratarSeg)}</span> },
    ];
    return (<>
        <button type="button" onClick={() => setAbierto(true)} aria-label="Tiempos de atención" data-tooltip-id="tt-alarmas" data-tooltip-content="Tiempos: cuánto se tarda en tomar y en tratar los eventos, por operador"
            className="h-[34px] w-[34px] rounded-lg grid place-items-center bg-muted/60 text-muted-foreground hover:text-foreground"><Timer size={15} /></button>
        <Cajon open={abierto} onOpenChange={setAbierto}>
            <CajonContenido titulo="Tiempos de atención" descripcion="Desde que llega el evento hasta que se toma y hasta que se trata. Medianas por operador.">
                <div className="px-6 py-5 space-y-4">
                    <Filtros grupos={[{ clave: "h", titulo: "Período", valor: String(h), alElegir: (v) => setH(Number(v)), opciones: [{ valor: "24", rotulo: "24 h" }, { valor: "168", rotulo: "7 días" }, { valor: "720", rotulo: "30 días" }] }]} />
                    {d && <p className="text-[12.5px] text-muted-foreground tabular-nums">{d.total} eventos de central · {d.sinTratar} sin tratar</p>}
                    <Tabla id="centrales-tiempos" filas={d?.operadores || []} clave={(o) => o.nombre} columnas={columnas} cargando={!d && !error} error={error} seleccionCeldas={false}
                        vacio={{ titulo: "Nadie trató eventos en este período" }} />
                </div>
            </CajonContenido>
        </Cajon>
    </>);
}
