"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bike, Car, DoorOpen, Layers, Pencil, ScanLine, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { img, nombreClase } from "@/components/vision/ObjetoRegistro";
import { fechaHoraSeg, horaSeg, hace } from "@/lib/fechas";
import { VENTANA_S, COLADO_S, type ResumenAcceso } from "@/lib/accesos-vision-comun";

/**
 * OmniVision › Accesos (fase 2): lo que cruzó la línea de conteo de cada cámara de acceso,
 * contra lo que leyó la cámara. Vehículos sin lectura, posibles colados y motos.
 *
 * Lo que la pantalla tiene que decir además de los números: si la línea está bien puesta. Con
 * la línea pisando otra calle, o con la regla contando sólo autos, los números salen igual y
 * mienten. Por eso cada acceso dice cuántos de los vehículos leídos vio cruzar (la cobertura) y
 * qué le falta a la regla, con el enlace para arreglarla.
 */
type Respuesta = { h: number; accesos: ResumenAcceso[] };
const RANGOS = [{ valor: "24", rotulo: "24 h" }, { valor: "168", rotulo: "7 días" }];
/** Debajo de esto la línea no ve suficientes vehículos para que «sin lectura» signifique algo. */
const COBERTURA_BUENA = 0.8;

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
const SENTIDO: Record<string, string> = { ab: "de A a B", ba: "de B a A" };

