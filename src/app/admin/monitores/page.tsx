"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MonitorPlay, ShieldAlert, Car, Map as MapIco, LayoutDashboard, HeartPulse, RefreshCw, ExternalLink, Link2, Plus, Copy, Check, Ban, Volume2, Clock, Info, Terminal } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { Momento, Nada } from "@/components/ui/celdas";
import { VISTAS, type ClaveVista, type Vista } from "@/lib/monitor/vistas";
import { ROTACION_SEG_MIN } from "@/lib/monitor/ajustes";
import { listarEnlacesPantalla, crearEnlacePantalla, revocarEnlacePantalla, leerAjustesMonitores, guardarAjusteSonido, guardarRotacion, type EnlaceListado } from "@/app/actions/monitores";

/**
 * Monitores: las vistas de pantalla para el centro de monitoreo, y los enlaces que las
 * abren sin usuario. Una tarjeta por vista con qué muestra y para quién, el botón de abrir,
 * sus enlaces, y los ajustes (sonido por vista, rotación).
 */

const ICONOS: Record<Vista["icono"], any> = { ShieldAlert, Car, Map: MapIco, LayoutDashboard, HeartPulse, RefreshCw };

function CopiarUrl({ url }: { url: string }) {
    const [ok, setOk] = useState(false);
    return (
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setOk(true); setTimeout(() => setOk(false), 1500); } catch { toast.error({ title: "No se pudo copiar" }); } }}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-[12px] font-semibold hover:bg-accent">
            {ok ? <Check size={13} className="text-[var(--bien)]" /> : <Copy size={13} />} {ok ? "Copiado" : "Copiar"}
        </button>
    );
}

