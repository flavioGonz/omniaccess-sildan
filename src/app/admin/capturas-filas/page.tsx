"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Images, RefreshCw, Archive, TriangleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { CajonCaptura, type Captura } from "@/components/queue/CajonCaptura";
import { tonoFila } from "@/components/queue/CajonFila";
import { getLecturasFilas, getRetencionFotos, guardarRetencionFotos, getFilasConLimite, type Lectura } from "@/app/actions/flujo-filas";
import { horaSeg, fecha, diaSemana } from "@/lib/fechas";
import { enMontevideo } from "@/lib/filas/horario";
import { cn } from "@/lib/utils";

/**
 * Historial de capturas de las filas (HB, 19/10: «tenemos que tener un historial de capturas»).
 *
 * Una grilla de fotos, del momento más reciente para atrás, agrupada por día. Lo que se busca acá
 * es una escena («¿cómo estaba la caja a las 11?», «¿por qué saltó el aviso?»), no un número: por
 * eso la foto manda y el dato va encima, chico. La retención (cuánto se guarda) se ajusta desde
 * acá mismo, que es donde se ve lo que se pierde.
 */

const POR_PAGINA = 60;
/** Bento (por defecto, pedido de Nico) o grilla pareja. Se recuerda por navegador. */
type Vista = "bento" | "grilla";
const CLAVE_VISTA = "capturas-filas:vista";
/** Filtros de gente: desde 1 (todas las que tienen foto), varias personas, o la fila en su límite. */
const MINIMOS = [{ k: "1", rotulo: "Todas" }, { k: "3", rotulo: "3 o más" }, { k: "limite", rotulo: "En el límite" }] as const;

