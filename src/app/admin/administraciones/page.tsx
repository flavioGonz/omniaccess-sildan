"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, CheckCircle2, FileUp, History, Mail, MapPinned, Pencil, Phone, Plus, Truck, Upload, Users } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import {
    administraciones, borrarAdministracion, borrarContactoAdm, borrarServicioAdm, cambiosDeLotes, copiaDeLosCorreos, detalleAdministracion, guardarAdministracion, guardarContactoAdm, guardarServicioAdm,
    type CambioVisto, type ContactoAdm, type DetalleAdministracion, type LoteAdm, type ResumenAdministracion, type ServicioAdm,
} from "@/app/actions/administraciones";
import { CajonLote } from "@/components/lotes/CajonLote";
import { CorreoAdministracion } from "@/components/administraciones/CorreoAdministracion";
import { HistorialLote } from "@/components/lotes/HistorialLote";
import type { InformePadron } from "@/lib/padron-importar";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Cargando, Chip, ErrorEstado, Vacio } from "@/components/ui/estados";
import { Pestanias } from "@/components/ui/pestanias";
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
 * ¿de quién depende, y a quién se llama? Por eso arriba van las administraciones con su referente
 * a la vista, y de cada una tres cosas: su GENTE (a quién llamar), lo que CONTRATA (quién entra a
 * trabajar y cuándo) y sus LOTES (qué casas son, quién vive, y cómo va el censo).
 *
 * Los lotes no se cargan a mano: llegan con la planilla del padrón («Importar padrón»), que se
 * puede volver a subir cada vez que la administración manda una versión nueva. Primero muestra qué
 * haría; recién después aplica. No borra nada y no manda correos.
 */

type Pest = "contactos" | "servicios" | "lotes" | "cambios" | "correo";
type FiltroLotes = "todos" | "gente" | "sin" | "terrenos";
const SITUACION: Record<string, { rotulo: string; tono: "quieto" | "info" | "aviso" }> = {
    TERRENO: { rotulo: "Terreno", tono: "quieto" }, DESARROLLADOR: { rotulo: "Del desarrollador", tono: "info" }, SIN_TITULAR: { rotulo: "Sin titular", tono: "aviso" },
};
const VINCULO: Record<string, string> = { PROPIETARIO: "propietario", INQUILINO: "inquilino", OCUPANTE: "ocupante", FAMILIA: "familia" };
const CODIGO: Record<string, { punto: string; dice: string }> = {
    sin: { punto: "bg-muted-foreground/40", dice: "sin código del censo" }, listo: { punto: "bg-[var(--aviso)]", dice: "código listo, sin enviar" },
    enviado: { punto: "bg-[var(--info)]", dice: "código enviado" }, cargo: { punto: "bg-[var(--bien)]", dice: "ya cargó su censo" },
};
const ENTRADA = "h-9 w-full px-3 rounded-[6px] border border-border bg-background text-[13px]";

