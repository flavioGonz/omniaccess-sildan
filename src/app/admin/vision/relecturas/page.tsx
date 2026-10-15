"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScanLine, Activity, Camera, CheckCircle2, UserCheck, Sparkles, Ban, UserPlus, ArrowUpRight, ShieldAlert } from "lucide-react";
import { getImagePath } from "@/lib/image-path";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { useSiluetas } from "@/lib/use-siluetas";
import { rolEtiqueta } from "@/lib/roles-etiquetas";
import { useRegistrarDesdeCaptura } from "@/components/vision/buscar/RegistrarDesdeCaptura";
import type { Analisis } from "@/lib/vision-capa";
import type { Persona, Vigilancia } from "@/lib/vision-historial";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Relecturas de NO_LEIDA: cómo le va a la relectura del vehículo (vision-worker).
 *
 * Es la pantalla para decidir si la sugerencia sirve, con números y no a ojo: cuántas NO_LEIDA
 * hubo, cuántas tuvieron una chapa sugerida, cuántas de esas leyó también una lectora ese día
 * (la única confirmación que no depende de nadie), y qué hizo el guardia cuando la vio.
 * Sin entrada en el menú, bajo el permiso Ajustes, como el resto de Visión.
 */

type Fila = {
    id: string; eventoId: string; ts: string; camara: string | null; sentido: string | null; decision: string | null; foto: string | null;
    estado: string; plate: string | null; confianza: number | null; vehiculo: string | null; vehiculos: number; acuerdo: boolean | null;
    otras: { plate: string; confianza: number }[]; recorte: string | null; chapa: string | null; ms: number | null; error: string | null;
    otraCamara: { camara: string | null; ts: string } | null; guardia: string | null;
    /** Lo que OmniVision vio en la foto del evento (siluetas) y quién es la chapa sugerida. */
    analisis: Analisis | null; persona: Persona | null; vigilancia: Vigilancia | null;
};
/** Cada cuántas tarjetas va una grande en el mosaico (como el historial y Buscar). */
const RITMO_BENTO = 9;
const esNegra = (v: Vigilancia | null) => v?.categoria === "BLACKLISTED" || v?.categoria === "SEARCH";

/**
 * Una relectura en el mosaico (15/10, «lo mismo que Buscar»): la foto del evento a sangre con lo
 * que vio OmniVision encima, la chapa sugerida grande, y el recorte de la chapa en una esquina:
 * es lo que el guardia mira para confirmar. Antes era el recorte de la chapa en una tarjeta 2:1 y
 * cuatro líneas de texto: no se veía el auto.
 */
