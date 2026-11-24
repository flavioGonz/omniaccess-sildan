"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle, ArrowDown, ArrowUp, Building2, CheckCircle2, ChevronRight, FileUp, History, Home, Mail, Map as MapIcon, MapPinned, NotebookPen, Pencil, Phone, Plus, Sparkles, Trees, Truck, Upload, UserRound, Users,
} from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import {
    administraciones, borrarAdministracion, borrarContactoAdm, borrarServicioAdm, cambiosDeLotes, copiaDeLosCorreos, detalleAdministracion, guardarAdministracion, guardarContactoAdm, guardarServicioAdm, moverAdministracion,
    type CambioVisto, type ContactoAdm, type DetalleAdministracion, type LoteAdm, type ResumenAdministracion, type ServicioAdm,
} from "@/app/actions/administraciones";
import { CajonLote } from "@/components/lotes/CajonLote";
import { CorreoAdministracion } from "@/components/administraciones/CorreoAdministracion";
import { PlanoLotes } from "@/components/administraciones/PlanoLotes";
import { HistorialLote } from "@/components/lotes/HistorialLote";
import type { InformePadron } from "@/lib/padron-importar";
import { nombreDeLote, siglaDeEtapa } from "@/lib/padron-planilla";
import { Button } from "@/components/ui/button";
import { Cajon, CajonCampo, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { DeleteButton } from "@/components/ui/delete-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Cargando, Chip, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Pestanias } from "@/components/ui/pestanias";
import { Pista } from "@/components/ui/pista";
import { Seek } from "@/components/ui/search";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { cn } from "@/lib/utils";

/**
 * Administraciones: las comisiones del complejo.
 *
 * Pedido de Nico (21/11): «el complejo San Nicolás tiene varias comisiones por grupos de lotes. Se
 * fue construyendo por proyectos de grupos de lotes; cada grupo tiene su comisión, que le llaman
 * etapas. Debemos crear "Administraciones", un apartado para reflejar esto, para tener los
 * contactos, servicios de cada comisión, referentes».
 *
 * La pregunta que contesta esta pantalla es de guardia y de madrugada: pasó algo en el lote tal —
 * ¿de quién depende, y a quién se llama? De cada administración, tres cosas: su GENTE (a quién
 * llamar), lo que CONTRATA (quién entra a trabajar y cuándo) y sus LOTES (qué casas son, quién vive,
 * y cómo va el censo).
 *
 * La forma (25/11, Nico: «las administraciones no deben estar arriba; debe ser un sidebar derecho,
 * con las 4 administraciones en un bloque fijo vertical, que hace scroll junto a la tabla y tabs.
 * Nueva administración debe ser un drawer estilizado»):
 *   · A la derecha, la columna de las administraciones, pegada mientras se baja por la tabla: se
 *     cambia de una a otra sin volver arriba. Arriba de la columna, el complejo entero en una línea.
 *   · A la izquierda, la administración elegida: su ficha (cifras, a quién llamar, desde qué casilla
 *     escribe y QUÉ LE FALTA, cada cosa con su atajo) y debajo sus pestañas.
 *   · Altas y cambios en cajones laterales, no en ventanas al medio: se edita sin perder de vista la
 *     lista (ver ui/cajon).
 *
 * Los lotes no se cargan a mano: llegan con la planilla del padrón («Importar padrón»), que se
 * puede volver a subir cada vez que la administración manda una versión nueva. Primero muestra qué
 * haría; recién después aplica. No borra nada y no manda correos.
 */

type Pest = "contactos" | "servicios" | "lotes" | "plano" | "cambios" | "correo";
type FiltroLotes = "todos" | "gente" | "sin" | "terrenos";
const SITUACION: Record<string, { rotulo: string; tono: "quieto" | "info" | "aviso" }> = {
    TERRENO: { rotulo: "Terreno", tono: "quieto" }, DESARROLLADOR: { rotulo: "Del desarrollador", tono: "info" }, SIN_TITULAR: { rotulo: "Sin titular", tono: "aviso" },
};
const VINCULO: Record<string, string> = { PROPIETARIO: "propietario", INQUILINO: "inquilino", OCUPANTE: "ocupante", FAMILIA: "familia" };
const CODIGO: Record<string, { punto: string; dice: string }> = {
    sin: { punto: "bg-muted-foreground/40", dice: "sin código del censo" }, listo: { punto: "bg-[var(--aviso)]", dice: "código listo, sin enviar" },
    enviado: { punto: "bg-[var(--info)]", dice: "código enviado" }, cargo: { punto: "bg-[var(--bien)]", dice: "ya cargó su censo" },
};
const ENTRADA = "h-9 w-full px-3 rounded-[6px] border border-border bg-background text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40 focus-visible:border-[var(--accion)]";

/** La cuenta de correo está lista para mandar: casilla, clave, y Gmail la aceptó. */
const correoListo = (a: ResumenAdministracion) => !!a.correo.cuenta && a.correo.conClave && !a.correo.error && !!a.correo.probadoAt;
const porciento = (n: number, de: number) => (de ? Math.round((n / de) * 100) : 0);

export default function Administraciones() {
    const [lista, setLista] = useState<ResumenAdministracion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sel, setSel] = useState<string | null>(null);
    const [det, setDet] = useState<DetalleAdministracion | null>(null);
    const [pest, setPest] = useState<Pest>("contactos");
    const [filtroLotes, setFiltroLotes] = useState<FiltroLotes>("todos");
    const [editAdm, setEditAdm] = useState<Partial<ResumenAdministracion> | null>(null);
    const [editContacto, setEditContacto] = useState<Partial<ContactoAdm> | null>(null);
    const [editServicio, setEditServicio] = useState<Partial<ServicioAdm> | null>(null);
    const [importando, setImportando] = useState(false);
    /** El lote abierto en su cajón: su gente, sus códigos del censo, sus matrículas y su historial. */
    const [loteAbierto, setLoteAbierto] = useState<string | null>(null);

    /** Sube cada vez que hay que volver a traer todo (se guardó algo, se importó el padrón). */
    const [vuelta, setVuelta] = useState(0);
    const refrescar = useCallback(() => setVuelta((n) => n + 1), []);
    useEffect(() => {
        let vivo = true;
        administraciones()
            .then((l) => { if (!vivo) return; setLista(l); setError(null); setSel((x) => (x && l.some((a) => a.id === x) ? x : l[0]?.id || null)); })
            .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudieron traer las administraciones."); });
        return () => { vivo = false; };
    }, [vuelta]);
    useEffect(() => {
        if (!sel) return;
        let vivo = true;
        detalleAdministracion(sel).then((d) => { if (vivo) setDet(d); }).catch(() => toast.error({ title: "No se pudo traer esa administración" }));
        return () => { vivo = false; };
    }, [sel, vuelta]);
    /* La copia fija de todos los envíos, para decirla al lado de cada cuenta de correo. */
    const [copia, setCopia] = useState("");
    useEffect(() => { copiaDeLosCorreos().then(setCopia).catch(() => { }); }, [vuelta]);
    const elegida = lista?.find((a) => a.id === sel) || null;
    const cargandoDetalle = !!sel && det?.id !== sel;

    /** Ir a una pestaña desde un atajo de la ficha («12 lotes sin nadie con correo» → Lotes, filtrado). */
    const irA = (p: Pest, filtro?: FiltroLotes) => { setPest(p); if (filtro) setFiltroLotes(filtro); };
    const elegir = (id: string) => { setSel(id); setFiltroLotes("todos"); };
    const mover = async (id: string, hacia: "arriba" | "abajo") => {
        /* Se ve el cambio enseguida y se confirma con el servidor: subir una fila no debería esperar una vuelta. */
        setLista((l) => {
            if (!l) return l;
            const i = l.findIndex((a) => a.id === id), j = hacia === "arriba" ? i - 1 : i + 1;
            if (i < 0 || j < 0 || j >= l.length) return l;
            const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c;
        });
        const r = await moverAdministracion(id, hacia).catch(() => ({ ok: false }));
        if (!r.ok) { toast.error({ title: "No se pudo cambiar el orden" }); refrescar(); }
    };

    return (
        <div className="p-6 max-w-[1600px] mx-auto">
            <div className="mb-5">
                <h1 className="text-[22px] font-bold tracking-tight">Administraciones</h1>
                <p className="text-[13px] text-muted-foreground">Las comisiones del complejo: a quién se llama, qué contrata cada una y cuáles son sus lotes.</p>
            </div>

            {error ? <ErrorEstado mensaje={error} alReintentar={refrescar} />
                : !lista ? (
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                        <div className="space-y-4"><div className="h-[230px] rounded-[14px] bg-card animate-pulse" /><div className="h-[360px] rounded-[14px] bg-card animate-pulse" /></div>
                        <div className="h-[420px] rounded-[14px] bg-card animate-pulse" />
                    </div>
                ) : lista.length === 0 ? (
                    <div className="rounded-[14px] border border-dashed border-border">
                        <Vacio icono={Building2} titulo="Todavía no hay ninguna administración"
                            ayuda="Subí la planilla del padrón y se crean solas, con sus lotes y su gente. O creá una a mano y cargale sus contactos."
                            accion={<div className="flex gap-2"><Button size="sm" onClick={() => setImportando(true)}><FileUp size={14} /> Importar padrón</Button><Button size="sm" variant="outline" onClick={() => setEditAdm({})}><Plus size={14} /> Nueva administración</Button></div>} />
                    </div>
                ) : (
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
                        {/* ── La administración elegida ── */}
                        <div className="min-w-0 order-2 lg:order-1">
                            {elegida && (
                                <section aria-label={elegida.nombre}>
                                    <Ficha a={elegida} alEditar={() => setEditAdm(elegida)} alIr={irA} alAgregarContacto={() => setEditContacto({})} />
                                    <div className="mt-5 flex flex-wrap items-center gap-3 mb-3">
                                        <Pestanias<Pest> valor={pest} alElegir={setPest} opciones={[
                                            { valor: "contactos", rotulo: "Contactos", icono: Users, cuenta: elegida.contactos },
                                            { valor: "servicios", rotulo: "Servicios", icono: Truck, cuenta: elegida.servicios },
                                            { valor: "lotes", rotulo: "Lotes", icono: MapPinned, cuenta: elegida.lotes },
                                            { valor: "plano", rotulo: "Plano", icono: MapIcon, ayuda: "Sus lotes sobre el croquis del complejo, del color de cómo va su censo. Tocá un punto para abrir el lote." },
                                            { valor: "cambios", rotulo: "Cambios", icono: History, ayuda: "Lo último que cambió en los lotes de esta administración: matrículas que entran o salen, gente que se suma o se va, y lo que cargan en el censo." },
                                            { valor: "correo", rotulo: "Correo", icono: Mail, tono: correoListo(elegida) ? undefined : "aviso", ayuda: "La casilla de Gmail desde la que esta administración les escribe a sus lotes." },
                                        ]} />
                                        <div className="ml-auto">
                                            {pest === "contactos" && <Button size="sm" variant="outline" onClick={() => setEditContacto({})}><Plus size={14} /> Agregar contacto</Button>}
                                            {pest === "servicios" && <Button size="sm" variant="outline" onClick={() => setEditServicio({})}><Plus size={14} /> Agregar servicio</Button>}
                                        </div>
                                    </div>
                                    {pest === "contactos" && <Contactos filas={cargandoDetalle ? null : det?.contactos || []} alEditar={setEditContacto} alBorrar={async (id) => { await borrarContactoAdm(id); refrescar(); }} />}
                                    {pest === "servicios" && <Servicios filas={cargandoDetalle ? null : det?.servicios || []} alEditar={setEditServicio} alBorrar={async (id) => { await borrarServicioAdm(id); refrescar(); }} />}
                                    {pest === "lotes" && <Lotes filas={cargandoDetalle ? null : det?.lotes || []} alAbrir={setLoteAbierto} filtro={filtroLotes} alFiltrar={setFiltroLotes} />}
                                    {pest === "plano" && <PlanoLotes lotes={cargandoDetalle ? null : det?.lotes || []} alAbrir={setLoteAbierto} />}
                                    {pest === "cambios" && <Cambios administracionId={elegida.id} vuelta={vuelta} alAbrirLote={setLoteAbierto} />}
                                    {pest === "correo" && <CorreoAdministracion key={elegida.id} id={elegida.id} nombre={elegida.nombre} correo={elegida.correo} copia={copia} alCambiar={refrescar} />}
                                </section>
                            )}
                        </div>

                        {/* ── La columna de las administraciones: pegada mientras se baja por la tabla ── */}
                        <aside className="order-1 lg:order-2 lg:sticky lg:top-4" aria-label="Administraciones del complejo">
                            <Columna lista={lista} sel={sel} alElegir={elegir} alMover={mover} alNueva={() => setEditAdm({})} alImportar={() => setImportando(true)} />
                        </aside>
                    </div>
                )}

            {editAdm && <FormAdministracion a={editAdm} alCerrar={() => setEditAdm(null)} alGuardar={(id) => { setEditAdm(null); if (id) elegir(id); refrescar(); }} />}
            {editContacto && sel && <FormContacto administracionId={sel} nombreAdm={elegida?.nombre || ""} c={editContacto} alCerrar={() => setEditContacto(null)} alGuardar={() => { setEditContacto(null); refrescar(); }} />}
            {editServicio && sel && <FormServicio administracionId={sel} nombreAdm={elegida?.nombre || ""} s={editServicio} alCerrar={() => setEditServicio(null)} alGuardar={() => { setEditServicio(null); refrescar(); }} />}
            {importando && <ImportarPadron alCerrar={() => setImportando(false)} alAplicar={refrescar} />}
            <CajonLote unitId={loteAbierto} alCerrar={() => { setLoteAbierto(null); refrescar(); }} />
        </div>
    );
}

