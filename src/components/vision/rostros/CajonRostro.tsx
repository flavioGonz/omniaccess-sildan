"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScanFace, UserCheck, UserPlus, Merge, Trash2, Loader2, Check, X, Video, Clock, ExternalLink, Search, Tag, Sparkles, CalendarDays } from "lucide-react";
import { sileo as toast } from "sileo";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Cargando, ErrorEstado } from "@/components/ui/estados";
import { Estado } from "@/components/ui/celdas";
import { ConfirmarEnCajon } from "@/components/ui/cajon-confirmar";
import { cn } from "@/lib/utils";
import { fichaRostro, registrarRostro, unirRostros, descartarParecido, olvidarRostro, buscarPersonasParaRostro, listarRostros, crearPersonaDesdeRostro } from "@/app/actions/rostros";
import { textoVeces, ROLES_PERSONA_DESDE_ROSTRO, type FichaRostro, type FilaRostro, type RolPersonaDesdeRostro } from "@/lib/rostros";
import { TEXTO_PATRON, SUGERIR, type Frecuencia } from "@/lib/rostros-frecuencia";

/*
 * La ficha de una cara vista por el modo face (13/11, Nico: «guardar el rostro, asignarle un id,
 * saber cuántas veces pasa, poder registrarlo»). Lo que se viene a hacer acá: mirar la cara y
 * cuándo pasó, decir quién es, unirla con otra cuando el motor partió a una persona en dos, y
 * olvidarla.
 */

/** Lo que la ficha le pide al servidor. Junto, para poder mostrarla con datos de prueba. */
export const ACCIONES_ROSTRO = { ficha: fichaRostro, registrar: registrarRostro, unir: unirRostros, descartar: descartarParecido, olvidar: olvidarRostro, personas: buscarPersonasParaRostro, lista: listarRostros, crearPersona: crearPersonaDesdeRostro };

