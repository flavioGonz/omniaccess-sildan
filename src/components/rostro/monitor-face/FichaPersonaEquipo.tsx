"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CreditCard, ImagePlus, Loader2, Plus, ScanFace, Search, Trash2, UserRound, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";
import { cn } from "@/lib/utils";

/**
 * La ficha de una persona DENTRO de un lector: su nombre, su vigencia, sus tarjetas y su cara.
 *
 * Pedido de Nico (20/11): «la integración completa, altas, bajas, modificaciones». Hasta acá sólo
 * se podían manejar los rostros, y una cara no vive sola: cuelga de un usuario del equipo. Sin
 * este panel, para agregarle una tarjeta a alguien había que entrar a la web del equipo.
 *
 * Dos decisiones que se notan al usarla:
 *
 *  · **El número de la persona no se tipea: se trae del padrón.** Antes, cargar una cara te pedía
 *    inventar un legajo en un `window.prompt`. Ahora se busca a la persona en OmniAccess y el
 *    número lo elige la misma regla medida que usa la sincronización — con su foto, que ya la
 *    tenemos. Escribir el número a mano sigue estando, para el caso en que la persona no esté en
 *    el padrón.
 *  · **El número ocupado no se pisa.** Dar de alta sobre un legajo que ya existe sería cambiarle
 *    el nombre a un vecino; el servidor lo rechaza y la ficha lo dice.
 */

const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.35 };
const SUAVE = { duration: 0.14, ease: "easeOut" as const };

type Persona = { legajo: string; nombre: string | null; tarjetas: number; rostros: number; desde?: string | null; vence?: string | null };
type Candidato = { id: string; nombre: string; unidad: string | null; conCara: boolean; legajo: string | null; tarjetas: string[] };

const soloFecha = (x?: string | null) => (x ? String(x).slice(0, 10) : "");
const conHora = (x: string) => (x ? `${x}T00:00:00` : "");

