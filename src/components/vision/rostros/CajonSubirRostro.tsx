"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Fingerprint, ImagePlus, Loader2, RefreshCw, ScanFace, TriangleAlert, UserCheck, UserPlus, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Estado } from "@/components/ui/celdas";
import { cn } from "@/lib/utils";
import { analizarFotoRostro, guardarFotoRostro } from "@/app/actions/rostros";
import { CaraRostro } from "@/components/vision/rostros/CajonRostro";
import type { AnalisisFoto, RostroGuardado } from "@/lib/rostros";

/*
 * Agregar un rostro subiendo una foto (13/11, Nico: «subir una foto, mostrar y animar el proceso
 * de modelado; cada rostro tendrá su id único»).
 *
 * Son dos pedidos al servidor y la pantalla cuenta los dos, sin inventar nada entre medio:
 *   1. MIRAR la foto (no guarda nada): dónde está la cara, cuánto mide, a quién se parece.
 *   2. GUARDAR: el motor la convierte en su modelo y nace la identidad con su número — o, si ya
 *      era alguien conocido, la foto se le suma como otro ángulo.
 *
 * La animación acompaña lo que de verdad está pasando: el recuadro sobre la foto es la caja que
 * devolvió el motor, las cifras de cada paso son las que midió, y el último paso de cada tanda no
 * se da por hecho hasta que el servidor contesta. Lo que NO se sabe (cuánto falta) no se dibuja:
 * no hay barra de porcentaje.
 */

/** Lo que el cajón le pide al servidor. Junto, para poder mostrarlo con datos de prueba. */
export const ACCIONES_SUBIR = { analizar: analizarFotoRostro, guardar: guardarFotoRostro };

/**
 * La foto se achica en el navegador antes de mandarla: una de celular pesa 4 a 8 MB, va dos veces
 * (mirar y guardar) y las acciones del servidor aceptan hasta 10 MB. Al motor le sobra con 1920 px
 * de lado. Si el navegador no la puede abrir (un HEIC), va como está y el servidor dirá si la lee.
 */
const LADO_ENVIO = 1920;
async function achicar(f: File): Promise<Blob> {
    try {
        const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
        const k = Math.min(1, LADO_ENVIO / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
        const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.92));
        return b && b.size < f.size ? b : f;
    } catch { return f; }
}

/** Cada cuánto avanza un paso mientras se espera, y cuánto se muestra cada uno al revelar la respuesta. */
const PASO_MS = 520;
const pct = (v: number) => `${Math.round(v * 100)} %`;

type Fase = "vacio" | "mirando" | "mirada" | "modelando" | "lista";
type Paso = { rotulo: string; valor?: string; tono?: "mal" | "aviso" };