export default function CapturasFilasPage() {
    const [filas, setFilas] = useState<{ id: string; name: string; limite: number }[]>([]);
    const [deviceId, setDeviceId] = useState("");
    const [dia, setDia] = useState("");
    const [minimo, setMinimo] = useState<(typeof MINIMOS)[number]["k"]>("1");
    const [capturas, setCapturas] = useState<Lectura[]>([]);
    const [total, setTotal] = useState(0);
    const [pagina, setPagina] = useState(0);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<Captura | null>(null);
    const [retencion, setRetencion] = useState(false);
    const [vista, setVista] = useState<Vista>("bento");
    useEffect(() => { try { const v = localStorage.getItem(CLAVE_VISTA); if (v === "bento" || v === "grilla") setVista(v); } catch { } }, []);
    const cambiarVista = (v: Vista) => { setVista(v); try { localStorage.setItem(CLAVE_VISTA, v); } catch { } };
    const abrir = useCallback((c: Lectura) => setAbierta({ foto: c.foto, t: c.t, fila: c.fila, personas: c.personas, limite: c.limite, canal: c.canal, titulo: "Captura" }), []);

    useEffect(() => { getFilasConLimite().then(setFilas).catch(() => {}); }, []);

    const limiteMin = useMemo(() => {
        const ls = (deviceId ? filas.filter((f) => f.id === deviceId) : filas).map((f) => f.limite);
        return ls.length ? Math.min(...ls) : 1;
    }, [filas, deviceId]);

    const traer = useCallback(async (pag: number) => {
        setCargando(true);
        try {
            // El día se pide en hora de Montevideo: de 00:00 a 23:59:59 de ESE día.
            const desde = dia ? new Date(`${dia}T00:00:00-03:00`).toISOString() : null;
            const hasta = dia ? new Date(`${dia}T23:59:59.999-03:00`).toISOString() : null;
            const min = minimo === "limite" ? limiteMin : Number(minimo);
            const r = await getLecturasFilas({ deviceId: deviceId || null, soloConFoto: true, minPersonas: min, desde, hasta, pagina: pag, porPagina: POR_PAGINA });
            setCapturas((prev) => (pag === 0 ? r.lecturas : [...prev, ...r.lecturas])); setTotal(r.total); setPagina(pag); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudieron leer las capturas"); }
        finally { setCargando(false); }
    }, [deviceId, dia, minimo, limiteMin]);
    useEffect(() => { traer(0); }, [traer]);

    const porDia = useMemo(() => {
        const g = new Map<string, Lectura[]>();
        for (const c of capturas) { const k = enMontevideo(new Date(c.t)).fecha; if (!g.has(k)) g.set(k, []); g.get(k)!.push(c); }
        return [...g.entries()];
    }, [capturas]);

    /** La destacada de cada hora (y fila): la de más gente. */
    const destacadas = useMemo(() => {
        const mejor = new Map<string, Lectura>();
        for (const c of capturas) {
            const m = enMontevideo(new Date(c.t));
            const k = `${m.fecha}-${m.hhmm.slice(0, 2)}-${c.deviceId}`;
            const b = mejor.get(k);
            if (!b || c.personas > b.personas) mejor.set(k, c);
        }
        return new Set([...mejor.values()].map((c) => c.id));
    }, [capturas]);

    return (
        <div className="p-6 space-y-5 max-w-[1680px] mx-auto">
            <div className="flex flex-wrap items-end gap-3">
                <div className="mr-auto">
                    <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">Historial de capturas</h1>
                    <p className="text-[13px] text-muted-foreground">Cada foto que se guardó de las filas, con cuánta gente había. <span className="tabular-nums">{total.toLocaleString("es-UY")}</span> con estos filtros.</p>
                </div>
                {filas.length > 1 && (
                    <Pastillas valor={deviceId} alCambiar={setDeviceId} opciones={[{ k: "", rotulo: "Todas las filas" }, ...filas.map((f) => ({ k: f.id, rotulo: f.name }))]} />
                )}
                <Pastillas valor={vista} alCambiar={(v) => cambiarVista(v as Vista)} opciones={[{ k: "bento", rotulo: "Bento" }, { k: "grilla", rotulo: "Grilla" }]} />
                <Pastillas valor={minimo} alCambiar={(v) => setMinimo(v as any)} opciones={MINIMOS.map((m) => ({ k: m.k, rotulo: m.rotulo }))} />
                <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="h-8 w-[150px] text-[12.5px]" aria-label="Día" />
                {dia && <Button variant="ghost" size="sm" onClick={() => setDia("")}>Todos los días</Button>}
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRetencion(true)}><Archive size={14} /> Retención</Button>
                <Button variant="ghost" size="sm" onClick={() => traer(0)} title="Actualizar"><RefreshCw size={14} /></Button>
            </div>

            {error ? (
                <div className="rounded-[10px] border border-border bg-card px-4 py-6 flex flex-col items-center gap-3 text-[13px]">
                    <TriangleAlert size={18} className="tono-mal" /> {error}
                    <Button size="sm" variant="outline" onClick={() => traer(0)}>Reintentar</Button>
                </div>
            ) : cargando && !capturas.length ? (
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                    {Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-video rounded-[10px] bg-muted animate-pulse" />)}
                </div>
            ) : !capturas.length ? (
                <div className="rounded-[14px] border border-dashed border-border py-16 flex flex-col items-center gap-2 text-center">
                    <Images size={22} className="text-muted-foreground" />
                    <div className="text-[14px] font-semibold">No hay capturas con estos filtros</div>
                    <div className="text-[12.5px] text-muted-foreground max-w-md">Se guarda una foto cada vez que la cámara cuenta al menos una persona en la fila.</div>
                </div>
            ) : (
                <div className="space-y-6">
                    {porDia.map(([d, lista]) => (
                        <section key={d} className="space-y-2.5">
                            <h2 className="flex items-baseline gap-2 text-[13px] font-semibold">
                                <span className="capitalize">{diaSemana(`${d}T12:00:00-03:00`)}</span> <span className="text-muted-foreground font-normal">{fecha(`${d}T12:00:00-03:00`)} · {lista.length}{lista.length === POR_PAGINA ? "+" : ""}</span>
                            </h2>
                            {vista === "bento" ? (
                                // Bento: por cada hora, la foto con más gente va grande (2×2) y las demás chicas
                                // alrededor. «dense» rellena los huecos: el día se lee como un mosaico, no una lista.
                                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 [grid-auto-flow:dense]">
                                    {lista.map((c) => <Tesela key={c.id} c={c} grande={destacadas.has(c.id)} conFila={filas.length > 1} alAbrir={abrir} />)}
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                                    {lista.map((c) => <Tesela key={c.id} c={c} conFila={filas.length > 1} alAbrir={abrir} />)}
                                </div>
                            )}
                        </section>
                    ))}
                    {capturas.length < total && (
                        <div className="flex justify-center">
                            <Button variant="outline" onClick={() => traer(pagina + 1)} disabled={cargando} className="gap-2">
                                {cargando && <Loader2 size={14} className="animate-spin" />} Cargar más ({(total - capturas.length).toLocaleString("es-UY")} restantes)
                            </Button>
                        </div>
                    )}
                </div>
            )}

            <CajonCaptura detalle={abierta} alCerrar={() => setAbierta(null)} />
            <CajonRetencion open={retencion} onOpenChange={setRetencion} />
        </div>
    );
}

function Tesela({ c, grande, conFila, alAbrir }: { c: Lectura; grande?: boolean; conFila: boolean; alAbrir: (c: Lectura) => void }) {
    const t = tonoFila(c.personas, c.limite);
    return (
        <button type="button" onClick={() => alAbrir(c)}
            className={cn("group relative aspect-video rounded-[10px] overflow-hidden bg-black text-left focus-visible:ring-2 ring-ring",
                grande && "col-span-2 row-span-2")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.foto!} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            <div className={cn("absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent flex items-end justify-between text-white", grande ? "px-3 py-2.5" : "px-2 py-1.5")}>
                <span className={cn("font-semibold tabular-nums", grande ? "text-[13px]" : "text-[11px]")}>{horaSeg(c.t)}{conFila && <span className="text-white/70 font-normal"> · {c.fila}</span>}</span>
                <span className={cn("font-bold rounded-full border tabular-nums", `chip-${t}`, grande ? "text-[13px] px-2 py-0.5" : "text-[11px] px-1.5")}>
                    {c.personas}{grande && (c.personas === 1 ? " persona" : " personas")}
                </span>
            </div>
        </button>
    );
}

function Pastillas({ valor, alCambiar, opciones }: { valor: string; alCambiar: (v: string) => void; opciones: { k: string; rotulo: string }[] }) {
    return (
        <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
            {opciones.map((o) => (
                <button key={o.k || "todas"} type="button" onClick={() => alCambiar(o.k)}
                    className={cn("rounded-full px-3 py-1 text-[12px] font-semibold transition-colors",
                        valor === o.k ? "bg-[var(--accion)] text-[var(--accion-texto)]" : "text-muted-foreground hover:text-foreground")}>
                    {o.rotulo}
                </button>
            ))}
        </div>
    );
}

function CajonRetencion({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const [datos, setDatos] = useState<Awaited<ReturnType<typeof getRetencionFotos>> | null>(null);
    const [dias, setDias] = useState(60);
    const [completas, setCompletas] = useState(7);
    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState<string | null>(null);
    useEffect(() => {
        if (!open) return;
        setAviso(null);
        getRetencionFotos().then((d) => { setDatos(d); setDias(d.dias); setCompletas(d.completasDias); }).catch((e) => setAviso(e?.message || "No se pudo leer"));
    }, [open]);
    const guardar = async () => {
        setGuardando(true);
        try { const r = await guardarRetencionFotos({ dias, completasDias: completas }); setDias(r.dias); setCompletas(r.completasDias); setAviso("Guardado. Se aplica en la próxima hora."); }
        catch (e: any) { setAviso(e?.message || "No se pudo guardar"); }
        finally { setGuardando(false); }
    };
    return (
        <Cajon open={open} onOpenChange={onOpenChange}>
            <CajonContenido ancho="angosto" titulo="Retención de las fotos" descripcion="Cuánto tiempo se guardan las capturas de las filas."
                pie={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cerrar</Button><Button onClick={guardar} disabled={guardando || !datos}>Guardar</Button></>}>
                <CajonSeccion titulo="" ayuda={datos ? `Hay ${datos.conFoto.toLocaleString("es-UY")} lecturas con foto${datos.primera ? `, la más vieja del ${fecha(datos.primera)}` : ""}.` : "Leyendo…"}>
                    <CajonCampo etiqueta="Todas las fotos durante" ayuda="Días con cada foto guardada, sin tocar.">
                        <div className="flex items-center gap-2"><Input type="number" min={0} max={dias} value={completas} onChange={(e) => setCompletas(Number(e.target.value))} className="w-24" /> <span className="text-[12.5px] text-muted-foreground">días</span></div>
                    </CajonCampo>
                    <CajonCampo etiqueta="Después, una por cada 10 minutos hasta los" ayuda="Queda la foto con más gente de cada tramo de 10 minutos por fila, y todas las de la fila en su límite (son la evidencia de un aviso). Pasado este plazo las fotos se borran; las lecturas quedan.">
                        <div className="flex items-center gap-2"><Input type="number" min={1} max={datos?.maxDias ?? 365} value={dias} onChange={(e) => setDias(Number(e.target.value))} className="w-24" /> <span className="text-[12.5px] text-muted-foreground">días</span></div>
                    </CajonCampo>
                    {aviso && <p className="text-[12.5px] text-muted-foreground">{aviso}</p>}
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}