export function FichaPersonaEquipo({ deviceId, legajo, daFoto, alCerrar, alCambiar }: {
    deviceId: string;
    /** El legajo a editar, o `null` para dar de alta a alguien nuevo. */
    legajo: string | null;
    daFoto: boolean;
    alCerrar: () => void;
    alCambiar: () => void;
}) {
    const quieto = useReducedMotion();
    const nueva = legajo === null;
    const [p, setP] = useState<Persona | null>(nueva ? { legajo: "", nombre: "", tarjetas: 0, rostros: 0 } : null);
    const [tarjetas, setTarjetas] = useState<string[]>([]);
    const [nuevaTarjeta, setNuevaTarjeta] = useState("");
    const [trabajando, setTrabajando] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busca, setBusca] = useState("");
    const [gente, setGente] = useState<Candidato[] | null>(null);
    const archivo = useRef<HTMLInputElement>(null);

    const traer = useCallback(async () => {
        if (legajo === null) return;
        try {
            const r = await fetch(`/api/devices/personas-equipo?deviceId=${encodeURIComponent(deviceId)}&legajo=${encodeURIComponent(legajo)}`);
            const j = await r.json();
            if (!r.ok) { setError(j.error || "No se pudo leer"); return; }
            setP(j.persona); setTarjetas(j.tarjetas || []); setError(null);
        } catch { setError("No se pudo leer la persona del equipo"); }
    }, [deviceId, legajo]);
    useEffect(() => { traer(); }, [traer]);

    /** Toda escritura pasa por acá: una sola forma de avisar qué pasó y de volver a leer. */
    const hacer = async (cuerpo: Record<string, unknown>, etiqueta: string, listo?: string) => {
        setTrabajando(etiqueta);
        try {
            const r = await fetch("/api/devices/personas-equipo", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ deviceId, ...cuerpo }),
            });
            const j = await r.json();
            if (!r.ok || j.error) { toast.error({ title: "El equipo no lo aceptó", description: j.error }); return false; }
            if (listo) toast.success({ title: listo, description: (j.avisos || []).join(" · ") || undefined });
            alCambiar();
            return true;
        } catch { toast.error({ title: "No se pudo" }); return false; }
        finally { setTrabajando(null); }
    };

    const buscar = async (t: string) => {
        setBusca(t);
        if (t.trim().length < 2) { setGente(null); return; }
        try {
            const r = await fetch(`/api/devices/personas-equipo?buscar=${encodeURIComponent(t.trim())}`);
            const j = await r.json();
            setGente(j.gente || []);
        } catch { setGente([]); }
    };

    const subirFoto = async (f: File) => {
        if (!p?.legajo) return;
        const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
        if (await hacer({ accion: "rostro.alta", legajo: p.legajo, nombre: p.nombre, jpegB64: b64 }, "foto", "Rostro cargado")) traer();
    };

    return (
        <motion.aside
            initial={quieto ? { opacity: 0 } : { x: "100%" }} animate={quieto ? { opacity: 1 } : { x: 0 }}
            exit={quieto ? { opacity: 0 } : { x: "100%" }} transition={quieto ? SUAVE : RESORTE}
            className="fixed right-0 top-0 bottom-0 z-[60] w-[min(420px,100vw)] flex flex-col border-l border-border bg-card shadow-[0_0_60px_rgba(0,0,0,0.3)]">

            <header className="shrink-0 flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><UserRound size={18} /></span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-bold tracking-[-0.01em] truncate">{nueva ? "Cargar una persona" : p?.nombre || `Legajo ${legajo}`}</h2>
                    <p className="text-[11.5px] text-muted-foreground">{nueva ? "En este lector" : `Número ${legajo} en el equipo`}</p>
                </div>
                <button type="button" onClick={alCerrar} aria-label="Cerrar"
                    className="h-8 w-8 shrink-0 rounded-full grid place-items-center text-muted-foreground hover:bg-accent hover:text-foreground"><X size={16} /></button>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5 [scrollbar-width:thin]">
                {error && <p className="text-[12.5px] tono-mal">{error}</p>}

                {nueva && (
                    <section>
                        <Rotulo>Traerla del padrón</Rotulo>
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input value={busca} onChange={(e) => buscar(e.target.value)} placeholder="Buscar por nombre…"
                                className="h-9 w-full pl-8 pr-2 rounded-[8px] border border-border bg-background text-[13px]" />
                        </div>
                        <AnimatePresence initial={false}>
                            {gente && gente.length > 0 && (
                                <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                                    className="mt-2 rounded-[10px] border border-border divide-y divide-border overflow-hidden">
                                    {gente.map((g) => (
                                        <li key={g.id}>
                                            <button type="button" disabled={!!trabajando}
                                                onClick={async () => { if (await hacer({ accion: "padron", userId: g.id }, "padron", `${g.nombre} quedó cargado en el equipo`)) alCerrar(); }}
                                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/60 disabled:opacity-50">
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-[13px] font-bold truncate">{g.nombre}</span>
                                                    <span className="block text-[11px] text-muted-foreground truncate">
                                                        {[g.unidad, g.conCara ? "con foto" : "sin foto", g.tarjetas.length ? `${g.tarjetas.length} tarjeta${g.tarjetas.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                                                    </span>
                                                </span>
                                                {trabajando === "padron" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} className="text-muted-foreground" />}
                                            </button>
                                        </li>
                                    ))}
                                </motion.ul>
                            )}
                        </AnimatePresence>
                        {gente && gente.length === 0 && <p className="mt-2 text-[11.5px] text-muted-foreground">Nadie con ese nombre en el padrón. Podés cargarla a mano acá abajo.</p>}
                        <p className="mt-2 text-[11.5px] text-muted-foreground leading-snug">
                            Si está en el padrón, se carga con su foto y sus tarjetas, y el número lo elige OmniAccess.
                        </p>
                    </section>
                )}

                <section className="space-y-2.5">
                    <Rotulo>{nueva ? "O cargarla a mano" : "Datos en el equipo"}</Rotulo>
                    {nueva && (
                        <Campo etiqueta="Número en el equipo">
                            <input value={p?.legajo || ""} onChange={(e) => setP({ ...(p as Persona), legajo: e.target.value.replace(/[^0-9A-Za-z]/g, "") })}
                                placeholder="Ej. 305" className={entrada} />
                        </Campo>
                    )}
                    <Campo etiqueta="Nombre">
                        <input value={p?.nombre || ""} onChange={(e) => setP({ ...(p as Persona), nombre: e.target.value })} className={entrada} />
                    </Campo>
                    <div className="grid grid-cols-2 gap-2.5">
                        <Campo etiqueta="Vale desde"><input type="date" value={soloFecha(p?.desde)} onChange={(e) => setP({ ...(p as Persona), desde: conHora(e.target.value) })} className={entrada} /></Campo>
                        <Campo etiqueta="Vale hasta"><input type="date" value={soloFecha(p?.vence)} onChange={(e) => setP({ ...(p as Persona), vence: conHora(e.target.value) })} className={entrada} /></Campo>
                    </div>
                    <Button size="sm" disabled={!!trabajando || !p?.legajo}
                        onClick={async () => {
                            const ok = await hacer(
                                nueva
                                    ? { accion: "alta", legajo: p!.legajo, nombre: p!.nombre, desde: p!.desde, hasta: p!.vence }
                                    : { accion: "modificar", legajo: p!.legajo, nombre: p!.nombre, desde: p!.desde, hasta: p!.vence },
                                "guardar", nueva ? "Persona cargada en el equipo" : "Guardado en el equipo");
                            if (ok && nueva) alCerrar(); else if (ok) traer();
                        }}>
                        {trabajando === "guardar" && <Loader2 size={14} className="animate-spin" />} {nueva ? "Cargar en el equipo" : "Guardar"}
                    </Button>
                </section>

                {!nueva && p && (<>
                    <section>
                        <Rotulo>Tarjetas</Rotulo>
                        {tarjetas.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Ninguna.</p> : (
                            <ul className="rounded-[10px] border border-border divide-y divide-border overflow-hidden">
                                {tarjetas.map((t) => (
                                    <li key={t} className="flex items-center gap-2 px-3 py-2">
                                        <CreditCard size={14} className="text-muted-foreground shrink-0" />
                                        <span className="flex-1 text-[13px] tabular-nums truncate">{t}</span>
                                        <button type="button" disabled={!!trabajando} title="Quitar esta tarjeta"
                                            onClick={async () => { if (await hacer({ accion: "tarjeta.borrar", tarjeta: t }, "tar", "Tarjeta quitada")) traer(); }}
                                            className="h-7 w-7 grid place-items-center rounded-[6px] text-muted-foreground hover:bg-accent tono-mal"><Trash2 size={13} /></button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="mt-2 flex gap-2">
                            <input value={nuevaTarjeta} onChange={(e) => setNuevaTarjeta(e.target.value.replace(/[^0-9A-Za-z]/g, ""))}
                                placeholder="Número de la tarjeta" className={cn(entrada, "flex-1")} />
                            <Button variant="outline" size="sm" disabled={!nuevaTarjeta || !!trabajando}
                                onClick={async () => { if (await hacer({ accion: "tarjeta.alta", legajo: p.legajo, tarjeta: nuevaTarjeta }, "tar", "Tarjeta agregada")) { setNuevaTarjeta(""); traer(); } }}>
                                <Plus size={14} /> Agregar
                            </Button>
                        </div>
                    </section>

                    <section>
                        <Rotulo>Rostro</Rotulo>
                        <div className="flex items-center gap-3">
                            <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-muted text-muted-foreground">
                                {p.rostros > 0 && daFoto
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    ? <img src={`/api/devices/rostros-equipo/foto?deviceId=${encodeURIComponent(deviceId)}&fpid=${encodeURIComponent(p.legajo)}`} alt=""
                                        className="absolute inset-0 h-full w-full object-cover" />
                                    : <ScanFace size={22} />}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="text-[12.5px] text-muted-foreground mb-1.5">
                                    {p.rostros > 0 ? (daFoto ? "Tiene una cara cargada." : "Tiene una cara cargada; este equipo no entrega la foto.") : "Sin cara cargada."}
                                </p>
                                <div className="flex gap-2">
                                    <input ref={archivo} type="file" accept="image/jpeg,image/png" className="hidden"
                                        onChange={(e) => { const f = e.target.files?.[0]; if (f) subirFoto(f); e.target.value = ""; }} />
                                    <Button variant="outline" size="sm" disabled={!!trabajando} onClick={() => archivo.current?.click()}>
                                        {trabajando === "foto" ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {p.rostros > 0 ? "Reemplazar" : "Cargar"}
                                    </Button>
                                    {p.rostros > 0 && (
                                        <Button variant="outline" size="sm" className="tono-mal" disabled={!!trabajando}
                                            onClick={async () => { if (await hacer({ accion: "rostro.borrar", legajo: p.legajo }, "foto", "Rostro borrado")) traer(); }}>
                                            <Trash2 size={14} /> Quitar
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                </>)}
            </div>

            {!nueva && p && (
                <footer className="shrink-0 border-t border-border px-5 py-3 flex items-center gap-3">
                    {/* El borrado va con la pieza de la casa, que confirma sola: un window.confirm
                        del navegador para sacarle a alguien el permiso de entrar es poco para lo
                        que la acción significa. */}
                    <DeleteButton onConfirm={async () => { if (await hacer({ accion: "borrar", legajo: p.legajo }, "borrar", "Borrado del equipo")) alCerrar(); }} />
                    <span className="text-[11.5px] text-muted-foreground leading-snug">
                        Borrarlo del equipo se lleva su cara y sus tarjetas: deja de poder abrir esta puerta.
                    </span>
                </footer>
            )}
        </motion.aside>
    );
}

const entrada = "h-9 w-full px-2.5 rounded-[8px] border border-border bg-background text-[13px]";
const Rotulo = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">{children}</h3>
);
const Campo = ({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) => (
    <label className="block"><span className="block text-[11.5px] text-muted-foreground mb-1">{etiqueta}</span>{children}</label>
);
