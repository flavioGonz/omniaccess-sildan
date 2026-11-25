"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Search, UserPlus, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { DeleteButton } from "@/components/ui/delete-button";
import { Matricula } from "@/components/ui/celdas";
import {
    agregarMatriculaEnLote, buscarPersonasParaLote, editarDatosLote, editarPersonaDeLote, quitarMatriculaEnLote, quitarPersonaDeLote, sumarPersonaALote,
    type PersonaParaSumar, type Resultado,
} from "@/app/actions/lote-edicion";

/**
 * Las piezas para corregir un lote a mano desde su cajón (25/11). Nico: «desde el drawer del lote,
 * en administraciones, se debe poder editar a mano, y quedar en el historial el cambio».
 *
 * Todo se edita en el lugar, sin abrir otro diálogo encima del cajón: un cajón con un modal arriba
 * es la forma de perder de vista qué lote se estaba tocando. Cada corrección termina en un renglón
 * del historial, firmado, y eso se dice en el aviso de «Listo» para que se sepa que quedó anotado.
 */

const ENTRADA = "h-9 w-full px-3 rounded-[6px] border border-border bg-background text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40 focus-visible:border-[var(--accion)]";
const BOTON = "h-8 px-3 rounded-[6px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50";
const PRIMARIO = cn(BOTON, "bg-[var(--accion)] text-white hover:opacity-90");
const SECUNDARIO = cn(BOTON, "border border-border hover:bg-accent");
/** Lápiz de «editar» de un renglón: chico y callado hasta que se lo busca. */
const LAPIZ = "h-7 w-7 grid place-items-center rounded-[6px] text-muted-foreground hover:text-[var(--accion)] hover:bg-accent";

export const VINCULOS = [{ v: "PROPIETARIO", r: "Propietario" }, { v: "INQUILINO", r: "Inquilino" }, { v: "OCUPANTE", r: "Ocupante" }, { v: "FAMILIA", r: "Familia" }] as const;
const SITUACIONES = [{ v: "", r: "Con su gente" }, { v: "TERRENO", r: "Terreno" }, { v: "DESARROLLADOR", r: "Del desarrollador" }, { v: "SIN_TITULAR", r: "Sin titular" }] as const;

/** Corre una corrección y avisa. Devuelve si salió, para que quien llama cierre el formulario. */
async function correr(accion: () => Promise<Resultado>, listo: string): Promise<boolean> {
    try {
        const r = await accion();
        if (!r.ok) { toast.error({ title: "No se guardó", description: r.error }); return false; }
        toast.success({ title: listo, description: "Quedó anotado en el historial del lote." });
        return true;
    } catch (e) {
        toast.error({ title: "No se guardó", description: e instanceof Error ? e.message : undefined });
        return false;
    }
}

/** Una elección corta (qué es del lote, la situación): píldoras, porque es elegir, no accionar. */
function Eleccion<T extends string>({ opciones, valor, alCambiar }: { opciones: readonly { v: T; r: string }[]; valor: T; alCambiar: (v: T) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
            {opciones.map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={valor === o.v} onClick={() => alCambiar(o.v)}
                    className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", valor === o.v ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                    {o.r}
                </button>
            ))}
        </div>
    );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
    return <label className="block space-y-1"><span className="text-[11.5px] font-semibold text-muted-foreground">{etiqueta}</span>{children}</label>;
}

/* ───────── Los datos del lote ───────── */

