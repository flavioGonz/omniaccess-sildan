"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Camera, ImagePlus, Loader2, Pencil, Plus, Trash2, Upload, Video } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { ErrorEstado, Cargando } from "@/components/ui/estados";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { Anotador } from "@/components/vision/entrenar/Anotador";
import { CAJAS_META, CAJAS_MINIMO, LARGO_NOMBRE, NEGATIVAS_FRACCION, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";

/**
 * OmniVision › Entrenar › Objetos nuevos: el conjunto de fotos para enseñarle al detector cosas
 * que no trae de fábrica. Es el primer paso del detector propio —juntar y dibujar—; el
 * entrenamiento en sí es el siguiente, y la pantalla no muestra un botón que todavía no hace
 * nada: dice qué falta para llegar.
 */
type Estado = { clases: ClaseResumen[]; fotos: { total: number; revisadas: number; sinRevisar: number; negativas: number }; falta: string[] };

export default function ObjetosPropios() {
    const [estado, setEstado] = useState<Estado | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [vista, setVista] = useState("sin");
    const [fotos, setFotos] = useState<FotoFila[] | null>(null);
    const [camaras, setCamaras] = useState<{ id: string; name: string }[]>([]);
    const [camara, setCamara] = useState("");
    const [sacando, setSacando] = useState(false);
    const [subiendo, setSubiendo] = useState<{ hechas: number; total: number } | null>(null);
    const [anotando, setAnotando] = useState<number | null>(null);
    const [nueva, setNueva] = useState({ nombre: "", descripcion: "" });
    const [editando, setEditando] = useState<ClaseResumen | null>(null);
    const [aBorrar, setABorrar] = useState<ClaseResumen | null>(null);
    const archivos = useRef<HTMLInputElement>(null);

    const cargar = useCallback(async () => {
        try {
            const [e, f] = await Promise.all([
                fetch("/api/vision/objetos", { cache: "no-store" }),
                fetch(`/api/vision/objetos/fotos?${new URLSearchParams(vista.startsWith("clase:") ? { vista: "revisadas", clase: vista.slice(6) } : { vista })}`, { cache: "no-store" }),
            ]);
            const je = await e.json().catch(() => ({})), jf = await f.json().catch(() => ({}));
            if (!e.ok) throw new Error(je?.error || `El servidor respondió ${e.status}`);
            if (!f.ok) throw new Error(jf?.error || `El servidor respondió ${f.status}`);
            setEstado(je); setFotos(jf.fotos); setError(null);
        } catch (x: any) { setError(x?.message || "No se pudo leer"); }
    }, [vista]);
    useEffect(() => { setFotos(null); cargar(); }, [cargar]);
    useEffect(() => {
        fetch("/api/vision/estado", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { setCamaras(j?.camaras || []); }).catch(() => { });
    }, []);

    async function pedir(url: string, init?: RequestInit) {
        const r = await fetch(url, init);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
        return j;
    }
    async function sacarFoto() {
        if (!camara) return;
        setSacando(true);
        try { await pedir(`/api/vision/objetos/fotos?camara=${encodeURIComponent(camara)}`, { method: "POST" }); toast.success({ title: "Foto agregada", description: "Está en «Sin dibujar»." }); setVista("sin"); await cargar(); }
        catch (e: any) { toast.error({ title: "No se sacó la foto", description: e?.message }); }
        finally { setSacando(false); }
    }
    async function subir(lista: FileList | File[] | null) {
        const fs = [...(lista || [])].filter((f) => f.type.startsWith("image/"));
        if (!fs.length) return;
        setSubiendo({ hechas: 0, total: fs.length });
        let mal = 0;
        // De a una: son fotos grandes y el servidor las recomprime; en paralelo se pisan con el resto de la app.
        for (const [k, f] of fs.entries()) {
            try { await pedir("/api/vision/objetos/fotos", { method: "POST", body: f, headers: { "content-type": f.type } }); } catch { mal++; }
            setSubiendo({ hechas: k + 1, total: fs.length });
        }
        setSubiendo(null);
        if (mal) toast.error({ title: `${mal} de ${fs.length} no se pudieron subir`, description: "Probá con JPG o PNG." });
        else toast.success({ title: `${fs.length} foto${fs.length === 1 ? "" : "s"} agregada${fs.length === 1 ? "" : "s"}` });
        setVista("sin"); await cargar();
    }
    async function crearClase() {
        try { await pedir("/api/vision/objetos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(nueva) }); setNueva({ nombre: "", descripcion: "" }); await cargar(); }
        catch (e: any) { toast.error({ title: "No se creó", description: e?.message }); }
    }
    async function guardarClase(c: ClaseResumen) {
        try { await pedir(`/api/vision/objetos/${c.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ nombre: c.nombre, descripcion: c.descripcion }) }); setEditando(null); await cargar(); }
        catch (e: any) { toast.error({ title: "No se guardó", description: e?.message }); }
    }
    const guardarFoto = async (id: string, cajas: Caja[]) => {
        try {
            const j = await pedir(`/api/vision/objetos/fotos/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cajas, revisada: true }) });
            setFotos((l) => l && l.map((f) => (f.id === id ? j.foto : f)));
            fetch("/api/vision/objetos", { cache: "no-store" }).then((r) => r.json()).then(setEstado).catch(() => { });
            return j.foto as FotoFila;
        } catch (e: any) { toast.error({ title: "No se guardó", description: e?.message }); return null; }
    };
    const borrarFoto = async (id: string) => {
        try { await pedir(`/api/vision/objetos/fotos/${id}`, { method: "DELETE" }); setFotos((l) => l && l.filter((f) => f.id !== id)); return true; }
        catch (e: any) { toast.error({ title: "No se descartó", description: e?.message }); return false; }
    };

    if (!estado && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!estado) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo el conjunto…" /></div>;

    const negMeta = Math.ceil(estado.fotos.revisadas * NEGATIVAS_FRACCION);
    const vistas = [
        { valor: "sin", rotulo: "Sin dibujar", cuenta: estado.fotos.sinRevisar },
        { valor: "revisadas", rotulo: "Dibujadas", cuenta: estado.fotos.revisadas - estado.fotos.negativas },
        { valor: "negativas", rotulo: "Sin ninguno", cuenta: estado.fotos.negativas },
        ...estado.clases.map((c) => ({ valor: `clase:${c.id}`, rotulo: c.nombre, cuenta: c.fotos })),
    ];

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto"
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); subir(e.dataTransfer.files); }}>
            <div className="flex items-center gap-3 flex-wrap">
                <Link href="/admin/vision/entrenar" aria-label="Volver" className="h-9 w-9 grid place-items-center rounded-[10px] border border-border hover:bg-accent"><ArrowLeft size={16} /></Link>
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><Boxes size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[17px] font-bold leading-tight">Objetos nuevos para el detector</h1>
                    <p className="text-[12px] text-muted-foreground leading-snug">Fotos con un recuadro sobre cada objeto. Con suficientes, el detector aprende a encontrarlo en cualquier cámara.</p>
                </div>
                <Pista ancho={340} texto={`El detector de fábrica conoce 80 cosas (personas, vehículos, animales, mochilas). Para una nueva hay que mostrarle ejemplos dibujados: al menos ${CAJAS_MINIMO} recuadros por clase, mejor ${CAJAS_META}, de distintas cámaras, horas (día y noche) y distancias. Y fotos del mismo lugar SIN el objeto (más o menos 1 de cada 7): sin ellas aprende «todo lo verde es un contenedor».`}>
                    <span className="text-[11.5px] text-muted-foreground underline decoration-dotted underline-offset-2 cursor-help">¿Cuántas hacen falta?</span>
                </Pista>
            </div>

            {/* Las clases, con lo que llevan. */}
            <section className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3">
                <div className="rounded-[10px] border border-border bg-card divide-y divide-border">
                    {estado.clases.length === 0 && <p className="px-4 py-6 text-[13px] text-muted-foreground">Todavía no hay clases. Creá la primera a la derecha: «Contenedor de basura», «Cono», «Carretilla».</p>}
                    {estado.clases.map((c, k) => {
                        const p = Math.min(1, c.cajas / CAJAS_META);
                        return (
                            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                                <span className="grid h-8 w-8 place-items-center rounded-full bg-foreground text-background text-[12px] font-bold tabular-nums shrink-0">{k + 1}</span>
                                <div className="min-w-0 flex-1">
                                    {editando?.id === c.id ? (
                                        <div className="flex gap-2 flex-wrap">
                                            <Input value={editando.nombre} maxLength={LARGO_NOMBRE} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} className="h-8 w-56" />
                                            <Input value={editando.descripcion || ""} onChange={(e) => setEditando({ ...editando, descripcion: e.target.value })} placeholder="Qué entra en el recuadro" className="h-8 flex-1 min-w-[180px]" />
                                            <Button size="sm" onClick={() => guardarClase(editando)}>Guardar</Button>
                                            <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-2"><span className="text-[13.5px] font-bold">{c.nombre}</span>{c.descripcion && <span className="text-[11.5px] text-muted-foreground truncate">{c.descripcion}</span>}</div>
                                            <div className="mt-1.5 flex items-center gap-2">
                                                <span className="relative flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[420px]">
                                                    <span className={cn("absolute inset-y-0 left-0 rounded-full", c.cajas >= CAJAS_MINIMO ? "bg-[var(--bien)]" : "bg-[var(--accion)]")} style={{ width: `${p * 100}%` }} />
                                                    <span className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${(CAJAS_MINIMO / CAJAS_META) * 100}%` }} title={`mínimo: ${CAJAS_MINIMO}`} />
                                                </span>
                                                <span className="text-[11.5px] text-muted-foreground tabular-nums">{c.cajas} / {CAJAS_META} recuadros · {c.fotos} fotos</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                                {editando?.id !== c.id && (
                                    <>
                                        <button type="button" onClick={() => setEditando(c)} aria-label="Cambiar el nombre" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Pencil size={14} /></button>
                                        <button type="button" onClick={() => setABorrar(c)} aria-label="Borrar la clase" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:tono-mal"><Trash2 size={14} /></button>
                                    </>
                                )}
                            </div>
                        );
                    })}
                    <div className="px-4 py-3 text-[12px] text-muted-foreground">
                        {estado.falta.length ? (
                            <>
                                <span className="font-semibold text-foreground">Para poder entrenar falta:</span>
                                <ul className="list-disc pl-5 mt-1 space-y-0.5">{estado.falta.map((x) => <li key={x}>{x}</li>)}</ul>
                            </>
                        ) : <span className="tono-bien font-semibold">El conjunto alcanza para entrenar. El entrenamiento es el paso siguiente: todavía no está en esta pantalla.</span>}
                        {estado.fotos.revisadas > 0 && <p className="mt-1.5 tabular-nums">Fotos sin ningún objeto: {estado.fotos.negativas} (conviene {negMeta} o más).</p>}
                    </div>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); crearClase(); }} className="rounded-[10px] border border-border bg-card p-4 space-y-2.5">
                    <div className="text-[13px] font-bold">Nueva clase</div>
                    <Input value={nueva.nombre} maxLength={LARGO_NOMBRE} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Ej. Contenedor de basura" className="h-9" />
                    <Input value={nueva.descripcion} onChange={(e) => setNueva({ ...nueva, descripcion: e.target.value })} placeholder="Qué entra en el recuadro (opcional)" className="h-9" />
                    <Button type="submit" className="w-full" disabled={!nueva.nombre.trim()}><Plus size={14} /> Crear</Button>
                    <p className="text-[11.5px] text-muted-foreground leading-snug">Una clase es una cosa que se ve siempre parecida. «Contenedor» sí; «algo raro» no: el detector aprende formas, no situaciones.</p>
                </form>
            </section>

            {/* Juntar fotos. */}
            <section className="rounded-[10px] border border-border bg-card p-3 flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold mr-1">Agregar fotos</span>
                <label className={cn("relative inline-flex items-center h-9 rounded-lg pl-2.5 pr-2 gap-1.5 text-[12.5px] font-semibold", camara ? "bg-muted" : "bg-muted/60 text-muted-foreground")}>
                    <Video size={14} />
                    <select value={camara} onChange={(e) => setCamara(e.target.value)} aria-label="Cámara" className="appearance-none bg-transparent outline-none pr-4 max-w-[220px] [&>option]:text-foreground [&>option]:bg-background">
                        <option value="">Elegí una cámara</option>
                        {camaras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <span className="pointer-events-none absolute right-2 text-[9px] opacity-70">▼</span>
                </label>
                <Button onClick={sacarFoto} disabled={!camara || sacando}>{sacando ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Sacar foto ahora</Button>
                <span className="w-px h-6 bg-border mx-1" />
                <Button variant="outline" onClick={() => archivos.current?.click()} disabled={!!subiendo}>
                    {subiendo ? <><Loader2 size={14} className="animate-spin" /> {subiendo.hechas}/{subiendo.total}</> : <><Upload size={14} /> Subir fotos</>}
                </Button>
                <input ref={archivos} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
                <span className="text-[11.5px] text-muted-foreground">o arrastralas acá. Sirven fotos de otras cámaras, del celular o de internet.</span>
            </section>

            <div className="flex items-center gap-2 flex-wrap">
                <Filtros solido grupos={[{ clave: "v", titulo: "Fotos", valor: vista, alElegir: setVista, opciones: vistas }]} />
                {fotos && fotos.length > 0 && estado.clases.length > 0 && (
                    <Button className="ml-auto" onClick={() => setAnotando(0)}><Pencil size={14} /> {vista === "sin" ? "Empezar a dibujar" : "Revisar estas"}</Button>
                )}
            </div>

            {error && <ErrorEstado mensaje={error} alReintentar={cargar} />}
            {!fotos ? <Cargando texto="Trayendo las fotos…" /> : fotos.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-border p-10 text-center text-[13px] text-muted-foreground">
                    <ImagePlus className="mx-auto mb-2 opacity-50" />
                    {vista === "sin" ? "No hay fotos sin dibujar. Sacá una de una cámara o subí algunas." : "No hay fotos en esta vista."}
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                    {fotos.map((f, k) => (
                        <button key={f.id} type="button" onClick={() => estado.clases.length ? setAnotando(k) : toast.error({ title: "Primero creá una clase" })}
                            className="group rounded-[10px] border border-border bg-card overflow-hidden text-left hover:border-[var(--accion)] transition-colors">
                            <div className="relative bg-black" style={{ aspectRatio: `${f.ancho} / ${f.alto}` }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={`${f.url}?w=320`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                                {f.cajas.map((c, j) => (
                                    <span key={j} className="absolute border-2 border-[var(--accion-en-oscuro,#60a5fa)] rounded-[2px]" style={{ left: `${c.caja[0] * 100}%`, top: `${c.caja[1] * 100}%`, width: `${(c.caja[2] - c.caja[0]) * 100}%`, height: `${(c.caja[3] - c.caja[1]) * 100}%` }} />
                                ))}
                            </div>
                            <div className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground flex items-center gap-1.5">
                                <span className="truncate">{f.camara || (f.origen === "SUBIDA" ? "Subida" : "Registro")}</span>
                                <span className="ml-auto tabular-nums">{f.revisada ? (f.cajas.length ? `${f.cajas.length} ▢` : "sin ninguno") : "sin dibujar"}</span>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {anotando != null && fotos && (
                <Anotador fotos={fotos} inicio={anotando} clases={estado.clases} alGuardar={guardarFoto} alBorrar={borrarFoto}
                    alCerrar={() => { setAnotando(null); cargar(); }} />
            )}
            {aBorrar && (
                <ConfirmarAccion open onOpenChange={(o) => { if (!o) setABorrar(null); }} id={aBorrar.id} title={`Clase «${aBorrar.nombre}»`}
                    description={`Se borran sus ${aBorrar.cajas} recuadros de todas las fotos. Las fotos quedan, y siguen sirviendo para las otras clases.`}
                    onDelete={async (id) => { const r = await fetch(`/api/vision/objetos/${id}`, { method: "DELETE" }); if (!r.ok) return { success: false, error: (await r.json().catch(() => ({})))?.error || `El servidor respondió ${r.status}` }; }}
                    onSuccess={() => { setABorrar(null); setVista("sin"); cargar(); }} />
            )}
        </div>
    );
}
