"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MonitorPlay, ExternalLink, Link2, Plus, Copy, Check, Ban, Volume2, VolumeX, Clock, Terminal, RefreshCw, ChevronRight, KeyRound } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { Momento, Nada } from "@/components/ui/celdas";
import { MiniaturaVista } from "@/components/monitor/MiniaturaVista";
import { VISTAS, vistaPorClave, type ClaveVista, type Vista } from "@/lib/monitor/vistas";
import { useFuncion } from "@/lib/funciones-cliente";

/** Las vistas que la instalación tiene: sin su función prendida (Intrusión, Alarmas) no se ofrecen. */
function useVistasDisponibles() {
    const intrusion = useFuncion("FUNC_INTRUSION");
    const gestion = useFuncion("FUNC_ALARMAS_GESTION");
    const estado: Record<string, boolean | null> = { FUNC_INTRUSION: intrusion, FUNC_ALARMAS_GESTION: gestion };
    return VISTAS.filter((v) => !v.funcion || estado[v.funcion] !== false);
}
import { ROTACION_SEG_MIN } from "@/lib/monitor/ajustes";
import { listarEnlacesPantalla, crearEnlacePantalla, revocarEnlacePantalla, leerAjustesMonitores, guardarAjusteSonido, guardarRotacion, type EnlaceListado } from "@/app/actions/monitores";

/**
 * Monitores: las vistas de pantalla para el centro de monitoreo, y los enlaces que las abren sin
 * usuario.
 *
 * 23/10, Nico: «que sea un monitor cada uno, con esa iconografía estilizada SVG, un monitor para cada
 * cosa; una tabla me parece mejor, con imagen de monitor de intrusión mini, LPR, etc.; cada tipo de
 * monitor con su cajón». Antes eran ocho tarjetas grandes con todo adentro (descripción, sonido,
 * enlaces, rotación): para encontrar los enlaces de una había que bajar por todas. Ahora la tabla dice
 * de un vistazo qué es cada una (su dibujo), cómo suena y en cuántas pantallas está; el cajón de cada
 * una tiene su dirección, su sonido, sus enlaces y cómo dejar una PC arrancando en ella.
 */

type Ajustes = Awaited<ReturnType<typeof leerAjustesMonitores>>;

function CopiarTexto({ texto, rotulo = "Copiar" }: { texto: string; rotulo?: string }) {
    const [ok, setOk] = useState(false);
    return (
        <Button variant="outline" className="h-8 text-[12px]" onClick={async () => { try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); } catch { toast.error({ title: "No se pudo copiar" }); } }}>
            {ok ? <Check size={13} className="mr-1 text-[var(--bien)]" /> : <Copy size={13} className="mr-1" />} {ok ? "Copiado" : rotulo}
        </Button>
    );
}

const rotuloSonido = (v: Vista, a: Ajustes | null) => {
    if (!v.sonido) return null;
    const modo = a?.sonido?.[v.clave] || v.sonido.modos[0].valor;
    return v.sonido.modos.find((m) => m.valor === modo) || v.sonido.modos[0];
};