export default function Administraciones() {
    const [lista, setLista] = useState<ResumenAdministracion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sel, setSel] = useState<string | null>(null);
    const [det, setDet] = useState<DetalleAdministracion | null>(null);
    const [pest, setPest] = useState<Pest>("contactos");
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

    return (
        <div className="p-6 max-w-[1500px] mx-auto">
            <div className="flex flex-wrap items-end gap-3 mb-5">
                <div className="min-w-0 flex-1">
                    <h1 className="text-[22px] font-bold tracking-tight">Administraciones</h1>
                    <p className="text-[13px] text-muted-foreground">Las comisiones del complejo: a quién se llama, qué contrata cada una y cuáles son sus lotes.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setImportando(true)}><FileUp size={14} /> Importar padrón</Button>
                <Button size="sm" onClick={() => setEditAdm({})}><Plus size={14} /> Nueva administración</Button>
            </div>

            {error ? <ErrorEstado mensaje={error} alReintentar={refrescar} />
                : !lista ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[150px] rounded-[10px] bg-card animate-pulse" />)}</div>
                    : lista.length === 0 ? (
                        <div className="rounded-[10px] border border-dashed border-border">
                            <Vacio icono={Building2} titulo="Todavía no hay ninguna administración"
                                ayuda="Subí la planilla del padrón y se crean solas, con sus lotes y su gente. O creá una a mano y cargale sus contactos."
                                accion={<Button size="sm" onClick={() => setImportando(true)}><FileUp size={14} /> Importar padrón</Button>} />
                        </div>
                    ) : (
                        <>
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="Administraciones">
                                {lista.map((a) => <Tarjeta key={a.id} a={a} activa={a.id === sel} alElegir={() => setSel(a.id)} alEditar={() => setEditAdm(a)} />)}
                            </div>

                            {elegida && (
                                <section className="mt-5" aria-label={elegida.nombre}>
                                    <div className="flex flex-wrap items-center gap-3 mb-3">
                                        <Pestanias<Pest> valor={pest} alElegir={setPest} opciones={[
                                            { valor: "contactos", rotulo: "Contactos", icono: Users, cuenta: elegida.contactos },
                                            { valor: "servicios", rotulo: "Servicios", icono: Truck, cuenta: elegida.servicios },
                                            { valor: "lotes", rotulo: "Lotes", icono: MapPinned, cuenta: elegida.lotes },
                                            { valor: "cambios", rotulo: "Cambios", icono: History, ayuda: "Lo último que cambió en los lotes de esta administración: matrículas que entran o salen, gente que se suma o se va, y lo que cargan en el censo." },
                                            { valor: "correo", rotulo: "Correo", icono: Mail, tono: elegida.correo.cuenta && elegida.correo.conClave && !elegida.correo.error ? undefined : "aviso", ayuda: "La casilla de Gmail desde la que esta administración les escribe a sus lotes." },
                                        ]} />
                                        <div className="ml-auto">
                                            {pest === "contactos" && <Button size="sm" variant="outline" onClick={() => setEditContacto({})}><Plus size={14} /> Agregar contacto</Button>}
                                            {pest === "servicios" && <Button size="sm" variant="outline" onClick={() => setEditServicio({})}><Plus size={14} /> Agregar servicio</Button>}
                                        </div>
                                    </div>
                                    {elegida.notas && pest !== "lotes" && pest !== "cambios" && <p className="mb-3 rounded-[10px] bg-muted/50 px-3.5 py-2.5 text-[12.5px] text-muted-foreground whitespace-pre-line">{elegida.notas}</p>}
                                    {pest === "contactos" && <Contactos filas={cargandoDetalle ? null : det?.contactos || []} alEditar={setEditContacto} alBorrar={async (id) => { await borrarContactoAdm(id); refrescar(); }} />}
                                    {pest === "servicios" && <Servicios filas={cargandoDetalle ? null : det?.servicios || []} alEditar={setEditServicio} alBorrar={async (id) => { await borrarServicioAdm(id); refrescar(); }} />}
                                    {pest === "lotes" && <Lotes filas={cargandoDetalle ? null : det?.lotes || []} alAbrir={setLoteAbierto} />}
                                    {pest === "cambios" && <Cambios administracionId={elegida.id} vuelta={vuelta} alAbrirLote={setLoteAbierto} />}
                                    {pest === "correo" && <CorreoAdministracion key={elegida.id} id={elegida.id} nombre={elegida.nombre} correo={elegida.correo} copia={copia} alCambiar={refrescar} />}
                                </section>
                            )}
                        </>
                    )}

            {editAdm && <FormAdministracion a={editAdm} alCerrar={() => setEditAdm(null)} alGuardar={(id) => { setEditAdm(null); if (id) setSel(id); refrescar(); }} />}
            {editContacto && sel && <FormContacto administracionId={sel} c={editContacto} alCerrar={() => setEditContacto(null)} alGuardar={() => { setEditContacto(null); refrescar(); }} />}
            {editServicio && sel && <FormServicio administracionId={sel} s={editServicio} alCerrar={() => setEditServicio(null)} alGuardar={() => { setEditServicio(null); refrescar(); }} />}
            {importando && <ImportarPadron alCerrar={() => setImportando(false)} alAplicar={refrescar} />}
            <CajonLote unitId={loteAbierto} alCerrar={() => { setLoteAbierto(null); refrescar(); }} />
        </div>
    );
}

