"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScanLine, Activity, Camera, CheckCircle2, UserCheck, Sparkles, Ban, UserPlus, ArrowUpRight, ShieldAlert, ScanEye, Info } from "lucide-react";
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
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { ChapaGrande, Lupa, Recorte } from "@/components/lpr/CajonComparacion";

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
    /** Doble verificación: la cámara SÍ leyó y OmniVision volvió a leer para comparar. */
    doble: boolean;
    /** Lo que leyó la cámara (null = no leyó), su recorte de chapa, y el veredicto si es doble. */
    camaraLeyo: string | null; fotoChapaCamara: string | null; comparacion: "coincide" | "casi" | "difiere" | "sin" | null;
};
const esNegra = (v: Vigilancia | null) => v?.categoria === "BLACKLISTED" || v?.categoria === "SEARCH";
const VEREDICTO: Record<string, { r: string; tono: "bien" | "aviso" | "mal" | "quieto" }> = {
    coincide: { r: "coinciden", tono: "bien" }, casi: { r: "difieren en un carácter", tono: "aviso" }, difiere: { r: "otra chapa", tono: "mal" }, sin: { r: "OmniVision no pudo releer", tono: "quieto" },
};
const PLENO: Record<string, string> = { bien: "pleno-bien", aviso: "pleno-aviso", mal: "pleno-mal" };

/** Un rótulo sobre la foto: quién leyó (la cámara u OmniVision). */
function Quien({ icono: Ic, texto }: { icono: typeof Camera; texto: string }) {
    return <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-[5px] bg-black/65 text-white text-[10px] font-semibold"><Ic size={11} /> {texto}</span>;
}

/**
 * Una relectura, comparada (16/10, Nico: «la grilla debe ser comparativa, dos cuadros, uno con lo
 * que leyó la cámara y otro lo que leyó OmniVision»). Antes era una foto con la sugerida encima:
 * no se veía qué había leído la cámara, y en la doble verificación eso es la mitad de la pregunta.
 *
 *  · Izquierda, la cámara: la foto del evento y lo que leyó (o «no leyó»), con su recorte.
 *  · Derecha, OmniVision: el vehículo que recortó, la chapa que leyó, su recorte y la confianza.
 *  · Abajo, el veredicto: coinciden / difieren (doble) o acertada / dudosa (NO_LEIDA), y quién lo
 *    confirmó (otra lectora, el guardia).
 */
