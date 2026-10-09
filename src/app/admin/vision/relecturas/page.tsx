"use client";

import { useCallback, useEffect, useState } from "react";
import { ScanLine, Activity, Camera, CheckCircle2, UserCheck } from "lucide-react";
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
};
type Respuesta = {
    h: number; noLeidas: number; activa: boolean; otraLecturaH: number; filas: Fila[];
    /** Desde qué confianza una relectura es «acertada», y qué pasaría con cada valor. */
    umbral: number; porUmbral: { umbral: number; acertadas: number; confirmadas: number }[];
    conteo: { releidas: number; leidas: number; dudosas: number; sinChapa: number; sinVehiculo: number; sinFoto: number; errores: number; confirmadasOtraCamara: number; guardiaIgual: number; guardiaDistinta: number };
    estado: null | { activa: boolean; hechas: number; ultimoError: string | null; msUltima: number | null };
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

    const cargar = useCallback(async () => {
        try {
            const r = await fetch(`/api/vision/relecturas?h=${h}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, [h]);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);

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

            <Filtros grupos={[
                { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                { clave: "f", titulo: "Cuáles", valor: filtro, alElegir: setFiltro, opciones: FILTROS.map((x) => ({ valor: x.v, rotulo: x.r })) },
            ]} />

            {error && <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] px-4 py-2.5 text-[12.5px] text-[var(--mal-texto)]">No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}
            {filas.length === 0 ? (
                <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">
                    {c.releidas === 0 ? (datos.activa ? "Todavía no hay relecturas en este rango. La primera vez se pone al día con las NO_LEIDA del último día, de a una." : "La relectura está apagada (OmniVision › Analíticas).") : "Nada con este filtro."}
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                    {filas.map((f) => {
                        const e = ESTADOS[f.estado] || ESTADOS.ERROR;
                        return (
                            <button key={f.id} type="button" onClick={() => setAbierta(f)} className="text-left rounded-[10px] border border-border bg-card overflow-hidden hover:border-[var(--accion)] transition-colors">
                                <div className="aspect-[2/1] bg-black flex items-center justify-center overflow-hidden">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    {f.chapa ? <img src={`${f.chapa}?w=320`} alt={f.plate || ""} loading="lazy" className="w-full h-full object-contain" />
                                        // eslint-disable-next-line @next/next/no-img-element
                                        : f.recorte ? <img src={`${f.recorte}?w=320`} alt="" loading="lazy" className="w-full h-full object-cover opacity-80" />
                                            : <Camera size={18} className="text-white/30" />}
                                </div>
                                <div className="p-2.5 space-y-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[14px] font-bold tabular-nums tracking-[0.1em]">{f.plate || "—"}</span>
                                        {f.confianza != null && <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(f.confianza * 100)} %</span>}
                                        <Chip tono={e.tono} className="ml-auto">{e.r}</Chip>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground truncate">{f.camara || "—"} · {dia(f.ts)} {hora(f.ts)}</div>
                                    {f.otraCamara && <div className="text-[11px] tono-bien inline-flex items-center gap-1 truncate max-w-full"><CheckCircle2 size={11} /> {f.otraCamara.camara} {hora(f.otraCamara.ts)}</div>}
                                    {f.guardia && <div className={cn("text-[11px] inline-flex items-center gap-1", f.guardia === f.plate ? "tono-bien" : "tono-aviso")}><UserCheck size={11} /> guardia: {f.guardia}</div>}
                                </div>
                            </button>
                        );
                    })}
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
                                {abierta.foto ? <img src={abierta.foto} alt="Foto del evento" className="w-full max-h-[72vh] object-contain" /> : <div className="p-10 text-center text-white/50 text-[13px]">El evento no tiene foto</div>}
                            </div>
                            <div className="p-4 space-y-3 text-[12.5px]">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Sugerida</div>
                                    <div className="text-[22px] font-bold tabular-nums tracking-[0.12em]">{abierta.plate || "—"}</div>
                                    <div className="text-muted-foreground">{abierta.confianza != null ? `${Math.round(abierta.confianza * 100)} % · ` : ""}{(ESTADOS[abierta.estado] || ESTADOS.ERROR).r}{abierta.acuerdo === true ? " · los dos lectores coinciden" : abierta.acuerdo === false ? " · los dos lectores no coinciden" : ""}</div>
                                </div>
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
        </div>
    );
}