export function CajonSubirRostro({ abierto, alCerrar, alGuardar, alAbrirRostro, acciones }: {
    abierto: boolean; alCerrar: () => void;
    /** Se guardó (nueva o sumada): la grilla de atrás se refresca. */
    alGuardar: () => void;
    /** Abrir la ficha de la cara que quedó. */
    alAbrirRostro: (id: string) => void;
    acciones?: Partial<typeof ACCIONES_SUBIR>;
}) {
    const servidor = { ...ACCIONES_SUBIR, ...acciones };
    const [fase, setFase] = useState<Fase>("vacio");
    const [archivo, setArchivo] = useState<Blob | null>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [prop, setProp] = useState(4 / 3);
    const [paso, setPaso] = useState(0);
    const [an, setAn] = useState<AnalisisFoto | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nombre, setNombre] = useState("");
    const [hecho, setHecho] = useState<RostroGuardado | null>(null);
    const [encima, setEncima] = useState(false);
    const entrada = useRef<HTMLInputElement>(null);
    const vivo = useRef(0);

    const limpiar = useCallback(() => {
        vivo.current++;
        setFase("vacio"); setArchivo(null); setAn(null); setError(null); setNombre(""); setHecho(null); setPaso(0);
        setUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    }, []);
    useEffect(() => { if (!abierto) limpiar(); }, [abierto, limpiar]);

    /** Avanza los pasos de a uno mientras `promesa` no contesta (el último queda en curso), y al contestar los completa. */
    async function conPasos<T>(total: number, promesa: Promise<T>, alLlegar?: (r: T) => void): Promise<T> {
        const turno = ++vivo.current;
        setPaso(0);
        const reloj = setInterval(() => setPaso((p) => Math.min(total - 1, p + 1)), PASO_MS);
        try {
            const r = await promesa;
            clearInterval(reloj);
            // La respuesta ya está: cada paso muestra lo que midió a medida que se lo da por hecho.
            if (vivo.current === turno) alLlegar?.(r);
            // Lo que faltaba mostrar se revela de a uno: llegar todo junto no deja leer qué se midió.
            for (let p = 0; p <= total; p++) { if (vivo.current !== turno) break; setPaso((q) => Math.max(q, p)); if (p < total) await new Promise((ok) => setTimeout(ok, PASO_MS * 0.55)); }
            return r;
        } finally { clearInterval(reloj); }
    }

    const mirar = async (f: File) => {
        limpiar();
        if (!f.type.startsWith("image/")) { setError("Eso no es una imagen."); return; }
        const u = URL.createObjectURL(f);
        setUrl(u); setFase("mirando");
        const turno = vivo.current + 1;
        try {
            const chica = await achicar(f);
            setArchivo(chica);
            const fd = new FormData(); fd.append("foto", chica, "foto.jpg");
            await conPasos(3, servidor.analizar(fd), setAn);
            if (vivo.current !== turno) return;
            setFase("mirada");
        } catch (e: any) { if (vivo.current === turno) { setError(e?.message || "No se pudo mirar la foto"); setFase("mirada"); } }
    };

    const guardar = async (op: { sumarA?: string; igual?: boolean }) => {
        if (!archivo) return;
        setError(null); setFase("modelando");
        const turno = vivo.current + 1;
        try {
            const fd = new FormData(); fd.append("foto", archivo, "foto.jpg");
            if (op.sumarA) fd.append("sumarA", op.sumarA); else if (nombre.trim()) fd.append("apodo", nombre.trim());
            if (op.igual) fd.append("igual", "1");
            await conPasos(3, servidor.guardar(fd), setHecho);
            if (vivo.current !== turno) return;
            setFase("lista"); alGuardar();
        } catch (e: any) { if (vivo.current === turno) { setError(e?.message || "No se pudo guardar"); setFase("mirada"); toast.error({ title: "No se pudo guardar", description: e?.message }); } }
    };

    const ocupado = fase === "mirando" || fase === "modelando";
    const c = an?.cara || null;
    const mejor = an?.parecidos[0] || null;
    const pasosMirar: Paso[] = [
        { rotulo: "Buscando la cara en la foto", valor: an ? (an.caras === 0 ? "ninguna" : an.caras === 1 ? `1 cara · ${pct(c!.prob)} segura` : `${an.caras} caras · se toma la más grande`) : undefined, tono: an && an.caras === 0 ? "mal" : undefined },
        { rotulo: "Midiendo si alcanza para comparar", valor: c ? `${c.px} px de alto · mínimo ${an!.umbrales.pxMin}` : an ? "—" : undefined, tono: c && c.px < an!.umbrales.pxMin ? "aviso" : undefined },
        { rotulo: an ? `Comparando con ${an.comparadas === 1 ? "la cara conocida" : `las ${an.comparadas} caras conocidas`}` : "Comparando con las caras conocidas", valor: an ? (!c ? "—" : mejor ? `la más parecida, ${pct(mejor.similitud)}` : "no se parece a ninguna") : undefined },
    ];
    const pasosModelar: Paso[] = [
        { rotulo: "Recortando la cara" },
        { rotulo: "El motor la convierte en su modelo", valor: hecho ? "enrolada" : undefined },
        { rotulo: hecho && !hecho.nueva ? "Sumándola como otro ángulo" : "Dándole su número", valor: hecho ? hecho.codigo : undefined },
    ];

    return (
        <Cajon open={abierto} onOpenChange={(v) => { if (!v && !ocupado) alCerrar(); }}>
            <CajonContenido ancho="intermedio" titulo="Agregar un rostro" descripcion="Subí una foto: el motor la mira, dice a quién se parece y le da su número."
                pie={fase === "lista" && hecho ? (
                    <div className="flex items-center gap-2 w-full">
                        <Button variant="ghost" onClick={limpiar} className="gap-1.5 mr-auto"><ImagePlus size={14} /> Subir otra</Button>
                        <Button onClick={() => { alAbrirRostro(hecho.id); alCerrar(); }} className="gap-1.5"><UserCheck size={14} /> Abrir su ficha</Button>
                    </div>
                ) : fase === "mirada" && an?.cara ? (
                    <div className="flex items-center gap-2 w-full">
                        <Button variant="ghost" onClick={limpiar} className="gap-1.5 mr-auto"><RefreshCw size={14} /> Otra foto</Button>
                        {an.veredicto === "conocida" && mejor?.rostro
                            ? <Button onClick={() => guardar({ sumarA: mejor.rostro!.id })} className="gap-1.5"><Check size={14} /> Sumar esta foto a {mejor.rostro.nombre || mejor.rostro.codigo}</Button>
                            : an.veredicto === "conocida" ? null
                            : <Button onClick={() => guardar({ igual: an.veredicto !== "nueva" })} variant={an.veredicto === "nueva" ? "default" : "outline"} className="gap-1.5">
                                <UserPlus size={14} /> {an.veredicto === "nueva" ? "Guardar como rostro nuevo" : "Guardarla igual"}
                            </Button>}
                    </div>
                ) : undefined}>
                <div className="px-6 py-5 space-y-5">
                    <input ref={entrada} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) mirar(f); }} />

                    {/* La foto: lo que se viene a mirar. Vacía es la zona donde soltarla. */}
                    {!url ? (
                        <button type="button" onClick={() => entrada.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)}
                            onDrop={(e) => { e.preventDefault(); setEncima(false); const f = e.dataTransfer.files?.[0]; if (f) mirar(f); }}
                            className={cn("w-full aspect-[4/3] rounded-[10px] border border-dashed grid place-items-center text-center px-8 transition-colors",
                                encima ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border bg-muted/40 hover:bg-muted/70")}>
                            <span>
                                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-card border border-border text-[var(--accion)]"><ImagePlus size={24} /></span>
                                <span className="mt-3 block text-[15px] font-bold">Soltá una foto acá, o elegila</span>
                                <span className="mt-1 block text-[12.5px] text-muted-foreground leading-snug">De frente y con luz, con la cara entera. JPG o PNG.<br />Si hay varias personas se toma la cara más grande.</span>
                            </span>
                        </button>
                    ) : (
                        <div className="relative mx-auto w-full overflow-hidden rounded-[10px] bg-neutral-950 [box-shadow:var(--sombra-captura)]" style={{ aspectRatio: prop, maxHeight: 340, maxWidth: 340 * prop }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="La foto subida" onLoad={(e) => setProp(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight))} className="absolute inset-0 h-full w-full object-cover" />
                            {/* Mirando: una línea que barre la foto. No dice cuánto falta; dice que se está mirando. */}
                            {fase === "mirando" && !an && (
                                <motion.span aria-hidden className="absolute inset-x-0 h-[2px] bg-[var(--accion-en-oscuro)] shadow-[0_0_22px_5px_var(--accion-en-oscuro)]"
                                    initial={{ top: "0%" }} animate={{ top: ["0%", "100%", "0%"] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} />
                            )}
                            {/* La caja que devolvió el motor, sobre la cara de verdad. */}
                            {c && (
                                <motion.span initial={{ opacity: 0, scale: 1.25 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 22 }}
                                    className="absolute rounded-[6px] border-2 border-[var(--accion-en-oscuro)] shadow-[0_0_0_9999px_rgba(2,6,23,.45)]"
                                    style={{ left: `${c.caja[0] * 100}%`, top: `${c.caja[1] * 100}%`, width: `${(c.caja[2] - c.caja[0]) * 100}%`, height: `${(c.caja[3] - c.caja[1]) * 100}%` }} />
                            )}
                            {!ocupado && fase !== "lista" && (
                                <button type="button" onClick={limpiar} aria-label="Quitar la foto" title="Quitar la foto" className="absolute right-2 top-2 h-8 w-8 rounded-full bg-black/60 text-white grid place-items-center hover:bg-black/80"><X size={15} /></button>
                            )}
                        </div>
                    )}

                    {/* Los pasos de mirar, con lo que midió cada uno. */}
                    {url && <Pasos pasos={pasosMirar} hasta={fase === "mirando" ? paso : 3} enCurso={fase === "mirando"} />}

                    {error && <div className="rounded-[10px] border chip-mal p-3.5 text-[13px] leading-snug flex gap-2.5"><TriangleAlert size={16} className="shrink-0 mt-0.5" /> <span className="text-foreground">{error}</span></div>}

                    {/* El veredicto: qué pasaría al guardarla. */}
                    <AnimatePresence initial={false}>
                        {fase === "mirada" && an && paso >= 3 && (
                            <motion.div key="veredicto" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="space-y-4">
                                {an.veredicto === "sin-cara" ? (
                                    <div className="rounded-[10px] border chip-aviso p-4 text-[13px] leading-snug text-foreground">{an.motivo}</div>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-4">
                                            <CaraRostro src={c!.recorte} alt="La cara recortada" className="h-[120px] w-[100px] shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                {an.veredicto === "conocida" ? <Estado tono="bien" icono={UserCheck}>Ya la conozco</Estado>
                                                    : an.veredicto === "nueva" ? <Estado tono="info" icono={Fingerprint}>Cara nueva</Estado>
                                                    : <Estado tono="aviso" icono={TriangleAlert}>{an.veredicto === "chica" ? "Cara chica" : "Cara dudosa"}</Estado>}
                                                <p className="mt-2 text-[13px] leading-snug text-foreground/85">
                                                    {an.veredicto === "conocida" && mejor ? <>Es <b className="font-semibold">{mejor.rostro?.nombre || mejor.rostro?.codigo || mejor.persona}</b>: se parece {pct(mejor.similitud)}, por encima del {pct(an.umbrales.misma)} que hace falta para decir «misma persona».{mejor.rostro ? " Sumarle esta foto le enseña al motor otro ángulo." : " Está enrolada a mano en el padrón: se administra desde su ficha de Usuarios."}</>
                                                        : an.veredicto === "nueva" ? <>No llega al {pct(an.umbrales.misma)} con nadie{mejor ? <> (la más parecida, {mejor.rostro?.nombre || mejor.rostro?.codigo || mejor.persona}, {pct(mejor.similitud)})</> : null}. Al guardarla nace una identidad con su número propio.</>
                                                        : <>{an.motivo} Se puede guardar igual, pero después puede sumarle pasadas de otra persona.</>}
                                                </p>
                                            </div>
                                        </div>
                                        {an.parecidos.length > 0 && an.veredicto !== "conocida" && <Parecidos an={an} />}
                                        {an.veredicto !== "conocida" && (
                                            <label className="block">
                                                <span className="text-[12px] font-semibold">¿Quién es? <span className="font-normal text-muted-foreground">Opcional: sin nombre queda con su número y se registra después.</span></span>
                                                <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} placeholder="Un nombre"
                                                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]" />
                                            </label>
                                        )}
                                    </>
                                )}
                            </motion.div>
                        )}

                        {/* Modelando y listo: la cara se vuelve su modelo, y aparece su número. */}
                        {(fase === "modelando" || fase === "lista") && c && (
                            <motion.div key="modelo" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                                <div className="rounded-[10px] border border-border bg-card p-4 flex items-center gap-5">
                                    <Modelado src={c.recorte} activo={fase === "modelando"} />
                                    <div className="min-w-0 flex-1">
                                        {fase === "lista" && hecho ? (
                                            <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 280, damping: 20 }}>
                                                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{hecho.nueva ? "Su número" : "Sumada a"}</div>
                                                <div className="mt-0.5 text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums">{hecho.codigo}</div>
                                                <p className="mt-2 text-[12.5px] text-muted-foreground leading-snug">
                                                    {hecho.nueva ? <>{hecho.nombre ? <><b className="font-semibold text-foreground">{hecho.nombre}</b> quedó registrada. </> : null}Desde ahora, cuando pase por una cámara del modo face se le suma sola.</>
                                                        : <>{hecho.nombre || hecho.codigo} ya tiene {hecho.ejemplos} {hecho.ejemplos === 1 ? "foto" : "fotos"} en el motor.</>}
                                                </p>
                                            </motion.div>
                                        ) : (
                                            <>
                                                <div className="text-[14px] font-bold">Modelando la cara…</div>
                                                <p className="mt-1 text-[12.5px] text-muted-foreground leading-snug">El motor no guarda la foto para comparar: la convierte en una lista de números que describe esa cara, y compara esos números.</p>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <Pasos pasos={pasosModelar} hasta={fase === "modelando" ? paso : 3} enCurso={fase === "modelando"} />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </CajonContenido>
        </Cajon>
    );
}