export function DatosDelLote({ unitId, titular, situacion, puedeEditar, alCambiar }: {
    unitId: string; titular: string | null; situacion: string | null; puedeEditar: boolean; alCambiar: () => void;
}) {
    const [editando, setEditando] = useState(false);
    const [f, setF] = useState({ titular: titular || "", situacion: situacion || "" });
    const [guardando, setGuardando] = useState(false);
    const situ = SITUACIONES.find((x) => x.v === (situacion || ""))?.r || situacion;
    if (!editando) return (
        <div className="flex items-start gap-3">
            <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-muted-foreground">Titular</dt><dd className="font-semibold">{titular || <span className="font-normal text-muted-foreground">Sin cargar</span>}</dd>
                <dt className="text-muted-foreground">Situación</dt><dd>{situ}</dd>
            </dl>
            {puedeEditar && <button type="button" className={LAPIZ} aria-label="Corregir los datos del lote" title="Corregir" onClick={() => { setF({ titular: titular || "", situacion: situacion || "" }); setEditando(true); }}><Pencil size={14} /></button>}
        </div>
    );
    return (
        <div className="space-y-3 rounded-[10px] border border-border p-3">
            <Campo etiqueta="Titular según la administración"><input autoFocus value={f.titular} onChange={(e) => setF({ ...f, titular: e.target.value })} className={ENTRADA} /></Campo>
            <Campo etiqueta="Situación"><Eleccion opciones={SITUACIONES} valor={f.situacion as (typeof SITUACIONES)[number]["v"]} alCambiar={(v) => setF({ ...f, situacion: v })} /></Campo>
            <div className="flex justify-end gap-2">
                <button type="button" className={SECUNDARIO} onClick={() => setEditando(false)}>Cancelar</button>
                <button type="button" className={PRIMARIO} disabled={guardando} onClick={async () => {
                    setGuardando(true);
                    if (await correr(() => editarDatosLote(unitId, f), "Datos del lote corregidos")) { setEditando(false); alCambiar(); }
                    setGuardando(false);
                }}><Check size={14} />{guardando ? "Guardando…" : "Guardar"}</button>
            </div>
        </div>
    );
}

/* ───────── Una persona del lote ───────── */

/** El lápiz y el tacho de un renglón de persona. El formulario lo pone quien arma el renglón, al pie (ver EditarPersona). */
export function AccionesDePersona({ unitId, persona, alEditar, alCambiar }: {
    unitId: string; persona: { id: string; nombre: string }; alEditar: () => void; alCambiar: () => void;
}) {
    return (
        <span className="inline-flex items-center gap-0.5">
            <button type="button" className={LAPIZ} aria-label={`Corregir a ${persona.nombre}`} title="Corregir" onClick={alEditar}><Pencil size={13} /></button>
            <DeleteButton className="scale-[.72] -m-1.5" aria-label={`Sacar a ${persona.nombre} del lote`}
                onConfirm={async () => { if (await correr(() => quitarPersonaDeLote(unitId, persona.id), `${persona.nombre} salió del lote`)) alCambiar(); }} />
        </span>
    );
}

export function EditarPersona({ unitId, persona, alTerminar }: {
    unitId: string; persona: { id: string; nombre: string; email: string | null; telefono: string | null; vinculo: string | null }; alTerminar: (cambio: boolean) => void;
}) {
    const [f, setF] = useState({ nombre: persona.nombre, email: persona.email || "", telefono: persona.telefono || "", vinculo: persona.vinculo || "PROPIETARIO" });
    const [guardando, setGuardando] = useState(false);
    return (
        <div className="mt-2.5 space-y-3 rounded-[10px] border border-border bg-background p-3">
            <Campo etiqueta="Nombre"><input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className={ENTRADA} /></Campo>
            <div className="grid grid-cols-2 gap-2">
                <Campo etiqueta="Correo"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} inputMode="email" className={ENTRADA} /></Campo>
                <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" className={cn(ENTRADA, "tabular-nums")} /></Campo>
            </div>
            <Campo etiqueta="En el lote"><Eleccion opciones={VINCULOS} valor={f.vinculo as (typeof VINCULOS)[number]["v"]} alCambiar={(v) => setF({ ...f, vinculo: v })} /></Campo>
            <div className="flex justify-end gap-2">
                <button type="button" className={SECUNDARIO} onClick={() => alTerminar(false)}>Cancelar</button>
                <button type="button" className={PRIMARIO} disabled={guardando} onClick={async () => {
                    setGuardando(true);
                    const ok = await correr(() => editarPersonaDeLote(unitId, persona.id, f), `${f.nombre} corregida`);
                    setGuardando(false);
                    if (ok) alTerminar(true);
                }}><Check size={14} />{guardando ? "Guardando…" : "Guardar"}</button>
            </div>
        </div>
    );
}

/* ───────── Sumar una persona ───────── */

