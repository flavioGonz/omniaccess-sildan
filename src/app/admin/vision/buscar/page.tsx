"use client";

import { IndiceVocabulario } from "@/components/vision/IndiceVocabulario";
import { ElegirCamara } from "@/components/devices/ElegirCamara";
import { ElegirArea } from "@/components/devices/ElegirArea";
import { useFiltroArea } from "@/lib/use-filtro-area";
import { useAreas } from "@/lib/use-areas";
import { useEffect, useRef, useState } from "react";
import { Backpack, Bike, Camera, Car, Clock, Dog, HardHat, Layers, Loader2, PawPrint, ScanSearch, Search, Sparkles, Truck, User, Video, X, Boxes } from "lucide-react";
import { useSiluetas } from "@/lib/use-siluetas";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import { ErrorEstado } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { CajonPista } from "@/components/vision/CajonPista";
import { img, nombreClase, hora, type FilaObjeto } from "@/components/vision/ObjetoRegistro";
import { MosaicoBuscar, PasosDeChapa, type ResultadoBusqueda } from "@/components/vision/buscar/MosaicoBuscar";
import { useRegistrarDesdeCaptura } from "@/components/vision/buscar/RegistrarDesdeCaptura";
import type { PasoChapa } from "@/lib/vision-historial";
import { FotoParaBuscar, type FotoElegida } from "@/components/vision/FotoParaBuscar";
import { useNombresPropios } from "@/lib/nombres-propios";

/**
 * OmniVision › Buscar: encontrar en lo que vieron las cámaras algo escrito con palabras
 * («camioneta blanca con escalera», «persona con paraguas») o parecido a otra pista.
 *
 * Busca por CÓMO SE VE, con SigLIP 2 (ver /api/vision/buscar): no es una lista de clases y
 * colores, así que entiende cosas que no están en ninguna lista. Lo que no hace: identificar a
 * una persona (no es reconocimiento facial) ni leer lo que no está en el recorte.
 *
 * Los resultados vienen ordenados; la barra es la parecencia RELATIVA al primero. SigLIP da
 * números chicos en texto↔imagen (un buen acierto anda en 0,10-0,20 de coseno): un porcentaje
 * absoluto parecería «12 % de seguridad» y se leería como un fallo.
 */
type Resultado = ResultadoBusqueda;
/** modo «chapa»: lo escrito era una matrícula; `pasos` es su historial de accesos (ver la ruta). */
type Respuesta = { resultados: Resultado[]; comparados: number; sinHuella: number; h: number; ms: number; modo: "texto" | "parecido" | "foto" | "chapa"; pasos: PasoChapa[] | null };

const RANGOS = [{ v: "24", r: "24 h" }, { v: "168", r: "7 días" }, { v: "720", r: "30 días" }];
const GRUPOS = [{ v: "", r: "Todo", i: Layers }, { v: "persona", r: "Personas", i: User }, { v: "vehiculo", r: "Vehículos", i: Car }, { v: "animal", r: "Animales", i: PawPrint }, { v: "objeto", r: "Bultos", i: Backpack }, { v: "propio", r: "Propios", i: Boxes }];
/**
 * Para arrancar: lo que se suele buscar en un barrio. Iban como seis píldoras arriba de los
 * filtros, siempre a la vista: una fila más de ruido justo cuando ya se estaba buscando otra
 * cosa. Ahora son la pantalla vacía, con su ícono, y desaparecen al buscar.
 */
const EJEMPLOS = [
    { q: "camioneta blanca", i: Truck }, { q: "persona con mochila", i: Backpack }, { q: "moto de delivery", i: Bike },
    { q: "auto rojo", i: Car }, { q: "persona con chaleco reflectivo", i: HardHat }, { q: "perro", i: Dog },
];
/**
 * Probabilidad SigLIP (sigmoide con la escala y el sesgo del modelo) debajo de la cual un
 * resultado queda aparte, como «no se parece mucho». Medido el 9/10 sobre ~1.800 pistas:
 *  · Sin nada que encontrar, el mejor nunca pasó de 0,007 (caballo 0,002, bicicleta 0,007).
 *  · El único perro registrado dio 0,013: las palabras sueltas puntúan bajo. Un corte en 0,02
 *    lo escondía detrás de «Nada se parece», que es peor que mostrar de más.
 *  · Lo de arriba del corte se llama «posibles», no aciertos: «persona con paraguas» dio seis
 *    personas con campera a 0,03 y ningún paraguas.
 * La búsqueda por imagen no tiene probabilidad (es imagen contra imagen): ahí no se corta.
 */
