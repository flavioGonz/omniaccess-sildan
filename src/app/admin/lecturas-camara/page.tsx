"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, CircleOff, FileSearch, ScanLine, TriangleAlert, Video, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { getImagePath } from "@/lib/image-path";
import { hace } from "@/lib/fechas";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Lecturas de cámara: el registro de lecturas de cada cámara LPR al lado de lo que recibió
 * OmniAccess y de lo que releyó OmniVision (pedido de Nico, 16/10: «ver el log de la cámara para
 * validar las detecciones y poder compararlas»).
 *
 * La pregunta que contesta y que antes no tenía dónde: ¿le llegan a OmniAccess todas las lecturas
 * que hace la cámara, con la misma chapa? Una lectura «perdida» no deja rastro en el historial:
 * sólo aparece mirando el registro de la propia cámara. Datos de /api/lpr/lecturas-camara.
 */
type Lado = { plate: string | null; pais?: string | null; sentido?: string | null; lista?: string | null; picName?: string };
type Omni = { id: string; ts: string; plate: string | null; decision: string; sentido: string; foto: string | null };
type Fila = { id: string; ts: string; deviceId: string; camara: string; cam: Lado | null; omni: Omni | null; vision: { plate: string | null; estado: string; confianza: number | null } | null; estado: "coincide" | "distinta" | "perdida" | "solo" };
type Datos = {
    h: number; filas: Fila[];
    camaras: { id: string; nombre: string; total: number; desde: string | null; hasta: string | null; copia: { ultimo: string | null; error: string | null } | null }[];
    resumen: null | { camara: number; coincide: number; distinta: number; perdida: number; solo: number; desfasajeMs: number | null; sinLeerCamara: number };
    estado: null | { t: string; cadaMs: number };
};