export function SumarPersona({ unitId, alCambiar }: { unitId: string; alCambiar: () => void }) {
    const [abierto, setAbierto] = useState(false);
    const [modo, setModo] = useState<"padron" | "nueva">("padron");
    const [q, setQ] = useState("");
    const [hallados, setHallados] = useState<PersonaParaSumar[] | null>(null);
    const [elegida, setElegida] = useState<PersonaParaSumar | null>(null);
    const [nueva, setNueva] = useState({ nombre: "", email: "", telefono: "" });
    const [vinculo, setVinculo] = useState<(typeof VINCULOS)[number]["v"]>("PROPIETARIO");
    const [guardando, setGuardando] = useState(false);

    /* Buscar mientras se escribe, con un respiro: no una consulta por tecla. */
    useEffect(() => {
        if (!abierto || modo !== "padron") return;
        const t = q.trim();
        let vivo = true;
        const h = setTimeout(() => {
            if (t.length < 2) { if (vivo) setHallados(null); return; }
            buscarPersonasParaLote(unitId, t).then((r) => { if (vivo) setHallados(r); }).catch(() => { if (vivo) setHallados([]); });
        }, 250);
        return () => { vivo = false; clearTimeout(h); };
    }, [q, abierto, modo, unitId]);

    const cerrar = () => { setAbierto(false); setQ(""); setHallados(null); setElegida(null); setNueva({ nombre: "", email: "", telefono: "" }); setVinculo("PROPIETARIO"); };
    if (!abierto) return <button type="button" className={cn(SECUNDARIO, "mt-2")} onClick={() => setAbierto(true)}><UserPlus size={14} />Sumar una persona</button>;
    const puede = modo === "padron" ? !!elegida : nueva.nombre.trim().length >= 2;
    return (
        <div className="mt-2 space-y-3 rounded-[10px] border border-border p-3">
            <Eleccion opciones={[{ v: "padron", r: "Alguien del padrón" }, { v: "nueva", r: "Una persona nueva" }] as const} valor={modo} alCambiar={(v) => { setModo(v); setElegida(null); }} />
            {modo === "padron" ? (
                elegida ? (
                    <div className="flex items-center gap-2 rounded-[6px] border border-[var(--accion)] px-3 py-2">
                        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{elegida.nombre}</p><p className="truncate text-[11.5px] text-muted-foreground">{[elegida.email, elegida.lotes && `en ${elegida.lotes}`].filter(Boolean).join(" · ") || "Sin correo ni lote"}</p></div>
                        <button type="button" className={LAPIZ} aria-label="Elegir otra" onClick={() => setElegida(null)}><X size={14} /></button>
                    </div>
                ) : (
                    <div>
                        <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, correo o teléfono" className={cn(ENTRADA, "pl-8")} /></div>
                        {hallados && (hallados.length === 0
                            ? <p className="mt-2 text-[12px] text-muted-foreground">Nadie del padrón coincide (fuera de este lote). Si es alguien nuevo, cargalo en «Una persona nueva».</p>
                            : <ul className="mt-2 divide-y divide-border rounded-[6px] border border-border">
                                {hallados.map((h) => (
                                    <li key={h.id}><button type="button" onClick={() => setElegida(h)} className="w-full px-3 py-2 text-left hover:bg-accent">
                                        <p className="truncate text-[13px] font-semibold">{h.nombre}</p>
                                        <p className="truncate text-[11.5px] text-muted-foreground">{[h.email, h.lotes && `en ${h.lotes}`].filter(Boolean).join(" · ") || "Sin correo ni lote"}</p>
                                    </button></li>
                                ))}
                            </ul>)}
                    </div>
                )
            ) : (
                <div className="space-y-2">
                    <Campo etiqueta="Nombre"><input autoFocus value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} className={ENTRADA} /></Campo>
                    <div className="grid grid-cols-2 gap-2">
                        <Campo etiqueta="Correo"><input value={nueva.email} onChange={(e) => setNueva({ ...nueva, email: e.target.value })} inputMode="email" className={ENTRADA} /></Campo>
                        <Campo etiqueta="Teléfono"><input value={nueva.telefono} onChange={(e) => setNueva({ ...nueva, telefono: e.target.value })} inputMode="tel" className={cn(ENTRADA, "tabular-nums")} /></Campo>
                    </div>
                </div>
            )}
            <Campo etiqueta="En el lote"><Eleccion opciones={VINCULOS} valor={vinculo} alCambiar={setVinculo} /></Campo>
            <div className="flex justify-end gap-2">
                <button type="button" className={SECUNDARIO} onClick={cerrar}>Cancelar</button>
                <button type="button" className={PRIMARIO} disabled={!puede || guardando} onClick={async () => {
                    setGuardando(true);
                    const ok = await correr(() => sumarPersonaALote(unitId, modo === "padron" ? { userId: elegida!.id, vinculo } : { nueva, vinculo }),
                        `${modo === "padron" ? elegida!.nombre : nueva.nombre.trim()} entró al lote`);
                    setGuardando(false);
                    if (ok) { cerrar(); alCambiar(); }
                }}><Check size={14} />{guardando ? "Sumando…" : "Sumar al lote"}</button>
            </div>
        </div>
    );
}

