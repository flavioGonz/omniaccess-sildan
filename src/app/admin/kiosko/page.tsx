"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
    MonitorPlay, Plus, Copy, ExternalLink, Link2, Rows3, Palette, Eye, Trash2, Save, Loader2, RefreshCw, Check, Users,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import {
    getPantallas, crearPantalla, guardarPantalla, borrarPantalla, nuevoEnlacePantalla, filasParaPantallas,
    type PantallaEditable,
} from "@/app/actions/pantallas";
import { aSlug, caminoPantalla, SLUG_RX } from "@/lib/filas/pantalla-comun";
import { cn } from "@/lib/utils";

/**
 * Pantalla / Kiosko: las pantallas de la sala de espera, en una tabla.
 *
 * Antes era UNA pantalla, dentro del panel, con un selector de fila arriba y que pedía sesión:
 * para ponerla en un monitor había que iniciar sesión en la tele, elegir la fila a mano cada vez
 * que se reiniciaba, y el selector quedaba dibujado encima del cartel. Nico (HB, 19/10): «una
 * tabla, con las URL personalizadas para cada pantalla a mostrar, centralizado para todas las
 * filas, simple para poner en monitores».
 *
 * Ahora cada pantalla tiene su dirección (/k/<nombre>?t=<clave>) que se abre sin sesión y ya
 * sabe qué filas mostrar. La clave corta impide recorrer pantallas adivinando nombres; si la
 * dirección se pasó a quien no debía, «Nuevo enlace» la cambia y la vieja deja de abrir.
 */

type Pantalla = Awaited<ReturnType<typeof getPantallas>>[number];
type Fila = { id: string; name: string; location: string | null };

const VACIA: PantallaEditable = { nombre: "", slug: "", deviceIds: [], tema: "oscuro", verEspera: true, verHora: true, mensaje: null, activa: true };

const urlCompleta = (p: { slug: string; token: string }) =>
    (typeof window !== "undefined" ? window.location.origin : "") + caminoPantalla(p.slug, p.token);

async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); toast.success({ title: "Dirección copiada", description: texto }); }
    catch { toast.error({ title: "No se pudo copiar", description: "Seleccioná la dirección en la ficha y copiala a mano." }); }
}