const RANGOS = [{ v: "1", r: "1 h" }, { v: "6", r: "6 h" }, { v: "24", r: "24 h" }, { v: "72", r: "3 días" }, { v: "168", r: "7 días" }];
const REFRESCO_MS = 30_000;
const ESTADO: Record<Fila["estado"], { r: string; tono: string; I: typeof CheckCircle2; ayuda: string }> = {
    coincide: { r: "Coincide", tono: "chip-bien", I: CheckCircle2, ayuda: "La cámara leyó y a OmniAccess le llegó la misma chapa." },
    distinta: { r: "Distinta", tono: "chip-aviso", I: TriangleAlert, ayuda: "A esa hora llegó un evento, pero con otra chapa que la del registro de la cámara." },
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

function Numero({ n, rotulo, sub, tono, activo, onClick }: { n: number | string; rotulo: string; sub?: string; tono?: string; activo?: boolean; onClick?: () => void }) {
    return (
        <button type="button" onClick={onClick} disabled={!onClick}
            className={cn("rounded-[10px] border bg-card px-3.5 py-3 text-left transition-colors", activo ? "border-[var(--accion)]" : "border-border", onClick && "hover:bg-accent")}>
            <div className={cn("text-[24px] font-bold tabular-nums leading-none tracking-[-0.02em]", tono)}>{n}</div>
            <div className="text-[12px] font-semibold mt-1.5">{rotulo}</div>
            {sub && <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">{sub}</div>}
        </button>
    );
}

export default function LecturasCamara() {
    const [d, setD] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [h, setH] = useState("6");
    const [camara, setCamara] = useState("");
    const [filtro, setFiltro] = useState<"" | Fila["estado"]>("");
    const [foto, setFoto] = useState<string | null>(null);

    const traer = useCallback(() => {
        const q = new URLSearchParams({ h, ...(camara ? { camara } : {}) });
        fetch(`/api/lpr/lecturas-camara?${q}`, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`); return j; })
            .then((j) => { setD(j); setError(null); })
            .catch((e) => setError(e?.message || "No se pudo leer"));
    }, [h, camara]);
    useEffect(() => { traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);

    const filas = useMemo(() => (d?.filas || []).filter((f) => !filtro || f.estado === filtro), [d, filtro]);
    const r = d?.resumen;
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
    const sinDatos = d && !d.camaras.length;

    const columnas: ColumnaTabla<Fila>[] = [
        {
            clave: "estado", titulo: "Resultado", ancho: 150, valor: (f) => ESTADO[f.estado].r,
            celda: (f) => { const e = ESTADO[f.estado]; return <Pista texto={e.ayuda}><span className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-semibold", e.tono)}><e.I size={12} /> {e.r}</span></Pista>; },
        },
        {
            clave: "hora", titulo: "Hora de la cámara", ancho: 140, ordenable: true, valor: (f) => f.ts,
            celda: (f) => <span className="tabular-nums text-[12.5px]"><b>{hhmmss(f.ts)}</b> <span className="text-muted-foreground">{dia(f.ts)}</span></span>,
        },
        { clave: "camara", titulo: "Cámara", valor: (f) => f.camara, celda: (f) => <span className="text-[12.5px] truncate">{f.camara}</span> },
        {
            clave: "cam", titulo: "Leyó la cámara", ayuda: "Lo que dice el registro de la propia cámara: chapa, país y sentido.", valor: (f) => f.cam?.plate || "",
            celda: (f) => f.cam ? (
                <span className="flex items-center gap-2"><Chapa p={f.cam.plate} />
                    <span className="text-[11px] text-muted-foreground">{[f.cam.pais && f.cam.pais !== "NON" ? f.cam.pais : null, sentido(f.cam.sentido)].filter(Boolean).join(" · ")}</span></span>
            ) : <span className="text-[12px] text-muted-foreground">no está en su registro</span>,
        },
        {
            clave: "omni", titulo: "Recibió OmniAccess", ayuda: "El evento que llegó por la alarma de la cámara: chapa, decisión y cuántos segundos después.", valor: (f) => f.omni?.plate || "",
            celda: (f) => f.omni ? (
                <span className="flex items-center gap-2">
                    <Chapa p={f.omni.plate} />
                    <span className={cn("text-[11px] font-semibold", f.omni.decision === "DENY" ? "tono-mal" : "tono-bien")}>{f.omni.decision === "DENY" ? "denegado" : "permitido"}</span>
                    {f.cam && <span className="text-[11px] text-muted-foreground tabular-nums">{((new Date(f.omni.ts).getTime() - new Date(f.ts).getTime()) / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1, signDisplay: "always" })} s</span>}
                    {f.omni.foto && <button type="button" onClick={() => setFoto(getImagePath(f.omni!.foto))} className="ml-auto grid h-7 w-7 place-items-center rounded-md border border-border hover:bg-accent" aria-label="Ver la foto"><Camera size={13} /></button>}
                </span>
            ) : <span className="inline-flex items-center gap-1 text-[12px] tono-mal font-semibold"><XCircle size={12} /> no llegó</span>,
        },
        {
            clave: "vision", titulo: "Releyó OmniVision", ayuda: "La relectura de OmniVision sobre la foto del evento (NO_LEIDA o doble verificación), si la hubo.", valor: (f) => f.vision?.plate || "",
            celda: (f) => f.vision ? <span className="flex items-center gap-1.5"><ScanLine size={12} className="text-muted-foreground" /><Chapa p={f.vision.plate} apagada={f.vision.estado !== "LEIDA"} />{f.vision.confianza != null && <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(f.vision.confianza * 100)} %</span>}</span> : <span className="text-[12px] text-muted-foreground">—</span>,
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
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                <Filtros solido grupos={[{ clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) }]} />
                <label className={cn("relative inline-flex items-center h-[34px] rounded-lg pl-2.5 pr-2 gap-1.5 text-[12px] font-semibold cursor-pointer", camara ? "bg-[var(--accion)] text-white" : "bg-muted/60 text-foreground")}>
                    <Video size={14} strokeWidth={2.2} />
                    <select value={camara} onChange={(e) => setCamara(e.target.value)} aria-label="Cámara"
                        className="appearance-none bg-transparent outline-none pr-4 cursor-pointer max-w-[220px] truncate [&>option]:text-foreground [&>option]:bg-background">
                        <option value="">Todas las cámaras</option>
                        {(d?.camaras || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.copia?.error ? " · sin copiar" : ""}</option>)}
                    </select>
                    <span className="pointer-events-none absolute right-2 text-[9px] opacity-70">▼</span>
                </label>
                {d?.camaras.filter((c) => c.copia?.error).map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full chip-aviso text-[11.5px] font-semibold"><TriangleAlert size={12} /> {c.nombre}: {c.copia!.error}</span>
                ))}
            </div>

            {r && (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                    <Numero n={r.camara} rotulo="Leyó la cámara" sub={`${r.sinLeerCamara} sin chapa`} activo={!filtro} onClick={() => setFiltro("")} />
                    <Numero n={r.coincide} rotulo="Coinciden" sub={pct(r.coincide, r.camara)} tono="tono-bien" activo={filtro === "coincide"} onClick={() => setFiltro(filtro === "coincide" ? "" : "coincide")} />
                    <Numero n={r.distinta} rotulo="Con otra chapa" sub={pct(r.distinta, r.camara)} tono={r.distinta ? "tono-aviso" : undefined} activo={filtro === "distinta"} onClick={() => setFiltro(filtro === "distinta" ? "" : "distinta")} />
                    <Numero n={r.perdida} rotulo="No le llegaron" sub={`${pct(r.perdida, r.camara)} de lo que leyó`} tono={r.perdida ? "tono-mal" : undefined} activo={filtro === "perdida"} onClick={() => setFiltro(filtro === "perdida" ? "" : "perdida")} />
                    <Numero n={r.solo} rotulo="Sólo en OmniAccess" sub="la cámara no lo registra" activo={filtro === "solo"} onClick={() => setFiltro(filtro === "solo" ? "" : "solo")} />
                    <Numero n={r.desfasajeMs != null ? `${(r.desfasajeMs / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1, signDisplay: "always" })} s` : "—"} rotulo="Demora típica" sub="evento recibido − captura (mediana)" />
                </div>
            )}

            <Tabla filas={filas} clave={(f) => f.id} columnas={columnas} cargando={!d && !error} error={!d ? error : null} alReintentar={traer} filasFantasma={8}
                vacio={sinDatos
                    ? { icono: FileSearch, titulo: "Todavía no hay registro copiado", ayuda: "El proceso camara-log copia el registro de cada cámara LPR cada 30 s. Si recién se instaló, en un minuto aparecen las primeras." }
                    : { icono: FileSearch, titulo: "Nada en este rango", ayuda: "Probá con un rango más largo o con otra cámara." }}
                nombreArchivo={`lecturas-camara-${h}h`} />
            {d && d.camaras.length > 0 && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    Cubre desde la primera copia de cada cámara{d.camaras.map((c) => c.desde ? ` · ${c.nombre} ${dia(c.desde)} ${hhmmss(c.desde).slice(0, 5)}` : "").join("")}. La cámara guarda sólo sus últimas ~20 lecturas: lo anterior a la primera copia no se puede recuperar.
                </p>
            )}

            <Dialog open={!!foto} onOpenChange={(o) => { if (!o) setFoto(null); }}>
                <DialogContent className="sm:max-w-5xl p-0 gap-0 overflow-hidden bg-black">
                    <DialogTitle className="sr-only">Foto del evento</DialogTitle>
                    <DialogDescription className="sr-only">La captura que recibió OmniAccess</DialogDescription>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {foto && <img src={foto} alt="Foto del evento" className="w-full max-h-[80vh] object-contain" />}
                </DialogContent>
            </Dialog>
        </div>
    );
}