/* ───────── Las matrículas ───────── */

/** Las chapas de una persona, cada una con su cruz para quitarla (con confirmación en el lugar), y el «+» para sumar otra. */
export function MatriculasDePersona({ unitId, persona, puedeEditar, alCambiar }: {
    unitId: string; persona: { id: string; nombre: string; chapas: string[] }; puedeEditar: boolean; alCambiar: () => void;
}) {
    const [quitando, setQuitando] = useState<string | null>(null);
    const [sumando, setSumando] = useState(false);
    const [nueva, setNueva] = useState("");
    const [ocupado, setOcupado] = useState(false);
    return (
        <li className="flex flex-wrap items-center gap-1.5">
            {persona.chapas.map((c) => (
                quitando === c ? (
                    <span key={c} className="inline-flex items-center gap-1.5 rounded-[6px] border border-[color-mix(in_oklab,var(--mal)_45%,transparent)] px-2 py-1 text-[12px]">
                        ¿Quitar <b className="tabular-nums">{c}</b>?
                        <button type="button" disabled={ocupado} className="font-bold tono-mal hover:underline" onClick={async () => {
                            setOcupado(true);
                            const ok = await correr(() => quitarMatriculaEnLote(unitId, persona.id, c), `${c} quitada`);
                            setOcupado(false); setQuitando(null);
                            if (ok) alCambiar();
                        }}>Sí</button>
                        <button type="button" className="text-muted-foreground hover:underline" onClick={() => setQuitando(null)}>No</button>
                    </span>
                ) : (
                    <span key={c} className="group inline-flex items-center">
                        <Matricula p={c} />
                        {puedeEditar && <button type="button" aria-label={`Quitar ${c}`} title="Quitar" onClick={() => setQuitando(c)}
                            className="ml-0.5 h-6 w-6 grid place-items-center rounded-[6px] text-muted-foreground opacity-60 hover:opacity-100 hover:text-[var(--mal)]"><X size={12} /></button>}
                    </span>
                )
            ))}
            <span className="text-[12px] text-muted-foreground">{persona.chapas.length ? `de ${persona.nombre}` : persona.nombre}</span>
            {puedeEditar && (sumando ? (
                <span className="inline-flex items-center gap-1.5">
                    <input autoFocus value={nueva} onChange={(e) => setNueva(e.target.value.toUpperCase())} placeholder="ABC1234" maxLength={10}
                        onKeyDown={(e) => { if (e.key === "Escape") { setSumando(false); setNueva(""); } }}
                        className={cn(ENTRADA, "h-8 w-28 font-bold tabular-nums tracking-wide")} />
                    <button type="button" className={PRIMARIO} disabled={ocupado || nueva.replace(/[^A-Z0-9]/g, "").length < 5} onClick={async () => {
                        setOcupado(true);
                        const ok = await correr(() => agregarMatriculaEnLote(unitId, persona.id, nueva), `${nueva.replace(/[^A-Z0-9]/g, "")} de ${persona.nombre}`);
                        setOcupado(false);
                        if (ok) { setSumando(false); setNueva(""); alCambiar(); }
                    }}><Check size={14} />Sumar</button>
                    <button type="button" className={LAPIZ} aria-label="Cancelar" onClick={() => { setSumando(false); setNueva(""); }}><X size={14} /></button>
                </span>
            ) : (
                <button type="button" onClick={() => setSumando(true)} className="h-7 px-2 rounded-[6px] text-[11.5px] font-semibold text-[var(--accion)] hover:bg-accent inline-flex items-center gap-1"><Plus size={12} />Matrícula</button>
            ))}
        </li>
    );
}