function TarjetaRelectura({ f, grande, siluetas, alAbrir }: { f: Fila; grande: boolean; siluetas: boolean; alAbrir: () => void }) {
    const [cargada, setCargada] = useState(false);
    const e = ESTADOS[f.estado] || ESTADOS.ERROR;
    const url = getImagePath(f.foto);
    const negra = esNegra(f.vigilancia);
    return (
        <button type="button" onClick={alAbrir} title={`${f.plate || "Sin sugerencia"} · ${f.camara || ""}`}
            className={cn("group relative overflow-hidden rounded-[8px] bg-black text-left outline-none hover:ring-2 hover:ring-[var(--accion)] focus-visible:ring-2 focus-visible:ring-[var(--accion)] [content-visibility:auto]",
                grande && "col-span-2 row-span-2", negra && "ring-2 ring-[var(--mal)]")}>
            <span className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.03]">
                {!cargada && <span className="absolute inset-0 animate-pulse bg-white/5" />}
                {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${url}${url.includes("?") ? "&" : "?"}w=${grande ? 520 : 260}`} alt="" loading="lazy" decoding="async" onLoad={() => setCargada(true)} onError={() => setCargada(true)}
                        className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-300", cargada ? "opacity-100" : "opacity-0")} />
                ) : f.recorte ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${f.recorte}?w=320`} alt="" loading="lazy" onLoad={() => setCargada(true)} className="absolute inset-0 w-full h-full object-cover" />
                ) : <Camera size={18} className="absolute inset-0 m-auto text-white/30" />}
                {siluetas && cargada && url && f.analisis && <CapaAnalisis analisis={f.analisis} ajuste="cover" etiquetas={false} />}
            </span>
            <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/20" />
            <span className="absolute top-1.5 left-1.5 right-1.5 flex items-start justify-between gap-1">
                <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]",
                    e.tono === "bien" ? "pleno-bien" : e.tono === "aviso" ? "pleno-aviso" : e.tono === "mal" ? "pleno-mal" : "bg-black/55 text-white")}>{e.r}</span>
                <span className="flex items-center gap-1">
                    {negra && <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] pleno-mal"><Ban size={10} />{grande ? f.vigilancia!.etiqueta : ""}</span>}
                    {f.confianza != null && <span className="px-1.5 py-0.5 rounded-md bg-black/55 text-white text-[10px] font-bold tabular-nums">{Math.round(f.confianza * 100)} %</span>}
                </span>
            </span>
            <span className="absolute bottom-1.5 left-2 right-2 flex items-end gap-2 min-w-0">
                <span className="min-w-0 flex-1">
                    <span className={cn("block font-bold tracking-wider text-white truncate tabular-nums", grande ? "text-[20px]" : "text-[13.5px]")}>{f.plate ? `¿${f.plate}?` : "—"}</span>
                    <span className={cn("block text-white/75 truncate tabular-nums", grande ? "text-[11.5px]" : "text-[10px]")}>{hora(f.ts)} · {dia(f.ts)}{grande ? ` · ${f.camara || "—"}` : ""}</span>
                    {f.persona && <span className={cn("block truncate text-white/90", grande ? "text-[11.5px]" : "text-[10px]")}>{f.persona.nombre}{grande ? ` · ${rolEtiqueta(f.persona.rol)}` : ""}</span>}
                    <span className="flex items-center gap-1.5 mt-0.5">
                        {f.otraCamara && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[color-mix(in_oklab,var(--bien)_55%,white)]" title={`La leyó ${f.otraCamara.camara} a las ${hora(f.otraCamara.ts)}`}><CheckCircle2 size={11} />{grande ? `${f.otraCamara.camara} ${hora(f.otraCamara.ts)}` : ""}</span>}
                        {f.guardia && <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold", f.guardia === f.plate ? "text-[color-mix(in_oklab,var(--bien)_55%,white)]" : "text-[color-mix(in_oklab,var(--aviso)_55%,white)]")} title={`El guardia cargó ${f.guardia}`}><UserCheck size={11} />{grande ? f.guardia : ""}</span>}
                    </span>
                </span>
                {/* El recorte de la chapa: lo que el guardia mira para confirmar. */}
                {f.chapa && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${f.chapa}?w=160`} alt={f.plate || "Chapa"} loading="lazy" className={cn("shrink-0 rounded-[4px] ring-1 ring-white/70 bg-black object-contain", grande ? "h-10 max-w-[120px]" : "h-6 max-w-[64px]")} />
                )}
            </span>
        </button>
    );
}
type Respuesta = {
    h: number; noLeidas: number; activa: boolean; otraLecturaH: number; filas: Fila[];
    /** Desde qué confianza una relectura es «acertada», y qué pasaría con cada valor. */
    umbral: number; porUmbral: { umbral: number; acertadas: number; confirmadas: number }[];
    conteo: { releidas: number; leidas: number; dudosas: number; sinChapa: number; sinVehiculo: number; sinFoto: number; errores: number; confirmadasOtraCamara: number; guardiaIgual: number; guardiaDistinta: number };
    estado: null | { activa: boolean; hechas: number; ultimoError: string | null; msUltima: number | null };
    /** Doble verificación: relecturas de chapas que la cámara SÍ leyó (cámaras con ese modo). */
    doble?: { total: number; coincide: number; casi: number; difiere: number; sin: number };
};

/**
 * El umbral de «acertada»: se elige mirando, para cada valor, cuántas relecturas pasarían y qué
 * parte de ésas confirmó otra lectora o el guardia. Subirlo deja menos acertadas pero más
 * seguras; la decisión es de quien mira estos números, no un valor escrito en el código.
 */
function Umbral({ datos, alCambiar }: { datos: Respuesta; alCambiar: (u: number) => void }) {
    return (
        <section className="rounded-[10px] border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[13px] font-bold">Acertada desde</h2>
                <span className="text-[12px] text-muted-foreground">Con menos confianza la sugerencia sale como «dudosa». Cambiarlo reclasifica también lo ya releído.</span>
            </div>
            <div className="mt-2.5 grid grid-cols-3 sm:grid-cols-6 gap-2">
                {datos.porUmbral.map((o) => {
                    const sel = Math.abs(o.umbral - datos.umbral) < 0.001;
                    return (
                        <button key={o.umbral} type="button" onClick={() => !sel && alCambiar(o.umbral)} aria-pressed={sel}
                            className={cn("rounded-[10px] border px-3 py-2 text-left transition-colors", sel ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border hover:bg-accent")}>
                            <div className="text-[16px] font-bold tabular-nums">{Math.round(o.umbral * 100)} %</div>
                            <div className="text-[11px] text-muted-foreground tabular-nums leading-snug">{o.acertadas} acertadas · {o.acertadas ? Math.round((o.confirmadas / o.acertadas) * 100) : 0} % confirmadas</div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

const RANGOS = [{ v: "6", r: "6 h" }, { v: "24", r: "24 h" }, { v: "72", r: "3 días" }, { v: "168", r: "7 días" }];
const REFRESCO_MS = 15_000;
const ESTADOS: Record<string, { r: string; tono: "bien" | "aviso" | "quieto" | "mal" }> = {
    LEIDA: { r: "acertada", tono: "bien" }, DUDOSA: { r: "dudosa", tono: "aviso" }, SIN_CHAPA: { r: "sin chapa", tono: "quieto" },
    SIN_VEHICULO: { r: "sin vehículo", tono: "quieto" }, SIN_FOTO: { r: "sin foto", tono: "quieto" }, ERROR: { r: "error", tono: "mal" },
};
const FILTROS = [{ v: "", r: "Todas" }, { v: "sugerida", r: "Con sugerencia" }, { v: "coincide", r: "Coinciden" }, { v: "sin", r: "Sin sugerencia" }];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { day: "numeric", month: "short", timeZone: "America/Montevideo" });

function Numero({ n, rotulo, sub, tono }: { n: number | string; rotulo: string; sub?: string; tono?: "bien" | "aviso" }) {
    return (
        <div className="rounded-[10px] border border-border bg-card px-3.5 py-3">
            <div className={cn("text-[22px] font-bold tabular-nums leading-none", tono === "bien" && "tono-bien", tono === "aviso" && "tono-aviso")}>{n}</div>
            <div className="text-[12px] font-semibold mt-1.5">{rotulo}</div>
            {sub && <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">{sub}</div>}
        </div>
    );
}

export default function RelecturasVision() {
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [h, setH] = useState("24");
    const [filtro, setFiltro] = useState("");
    const [abierta, setAbierta] = useState<Fila | null>(null);
    const [siluetas, setSiluetas] = useSiluetas();

    const cargar = useCallback(async () => {
        try {
            const r = await fetch(`/api/vision/relecturas?h=${h}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, [h]);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);
    const { abrirRegistro, marcarNegra, cajones } = useRegistrarDesdeCaptura(() => { void cargar(); });

    if (!datos && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las relecturas…" /></div>;

    const c = datos.conteo;
    const sugeridas = c.leidas + c.dudosas;
    const filas = datos.filas.filter((f) => !filtro || (filtro === "sugerida" ? !!f.plate : filtro === "coincide" ? !!f.otraCamara : !f.plate));

    return (
        <div className="p-6 lg:p-8 space-y-6 max-w-[1500px] mx-auto">
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-muted shrink-0"><ScanLine size={20} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">Relecturas de NO_LEIDA</h1>
                        {datos.activa ? <Chip tono="bien" icono={Activity}>Prendida</Chip> : <Chip tono="quieto">Apagada en Analíticas</Chip>}
                        {datos.estado?.ultimoError && <Chip tono="aviso">Último error: {datos.estado.ultimoError}</Chip>}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        Cuando la lectora de un acceso no lee la chapa, se recorta el vehículo de la foto y se vuelve a leer. El monitor LPR la muestra como sugerencia («¿ABC1234?») y el guardia la confirma con «Cargar matrícula». No cambia el evento ni la barrera por sí sola.
                    </p>
                </div>
            </div>

            <Umbral datos={datos} alCambiar={async (u) => {
                const r = await fetch("/api/vision/relecturas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ umbral: u }) });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) { toast.error({ title: "No se guardó", description: j?.error || `El servidor respondió ${r.status}` }); return; }
                toast.success({ title: `Acertada desde ${Math.round(u * 100)} %`, description: "Se aplica también a lo ya releído." });
                await cargar();
            }} />

            <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                <Numero n={datos.noLeidas} rotulo="NO_LEIDA de las lectoras" sub={`en ${RANGOS.find((r) => r.v === h)?.r}`} />
                <Numero n={c.releidas} rotulo="Releídas" sub={c.sinFoto || c.errores ? `${c.sinFoto} sin foto · ${c.errores} con error` : "todas con foto"} />
                <Numero n={sugeridas} rotulo="Con chapa sugerida" sub={`${pct(sugeridas, c.releidas)} · ${c.leidas} acertadas, ${c.dudosas} dudosas`} tono="bien" />
                <Pista titulo="Coinciden con una lectura" texto={`La chapa sugerida la leyó también una lectora (la misma u otra) en ±${datos.otraLecturaH} h: el auto que la Salida no leyó casi siempre lo leyó la Entrada al llegar. Es la confirmación que no depende de nadie. Puede contar de más si la relectura leyó el auto de atrás y ese también pasó.`}>
                    <div><Numero n={c.confirmadasOtraCamara} rotulo="Coinciden con una lectura" sub={`${pct(c.confirmadasOtraCamara, sugeridas)} de las sugeridas`} tono="bien" /></div>
                </Pista>
                <Numero n={c.guardiaIgual + c.guardiaDistinta} rotulo="El guardia cargó la chapa" sub={`${c.guardiaIgual} igual a la sugerida · ${c.guardiaDistinta} distinta`} />
                <Numero n={c.sinChapa + c.sinVehiculo} rotulo="Sin sugerencia" sub={`${c.sinChapa} sin chapa legible · ${c.sinVehiculo} sin vehículo`} />
            </section>

            {!!datos.doble?.total && (
                <section className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Numero n={datos.doble.total} rotulo="Doble verificación" sub="lecturas de la cámara que OmniVision releyó" />
                    <Numero n={datos.doble.coincide} rotulo="Coinciden" sub={pct(datos.doble.coincide, datos.doble.total)} tono="bien" />
                    <Numero n={datos.doble.casi + datos.doble.difiere} rotulo="Difieren" sub={`${datos.doble.casi} por un carácter · ${datos.doble.difiere} otra chapa`} tono="aviso" />
                    <Numero n={datos.doble.sin} rotulo="Sin poder releer" sub="vale la lectura de la cámara" />
                </section>
            )}

            <div className="flex items-center gap-2 flex-wrap">
                <Filtros solido grupos={[
                    { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "f", titulo: "Cuáles", valor: filtro, alElegir: setFiltro, opciones: FILTROS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                ]} />
                <Pista titulo="Siluetas de OmniVision" texto="Dibuja sobre cada foto lo que vio OmniVision. Es la misma opción que en el historial, Buscar y el visor.">
                    <button type="button" onClick={() => setSiluetas(!siluetas)} aria-pressed={siluetas} aria-label="Siluetas de OmniVision"
                        className={cn("h-[34px] px-2.5 rounded-lg border inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors",
                            siluetas ? "accion border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent")}>
                        <Sparkles size={14} /> Siluetas
                    </button>
                </Pista>
            </div>

            {error && <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] px-4 py-2.5 text-[12.5px] text-[var(--mal-texto)]">No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}
            {filas.length === 0 ? (
                <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">
                    {c.releidas === 0 ? (datos.activa ? "Todavía no hay relecturas en este rango. La primera vez se pone al día con las NO_LEIDA del último día, de a una." : "La relectura está apagada (OmniVision › Analíticas).") : "Nada con este filtro."}
                </div>
            ) : (
                <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] auto-rows-[104px] [grid-auto-flow:dense]">
                    {filas.map((f, i) => (
                        <TarjetaRelectura key={f.id} f={f} siluetas={siluetas} alAbrir={() => setAbierta(f)}
                            grande={i < 2 || esNegra(f.vigilancia) || (f.estado === "LEIDA" && !!f.otraCamara && i % RITMO_BENTO === 0) || i % (RITMO_BENTO * 2) === 0} />
                    ))}
                </div>
            )}

            <Dialog open={!!abierta} onOpenChange={(o) => { if (!o) setAbierta(null); }}>
                <DialogContent className="sm:max-w-5xl p-0 gap-0 overflow-hidden">
                    <DialogTitle className="sr-only">Relectura {abierta?.plate || ""}</DialogTitle>
                    <DialogDescription className="sr-only">La foto del evento y lo que se releyó</DialogDescription>
                    {abierta && (
                        <div className="grid md:grid-cols-[1fr_300px]">
                            <div className="bg-black">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {abierta.foto ? (
                                    <div className="relative">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={getImagePath(abierta.foto) || abierta.foto} alt="Foto del evento" className="w-full max-h-[72vh] object-contain" />
                                        {siluetas && abierta.analisis && <CapaAnalisis analisis={abierta.analisis} ajuste="contain" />}
                                    </div>
                                ) : <div className="p-10 text-center text-white/50 text-[13px]">El evento no tiene foto</div>}
                            </div>
                            <div className="p-4 space-y-3 text-[12.5px]">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Sugerida</div>
                                    <div className="text-[22px] font-bold tabular-nums tracking-[0.12em]">{abierta.plate || "—"}</div>
                                    <div className="text-muted-foreground">{abierta.confianza != null ? `${Math.round(abierta.confianza * 100)} % · ` : ""}{(ESTADOS[abierta.estado] || ESTADOS.ERROR).r}{abierta.acuerdo === true ? " · los dos lectores coinciden" : abierta.acuerdo === false ? " · los dos lectores no coinciden" : ""}</div>
                                </div>
                                {abierta.plate && (
                                    <div className="space-y-1.5">
                                        <div className="text-[12px]">
                                            {abierta.persona ? <><b>{abierta.persona.nombre}</b> <span className="text-muted-foreground">· {rolEtiqueta(abierta.persona.rol)}{abierta.persona.unidad ? ` · ${abierta.persona.unidad}` : ""}</span></> : <span className="text-muted-foreground">La chapa sugerida no está en el padrón</span>}
                                        </div>
                                        {abierta.vigilancia && <span className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-semibold", esNegra(abierta.vigilancia) ? "pleno-mal" : "chip-info")}><ShieldAlert size={12} /> {abierta.vigilancia.etiqueta}</span>}
                                        <div className="flex flex-wrap gap-1.5">
                                            <button type="button" onClick={() => { const p = abierta.plate!; setAbierta(null); abrirRegistro(p); }} className="h-8 px-3 rounded-md bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5">
                                                <UserPlus size={14} /> {abierta.persona || abierta.vigilancia ? "Ver o cambiar registro" : "Registrar matrícula"}
                                            </button>
                                            <Link href={`/admin/history?search=${encodeURIComponent(abierta.plate)}`} className="h-8 px-3 rounded-md border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent">Historial <ArrowUpRight size={13} /></Link>
                                        </div>
                                    </div>
                                )}
                                <button type="button" onClick={() => { const a = abierta; setAbierta(null); void marcarNegra({ id: a.id, recorte: a.recorte?.replace("/api/vision/imagen/", "") || null, foto: null, camara: a.camara || "la lectora", primeraVez: a.ts }, a.plate); }}
                                    className="w-full h-8 rounded-md border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] tono-mal text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-[var(--mal)]">
                                    <Ban size={14} /> Marcar en lista negra con esta captura
                                </button>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {abierta.chapa && <img src={`${abierta.chapa}?w=320`} alt="Chapa" className="w-full rounded-md border border-border bg-black" />}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {abierta.recorte && <img src={`${abierta.recorte}?w=320`} alt="Vehículo" className="w-full rounded-md border border-border bg-black" />}
                                <dl className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-1">
                                    <dt className="text-muted-foreground">Cámara</dt><dd>{abierta.camara || "—"}</dd>
                                    <dt className="text-muted-foreground">Cuándo</dt><dd className="tabular-nums">{dia(abierta.ts)} {hora(abierta.ts)}</dd>
                                    <dt className="text-muted-foreground">Barrera</dt><dd>{abierta.decision === "GRANT" ? "permitido" : abierta.decision === "DENY" ? "denegado" : "—"}</dd>
                                    <dt className="text-muted-foreground">Vehículos</dt><dd>{abierta.vehiculos}{abierta.vehiculo ? ` (leído: ${abierta.vehiculo})` : ""}</dd>
                                    <dt className="text-muted-foreground">Otras</dt><dd>{abierta.otras.length ? abierta.otras.map((o) => o.plate).join(", ") : "—"}</dd>
                                    <dt className="text-muted-foreground">Coincide</dt><dd>{abierta.otraCamara ? `${abierta.otraCamara.camara} a las ${hora(abierta.otraCamara.ts)}` : "ninguna lectura"}</dd>
                                    <dt className="text-muted-foreground">Guardia</dt><dd>{abierta.guardia ? `cargó ${abierta.guardia}` : "no cargó nada"}</dd>
                                    <dt className="text-muted-foreground">Tardó</dt><dd className="tabular-nums">{abierta.ms != null ? `${abierta.ms} ms` : "—"}</dd>
                                    {abierta.error && <><dt className="text-muted-foreground">Error</dt><dd className="tono-mal">{abierta.error}</dd></>}
                                </dl>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            {cajones}
        </div>
    );
}