/** Un anillo chico: cuánto del censo ya se cargó. El arco es lo cargado; el tenue, lo enviado sin cargar. */
function Anillo({ cargaron, enviados, de, size = 30 }: { cargaron: number; enviados: number; de: number; size?: number }) {
    const r = 12, L = 2 * Math.PI * r;
    const c = de ? cargaron / de : 0, e = de ? Math.max(0, enviados - cargaron) / de : 0;
    return (
        <svg width={size} height={size} viewBox="0 0 30 30" className="shrink-0 -rotate-90" aria-hidden>
            <circle cx="15" cy="15" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted" />
            {e > 0 && <circle cx="15" cy="15" r={r} fill="none" stroke="var(--info)" strokeOpacity="0.55" strokeWidth="3" strokeDasharray={`${L * (c + e)} ${L}`} strokeLinecap="round" />}
            {c > 0 && <circle cx="15" cy="15" r={r} fill="none" stroke="var(--bien)" strokeWidth="3" strokeDasharray={`${L * c} ${L}`} strokeLinecap="round" />}
        </svg>
    );
}

/**
 * La columna de la derecha: el complejo entero arriba, y una fila por administración.
 *
 * Cada fila dice lo justo para elegir: la sigla (que es como se las nombra en la guardia), cuántos
 * lotes y personas, cómo va su censo (el anillo) y si su casilla de correo está lista. Con las
 * flechas del teclado se pasa de una a otra; el orden se cambia con las flechitas que aparecen al
 * pasar el mouse, y es el mismo en todo el sistema.
 */