const fecha = (iso: string) => new Date(iso).toLocaleString("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const hace = (iso: string) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? "recién" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** La foto de una cara: con la sombra de captura, que es lo único que acá lleva sombra. */
export function CaraRostro({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
    const [rota, setRota] = useState(false);
    useEffect(() => setRota(false), [src]);
    return (
        <span className={cn("relative block overflow-hidden rounded-[6px] bg-muted [box-shadow:var(--sombra-captura)]", className)}>
            {src && !rota
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={src} alt={alt} loading="lazy" onError={() => setRota(true)} className="absolute inset-0 h-full w-full object-cover" />
                : <span className="absolute inset-0 grid place-items-center text-muted-foreground/50"><ScanFace size={22} /></span>}
        </span>
    );
}

export function CajonRostro({ id, alCerrar, alCambiar, alAbrir, puedeCambiar = true, acciones, tema, panelInicial = null }: {
    /** La cara abierta; null = cerrado. */
    id: string | null; alCerrar: () => void;
    /** Algo cambió (nombre, unión, olvido): la grilla de atrás se refresca. */
    alCambiar: () => void;
    /** Abrir otra cara desde ésta (la que queda después de unir). */
    alAbrir: (id: string) => void;
    puedeCambiar?: boolean;
    acciones?: Partial<typeof ACCIONES_ROSTRO>;
    /** Abierto desde un monitor (que es siempre oscuro, sea cual sea el tema del panel). */
    tema?: "oscuro";
    /** Abrir ya en «¿Quién es?»: se llegó acá para registrarla. */
    panelInicial?: "registrar" | null;
}) {
    const servidor = { ...ACCIONES_ROSTRO, ...acciones };
    const [f, setF] = useState<FichaRostro | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [panel, setPanel] = useState<null | "registrar" | "unir">(null);
    const [ocupado, setOcupado] = useState(false);
    const [olvidando, setOlvidando] = useState(false);

    const traer = useCallback(async () => {
        if (!id) return;
        try { setF(await servidor.ficha(id)); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudo leer"); }
        // `servidor` se arma en cada render con las mismas funciones.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setF(null); setError(null); setPanel(id ? panelInicial : null); if (id) traer(); }, [id, traer]);

    const hacer = async (que: () => Promise<unknown>, listo: string, cerrar = false) => {
        setOcupado(true);
        try { await que(); toast.success({ title: listo }); setPanel(null); alCambiar(); if (cerrar) alCerrar(); else await traer(); }
        catch (e: any) { toast.error({ title: "No se pudo", description: e?.message }); }
        finally { setOcupado(false); }
    };
    const unirCon = async (otraId: string, rotulo: string) => {
        if (!f) return;
        setOcupado(true);
        try {
            const r = await servidor.unir(f.id, otraId);
            toast.success({ title: "Unidas", description: `${rotulo} pasó a ser la misma cara que ${f.nombre || f.codigo}.` });
            setPanel(null); alCambiar();
            if (r.id !== f.id) alAbrir(r.id); else await traer();
        } catch (e: any) { toast.error({ title: "No se pudieron unir", description: e?.message }); }
        finally { setOcupado(false); }
    };

    const titulo = f ? f.nombre || f.codigo : "Rostro";
    return (
        <Cajon open={!!id} onOpenChange={(v) => { if (!v && !ocupado) alCerrar(); }}>
            <CajonContenido ancho="intermedio" className={tema === "oscuro" ? "dark text-foreground" : undefined} titulo={titulo} descripcion={f ? (f.nombre ? `${f.codigo} · ${f.registro === "persona" ? "persona del padrón" : "nombre puesto a mano"}` : "Sin registrar") : "Modo face"}
                pie={f && puedeCambiar ? (
                    <div className="flex items-center gap-2 w-full">
                        <Button variant="ghost" onClick={() => setOlvidando(true)} disabled={ocupado} className="gap-1.5 text-muted-foreground hover:text-[var(--mal-texto)] mr-auto"><Trash2 size={14} /> Olvidar esta cara</Button>
                        <Button variant="outline" onClick={() => setPanel(panel === "unir" ? null : "unir")} disabled={ocupado} className="gap-1.5"><Merge size={14} /> Unir con otra</Button>
                        <Button onClick={() => setPanel(panel === "registrar" ? null : "registrar")} disabled={ocupado} className="gap-1.5"><UserPlus size={14} /> {f.nombre ? "Cambiar quién es" : "Registrar"}</Button>
                    </div>
                ) : undefined}>
                {error && !f ? <ErrorEstado mensaje={error} alReintentar={traer} /> : !f ? <Cargando texto="Trayendo la cara…" /> : (
                    <div className="px-6 py-5 space-y-6">
                        <div className="flex gap-5">
                            <CaraRostro src={f.foto} alt={titulo} className="h-[168px] w-[140px] shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    {f.registro ? <Estado tono="bien" icono={UserCheck}>{f.registro === "persona" ? "Del padrón" : "Con nombre"}</Estado> : <Estado tono="aviso">Sin registrar</Estado>}
                                    {f.rol === "BLACKLISTED" && <Estado tono="mal">Lista negra</Estado>}
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3">
                                    <Dato rotulo="Visitas" valor={f.veces.toLocaleString("es-UY")} grande />
                                    <Dato rotulo="Última vez" valor={hace(f.ultimaVez)} detalle={f.ultimaCamara || undefined} grande />
                                    <Dato rotulo="Primera vez" valor={fecha(f.primeraVez)} />
                                    <Dato rotulo="Calidad de la cara" valor={`${f.calidad} px`} detalle={`${f.ejemplos} ${f.ejemplos === 1 ? "foto" : "fotos"} en el motor`} />
                                </div>
                                {f.userId && <Link href={`/admin/users?q=${encodeURIComponent(f.nombre || "")}`} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accion)] hover:underline">Ver a {f.nombre} en Usuarios <ExternalLink size={11} /></Link>}
                            </div>
                        </div>

                        <FrecuenciaRostro fr={f.frecuencia} veces={f.veces} />

                        {/* Viene seguido y nadie dijo quién es: se propone registrarla (lib/rostros-frecuencia). */}
                        {f.frecuencia.conviene && puedeCambiar && panel !== "registrar" && (
                            <div className="rounded-[10px] border chip-info p-3.5 flex items-center gap-3">
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full pleno-info"><Sparkles size={16} /></span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-semibold text-foreground">Conviene registrarla</p>
                                    <p className="text-[12px] text-foreground/75 leading-snug">Vino {f.frecuencia.visitas14} veces en {f.frecuencia.dias14} días distintos de las últimas dos semanas y sigue sin nombre.</p>
                                </div>
                                <Button size="sm" onClick={() => setPanel("registrar")} disabled={ocupado} className="gap-1.5 shrink-0"><UserPlus size={13} /> Registrar</Button>
                            </div>
                        )}

                        {f.sugerencia && (
                            <div className="rounded-[10px] border chip-aviso p-3.5 flex items-center gap-3.5">
                                <CaraRostro src={f.sugerencia.foto} alt={f.sugerencia.codigo} className="h-16 w-14 shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-semibold text-foreground">¿Es la misma persona que {f.sugerencia.nombre || f.sugerencia.codigo}?</p>
                                    <p className="text-[12px] text-foreground/75 leading-snug">Se parecen {pct(f.sugerencia.parecido)}: no alcanzó para sumarla sola. Si son la misma, al unirlas el motor aprende este ángulo.</p>
                                </div>
                                {puedeCambiar && (
                                    <div className="flex flex-col gap-1.5 shrink-0">
                                        <Button size="sm" onClick={() => unirCon(f.sugerencia!.id, f.sugerencia!.nombre || f.sugerencia!.codigo)} disabled={ocupado} className="gap-1.5"><Check size={13} /> Sí, unir</Button>
                                        <Button size="sm" variant="outline" onClick={() => hacer(() => servidor.descartar(f.id), "Anotado: no son la misma")} disabled={ocupado} className="gap-1.5"><X size={13} /> No</Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {panel === "registrar" && <Registrar f={f} ocupado={ocupado} buscar={servidor.personas}
                            alElegir={(q, listo) => hacer(() => servidor.registrar(f.id, q), listo)}
                            alCrear={(nombre, rol) => hacer(() => servidor.crearPersona(f.id, { nombre, rol }), `${nombre} ya está en el padrón, con esta cara`)} />}
                        {panel === "unir" && <ElegirOtra f={f} ocupado={ocupado} listar={servidor.lista} alElegir={(o) => unirCon(o.id, o.nombre || o.codigo)} />}

                        <section>
                            <div className="flex items-center gap-2 mb-2.5">
                                <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cuándo pasó</h3>
                                <span className="text-[11.5px] text-muted-foreground">{f.totalPasadas > f.pasadas.length ? `las últimas ${f.pasadas.length} de ${f.totalPasadas}` : `${f.totalPasadas} ${f.totalPasadas === 1 ? "pasada" : "pasadas"} en ${textoVeces(f.veces).replace("veces", "visitas").replace("vez", "visita")}`}</span>
                            </div>
                            {f.camaras.length > 1 && (
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                    {f.camaras.map((c) => <span key={c.camara} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-muted text-[11.5px] font-semibold"><Video size={11} className="text-muted-foreground" /> {c.camara} <span className="tabular-nums text-muted-foreground">{c.veces}</span></span>)}
                                </div>
                            )}
                            {f.pasadas.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Todavía no hay pasadas guardadas de esta cara.</p> : (
                                <div className="divide-y divide-border rounded-[10px] border border-border">
                                    {f.pasadas.map((p) => (
                                        <div key={p.id} className="flex items-center gap-3 px-3 h-[52px]">
                                            {p.cuadro ? <a href={p.cuadro} target="_blank" rel="noreferrer" title="Ver el cuadro completo"><CaraRostro src={p.cara} alt="" className="h-10 w-9" /></a> : <CaraRostro src={p.cara} alt="" className="h-10 w-9" />}
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[13px] font-semibold tabular-nums leading-tight">{fecha(p.cuando)}</p>
                                                <p className="text-[11.5px] text-muted-foreground truncate">{p.camara || "Cámara sin nombre"}</p>
                                            </div>
                                            <span className="text-[11.5px] text-muted-foreground tabular-nums shrink-0" title="Cuánto se pareció a esta identidad, y el alto de la cara">
                                                {p.similitud != null ? pct(p.similitud) : "primera"}{p.px ? ` · ${p.px} px` : ""}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="text-[11.5px] text-muted-foreground mt-2 flex items-center gap-1.5"><Clock size={12} /> Las fotos de cada pasada viven lo que las detecciones; la cara de la identidad queda.</p>
                        </section>
                    </div>
                )}
            </CajonContenido>
            {f && <ConfirmarEnCajon id={f.id} open={olvidando} onOpenChange={setOlvidando} title={`Olvidar a ${titulo}`} etiquetaAccion="Olvidar"
                description={`Se borra su cara del motor (deja de reconocerla), su foto y sus ${f.totalPasadas} pasadas. Si vuelve a pasar, va a nacer como una cara nueva, con otro número. Los accesos del historial quedan, sin la foto de la cara.`}
                onDelete={servidor.olvidar} onSuccess={() => { toast.success({ title: "Cara olvidada" }); alCambiar(); alCerrar(); }} />}
        </Cajon>
    );
}

function Dato({ rotulo, valor, detalle, grande }: { rotulo: string; valor: string; detalle?: string; grande?: boolean }) {
    return (
        <div className="min-w-0">
            <div className="text-[11px] font-semibold text-muted-foreground">{rotulo}</div>
            <div className={cn("font-bold tabular-nums leading-tight truncate", grande ? "text-[20px]" : "text-[13px]")}>{valor}</div>
            {detalle && <div className="text-[11px] text-muted-foreground truncate">{detalle}</div>}
        </div>
    );
}

/** Decir quién es: alguien del padrón, o sólo un nombre. */
function Registrar({ f, ocupado, buscar, alElegir, alCrear }: {
    f: FichaRostro; ocupado: boolean; buscar: typeof buscarPersonasParaRostro;
    alElegir: (quien: { userId?: string | null; apodo?: string | null }, listo: string) => void;
    /** Crear a la persona en el padrón con esta cara (13/11: «permite registrar personas»). */
    alCrear: (nombre: string, rol: RolPersonaDesdeRostro) => void;
}) {
    const [q, setQ] = useState("");
    const [rol, setRol] = useState<RolPersonaDesdeRostro>("RESIDENT");
    const nombre = q.trim().replace(/\s+/g, " ");
    // Si ya hay alguien con ese nombre exacto, no se ofrece crearla de nuevo: se la elige de la lista.
    const [gente, setGente] = useState<Awaited<ReturnType<typeof buscarPersonasParaRostro>> | null>(null);
    useEffect(() => {
        const t = q.trim();
        if (t.length < 2) { setGente(null); return; }
        let vivo = true;
        const id = setTimeout(() => buscar(t).then((r) => { if (vivo) setGente(r); }).catch(() => { if (vivo) setGente([]); }), 220);
        return () => { vivo = false; clearTimeout(id); };
    }, [q, buscar]);
    return (
        <section className="rounded-[10px] border border-border p-4 space-y-3">
            <h3 className="text-[13px] font-bold">¿Quién es?</h3>
            <label className="relative block">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Escribí un nombre"
                    className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]" />
            </label>
            {gente && gente.length > 0 && (
                <div className="divide-y divide-border rounded-lg border border-border">
                    {gente.map((u) => (
                        <button key={u.id} type="button" disabled={ocupado} onClick={() => alElegir({ userId: u.id }, `${f.codigo} es ${u.name}`)}
                            className="w-full flex items-center gap-3 px-3 h-11 text-left hover:bg-accent/60 disabled:opacity-60">
                            <UserCheck size={15} className="text-muted-foreground shrink-0" />
                            <span className="text-[13px] font-semibold truncate">{u.name}</span>
                            <span className="ml-auto text-[11px] text-muted-foreground shrink-0">del padrón</span>
                        </button>
                    ))}
                </div>
            )}
            {nombre.length >= 2 && gente && !gente.some((u) => u.name.toLowerCase() === nombre.toLowerCase()) && (
                <div className="rounded-lg border border-border p-3 space-y-2.5">
                    <p className="text-[13px] flex items-center gap-2"><UserPlus size={15} className="text-[var(--accion)] shrink-0" /> <span>Crear a <b className="font-semibold">«{nombre}»</b> como persona nueva</span></p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {ROLES_PERSONA_DESDE_ROSTRO.map((r) => (
                            <button key={r.valor} type="button" aria-pressed={rol === r.valor} onClick={() => setRol(r.valor)}
                                className={cn("h-7 px-3 rounded-full border text-[12px] font-semibold transition-colors", rol === r.valor ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{r.rotulo}</button>
                        ))}
                        <Button size="sm" disabled={ocupado} onClick={() => alCrear(nombre, rol)} className="ml-auto gap-1.5"><Check size={13} /> Crear y registrar</Button>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground leading-snug">Queda en Usuarios con esta cara como su foto. La unidad, las matrículas y los grupos de acceso se completan en su ficha.</p>
                </div>
            )}
            {q.trim().length >= 2 && (
                <button type="button" disabled={ocupado} onClick={() => alElegir({ apodo: q.trim() }, `${f.codigo} ahora se llama ${q.trim()}`)}
                    className="w-full flex items-center gap-3 px-3 h-11 rounded-lg border border-dashed border-border text-left hover:bg-accent/60 disabled:opacity-60">
                    <Tag size={15} className="text-muted-foreground shrink-0" />
                    <span className="text-[13px]">Ponerle sólo el nombre <b className="font-semibold">«{q.trim()}»</b></span>
                    <span className="ml-auto text-[11px] text-muted-foreground shrink-0">sin crear una persona</span>
                </button>
            )}
            <p className="text-[11.5px] text-muted-foreground leading-snug">
                Con alguien del padrón, sus pasadas salen a su nombre en el monitor y en el historial.
                {f.nombre && <> <button type="button" disabled={ocupado} onClick={() => alElegir({}, `${f.codigo} volvió a quedar sin registrar`)} className="font-semibold text-[var(--accion)] hover:underline">Quitarle el nombre</button>.</>}
            </p>
        </section>
    );
}

/** Elegir con cuál otra cara unirla: por número o por nombre. */
function ElegirOtra({ f, ocupado, listar, alElegir }: { f: FichaRostro; ocupado: boolean; listar: typeof listarRostros; alElegir: (o: FilaRostro) => void }) {
    const [q, setQ] = useState("");
    const [caras, setCaras] = useState<FilaRostro[] | null>(null);
    useEffect(() => {
        let vivo = true;
        const id = setTimeout(() => listar({ q: q.trim(), orden: "recientes" }).then((r) => { if (vivo) setCaras(r.rostros.filter((x) => x.id !== f.id).slice(0, 18)); }).catch(() => { if (vivo) setCaras([]); }), 220);
        return () => { vivo = false; clearTimeout(id); };
    }, [q, f.id, listar]);
    return (
        <section className="rounded-[10px] border border-border p-4 space-y-3">
            <h3 className="text-[13px] font-bold">¿Con cuál es la misma persona?</h3>
            <label className="relative block">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Número (R-0042) o nombre"
                    className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_25%,transparent)]" />
            </label>
            {!caras ? <p className="text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Buscando…</p>
                : caras.length === 0 ? <p className="text-[12px] text-muted-foreground">No hay otra cara con eso.</p> : (
                    <div className="grid grid-cols-6 gap-2">
                        {caras.map((o) => (
                            <button key={o.id} type="button" disabled={ocupado} onClick={() => alElegir(o)} title={`Unir con ${o.nombre || o.codigo}`} className="text-left group disabled:opacity-60">
                                <CaraRostro src={o.foto} alt={o.codigo} className="aspect-[5/6] w-full group-hover:ring-2 ring-[var(--accion)]" />
                                <span className="mt-1 block text-[11px] font-semibold truncate">{o.nombre || o.codigo}</span>
                            </button>
                        ))}
                    </div>
                )}
            <p className="text-[11.5px] text-muted-foreground leading-snug">Queda una sola cara con las pasadas de las dos. No se puede deshacer.</p>
        </section>
    );
}

/**
 * Con qué frecuencia viene: en palabras, y una tira con las visitas de cada uno de los últimos
 * días (hoy a la derecha). La tira es lo que deja ver de un vistazo si es «todos los días» o «tres
 * veces el martes».
 */
export function FrecuenciaRostro({ fr, veces, compacta }: { fr: Frecuencia; veces: number; compacta?: boolean }) {
    const tope = Math.max(1, ...fr.tira);
    const tono = fr.patron === "habitual" ? "bien" : fr.patron === "recurrente" ? "info" : "quieto";
    return (
        <section className={cn(!compacta && "rounded-[10px] border border-border p-3.5")}>
            <div className="flex items-center gap-2 flex-wrap">
                {!compacta && <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mr-1 inline-flex items-center gap-1.5"><CalendarDays size={11} /> Frecuencia</h3>}
                <Estado tono={tono}>{veces <= 0 && fr.visitas === 0 ? "Sin verla aún" : TEXTO_PATRON[fr.patron]}</Estado>
                <span className="text-[12.5px] text-foreground/80 min-w-0">{veces <= 0 && fr.visitas === 0 ? "Cargada a mano: ninguna cámara la vio todavía." : fr.texto}</span>
            </div>
            <div className="mt-3 flex items-end gap-[3px] h-9" role="img" aria-label={`Visitas por día en los últimos ${fr.tira.length} días: ${fr.tira.join(", ")}`}>
                {fr.tira.map((n, i) => (
                    <span key={i} title={`${i === fr.tira.length - 1 ? "Hoy" : `Hace ${fr.tira.length - 1 - i} ${fr.tira.length - 1 - i === 1 ? "día" : "días"}`}: ${n === 1 ? "1 visita" : `${n} visitas`}`}
                        className={cn("flex-1 rounded-[2px]", n ? `pleno-${tono === "quieto" ? "info" : tono}` : "bg-muted")} style={{ height: n ? `${Math.max(22, (n / tope) * 100)}%` : 3 }} />
                ))}
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground"><span>hace {fr.tira.length - 1} días</span><span>hoy</span></div>
            {!compacta && fr.visitas > 0 && !fr.conviene && fr.patron !== "habitual" && (
                <p className="mt-2 text-[11.5px] text-muted-foreground leading-snug">Se sugiere registrar una cara sin nombre cuando viene {SUGERIR.visitas} veces o más en {SUGERIR.dias} días distintos dentro de {SUGERIR.enDias} días.</p>
            )}
        </section>
    );
}