export default function MonitoresPage() {
    const [enlaces, setEnlaces] = useState<EnlaceListado[] | null>(null);
    const [ajustes, setAjustes] = useState<Awaited<ReturnType<typeof leerAjustesMonitores>> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nuevo, setNuevo] = useState<{ vista: ClaveVista } | null>(null);
    const [nombre, setNombre] = useState("");
    const [creando, setCreando] = useState(false);
    const [creado, setCreado] = useState<{ url: string; nombre: string; vista: ClaveVista } | null>(null);
    const [rotVistas, setRotVistas] = useState<ClaveVista[]>([]);
    const [rotSeg, setRotSeg] = useState(30);
    const [guardandoRot, setGuardandoRot] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const [e, a] = await Promise.all([listarEnlacesPantalla(), leerAjustesMonitores()]);
            setEnlaces(e); setAjustes(a); setRotVistas(a.rotacion.vistas); setRotSeg(a.rotacion.segundos); setError(null);
        } catch (err: any) { setError(err?.message || "No se pudo cargar"); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const origen = typeof window !== "undefined" ? window.location.origin : "";
    const porVista = useMemo(() => { const m: Record<string, EnlaceListado[]> = {}; for (const e of enlaces || []) (m[e.vista] ||= []).push(e); return m; }, [enlaces]);

    const crear = async () => {
        if (!nuevo) return;
        setCreando(true);
        const r = await crearEnlacePantalla({ nombre, vista: nuevo.vista });
        setCreando(false);
        if (!r.ok) { toast.error({ title: r.error }); return; }
        setCreado({ url: `${origen}${r.url}`, nombre, vista: nuevo.vista });
        setNombre(""); setNuevo(null); cargar();
    };

    const cambiarSonido = async (vista: ClaveVista, modo: string) => {
        const r = await guardarAjusteSonido(vista, modo);
        if (!r.ok) { toast.error({ title: r.error || "No se pudo guardar" }); return; }
        setAjustes((a) => a ? { ...a, sonido: { ...a.sonido, [vista]: modo } } : a);
        toast.success({ title: "Sonido guardado", description: "Las pantallas lo toman en su próxima actualización." });
    };

    const guardarRot = async () => {
        setGuardandoRot(true);
        const r = await guardarRotacion({ vistas: rotVistas, segundos: rotSeg });
        setGuardandoRot(false);
        if (!r.ok) { toast.error({ title: r.error || "No se pudo guardar" }); return; }
        toast.success({ title: "Rotación guardada" }); cargar();
    };

    return (
        <div className="p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
            <div className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 shrink-0"><MonitorPlay className="w-[18px] h-[18px] text-blue-400" /></div>
                <div className="min-w-0">
                    <h1 className="text-[17px] font-bold leading-tight">Monitores</h1>
                    <p className="text-[11.5px] text-muted-foreground leading-tight">Vistas para las pantallas del centro de monitoreo: sin menú, a pantalla completa, de sólo lectura. Cada una tiene su URL y se abre con sesión o con un enlace de pantalla.</p>
                </div>
            </div>

            {error && <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] px-4 py-3 text-[13px] text-[var(--mal-texto)] flex items-center justify-between">No se pudo cargar: {error} <Button variant="outline" onClick={cargar}>Reintentar</Button></div>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {VISTAS.map((v) => {
                    const Ic = ICONOS[v.icono];
                    const lista = porVista[v.clave] || [];
                    const sonido = v.sonido ? (ajustes?.sonido?.[v.clave] || v.sonido.modos[0].valor) : null;
                    return (
                        <section key={v.clave} className="rounded-[10px] border border-border bg-card flex flex-col">
                            <div className="p-4 flex items-start gap-3 border-b border-border">
                                <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-foreground shrink-0"><Ic size={24} /></span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-[15px] font-bold">{v.nombre}</h2>
                                        <code className="text-[11px] text-muted-foreground">/monitor/{v.clave}</code>
                                    </div>
                                    <p className="text-[12px] text-muted-foreground mt-0.5">{v.paraQuien}</p>
                                    <p className="text-[12.5px] mt-1.5 leading-snug">{v.queMuestra}</p>
                                </div>
                                <a href={`/monitor/${v.clave}`} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md accion text-[12px] font-bold"><ExternalLink size={13} /> Abrir</a>
                            </div>
                            {v.sonido && (
                                <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
                                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground"><Volume2 size={13} /> Sonido</span>
                                    <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
                                        {v.sonido.modos.map((m) => (
                                            <button key={m.valor} type="button" onClick={() => cambiarSonido(v.clave, m.valor)} className={cn("h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors", sonido === m.valor ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{m.rotulo}</button>
                                        ))}
                                    </div>
                                    <Pista texto="La pantalla lo toma en su próxima actualización. El navegador bloquea el audio hasta el primer clic: la pantalla lo avisa y, tras un toque, suena. Silenciar desde la propia pantalla no cambia este ajuste." lado="abajo"><Info size={14} className="text-muted-foreground/60 cursor-help" /></Pista>
                                </div>
                            )}
                            {v.clave === "rotacion" && ajustes && (
                                <div className="px-4 py-3 border-b border-border space-y-2">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground"><RefreshCw size={13} /> Vistas</span>
                                        {VISTAS.filter((x) => x.clave !== "rotacion").map((x) => {
                                            const on = rotVistas.includes(x.clave);
                                            return <button key={x.clave} type="button" aria-pressed={on} onClick={() => setRotVistas((p) => on ? p.filter((k) => k !== x.clave) : [...p, x.clave])} className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", on ? "accion border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>{on ? `${rotVistas.indexOf(x.clave) + 1}. ` : ""}{x.nombre}</button>;
                                        })}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground"><Clock size={13} /> Cada</span>
                                        <Input type="number" min={ROTACION_SEG_MIN} value={rotSeg} onChange={(e) => setRotSeg(Number(e.target.value))} className="w-[90px] h-8" />
                                        <span className="text-[12px] text-muted-foreground">segundos (mínimo {ROTACION_SEG_MIN}). El orden es el de los números.</span>
                                        <Button className="h-8 ml-auto" onClick={guardarRot} disabled={guardandoRot || rotVistas.length < 2}>Guardar rotación</Button>
                                    </div>
                                </div>
                            )}
                            <div className="p-4 flex-1">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground"><Link2 size={13} /> Enlaces de pantalla</span>
                                    <Button variant="outline" className="h-7 text-[12px]" onClick={() => { setNuevo({ vista: v.clave }); setNombre(""); }}><Plus size={13} className="mr-1" /> Nuevo enlace</Button>
                                </div>
                                {enlaces === null ? <p className="text-[12px] text-muted-foreground">Cargando…</p>
                                    : lista.length === 0 ? <p className="text-[12px] text-muted-foreground">Ninguno. Un enlace abre esta vista en la PC de la pared sin usuario ni contraseña.</p>
                                        : (
                                            <ul className="divide-y divide-border rounded-md border border-border">
                                                {lista.map((e) => (
                                                    <li key={e.id} className={cn("flex items-center gap-3 px-3 py-2 text-[12.5px]", e.revocadoEn && "opacity-55")}>
                                                        <span className="font-semibold min-w-[140px] truncate">{e.nombre}</span>
                                                        <span className="text-muted-foreground truncate flex-1">creado por {e.creadoPor || "—"} · <Momento t={e.creadoEn} /></span>
                                                        <span className="text-muted-foreground tabular-nums whitespace-nowrap">{e.revocadoEn ? <>revocado <Momento t={e.revocadoEn} /></> : e.ultimoUsoEn ? <>último uso <Momento t={e.ultimoUsoEn} />{e.ultimoUsoIp ? ` · ${e.ultimoUsoIp}` : ""}</> : "sin uso todavía"}</span>
                                                        {!e.revocadoEn && (
                                                            <ConfirmarAccion id={e.id} title={`Revocar «${e.nombre}»`} description="La pantalla que lo use deja de abrirse en su próxima actualización. El enlace queda listado como revocado; para volver a conectarla hay que emitir uno nuevo." etiquetaAccion="Revocar"
                                                                onDelete={async (id) => { await revocarEnlacePantalla(id); return { success: true } as any; }} onSuccess={cargar}>
                                                                <button type="button" className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] font-semibold text-[var(--mal-texto)] hover:bg-[var(--mal-suave)]"><Ban size={13} /> Revocar</button>
                                                            </ConfirmarAccion>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                            </div>
                        </section>
                    );
                })}
            </div>

            <section className="rounded-[10px] border border-border bg-card p-4 space-y-2">
                <h2 className="inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground"><Terminal size={14} /> Cómo dejar una PC arrancando en una pantalla</h2>
                <p className="text-[12.5px] text-muted-foreground">Chrome en modo kiosco abre a pantalla completa y sin pedir el primer clic para el sonido. En Windows, un acceso directo en Inicio → Programas → Inicio con este destino (cambiá la URL por el enlace de pantalla):</p>
                <pre className="rounded-md bg-muted/60 border border-border px-3 py-2 text-[12px] overflow-x-auto">{`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-session-crashed-bubble "${origen}/monitor/intrusion?pantalla=<token>"`}</pre>
                <p className="text-[12px] text-muted-foreground">Sin el modo kiosco también funciona: la pantalla pide pantalla completa y habilita el sonido con el primer toque, y lo avisa mientras tanto. El token se canjea en la primera carga por una cookie del navegador; después la URL sin token alcanza.</p>
            </section>

            {/* Crear enlace */}
            <Cajon open={!!nuevo} onOpenChange={(o) => { if (!o) setNuevo(null); }}>
                <CajonContenido ancho="angosto" titulo="Nuevo enlace de pantalla" descripcion={nuevo ? `Abre la vista ${VISTAS.find((x) => x.clave === nuevo.vista)?.nombre} sin usuario ni contraseña. La URL se muestra una sola vez.` : ""}
                    pie={<><Button variant="outline" onClick={() => setNuevo(null)}>Cancelar</Button><Button onClick={crear} disabled={creando || !nombre.trim()}>{creando ? "Creando…" : "Crear enlace"}</Button></>}>
                    <CajonSeccion titulo="Dónde va a estar" icono={MonitorPlay} ayuda="El nombre es para reconocerlo después en la lista: qué pantalla, qué lugar.">
                        <CajonCampo etiqueta="Nombre" pista="Un enlace es una credencial permanente para esa pantalla. Si la PC cambia de lugar o se pierde, revocá éste y emití otro.">
                            <Input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Monitor 2 · garita" onKeyDown={(e) => { if (e.key === "Enter") crear(); }} />
                        </CajonCampo>
                    </CajonSeccion>
                </CajonContenido>
            </Cajon>

            {/* La URL recién creada: una sola vez */}
            <Cajon open={!!creado} onOpenChange={(o) => { if (!o) setCreado(null); }}>
                <CajonContenido ancho="angosto" titulo="Enlace creado" descripcion="Copialo ahora: no se vuelve a mostrar. Si se pierde, se revoca y se crea otro."
                    pie={<Button onClick={() => setCreado(null)}>Listo</Button>}>
                    <CajonSeccion titulo={creado?.nombre || ""} icono={Link2}>
                        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] break-all select-all">{creado?.url}</div>
                        {creado && <CopiarUrl url={creado.url} />}
                        <p className="text-[12px] text-muted-foreground">Pegalo en el navegador de la pantalla. La primera carga canjea el token por una cookie y lo saca de la URL; después alcanza con <code>{origen}/monitor/{creado?.vista}</code>.</p>
                    </CajonSeccion>
                </CajonContenido>
            </Cajon>
        </div>
    );
}
