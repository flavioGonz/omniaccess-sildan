"use client";

import { useEffect, useState } from "react";
import { Loader2, ScanSearch, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorEstado } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { TarjetaObjeto, FichaObjeto, img, nombreClase, fecha, hora, type FilaObjeto } from "@/components/vision/ObjetoRegistro";

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
type Resultado = FilaObjeto & { coseno: number; prob: number | null };
type Respuesta = { resultados: Resultado[]; comparados: number; sinHuella: number; h: number; ms: number; modo: "texto" | "parecido" };

const RANGOS = [{ v: "24", r: "24 h" }, { v: "168", r: "7 días" }, { v: "720", r: "30 días" }];
const GRUPOS = [{ v: "", r: "Todo" }, { v: "persona", r: "Personas" }, { v: "vehiculo", r: "Vehículos" }, { v: "animal", r: "Animales" }, { v: "objeto", r: "Bultos" }];
/** Para arrancar: lo que se suele buscar en un barrio. */
const EJEMPLOS = ["camioneta blanca", "persona con mochila", "moto de delivery", "auto rojo", "persona con chaleco reflectivo", "perro"];
/**
 * Probabilidad SigLIP (sigmoide con la escala y el sesgo del modelo) desde la que un resultado
 * «se parece». Medido el 9/10 sobre ~400 pistas: los aciertos de verdad dieron 0,03-0,88
 * (camioneta blanca 0,42, el segundo auto rojo 0,038) y las búsquedas sin nada que encontrar
 * —perro, caballo, bicicleta— nunca pasaron de 0,007. Sin este corte la pantalla mostraba 60
 * «parecidos» a un perro con la barra llena, que es mentir con aspecto de resultado.
 * La búsqueda por imagen no tiene probabilidad (es imagen contra imagen): ahí no se corta.
 */
const PROB_PARECE = 0.02;