function TarjetaRelectura({ f, siluetas, alAbrir }: { f: Fila; siluetas: boolean; alAbrir: () => void }) {
    const [cargada, setCargada] = useState(false);
    const e = ESTADOS[f.estado] || ESTADOS.ERROR;
    const v = f.comparacion ? VEREDICTO[f.comparacion] : null;
    const url = getImagePath(f.foto);
    const chapaCam = getImagePath(f.fotoChapaCamara);
    const negra = esNegra(f.vigilancia);
    const tono = v ? v.tono : e.tono;
    return (
        <button type="button" onClick={alAbrir} title={`${f.camara || ""} · ${hora(f.ts)}`}
            className={cn("group text-left rounded-[10px] border border-border bg-card overflow-hidden outline-none hover:border-[var(--accion)] focus-visible:ring-2 focus-visible:ring-[var(--accion)] [content-visibility:auto] transition-colors",
                negra && "ring-2 ring-[var(--mal)]")}>
            <span className="grid grid-cols-2 gap-px bg-border">
                {/* La cámara */}
                <span className="relative block aspect-[4/3] bg-black overflow-hidden">
                    {!cargada && url && <span className="absolute inset-0 animate-pulse bg-white/5" />}
                    {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${url}${url.includes("?") ? "&" : "?"}w=320`} alt="" loading="lazy" decoding="async" onLoad={() => setCargada(true)} onError={() => setCargada(true)}
                            className={cn("absolute inset-0 w-full h-full object-cover transition-opacity", cargada ? "opacity-100" : "opacity-0")} />
                    ) : <Camera size={18} className="absolute inset-0 m-auto text-white/30" />}
                    {siluetas && cargada && url && f.analisis && <CapaAnalisis analisis={f.analisis} ajuste="cover" etiquetas={false} />}
                    <Quien icono={Camera} texto="Cámara" />
                    <span className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6 bg-gradient-to-t from-black/90 to-transparent flex items-end gap-1.5">
                        {f.camaraLeyo
                            ? <span className="min-w-0 flex-1 text-[15px] font-bold tracking-wider text-white tabular-nums truncate">{f.camaraLeyo}</span>
                            : <span className="min-w-0 flex-1 text-[12px] font-semibold text-white/60 italic">No leyó</span>}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {chapaCam && f.camaraLeyo && <img src={`${chapaCam}${chapaCam.includes("?") ? "&" : "?"}w=160`} alt="" loading="lazy" className="h-6 max-w-[64px] rounded-[3px] ring-1 ring-white/70 bg-black object-contain shrink-0" />}
                    </span>
                </span>
                {/* OmniVision */}
                <span className="relative block aspect-[4/3] bg-black overflow-hidden">
                    {f.recorte ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${f.recorte}?w=320`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    ) : <span className="absolute inset-0 grid place-items-center text-[11px] text-white/40">{f.estado === "SIN_VEHICULO" ? "No encontró vehículo" : f.estado === "SIN_FOTO" ? "Sin foto" : "—"}</span>}
                    <Quien icono={ScanEye} texto="OmniVision" />
                    {f.confianza != null && <span className="absolute right-1.5 top-1.5 h-5 px-1.5 rounded-[5px] bg-black/65 text-white text-[10px] font-bold tabular-nums inline-flex items-center">{Math.round(f.confianza * 100)} %</span>}
                    <span className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6 bg-gradient-to-t from-black/90 to-transparent flex items-end gap-1.5">
                        {f.plate
                            ? <span className="min-w-0 flex-1 text-[15px] font-bold tracking-wider text-white tabular-nums truncate">{f.doble ? f.plate : `¿${f.plate}?`}</span>
                            : <span className="min-w-0 flex-1 text-[12px] font-semibold text-white/60 italic">{f.estado === "SIN_CHAPA" ? "Sin chapa legible" : "No leyó"}</span>}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {f.chapa && <img src={`${f.chapa}?w=160`} alt="" loading="lazy" className="h-6 max-w-[64px] rounded-[3px] ring-1 ring-white/70 bg-black object-contain shrink-0" />}
                    </span>
                </span>
            </span>
            <span className="flex items-center gap-1.5 px-2.5 h-8 text-[11px] min-w-0">
                <span className={cn("shrink-0 inline-flex items-center h-5 px-1.5 rounded-[5px] font-semibold", PLENO[tono] || "chip-quieto")}>{v ? v.r : e.r}</span>
                {negra && <span className="shrink-0 inline-flex items-center gap-0.5 h-5 px-1.5 rounded-[5px] font-semibold pleno-mal"><Ban size={10} /> {f.vigilancia!.etiqueta}</span>}
                {f.otraCamara && <span className="shrink-0 inline-flex items-center gap-0.5 tono-bien font-semibold" title={`La leyó ${f.otraCamara.camara} a las ${hora(f.otraCamara.ts)}`}><CheckCircle2 size={11} /> otra lectora</span>}
                {f.guardia && <span className={cn("shrink-0 inline-flex items-center gap-0.5 font-semibold", f.guardia === f.plate ? "tono-bien" : "tono-aviso")} title={`El guardia cargó ${f.guardia}`}><UserCheck size={11} /> {f.guardia}</span>}
                <span className="ml-auto min-w-0 truncate text-muted-foreground tabular-nums">{f.camara || "—"} · {hora(f.ts)}</span>
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
 * El umbral de «acertada», en una fila (16/10, Nico: «Acertada desde y los otros bloques ocupan
 * mucho espacio»). Antes eran seis tarjetas grandes; ahora seis píldoras, y lo que pasaría con
 * cada valor —cuántas acertadas y qué parte confirmó otra lectora o el guardia— va en la pista.
 * La decisión sigue siendo de quien mira esos números, no un valor escrito en el código.
 */
function Umbral({ datos, alCambiar }: { datos: Respuesta; alCambiar: (u: number) => void }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <Pista titulo="Acertada desde" texto="Con menos confianza la sugerencia sale como «dudosa». Cambiarlo reclasifica también lo ya releído. Pasá el mouse por cada valor para ver qué pasaría.">
                <span className="text-[12px] font-semibold text-muted-foreground cursor-help">Acertada desde</span>
            </Pista>
            <span className="flex items-center h-[34px] rounded-lg bg-muted/60 p-0.5">
                {datos.porUmbral.map((o) => {
                    const sel = Math.abs(o.umbral - datos.umbral) < 0.001;
                    return (
                        <Pista key={o.umbral} titulo={`Desde ${Math.round(o.umbral * 100)} %`} texto={`${o.acertadas} acertadas · ${o.acertadas ? Math.round((o.confirmadas / o.acertadas) * 100) : 0} % confirmadas por otra lectora o el guardia.`}>
                            <button type="button" onClick={() => !sel && alCambiar(o.umbral)} aria-pressed={sel}
                                className={cn("h-[30px] px-2.5 rounded-md text-[12px] font-semibold tabular-nums", sel ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground")}>
                                {Math.round(o.umbral * 100)}
                            </button>
                        </Pista>
                    );
                })}
            </span>
        </span>
    );
}

const RANGOS = [{ v: "6", r: "6 h" }, { v: "24", r: "24 h" }, { v: "72", r: "3 días" }, { v: "168", r: "7 días" }];
const REFRESCO_MS = 15_000;
const ESTADOS: Record<string, { r: string; tono: "bien" | "aviso" | "quieto" | "mal" }> = {
    LEIDA: { r: "acertada", tono: "bien" }, DUDOSA: { r: "dudosa", tono: "aviso" }, SIN_CHAPA: { r: "sin chapa", tono: "quieto" },
    SIN_VEHICULO: { r: "sin vehículo", tono: "quieto" }, SIN_FOTO: { r: "sin foto", tono: "quieto" }, ERROR: { r: "error", tono: "mal" },
};
/** De dónde viene: la cámara no leyó (relectura) o sí leyó y se verificó (doble). */
const ORIGENES = [{ v: "", r: "Todas" }, { v: "nl", r: "Cámara no leyó" }, { v: "doble", r: "Doble verificación" }];
const RESULTADOS = [{ v: "", r: "Todas" }, { v: "sugerida", r: "OmniVision leyó" }, { v: "coincide", r: "Coinciden" }, { v: "difiere", r: "Difieren" }, { v: "sin", r: "Sin lectura" }];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { day: "numeric", month: "short", timeZone: "America/Montevideo" });

/** Un número de la tira de arriba: la cifra y su rótulo en una línea, la explicación en la pista. */
function Cifra({ n, rotulo, pista, tono }: { n: number | string; rotulo: string; pista: string; tono?: "bien" | "aviso" }) {
    return (
        <Pista titulo={rotulo} texto={pista} ancho={300}>
            <span className="inline-flex items-baseline gap-1.5 px-3 py-2 cursor-help whitespace-nowrap">
                <b className={cn("text-[16px] tabular-nums leading-none", tono === "bien" && "tono-bien", tono === "aviso" && "tono-aviso")}>{n}</b>
                <span className="text-[11.5px] text-muted-foreground">{rotulo}</span>
            </span>
        </Pista>
    );
}

/** ¿La fila pasa los filtros? «Coinciden» y «Difieren» se leen distinto según de dónde viene. */
function pasa(f: Fila, origen: string, resultado: string): boolean {
    if (origen === "nl" && f.doble) return false;
    if (origen === "doble" && !f.doble) return false;
    if (resultado === "sugerida") return !!f.plate;
    if (resultado === "sin") return !f.plate;
    if (resultado === "coincide") return f.doble ? f.comparacion === "coincide" : !!f.otraCamara || (!!f.guardia && f.guardia === f.plate);
    if (resultado === "difiere") return f.doble ? f.comparacion === "casi" || f.comparacion === "difiere" : !!f.guardia && !!f.plate && f.guardia !== f.plate;
    return true;
}

export default function RelecturasVision() {
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [h, setH] = useState("24");
    const [origen, setOrigen] = useState("");
    const [resultado, setResultado] = useState("");
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
    const filas = datos.filas.filter((f) => pasa(f, origen, resultado));
    const cambiarUmbral = async (u: number) => {
        const r = await fetch("/api/vision/relecturas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ umbral: u }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { toast.error({ title: "No se guardó", description: j?.error || `El servidor respondió ${r.status}` }); return; }
        toast.success({ title: `Acertada desde ${Math.round(u * 100)} %`, description: "Se aplica también a lo ya releído." });
        await cargar();
    };

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1500px] mx-auto">
            {/* Título en un renglón: la explicación larga pasó a la pista del ícono. */}
            <div className="flex items-center gap-2.5 flex-wrap">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-muted shrink-0"><ScanLine size={16} /></span>
                <h1 className="text-[17px] font-bold leading-tight">Relecturas</h1>
                <Pista titulo="Qué es esto" ancho={340} texto="Lo que leyó la cámara al lado de lo que leyó OmniVision. Cuando la lectora no lee la chapa (NO_LEIDA), OmniVision recorta el vehículo de la foto y la vuelve a leer: el monitor LPR la muestra como sugerencia («¿ABC1234?») y el guardia la confirma. En las cámaras con doble verificación relee también lo que la cámara sí leyó, para comparar. No cambia el evento ni la barrera por sí sola.">
                    <Info size={15} className="text-muted-foreground cursor-help" />
                </Pista>
                {datos.activa ? <Chip tono="bien" icono={Activity}>Prendida</Chip> : <Chip tono="quieto">Apagada en Analíticas</Chip>}
                {datos.estado?.ultimoError && <Chip tono="aviso">Último error: {datos.estado.ultimoError}</Chip>}
            </div>

            {/* Los números, en una tira (16/10: «ocupan mucho espacio»). Antes, diez tarjetas en dos filas. */}
            <section className="rounded-[10px] border border-border bg-card flex flex-wrap items-center divide-x divide-border">
                <span className="px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cámara no leyó</span>
                <Cifra n={datos.noLeidas} rotulo="NO_LEIDA" pista={`Lecturas de las cámaras sin chapa en ${RANGOS.find((r) => r.v === h)?.r}.`} />
                <Cifra n={c.releidas} rotulo="releídas" pista={c.sinFoto || c.errores ? `${c.sinFoto} sin foto · ${c.errores} con error.` : "Todas con foto."} />
                <Cifra n={sugeridas} rotulo={`leyó OmniVision · ${pct(sugeridas, c.releidas)}`} tono="bien" pista={`${c.leidas} acertadas y ${c.dudosas} dudosas. ${c.sinChapa} sin chapa legible y ${c.sinVehiculo} sin vehículo.`} />
                <Cifra n={c.confirmadasOtraCamara} rotulo={`confirmadas · ${pct(c.confirmadasOtraCamara, sugeridas)}`} tono="bien" pista={`La chapa que leyó OmniVision la leyó también una lectora en ±${datos.otraLecturaH} h: el auto que la Salida no leyó casi siempre lo leyó la Entrada al llegar. Es la confirmación que no depende de nadie. Puede contar de más si la relectura leyó el auto de atrás y ese también pasó.`} />
                <Cifra n={c.guardiaIgual + c.guardiaDistinta} rotulo="cargó el guardia" pista={`${c.guardiaIgual} igual a la de OmniVision · ${c.guardiaDistinta} distinta.`} />
                {!!datos.doble?.total && (<>
                    <span className="px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Doble verificación</span>
                    <Cifra n={datos.doble.total} rotulo="verificadas" pista="Lecturas de la cámara que OmniVision releyó para comparar." />
                    <Cifra n={datos.doble.coincide} rotulo={`coinciden · ${pct(datos.doble.coincide, datos.doble.total)}`} tono="bien" pista="La cámara y OmniVision leyeron la misma chapa." />
                    <Cifra n={datos.doble.casi + datos.doble.difiere} rotulo="difieren" tono="aviso" pista={`${datos.doble.casi} por un carácter · ${datos.doble.difiere} otra chapa. ${datos.doble.sin} sin poder releer (vale la de la cámara).`} />
                </>)}
            </section>

            <div className="flex items-center gap-2 flex-wrap">
                <Filtros solido grupos={[
                    { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "o", titulo: "De dónde", valor: origen, alElegir: setOrigen, opciones: ORIGENES.map((x) => ({ valor: x.v, rotulo: x.r })), oculto: !datos.doble?.total },
                    { clave: "r", titulo: "Resultado", valor: resultado, alElegir: setResultado, opciones: RESULTADOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                ]} />
                <Umbral datos={datos} alCambiar={cambiarUmbral} />
                <Pista titulo="Siluetas de OmniVision" texto="Dibuja sobre cada foto lo que vio OmniVision. Es la misma opción que en el historial, Buscar y el visor.">
                    <button type="button" onClick={() => setSiluetas(!siluetas)} aria-pressed={siluetas} aria-label="Siluetas de OmniVision"
                        className={cn("ml-auto h-[34px] px-2.5 rounded-lg border inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors",
                            siluetas ? "accion border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent")}>
                        <Sparkles size={14} /> Siluetas
                    </button>
                </Pista>
            </div>

            {error && <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] px-4 py-2.5 text-[12.5px] text-[var(--mal-texto)]">No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}
            {filas.length === 0 ? (
                <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">
                    {datos.filas.length === 0 ? (datos.activa ? "Todavía no hay relecturas en este rango. La primera vez se pone al día con las NO_LEIDA del último día, de a una." : "La relectura está apagada (OmniVision › Analíticas).") : "Nada con este filtro."}
                </div>
            ) : (
                <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
                    {filas.map((f) => <TarjetaRelectura key={f.id} f={f} siluetas={siluetas} alAbrir={() => setAbierta(f)} />)}
                </div>
            )}

            <CajonRelectura f={abierta} umbral={datos.umbral} siluetas={siluetas} alCerrar={() => setAbierta(null)}
                alRegistrar={(p) => { setAbierta(null); abrirRegistro(p); }}
                alListaNegra={(a) => { setAbierta(null); void marcarNegra({ id: a.id, recorte: a.recorte?.replace("/api/vision/imagen/", "") || null, foto: null, camara: a.camara || "la lectora", primeraVez: a.ts }, a.plate); }} />
            {cajones}
        </div>
    );
}

/**
 * Lo que pasó con una relectura, contado en una frase (16/10, Nico: «comparación bien clara,
 * descriptiva»): quién leyó qué, si alcanzó el umbral y quién lo confirmó.
 */
function relato(f: Fila, umbral: number): string[] {
    const pct = (c: number | null) => (c != null ? `${Math.round(c * 100)} %` : "");
    const out: string[] = [];
    if (f.doble) {
        out.push(`La cámara leyó ${f.camaraLeyo || "una chapa"} y OmniVision volvió a leer la foto para verificarla (doble verificación).`);
        if (f.comparacion === "coincide") out.push(`OmniVision leyó lo mismo${f.confianza != null ? `, con ${pct(f.confianza)}` : ""}: la lectura de la cámara queda confirmada.`);
        else if (f.comparacion === "casi") out.push(`OmniVision leyó ${f.plate}: difieren en un carácter. Conviene mirar el recorte de la chapa.`);
        else if (f.comparacion === "difiere") out.push(`OmniVision leyó otra chapa (${f.plate}). Puede ser otro auto en el cuadro o una mala lectura de alguno de los dos: mirá los recortes.`);
        else out.push("OmniVision no pudo releerla: vale la lectura de la cámara.");
    } else {
        out.push("La cámara no leyó la chapa (NO_LEIDA). OmniVision recortó el vehículo de la foto y la volvió a leer.");
        if (f.plate) out.push(`Leyó ${f.plate}${f.confianza != null ? ` con ${pct(f.confianza)}` : ""}: ${f.estado === "LEIDA" ? `acertada (desde ${Math.round(umbral * 100)} %)` : `dudosa (por debajo de ${Math.round(umbral * 100)} %)`}.${f.acuerdo === true ? " Los dos lectores de OmniVision coinciden." : f.acuerdo === false ? " Los dos lectores de OmniVision no coinciden." : ""}`);
        else out.push(f.estado === "SIN_CHAPA" ? "No encontró una chapa legible en el vehículo." : f.estado === "SIN_VEHICULO" ? "No encontró ningún vehículo en la foto." : f.estado === "SIN_FOTO" ? "El evento no tenía foto." : `No pudo releerla${f.error ? `: ${f.error}` : ""}.`);
    }
    if (f.plate) out.push(f.otraCamara ? `La misma chapa la leyó ${f.otraCamara.camara || "otra lectora"} a las ${hora(f.otraCamara.ts)}: es la confirmación que no depende de nadie.` : "Ninguna otra lectora la leyó en ±6 h.");
    if (f.guardia) out.push(f.guardia === f.plate ? `El guardia cargó ${f.guardia}: la misma.` : `El guardia cargó ${f.guardia}, distinta de lo que leyó OmniVision.`);
    return out;
}

/**
 * Una relectura, en un cajón (16/10, Nico: «este modal debe ser un drawer, estilizado, con la
 * comparación bien clara, descriptivo»). Antes era un diálogo con la foto y una columna de datos:
 * lo que leyó cada uno estaba en dos cajitas chicas y había que leer la tabla para entender qué
 * había pasado. Ahora, en este orden: la foto (con lupa, o con las siluetas), el veredicto en una
 * franja, la cámara y OmniVision lado a lado como chapas —en rojo lo que difiere—, lo que pasó
 * contado en palabras, los recortes grandes y, al final, qué se hace y los datos.
 */
function CajonRelectura({ f, umbral, siluetas, alCerrar, alRegistrar, alListaNegra }: {
    f: Fila | null; umbral: number; siluetas: boolean; alCerrar: () => void; alRegistrar: (p: string) => void; alListaNegra: (f: Fila) => void;
}) {
    if (!f) return null;
    const foto = getImagePath(f.foto);
    const v = f.comparacion ? VEREDICTO[f.comparacion] : null;
    const e = ESTADOS[f.estado] || ESTADOS.ERROR;
    const titulo = v ? (f.comparacion === "coincide" ? "La cámara y OmniVision coinciden" : f.comparacion === "sin" ? "OmniVision no pudo verificarla" : "La cámara y OmniVision difieren")
        : f.plate ? (f.estado === "LEIDA" ? "OmniVision leyó lo que la cámara no" : "OmniVision sugiere, con dudas") : "Nadie pudo leer la chapa";
    const tono = v ? v.tono : f.plate ? (f.estado === "LEIDA" ? "bien" : "aviso") : "quieto";
    const franja = tono === "bien" ? "pleno-bien" : tono === "aviso" ? "pleno-aviso" : tono === "mal" ? "pleno-mal" : "bg-muted text-foreground";
    const I = tono === "bien" ? CheckCircle2 : tono === "quieto" ? Info : ShieldAlert;
    return (
        <Cajon open={!!f} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={`${f.camara || "Lectora"} · ${hora(f.ts)}`} descripcion={`${dia(f.ts)} · ${f.doble ? "doble verificación" : "relectura de una NO_LEIDA"} · barrera ${f.decision === "GRANT" ? "permitió" : f.decision === "DENY" ? "denegó" : "—"}`}
                encabezado={foto ? (siluetas && f.analisis ? (
                    <div className="relative bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={foto} alt="Foto del evento" className="block w-full max-h-[46vh] object-contain" />
                        <CapaAnalisis analisis={f.analisis} ajuste="contain" />
                    </div>
                ) : <Lupa src={foto} alt="Foto del evento" />) : <div className="h-40 grid place-items-center bg-muted/40 text-[12.5px] text-muted-foreground">El evento no tiene foto</div>}>
                <div className="px-6 py-5 space-y-5">
                    <div className={cn("flex items-start gap-3 rounded-[12px] px-4 py-3", franja)}>
                        <I size={20} className="shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <div className="text-[15px] font-extrabold leading-tight">{titulo}</div>
                            <div className="text-[12.5px] opacity-90">{v ? v.r : e.r}{f.confianza != null ? ` · ${Math.round(f.confianza * 100)} % de confianza` : ""}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-[12px] bg-muted/40 p-4 flex flex-col items-center text-center gap-2.5">
                            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><Camera size={13} /> Leyó la cámara</span>
                            <ChapaGrande p={f.camaraLeyo} />
                            <span className="text-[11.5px] text-muted-foreground">{f.camaraLeyo ? "ANPR de la cámara" : "No leyó la chapa"}</span>
                        </div>
                        <div className="rounded-[12px] bg-muted/40 p-4 flex flex-col items-center text-center gap-2.5">
                            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><ScanEye size={13} /> Leyó OmniVision</span>
                            <ChapaGrande p={f.plate} contra={f.camaraLeyo} />
                            <span className={cn("text-[11.5px]", e.tono === "bien" ? "tono-bien" : e.tono === "aviso" ? "tono-aviso" : "text-muted-foreground")}>{e.r}{f.confianza != null ? ` · ${Math.round(f.confianza * 100)} %` : ""}</span>
                        </div>
                    </div>

                    <div>
                        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Qué pasó</div>
                        <ul className="space-y-1.5">
                            {relato(f, umbral).map((t, k) => (
                                <li key={k} className="flex items-start gap-2 text-[13px] leading-snug"><span className="mt-[0.5em] h-1.5 w-1.5 rounded-full bg-[var(--accion)] shrink-0" />{t}</li>
                            ))}
                        </ul>
                    </div>

                    {(f.fotoChapaCamara || f.chapa || f.recorte) && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Recorte src={f.fotoChapaCamara} rotulo="Chapa · recorte de la cámara" />
                            <Recorte src={f.chapa} rotulo="Chapa · recorte de OmniVision" />
                            <Recorte src={f.recorte} rotulo="Vehículo · recorte de OmniVision" />
                        </div>
                    )}

                    {f.otras.length > 0 && (
                        <div>
                            <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Otras lecturas de OmniVision en la foto</div>
                            <div className="flex flex-wrap gap-1.5">{f.otras.map((o) => <span key={o.plate} className="inline-flex items-center gap-1"><ChapaGrande p={o.plate} contra={f.plate} chica /><span className="text-[11.5px] text-muted-foreground tabular-nums">{Math.round(o.confianza * 100)} %</span></span>)}</div>
                        </div>
                    )}

                    {f.plate && (
                        <div className="rounded-[12px] border border-border p-3.5 space-y-2.5">
                            <div className="text-[12.5px]">
                                {f.persona ? <><b>{f.persona.nombre}</b> <span className="text-muted-foreground">· {rolEtiqueta(f.persona.rol)}{f.persona.unidad ? ` · ${f.persona.unidad}` : ""}</span></> : <span className="text-muted-foreground">La chapa de OmniVision no está en el padrón.</span>}
                                {f.vigilancia && <span className={cn("ml-2 inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-semibold", esNegra(f.vigilancia) ? "pleno-mal" : "chip-info")}><ShieldAlert size={12} /> {f.vigilancia.etiqueta}</span>}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => alRegistrar(f.plate!)} className="h-9 px-3.5 rounded-[8px] bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"><UserPlus size={14} /> {f.persona || f.vigilancia ? "Ver o cambiar registro" : "Registrar matrícula"}</button>
                                <Link href={`/admin/history?search=${encodeURIComponent(f.plate)}`} className="h-9 px-3.5 rounded-[8px] border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent">Historial <ArrowUpRight size={13} /></Link>
                                <button type="button" onClick={() => alListaNegra(f)} className="h-9 px-3.5 rounded-[8px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 tono-mal hover:bg-[var(--mal-suave)]"><Ban size={14} /> Lista negra con esta captura</button>
                            </div>
                        </div>
                    )}

                    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                        <dt className="text-muted-foreground">Lectora</dt><dd>{f.camara || "—"}{f.sentido ? ` · ${f.sentido === "EXIT" ? "salida" : "entrada"}` : ""}</dd>
                        <dt className="text-muted-foreground">Cuándo</dt><dd className="tabular-nums">{dia(f.ts)} {hora(f.ts)}</dd>
                        <dt className="text-muted-foreground">Vehículos en la foto</dt><dd>{f.vehiculos}{f.vehiculo ? ` (el leído: ${f.vehiculo})` : ""}</dd>
                        <dt className="text-muted-foreground">Tardó</dt><dd className="tabular-nums">{f.ms != null ? `${(f.ms / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1 })} s` : "—"}</dd>
                        {f.error && <><dt className="text-muted-foreground">Error</dt><dd className="tono-mal">{f.error}</dd></>}
                    </dl>
                </div>
            </CajonContenido>
        </Cajon>
    );
}