function Columna({ lista, sel, alElegir, alMover, alNueva, alImportar }: {
    lista: ResumenAdministracion[]; sel: string | null; alElegir: (id: string) => void; alMover: (id: string, hacia: "arriba" | "abajo") => void; alNueva: () => void; alImportar: () => void;
}) {
    const t = lista.reduce((s, a) => ({ lotes: s.lotes + a.lotes, personas: s.personas + a.personas, conCodigo: s.conCodigo + a.conCodigo, enviados: s.enviados + a.enviados, cargaron: s.cargaron + a.cargaron }), { lotes: 0, personas: 0, conCodigo: 0, enviados: 0, cargaron: 0 });
    const filas = useRef<Record<string, HTMLDivElement | null>>({});
    const teclas = (e: React.KeyboardEvent, i: number) => {
        const j = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : -1;
        if (j < 0 || j >= lista.length || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
        e.preventDefault(); alElegir(lista[j].id); filas.current[lista[j].id]?.focus();
    };
    return (
        <div className="rounded-[14px] border border-border bg-card overflow-hidden">
            {/* El complejo entero, de un vistazo. */}
            <div className="px-4 pt-4 pb-3.5 border-b border-border">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">El complejo</p>
                <div className="mt-2 flex items-center gap-3">
                    <Anillo cargaron={t.cargaron} enviados={t.enviados} de={t.conCodigo} size={38} />
                    <div className="min-w-0 leading-tight">
                        <p className="text-[13px] font-semibold tabular-nums">{t.lotes} lotes · {t.personas} personas</p>
                        <p className="text-[11.5px] text-muted-foreground tabular-nums">Censo: {t.cargaron} cargaron · {t.enviados} enviados de {t.conCodigo}</p>
                    </div>
                </div>
            </div>

            <div role="tablist" aria-orientation="vertical" aria-label="Administraciones" className="p-1.5 space-y-0.5">
                {lista.map((a, i) => {
                    const activa = a.id === sel, lista_ = correoListo(a);
                    return (
                        <div key={a.id} ref={(el) => { filas.current[a.id] = el; }} role="tab" aria-selected={activa} tabIndex={activa ? 0 : -1}
                            onClick={() => alElegir(a.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alElegir(a.id); } else teclas(e, i); }}
                            className={cn("group relative flex items-center gap-3 rounded-[10px] px-2.5 py-2.5 cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accion)]",
                                activa ? "bg-[var(--accion)]/[0.08]" : "hover:bg-accent/60")}>
                            {/* La marca de la elegida: una línea del azul de acción al borde, no un recuadro entero. */}
                            <span className={cn("absolute left-0 top-2 bottom-2 w-[3px] rounded-full transition-opacity", activa ? "bg-[var(--accion)] opacity-100" : "opacity-0")} />
                            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold tabular-nums tracking-tight",
                                activa ? "bg-[var(--accion)] text-white" : "bg-muted text-foreground/80")}>{a.sigla}</span>
                            <div className="min-w-0 flex-1 leading-tight">
                                <p className={cn("text-[13.5px] font-semibold truncate", activa && "text-[var(--accion)]")}>{a.nombre}</p>
                                <p className="mt-0.5 text-[11.5px] text-muted-foreground tabular-nums truncate">{a.lotes} lotes · {a.personas} personas</p>
                                <p className={cn("mt-0.5 flex items-center gap-1 text-[11px] truncate", lista_ ? "text-muted-foreground" : "tono-aviso")}>
                                    {lista_ ? <CheckCircle2 size={11} className="tono-bien shrink-0" /> : <AlertTriangle size={11} className="shrink-0" />}
                                    <span className="truncate">{lista_ ? a.correo.cuenta : !a.correo.cuenta ? "Sin casilla de correo" : "Casilla sin probar"}</span>
                                </p>
                            </div>
                            <Pista titulo={`Censo · ${a.sigla}`} texto={`${a.cargaron} ya cargaron · ${a.enviados} con el código enviado · ${a.conCodigo - a.enviados} sin enviar (de ${a.conCodigo} con código).`} ancho={240}>
                                <span className="relative grid place-items-center transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                                    <Anillo cargaron={a.cargaron} enviados={a.enviados} de={a.conCodigo} />
                                    <span className="absolute text-[8.5px] font-bold tabular-nums text-muted-foreground">{porciento(a.cargaron, a.conCodigo)}</span>
                                </span>
                            </Pista>
                            {/* Cambiar el orden: aparece en el lugar del anillo al pasar el mouse o con el foco en la fila. */}
                            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden flex-col gap-1 group-hover:flex group-focus-within:flex">
                                <button type="button" disabled={i === 0} onClick={(e) => { e.stopPropagation(); alMover(a.id, "arriba"); }} aria-label={`Subir ${a.nombre}`}
                                    className="grid h-6 w-7 place-items-center rounded-[6px] border border-border bg-card text-muted-foreground hover:text-[var(--accion)] disabled:opacity-30"><ArrowUp size={12} /></button>
                                <button type="button" disabled={i === lista.length - 1} onClick={(e) => { e.stopPropagation(); alMover(a.id, "abajo"); }} aria-label={`Bajar ${a.nombre}`}
                                    className="grid h-6 w-7 place-items-center rounded-[6px] border border-border bg-card text-muted-foreground hover:text-[var(--accion)] disabled:opacity-30"><ArrowDown size={12} /></button>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="p-3 border-t border-border grid gap-2">
                <Button size="sm" onClick={alNueva} className="w-full"><Plus size={14} /> Nueva administración</Button>
                <Button size="sm" variant="ghost" onClick={alImportar} className="w-full text-muted-foreground"><FileUp size={14} /> Importar padrón</Button>
            </div>
        </div>
    );
}

/**
 * La ficha de la elegida: quién es, sus cifras, a quién se llama, desde dónde escribe, y lo que le
 * falta. Cada cifra que pide algo es un atajo: «12 sin nadie con correo» abre los lotes ya
 * filtrados; «falta un referente» abre el alta del contacto. La idea es que no haya que salir a
 * buscar qué está incompleto: se ve, y se arregla desde donde se vio.
 */
function Ficha({ a, alEditar, alIr, alAgregarContacto }: { a: ResumenAdministracion; alEditar: () => void; alIr: (p: Pest, f?: FiltroLotes) => void; alAgregarContacto: () => void }) {
    const sinEnviar = Math.max(0, a.conCodigo - a.enviados);
    const falta: { texto: string; accion: () => void }[] = [];
    if (!a.referente) falta.push({ texto: "Cargar a quién se llama", accion: alAgregarContacto });
    if (!correoListo(a)) falta.push({ texto: !a.correo.cuenta ? "Cargar su casilla de correo" : "Probar su casilla de correo", accion: () => alIr("correo") });
    if (a.sinGente > 0) falta.push({ texto: `${a.sinGente} ${a.sinGente === 1 ? "lote" : "lotes"} sin nadie con correo`, accion: () => alIr("lotes", "sin") });
    if (a.servicios === 0) falta.push({ texto: "Cargar los servicios que contrata", accion: () => alIr("servicios") });
    return (
        <div className="rounded-[14px] border border-border bg-card">
            <div className="flex items-start gap-4 p-5 pb-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[12px] bg-[var(--accion)] text-white text-[17px] font-bold tracking-tight tabular-nums">{a.sigla}</span>
                <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Administración · {a.sigla}</p>
                    <h2 className="text-[22px] font-bold tracking-tight leading-tight sm:truncate">{a.nombre}</h2>
                    {a.notas && <p className="mt-1 text-[12.5px] text-muted-foreground line-clamp-2 whitespace-pre-line">{a.notas}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={alEditar}><Pencil size={13} /> Editar</Button>
            </div>

            {/* Las cifras. Las que piden algo llevan a donde se arregla. */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-px bg-border border-t border-border">
                <Cuadro icono={Home} n={a.lotes} rotulo="lotes" extra={a.terrenos ? `${a.terrenos} terrenos` : undefined} alTocar={() => alIr("lotes", "todos")} />
                <Cuadro icono={Users} n={a.personas} rotulo="personas con correo" alTocar={() => alIr("lotes", "gente")} />
                <Cuadro icono={a.sinGente ? AlertTriangle : Trees} n={a.sinGente} rotulo="lotes sin nadie con correo" tono={a.sinGente ? "aviso" : undefined} alTocar={() => alIr("lotes", "sin")} />
                <div className="bg-card px-5 py-4">
                    <p className="text-[11px] text-muted-foreground">Censo</p>
                    <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums">{porciento(a.cargaron, a.conCodigo)}<span className="text-[13px] font-semibold text-muted-foreground">%</span></p>
                    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden flex">
                        <span className="h-full bg-[var(--bien)]" style={{ width: `${porciento(a.cargaron, a.conCodigo)}%` }} />
                        <span className="h-full bg-[var(--info)]/60" style={{ width: `${porciento(Math.max(0, a.enviados - a.cargaron), a.conCodigo)}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">{a.cargaron} cargaron · {a.enviados} enviados · {sinEnviar} sin enviar</p>
                </div>
            </div>

            {/* A quién se llama, desde dónde escribe, y lo que le falta. */}
            <div className="grid gap-3 border-t border-border p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="flex items-center gap-3 rounded-[10px] bg-muted/40 px-3.5 py-3 min-w-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-muted-foreground"><UserRound size={16} /></span>
                    {a.referente ? (
                        <>
                            <div className="min-w-0 flex-1 leading-tight">
                                <p className="text-[13px] font-semibold truncate">{a.referente.nombre}</p>
                                <p className="text-[11.5px] text-muted-foreground truncate">{a.referente.rol || "Referente"}{a.referente.telefono ? ` · ${a.referente.telefono}` : ""}</p>
                            </div>
                            {a.referente.telefono && <a href={`tel:${a.referente.telefono.replace(/[^\d+]/g, "")}`} aria-label={`Llamar a ${a.referente.nombre}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-card text-[var(--accion)] hover:bg-accent"><Phone size={14} /></a>}
                            {a.referente.email && <a href={`mailto:${a.referente.email}`} aria-label={`Escribirle a ${a.referente.nombre}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-card text-[var(--accion)] hover:bg-accent"><Mail size={14} /></a>}
                        </>
                    ) : (
                        <button type="button" onClick={alAgregarContacto} className="min-w-0 flex-1 text-left leading-tight">
                            <p className="text-[13px] font-semibold">Sin referente</p>
                            <p className="text-[11.5px] text-[var(--accion)]">Cargar a quién se llama</p>
                        </button>
                    )}
                </div>
                <button type="button" onClick={() => alIr("correo")} className={cn("flex items-center gap-3 rounded-[10px] px-3.5 py-3 min-w-0 text-left transition-colors", correoListo(a) ? "bg-muted/40 hover:bg-muted/70" : "chip-aviso border")}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-muted-foreground"><Mail size={16} /></span>
                    <div className="min-w-0 flex-1 leading-tight">
                        <p className="text-[13px] font-semibold truncate">{a.correo.cuenta || "Sin casilla de correo"}</p>
                        <p className="text-[11.5px] text-muted-foreground truncate">{correoListo(a) ? "Desde acá les escribe a sus lotes" : a.correo.error ? "Gmail no la acepta" : a.correo.cuenta ? "Falta probarla" : "Sus lotes no reciben correos"}</p>
                    </div>
                    {correoListo(a) ? <CheckCircle2 size={16} className="tono-bien shrink-0" /> : <ChevronRight size={16} className="shrink-0 opacity-60" />}
                </button>
                {falta.length > 0 ? (
                    <div className="md:col-span-2 flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><Sparkles size={12} /> Le falta</span>
                        {falta.map((f) => (
                            <button key={f.texto} type="button" onClick={f.accion} className="h-7 px-2.5 rounded-full border border-border bg-background text-[11.5px] font-semibold hover:border-[var(--accion)] hover:text-[var(--accion)] inline-flex items-center gap-1">
                                {f.texto}<ChevronRight size={12} className="opacity-60" />
                            </button>))}
                    </div>
                ) : (
                    <p className="md:col-span-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold tono-bien"><CheckCircle2 size={13} /> Completa: referente, casilla de correo, servicios y lotes con gente.</p>
                )}
            </div>
        </div>
    );
}

function Cuadro({ icono: Icono, n, rotulo, extra, tono, alTocar }: { icono: React.ComponentType<{ size?: number; className?: string }>; n: number; rotulo: string; extra?: string; tono?: "aviso"; alTocar: () => void }) {
    return (
        <button type="button" onClick={alTocar} className="group bg-card px-5 py-4 text-left hover:bg-accent/40 transition-colors">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icono size={12} className={cn(tono === "aviso" && "tono-aviso")} />{rotulo}</p>
            <p className={cn("mt-0.5 text-[22px] font-bold leading-none tabular-nums", tono === "aviso" && "tono-aviso")}>{n}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{extra || <span className="opacity-0 group-hover:opacity-100 text-[var(--accion)]">Ver en la lista →</span>}</p>
        </button>
    );
}

const Tel = ({ v }: { v: string | null }) => (v ? <a href={`tel:${v.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 tabular-nums hover:underline"><Phone size={12} className="text-muted-foreground" />{v}</a> : <span className="text-muted-foreground">—</span>);
const Correo = ({ v }: { v: string | null }) => (v ? <a href={`mailto:${v}`} className="inline-flex items-center gap-1.5 hover:underline truncate max-w-full"><Mail size={12} className="shrink-0 text-muted-foreground" /><span className="truncate">{v}</span></a> : <span className="text-muted-foreground">—</span>);
const Acciones = ({ alEditar, alBorrar }: { alEditar: () => void; alBorrar: () => void }) => (
    <div className="flex items-center justify-end gap-1">
        <button type="button" onClick={alEditar} aria-label="Editar" className="h-7 w-7 grid place-items-center rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-accent"><Pencil size={13} /></button>
        {/* El botón de borrar es grande de fábrica (está pensado para el pie de un formulario): en una fila va a escala. */}
        <div className="scale-[.72] origin-right -my-2"><DeleteButton onConfirm={alBorrar} /></div>
    </div>
);

function Contactos({ filas, alEditar, alBorrar }: { filas: ContactoAdm[] | null; alEditar: (c: ContactoAdm) => void; alBorrar: (id: string) => void }) {
    const cols = useMemo<ColumnaTabla<ContactoAdm>[]>(() => [
        { clave: "nombre", titulo: "Nombre", valor: (c) => c.nombre, celda: (c) => <span className="text-[13px] font-semibold">{c.nombre}</span> },
        { clave: "rol", titulo: "Qué es", ancho: 220, valor: (c) => c.rol, celda: (c) => (c.rol ? <span className="text-[12.5px]">{c.rol}</span> : <span className="text-muted-foreground">—</span>) },
        { clave: "telefono", titulo: "Teléfono", ancho: 170, valor: (c) => c.telefono || "", celda: (c) => <span className="text-[12.5px]"><Tel v={c.telefono} /></span> },
        { clave: "email", titulo: "Correo", ancho: 260, valor: (c) => c.email || "", celda: (c) => <span className="text-[12.5px]"><Correo v={c.email} /></span> },
        { clave: "notas", titulo: "Notas", valor: (c) => c.notas || "", celda: (c) => <span className="text-[12px] text-muted-foreground line-clamp-2">{c.notas || ""}</span> },
        { clave: "acc", titulo: "", ancho: 90, auxiliar: true, celda: (c) => <Acciones alEditar={() => alEditar(c)} alBorrar={() => alBorrar(c.id)} /> },
    ], [alEditar, alBorrar]);
    return <Tabla filas={filas || []} cargando={!filas} clave={(c) => c.id} columnas={cols} filasFantasma={3} seleccionCeldas={false}
        vacio={{ icono: Users, titulo: "Sin contactos cargados", ayuda: "La administradora, el presidente de la comisión, un referente de seguridad: a quién se llama cuando pasa algo en un lote de esta administración." }} />;
}

function Servicios({ filas, alEditar, alBorrar }: { filas: ServicioAdm[] | null; alEditar: (s: ServicioAdm) => void; alBorrar: (id: string) => void }) {
    const cols = useMemo<ColumnaTabla<ServicioAdm>[]>(() => [
        { clave: "rubro", titulo: "Servicio", ancho: 180, valor: (s) => s.rubro, celda: (s) => <span className="text-[13px] font-semibold">{s.rubro}</span> },
        { clave: "proveedor", titulo: "Quién lo hace", valor: (s) => [s.proveedor, s.contacto].filter(Boolean).join(" · "), celda: (s) => (
            <div className="leading-tight"><div className="text-[12.5px]">{s.proveedor || <span className="text-muted-foreground">—</span>}</div>{s.contacto && <div className="text-[11.5px] text-muted-foreground">{s.contacto}</div>}</div>) },
        { clave: "telefono", titulo: "Teléfono", ancho: 170, valor: (s) => s.telefono || "", celda: (s) => <span className="text-[12.5px]"><Tel v={s.telefono} /></span> },
        { clave: "horario", titulo: "Cuándo viene", ancho: 220, valor: (s) => s.horario || "", celda: (s) => (s.horario ? <span className="text-[12.5px]">{s.horario}</span> : <span className="text-muted-foreground">—</span>) },
        { clave: "notas", titulo: "Notas", valor: (s) => s.notas || "", celda: (s) => <span className="text-[12px] text-muted-foreground line-clamp-2">{s.notas || ""}</span> },
        { clave: "acc", titulo: "", ancho: 90, auxiliar: true, celda: (s) => <Acciones alEditar={() => alEditar(s)} alBorrar={() => alBorrar(s.id)} /> },
    ], [alEditar, alBorrar]);
    return <Tabla filas={filas || []} cargando={!filas} clave={(s) => s.id} columnas={cols} filasFantasma={3} seleccionCeldas={false}
        vacio={{ icono: Truck, titulo: "Sin servicios cargados", ayuda: "Lo que contrata esta administración: jardinería, recolección, mantenimiento, piscinas. Con quién lo hace y cuándo viene, para que la guardia sepa a quién espera." }} />;
}

/**
 * Lo último que cambió en los lotes de la administración. Es la misma lista que el historial de un
 * lote, con todos mezclados: la pregunta acá es «¿qué se movió esta semana?», no «¿qué le pasó a
 * este lote?». Cada renglón lleva a su lote.
 */
function Cambios({ administracionId, vuelta, alAbrirLote }: { administracionId: string; vuelta: number; alAbrirLote: (id: string) => void }) {
    const [dias, setDias] = useState(30);
    // La respuesta guarda para qué pedido es: al cambiar de administración o de período no se ve la anterior.
    const [traido, setTraido] = useState<{ de: string; cambios: CambioVisto[]; auditadoDesde: string | null; hayMas: boolean; error: string | null } | null>(null);
    const [otra, setOtra] = useState(0);
    const llave = `${administracionId}|${dias}|${vuelta}|${otra}`;
    useEffect(() => {
        let vivo = true;
        cambiosDeLotes({ administracionId, dias })
            .then((r) => { if (vivo) setTraido({ de: llave, ...r, error: null }); })
            .catch((e) => { if (vivo) setTraido({ de: llave, cambios: [], auditadoDesde: null, hayMas: false, error: e instanceof Error ? e.message : "No se pudieron traer los cambios." }); });
        return () => { vivo = false; };
    }, [administracionId, dias, llave]);
    const d = traido?.de === llave ? traido : null;
    const PERIODOS = [{ v: 7, r: "7 días" }, { v: 30, r: "30 días" }, { v: 365, r: "Un año" }];
    return (
        <div className="rounded-[10px] border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="text-[12.5px] text-muted-foreground">Matrículas que entran o salen, gente que se suma o se va, y lo que cargan en el censo.</p>
                <div className="ml-auto flex gap-1.5" role="group" aria-label="Período">
                    {PERIODOS.map((o) => (
                        <button key={o.v} type="button" aria-pressed={dias === o.v} onClick={() => setDias(o.v)}
                            className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", dias === o.v ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>{o.r}</button>))}
                </div>
            </div>
            {!d ? <Cargando texto="Trayendo los cambios…" /> : d.error ? <ErrorEstado mensaje={d.error} alReintentar={() => setOtra((n) => n + 1)} />
                : <HistorialLote cambios={d.cambios} conLote alAbrirLote={alAbrirLote} auditadoDesde={d.auditadoDesde} hayMas={d.hayMas} />}
        </div>
    );
}

/** Los lotes. El filtro lo tiene la página: los atajos de la ficha («12 sin nadie con correo») llegan acá ya filtrados. */
function Lotes({ filas, alAbrir, filtro, alFiltrar: setFiltro }: { filas: LoteAdm[] | null; alAbrir: (id: string) => void; filtro: FiltroLotes; alFiltrar: (f: FiltroLotes) => void }) {
    const [q, setQ] = useState("");
    const todos = filas || [];
    const n = { todos: todos.length, gente: todos.filter((l) => l.personas.length).length, sin: todos.filter((l) => !l.situacion && !l.personas.length).length, terrenos: todos.filter((l) => l.situacion === "TERRENO").length };
    const vistos = useMemo(() => {
        const t = q.trim().toLowerCase();
        return todos.filter((l) => (filtro === "todos" || (filtro === "gente" && l.personas.length > 0) || (filtro === "sin" && !l.situacion && !l.personas.length) || (filtro === "terrenos" && l.situacion === "TERRENO"))
            && (!t || [l.nombre, l.titular, l.edificio, ...l.personas.flatMap((p) => [p.nombre, p.email])].some((x) => (x || "").toLowerCase().includes(t))));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `todos` cambia sólo con `filas`
    }, [filas, q, filtro]);
    const cols = useMemo<ColumnaTabla<LoteAdm>[]>(() => [
        { clave: "lote", titulo: "Lote", ancho: 150, ordenable: true, valor: (l) => l.nombre, celda: (l) => (
            <div className="leading-tight"><div className="text-[13px] font-bold tabular-nums">{l.codigo}</div>{l.edificio && <div className="text-[11px] text-muted-foreground">{l.edificio}</div>}</div>) },
        { clave: "titular", titulo: "Titular según la administración", ayuda: "Como figura en la lista de gastos comunes. «X - Y» es un matrimonio; «X / Y», propietario e inquilino. Es un texto de la administración, no una persona del padrón.",
            valor: (l) => l.titular || "", celda: (l) => (
                <div className="leading-tight min-w-0"><div className="text-[12.5px] truncate">{l.titular || <span className="text-muted-foreground">—</span>}</div>{l.observaciones && <div className="text-[11px] text-muted-foreground line-clamp-1" title={l.observaciones}>{l.observaciones}</div>}</div>) },
        { clave: "personas", titulo: "Personas con correo", ayuda: "Quienes reciben su código del censo por este lote. El punto dice cómo va: gris sin código, ámbar listo sin enviar, azul enviado, verde ya cargó.",
            valor: (l) => l.personas.map((p) => `${p.nombre} (${VINCULO[p.vinculo] || p.vinculo})`).join("; "), celda: (l) => l.personas.length === 0 ? <span className="text-[12px] text-muted-foreground">—</span> : (
                <ul className="space-y-0.5">{l.personas.map((p) => (
                    <li key={p.id} className="flex items-center gap-1.5 text-[12.5px] min-w-0" title={`${p.email || "sin correo"} · ${CODIGO[p.codigo].dice}`}>
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CODIGO[p.codigo].punto)} />
                        <span className="truncate">{p.nombre}</span><span className="shrink-0 text-[11px] text-muted-foreground">{VINCULO[p.vinculo] || p.vinculo}</span>
                    </li>))}</ul>) },
        { clave: "situacion", titulo: "Situación", ancho: 150, valor: (l) => (l.situacion ? SITUACION[l.situacion]?.rotulo || l.situacion : ""), celda: (l) => (l.situacion && SITUACION[l.situacion] ? <Chip tono={SITUACION[l.situacion].tono}>{SITUACION[l.situacion].rotulo}</Chip> : null) },
        { clave: "area", titulo: "Área", ancho: 100, alinear: "der", ordenable: true, valor: (l) => l.areaM2 ?? "", celda: (l) => (l.areaM2 ? <span className="text-[12px] tabular-nums text-muted-foreground">{Math.round(l.areaM2).toLocaleString("es-UY")} m²</span> : null) },
    ], []);
    const OPC: { v: FiltroLotes; r: string }[] = [{ v: "todos", r: "Todos" }, { v: "gente", r: "Con gente" }, { v: "sin", r: "Sin nadie con correo" }, { v: "terrenos", r: "Terrenos" }];
    return (
        <Tabla filas={vistos} cargando={!filas} clave={(l) => l.id} columnas={cols} alto="calc(100vh - 260px)" nombreArchivo="lotes" alClickFila={(l) => alAbrir(l.id)}
            barra={(
                <div className="flex flex-wrap items-center gap-2">
                    <Seek value={q} onChange={setQ} placeholder="Lote, titular o persona" startOpen width={240} alto={34} />
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué lotes">
                        {OPC.map((o) => (
                            <button key={o.v} type="button" aria-pressed={filtro === o.v} onClick={() => setFiltro(o.v)}
                                className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold inline-flex items-center gap-1.5", filtro === o.v ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>
                                {o.r}<span className={cn("tabular-nums text-[10.5px]", filtro === o.v ? "opacity-70" : "text-muted-foreground")}>{n[o.v]}</span>
                            </button>))}
                    </div>
                </div>)}
            vacio={{ icono: MapPinned, titulo: todos.length ? "Ningún lote coincide" : "Esta administración no tiene lotes", ayuda: todos.length ? "Probá con otro filtro o con menos texto." : "Los lotes llegan con la planilla del padrón: «Importar padrón», arriba." }} />
    );
}


/**
 * Alta y cambio de una administración, en un cajón (25/11, Nico: «Nueva administración debe ser un
 * drawer estilizado, no un modal»).
 *
 * La sigla se ve como va a quedar en el nombre de un lote («A 2 (4-5)») mientras se escribe, porque
 * es lo único de este formulario que después no se puede cambiar con lotes cargados: conviene verla
 * puesta antes de guardar. Vacía, sale del nombre, y también se muestra cuál saldría.
 */
function FormAdministracion({ a, alCerrar, alGuardar }: { a: Partial<ResumenAdministracion>; alCerrar: () => void; alGuardar: (id?: string) => void }) {
    const [f, setF] = useState({ nombre: a.nombre || "", sigla: a.sigla || "", notas: a.notas || "" });
    const [guardando, setGuardando] = useState(false);
    const conLotes = !!a.id && (a.lotes || 0) > 0;
    const sigla = f.sigla.trim() || (f.nombre.trim() ? siglaDeEtapa(f.nombre) : "");
    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await guardarAdministracion({ id: a.id, ...f });
            if (!r.ok) toast.error({ title: "No se guardó", description: r.error });
            else { toast.success({ title: a.id ? "Administración guardada" : "Administración creada", description: a.id ? undefined : "Ahora cargale a quién se llama y su casilla de correo." }); alGuardar(r.id); }
        } catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };
    return (
        <Cajon open onOpenChange={(x) => { if (!x && !guardando) alCerrar(); }}>
            <CajonContenido ancho="angosto" titulo={a.id ? `Editar ${a.nombre}` : "Nueva administración"} descripcion="Una comisión del complejo, con su grupo de lotes."
                pie={<>
                    <Button variant="ghost" onClick={alCerrar} disabled={guardando}>Cancelar</Button>
                    <Button onClick={guardar} disabled={guardando || !f.nombre.trim()}>{guardando ? <Loader2 size={14} /> : a.id ? <CheckCircle2 size={14} /> : <Plus size={14} />} {a.id ? "Guardar" : "Crear administración"}</Button>
                </>}>
                {/* Cómo se va a ver: la ficha de la columna, armándose mientras se escribe. */}
                <div className="px-6 pt-6">
                    <div className="flex items-center gap-3 rounded-[12px] border border-border bg-card px-4 py-3.5">
                        <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-[10px] text-[15px] font-bold tabular-nums tracking-tight transition-colors", sigla ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}>{sigla || "?"}</span>
                        <div className="min-w-0 leading-tight">
                            <p className="text-[15px] font-bold truncate">{f.nombre.trim() || "Sin nombre todavía"}</p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">Sus lotes se llaman <span className="font-semibold text-foreground tabular-nums">{nombreDeLote("A 2", sigla || "…")}</span></p>
                        </div>
                    </div>
                </div>
                <CajonSeccion titulo="Cómo se llama" icono={Building2}>
                    <CajonCampo etiqueta="Nombre" ayuda="Como le dicen en el complejo: «Etapas 4 y 5», «6ª Etapa».">
                        <input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Etapas 4 y 5" className={ENTRADA} />
                    </CajonCampo>
                    <CajonCampo etiqueta="Sigla" ayuda={conLotes ? "Tiene lotes cargados: la sigla es parte del nombre de cada uno y no se puede cambiar." : f.sigla.trim() ? "Lo que va entre paréntesis en el nombre de cada lote." : sigla ? `Vacía, sale del nombre: «${sigla}».` : "Vacía, sale del nombre."}
                        pista="La administración la pone entre paréntesis después del lote: «A 2 (4-5)». Con ella se reconoce a qué comisión pertenece cada lote cuando se importa el padrón.">
                        <input value={f.sigla} onChange={(e) => setF({ ...f, sigla: e.target.value })} placeholder={f.nombre.trim() ? siglaDeEtapa(f.nombre) : "4-5"} disabled={conLotes} className={cn(ENTRADA, "w-32 tabular-nums disabled:opacity-60")} />
                    </CajonCampo>
                </CajonSeccion>
                <CajonSeccion titulo="Lo que conviene saber" icono={NotebookPen}>
                    <CajonCampo etiqueta="Notas" ayuda="Cuándo se reúne, cómo prefiere que le avisen, quién decide qué.">
                        <textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} rows={4} className={cn(ENTRADA, "h-auto py-2 leading-snug")} />
                    </CajonCampo>
                </CajonSeccion>
                {a.id ? (
                    <CajonSeccion titulo="Lo que tiene" icono={MapPinned}>
                        <div className="grid grid-cols-2 gap-2">
                            <Cifra n={a.lotes || 0} k="lotes" /><Cifra n={a.personas || 0} k="personas" />
                            <Cifra n={a.contactos || 0} k="contactos" /><Cifra n={a.servicios || 0} k="servicios" />
                        </div>
                        {conLotes
                            ? <p className="text-[11.5px] text-muted-foreground">Con lotes adentro no se puede borrar: quedarían sin administración. Los lotes se mueven con el padrón.</p>
                            : <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-border px-3.5 py-3"><p className="flex-1 text-[12px] text-muted-foreground">No tiene lotes: se puede borrar, con sus contactos y servicios.</p>
                                <div className="scale-[.8] origin-right -my-2"><DeleteButton onConfirm={async () => { const r = await borrarAdministracion(a.id!); if (!r.ok) toast.error({ title: "No se borró", description: r.error }); else alGuardar(); }} /></div></div>}
                    </CajonSeccion>
                ) : (
                    <CajonSeccion titulo="Lo que sigue" icono={Sparkles}>
                        <ol className="space-y-2.5 text-[12.5px]">
                            {[["A quién se llama", "el referente o la administradora, en Contactos."], ["Su casilla de correo", "el Gmail desde el que les escribe a sus lotes, en Correo."], ["Sus lotes", "llegan con la planilla del padrón («Importar padrón»)."]].map(([t, d], k) => (
                                <li key={t} className="flex gap-2.5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[10.5px] font-bold tabular-nums">{k + 1}</span><span><b>{t}</b>: <span className="text-muted-foreground">{d}</span></span></li>))}
                        </ol>
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}

const ROLES = ["Administradora", "Administrador", "Presidente de la comisión", "Secretaria de la comisión", "Tesorero", "Referente de seguridad", "Referente"];
function FormContacto({ administracionId, nombreAdm, c, alCerrar, alGuardar }: { administracionId: string; nombreAdm: string; c: Partial<ContactoAdm>; alCerrar: () => void; alGuardar: () => void }) {
    const [f, setF] = useState({ nombre: c.nombre || "", rol: c.rol || "", telefono: c.telefono || "", email: c.email || "", notas: c.notas || "" });
    const [guardando, setGuardando] = useState(false);
    const guardar = async () => {
        setGuardando(true);
        try { const r = await guardarContactoAdm(administracionId, { id: c.id, ...f }); if (!r.ok) toast.error({ title: "No se guardó", description: r.error }); else alGuardar(); }
        catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };
    return (
        <Cajon open onOpenChange={(x) => { if (!x && !guardando) alCerrar(); }}>
            <CajonContenido ancho="angosto" titulo={c.id ? "Editar el contacto" : "Agregar un contacto"} descripcion={`Alguien de ${nombreAdm || "la administración"} a quien se puede llamar.`}
                pie={<><Button variant="ghost" onClick={alCerrar} disabled={guardando}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !f.nombre.trim()}>{guardando ? <Loader2 size={14} /> : <CheckCircle2 size={14} />} Guardar</Button></>}>
                <CajonSeccion titulo="Quién es" icono={UserRound}>
                    <CajonCampo etiqueta="Nombre"><input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className={ENTRADA} /></CajonCampo>
                    <CajonCampo etiqueta="Qué es" ayuda="El primero de la lista es el que se muestra como referente.">
                        <input value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })} placeholder="Administradora, presidente de la comisión…" className={ENTRADA} />
                    </CajonCampo>
                    {/* Los roles de siempre a un toque: tipear «Presidente de la comisión» cada vez es como se terminan escribiendo de cinco formas. */}
                    <div className="flex flex-wrap gap-1.5 -mt-1">
                        {ROLES.map((r) => (
                            <button key={r} type="button" onClick={() => setF({ ...f, rol: r })} aria-pressed={f.rol === r}
                                className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", f.rol === r ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>{r}</button>))}
                    </div>
                </CajonSeccion>
                <CajonSeccion titulo="Cómo se lo ubica" icono={Phone}>
                    <CajonCampo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" placeholder="099 123 456" className={cn(ENTRADA, "tabular-nums")} /></CajonCampo>
                    <CajonCampo etiqueta="Correo"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} inputMode="email" className={ENTRADA} /></CajonCampo>
                    <CajonCampo etiqueta="Notas"><textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} rows={3} placeholder="Horario en que atiende, por dónde prefiere que le avisen…" className={cn(ENTRADA, "h-auto py-2 leading-snug")} /></CajonCampo>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}

const RUBROS = ["Jardinería", "Recolección de residuos", "Mantenimiento", "Piscinas", "Seguridad", "Limpieza", "Iluminación", "Caminería", "Fumigación"];
function FormServicio({ administracionId, nombreAdm, s, alCerrar, alGuardar }: { administracionId: string; nombreAdm: string; s: Partial<ServicioAdm>; alCerrar: () => void; alGuardar: () => void }) {
    const [f, setF] = useState({ rubro: s.rubro || "", proveedor: s.proveedor || "", contacto: s.contacto || "", telefono: s.telefono || "", email: s.email || "", horario: s.horario || "", notas: s.notas || "" });
    const [guardando, setGuardando] = useState(false);
    const guardar = async () => {
        setGuardando(true);
        try { const r = await guardarServicioAdm(administracionId, { id: s.id, ...f }); if (!r.ok) toast.error({ title: "No se guardó", description: r.error }); else alGuardar(); }
        catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };
    return (
        <Cajon open onOpenChange={(x) => { if (!x && !guardando) alCerrar(); }}>
            <CajonContenido ancho="angosto" titulo={s.id ? "Editar el servicio" : "Agregar un servicio"} descripcion={`Algo que contrata ${nombreAdm || "esta administración"} para sus lotes o sus áreas comunes.`}
                pie={<><Button variant="ghost" onClick={alCerrar} disabled={guardando}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !f.rubro.trim()}>{guardando ? <Loader2 size={14} /> : <CheckCircle2 size={14} />} Guardar</Button></>}>
                <CajonSeccion titulo="Qué servicio" icono={Truck}>
                    <CajonCampo etiqueta="Servicio"><input autoFocus value={f.rubro} onChange={(e) => setF({ ...f, rubro: e.target.value })} placeholder="Jardinería, recolección, mantenimiento…" className={ENTRADA} /></CajonCampo>
                    <div className="flex flex-wrap gap-1.5 -mt-1">
                        {RUBROS.map((r) => (
                            <button key={r} type="button" onClick={() => setF({ ...f, rubro: r })} aria-pressed={f.rubro === r}
                                className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", f.rubro === r ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>{r}</button>))}
                    </div>
                    <CajonCampo etiqueta="Cuándo viene" ayuda="Para que la guardia sepa a quién espera y cuándo."><input value={f.horario} onChange={(e) => setF({ ...f, horario: e.target.value })} placeholder="Lunes y jueves, de 8 a 12" className={ENTRADA} /></CajonCampo>
                </CajonSeccion>
                <CajonSeccion titulo="Quién lo hace" icono={Building2}>
                    <CajonCampo etiqueta="Empresa"><input value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} className={ENTRADA} /></CajonCampo>
                    <CajonCampo etiqueta="Persona de contacto"><input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} className={ENTRADA} /></CajonCampo>
                    <div className="grid grid-cols-2 gap-3">
                        <CajonCampo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" className={cn(ENTRADA, "tabular-nums")} /></CajonCampo>
                        <CajonCampo etiqueta="Correo"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} inputMode="email" className={ENTRADA} /></CajonCampo>
                    </div>
                    <CajonCampo etiqueta="Notas"><textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} rows={3} className={cn(ENTRADA, "h-auto py-2 leading-snug")} /></CajonCampo>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}

/**
 * La planilla del padrón, en dos tiempos: primero qué haría (sin tocar nada), después aplicar.
 * Con cuatrocientas familias adentro, «subir y listo» no es una opción: se mira el informe antes.
 */
function ImportarPadron({ alCerrar, alAplicar }: { alCerrar: () => void; alAplicar: () => void }) {
    const [archivo, setArchivo] = useState<File | null>(null);
    const [informe, setInforme] = useState<InformePadron | null>(null);
    const [trabajando, setTrabajando] = useState<"simulacro" | "aplicar" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const entrada = useRef<HTMLInputElement>(null);

    const mandar = async (f: File, aplicar: boolean) => {
        setTrabajando(aplicar ? "aplicar" : "simulacro"); setError(null);
        try {
            const cuerpo = new FormData(); cuerpo.append("archivo", f); if (aplicar) cuerpo.append("aplicar", "1");
            const r = await fetch("/api/administraciones/padron", { method: "POST", body: cuerpo });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { setError(j?.error || "No se pudo leer la planilla."); return; }
            setInforme(j);
            if (aplicar) { toast.success({ title: "Padrón cargado", description: `${j.lotes.nuevos} lotes nuevos, ${j.personas.nuevas} personas nuevas, ${j.invitaciones.nuevas} códigos nuevos. No se mandó ningún correo.` }); alAplicar(); }
        } catch { setError("No se pudo subir la planilla."); }
        finally { setTrabajando(null); }
    };
    const i = informe;
    const hayCambios = !!i && (i.administraciones.nuevas + i.lotes.nuevos + i.lotes.actualizados + i.personas.nuevas + i.personas.completadas + i.vinculos.nuevos + i.vinculos.cambiados + i.invitaciones.nuevas + i.invitaciones.actualizadas) > 0;
    return (
        <Dialog open onOpenChange={(x) => { if (!x && !trabajando) alCerrar(); }}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Importar el padrón</DialogTitle>
                    <DialogDescription>La planilla de la administración, con las hojas «Buscar lote» y «Envío de códigos». Crea lo que falta y actualiza lo que cambió. No borra nada y no manda correos.</DialogDescription>
                </DialogHeader>
                <input ref={entrada} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0] || null; setArchivo(f); setInforme(null); if (f) mandar(f, false); e.target.value = ""; }} />
                {!archivo ? (
                    <button type="button" onClick={() => entrada.current?.click()} className="w-full rounded-[10px] border border-dashed border-border px-6 py-10 text-center hover:bg-accent/50">
                        <Upload size={22} className="mx-auto text-muted-foreground" />
                        <p className="mt-2 text-[13px] font-semibold">Elegir la planilla (.xlsx)</p>
                        <p className="text-[12px] text-muted-foreground">Primero se muestra qué haría. Nada se toca hasta que lo confirmes.</p>
                    </button>
                ) : trabajando === "simulacro" ? (
                    <p className="py-10 text-center text-[13px] text-muted-foreground inline-flex w-full items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" /> Leyendo {archivo.name}…</p>
                ) : error ? (
                    <ErrorEstado titulo="No se pudo leer" mensaje={error} alReintentar={() => entrada.current?.click()} />
                ) : i && (
                    <div className="max-h-[60vh] overflow-y-auto [scrollbar-width:thin] pr-1 space-y-4">
                        <p className={cn("rounded-[10px] px-3.5 py-2.5 text-[12.5px] font-semibold inline-flex w-full items-center gap-2", i.simulacro ? "chip-info border" : "chip-bien border")}>
                            {i.simulacro ? <>Esto es lo que HARÍA con {archivo.name}. Todavía no se tocó nada.</> : <><CheckCircle2 size={15} /> Aplicado. Las invitaciones quedaron listas en el Censo, sin enviar.</>}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <Cifra n={i.lotes.nuevos} k="lotes nuevos" extra={`${i.lotes.actualizados} actualizados · ${i.lotes.iguales} iguales`} />
                            <Cifra n={i.personas.nuevas} k="personas nuevas" extra={`${i.personas.reconocidas} ya estaban`} />
                            <Cifra n={i.vinculos.nuevos} k="persona ↔ lote" extra={i.vinculos.cambiados ? `${i.vinculos.cambiados} cambiaron` : "vínculos nuevos"} />
                            <Cifra n={i.invitaciones.nuevas} k="códigos nuevos" extra={`${i.invitaciones.actualizadas} actualizados · ${i.invitaciones.iguales} iguales`} />
                        </div>
                        <table className="w-full text-[12.5px]">
                            <thead><tr className="text-left text-[11px] text-muted-foreground"><th className="py-1 font-semibold">Administración</th><th className="py-1 font-semibold text-right">Lotes</th><th className="py-1 font-semibold text-right">Terrenos</th><th className="py-1 font-semibold text-right">Lotes con gente</th><th className="py-1 font-semibold text-right">Personas</th></tr></thead>
                            <tbody>{i.porAdministracion.map((a) => (
                                <tr key={a.sigla} className="border-t border-border tabular-nums"><td className="py-1.5 font-semibold">{a.nombre}</td><td className="py-1.5 text-right">{a.lotes}</td><td className="py-1.5 text-right">{a.terrenos}</td><td className="py-1.5 text-right">{a.conPersonas}</td><td className="py-1.5 text-right">{a.personas}</td></tr>))}</tbody>
                        </table>
                        {i.lotes.adoptados.length > 0 && <Lista titulo={`Lotes que ya estaban cargados y se reconocieron (${i.lotes.adoptados.length})`} items={i.lotes.adoptados} />}
                        {(i.fueraDeLaPlanilla.lotes.length > 0 || i.fueraDeLaPlanilla.invitaciones > 0) && (
                            <Lista tono="aviso" titulo="Están en el sistema y no en esta planilla (no se tocan)" items={[...i.fueraDeLaPlanilla.lotes.map((l) => `Lote ${l}`), ...(i.fueraDeLaPlanilla.invitaciones ? [`${i.fueraDeLaPlanilla.invitaciones} invitaciones del censo de correos que ya no figuran`] : [])]} />)}
                        {i.avisos.length > 0 && <Lista tono="aviso" titulo={`Para revisar (${i.avisos.length})`} items={i.avisos} />}
                    </div>
                )}
                <DialogFooter>
                    <Button variant="ghost" onClick={alCerrar} disabled={!!trabajando}>{i && !i.simulacro ? "Cerrar" : "Cancelar"}</Button>
                    {archivo && i?.simulacro && (
                        <>
                            <Button variant="outline" onClick={() => entrada.current?.click()} disabled={!!trabajando}>Otra planilla</Button>
                            <Button onClick={() => mandar(archivo, true)} disabled={!!trabajando || !hayCambios}>{trabajando === "aplicar" && <Loader2 size={14} className="animate-spin" />} {hayCambios ? "Aplicar" : "No hay nada que cambiar"}</Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const Cifra = ({ n, k, extra }: { n: number; k: string; extra?: string }) => (
    <div className="rounded-[10px] bg-muted/50 px-3 py-2.5"><div className="text-[22px] font-bold leading-none tabular-nums">{n}</div><div className="mt-1 text-[11.5px] font-semibold">{k}</div>{extra && <div className="text-[10.5px] text-muted-foreground">{extra}</div>}</div>
);
function Lista({ titulo, items, tono }: { titulo: string; items: string[]; tono?: "aviso" }) {
    return (
        <details className="rounded-[10px] border border-border" open={items.length <= 6}>
            <summary className={cn("cursor-pointer list-none px-3.5 py-2 text-[12.5px] font-semibold", tono === "aviso" && "tono-aviso")}>{titulo}</summary>
            <ul className="px-3.5 pb-2.5 space-y-1 text-[12px] text-muted-foreground">{items.slice(0, 200).map((x, k) => <li key={k}>{x}</li>)}{items.length > 200 && <li>… y {items.length - 200} más.</li>}</ul>
        </details>
    );
}