/** Una administración, de un vistazo: cuántos lotes, cuánta gente, cómo va el censo y a quién llamar. */
function Tarjeta({ a, activa, alElegir, alEditar }: { a: ResumenAdministracion; activa: boolean; alElegir: () => void; alEditar: () => void }) {
    const pct = (n: number) => (a.conCodigo ? Math.round((n / a.conCodigo) * 100) : 0);
    return (
        <div role="tab" aria-selected={activa} tabIndex={0} onClick={alElegir} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alElegir(); } }}
            className={cn("group relative cursor-pointer rounded-[10px] border p-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]",
                activa ? "border-[var(--accion)] bg-card" : "border-border bg-card/40 hover:bg-card")}>
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Administración · {a.sigla}</p>
                    <h2 className="text-[16px] font-bold tracking-tight truncate">{a.nombre}</h2>
                </div>
                <button type="button" onClick={(e) => { e.stopPropagation(); alEditar(); }} aria-label={`Editar ${a.nombre}`}
                    className="h-7 w-7 grid place-items-center rounded-[6px] text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent"><Pencil size={13} /></button>
            </div>
            <dl className="mt-3 flex items-baseline gap-5">
                <div><dd className="text-[24px] font-bold leading-none tabular-nums">{a.lotes}</dd><dt className="mt-1 text-[11px] text-muted-foreground">lotes</dt></div>
                <div><dd className="text-[24px] font-bold leading-none tabular-nums">{a.personas}</dd><dt className="mt-1 text-[11px] text-muted-foreground">personas</dt></div>
                {a.terrenos > 0 && <div><dd className="text-[24px] font-bold leading-none tabular-nums text-muted-foreground">{a.terrenos}</dd><dt className="mt-1 text-[11px] text-muted-foreground">terrenos</dt></div>}
            </dl>
            {/* El censo de esta administración: de los que tienen código, a cuántos se les mandó y cuántos ya cargaron. */}
            {a.conCodigo > 0 && (
                <div className="mt-3" title={`${a.conCodigo} con código · ${a.enviados} enviados · ${a.cargaron} ya cargaron`}>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                        <span className="h-full bg-[var(--bien)]" style={{ width: `${pct(a.cargaron)}%` }} />
                        <span className="h-full bg-[var(--info)]" style={{ width: `${pct(Math.max(0, a.enviados - a.cargaron))}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">Censo: {a.cargaron} cargaron · {a.enviados} enviados · {a.conCodigo - a.enviados} sin enviar</p>
                </div>
            )}
            {/* Desde qué casilla les escribe a sus lotes. */}
            <p className={cn("mt-3 flex items-center gap-1.5 text-[11.5px] truncate", a.correo.cuenta && a.correo.conClave && !a.correo.error ? "text-muted-foreground" : "tono-aviso")}>
                <Mail size={12} className="shrink-0" />
                <span className="truncate">{!a.correo.cuenta ? "Sin cuenta de correo" : !a.correo.conClave ? `${a.correo.cuenta} · falta la clave` : a.correo.error ? `${a.correo.cuenta} · Gmail no la acepta` : a.correo.cuenta}</span>
                {a.correo.cuenta && a.correo.conClave && !a.correo.error && a.correo.probadoAt && <CheckCircle2 size={12} className="tono-bien shrink-0" />}
            </p>
            <p className="mt-2 border-t border-border pt-2.5 text-[12px] truncate">
                {a.referente
                    ? <><span className="font-semibold">{a.referente.nombre}</span>{a.referente.rol && <span className="text-muted-foreground"> · {a.referente.rol}</span>}{a.referente.telefono && <span className="text-muted-foreground tabular-nums"> · {a.referente.telefono}</span>}</>
                    : <span className="text-muted-foreground">Sin contactos cargados todavía</span>}
            </p>
        </div>
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

function Lotes({ filas, alAbrir }: { filas: LoteAdm[] | null; alAbrir: (id: string) => void }) {
    const [q, setQ] = useState("");
    const [filtro, setFiltro] = useState<FiltroLotes>("todos");
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
        <Tabla filas={vistos} cargando={!filas} clave={(l) => l.id} columnas={cols} alto="calc(100vh - 430px)" nombreArchivo="lotes" alClickFila={(l) => alAbrir(l.id)}
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

function Campo({ rotulo, ayuda, children }: { rotulo: string; ayuda?: string; children: React.ReactNode }) {
    return <label className="block"><span className="block text-[12px] font-semibold mb-1">{rotulo}</span>{children}{ayuda && <span className="block mt-1 text-[11px] text-muted-foreground">{ayuda}</span>}</label>;
}

function FormAdministracion({ a, alCerrar, alGuardar }: { a: Partial<ResumenAdministracion>; alCerrar: () => void; alGuardar: (id?: string) => void }) {
    const [f, setF] = useState({ nombre: a.nombre || "", sigla: a.sigla || "", notas: a.notas || "" });
    const [guardando, setGuardando] = useState(false);
    const guardar = async () => {
        setGuardando(true);
        try { const r = await guardarAdministracion({ id: a.id, ...f }); if (!r.ok) toast.error({ title: "No se guardó", description: r.error }); else alGuardar(r.id); }
        catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };
    return (
        <Dialog open onOpenChange={(x) => { if (!x) alCerrar(); }}>
            <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>{a.id ? "Editar la administración" : "Nueva administración"}</DialogTitle><DialogDescription>Una comisión del complejo, con su grupo de lotes.</DialogDescription></DialogHeader>
                <div className="space-y-3">
                    <Campo rotulo="Nombre" ayuda="Como le dicen: «Etapas 4 y 5», «6ª Etapa»."><input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className={ENTRADA} /></Campo>
                    <Campo rotulo="Sigla" ayuda="Lo que va entre paréntesis en el nombre de cada lote: «A 2 (4-5)». Vacía, sale del nombre. Con lotes cargados no se puede cambiar.">
                        <input value={f.sigla} onChange={(e) => setF({ ...f, sigla: e.target.value })} placeholder="4-5" className={cn(ENTRADA, "w-28")} /></Campo>
                    <Campo rotulo="Notas" ayuda="Lo que conviene saber de esta comisión: cuándo se reúne, cómo prefiere que le avisen.">
                        <textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} rows={3} className={cn(ENTRADA, "h-auto py-2")} /></Campo>
                </div>
                <DialogFooter className="items-center">
                    {a.id && a.lotes === 0 && <div className="mr-auto"><DeleteButton onConfirm={async () => { const r = await borrarAdministracion(a.id!); if (!r.ok) toast.error({ title: "No se borró", description: r.error }); else alGuardar(); }} /></div>}
                    <Button variant="ghost" onClick={alCerrar}>Cancelar</Button>
                    <Button onClick={guardar} disabled={guardando || !f.nombre.trim()}>{guardando && <Loader2 size={14} className="animate-spin" />} Guardar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function FormContacto({ administracionId, c, alCerrar, alGuardar }: { administracionId: string; c: Partial<ContactoAdm>; alCerrar: () => void; alGuardar: () => void }) {
    const [f, setF] = useState({ nombre: c.nombre || "", rol: c.rol || "", telefono: c.telefono || "", email: c.email || "", notas: c.notas || "" });
    const [guardando, setGuardando] = useState(false);
    const guardar = async () => {
        setGuardando(true);
        try { const r = await guardarContactoAdm(administracionId, { id: c.id, ...f }); if (!r.ok) toast.error({ title: "No se guardó", description: r.error }); else alGuardar(); }
        catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };
    return (
        <Dialog open onOpenChange={(x) => { if (!x) alCerrar(); }}>
            <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>{c.id ? "Editar el contacto" : "Agregar un contacto"}</DialogTitle><DialogDescription>Alguien de la administración o de la comisión a quien se puede llamar.</DialogDescription></DialogHeader>
                <div className="space-y-3">
                    <Campo rotulo="Nombre"><input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className={ENTRADA} /></Campo>
                    <Campo rotulo="Qué es"><input value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })} placeholder="Administradora, presidente de la comisión, referente…" className={ENTRADA} list="roles-adm" />
                        <datalist id="roles-adm">{["Administradora", "Administrador", "Presidente de la comisión", "Secretaria de la comisión", "Tesorero", "Referente de seguridad", "Referente"].map((r) => <option key={r} value={r} />)}</datalist></Campo>
                    <div className="grid grid-cols-2 gap-3">
                        <Campo rotulo="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" className={cn(ENTRADA, "tabular-nums")} /></Campo>
                        <Campo rotulo="Correo"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} inputMode="email" className={ENTRADA} /></Campo>
                    </div>
                    <Campo rotulo="Notas"><textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} rows={2} placeholder="Horario en que atiende, por dónde prefiere que le avisen…" className={cn(ENTRADA, "h-auto py-2")} /></Campo>
                </div>
                <DialogFooter><Button variant="ghost" onClick={alCerrar}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !f.nombre.trim()}>{guardando && <Loader2 size={14} className="animate-spin" />} Guardar</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function FormServicio({ administracionId, s, alCerrar, alGuardar }: { administracionId: string; s: Partial<ServicioAdm>; alCerrar: () => void; alGuardar: () => void }) {
    const [f, setF] = useState({ rubro: s.rubro || "", proveedor: s.proveedor || "", contacto: s.contacto || "", telefono: s.telefono || "", email: s.email || "", horario: s.horario || "", notas: s.notas || "" });
    const [guardando, setGuardando] = useState(false);
    const guardar = async () => {
        setGuardando(true);
        try { const r = await guardarServicioAdm(administracionId, { id: s.id, ...f }); if (!r.ok) toast.error({ title: "No se guardó", description: r.error }); else alGuardar(); }
        catch (e) { toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined }); }
        finally { setGuardando(false); }
    };
    return (
        <Dialog open onOpenChange={(x) => { if (!x) alCerrar(); }}>
            <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>{s.id ? "Editar el servicio" : "Agregar un servicio"}</DialogTitle><DialogDescription>Algo que contrata esta administración para sus lotes o sus áreas comunes.</DialogDescription></DialogHeader>
                <div className="space-y-3">
                    <Campo rotulo="Servicio"><input autoFocus value={f.rubro} onChange={(e) => setF({ ...f, rubro: e.target.value })} placeholder="Jardinería, recolección, mantenimiento…" className={ENTRADA} list="rubros-adm" />
                        <datalist id="rubros-adm">{["Jardinería", "Recolección de residuos", "Mantenimiento", "Piscinas", "Seguridad", "Limpieza", "Iluminación", "Caminería", "Fumigación"].map((r) => <option key={r} value={r} />)}</datalist></Campo>
                    <div className="grid grid-cols-2 gap-3">
                        <Campo rotulo="Empresa"><input value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} className={ENTRADA} /></Campo>
                        <Campo rotulo="Persona de contacto"><input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} className={ENTRADA} /></Campo>
                        <Campo rotulo="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" className={cn(ENTRADA, "tabular-nums")} /></Campo>
                        <Campo rotulo="Correo"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} inputMode="email" className={ENTRADA} /></Campo>
                    </div>
                    <Campo rotulo="Cuándo viene"><input value={f.horario} onChange={(e) => setF({ ...f, horario: e.target.value })} placeholder="Lunes y jueves, de 8 a 12" className={ENTRADA} /></Campo>
                    <Campo rotulo="Notas"><textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} rows={2} className={cn(ENTRADA, "h-auto py-2")} /></Campo>
                </div>
                <DialogFooter><Button variant="ghost" onClick={alCerrar}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !f.rubro.trim()}>{guardando && <Loader2 size={14} className="animate-spin" />} Guardar</Button></DialogFooter>
            </DialogContent>
        </Dialog>
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
