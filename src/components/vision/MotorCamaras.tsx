"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Camera, Car, Cpu, Film, Gauge, Image as ImageIcon, Loader2, PawPrint, Plus, ScanEye, Server, ShieldAlert, TriangleAlert, User, Video } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { hace } from "@/lib/fechas";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Pista } from "@/components/ui/pista";

/**
 * OmniVision › Analíticas, arriba de todo: qué cámaras procesa el motor, qué hace con cada una,
 * cuánto le cuesta y cómo le llega la imagen (pedido de Nico, 15/10). Datos de /api/vision/motor.
 *
 * Hasta ahora esto había que deducirlo: el ícono «Omni» en la pared decía que una cámara estaba,
 * pero no qué se hacía con ella, si el motor la estaba mirando de verdad, ni cuánto pesaba.
 */
type Fila = {
    id: string; dentro: boolean; nombre: string; origen: "equipo" | "canal"; ubicacion: string | null; funcion: "lpr" | "intrusion" | null;
    hace: { registro: boolean; reglas: number; reglasApagadas: number; rapido: boolean; verificacion: boolean; lecturas: boolean; relectura: boolean; zonas: number; busqueda: boolean };
    fuente: "video" | "cuadros" | "eventos" | "esperando" | "nada";
    porSeg: number | null; parte: number | null; ms: number | null; ultimo: string | null; error: string | null;
    analizados: number | null; saltados: number | null; cambio: number | null;
    hoy: { pistas: number; grupos: Record<string, number>; eventos: number };
    /** Por qué no llega el video, preguntado a la cámara (sólo si hay error). */
    diagnostico?: { codigo: "ok" | "clave" | "bloqueada" | "sin-red" | "error"; texto: string } | null;
};
const DIAG: Record<string, string> = { clave: "Clave incorrecta", bloqueada: "IP bloqueada", "sin-red": "No contesta", ok: "Sin video", error: "Error" };
type Datos = {
    motor: { vivo: boolean; t: string | null; salud: { ok: boolean; gpu?: string | null; propio?: boolean }; registro: boolean; cicloMs: number | null; intervaloMs: number; rapidoFps: number; analizarIgualMs: number;
        carga: { registro: number; eventos: number; total: number; tope: number } | null; tope: number; tareasApagadas: string[]; pistasAbiertas: number | null };
    totales: { enVision: number; todas: boolean; equipos: number; canales: number };
    camaras: Fila[]; fuera: Fila[];
};

/** Cada cuánto se refresca: el worker escribe su estado cada 15 s. */
const REFRESCO_MS = 15_000;
const num = (v: number, d = 2) => v.toLocaleString("es-UY", { maximumFractionDigits: d });
const ICONO_GRUPO: Record<string, typeof User> = { persona: User, vehiculo: Car, animal: PawPrint };

function Etiqueta({ children, apagada, titulo }: { children: React.ReactNode; apagada?: boolean; titulo?: string }) {
    return (
        <span title={titulo} className={cn("inline-flex items-center h-[22px] px-2 rounded-full border text-[11px] font-semibold whitespace-nowrap",
            apagada ? "border-dashed border-border text-muted-foreground" : "border-border bg-muted/50 text-foreground")}>{children}</span>
    );
}

/** Cómo le llega la imagen al motor, en palabras. */
function Fuente({ f, d }: { f: Fila; d: Datos }) {
    const vuelta = Math.max(d.motor.intervaloMs, d.motor.cicloMs || 0) / 1000;
    const [Ico, titulo, bajada] =
        f.fuente === "video" ? [Film, `Video continuo · ${d.motor.rapidoFps} c/s`, "Carril rápido (regla de línea): mientras algo se mueve"]
            : f.fuente === "cuadros" ? [ImageIcon, `Un cuadro cada ~${num(vuelta, 1)} s`, `Se analiza si la escena cambió; quieta, uno por minuto`]
                : f.fuente === "eventos" ? [Camera, "Fotos de los eventos", "Sólo cuando la cámara avisa o lee"]
                    : f.fuente === "esperando" ? [Loader2, "Esperando el primer cuadro", "El motor la toma en su próxima vuelta"]
                        : [TriangleAlert, "No la mira", f.dentro ? "Registro apagado y sin reglas" : "Fuera de OmniVision"];
    return (
        <span className="flex items-start gap-2 min-w-0">
            <Ico size={15} className={cn("mt-0.5 shrink-0", f.fuente === "video" ? "text-[var(--accion)]" : f.fuente === "nada" ? "tono-aviso" : "text-muted-foreground", f.fuente === "esperando" && "animate-spin")} />
            <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold truncate">{titulo}</span>
                <span className="block text-[11px] text-muted-foreground truncate">{bajada}</span>
            </span>
        </span>
    );
}