export default function AccesosVision() {
    const [h, setH] = useState("24");
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        setError(null);
        try {
            const r = await fetch(`/api/vision/accesos?h=${h}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j);
        } catch (e: any) { setError(e?.message || "No se pudo contar"); }
    }, [h]);
    useEffect(() => { setDatos(null); cargar(); }, [cargar]);

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><DoorOpen size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[17px] font-bold leading-tight">Accesos</h1>
                    <p className="text-[12px] text-muted-foreground leading-snug">Lo que cruzó la línea de conteo de cada acceso, contra lo que leyó la cámara.</p>
                </div>
                <Filtros solido grupos={[{ clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS }]} />
            </div>

            {error ? <ErrorEstado mensaje={error} alReintentar={cargar} />
                : !datos ? <Cargando texto="Contando los pasos…" />
                    : !datos.accesos.length ? (
                        <div className="rounded-[10px] border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground space-y-3">
                            <p>Ninguna cámara de acceso (LPR) tiene una regla de conteo. Se cuenta sobre esa línea: dibujala atravesando el carril, donde pasa cada vehículo.</p>
                            <Link href="/admin/vision/reglas?nueva=conteo" className="inline-flex items-center gap-1.5 tono-accion font-semibold">Crear la regla <ArrowRight size={14} /></Link>
                        </div>
                    ) : datos.accesos.map((a) => <Acceso key={a.regla.id} a={a} />)}
        </div>
    );
}

function Acceso({ a }: { a: ResumenAcceso }) {
    const otro = a.sentidoPaso === "ab" ? "ba" : "ab";
    const o = a.porSentido[otro];
    const cobertura = a.leidos ? a.leidosConCruce / a.leidos : null;
    // El otro sentido casi sin lecturas y con muchos cruces: la línea la pisan vehículos que no pasan por el acceso.
    const pisanOtros = !!a.sentidoPaso && o.cruces >= 10 && o.conLectura / o.cruces < 0.5;
    const cifra = (n: number | string, r: string, I: typeof Car, tono?: string, pista?: string) => {
        const caja = (
            <div className="rounded-[10px] border border-border bg-card px-3.5 py-2.5 min-w-[140px] flex-1">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><I size={13} /> {r}</div>
                <div className={cn("text-[24px] font-bold tabular-nums leading-tight mt-0.5", tono)}>{n}</div>
            </div>
        );
        return pista ? <Pista texto={pista} ancho={280}>{caja}</Pista> : caja;
    };
    return (
        <section className="rounded-[10px] border border-border bg-card/40 p-4 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[15px] font-bold">{a.camara}</h2>
                <span className="text-[12px] text-muted-foreground">· regla «{a.regla.nombre}»</span>
                {a.sentidoPaso
                    ? <Chip tono="bien">Paso {SENTIDO[a.sentidoPaso]} · {pct(a.porSentido[a.sentidoPaso].conLectura, a.porSentido[a.sentidoPaso].cruces)} con lectura</Chip>
                    : <Chip tono="aviso">No se sabe cuál es el sentido de paso</Chip>}
                <Link href={`/admin/vision/reglas?editar=${a.regla.id}`} className="ml-auto inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-[12px] font-semibold hover:bg-accent"><Pencil size={13} /> Editar la línea</Link>
            </div>

            {!a.sentidoPaso ? (
                <p className="text-[12.5px] text-muted-foreground">
                    Ningún sentido tiene lectura en la mitad de sus cruces (o hay menos de 10). Revisá que la línea atraviese el carril donde la cámara lee, no la calle de al lado.
                    En este rango: {a.porSentido.ab.cruces} cruces de A a B ({pct(a.porSentido.ab.conLectura, a.porSentido.ab.cruces)} con lectura) y {a.porSentido.ba.cruces} de B a A ({pct(a.porSentido.ba.conLectura, a.porSentido.ba.cruces)}).
                </p>
            ) : (
                <>
                    <div className="flex gap-2 flex-wrap">
                        {cifra(a.pasos, "Pasaron", Car, undefined, `Cruces de la línea en el sentido de paso (${SENTIDO[a.sentidoPaso]}).`)}
                        {cifra(a.conLectura, `Con lectura · ${pct(a.conLectura, a.pasos)}`, ScanLine, "tono-bien", `Con una lectura de la cámara a ±${VENTANA_S} s. Cada lectura cuenta para un solo cruce.`)}
                        {cifra(a.sinLectura, "Sin lectura", TriangleAlert, a.sinLectura ? "tono-aviso" : undefined, `Cruzaron y la cámara no leyó nada a ±${VENTANA_S} s. Abajo, con su foto.`)}
                        {cifra(a.colados, "Posibles colados", Layers, a.colados ? "tono-mal" : undefined, `Sin lectura y pegados (±${COLADO_S} s) a otro que sí tuvo: pudo pasar detrás. Es para mirar la grabación, no una prueba.`)}
                        {cifra(a.faltanClases.includes("motorcycle") ? "—" : a.motos, "Motos", Bike, undefined, a.faltanClases.includes("motorcycle") ? "La regla no cuenta motos: agregale la clase «moto»." : "Motos que cruzaron en el sentido de paso.")}
                    </div>

                    {/* Lo que hace que los números mientan, con su arreglo. */}
                    {(cobertura != null && cobertura < COBERTURA_BUENA) || a.faltanClases.length > 0 || pisanOtros ? (
                        <div className="rounded-[10px] border chip-aviso p-3.5 space-y-1.5 text-[12.5px] leading-snug">
                            {cobertura != null && cobertura < COBERTURA_BUENA && (
                                <p><b>La línea vio cruzar {a.leidosConCruce} de los {a.leidos} vehículos que la cámara leyó ({pct(a.leidosConCruce, a.leidos)}).</b> Los que no ve tampoco pueden quedar «sin lectura»: ese número se queda corto.</p>
                            )}
                            {a.faltanClases.length > 0 && (
                                <p>La regla no cuenta {a.faltanClases.map(nombreClase).join(", ").toLowerCase()}: esos pasan sin contarse.</p>
                            )}
                            {pisanOtros && (
                                <p>En el otro sentido hubo {o.cruces} cruces y sólo {pct(o.conLectura, o.cruces)} con lectura: la línea la pisan vehículos que no pasan por el acceso (por ejemplo, una calle detrás). Conviene moverla al carril.</p>
                            )}
                            <Link href={`/admin/vision/reglas?editar=${a.regla.id}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">Editar la regla <ArrowRight size={13} /></Link>
                        </div>
                    ) : null}

                    <div className="space-y-2">
                        <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Sin lectura · <span className="tabular-nums">{a.sinLectura}</span>{a.sinLectura > a.sin.length ? ` · las ${a.sin.length} últimas` : ""}</h3>
                        {a.sin.length === 0 ? (
                            <p className="text-[12.5px] text-muted-foreground">Todos los que cruzaron tuvieron lectura.</p>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                                {a.sin.map((p) => (
                                    <div key={p.id} className="rounded-[10px] border border-border bg-card overflow-hidden">
                                        <div className="relative aspect-[4/3] bg-black grid place-items-center">
                                            {p.foto ? (
                                                <a href={img(p.foto)} target="_blank" rel="noreferrer" className="absolute inset-0">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={img(p.foto, 480)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                                                    {p.caja && <span className="absolute border-2 border-[var(--accion-en-oscuro,#60a5fa)] rounded-[3px]" style={{ left: `${p.caja[0] * 100}%`, top: `${p.caja[1] * 100}%`, width: `${(p.caja[2] - p.caja[0]) * 100}%`, height: `${(p.caja[3] - p.caja[1]) * 100}%` }} />}
                                                </a>
                                            ) : <span className="text-[11px] text-white/50 px-2 text-center">sin foto (los cruces tienen foto desde el 11/10)</span>}
                                            {p.colado && <span className="absolute top-1.5 left-1.5 pleno-mal rounded-full px-2 py-0.5 text-[10px] font-bold">posible colado</span>}
                                        </div>
                                        <div className="px-2.5 py-1.5 flex items-center gap-2" title={fechaHoraSeg(p.ts)}>
                                            <span className="text-[12.5px] font-semibold tabular-nums">{horaSeg(p.ts)}</span>
                                            <span className="text-[11px] text-muted-foreground truncate">{p.clase ? nombreClase(p.clase) : ""} · {hace(p.ts)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}