export default function KioskoPage() {
    const [pantallas, setPantallas] = useState<Pantalla[]>([]);
    const [filas, setFilas] = useState<Fila[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /** null = cerrado; { } sin id = alta. */
    const [abierta, setAbierta] = useState<(Partial<Pantalla> & { id?: string }) | null>(null);

    const cargar = useCallback(async () => {
        try {
            const [p, f] = await Promise.all([getPantallas(), filasParaPantallas()]);
            setPantallas(p); setFilas(f); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudieron leer las pantallas"); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const nombreFila = useMemo(() => Object.fromEntries(filas.map((f) => [f.id, f.name])), [filas]);
    const filasDe = (p: Pantalla) => (p.deviceIds.length ? p.deviceIds.map((id) => nombreFila[id] || "(fila borrada)") : ["Todas las filas"]);

    const columnas: ColumnaTabla<Pantalla>[] = [
        {
            clave: "nombre", titulo: "Pantalla", valor: (p) => p.nombre,
            celda: (p) => (
                <div className="flex items-center gap-3 min-w-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-muted"><MonitorPlay size={16} className="text-muted-foreground" /></span>
                    <div className="min-w-0">
                        <div className="text-[13px] font-semibold truncate">{p.nombre}</div>
                        {p.mensaje && <div className="text-[11px] text-muted-foreground truncate">{p.mensaje}</div>}
                    </div>
                </div>
            ),
        },
        {
            clave: "url", titulo: "Dirección", ayuda: "Se abre sin iniciar sesión. Pegala en el navegador del monitor.", valor: (p) => urlCompleta(p),
            celda: (p) => (
                <div className="flex items-center gap-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
                    <code className="text-[12px] truncate text-muted-foreground">/k/<b className="text-foreground">{p.slug}</b>?t=…</code>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" title="Copiar dirección" onClick={() => copiar(urlCompleta(p))}><Copy size={13} /></Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" title="Abrir pantalla" asChild>
                        <a href={caminoPantalla(p.slug, p.token)} target="_blank" rel="noreferrer"><ExternalLink size={13} /></a>
                    </Button>
                </div>
            ),
        },
        {
            clave: "filas", titulo: "Muestra", valor: (p) => filasDe(p).join(", "),
            celda: (p) => (
                <div className="flex flex-wrap gap-1">
                    {filasDe(p).map((n) => <span key={n} className="text-[11px] font-semibold px-2 py-0.5 rounded-full border chip-neutro">{n}</span>)}
                </div>
            ),
        },
        {
            clave: "opciones", titulo: "Opciones", ancho: 200,
            valor: (p) => [p.tema === "claro" ? "Claro" : "Oscuro", p.verEspera && "Espera", p.verHora && "Hora"].filter(Boolean).join(" · "),
            celda: (p) => <span className="text-[12px] text-muted-foreground">{[p.tema === "claro" ? "Tema claro" : "Tema oscuro", p.verEspera && "espera", p.verHora && "hora"].filter(Boolean).join(" · ")}</span>,
        },
        {
            clave: "estado", titulo: "Estado", ancho: 110, valor: (p) => (p.activa ? "Activa" : "Apagada"),
            celda: (p) => <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border", p.activa ? "chip-bien" : "chip-neutro")}>{p.activa ? "Activa" : "Apagada"}</span>,
        },
    ];

    return (
        <div className="p-6 space-y-5 max-w-[1680px] mx-auto">
            <div className="flex items-center gap-3">
                <div>
                    <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">Pantallas</h1>
                    <p className="text-[13px] text-muted-foreground">Lo que se ve en los monitores de la sala. Cada pantalla tiene su dirección y abre sin iniciar sesión.</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={cargar} title="Actualizar"><RefreshCw size={14} /></Button>
                    <Button size="sm" onClick={() => setAbierta({})} className="gap-1.5"><Plus size={14} /> Nueva pantalla</Button>
                </div>
            </div>

            <Tabla<Pantalla>
                id="pantallas-fila"
                filas={pantallas}
                clave={(p) => p.id}
                columnas={columnas}
                cargando={cargando}
                error={error}
                alReintentar={cargar}
                alClickFila={(p) => setAbierta(p)}
                filaActiva={(p) => abierta?.id === p.id}
                filasFantasma={2}
                nombreArchivo="pantallas"
                vacio={{ icono: MonitorPlay, titulo: "Todavía no hay pantallas", ayuda: "Creá una con «Nueva pantalla» y pegá su dirección en el monitor de la sala." }}
            />

            <CajonPantalla valor={abierta} filas={filas} onClose={() => setAbierta(null)} onSaved={cargar} />
        </div>
    );
}

/* ── La ficha de una pantalla ──────────────────────────────────────────────── */
function CajonPantalla({ valor, filas, onClose, onSaved }: { valor: (Partial<Pantalla> & { id?: string }) | null; filas: Fila[]; onClose: () => void; onSaved: () => void }) {
    const [f, setF] = useState<PantallaEditable>(VACIA);
    /** El slug sigue al nombre hasta que alguien lo toca a mano. */
    const [slugTocado, setSlugTocado] = useState(false);
    const [token, setToken] = useState<string | null>(null);
    const [qr, setQr] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [confirmaBorrar, setConfirmaBorrar] = useState(false);

    useEffect(() => {
        if (!valor) return;
        setF({ ...VACIA, ...(valor as any), mensaje: valor.mensaje ?? null, tema: valor.tema === "claro" ? "claro" : "oscuro" });
        setSlugTocado(!!valor.id);
        setToken(valor.token || null);
        setConfirmaBorrar(false);
    }, [valor]);

    const url = token && f.slug ? urlCompleta({ slug: f.slug, token }) : null;
    useEffect(() => {
        if (!url) { setQr(null); return; }
        QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
    }, [url]);

    const slugValido = SLUG_RX.test(f.slug);
    const bloqueo = !f.nombre.trim() ? "Falta el nombre" : !slugValido ? "La dirección no es válida" : null;

    const set = <K extends keyof PantallaEditable>(k: K, v: PantallaEditable[K]) => setF((p) => ({ ...p, [k]: v }));
    const alternarFila = (id: string) => set("deviceIds", f.deviceIds.includes(id) ? f.deviceIds.filter((x) => x !== id) : [...f.deviceIds, id]);

    async function guardar() {
        if (bloqueo) return;
        setGuardando(true);
        try {
            const r = valor?.id ? await guardarPantalla(valor.id, f) : await crearPantalla(f);
            toast.success({ title: valor?.id ? "Pantalla guardada" : "Pantalla creada", description: urlCompleta(r) });
            onSaved();
            if (!valor?.id) { setToken(r.token); }
            onClose();
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    }
    async function borrar() {
        if (!valor?.id) return;
        if (!confirmaBorrar) { setConfirmaBorrar(true); return; }
        try { await borrarPantalla(valor.id); toast.success({ title: "Pantalla borrada", description: f.nombre }); onSaved(); onClose(); }
        catch (e: any) { toast.error({ title: "No se pudo borrar", description: e?.message }); }
    }
    async function cambiarEnlace() {
        if (!valor?.id) return;
        try { const r = await nuevoEnlacePantalla(valor.id); setToken(r.token); onSaved(); toast.success({ title: "Enlace nuevo", description: "El anterior ya no abre. Cargá el nuevo en el monitor." }); }
        catch (e: any) { toast.error({ title: "No se pudo cambiar el enlace", description: e?.message }); }
    }

    return (
        <Cajon open={!!valor} onOpenChange={(v) => !v && onClose()}>
            <CajonContenido ancho="medio" titulo={valor?.id ? f.nombre || "Pantalla" : "Nueva pantalla"}
                descripcion="Qué filas muestra el monitor de la sala y cómo se ve."
                pie={
                    <div className="flex items-center gap-2 w-full">
                        {valor?.id && (
                            <Button variant="ghost" onClick={borrar} className="gap-1.5 tono-mal">
                                <Trash2 size={14} /> {confirmaBorrar ? "¿Borrar? El monitor deja de mostrarla" : "Borrar"}
                            </Button>
                        )}
                        <span className="flex-1 text-[12px] text-muted-foreground truncate">{bloqueo || ""}</span>
                        <Button variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button onClick={guardar} disabled={guardando || !!bloqueo} className="gap-1.5">
                            {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {valor?.id ? "Guardar" : "Crear"}
                        </Button>
                    </div>
                }>

                <CajonSeccion titulo="La pantalla" icono={MonitorPlay}>
                    <CajonCampo etiqueta="Nombre" pista="Para reconocerla en esta tabla. Con una sola fila, la pantalla muestra el nombre de la fila; con varias, este.">
                        <Input value={f.nombre} placeholder="Ej.: Sala de espera planta baja" autoFocus={!valor?.id}
                            onChange={(e) => { const v = e.target.value; setF((p) => ({ ...p, nombre: v, slug: slugTocado ? p.slug : aSlug(v) })); }} />
                    </CajonCampo>
                    <CajonCampo etiqueta="Dirección" ayuda="Letras minúsculas, números y guiones. Corta: se tipea con el control remoto de la tele.">
                        <div className="flex items-center rounded-md border border-input bg-background h-10 overflow-hidden focus-within:ring-2 focus-within:ring-[var(--accion)]/30">
                            <span className="pl-3 text-[13px] text-muted-foreground select-none">/k/</span>
                            <input value={f.slug} onChange={(e) => { setSlugTocado(true); set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-")); }}
                                className="flex-1 min-w-0 h-full bg-transparent px-0.5 text-[13px] font-semibold outline-none" placeholder="sala-1" />
                        </div>
                        {f.slug && !slugValido && <span className="block text-[11.5px] tono-mal mt-1.5">Sólo minúsculas, números y guiones; ni al principio ni al final.</span>}
                    </CajonCampo>
                </CajonSeccion>

                <CajonSeccion titulo="Qué filas muestra" icono={Rows3}
                    ayuda={f.deviceIds.length ? `${f.deviceIds.length} fila(s), en el orden en que las marcaste.` : "Ninguna marcada: muestra todas, también las que se agreguen después."}>
                    <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => set("deviceIds", [])}
                            className={cn("h-8 px-3 rounded-full text-[12px] font-semibold border transition-colors inline-flex items-center gap-1.5",
                                !f.deviceIds.length ? "bg-[var(--accion)] text-white border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>
                            {!f.deviceIds.length && <Check size={13} />} Todas
                        </button>
                        {filas.map((x) => {
                            const i = f.deviceIds.indexOf(x.id);
                            return (
                                <button key={x.id} type="button" onClick={() => alternarFila(x.id)}
                                    className={cn("h-8 px-3 rounded-full text-[12px] font-semibold border transition-colors inline-flex items-center gap-1.5",
                                        i >= 0 ? "bg-[var(--accion)] text-white border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>
                                    {i >= 0 ? <span className="tabular-nums">{i + 1}</span> : <Users size={13} />} {x.name}
                                </button>
                            );
                        })}
                    </div>
                    {!filas.length && <p className="text-[12px] text-muted-foreground">No hay contadores de fila dados de alta (Dispositivos › Contadores de fila).</p>}
                </CajonSeccion>

                <CajonSeccion titulo="Cómo se ve" icono={Palette}>
                    <div className="grid grid-cols-2 gap-2">
                        {(["oscuro", "claro"] as const).map((t) => (
                            <button key={t} type="button" onClick={() => set("tema", t)}
                                className={cn("h-10 rounded-md border text-[13px] font-semibold transition-colors",
                                    f.tema === t ? "border-[var(--accion)] text-foreground bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border text-muted-foreground hover:text-foreground")}>
                                {t === "oscuro" ? "Oscuro" : "Claro"}
                            </button>
                        ))}
                    </div>
                    <Interruptor texto="Mostrar la espera estimada" valor={f.verEspera} onChange={(v) => set("verEspera", v)} />
                    <Interruptor texto="Mostrar la hora" valor={f.verHora} onChange={(v) => set("verHora", v)} />
                    <CajonCampo etiqueta="Mensaje" ayuda="Opcional. Una línea debajo del nombre (ej.: «Tenga su documento a mano»).">
                        <Input value={f.mensaje || ""} maxLength={140} onChange={(e) => set("mensaje", e.target.value || null)} placeholder="Sin mensaje" />
                    </CajonCampo>
                    <Interruptor texto="Pantalla activa" valor={f.activa} onChange={(v) => set("activa", v)}
                        detalle={f.activa ? undefined : "Apagada, la dirección muestra «Pantalla desactivada»."} />
                </CajonSeccion>

                {valor?.id && url && (
                    <CajonSeccion titulo="Ponerla en el monitor" icono={Link2}
                        ayuda="Abrí esta dirección en el navegador del monitor y tocá la pantalla una vez para que ocupe todo.">
                        <div className="flex gap-4 items-start">
                            {qr && <img src={qr} alt="Código QR de la dirección" className="w-[120px] h-[120px] rounded-[6px] bg-white p-1 shrink-0" />}
                            <div className="min-w-0 flex-1 space-y-2">
                                <code className="block text-[12px] break-all rounded-[6px] bg-muted px-3 py-2 select-all">{url}</code>
                                <div className="flex flex-wrap gap-1.5">
                                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => copiar(url)}><Copy size={13} /> Copiar</Button>
                                    <Button variant="outline" size="sm" className="gap-1.5" asChild>
                                        <a href={url} target="_blank" rel="noreferrer"><Eye size={13} /> Ver</a>
                                    </Button>
                                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={cambiarEnlace}
                                        title="Si la dirección se pasó a quien no debía: la anterior deja de abrir."><RefreshCw size={13} /> Nuevo enlace</Button>
                                </div>
                            </div>
                        </div>
                        {f.slug !== valor.slug && <p className="text-[12px] tono-aviso">Cambiaste la dirección: al guardar, el monitor con la anterior deja de abrir.</p>}
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}

function Interruptor({ texto, detalle, valor, onChange }: { texto: string; detalle?: string; valor: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-center gap-3 rounded-[6px] border border-border px-3 min-h-11 py-2 cursor-pointer">
            <span className="flex-1 min-w-0">
                <span className="block text-[13px]">{texto}</span>
                {detalle && <span className="block text-[11.5px] text-muted-foreground">{detalle}</span>}
            </span>
            <Switch checked={valor} onCheckedChange={onChange} />
        </label>
    );
}
