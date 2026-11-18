"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Radar, Loader2, Check, Globe, KeyRound, Lock, LockOpen, Plus, ShieldAlert, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { ErrorEstado } from "@/components/ui/estados";
import { IconoTipo } from "@/components/devices/ArbolAreas";
import { leerRango } from "@/lib/descubrir-red";
import { cn } from "@/lib/utils";

/**
 * «Descubrir equipos en la red»: el barrido de ping de los mapas de KumaMap, acá adentro
 * (pedido 17/11 de Nico), rehecho el 18/11 con lo que faltaba para que sirva de verdad.
 *
 * Lo que cambia respecto del de KumaMap, y es el motivo de traerlo: ESTE sabe qué equipos ya
 * están dados de alta. Un barrido que devuelve veinte direcciones no dice nada; la pregunta de
 * verdad es cuál de esas veinte es una cámara que todavía no está cargada.
 *
 * Y lo que se agregó el 18/11, que es lo que convierte la lista en trabajo hecho:
 *
 *  · **Un solo campo para la red**, que entiende `192.168.1`, un CIDR (`192.168.1.0/24`) y un
 *    tramo (`.10-60`). Antes eran tres casilleros para decir una cosa.
 *  · **Probar usuario y clave contra los equipos antes de darlos de alta.** Un alta con la clave
 *    equivocada no falla al guardar: falla después, en silencio, y alguien tiene que ir a buscar
 *    por qué esa cámara no manda nada. Acá eso es una línea roja en la lista.
 *  · **Alta en lote.** Era el pedido textual: «nos ayudará a ahorrar tiempo dando de alta
 *    dispositivos de a uno». Se eligen, se les pone un nombre base y un tipo, y van los siete.
 *
 * El ancho es `medio` y no `ancho`: una sola columna de filas en un cajón de 1024 px deja una
 * banda de aire muerto a la derecha y las filas quedan larguísimas para lo que dicen.
 */

type Hallazgo = {
    ip: string; rtt: number | null; nombre: string | null; puertos: number[];
    servidor: string | null; reino: string | null; habla?: string[];
    parece: { que: string; tipo: string | null; marca: string | null };
    equipo: { id: string; nombre: string; tipo: string } | null;
};

type Verificacion = {
    ip: string; estado: "ok" | "clave" | "muda"; protocolo: string | null;
    modelo: string | null; serie: string | null; firmware: string | null; nombre: string | null;
    grabador: boolean; detalle: string | null;
};

const PUERTO_ROTULO: Record<number, string> = { 80: "web", 443: "web segura", 554: "RTSP", 8000: "Hikvision", 37777: "Dahua", 22: "SSH" };

/** Lo que se puede elegir al dar de alta en lote. El resto de los tipos se carga de a uno. */
const TIPOS_ALTA = [
    { id: "LPR_CAMERA", rotulo: "Cámara LPR" },
    { id: "CAMERA", rotulo: "Cámara" },
    { id: "LPR_INTERIOR", rotulo: "Cámara interior (seguimiento)" },
    { id: "NVR", rotulo: "Grabador (NVR)" },
    { id: "DOOR_INTERCOM", rotulo: "Portero" },
    { id: "ACCESS_CONTROL", rotulo: "Control de acceso" },
    { id: "FACE_TERMINAL", rotulo: "Terminal facial" },
] as const;