export default function BuscarVision() {
    const [texto, setTexto] = useState("");
    const [pedido, setPedido] = useState<{ q?: string; parecido?: FilaObjeto } | null>(null);
    const [h, setH] = useState("168");
    const [grupo, setGrupo] = useState("");
    const [camara, setCamara] = useState("");
    const [camaras, setCamaras] = useState<{ id: string; name: string }[]>([]);
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [buscando, setBuscando] = useState(false);
    const [abierta, setAbierta] = useState<Resultado | null>(null);

    useEffect(() => {
        fetch("/api/vision/estado", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setCamaras(j?.camaras || [])).catch(() => { });
    }, []);

    useEffect(() => {
        if (!pedido) return;
        let vivo = true;
        setBuscando(true); setError(null);
        const p = new URLSearchParams({ h, ...(grupo ? { grupo } : {}), ...(camara ? { camara } : {}), ...(pedido.parecido ? { parecido: pedido.parecido.id } : { q: pedido.q || "" }) });
        fetch(`/api/vision/buscar?${p}`, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`); return j; })
            .then((j) => { if (vivo) setDatos(j); })
            .catch((e) => { if (vivo) setError(e?.message || "No se pudo buscar"); })
            .finally(() => { if (vivo) setBuscando(false); });
        return () => { vivo = false; };
    }, [pedido, h, grupo, camara]);

    const buscar = (q: string) => { const t = q.trim(); if (t) { setTexto(t); setPedido({ q: t }); } };
    const max = datos?.resultados[0]?.coseno || 1;
    const min = datos?.resultados[datos.resultados.length - 1]?.coseno ?? 0;
    const conCorte = datos?.modo === "texto";
    const parecen = !datos ? [] : conCorte ? datos.resultados.filter((r) => (r.prob ?? 0) >= PROB_PARECE) : datos.resultados;
    const resto = !datos || !conCorte ? [] : datos.resultados.filter((r) => (r.prob ?? 0) < PROB_PARECE);
    const grilla = (rs: Resultado[], lejos = false) => (
        <div className={cn("grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3", (buscando || lejos) && "opacity-60")}>
            {rs.map((r) => {
                const rel = max > min ? (r.coseno - min) / (max - min) : 1;
                return (
                    <TarjetaObjeto key={r.id} f={r} alAbrir={() => setAbierta(r)} pie={
                        <div className="flex items-center gap-1.5" title={`coseno ${r.coseno}${r.prob != null ? ` · probabilidad ${r.prob}` : ""}`}>
                            <span className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><span className={cn("block h-full", lejos ? "bg-muted-foreground/40" : "bg-[var(--accion)]")} style={{ width: `${Math.max(6, rel * 100)}%` }} /></span>
                            <span className="text-[10.5px] text-muted-foreground tabular-nums">{fecha(r.primeraVez)}</span>
                        </div>
                    } />
                );
            })}
        </div>
    );

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-muted shrink-0"><ScanSearch size={20} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[17px] font-bold leading-tight">Buscar</h1>
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        Describí lo que buscás como se lo contarías a alguien, y se busca por cómo se ve en todo lo que registraron las cámaras. También «buscar parecidos» desde cualquier resultado. No reconoce caras: encuentra «persona con campera roja», no a una persona en particular.
                    </p>
                </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); buscar(texto); }} className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej. camioneta blanca con escalera" className="h-11 pl-9 text-[14px]" autoFocus />
                </div>
                <Button type="submit" className="h-11" disabled={!texto.trim() || buscando}>{buscando ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Buscar</Button>
            </form>
            <div className="flex items-center gap-1.5 flex-wrap">
                {pedido?.parecido ? (
                    <span className="inline-flex items-center gap-2 h-9 pl-1 pr-2 rounded-full border border-[var(--accion)] text-[12.5px]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {pedido.parecido.recorte && <img src={img(pedido.parecido.recorte, 80)} alt="" className="h-7 w-7 rounded-full object-cover bg-black" />}
                        Parecidos a {nombreClase(pedido.parecido.clase)} · {pedido.parecido.camara} · {hora(pedido.parecido.primeraVez)}
                        <button type="button" onClick={() => setPedido(texto.trim() ? { q: texto.trim() } : null)} aria-label="Quitar" className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
                    </span>
                ) : EJEMPLOS.map((e) => (
                    <button key={e} type="button" onClick={() => buscar(e)} className={cn("h-8 px-3 rounded-full border text-[12px] font-semibold", pedido?.q === e ? "border-[var(--accion)] text-[var(--accion)]" : "border-border text-muted-foreground hover:text-foreground")}>{e}</button>
                ))}
            </div>

            <Filtros grupos={[
                { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                { clave: "g", titulo: "Qué", valor: grupo, alElegir: setGrupo, opciones: GRUPOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                { clave: "c", titulo: "Cámara", valor: camara, alElegir: setCamara, opciones: [{ valor: "", rotulo: "Todas" }, ...camaras.map((c) => ({ valor: c.id, rotulo: c.name }))] },
            ]} />

            {error ? <ErrorEstado mensaje={error} alReintentar={() => setPedido((p) => (p ? { ...p } : p))} />
                : !pedido ? (
                    <div className="rounded-[10px] border border-dashed border-border p-10 text-center text-[13px] text-muted-foreground">Escribí qué buscar, o tocá un ejemplo.</div>
                ) : buscando && !datos ? (
                    <div className="py-16 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
                ) : datos && (
                    <>
                        <p className="text-[12px] text-muted-foreground tabular-nums">
                            {conCorte ? (parecen.length ? `${parecen.length} se parecen` : "Nada se parece") : datos.resultados.length ? `Los ${datos.resultados.length} más parecidos` : "Nada"} entre {datos.comparados.toLocaleString("es-UY")} pistas de {RANGOS.find((r) => r.v === String(datos.h))?.r} · {datos.ms} ms
                            {datos.sinHuella > 0 && ` · ${datos.sinHuella.toLocaleString("es-UY")} todavía sin procesar (se van sumando solas)`}
                        </p>
                        {datos.resultados.length === 0 ? (
                            <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">No hay pistas con huella en este rango y con estos filtros.</div>
                        ) : (
                            <>
                                {parecen.length > 0 ? grilla(parecen) : (
                                    <div className="rounded-[10px] border border-border bg-card px-4 py-3 text-[13px]">
                                        Nada de lo que vieron las cámaras en este rango se parece a «{pedido.q}». Abajo, lo menos lejano, por si sirve.
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

            <Cajon open={!!abierta} onOpenChange={(o) => { if (!o) setAbierta(null); }}>
                {abierta && (
                    <CajonContenido ancho="intermedio" titulo={`${nombreClase(abierta.clase)} · ${abierta.camara}`} descripcion={`${fecha(abierta.primeraVez)} ${hora(abierta.primeraVez)}`}>
                        <FichaObjeto f={abierta} alParecidos={() => { setPedido({ parecido: abierta }); setAbierta(null); }} />
                    </CajonContenido>
                )}
            </Cajon>
        </div>
    );
}
