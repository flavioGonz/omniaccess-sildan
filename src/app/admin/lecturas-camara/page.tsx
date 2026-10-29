"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, CircleOff, Download, FileSearch, ScanLine, TriangleAlert, Video, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportarInforme } from "@/components/lpr/ExportarInforme";
import { cn } from "@/lib/utils";
import { Filtros } from "@/components/ui/filtros";
import { ElegirCamara } from "@/components/devices/ElegirCamara";
import { useAreas } from "@/lib/use-areas";
import { Pista } from "@/components/ui/pista";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { getImagePath } from "@/lib/image-path";
import { hace } from "@/lib/fechas";
import { CajonComparacion, type PasoComparado } from "@/components/lpr/CajonComparacion";

/**
 * Lecturas de cámara: el registro de lecturas de cada cámara LPR al lado de lo que recibió
 * OmniAccess y de lo que releyó OmniVision (pedido de Nico, 16/10: «ver el log de la cámara para
 * validar las detecciones y poder compararlas»).
 *
 * La pregunta que contesta y que antes no tenía dónde: ¿le llegan a OmniAccess todas las lecturas
 * que hace la cámara, con la misma chapa? Una lectura «perdida» no deja rastro en el historial:
 * sólo aparece mirando el registro de la propia cámara. Datos de /api/lpr/lecturas-camara.
 */
/** Un paso por la cámara: las capturas seguidas del mismo vehículo, con lo que leyó cada vez. */
type Fila = PasoComparado & { deviceId: string };
type Datos = {
    h: number; filas: Fila[];
    camaras: { id: string; nombre: string; total: number; desde: string | null; hasta: string | null; copia: { ultimo: string | null; error: string | null } | null }[];
    resumen: null | { pasos: number; capturas: number; coincide: number; variante: number; distinta: number; perdida: number; solo: number; desfasajeMs: number | null; sinLeerCamara: number };
    estado: null | { t: string; cadaMs: number };
};

const RANGOS = [{ v: "1", r: "1 h" }, { v: "6", r: "6 h" }, { v: "24", r: "24 h" }, { v: "72", r: "3 días" }, { v: "168", r: "7 días" }];
const REFRESCO_MS = 30_000;
const ESTADO: Record<Fila["estado"], { r: string; tono: string; I: typeof CheckCircle2; ayuda: string }> = {
    coincide: { r: "Coincide", tono: "chip-bien", I: CheckCircle2, ayuda: "La cámara leyó y a OmniAccess le llegó la misma chapa." },
    variante: { r: "Otra lectura", tono: "chip-info", I: CheckCircle2, ayuda: "Llegó una de las lecturas que hizo la cámara en ese paso, pero no la que más repitió (p. ej. AI4301 por MAI4301)." },
    distinta: { r: "Distinta", tono: "chip-aviso", I: TriangleAlert, ayuda: "A esa hora llegó un evento con una chapa que la cámara no leyó en ningún momento del paso." },
    perdida: { r: "No llegó", tono: "chip-mal", I: XCircle, ayuda: "La cámara la tiene en su registro y a OmniAccess no le llegó ningún evento." },
    solo: { r: "Sólo OmniAccess", tono: "chip-info", I: CircleOff, ayuda: "OmniAccess tiene el evento y la cámara no lo registra." },
};
const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { day: "numeric", month: "short", timeZone: "America/Montevideo" });
const sentido = (s: string | null | undefined) => (s === "forward" || s === "ENTRY" ? "entra" : s === "reverse" || s === "EXIT" ? "sale" : null);

function Chapa({ p, apagada }: { p: string | null | undefined; apagada?: boolean }) {
    if (!p || /^(NO_LEIDA|UNKNOWN|S\/P)$/i.test(p)) return <span className="text-[12px] text-muted-foreground">sin leer</span>;
    return <span className={cn("inline-flex items-center h-7 px-2 rounded-md border-2 text-[13.5px] font-bold tracking-[0.1em] tabular-nums", apagada ? "border-border text-muted-foreground" : "border-foreground/70 bg-background")}>{p}</span>;
}

