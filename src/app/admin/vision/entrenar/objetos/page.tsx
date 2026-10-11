"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Boxes, Camera, ImagePlus, Info, Loader2, Pencil, Plus, Trash2, Upload, Video } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { ErrorEstado, Cargando } from "@/components/ui/estados";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { Anotador } from "@/components/vision/entrenar/Anotador";
import { EntrenarDetector } from "@/components/vision/entrenar/EntrenarDetector";
import { GuiaDibujo } from "@/components/vision/entrenar/GuiaDibujo";
import { CaminoDetector, type PasoCamino } from "@/components/vision/entrenar/CaminoDetector";
import { CAJAS_META, CAJAS_MINIMO, LARGO_NOMBRE, NEGATIVAS_FRACCION, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";

/**
 * OmniVision › Entrenar › Objetos nuevos: el conjunto de fotos para enseñarle al detector cosas
 * que no trae de fábrica, y el entrenamiento (EntrenarDetector). Usar el modelo entrenado en las
 * cámaras es el paso siguiente, y la pantalla lo dice.
 */
type Estado = { clases: ClaseResumen[]; fotos: { total: number; revisadas: number; sinRevisar: number; negativas: number }; falta: string[] };
/** Lo que el camino necesita saber del entrenamiento: si hay uno corriendo, el último terminado y si hay uno en uso. */
type Avance = { enCurso: any | null; ultimo: any | null; activo: any | null };

/**
 * Para arrancar: objetos que el detector de fábrica NO conoce y que en un barrio interesan.
 * Tocarlos completa el nombre de la clase nueva. (Personas, autos, motos, perros o mochilas ya
 * los conoce: no hace falta enseñárselos.)
 */
const EJEMPLOS_CLASE = ["Contenedor de basura", "Cono vehicular", "Carretilla", "Volqueta", "Pallet", "Escalera"];
/** Una clase está «bien» con esto; antes de CAJAS_MINIMO no se puede entrenar. */
const ESTADO_CLASE = (n: number) => n < CAJAS_MINIMO ? `Faltan ${CAJAS_MINIMO - n} para poder entrenar` : n < CAJAS_META ? "Ya se puede entrenar · con más, mejora" : "Muy bien";

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
    const [avance, setAvance] = useState<Avance | null>(null);
    const [guia, setGuia] = useState<boolean | null>(null);

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
            // La guía de dibujo arranca abierta mientras ninguna clase llegó al mínimo.
            setGuia((g) => (g == null ? !je.clases.some((c: ClaseResumen) => c.cajas >= CAJAS_MINIMO) : g));
            Promise.all([
                fetch("/api/vision/objetos/entrenamientos", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
                fetch("/api/vision/objetos/activo", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
            ]).then(([t, a]) => {
                const lista: any[] = t?.entrenamientos || [];
                setAvance({ enCurso: lista.find((x) => ["EN_COLA", "PREPARANDO", "ENTRENANDO", "EXPORTANDO"].includes(x.estado)) || null, ultimo: lista.find((x) => x.estado === "LISTO") || null, activo: a?.activo || null });
            }).catch(() => { });
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

    const conCajas = estado.clases.filter((c) => c.cajas > 0);
    const masFlojita = [...estado.clases].sort((a, b) => a.cajas - b.cajas)[0];
    const pasos: PasoCamino[] = [
        { titulo: "Qué enseñar", ancla: "clases", hecho: estado.clases.length > 0,
            detalle: estado.clases.length ? estado.clases.map((c) => c.nombre).join(", ") : "Creá una clase: «Contenedor», «Cono»…" },
        { titulo: "Juntar fotos", ancla: "fotos", hecho: estado.falta.length === 0 || estado.fotos.total >= CAJAS_MINIMO,
            detalle: `${estado.fotos.total} ${estado.fotos.total === 1 ? "foto" : "fotos"}${estado.fotos.sinRevisar ? ` · ${estado.fotos.sinRevisar} sin dibujar` : ""}` },
        { titulo: "Dibujar", ancla: "fotos", hecho: estado.clases.length > 0 && estado.falta.length === 0,
            detalle: !masFlojita ? "Un recuadro sobre cada objeto" : estado.falta.length ? `«${masFlojita.nombre}»: ${masFlojita.cajas} de ${CAJAS_MINIMO} recuadros` : "Alcanza para entrenar" },
        { titulo: "Entrenar", ancla: "entrenar", hecho: !!avance?.ultimo,
            detalle: avance?.enCurso ? "Entrenando ahora…" : avance?.ultimo?.resultado?.medicion ? `Último: acierta ${Math.round((avance.ultimo.resultado.medicion.f1 || 0) * 100)} %` : "De noche, solo; unos minutos" },
        { titulo: "Usar en las cámaras", ancla: "entrenar", hecho: !!avance?.activo,
            detalle: avance?.activo ? "En uso" : "Cuando el resultado sea bueno" },
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
                    <p className="text-[12.5px] text-muted-foreground leading-snug">El detector conoce 80 cosas (personas, vehículos, animales, mochilas). Acá se le enseña una nueva mostrándole fotos donde está marcada: con suficientes, la encuentra solo en cualquier cámara.</p>
                </div>
            </div>

            <CaminoDetector pasos={pasos} />

            {/* ── 1. Qué enseñar ── */}
            <section id="clases" className="scroll-mt-4 space-y-2">
                <Titulo n={1} titulo="Qué querés enseñarle" texto="Una clase es una cosa que se ve siempre parecida y que el detector todavía no conoce." />
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">
                    <div className="rounded-[10px] border border-border bg-card divide-y divide-border">
                        {estado.clases.length === 0 && (
                            <div className="px-4 py-5 space-y-2">
                                <p className="text-[13px]">Todavía no hay clases. Algunas ideas para un barrio (tocá una para usarla):</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {EJEMPLOS_CLASE.map((e) => <button key={e} type="button" onClick={() => setNueva({ ...nueva, nombre: e })} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold hover:bg-accent">{e}</button>)}
                                </div>
                            </div>
                        )}
                        {estado.clases.map((c, k) => (
                            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                                <span className="grid h-8 w-8 place-items-center rounded-full bg-foreground text-background text-[12px] font-bold tabular-nums shrink-0" title={`Tecla ${k + 1} al dibujar`}>{k + 1}</span>
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
                                            <div className="flex items-baseline gap-2 flex-wrap">
                                                <span className="text-[14px] font-bold">{c.nombre}</span>
                                                {c.descripcion && <span className="text-[11.5px] text-muted-foreground truncate">{c.descripcion}</span>}
                                                <span className={cn("ml-auto text-[12px] font-semibold", c.cajas < CAJAS_MINIMO ? "text-muted-foreground" : "tono-bien")}>{ESTADO_CLASE(c.cajas)}</span>
                                            </div>
                                            <Medidor n={c.cajas} fotos={c.fotos} />
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
                        ))}
                        {estado.fotos.revisadas > 0 && (
                            <div className="px-4 py-2.5 text-[12px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                                <span>Fotos del lugar sin el objeto: <b className="text-foreground tabular-nums">{estado.fotos.negativas}</b> (conviene {negMeta} o más, 1 de cada 7).</span>
                                <Pista ancho={300} texto="Le enseñan qué NO marcar. Sin ellas aprende cosas como «todo lo verde es un contenedor». Se hacen abriendo una foto donde no está el objeto y tocando «No hay ninguno» (N)."><Info size={13} className="cursor-help" /></Pista>
                            </div>
                        )}
                    </div>

                    <div className="space-y-3">
                        <form onSubmit={(e) => { e.preventDefault(); crearClase(); }} className="rounded-[10px] border border-border bg-card p-4 space-y-2.5">
                            <div className="text-[13px] font-bold">Nueva clase</div>
                            <Input value={nueva.nombre} maxLength={LARGO_NOMBRE} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Ej. Contenedor de basura" className="h-9" />
                            <Input value={nueva.descripcion} onChange={(e) => setNueva({ ...nueva, descripcion: e.target.value })} placeholder="Qué entra en el recuadro (opcional): «con la tapa»" className="h-9" />
                            <Button type="submit" className="w-full" disabled={!nueva.nombre.trim()}><Plus size={14} /> Crear</Button>
                        </form>
                        <div className="rounded-[10px] border border-border bg-card p-4 space-y-1.5 text-[12px] text-muted-foreground leading-snug">
                            <div className="text-[13px] font-bold text-foreground">Qué no es una clase</div>
                            <p><b className="text-foreground">Algo que ya conoce:</b> personas, autos, motos, bicicletas, perros, mochilas. Ya los detecta.</p>
                            <p><b className="text-foreground">El estado de un lugar:</b> «contenedor lleno», «portón abierto». Para eso están las <Link href="/admin/vision/entrenar" className="tono-accion font-semibold">zonas entrenables</Link>.</p>
                            <p><b className="text-foreground">Una situación:</b> una pelea, alguien saltando el cerco. Se arman con <Link href="/admin/vision/reglas" className="tono-accion font-semibold">reglas</Link> sobre lo que el detector ya ve.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 2 y 3. Juntar fotos y dibujar ── */}
            <section id="fotos" className="scroll-mt-4 space-y-3">
                <Titulo n={2} titulo="Juntar fotos y dibujar" texto="Fotos donde aparece el objeto (y algunas donde no), y un recuadro sobre cada uno." />
                {guia != null && <GuiaDibujo abierta={guia} alCambiar={setGuia} />}

                <div className="rounded-[10px] border border-border bg-card p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
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
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug">
                        «Sacar foto ahora» toma el cuadro de este momento en máxima resolución: volvé a sacar a la mañana, a la tarde y de noche. También sirven fotos de otras cámaras, del celular o de internet (se pueden arrastrar acá).
                    </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <Filtros solido grupos={[{ clave: "v", titulo: "Fotos", valor: vista, alElegir: setVista, opciones: vistas }]} />
                    {fotos && fotos.length > 0 && estado.clases.length > 0 && (
                        <Button className="ml-auto" onClick={() => setAnotando(0)}><Pencil size={14} /> {vista === "sin" ? `Dibujar ${fotos.length === 1 ? "la foto" : `las ${fotos.length} fotos`}` : "Revisar estas"} <ArrowRight size={14} /></Button>
                    )}
                </div>
                {vista === "sin" && fotos && fotos.length > 0 && (
                    <p className="text-[12px] text-muted-foreground">Al dibujar: arrastrá sobre cada objeto, <kbd className="px-1 rounded bg-muted">Enter</kbd> guarda y pasa a la siguiente, <kbd className="px-1 rounded bg-muted">N</kbd> si en esa foto no está, <kbd className="px-1 rounded bg-muted">1</kbd>-<kbd className="px-1 rounded bg-muted">9</kbd> cambia la clase.</p>
                )}

                {error && <ErrorEstado mensaje={error} alReintentar={cargar} />}
                {!fotos ? <Cargando texto="Trayendo las fotos…" /> : fotos.length === 0 ? (
                    <div className="rounded-[10px] border border-dashed border-border p-10 text-center text-[13px] text-muted-foreground">
                        <ImagePlus className="mx-auto mb-2 opacity-50" />
                        {vista === "sin" ? (estado.fotos.total ? "Todas las fotos están dibujadas. Sumá más, de otros momentos y cámaras." : "Todavía no hay fotos. Elegí una cámara donde se vea el objeto y tocá «Sacar foto ahora», o subí algunas.") : "No hay fotos en esta vista."}
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
                                    {!f.revisada && <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity text-white text-[12px] font-semibold"><span className="inline-flex items-center gap-1"><Pencil size={13} /> Dibujar</span></span>}
                                </div>
                                <div className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground flex items-center gap-1.5">
                                    <span className="truncate">{f.camara || (f.origen === "SUBIDA" ? "Subida" : "Registro")}</span>
                                    <span className={cn("ml-auto tabular-nums", !f.revisada && "font-semibold text-foreground")}>{f.revisada ? (f.cajas.length ? `${f.cajas.length} ${f.cajas.length === 1 ? "recuadro" : "recuadros"}` : "sin el objeto") : "sin dibujar"}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </section>

            {/* ── 3 y 4. Entrenar y usar ── */}
            <section id="entrenar" className="scroll-mt-4 space-y-2">
                <Titulo n={3} titulo="Entrenar y usar en las cámaras" texto="El servidor aprende de los recuadros, se mide con fotos que no vio y, si da bien, lo prendés en las cámaras." />
                <EntrenarDetector clases={estado.clases} falta={estado.falta} />
                {conCajas.length === 0 && <p className="text-[12px] text-muted-foreground">Se puede entrenar cuando haya recuadros dibujados.</p>}
            </section>

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

/** El título de cada parte de la pantalla: número, qué es y para qué. */
function Titulo({ n, titulo, texto }: { n: number; titulo: string; texto: string }) {
    return (
        <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[12px] font-bold tabular-nums text-muted-foreground">{n}</span>
            <h2 className="text-[15px] font-bold">{titulo}</h2>
            <span className="text-[12px] text-muted-foreground">{texto}</span>
        </div>
    );
}

/**
 * Cuántos recuadros lleva una clase, contra las dos marcas que importan: el mínimo para poder
 * entrenar y la meta con la que suele andar bien. Con los números escritos debajo de cada marca,
 * no sólo una raya: «100» sin decir qué es no se entendía.
 */
function Medidor({ n, fotos }: { n: number; fotos: number }) {
    const p = Math.min(1, n / CAJAS_META), m = CAJAS_MINIMO / CAJAS_META;
    return (
        <div className="mt-2 max-w-[560px]">
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <span className={cn("absolute inset-y-0 left-0 rounded-full transition-all", n >= CAJAS_MINIMO ? "bg-[var(--bien)]" : "bg-[var(--accion)]")} style={{ width: `${Math.max(p * 100, n ? 1.5 : 0)}%` }} />
                <span className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${m * 100}%` }} />
            </div>
            <div className="relative h-4 text-[10.5px] text-muted-foreground tabular-nums">
                <span className="absolute left-0">{n} {n === 1 ? "recuadro" : "recuadros"} · {fotos} {fotos === 1 ? "foto" : "fotos"}</span>
                <span className="absolute -translate-x-1/2 hidden sm:inline" style={{ left: `${m * 100}%` }}>mínimo {CAJAS_MINIMO}</span>
                <span className="absolute right-0">meta {CAJAS_META}</span>
            </div>
        </div>
    );
}