export function DescubrirRed({ abierto, alCerrar, alDarDeAlta, alAbrirEquipo, alCambiarEquipos }: {
    abierto: boolean;
    alCerrar: () => void;
    /** Dar de alta esa IP de a una: la pantalla de Dispositivos abre su alta con lo que se sepa. */
    alDarDeAlta: (datos: { ip: string; marca: string | null; tipo: string | null; nombre: string | null }) => void;
    alAbrirEquipo?: (id: string) => void;
    /** El alta en lote escribe sola: la pantalla de atrás tiene que releer su lista. */
    alCambiarEquipos?: () => void;
}) {
    const [subredes, setSubredes] = useState<string[]>([]);
    const [rango, setRango] = useState("");
    const [barriendo, setBarriendo] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resultado, setResultado] = useState<{ total: number; hallazgos: Hallazgo[]; ms: number } | null>(null);

    const [usuario, setUsuario] = useState("admin");
    const [clave, setClave] = useState("");
    const [probando, setProbando] = useState(false);
    const [verif, setVerif] = useState<Record<string, Verificacion>>({});

    const [elegidas, setElegidas] = useState<string[]>([]);
    const [tipoElegido, setTipoElegido] = useState<string | null>(null);
    const [nombreBase, setNombreBase] = useState("Cámara");
    const [dandoAlta, setDandoAlta] = useState(false);

    useEffect(() => {
        if (!abierto) return;
        fetch("/api/devices/descubrir", { cache: "no-store" })
            .then((r) => r.json())
            .then((j) => { setSubredes(j.subredes || []); setRango((s) => s || `${j.subredes?.[0] || "192.168.1"}.0/24`); })
            .catch(() => setRango((s) => s || "192.168.1.0/24"));
    }, [abierto]);

    /** Lo que dice el campo de red, leído acá mismo: el error se ve antes de apretar Buscar. */
    const leido = useMemo(() => leerRango(rango), [rango]);
    const rangoSirve = !("error" in leido);

    const barrer = useCallback(async () => {
        setBarriendo(true); setError(null); setResultado(null); setVerif({}); setElegidas([]);
        try {
            const r = await fetch("/api/devices/descubrir", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ rango }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setResultado(j);
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo barrer la red");
        } finally { setBarriendo(false); }
    }, [rango]);

    const nuevos = useMemo(() => resultado?.hallazgos.filter((h) => !h.equipo) || [], [resultado]);
    const conocidos = useMemo(() => resultado?.hallazgos.filter((h) => h.equipo) || [], [resultado]);

    async function probar() {
        if (!nuevos.length) return;
        setProbando(true);
        try {
            const r = await fetch("/api/devices/descubrir", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ accion: "probar", usuario, clave, ips: nuevos.map((h) => ({ ip: h.ip, habla: h.habla || [] })) }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            const mapa: Record<string, Verificacion> = {};
            for (const v of j.verificaciones as Verificacion[]) mapa[v.ip] = v;
            setVerif(mapa);
            const ok = (j.verificaciones as Verificacion[]).filter((v) => v.estado === "ok");
            // Lo que entró se marca solo: es lo que la persona va a dar de alta.
            setElegidas(ok.map((v) => v.ip));
            toast[ok.length ? "success" : "error"]({
                title: ok.length ? `${ok.length} de ${nuevos.length} aceptaron la clave` : "Ninguno aceptó esa clave",
                description: ok.length ? "Quedaron marcados para dar de alta." : "Probá con otro usuario, o puede que no sean Hikvision ni Dahua.",
            });
        } catch (e) {
            toast.error({ title: "No se pudo probar", description: e instanceof Error ? e.message : undefined });
        } finally { setProbando(false); }
    }

    async function darDeAltaLote() {
        const lista = nuevos.filter((h) => elegidas.includes(h.ip));
        if (!lista.length) return;
        setDandoAlta(true);
        try {
            const equipos = lista.map((h) => {
                const v = verif[h.ip];
                const ultimo = h.ip.split(".")[3];
                return {
                    ip: h.ip,
                    nombre: `${nombreBase.trim() || "Equipo"} ${ultimo}`.trim(),
                    tipo: tipoAlta,
                    marca: h.parece.marca || (v?.protocolo === "ISAPI" ? "HIKVISION" : v?.protocolo === "DAHUA" ? "DAHUA" : "GENERICA"),
                    modelo: v?.modelo || null,
                    usuario: v?.estado === "ok" ? usuario : null,
                    clave: v?.estado === "ok" ? clave : null,
                };
            });
            const r = await fetch("/api/devices/descubrir", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ accion: "alta", equipos }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success({
                title: `${j.hechos.length} ${j.hechos.length === 1 ? "equipo dado de alta" : "equipos dados de alta"}`,
                description: j.fallados?.length ? `${j.fallados.length} quedaron afuera: ${j.fallados[0].motivo}` : "Ya están en Dispositivos.",
            });
            alCambiarEquipos?.();
            // Los que entraron dejan de ser «sin dar de alta»: se vuelve a barrer para verlo.
            if (j.hechos.length) await barrer();
        } catch (e) {
            toast.error({ title: "No se pudo dar de alta", description: e instanceof Error ? e.message : undefined });
        } finally { setDandoAlta(false); }
    }

    /**
     * El tipo con el que se dan de alta sale de lo que la mayoría de lo elegido parece ser, y se
     * vuelve a calcular al cambiar la selección — hasta que alguien toca el selector, y ahí manda
     * la persona. Antes alcanzaba un grabador entre seis cámaras para que el lote entero quedara
     * marcado como NVR, que es exactamente el error que este botón tiene que no cometer.
     */
    const tipoSugerido = useMemo(() => {
        const cuenta = new Map<string, number>();
        for (const h of nuevos) {
            if (!elegidas.includes(h.ip)) continue;
            const t = verif[h.ip]?.grabador ? "NVR" : h.parece.tipo || "CAMERA";
            cuenta.set(t, (cuenta.get(t) || 0) + 1);
        }
        return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "CAMERA";
    }, [nuevos, elegidas, verif]);
    const tipoAlta = tipoElegido ?? (TIPOS_ALTA.some((t) => t.id === tipoSugerido) ? tipoSugerido : "CAMERA");

    const alternar = (ip: string) => setElegidas((l) => (l.includes(ip) ? l.filter((x) => x !== ip) : [...l, ip]));
    const todas = nuevos.length > 0 && elegidas.length === nuevos.length;

    return (
        <Cajon open={abierto} onOpenChange={(v) => !v && alCerrar()}>
            <CajonContenido ancho="medio" titulo="Descubrir equipos en la red"
                descripcion="Un ping a cada dirección del rango, y los puertos de las que contestan. Sólo redes privadas."
                encabezado={
                    <div className="px-6 py-4 space-y-2.5">
                        <div className="flex items-end gap-2">
                            <label className="flex-1 min-w-0">
                                <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Red</span>
                                <input value={rango} onChange={(e) => setRango(e.target.value)} placeholder="192.168.1.0/24"
                                    onKeyDown={(e) => { if (e.key === "Enter" && rangoSirve && !barriendo) barrer(); }}
                                    className={cn("w-full h-9 rounded-[6px] border bg-background px-2.5 text-[13px] tabular-nums outline-none focus:ring-2",
                                        rango && !rangoSirve
                                            ? "border-[var(--mal)] focus:ring-[var(--mal)]/25"
                                            : "border-border focus:ring-[var(--accion)]/30 focus:border-[var(--accion)]")} />
                            </label>
                            <Button onClick={barrer} disabled={barriendo || !rangoSirve} className="h-9 shrink-0">
                                {barriendo ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />} Buscar
                            </Button>
                        </div>

                        <p className={cn("text-[11.5px] leading-snug", rango && !rangoSirve ? "tono-mal" : "text-muted-foreground")}>
                            {rango && !rangoSirve
                                ? (leido as { error: string }).error
                                : rangoSirve
                                    ? `${leido.subred}.${leido.desde} a ${leido.subred}.${leido.hasta} · ${leido.total} ${leido.total === 1 ? "dirección" : "direcciones"}`
                                    : "Se puede escribir 192.168.1, un CIDR (192.168.1.0/24) o un tramo (192.168.1.10-60)."}
                        </p>

                        {subredes.length > 0 && !resultado && !barriendo && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[11.5px] text-muted-foreground">Redes con equipos:</span>
                                {subredes.map((s) => (
                                    <button key={s} type="button" onClick={() => setRango(`${s}.0/24`)}
                                        className={cn("h-6 px-2 rounded-full border text-[11.5px] font-semibold tabular-nums transition-colors",
                                            rangoSirve && leido.subred === s ? "border-[var(--accion)] text-[var(--accion)]" : "border-border text-muted-foreground hover:bg-accent")}>
                                        {s}.0/24
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                }
                pie={nuevos.length > 0 ? (
                    <div className="flex w-full items-end gap-2">
                        <label className="w-[136px] shrink-0">
                            <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Nombre</span>
                            <input value={nombreBase} onChange={(e) => setNombreBase(e.target.value)} placeholder="Cámara"
                                className="w-full h-9 rounded-[6px] border border-border bg-background px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--accion)]/30 focus:border-[var(--accion)]" />
                        </label>
                        <label className="flex-1 min-w-0">
                            <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Tipo</span>
                            <select value={tipoAlta} onChange={(e) => setTipoElegido(e.target.value)}
                                className="w-full h-9 rounded-[6px] border border-border bg-background px-2 text-[13px] outline-none focus:ring-2 focus:ring-[var(--accion)]/30 focus:border-[var(--accion)]">
                                {TIPOS_ALTA.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
                            </select>
                        </label>
                        <Button onClick={darDeAltaLote} disabled={!elegidas.length || dandoAlta} className="h-9 shrink-0">
                            {dandoAlta ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                            Dar de alta {elegidas.length || ""}
                        </Button>
                    </div>
                ) : undefined}>

                <div className="px-6 py-5 space-y-5">
                    {barriendo && (
                        <div className="rounded-[10px] border border-dashed border-border p-8 text-center">
                            <Loader2 size={20} className="animate-spin mx-auto mb-2 text-muted-foreground" />
                            <p className="text-[13px] font-semibold tabular-nums">
                                Barriendo {rangoSirve ? `${leido.subred}.${leido.desde} – ${leido.subred}.${leido.hasta}` : rango}
                            </p>
                            <p className="text-[12px] text-muted-foreground">
                                {rangoSirve ? `Son ${leido.total} direcciones: puede tardar medio minuto.` : ""}
                            </p>
                        </div>
                    )}

                    {error && !barriendo && <ErrorEstado mensaje={error} alReintentar={barrer} />}

                    {resultado && !barriendo && (
                        <>
                            <p className="text-[11.5px] text-muted-foreground tabular-nums">
                                {resultado.hallazgos.length} de {resultado.total} contestaron · {(resultado.ms / 1000).toFixed(1)} s
                            </p>

                            {nuevos.length > 0 && (
                                <section className="space-y-3">
                                    {/* Probar la clave es el paso que decide si el alta va a servir, así que va
                                        arriba de la lista y no escondido en cada fila. */}
                                    <div className="rounded-[10px] border border-border bg-card p-3.5">
                                        <p className="flex items-center gap-2 text-[12.5px] font-bold">
                                            <KeyRound size={14} className="tono-accion" /> Probar la clave antes de darlos de alta
                                        </p>
                                        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                                            Un alta con la clave equivocada no falla al guardar: falla después, cuando el equipo
                                            deja de contestar. Se prueba leyendo su ficha; no se le escribe nada.
                                        </p>
                                        <div className="mt-3 flex items-end gap-2">
                                            <label className="w-[132px] shrink-0">
                                                <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Usuario</span>
                                                <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off"
                                                    className="w-full h-9 rounded-[6px] border border-border bg-background px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--accion)]/30 focus:border-[var(--accion)]" />
                                            </label>
                                            <label className="flex-1 min-w-0">
                                                <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Clave</span>
                                                <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password"
                                                    onKeyDown={(e) => { if (e.key === "Enter" && !probando) probar(); }}
                                                    className="w-full h-9 rounded-[6px] border border-border bg-background px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--accion)]/30 focus:border-[var(--accion)]" />
                                            </label>
                                            <Button variant="outline" onClick={probar} disabled={probando || !usuario} className="h-9 shrink-0">
                                                {probando ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
                                                Probar en {nuevos.length}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <h3 className="text-[13px] font-bold">Sin dar de alta · {nuevos.length}</h3>
                                        <button type="button" onClick={() => setElegidas(todas ? [] : nuevos.map((h) => h.ip))}
                                            className="ml-auto text-[11.5px] font-semibold text-[var(--accion)] hover:underline">
                                            {todas ? "Ninguno" : "Elegir todos"}
                                        </button>
                                    </div>

                                    <div className="rounded-[10px] border border-border overflow-hidden divide-y divide-border">
                                        {nuevos.map((h) => (
                                            <Fila key={h.ip} h={h} v={verif[h.ip]} elegida={elegidas.includes(h.ip)}
                                                alElegir={() => alternar(h.ip)}
                                                alAbrirAlta={() => alDarDeAlta({ ip: h.ip, marca: h.parece.marca, tipo: h.parece.tipo, nombre: verif[h.ip]?.nombre || h.nombre })} />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {conocidos.length > 0 && (
                                <section className="space-y-2">
                                    <h3 className="text-[13px] font-bold text-muted-foreground">Ya están en OmniAccess · {conocidos.length}</h3>
                                    <div className="rounded-[10px] border border-border overflow-hidden divide-y divide-border">
                                        {conocidos.map((h) => <Fila key={h.ip} h={h} alAbrirEquipo={alAbrirEquipo} />)}
                                    </div>
                                </section>
                            )}

                            {resultado.hallazgos.length === 0 && (
                                <div className="rounded-[10px] border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                                    No contestó nadie en ese rango. Puede ser la red equivocada, o equipos que no responden al ping.
                                </div>
                            )}
                        </>
                    )}

                    {!resultado && !barriendo && !error && (
                        <div className="rounded-[10px] border border-dashed border-border p-8 text-center">
                            <Globe size={18} className="mx-auto mb-2 text-muted-foreground opacity-50" />
                            <p className="text-[13px] text-muted-foreground max-w-[42ch] mx-auto leading-relaxed">
                                Elegí la red y tocá Buscar. A cada dirección se le manda un ping y, a las que contestan,
                                se les prueban los puertos para saber qué son.
                            </p>
                        </div>
                    )}
                </div>
            </CajonContenido>
        </Cajon>
    );
}

/**
 * Una fila.
 *
 * Las columnas están fijas a propósito —casilla, ícono, IP, lo que es, estado, acción— porque lo
 * que se hace con esta lista es barrerla de arriba abajo buscando una dirección: con la IP
 * arrancando en la misma x en todas las filas se lee de un vistazo, y antes no pasaba.
 */
function Fila({ h, v, elegida, alElegir, alAbrirAlta, alAbrirEquipo }: {
    h: Hallazgo;
    v?: Verificacion;
    elegida?: boolean;
    alElegir?: () => void;
    alAbrirAlta?: () => void;
    alAbrirEquipo?: (id: string) => void;
}) {
    const puertos = h.puertos.map((p) => PUERTO_ROTULO[p] || String(p)).join(" · ");
    const abajo = [v?.modelo, v?.firmware, h.nombre, puertos].filter(Boolean).join(" · ") || "sin puertos conocidos abiertos";
    const seleccionable = !!alElegir;

    return (
        <div
            role={seleccionable ? "checkbox" : undefined}
            aria-checked={seleccionable ? !!elegida : undefined}
            tabIndex={seleccionable ? 0 : undefined}
            onClick={seleccionable ? alElegir : undefined}
            onKeyDown={seleccionable ? (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); alElegir!(); } } : undefined}
            className={cn("flex items-center gap-3 px-3.5 py-2.5 transition-colors",
                seleccionable && "cursor-pointer hover:bg-accent/40",
                elegida && "bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]")}>

            {seleccionable && (
                <span aria-hidden className={cn("h-[18px] w-[18px] shrink-0 rounded-[5px] border grid place-items-center transition-colors",
                    elegida ? "border-[var(--accion)] bg-[var(--accion)] text-white" : "border-border")}>
                    {elegida && <Check size={13} strokeWidth={3} />}
                </span>
            )}

            <IconoTipo tipo={h.equipo?.tipo || h.parece.tipo || "?"} size={15} className="shrink-0 text-muted-foreground" />

            {/* Ancho fijo y tabular: las direcciones quedan en columna. */}
            <span className="w-[108px] shrink-0 text-[13px] font-bold tabular-nums">{h.ip}</span>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    {h.equipo
                        ? <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold tono-bien truncate"><Check size={12} className="shrink-0" />{h.equipo.nombre}</span>
                        : <span className="text-[12.5px] font-semibold text-foreground/85 truncate">{v?.nombre || h.parece.que}</span>}
                    {h.rtt != null && <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{h.rtt} ms</span>}
                </div>
                <p className="text-[11.5px] text-muted-foreground truncate">{abajo}</p>
            </div>

            {v && <Sello v={v} />}

            {h.equipo
                ? alAbrirEquipo && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={(e) => { e.stopPropagation(); alAbrirEquipo(h.equipo!.id); }}>Abrir</Button>
                )
                : alAbrirAlta && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); alAbrirAlta(); }}
                        className="shrink-0 text-[11.5px] font-semibold text-muted-foreground hover:text-[var(--accion)] hover:underline">
                        Alta completa
                    </button>
                )}
        </div>
    );
}

/** El resultado de probar la clave, en una pieza chica y con su explicación al pasar el mouse. */
function Sello({ v }: { v: Verificacion }) {
    const comun = "shrink-0 inline-flex items-center gap-1 rounded-full px-2 h-6 text-[11px] font-bold";
    if (v.estado === "ok") return <span className={cn(comun, "chip-bien")} title={[v.modelo, v.serie, v.firmware].filter(Boolean).join(" · ")}><LockOpen size={11} /> Entra</span>;
    if (v.estado === "clave") return <span className={cn(comun, "chip-mal")} title={v.detalle || undefined}><ShieldAlert size={11} /> Clave</span>;
    return <span className={cn(comun, "chip-quieto")} title={v.detalle || undefined}><X size={11} /> No habla</span>;
}