const PROB_PARECE = 0.01;

export default function BuscarVision() {
    // Las clases del detector propio con su nombre (no «propio:…»), y si hay para ofrecer el filtro.
    const hayPropias = useNombresPropios() > 0;
    const [texto, setTexto] = useState("");
    const [pedido, setPedido] = useState<{ q?: string; parecido?: FilaObjeto; foto?: FotoElegida } | null>(null);
    const [archivo, setArchivo] = useState<File | null>(null);
    const [arrastrando, setArrastrando] = useState(false);
    const elegirArchivo = useRef<HTMLInputElement>(null);
    const [h, setH] = useState("168");
    const [grupo, setGrupo] = useState("");
    const [camara, setCamara] = useState("");
    const areasDisp = useAreas();
    // En qué área buscar (21/10, Nico): texto, foto y parecidos, en las cámaras de esa área y las de adentro.
    const fa = useFiltroArea("vision-buscar");
    const [camaras, setCamaras] = useState<{ id: string; name: string }[]>([]);
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [buscando, setBuscando] = useState(false);
    const [abierta, setAbierta] = useState<Resultado | null>(null);
    const [siluetas, setSiluetas] = useSiluetas();
    // Registrar la matrícula o marcar en lista negra desde la captura (compartido con Detecciones y Relecturas).
    const { abrirRegistro, marcarNegra, cajones } = useRegistrarDesdeCaptura(() => setPedido((p) => (p ? { ...p } : p)));

    // ?q=… viene del historial («Ver todo en Buscar»): se busca al entrar, con la misma frase.
    useEffect(() => {
        const q = new URLSearchParams(window.location.search).get("q")?.trim();
        if (q) { setTexto(q); setPedido({ q }); }
    }, []);

    useEffect(() => {
        fetch("/api/vision/estado", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setCamaras(j?.camaras || [])).catch(() => { });
    }, []);

    useEffect(() => {
        if (!pedido) return;
        let vivo = true;
        setBuscando(true); setError(null);
        const base = { h, ...(grupo ? { grupo } : {}), ...(camara ? { camara } : {}), ...(fa.filtrando ? { area: fa.area } : {}) };
        const p = new URLSearchParams({ ...base, ...(pedido.foto ? {} : pedido.parecido ? { parecido: pedido.parecido.id } : { q: pedido.q || "" }) });
        (pedido.foto
            ? fetch(`/api/vision/buscar?${p}`, { method: "POST", body: pedido.foto.blob, headers: { "content-type": "image/jpeg" }, cache: "no-store" })
            : fetch(`/api/vision/buscar?${p}`, { cache: "no-store" }))
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`); return j; })
            .then((j) => { if (vivo) setDatos(j); })
            .catch((e) => { if (vivo) setError(e?.message || "No se pudo buscar"); })
            .finally(() => { if (vivo) setBuscando(false); });
        return () => { vivo = false; };
    }, [pedido, h, grupo, camara, fa.area]); // eslint-disable-line react-hooks/exhaustive-deps

    const buscar = (q: string) => { const t = q.trim(); if (t) { setTexto(t); setArchivo(null); setPedido({ q: t }); } };
    const tomarFoto = (f: File | null | undefined) => { if (f && f.type.startsWith("image/")) { setArchivo(f); setDatos(null); } };
    const sacarFoto = () => { setArchivo(null); setPedido(texto.trim() ? { q: texto.trim() } : null); };
    const conCorte = datos?.modo === "texto";
    const modoFoto = datos?.modo === "foto";
    const parecen = !datos ? [] : conCorte ? datos.resultados.filter((r) => (r.prob ?? 0) >= PROB_PARECE) : datos.resultados;
    const resto = !datos || !conCorte ? [] : datos.resultados.filter((r) => (r.prob ?? 0) < PROB_PARECE);
    const modoChapa = datos?.modo === "chapa";
    const grilla = (rs: Resultado[], lejos = false) => (
        <MosaicoBuscar resultados={rs} alAbrir={setAbierta} relativa={!modoChapa} lejos={lejos} atenuado={buscando} />
    );

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            {/* Título en una línea: la explicación larga va en la pista, no ocupando media pantalla. */}
            <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><ScanSearch size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0">
                    <h1 className="text-[17px] font-bold leading-tight">Buscar</h1>
                    <p className="text-[12px] text-muted-foreground leading-snug">Con palabras o con una foto, en todo lo que registraron las cámaras.</p>
                </div>
                <Pista ancho={320} texto="Busca por cómo se ve: describí lo que buscás como se lo contarías a alguien, o subí una foto. También «buscar parecidos» desde cualquier resultado. No reconoce caras: encuentra «persona con campera roja», no a una persona en particular.">
                    <span className="ml-1 text-[11.5px] text-muted-foreground underline decoration-dotted underline-offset-2 cursor-help">¿Cómo busca?</span>
                </Pista>
            </div>

            {/* El índice de objetos en las fotos y cómo se mantiene (volvió acá desde el panel Objetos del Historial). */}
            <IndiceVocabulario />

            {/* El buscador: palabras, foto y botón en una sola pieza. La foto también se arrastra o se pega. */}
            <form onSubmit={(e) => { e.preventDefault(); buscar(texto); }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setArrastrando(true); } }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={(e) => { e.preventDefault(); setArrastrando(false); tomarFoto(e.dataTransfer.files?.[0]); }}
                className={cn("flex items-center h-12 rounded-[10px] border bg-card pl-3.5 pr-1.5 gap-2 transition-colors focus-within:border-[var(--accion)] focus-within:ring-2 focus-within:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]",
                    arrastrando ? "border-[var(--accion)] border-dashed bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border")}>
                <Search size={17} className="text-muted-foreground shrink-0" />
                <input value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus
                    onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); tomarFoto(f); } }}
                    placeholder={arrastrando ? "Soltá la foto para buscar con ella" : "Ej. camioneta blanca con escalera, moto de delivery, o una matrícula"}
                    className="flex-1 min-w-0 h-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
                {texto && <button type="button" onClick={() => setTexto("")} aria-label="Borrar" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground"><X size={15} /></button>}
                <span className="w-px h-6 bg-border" />
                <Pista texto="Buscar con una foto: subila, sacala con el celular, arrastrala acá o pegala (Ctrl+V).">
                    <button type="button" onClick={() => elegirArchivo.current?.click()} className="h-9 px-2.5 rounded-md inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground hover:bg-accent">
                        <Camera size={16} strokeWidth={2.2} /> <span className="hidden sm:inline">Foto</span>
                    </button>
                </Pista>
                <input ref={elegirArchivo} type="file" accept="image/*" className="hidden" onChange={(e) => { tomarFoto(e.target.files?.[0]); e.target.value = ""; }} />
                <Button type="submit" className="h-9" disabled={!texto.trim() || buscando}>{buscando && !pedido?.foto ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Buscar</Button>
            </form>

            {archivo && <FotoParaBuscar archivo={archivo} alCerrar={sacarFoto} alElegir={(f) => setPedido({ foto: f })} />}

            {pedido?.parecido && (
                <span className="inline-flex items-center gap-2 h-9 pl-1 pr-2 rounded-full border border-[var(--accion)] text-[12.5px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {pedido.parecido.recorte && <img src={img(pedido.parecido.recorte, 80)} alt="" className="h-7 w-7 rounded-full object-cover bg-black" />}
                    Parecidos a {nombreClase(pedido.parecido.clase)} · {pedido.parecido.camara} · {hora(pedido.parecido.primeraVez)}
                    <button type="button" onClick={() => setPedido(texto.trim() ? { q: texto.trim() } : null)} aria-label="Quitar" className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
                </span>
            )}

            {/* Filtros en una fila: rango, qué (con su ícono) y la cámara en una lista, que son nueve y crecen. */}
            <div className="flex items-center gap-2 flex-wrap">
                <Clock size={15} className="text-muted-foreground" />
                <Filtros solido grupos={[
                    { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "g", titulo: "Qué", valor: grupo, alElegir: setGrupo, opciones: GRUPOS.filter((x) => x.v !== "propio" || hayPropias).map((x) => ({ valor: x.v, rotulo: x.r, icono: x.i })) },
                ]} />
                {fa.hayAreas && (
                    <ElegirArea areas={fa.areas} valor={fa.area} alElegir={(v) => { fa.setArea(v); if (camara && v !== "todas" && !fa.enAreaDe(v, camara)) setCamara(""); }} sinArea alinear="start"
                        cuenta={(a) => camaras.filter((c) => fa.enAreaDe(a, c.id)).length} />
                )}
                {/* Con buscador y por área (21/10): era un <select> con todas las cámaras de corrido. */}
                <ElegirCamara variante="filtro" icono={Video} alinear="start" ancho={360} titulo="Cámara" valor={camara || null} alElegir={setCamara}
                    todas="Todas las cámaras" areas={areasDisp.areas}
                    camaras={camaras.filter((c) => fa.enArea(c.id)).map((c) => ({ id: c.id, nombre: c.name, areaId: areasDisp.equipoArea[c.id] || null }))} />
                <Pista titulo="Siluetas de OmniVision" texto="Dibuja sobre cada resultado la silueta del objeto. Se calcula al mirarlo (la primera vez tarda un instante). Es la misma opción que en el historial y el visor.">
                    <button type="button" onClick={() => setSiluetas(!siluetas)} aria-pressed={siluetas} aria-label="Siluetas de OmniVision"
                        className={cn("h-[34px] px-2.5 rounded-lg border inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors",
                            siluetas ? "accion border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent")}>
                        <Sparkles size={14} /> Siluetas
                    </button>
                </Pista>
            </div>

            {error ? <ErrorEstado mensaje={error} alReintentar={() => setPedido((p) => (p ? { ...p } : p))} />
                : !pedido ? (archivo ? null : (
                    <div className="space-y-2.5">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Probá con</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                            {EJEMPLOS.map(({ q, i: I }) => (
                                <button key={q} type="button" onClick={() => buscar(q)}
                                    className="group flex items-center gap-2.5 rounded-[10px] border border-border bg-card p-2.5 text-left hover:border-[var(--accion)] transition-colors">
                                    <span className="grid place-items-center h-9 w-9 rounded-[8px] bg-foreground text-background group-hover:bg-[var(--accion)] group-hover:text-white transition-colors shrink-0"><I size={18} strokeWidth={2.2} /></span>
                                    <span className="text-[12.5px] font-semibold leading-tight">{q}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )) : buscando && !datos ? (
                    <div className="py-16 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
                ) : datos && (
                    <>
                        {modoChapa && datos.pasos && <PasosDeChapa pasos={datos.pasos} alRegistrar={abrirRegistro} />}
                        <p className="text-[12px] text-muted-foreground tabular-nums">
                            {modoChapa ? (datos.pasos?.length ? `${datos.resultados.length} ${datos.resultados.length === 1 ? "pista" : "pistas"} de OmniVision de ese vehículo en sus pasos · ${datos.ms} ms` : `Ninguna lectora leyó «${pedido.q}» en ${RANGOS.find((r) => r.v === String(datos.h))?.r}`) : <>{conCorte ? (parecen.length ? `${parecen.length} posibles` : "Nada se parece claramente") : datos.resultados.length ? `Los ${datos.resultados.length} más parecidos${modoFoto && pedido?.foto ? ` a ${pedido.foto.etiqueta.toLowerCase()} de la foto` : ""}` : "Nada"} entre {datos.comparados.toLocaleString("es-UY")} pistas de {RANGOS.find((r) => r.v === String(datos.h))?.r} · {datos.ms} ms
                            {datos.sinHuella > 0 && ` · ${datos.sinHuella.toLocaleString("es-UY")} todavía sin procesar (se van sumando solas)`}</>}
                        </p>
                        {datos.resultados.length === 0 ? (modoChapa ? null :
                            <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">No hay pistas con huella en este rango y con estos filtros.</div>
                        ) : (
                            <>
                                {parecen.length > 0 ? grilla(parecen) : (
                                    <div className="rounded-[10px] border border-border bg-card px-4 py-3 text-[13px]">
                                        Nada de lo que vieron las cámaras en este rango se parece claramente a «{pedido.q}». Abajo, lo menos lejano, por si sirve.
                                    </div>
                                )}
                                {resto.length > 0 && (
                                    <section className="space-y-2 pt-2">
                                        <h2 className="text-[13px] font-bold">No se parecen mucho <span className="text-muted-foreground font-semibold tabular-nums">· {resto.length}</span></h2>
                                        {grilla(resto, true)}
                                    </section>
                                )}
                            </>
                        )}
                    </>
                )}

            <CajonPista r={abierta} alCerrar={() => setAbierta(null)}
                alRegistrar={(p) => { setAbierta(null); abrirRegistro(p); }}
                alListaNegra={() => { if (abierta) void marcarNegra(abierta); setAbierta(null); }}
                alParecidos={() => { if (abierta) setPedido({ parecido: abierta }); setAbierta(null); }} />

            {cajones}
        </div>
    );
}