/** Los pasos, uno debajo del otro: hecho (con lo que midió), en curso, o por venir. */
function Pasos({ pasos, hasta, enCurso }: { pasos: Paso[]; hasta: number; enCurso: boolean }) {
    return (
        <ol className="space-y-1.5">
            {pasos.map((p, i) => {
                const hecho = i < hasta, actual = enCurso && i === hasta;
                return (
                    <li key={i} className={cn("flex items-center gap-2.5 text-[13px] transition-opacity duration-300", !hecho && !actual && "opacity-40")}>
                        <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full", hecho ? (p.tono === "mal" ? "pleno-mal" : p.tono === "aviso" ? "pleno-aviso" : "pleno-bien") : "bg-muted text-muted-foreground")}>
                            {hecho ? (p.tono ? <TriangleAlert size={11} /> : <Check size={12} strokeWidth={3} />) : actual ? <Loader2 size={12} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                        </span>
                        <span className={cn("min-w-0 truncate", (hecho || actual) && "font-semibold")}>{p.rotulo}</span>
                        {hecho && p.valor && <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="ml-auto shrink-0 text-[12px] text-muted-foreground tabular-nums">{p.valor}</motion.span>}
                    </li>
                );
            })}
        </ol>
    );
}

/** A quién más se parece, con la vara de los dos umbrales: se ve por cuánto no llegó. */
function Parecidos({ an }: { an: AnalisisFoto }) {
    return (
        <div className="rounded-[10px] border border-border divide-y divide-border">
            {an.parecidos.map((p, i) => {
                const tono = p.similitud >= an.umbrales.misma ? "bien" : p.similitud >= an.umbrales.parecida ? "aviso" : "quieto";
                return (
                    <div key={i} className="flex items-center gap-3 px-3 h-[52px]">
                        <CaraRostro src={p.rostro?.foto || null} alt="" className="h-10 w-9 shrink-0" />
                        <span className="min-w-0 flex-1 text-[13px] font-semibold truncate tabular-nums">{p.rostro?.nombre || p.rostro?.codigo || p.persona}</span>
                        <span className="relative h-1.5 w-28 shrink-0 rounded-full bg-muted overflow-hidden" title={`«Misma persona» desde ${pct(an.umbrales.misma)}; «se parece» desde ${pct(an.umbrales.parecida)}`}>
                            {/* Por debajo de «se parece» no es un estado: va en gris, sin tono. */}
                            <span className={cn("absolute inset-y-0 left-0 rounded-full", tono === "quieto" ? "bg-foreground/35" : `pleno-${tono}`)} style={{ width: `${Math.round(p.similitud * 100)}%` }} />
                            <span className="absolute inset-y-0 w-px bg-foreground/60" style={{ left: `${an.umbrales.misma * 100}%` }} />
                        </span>
                        <span className={cn("w-11 shrink-0 text-right text-[12.5px] font-bold tabular-nums", tono === "quieto" ? "text-muted-foreground" : `tono-${tono}`)}>{pct(p.similitud)}</span>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * La cara volviéndose modelo: una grilla de puntos que se prende sobre el recorte mientras el
 * motor trabaja. Es una ilustración de «foto → números», no una lectura del modelo: los puntos
 * no son rasgos medidos.
 */
function Modelado({ src, activo }: { src: string; activo: boolean }) {
    const N = 7;
    return (
        <span className="relative block h-[132px] w-[110px] shrink-0 overflow-hidden rounded-[6px] bg-neutral-950 [box-shadow:var(--sombra-captura)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className={cn("absolute inset-0 h-full w-full object-cover transition-[filter,opacity] duration-700", activo && "opacity-60 [filter:grayscale(1)_contrast(1.15)]")} />
            <AnimatePresence>
                {activo && (
                    <motion.span key="puntos" className="absolute inset-0 grid p-2" style={{ gridTemplateColumns: `repeat(${N}, 1fr)`, gridTemplateRows: `repeat(${N + 1}, 1fr)` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        {Array.from({ length: N * (N + 1) }, (_, i) => (
                            <motion.span key={i} className="m-auto h-[3px] w-[3px] rounded-full bg-[var(--accion-en-oscuro)]"
                                animate={{ opacity: [0.15, 1, 0.15], scale: [0.8, 1.5, 0.8] }} transition={{ duration: 1.4, repeat: Infinity, delay: ((i % N) + Math.floor(i / N)) * 0.07 }} />
                        ))}
                    </motion.span>
                )}
            </AnimatePresence>
            {!activo && <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full pleno-bien"><Check size={13} strokeWidth={3} /></span>}
            {activo && <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/55 py-1 text-[10.5px] font-bold text-white"><ScanFace size={11} /> modelando</span>}
        </span>
    );
}
