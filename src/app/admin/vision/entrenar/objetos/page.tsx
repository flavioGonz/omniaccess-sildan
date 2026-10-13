"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Boxes, ChevronDown, ImagePlus, Info, Pencil, Plus, Trash2, Thermometer } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { ErrorEstado, Cargando, Chip } from "@/components/ui/estados";
import { CURVA_SUAVE } from "@/components/ui/entrada";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { Anotador } from "@/components/vision/entrenar/Anotador";
import { CerebroFlotante, GaleriaEntrenamientos, PanelEntrenar, useEntrenamientos } from "@/components/vision/entrenar/EntrenarDetector";
import { SoltarFotos } from "@/components/vision/entrenar/SoltarFotos";
import { CamarasOSubidas } from "@/components/vision/entrenar/CamarasOSubidas";
import { GuiaDibujo, UnModeloVariasClases } from "@/components/vision/entrenar/GuiaDibujo";
import { AlCelular } from "@/components/vision/entrenar/AlCelular";
import { CaminoDetector, type PasoCamino } from "@/components/vision/entrenar/CaminoDetector";
import { CAJAS_META, CAJAS_MINIMO, LARGO_NOMBRE, NEGATIVAS_FRACCION, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";

/**
 * OmniVision › Entrenar › Objetos nuevos: el conjunto de fotos para enseñarle al detector cosas
 * que no trae de fábrica, y el entrenamiento (EntrenarDetector). Usar el modelo entrenado en las
 * cámaras es el paso siguiente, y la pantalla lo dice.
 */
type Estado = { clases: ClaseResumen[]; fotos: { total: number; revisadas: number; sinRevisar: number; negativas: number; porOrigen?: Record<string, number> }; falta: string[] };

/**
 * Para arrancar: objetos que el detector de fábrica NO conoce y que en un barrio interesan.
 * Tocarlos completa el nombre de la clase nueva. (Personas, autos, motos, perros o mochilas ya
 * los conoce: no hace falta enseñárselos.)
 */
const EJEMPLOS_CLASE = ["Contenedor de basura", "Cono vehicular", "Carretilla", "Volqueta", "Pallet", "Escalera"];
/** Una clase está «bien» con esto; antes de CAJAS_MINIMO no se puede entrenar. El tono es el estado. */
const ESTADO_CLASE = (n: number) => n < CAJAS_MINIMO ? { t: `Faltan ${CAJAS_MINIMO - n}`, tono: "quieto" as const } : n < CAJAS_META ? { t: "Ya se puede entrenar", tono: "info" as const } : { t: "Muy bien", tono: "bien" as const };

export default function ObjetosPropios() {
    const [estado, setEstado] = useState<Estado | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [vista, setVista] = useState("sin");
    const [fotos, setFotos] = useState<FotoFila[] | null>(null);
    const [camaras, setCamaras] = useState<{ id: string; name: string }[]>([]);
    const [anotando, setAnotando] = useState<number | null>(null);
    /**
     * Las fotos que se abrieron solas al llegar (link pegado, Ctrl+V, una sola soltada). El
     * editor recibe SÓLO esas: abrirlo sobre la lista de «Sin dibujar» obligaba a buscar la foto
     * recién pegada entre las demás. Al cerrarlo se vuelve a la lista de siempre.
     */
    const [recien, setRecien] = useState<FotoFila[] | null>(null);
    const [nueva, setNueva] = useState({ nombre: "", descripcion: "" });
    const [editando, setEditando] = useState<ClaseResumen | null>(null);
    const [aBorrar, setABorrar] = useState<ClaseResumen | null>(null);
    // «Cómo dibujar bien» arranca plegado: es consulta, no lo primero que hay que leer.
    const [guia, setGuia] = useState(false);
    const [explica, setExplica] = useState<boolean | null>(null);
    const ent = useEntrenamientos();

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
            // «Un modelo, varias clases» abierto sólo mientras no hay ninguna clase.
            setExplica((x) => (x == null ? je.clases.length === 0 : x));
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
            setRecien((l) => l && l.map((f) => (f.id === id ? j.foto : f)));
            fetch("/api/vision/objetos", { cache: "no-store" }).then((r) => r.json()).then(setEstado).catch(() => { });
            return j.foto as FotoFila;
        } catch (e: any) { toast.error({ title: "No se guardó", description: e?.message }); return null; }
    };
    const borrarFoto = async (id: string) => {
        try { await pedir(`/api/vision/objetos/fotos/${id}`, { method: "DELETE" }); setFotos((l) => l && l.filter((f) => f.id !== id)); setRecien((l) => l && l.filter((f) => f.id !== id)); return true; }
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

    const ultimo = ent.datos?.entrenamientos.find((x) => x.estado === "LISTO") || null;
    const masFlojita = [...estado.clases].sort((a, b) => a.cajas - b.cajas)[0];
    const pasos: PasoCamino[] = [
        { titulo: "Qué enseñar", ancla: "clases", hecho: estado.clases.length > 0,
            detalle: estado.clases.length ? estado.clases.map((c) => c.nombre).join(", ") : "Creá una clase: «Contenedor», «Cono»…" },
        { titulo: "Juntar fotos", ancla: "agregar", hecho: estado.falta.length === 0 || estado.fotos.total >= CAJAS_MINIMO,
            detalle: `${estado.fotos.total} ${estado.fotos.total === 1 ? "foto" : "fotos"}${estado.fotos.sinRevisar ? ` · ${estado.fotos.sinRevisar} sin dibujar` : ""}` },
        { titulo: "Dibujar", ancla: "fotos", hecho: estado.clases.length > 0 && estado.falta.length === 0,
            detalle: !masFlojita ? "Un recuadro sobre cada objeto" : estado.falta.length ? `«${masFlojita.nombre}»: ${masFlojita.cajas} de ${CAJAS_MINIMO} recuadros` : "Alcanza para entrenar" },
        { titulo: "Entrenar", ancla: "entrenar", hecho: !!ultimo,
            detalle: ent.enCurso ? "Entrenando ahora…" : ent.pausado ? "En pausa" : ultimo?.resultado?.medicion ? `Último: acierta ${Math.round((ultimo.resultado.medicion.f1 || 0) * 100)} %` : "De noche, solo; unos minutos" },
        { titulo: "Usar en las cámaras", ancla: "entrenar", hecho: !!ent.activo?.activo,
            detalle: ent.activo?.activo ? "En uso" : "Cuando el resultado sea bueno" },
    ];

    return (
        <div className="p-6 lg:p-8 max-w-[1640px] mx-auto space-y-5">
            <div className="flex items-center gap-3 flex-wrap">
                <Link href="/admin/vision/entrenar" aria-label="Volver" className="h-9 w-9 grid place-items-center rounded-[10px] border border-border hover:bg-accent"><ArrowLeft size={16} /></Link>
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><Boxes size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[17px] font-bold leading-tight">Objetos nuevos para el detector</h1>
                    <p className="text-[12.5px] text-muted-foreground leading-snug">El detector conoce 80 cosas (personas, vehículos, animales, mochilas). Acá se le enseña una nueva mostrándole fotos donde está marcada: con suficientes, la encuentra solo en cualquier cámara.</p>
                </div>
                <Link href="/admin/vision/entrenar/salud" title="Temperatura, consumo y uso de la GPU y la CPU mientras se entrena"
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] font-semibold hover:bg-accent">
                    <Thermometer size={15} /> Salud del equipo
                </Link>
                <AlCelular />
            </div>

            {/* Los entrenamientos, lo primero al entrar: antes estaban al fondo, debajo de todas las fotos. */}
            <GaleriaEntrenamientos clases={estado.clases} e={ent} />

            {/* Dos columnas: lo que se arma (clases, fotos, dibujo) y, fijo a la derecha, el
                entrenamiento — que acompaña el scroll porque es lo que se mira mientras se dibuja. */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
                <div className="space-y-5 min-w-0">
                    {/* ── 1. Qué enseñar: lo primero que se ve al entrar ── */}
                    <section id="clases" className="scroll-mt-4 space-y-2">
                        <Titulo n={1} titulo="Qué querés enseñarle" texto="Las clases: los tipos de objeto que el detector todavía no conoce. Pueden ser varias." />
                        <div className="rounded-[10px] border border-border bg-card divide-y divide-border">
                            {estado.clases.map((c, k) => (
                                <div key={c.id} className="flex items-center gap-3 px-4 py-3.5">
                                    <span className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background text-[13px] font-bold tabular-nums shrink-0" title={`Tecla ${k + 1} al dibujar`}>{k + 1}</span>
                                    <div className="min-w-0 flex-1">
                                        {editando?.id === c.id ? (
                                            <div className="flex gap-2 flex-wrap">
                                                <Input value={editando.nombre} maxLength={LARGO_NOMBRE} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} className="h-8 w-56" />
                                                <Input value={editando.descripcion || ""} onChange={(e) => setEditando({ ...editando, descripcion: e.target.value })} placeholder="Qué entra en el recuadro" className="h-8 flex-1 min-w-[180px]" />
                                                <Button size="sm" onClick={() => guardarClase(editando)}>Guardar</Button>
                                                <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] items-center gap-x-5 gap-y-2">
                                                <div className="min-w-0">
                                                    <div className="text-[14.5px] font-bold truncate">{c.nombre}</div>
                                                    {c.descripcion && <div className="text-[11.5px] text-muted-foreground truncate">{c.descripcion}</div>}
                                                </div>
                                                <Medidor n={c.cajas} fotos={c.fotos} />
                                            </div>
                                        )}
                                    </div>
                                    {editando?.id !== c.id && (
                                        <div className="flex items-center shrink-0">
                                            <button type="button" onClick={() => setEditando(c)} aria-label="Cambiar el nombre" title="Cambiar el nombre" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Pencil size={14} /></button>
                                            <button type="button" onClick={() => setABorrar(c)} aria-label="Borrar la clase" title="Borrar la clase" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-[var(--mal-suave)] hover:text-[var(--mal-texto)]"><Trash2 size={14} /></button>
                                        </div>
                                    )}
                                </div>
                            ))}
                            <form onSubmit={(e) => { e.preventDefault(); crearClase(); }} className="px-4 py-3 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="grid h-9 w-9 place-items-center rounded-full border border-dashed border-border text-muted-foreground shrink-0"><Plus size={14} /></span>
                                    <Input value={nueva.nombre} maxLength={LARGO_NOMBRE} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })}
                                        placeholder={estado.clases.length ? "Otra clase: «Cono vehicular»" : "La primera clase: «Contenedor de basura»"} className="h-9 w-64" />
                                    <Input value={nueva.descripcion} onChange={(e) => setNueva({ ...nueva, descripcion: e.target.value })} placeholder="Qué entra en el recuadro (opcional): «con la tapa»" className="h-9 flex-1 min-w-[200px]" />
                                    <Button type="submit" disabled={!nueva.nombre.trim()}><Plus size={14} /> Agregar clase</Button>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap pl-11">
                                    <span className="text-[11.5px] text-muted-foreground">Ideas:</span>
                                    {EJEMPLOS_CLASE.filter((e) => !estado.clases.some((c) => c.nombre.toLowerCase() === e.toLowerCase())).map((e) => (
                                        <button key={e} type="button" onClick={() => setNueva({ ...nueva, nombre: e })} className="h-7 px-2.5 rounded-full border border-border text-[11.5px] font-semibold hover:bg-accent">{e}</button>
                                    ))}
                                </div>
                            </form>
                            {estado.fotos.revisadas > 0 && (
                                <div className="px-4 py-2.5 text-[12px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                                    <span>Fotos del lugar sin ningún objeto: <b className="text-foreground tabular-nums">{estado.fotos.negativas}</b> (conviene {negMeta} o más, 1 de cada 7). Sirven para todas las clases.</span>
                                    <Pista ancho={300} texto="Le enseñan qué NO marcar. Sin ellas aprende cosas como «todo lo verde es un contenedor». Se hacen abriendo una foto donde no está ninguno y tocando «No hay ninguno» (N)."><Info size={13} className="cursor-help" /></Pista>
                                </div>
                            )}
                            {/* Qué es (y qué no es) una clase: plegado salvo al empezar. */}
                            <div>
                                <button type="button" onClick={() => setExplica((x) => !x)} aria-expanded={!!explica}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
                                    <Info size={13} /> Un modelo, varias clases · qué no es una clase
                                    <ChevronDown size={14} className={cn("ml-auto transition-transform", explica && "rotate-180")} />
                                </button>
                                <AnimatePresence initial={false}>
                                    {explica && (
                                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.26, ease: CURVA_SUAVE }} className="overflow-hidden">
                                            <div className="px-4 pb-4"><UnModeloVariasClases /></div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </section>

                    {/* ── 2. Agregar fotos: arriba, enseguida de las clases (pedido de Nico): es lo que
                        más se hace en esta pantalla y quedaba debajo del camino y de la guía. ── */}
                    <section id="agregar" className="scroll-mt-4 space-y-2">
                        <Titulo n={2} titulo="Agregar fotos" texto="Por link, soltándolas o de una cámara. Fotos donde aparece el objeto, y algunas donde no." />
                        <SoltarFotos camaras={camaras} alAgregar={(nuevas, abrir) => {
                            setVista("sin"); cargar();
                            if (!abrir || !nuevas.length || anotando != null) return;
                            if (!estado.clases.length) { toast.error({ title: "Foto agregada", description: "Para dibujarla, primero creá una clase arriba." }); return; }
                            setRecien(nuevas); setAnotando(0);
                        }} />
                        <CamarasOSubidas porOrigen={estado.fotos.porOrigen} />
                    </section>

                    <CaminoDetector pasos={pasos} />

                    {/* Cómo dibujar, debajo del camino y plegado: se abre cuando se va a dibujar. */}
                    <GuiaDibujo abierta={guia} alCambiar={setGuia} />

                    {/* ── 2. Juntar fotos y dibujar ── */}
                    <section id="fotos" className="scroll-mt-4 space-y-3">
                        <Titulo n={3} titulo="Dibujar" texto="Un recuadro sobre cada objeto, en cada foto. Las que no lo tienen se marcan «No hay ninguno»." />

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
                                {vista === "sin" ? (estado.fotos.total ? "Todas las fotos están dibujadas. Sumá más, de otros momentos y cámaras." : "Todavía no hay fotos. Soltá algunas arriba, o elegí una cámara donde se vea el objeto y tocá «Sacar foto ahora».") : "No hay fotos en esta vista."}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2">
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

                </div>

                <aside className="lg:sticky lg:top-4 space-y-3">
                    <PanelEntrenar clases={estado.clases} falta={estado.falta} e={ent} />
                </aside>
            </div>
            <CerebroFlotante e={ent} />

            {anotando != null && (recien || fotos) && (
                <Anotador fotos={(recien || fotos)!} inicio={anotando} clases={estado.clases} alGuardar={guardarFoto} alBorrar={borrarFoto}
                    alCerrar={() => { setAnotando(null); setRecien(null); cargar(); }} />
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
 * entrenar y la meta con la que suele andar bien. El número grande es lo que se busca de un
 * vistazo; el estado va como chip con su tono (apagado hasta el mínimo, info al alcanzarlo, bien
 * en la meta), y las marcas con su número debajo: «100» sin decir qué es no se entendía.
 */
function Medidor({ n, fotos }: { n: number; fotos: number }) {
    const p = Math.min(1, n / CAJAS_META), m = CAJAS_MINIMO / CAJAS_META;
    const e = ESTADO_CLASE(n);
    const tono = n >= CAJAS_META ? "var(--bien)" : n >= CAJAS_MINIMO ? "var(--info)" : "var(--quieto)";
    return (
        <div className="min-w-0">
            <div className="flex items-baseline gap-2">
                <span className="text-[17px] font-bold tabular-nums leading-none">{n}</span>
                <span className="text-[11.5px] text-muted-foreground tabular-nums">{n === 1 ? "recuadro" : "recuadros"} en {fotos} {fotos === 1 ? "foto" : "fotos"}</span>
                <Chip tono={e.tono} className="ml-auto">{e.t}</Chip>
            </div>
            <div className="relative mt-2 h-2.5 rounded-full bg-muted">
                <motion.span className="absolute inset-y-0 left-0 rounded-full" style={{ background: tono }}
                    initial={false} animate={{ width: `${Math.max(p * 100, n ? 1.5 : 0)}%` }} transition={{ duration: 0.6, ease: CURVA_SUAVE }} />
                {/* Las dos marcas, como muescas que cruzan la barra. */}
                <span className="absolute -top-0.5 -bottom-0.5 w-[3px] rounded-full bg-card" style={{ left: `calc(${m * 100}% - 1.5px)` }} />
                <span className="absolute -top-0.5 -bottom-0.5 w-[2px] rounded-full bg-foreground/45" style={{ left: `calc(${m * 100}% - 1px)` }} />
            </div>
            <div className="relative h-4 mt-1 text-[10.5px] text-muted-foreground tabular-nums">
                <span className="absolute -translate-x-1/2 hidden sm:inline" style={{ left: `${m * 100}%` }}>mínimo {CAJAS_MINIMO}</span>
                <span className="absolute right-0">meta {CAJAS_META}</span>
            </div>
        </div>
    );
}