/**
 * Un número de la tira (16/10, Nico: «los datos de arriba deben ser chicos, sin bordes, en la misma
 * fila de los filtros de la tabla»). Antes eran seis tarjetas de 24 px; ahora cifra y rótulo en
 * una línea, y siguen filtrando al tocarlos.
 */
function Cifra({ n, rotulo, tono, activo, onClick, ayuda }: { n: number | string; rotulo: string; tono?: string; activo?: boolean; onClick?: () => void; ayuda?: string }) {
    return (
        <button type="button" onClick={onClick} disabled={!onClick} title={ayuda} aria-pressed={activo}
            className={cn("relative h-[34px] px-2 inline-flex items-baseline gap-1 rounded-md whitespace-nowrap transition-colors", onClick && "hover:bg-accent", activo && "bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]")}>
            <b className={cn("text-[14px] tabular-nums leading-[34px]", tono)}>{n}</b>
            <span className={cn("text-[11.5px]", activo ? "text-foreground font-semibold" : "text-muted-foreground")}>{rotulo}</span>
        </button>
    );
}

export default function LecturasCamara() {
    const [d, setD] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [h, setH] = useState("6");
    const [camara, setCamara] = useState("");
    const areasDisp = useAreas();
    const [filtro, setFiltro] = useState<"" | Fila["estado"]>("");
    const [abierto, setAbierto] = useState<Fila | null>(null);
    /** Buscar en vivo por chapa (16/10): lo que leyó la cámara, sus variantes, lo que llegó y lo que releyó OmniVision. */
    const [busqueda, setBusqueda] = useState("");
    const [exportar, setExportar] = useState(false);

    const traer = useCallback(() => {
        const q = new URLSearchParams({ h, ...(camara ? { camara } : {}) });
        fetch(`/api/lpr/lecturas-camara?${q}`, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`); return j; })
            .then((j) => { setD(j); setError(null); })
            .catch((e) => setError(e?.message || "No se pudo leer"));
    }, [h, camara]);
    useEffect(() => { traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);

    // «Llegaron bien» junta las que coinciden y las que llegaron con otra lectura de la misma cámara.
    const q = busqueda.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const filas = useMemo(() => (d?.filas || [])
        .filter((f) => !filtro || f.estado === filtro || (filtro === "coincide" && f.estado === "variante"))
        .filter((f) => !q || [f.cam?.plate, ...(f.cam?.variantes || []).map((v) => v.plate), ...f.eventos.flatMap((e) => [e.plate, e.vision?.plate]), f.camara]
            .some((x) => (x || "").toUpperCase().replace(/[^A-Z0-9]/g, "").includes(q))), [d, filtro, q]);
    const r = d?.resumen;
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
    const sinDatos = d && !d.camaras.length;

    const columnas: ColumnaTabla<Fila>[] = [
        {
            clave: "estado", titulo: "Resultado", ancho: 150, valor: (f) => ESTADO[f.estado].r,
            celda: (f) => { const e = ESTADO[f.estado]; return <Pista texto={e.ayuda}><span className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-semibold", e.tono)}><e.I size={12} /> {e.r}</span></Pista>; },
        },
        {
            clave: "hora", titulo: "Hora de la cámara", ancho: 150, ordenable: true, valor: (f) => f.ts,
            celda: (f) => {
                const dura = Math.round((new Date(f.hasta).getTime() - new Date(f.ts).getTime()) / 1000);
                return <span className="tabular-nums text-[12.5px]"><b>{hhmmss(f.ts)}</b> <span className="text-muted-foreground">{dia(f.ts)}{dura > 0 ? ` · ${dura} s` : ""}</span></span>;
            },
        },
        { clave: "camara", titulo: "Cámara", valor: (f) => f.camara, celda: (f) => <span className="text-[12.5px] truncate">{f.camara}</span> },
        {
            clave: "cam", titulo: "Leyó la cámara", ayuda: "Lo que dice el registro de la propia cámara en ese paso: la chapa que más repitió, cuántas capturas hizo y las otras lecturas.", valor: (f) => f.cam?.plate || "",
            celda: (f) => f.cam ? (
                <span className="flex items-center gap-1.5 flex-wrap">
                    <Chapa p={f.cam.plate} />
                    <span className="text-[11px] text-muted-foreground tabular-nums">×{f.cam.capturas}{f.cam.sinLeer ? ` (${f.cam.sinLeer} sin leer)` : ""}</span>
                    {f.cam.variantes.slice(1, 4).map((v) => <span key={v.plate} className="inline-flex items-center h-5 px-1.5 rounded border border-dashed border-border text-[11px] font-semibold tracking-wider tabular-nums text-muted-foreground">{v.plate}{v.veces > 1 ? ` ×${v.veces}` : ""}</span>)}
                    {sentido(f.cam.sentido) && <span className="text-[11px] text-muted-foreground">{sentido(f.cam.sentido)}</span>}
                </span>
            ) : <span className="text-[12px] text-muted-foreground">no está en su registro</span>,
        },
        {
            clave: "omni", titulo: "Recibió OmniAccess", ayuda: "Los eventos que llegaron por la alarma de la cámara en ese paso: chapa, decisión y segundos desde la primera captura.", valor: (f) => f.eventos.map((e) => e.plate).join(" "),
            celda: (f) => f.eventos.length ? (
                <span className="flex flex-col gap-1">
                    {f.eventos.map((e) => (
                        <span key={e.id} className="flex items-center gap-2">
                            <Chapa p={e.plate} />
                            <span className={cn("text-[11px] font-semibold", e.decision === "DENY" ? "tono-mal" : "tono-bien")}>{e.decision === "DENY" ? "denegado" : "permitido"}</span>
                            {f.cam && <span className="text-[11px] text-muted-foreground tabular-nums">{((new Date(e.ts).getTime() - new Date(f.ts).getTime()) / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1, signDisplay: "always" })} s</span>}
                            {e.foto && <Camera size={13} className="text-muted-foreground" aria-label="Con foto" />}
                        </span>
                    ))}
                </span>
            ) : <span className="inline-flex items-center gap-1 text-[12px] tono-mal font-semibold"><XCircle size={12} /> no llegó</span>,
        },
        {
            clave: "vision", titulo: "Releyó OmniVision", ayuda: "La relectura de OmniVision sobre la foto de cada evento (NO_LEIDA o doble verificación), si la hubo.", valor: (f) => f.eventos.map((e) => e.vision?.plate || "").join(" "),
            celda: (f) => f.eventos.some((e) => e.vision) ? (
                <span className="flex flex-col gap-1">
                    {f.eventos.filter((e) => e.vision).map((e) => (
                        <span key={e.id} className="flex items-center gap-1.5"><ScanLine size={12} className="text-muted-foreground" /><Chapa p={e.vision!.plate} apagada={e.vision!.estado !== "LEIDA"} />{e.vision!.confianza != null && <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(e.vision!.confianza * 100)} %</span>}</span>
                    ))}
                </span>
            ) : <span className="text-[12px] text-muted-foreground">—</span>,
        },
    ];

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><FileSearch size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[17px] font-bold leading-tight">Lecturas de cámara</h1>
                    <p className="text-[12px] text-muted-foreground leading-snug">El registro de cada cámara LPR comparado con lo que recibió OmniAccess y lo que releyó OmniVision.
                        {d?.estado && <> Se copia cada {Math.round(d.estado.cadaMs / 1000)} s · última copia {hace(d.estado.t)}.</>}</p>
                </div>
                <Button variant="outline" onClick={() => setExportar(true)} disabled={!d?.camaras.length}><Download />Exportar informe</Button>
            </div>

            {d?.camaras.some((c) => c.copia?.error) && (
                <div className="flex items-center gap-2 flex-wrap">
                    {d.camaras.filter((c) => c.copia?.error).map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full chip-aviso text-[11.5px] font-semibold"><TriangleAlert size={12} /> {c.nombre}: {c.copia!.error}</span>
                    ))}
                </div>
            )}

            <Tabla filas={filas} clave={(f) => f.id} columnas={columnas} cargando={!d && !error} error={!d ? error : null} alReintentar={traer} filasFantasma={8}
                alClickFila={(f) => setAbierto(f)} filaActiva={(f) => f.id === abierto?.id}
                barra={
                    /* Buscador, rango, cámara y los números en un renglón (16/10). Tocar una fila abre la comparación. */
                    <Filtros solido busqueda={busqueda} alBuscar={setBusqueda} placeholder="Buscar una chapa"
                        grupos={[{ clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) }]}
                        acciones={r ? (
                            <div className="flex items-center flex-wrap">
                                <Cifra n={r.pasos} rotulo="leídos" activo={!filtro} onClick={() => setFiltro("")} ayuda={`Vehículos que leyó la cámara: ${r.capturas} capturas, ${r.sinLeerCamara} sin chapa`} />
                                <Cifra n={pct(r.coincide + r.variante, r.pasos)} rotulo="llegaron bien" tono="tono-bien" activo={filtro === "coincide"} onClick={() => setFiltro(filtro === "coincide" ? "" : "coincide")} ayuda={`${r.coincide + r.variante} vehículos${r.variante ? `, ${r.variante} con otra lectura de la cámara` : ""}`} />
                                <Cifra n={r.distinta} rotulo="otra chapa" tono={r.distinta ? "tono-aviso" : undefined} activo={filtro === "distinta"} onClick={() => setFiltro(filtro === "distinta" ? "" : "distinta")} ayuda="Llegó un evento con una chapa que la cámara no leyó" />
                                <Cifra n={r.perdida} rotulo="no llegaron" tono={r.perdida ? "tono-mal" : undefined} activo={filtro === "perdida"} onClick={() => setFiltro(filtro === "perdida" ? "" : "perdida")} ayuda={`${pct(r.perdida, r.pasos)} de los vehículos: la cámara los leyó y a OmniAccess no le llegó nada`} />
                                <Cifra n={r.solo} rotulo="sólo OmniAccess" activo={filtro === "solo"} onClick={() => setFiltro(filtro === "solo" ? "" : "solo")} ayuda="OmniAccess tiene el evento y la cámara no lo registra" />
                                <Cifra n={r.desfasajeMs != null ? `${(r.desfasajeMs / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1, signDisplay: "always" })} s` : "—"} rotulo="demora" ayuda="Evento − primera captura de la cámara (mediana)" />
                            </div>
                        ) : undefined}>
                        {/* Con buscador y por área, como el resto (punto 6, 21/10): era un <select> nativo. */}
                        <ElegirCamara variante="filtro" icono={Video} alinear="start" titulo="Cámara" valor={camara || null} alElegir={setCamara} todas="Todas las cámaras"
                            areas={areasDisp.areas} camaras={(d?.camaras || []).map((c) => ({ id: c.id, nombre: c.nombre, areaId: areasDisp.equipoArea[c.id] || null, nota: c.copia?.error ? "sin copiar" : null, cuenta: c.total }))} />
                    </Filtros>
                }
                vacio={sinDatos
                    ? { icono: FileSearch, titulo: "Todavía no hay registro copiado", ayuda: "El proceso camara-log copia el registro de cada cámara LPR cada 10 s. Si recién se instaló, en un minuto aparecen las primeras." }
                    : q ? { icono: FileSearch, titulo: `Ninguna lectura con «${busqueda.trim()}»`, ayuda: "Busca en lo que leyó la cámara, lo que llegó y lo que releyó OmniVision, dentro del rango elegido." }
                        : { icono: FileSearch, titulo: "Nada en este rango", ayuda: "Probá con un rango más largo o con otra cámara." }}
                nombreArchivo={`lecturas-camara-${h}h`} />
            {d && d.camaras.length > 0 && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    Cubre desde la primera copia de cada cámara{d.camaras.map((c) => c.desde ? ` · ${c.nombre} ${dia(c.desde)} ${hhmmss(c.desde).slice(0, 5)}` : "").join("")}. La cámara guarda sólo sus últimas ~20 lecturas: lo anterior a la primera copia no se puede recuperar.
                </p>
            )}

            <CajonComparacion paso={abierto} alCerrar={() => setAbierto(null)} />
            <ExportarInforme abierto={exportar} alCerrar={() => setExportar(false)} camaras={(d?.camaras || []).map((c) => ({ id: c.id, nombre: c.nombre }))} camaraActual={camara || undefined} />
        </div>
    );
}