export function MotorCamaras() {
    const [d, setD] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [agregando, setAgregando] = useState<string | null>(null);
    const traer = useCallback(() => {
        fetch("/api/vision/motor", { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`); return j; })
            .then((j) => { setD(j); setError(null); })
            .catch((e) => setError(e?.message || "No se pudo leer el estado del motor"));
    }, []);
    useEffect(() => { traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);

    const agregar = async (f: Fila) => {
        setAgregando(f.id);
        try {
            const r = await fetch(`/api/vision/camaras/${encodeURIComponent(f.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ analiza: true, nombre: f.nombre }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) toast.error({ title: "No se pudo agregar", description: j.error || `El servidor respondió ${r.status}` });
            else { toast.success({ title: `«${f.nombre}» entra a OmniVision`, description: "Sus reglas empiezan a correr en la próxima vuelta del motor." }); traer(); }
        } finally { setAgregando(null); }
    };

    const m = d?.motor;
    const carga = m?.carga;
    const uso = carga ? Math.min(1, carga.total / (carga.tope || m!.tope)) : 0;
    const maxPorSeg = Math.max(0.0001, ...(d?.camaras || []).map((c) => c.porSeg || 0));

    const columnas: ColumnaTabla<Fila>[] = [
        {
            clave: "camara", titulo: "Cámara", valor: (f) => f.nombre, ordenable: true, ancho: "22%",
            celda: (f) => (
                <span className="flex items-center gap-2.5 min-w-0">
                    <span className={cn("grid h-8 w-8 place-items-center rounded-[8px] shrink-0", f.funcion === "lpr" ? "chip-info" : f.funcion === "intrusion" ? "chip-aviso" : "bg-muted text-muted-foreground")}>
                        {f.funcion === "lpr" ? <Car size={15} /> : f.funcion === "intrusion" ? <ShieldAlert size={15} /> : <Video size={15} />}
                    </span>
                    <span className="min-w-0">
                        <span className="block text-[13px] font-semibold truncate">{f.nombre}</span>
                        <span className="block text-[11px] text-muted-foreground truncate inline-flex items-center gap-1">
                            {f.origen === "canal" ? <><Server size={10} /> Canal de NVR</> : f.ubicacion || (f.funcion === "lpr" ? "Lee matrículas" : f.funcion === "intrusion" ? "Línea o zona" : "Cámara")}
                        </span>
                    </span>
                </span>
            ),
        },
        {
            clave: "hace", titulo: "Qué analiza", ayuda: "Lo que OmniVision hace con esta cámara. Punteado: la analítica existe pero está apagada.", ancho: "26%",
            valor: (f) => [f.hace.registro && "registro", f.hace.reglas && `${f.hace.reglas} reglas`, f.hace.verificacion && "verificación", f.hace.lecturas && "lecturas", f.hace.zonas && `${f.hace.zonas} zonas`].filter(Boolean).join(", "),
            celda: (f) => (
                <span className="flex flex-wrap gap-1">
                    {f.hace.registro && <Etiqueta titulo="Siluetas y pistas de lo que pasa por la cámara">Registro</Etiqueta>}
                    {f.hace.busqueda && <Etiqueta titulo="Sus pistas se pueden buscar con palabras o fotos">Búsqueda</Etiqueta>}
                    {f.hace.reglas > 0 && <Etiqueta>{f.hace.reglas} {f.hace.reglas === 1 ? "regla" : "reglas"}</Etiqueta>}
                    {f.hace.reglasApagadas > 0 && <Etiqueta apagada>{f.hace.reglasApagadas} apagada{f.hace.reglasApagadas === 1 ? "" : "s"}</Etiqueta>}
                    {f.hace.verificacion && <Etiqueta titulo="Doble verificación de cada alerta de la cámara">Verificación</Etiqueta>}
                    {f.hace.lecturas && <Etiqueta titulo="Tipo y color del vehículo de cada lectura">Lecturas</Etiqueta>}
                    {f.hace.relectura && <Etiqueta titulo="Lee de nuevo las chapas que la cámara no leyó">Relectura</Etiqueta>}
                    {f.hace.zonas > 0 && <Etiqueta>{f.hace.zonas} {f.hace.zonas === 1 ? "zona" : "zonas"}</Etiqueta>}
                    {!f.hace.registro && !f.hace.reglas && !f.hace.verificacion && !f.hace.lecturas && !f.hace.zonas && <span className="text-[12px] text-muted-foreground">Nada todavía</span>}
                </span>
            ),
        },
        { clave: "fuente", titulo: "Cómo le llega", ayuda: "Video continuo (carril rápido), cuadros sueltos en la ronda del motor, o sólo las fotos de los eventos.", ancho: "20%", valor: (f) => f.fuente, celda: (f) => (d ? <Fuente f={f} d={d} /> : null) },
        {
            clave: "consumo", titulo: "Consumo del motor", ayuda: "Análisis por segundo de esta cámara (promedio de 5 min) y su parte del total. Al lado, cuánto tarda cada análisis.", alinear: "der", ancho: "16%", ordenable: true,
            valor: (f) => f.porSeg ?? -1,
            celda: (f) => f.porSeg == null ? <span className="text-[12px] text-muted-foreground">sin medir</span> : (
                <span className="flex flex-col items-end gap-1 w-full">
                    <span className="text-[13px] font-bold tabular-nums">{num(f.porSeg)} <span className="text-[11px] font-normal text-muted-foreground">/s{f.parte != null ? ` · ${Math.round(f.parte * 100)} %` : ""}</span></span>
                    <span className="w-full max-w-[140px] h-1.5 rounded-full bg-muted overflow-hidden"><span className="block h-full bg-[var(--accion)]" style={{ width: `${Math.max(3, (f.porSeg / maxPorSeg) * 100)}%` }} /></span>
                    {f.ms != null && <span className="text-[10.5px] text-muted-foreground tabular-nums">{f.ms} ms por análisis</span>}
                </span>
            ),
        },
        {
            clave: "hoy", titulo: "Hoy", ayuda: "Pistas del registro (por tipo) y eventos de reglas desde las 00:00.", alinear: "der", ordenable: true, ancho: "10%",
            valor: (f) => f.hoy.pistas + f.hoy.eventos,
            celda: (f) => (
                <span className="flex flex-col items-end gap-0.5">
                    <span className="inline-flex items-center gap-2 text-[12px] tabular-nums">
                        {Object.entries(f.hoy.grupos).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g, n]) => { const I = ICONO_GRUPO[g] || ScanEye; return <span key={g} className="inline-flex items-center gap-0.5"><I size={12} className="text-muted-foreground" />{n.toLocaleString("es-UY")}</span>; })}
                        {!f.hoy.pistas && <span className="text-muted-foreground">0 pistas</span>}
                    </span>
                    {f.hoy.eventos > 0 && <span className="text-[11px] text-muted-foreground tabular-nums">{f.hoy.eventos.toLocaleString("es-UY")} eventos de reglas</span>}
                </span>
            ),
        },
        {
            clave: "estado", titulo: "Último", alinear: "der", ancho: "10%", valor: (f) => f.ultimo || "",
            celda: (f) => f.error ? (
                <Pista titulo={f.diagnostico ? DIAG[f.diagnostico.codigo] : "No entrega cuadros"} texto={f.diagnostico?.texto || f.error} ancho={300}>
                    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full chip-mal text-[11px] font-semibold whitespace-nowrap"><TriangleAlert size={11} /> {f.diagnostico ? DIAG[f.diagnostico.codigo] : "Error"}</span>
                </Pista>
            ) : f.ultimo ? <span className="text-[12px] text-muted-foreground tabular-nums">{hace(f.ultimo)}</span> : <span className="text-[12px] text-muted-foreground">—</span>,
        },
    ];

    return (
        <section className="space-y-3">
            {/* El resumen: cuántas cámaras, cuánto motor, y si está vivo. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <div className="rounded-[10px] border border-border bg-card p-3.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cámaras en OmniVision</div>
                    <div className="mt-1 flex items-baseline gap-2"><span className="text-[30px] font-bold leading-none tabular-nums tracking-[-0.02em]">{d ? d.totales.enVision : "—"}</span>
                        {d && <span className="text-[12px] text-muted-foreground">{d.totales.canales ? `${d.totales.enVision - d.totales.canales} equipos · ${d.totales.canales} canales de NVR` : `de ${d.totales.equipos} equipos`}</span>}</div>
                </div>
                <div className="rounded-[10px] border border-border bg-card p-3.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1"><Gauge size={11} /> Carga del motor</div>
                    <div className="mt-1 flex items-baseline gap-1.5"><span className="text-[30px] font-bold leading-none tabular-nums tracking-[-0.02em]">{carga ? num(carga.total, 1) : "—"}</span>
                        <span className="text-[12px] text-muted-foreground">análisis/s de {m ? num(carga?.tope || m.tope, 0) : "—"}</span></div>
                    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden"><span className={cn("block h-full", uso > 0.85 ? "bg-[var(--mal)]" : uso > 0.6 ? "bg-[var(--aviso)]" : "bg-[var(--bien)]")} style={{ width: `${Math.max(2, uso * 100)}%` }} /></div>
                    {carga && <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">{num(carga.registro, 1)} del video · {num(carga.eventos, 1)} de eventos</div>}
                </div>
                <div className="rounded-[10px] border border-border bg-card p-3.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1"><Cpu size={11} /> Motor</div>
                    <div className="mt-1.5 flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 rounded-full", m?.vivo && m.salud.ok ? "bg-[var(--bien)]" : "bg-[var(--mal)]")} />
                        <span className="text-[15px] font-bold">{!m ? "—" : m.vivo && m.salud.ok ? "Analizando" : !m.salud.ok ? "omni-vision no contesta" : "El worker no informa"}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {m ? `Vuelta de ${num(Math.max(m.intervaloMs, m.cicloMs || 0) / 1000, 1)} s${m.pistasAbiertas != null ? ` · ${m.pistasAbiertas} pistas abiertas` : ""}${m.t ? ` · informó ${hace(m.t)}` : ""}` : ""}
                    </div>
                </div>
                <div className="rounded-[10px] border border-border bg-card p-3.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1"><Activity size={11} /> Hoy</div>
                    <div className="mt-1 flex items-baseline gap-1.5"><span className="text-[30px] font-bold leading-none tabular-nums tracking-[-0.02em]">{d ? d.camaras.reduce((s, c) => s + c.hoy.pistas, 0).toLocaleString("es-UY") : "—"}</span>
                        <span className="text-[12px] text-muted-foreground">pistas</span></div>
                    {d && <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">{d.camaras.reduce((s, c) => s + c.hoy.eventos, 0).toLocaleString("es-UY")} eventos de reglas</div>}
                </div>
            </div>

            {d && d.fuera.length > 0 && (
                <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--aviso)_45%,transparent)] bg-[color-mix(in_oklab,var(--aviso)_8%,transparent)] p-3 space-y-2">
                    <div className="flex items-center gap-2 text-[13px] font-semibold"><TriangleAlert size={15} className="tono-aviso" /> Reglas en cámaras que OmniVision no analiza: no corren</div>
                    <div className="flex flex-wrap gap-2">
                        {d.fuera.map((f) => (
                            <span key={f.id} className="inline-flex items-center gap-2 h-9 pl-3 pr-1 rounded-full border border-border bg-card text-[12.5px]">
                                <b>{f.nombre}</b> <span className="text-muted-foreground">{f.hace.reglas} {f.hace.reglas === 1 ? "regla" : "reglas"}</span>
                                <button type="button" onClick={() => agregar(f)} disabled={agregando === f.id}
                                    className="h-7 px-2.5 rounded-full bg-[var(--accion)] text-white text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-60">
                                    {agregando === f.id ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Agregar
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <Tabla filas={d?.camaras || []} clave={(f) => f.id} columnas={columnas} cargando={!d && !error} error={!d ? error : null} alReintentar={traer}
                vacio={{ icono: ScanEye, titulo: "OmniVision no analiza ninguna cámara", ayuda: "Agregalas desde la pared de cámaras (Monitores › Cámaras), con el botón de cada canal." }}
                seleccionCeldas={false} filasFantasma={4} controles={false}
                pie={<span className="text-[11px] text-muted-foreground">Se agregan y se quitan desde <Link href="/monitor/camaras" className="underline">la pared de cámaras</Link>, con el botón de OmniVision de cada canal. Se actualiza cada 15 s.</span>} />
        </section>
    );
}