export default function MonitoresPage() {
    const vistas = useVistasDisponibles();
    const [enlaces, setEnlaces] = useState<EnlaceListado[] | null>(null);
    const [ajustes, setAjustes] = useState<Ajustes | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<ClaveVista | null>(null);
    // La clave queda puesta al cerrar, para que el cajón se vaya con su contenido y no vacío.
    const [cajon, setCajon] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const [e, a] = await Promise.all([listarEnlacesPantalla(), leerAjustesMonitores()]);
            setEnlaces(e); setAjustes(a); setError(null);
        } catch (err: any) { setError(err?.message || "No se pudo cargar"); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const porVista = useMemo(() => { const m: Record<string, EnlaceListado[]> = {}; for (const e of enlaces || []) (m[e.vista] ||= []).push(e); return m; }, [enlaces]);

    const columnas: ColumnaTabla<Vista>[] = [
        {
            clave: "monitor", titulo: "Monitor", valor: (v) => v.nombre, celda: (v) => (
                <div className="flex items-center gap-4 py-1.5 min-w-0">
                    <MiniaturaVista clave={v.clave} ancho={116} className="shrink-0" />
                    <div className="min-w-0">
                        <div className="flex items-baseline gap-2"><span className="text-[15px] font-bold">{v.nombre}</span><code className="text-[11px] text-muted-foreground">/monitor/{v.clave}</code></div>
                        <p className="text-[12.5px] text-muted-foreground leading-snug line-clamp-2 max-w-[520px]">{v.paraQuien}</p>
                    </div>
                </div>
            ),
        },
        {
            clave: "sonido", titulo: "Sonido", ancho: 220, ayuda: "Cómo avisa con sonido. Se cambia en el cajón de cada monitor.",
            valor: (v) => rotuloSonido(v, ajustes)?.rotulo || "",
            celda: (v) => {
                const m = rotuloSonido(v, ajustes);
                if (!m) return <span className="text-[12px] text-muted-foreground">No suena</span>;
                return <span className="inline-flex items-center gap-1.5 text-[12.5px]">{m.valor === "off" ? <VolumeX size={14} className="text-muted-foreground" /> : <Volume2 size={14} className="tono-accion" />} {m.rotulo}</span>;
            },
        },
        {
            clave: "pantallas", titulo: "Pantallas", ancho: 200, ayuda: "Enlaces de pantalla vigentes: cada uno es una PC que abre este monitor sin usuario.",
            valor: (v) => (porVista[v.clave] || []).filter((e) => !e.revocadoEn).length,
            celda: (v) => {
                if (enlaces === null) return <Nada />;
                const vivos = (porVista[v.clave] || []).filter((e) => !e.revocadoEn);
                const ultimo = vivos.map((e) => e.ultimoUsoEn).filter(Boolean).sort().pop();
                return (
                    <div className="leading-tight">
                        <div className="text-[13px] font-semibold tabular-nums">{vivos.length ? `${vivos.length} ${vivos.length === 1 ? "enlace" : "enlaces"}` : <span className="font-normal text-muted-foreground">Ninguno</span>}</div>
                        {ultimo && <div className="text-[11.5px] text-muted-foreground">último uso <Momento t={ultimo} /></div>}
                    </div>
                );
            },
        },
        {
            clave: "acciones", titulo: "", ancho: 150, auxiliar: true, alinear: "der", celda: (v) => (
                <div className="flex items-center justify-end gap-1">
                    <a href={`/monitor/${v.clave}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md accion text-[12px] font-bold"><ExternalLink size={13} /> Abrir</a>
                    <ChevronRight size={16} className="text-muted-foreground" aria-hidden />
                </div>
            ),
        },
    ];

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1400px] mx-auto">
            <div className="rounded-xl border border-border/50 bg-card/60 px-4 py-3 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 shrink-0"><MonitorPlay className="w-[18px] h-[18px] text-blue-400" /></div>
                <div className="min-w-0">
                    <h1 className="text-[17px] font-bold leading-tight">Monitores</h1>
                    <p className="text-[11.5px] text-muted-foreground leading-tight">Un monitor para cada cosa: sin menú, a pantalla completa, de sólo lectura. Cada uno tiene su dirección y se abre con sesión o con un enlace de pantalla. Tocá uno para ver sus ajustes y sus enlaces.</p>
                </div>
            </div>

            <Tabla id="monitores" filas={vistas} clave={(v) => v.clave} columnas={columnas} controles={false} seleccionCeldas={false}
                error={error} alReintentar={cargar} alClickFila={(v) => { setAbierta(v.clave); setCajon(true); }} filaActiva={(v) => cajon && v.clave === abierta} />

            <CajonMonitor clave={abierta} abierto={cajon} alCerrar={() => setCajon(false)} enlaces={abierta ? porVista[abierta] || [] : []} cargando={enlaces === null}
                ajustes={ajustes} setAjustes={setAjustes} recargar={cargar} />
        </div>
    );
}

// ── El cajón de cada monitor ────────────────────────────────────────────────────────────────

function CajonMonitor({ clave, abierto, alCerrar, enlaces, cargando, ajustes, setAjustes, recargar }: {
    clave: ClaveVista | null; abierto: boolean; alCerrar: () => void; enlaces: EnlaceListado[]; cargando: boolean;
    ajustes: Ajustes | null; setAjustes: React.Dispatch<React.SetStateAction<Ajustes | null>>; recargar: () => void;
}) {
    const vistas = useVistasDisponibles();
    const v = clave ? vistaPorClave(clave) : null;
    const origen = typeof window !== "undefined" ? window.location.origin : "";
    const url = v ? `${origen}/monitor/${v.clave}` : "";
    const [nombre, setNombre] = useState("");
    const [creando, setCreando] = useState(false);
    const [creado, setCreado] = useState<{ url: string; nombre: string } | null>(null);
    const [rotVistas, setRotVistas] = useState<ClaveVista[]>([]);
    const [rotSeg, setRotSeg] = useState(30);
    const [guardandoRot, setGuardandoRot] = useState(false);
    // Cada vez que se abre: sin el enlace de la vez anterior, y la rotación como está guardada.
    useEffect(() => { setNombre(""); setCreado(null); if (ajustes) { setRotVistas(ajustes.rotacion.vistas); setRotSeg(ajustes.rotacion.segundos); } }, [clave]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!v) return <Cajon open={false} onOpenChange={() => { }}><CajonContenido titulo="" /></Cajon>;
    const sonido = v.sonido ? (ajustes?.sonido?.[v.clave] || v.sonido.modos[0].valor) : null;

    const crear = async () => {
        if (!nombre.trim()) return;
        setCreando(true);
        const r = await crearEnlacePantalla({ nombre, vista: v.clave });
        setCreando(false);
        if (!r.ok) { toast.error({ title: r.error }); return; }
        setCreado({ url: `${origen}${r.url}`, nombre }); setNombre(""); recargar();
    };
    const cambiarSonido = async (modo: string) => {
        const r = await guardarAjusteSonido(v.clave, modo);
        if (!r.ok) { toast.error({ title: r.error || "No se pudo guardar" }); return; }
        setAjustes((a) => a ? { ...a, sonido: { ...a.sonido, [v.clave]: modo } } : a);
        toast.success({ title: "Sonido guardado", description: "Las pantallas lo toman en su próxima actualización." });
    };
    const guardarRot = async () => {
        setGuardandoRot(true);
        const r = await guardarRotacion({ vistas: rotVistas, segundos: rotSeg });
        setGuardandoRot(false);
        if (!r.ok) { toast.error({ title: r.error || "No se pudo guardar" }); return; }
        toast.success({ title: "Rotación guardada" }); recargar();
    };
    const vivos = enlaces.filter((e) => !e.revocadoEn);

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={v.nombre} descripcion={v.paraQuien}
                pie={<><Button variant="outline" onClick={alCerrar}>Cerrar</Button><a href={`/monitor/${v.clave}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md accion text-[13px] font-bold"><ExternalLink size={14} /> Abrir el monitor</a></>}>
                <div className="rounded-[10px] bg-muted/60 border border-border px-5 py-4 flex items-center gap-5">
                    <MiniaturaVista clave={v.clave} ancho={240} className="shrink-0" />
                    <p className="text-[13px] leading-relaxed">{v.queMuestra}</p>
                </div>

                <CajonSeccion titulo="Dirección" icono={ExternalLink} ayuda="Con la sesión del panel abre directo. En una PC de pared sin usuario, con un enlace de pantalla (abajo).">
                    <div className="flex items-center gap-2">
                        <code className="flex-1 min-w-0 truncate rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[12.5px]">{url}</code>
                        <CopiarTexto texto={url} />
                    </div>
                </CajonSeccion>

                {v.sonido && (
                    <CajonSeccion titulo="Sonido" icono={Volume2} pista="La pantalla lo toma en su próxima actualización. El navegador bloquea el audio hasta el primer toque: la pantalla lo avisa y, tras un toque, suena. Silenciar desde la propia pantalla no cambia este ajuste.">
                        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5 w-fit">
                            {v.sonido.modos.map((m) => (
                                <button key={m.valor} type="button" aria-pressed={sonido === m.valor} onClick={() => cambiarSonido(m.valor)}
                                    className={cn("h-8 px-3 rounded-md text-[12px] font-semibold transition-colors", sonido === m.valor ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>{m.rotulo}</button>
                            ))}
                        </div>
                    </CajonSeccion>
                )}

                {v.clave === "rotacion" && ajustes && (
                    <CajonSeccion titulo="Qué alterna" icono={RefreshCw} ayuda="El orden es el de los números. Una intrusión sin resolver, o una alarma crítica de central si está «Alarmas», la deja quieta en esa vista.">
                        <div className="grid grid-cols-2 gap-2">
                            {vistas.filter((x) => x.clave !== "rotacion").map((x) => {
                                const on = rotVistas.includes(x.clave);
                                return (
                                    <button key={x.clave} type="button" aria-pressed={on} onClick={() => setRotVistas((p) => on ? p.filter((k) => k !== x.clave) : [...p, x.clave])}
                                        className={cn("flex items-center gap-3 rounded-[10px] border px-2.5 py-2 text-left transition-colors", on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                                        <MiniaturaVista clave={x.clave} ancho={64} quieta={!on} className="shrink-0" />
                                        <span className="text-[13px] font-semibold flex-1">{x.nombre}</span>
                                        {on && <span className="grid h-6 w-6 place-items-center rounded-full accion text-[12px] font-bold tabular-nums">{rotVistas.indexOf(x.clave) + 1}</span>}
                                    </button>
                                );
                            })}
                        </div>
                        <CajonCampo etiqueta="Cada cuántos segundos" pista={`Mínimo ${ROTACION_SEG_MIN}: menos no alcanza para leer una vista.`}>
                            <div className="flex items-center gap-2">
                                <Clock size={14} className="text-muted-foreground" />
                                <Input type="number" min={ROTACION_SEG_MIN} value={rotSeg} onChange={(e) => setRotSeg(Number(e.target.value))} className="w-[100px] h-8" />
                                <Button className="h-8 ml-auto" onClick={guardarRot} disabled={guardandoRot || rotVistas.length < 2}>{guardandoRot ? "Guardando…" : "Guardar rotación"}</Button>
                            </div>
                        </CajonCampo>
                    </CajonSeccion>
                )}

                <CajonSeccion titulo="Enlaces de pantalla" icono={Link2} ayuda="Cada enlace abre este monitor en una PC sin usuario ni contraseña. Es una credencial permanente para esa pantalla: si la PC cambia de lugar o se pierde, se revoca y se emite otra.">
                    {cargando ? <p className="text-[12px] text-muted-foreground">Cargando…</p>
                        : enlaces.length === 0 ? <p className="text-[12px] text-muted-foreground">Ninguno todavía.</p>
                            : (
                                <ul className="divide-y divide-border rounded-md border border-border">
                                    {enlaces.map((e) => (
                                        <li key={e.id} className={cn("flex items-center gap-3 px-3 py-2 text-[12.5px]", e.revocadoEn && "opacity-55")}>
                                            <div className="min-w-0 flex-1">
                                                <div className="font-semibold truncate">{e.nombre}</div>
                                                <div className="text-[11.5px] text-muted-foreground truncate">creado por {e.creadoPor || "—"} · <Momento t={e.creadoEn} /> · {e.revocadoEn ? <>revocado <Momento t={e.revocadoEn} /></> : e.ultimoUsoEn ? <>último uso <Momento t={e.ultimoUsoEn} />{e.ultimoUsoIp ? ` · ${e.ultimoUsoIp}` : ""}</> : "sin uso todavía"}</div>
                                            </div>
                                            {!e.revocadoEn && (
                                                <ConfirmarAccion id={e.id} title={`Revocar «${e.nombre}»`} description="La pantalla que lo use deja de abrirse en su próxima actualización. El enlace queda listado como revocado; para volver a conectarla hay que emitir uno nuevo." etiquetaAccion="Revocar"
                                                    onDelete={async (id) => { await revocarEnlacePantalla(id); return { success: true } as any; }} onSuccess={recargar}>
                                                    <button type="button" className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] font-semibold text-[var(--mal-texto)] hover:bg-[var(--mal-suave)]"><Ban size={13} /> Revocar</button>
                                                </ConfirmarAccion>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                    {creado ? (
                        <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--bien)_40%,transparent)] bg-[var(--bien-suave)] p-3 space-y-2">
                            <div className="flex items-center gap-2 text-[13px] font-bold tono-bien"><KeyRound size={14} /> Enlace «{creado.nombre}» creado: copialo ahora, no se vuelve a mostrar</div>
                            <div className="rounded-md border border-border bg-background px-3 py-2 text-[12px] break-all select-all">{creado.url}</div>
                            <div className="flex items-center gap-2">
                                <CopiarTexto texto={creado.url} rotulo="Copiar el enlace" />
                                <Button variant="outline" className="h-8 text-[12px]" onClick={() => setCreado(null)}>Listo</Button>
                            </div>
                            <p className="text-[11.5px] text-muted-foreground">La primera carga canjea el token por una cookie y lo saca de la dirección; después alcanza con {url}.</p>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={`Dónde va a estar: «Monitor 2 · garita»`} className="h-8" onKeyDown={(e) => { if (e.key === "Enter") crear(); }} />
                            <Button className="h-8 shrink-0" onClick={crear} disabled={creando || !nombre.trim()}><Plus size={13} className="mr-1" /> {creando ? "Creando…" : "Nuevo enlace"}</Button>
                        </div>
                    )}
                    {vivos.length > 0 && <p className="text-[11.5px] text-muted-foreground">{vivos.length} {vivos.length === 1 ? "pantalla tiene" : "pantallas tienen"} este monitor.</p>}
                </CajonSeccion>

                <CajonSeccion titulo="Dejar una PC arrancando en este monitor" icono={Terminal} plegable
                    ayuda="Chrome en modo kiosco abre a pantalla completa y sin pedir el primer toque para el sonido.">
                    <p className="text-[12.5px] text-muted-foreground">En Windows, un acceso directo en Inicio → Programas → Inicio con este destino (cambiá «token» por el del enlace de pantalla):</p>
                    <pre className="rounded-md bg-muted/60 border border-border px-3 py-2 text-[12px] overflow-x-auto whitespace-pre-wrap break-all">{`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-session-crashed-bubble "${url}?pantalla=<token>"`}</pre>
                    <p className="text-[12px] text-muted-foreground">Sin el modo kiosco también funciona: la pantalla pide pantalla completa y habilita el sonido con el primer toque, y lo avisa mientras tanto.</p>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}
