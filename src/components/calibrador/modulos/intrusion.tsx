"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sileo as toast } from "sileo";
import { Minus, Hexagon, Trash2, Gauge, PersonStanding, Car, Users, BellRing, Send, Wand2, ShieldCheck, Layers } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import type { Forma, Pt } from "@/components/calibrador/Lienzo";
import { BotonPanel, Pildoras, Seccion, TarjetaElemento, Vacio, type Modulo } from "@/components/calibrador/piezas";
import { EstadoIntrusion, useEstadoIntrusion } from "@/components/devices/EstadoIntrusion";

/**
 * Módulo «Intrusión» del calibrador único (26/11): la analítica de la propia cámara —líneas de
 * cruce con su sentido, zonas de intrusión, sensibilidad, objetivo— y que le avise a OmniAccess.
 * Las mismas llamadas que el calibrador de intrusión (/api/devices/analytics, alarm-host), la
 * misma regla de oro: cada guardado vuelve a leer la cámara y, si algo no quedó, lo dice.
 *
 * Lo nuevo es cómo se dibuja: con el lienzo de todo el calibrador, sobre la foto o el vivo, varias
 * líneas y zonas a la vez, y un solo «Guardar en la cámara» que escribe lo cambiado. La cámara
 * tiene lugares fijos (Hikvision, 4 de cada una): una figura nueva toma el primer lugar libre.
 */
type Dir = "both" | "ab" | "ba";
type Regla = { id: number; vacia: boolean; enabled: boolean; points: Pt[]; direction: Dir; sensibilidad: number | null; objetivo: string | null };
type Cfg = { support: { line: boolean; field: boolean }; lineas: Regla[]; zonas: Regla[]; edita: { varias: boolean; borrar: boolean; ajustes: boolean; motivo?: string } };

export const COLOR_INTR = { linea: "#38bdf8", zona: "#f43f5e" } as const;
// La API usa 0..1000 con origen ABAJO-izquierda.
const aLienzo = (p: { x: number; y: number }): Pt => ({ x: p.x / 1000, y: 1 - p.y / 1000 });
const aCamara = (p: Pt) => ({ x: Math.round(p.x * 1000), y: Math.round((1 - p.y) * 1000) });
const DIR_A_SENTIDO: Record<Dir, "ab" | "ba" | "ambos"> = { ab: "ab", ba: "ba", both: "ambos" };
const OBJETIVOS = [{ v: "human", t: "Personas", icono: PersonStanding }, { v: "vehicle", t: "Vehículos", icono: Car }, { v: "human,vehicle", t: "Ambos", icono: Users }];
const SENS = [{ v: "40", t: "Baja" }, { v: "60", t: "Media" }, { v: "80", t: "Alta" }];
const dibujadas = (l: Regla[] | undefined) => (l || []).filter((r) => !r.vacia);

export function useIntrusion(deviceId: string, activo: boolean, esCamara: boolean): Modulo {
    const [cfg, setCfg] = useState<Cfg | null>(null);
    const [original, setOriginal] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [seleccion, setSeleccion] = useState<string | null>(null);
    const [herramienta, setHerramienta] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [ocupado, setOcupado] = useState<string | null>(null);
    const [alarma, setAlarma] = useState<boolean | null>(null);
    // La cadena de aviso (sólo cámaras de intrusión: /api/devices/intrusion-estado).
    const cadena = useEstadoIntrusion(activo && esCamara ? deviceId : null);

    const cargar = useCallback(async () => {
        setError(null);
        try {
            const d = await fetch(`/api/devices/analytics?deviceId=${deviceId}`, { cache: "no-store" }).then((r) => r.json());
            if (!d.ok) { setError(d.error || "No se pudo leer la cámara"); setCfg(null); return; }
            const regla = (r: { id: number; vacia?: boolean; enabled?: boolean; points?: { x: number; y: number }[]; direction?: Dir; sensibilidad?: number | null; objetivo?: string | null }): Regla => ({ id: r.id, vacia: !!r.vacia, enabled: !!r.enabled, points: (r.points || []).map(aLienzo), direction: r.direction || "both", sensibilidad: r.sensibilidad ?? null, objetivo: r.objetivo ?? null });
            const c: Cfg = { support: d.support || { line: false, field: false }, lineas: (d.lineas?.reglas || []).map(regla), zonas: (d.zonas?.reglas || []).map(regla), edita: d.edita || { varias: false, borrar: false, ajustes: false } };
            setCfg(c); setOriginal(JSON.stringify(c)); setSeleccion(null); setHerramienta(null);
        } catch { setError("Sin conexión con la cámara"); }
        fetch(`/api/devices/alarm-host?deviceId=${deviceId}`, { cache: "no-store" }).then((r) => r.json()).then((a) => setAlarma(!!(a?.hasOmni || (a?.dahua && a?.ok)))).catch(() => setAlarma(null));
    }, [deviceId]);
    useEffect(() => { if (!activo) return; const t = setTimeout(cargar, 0); return () => clearTimeout(t); }, [activo, cargar]);

    /** Escribir en la cámara: corre en el servidor y se consulta hasta que termina (la cámara tarda). */
    const post = async (body: unknown) => {
        const r = await fetch(`/api/devices/analytics?deviceId=${deviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        let j = await r.json().catch(() => ({}));
        if (!j.ok) throw new Error(j.error || "La cámara no aceptó el cambio");
        if (j.enCurso) {
            const hasta = Date.now() + 5 * 60_000;
            for (;;) {
                await new Promise((res) => setTimeout(res, 3000));
                const e = await fetch(`/api/devices/analytics?deviceId=${deviceId}&estado=1`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
                if (e?.estado === "listo") { j = e; break; }
                if (e?.estado === "error") throw new Error(e.error || "La cámara no aceptó el cambio");
                if (Date.now() > hasta) throw new Error("La cámara no terminó de aplicar en 5 minutos");
            }
        }
        if (Array.isArray(j.diferencias) && j.diferencias.length) throw new Error(`La cámara no quedó igual: ${j.diferencias.join(" · ")}`);
    };

    const formas: Forma[] = useMemo(() => {
        if (!cfg) return [];
        return [
            ...dibujadas(cfg.zonas).map((z) => ({ id: `z${z.id}`, tipo: "poligono" as const, puntos: z.points, color: COLOR_INTR.zona, etiqueta: `Zona ${z.id}`, apagada: !z.enabled, maxPuntos: 10 })),
            ...dibujadas(cfg.lineas).map((l) => ({ id: `l${l.id}`, tipo: "linea" as const, puntos: l.points, color: COLOR_INTR.linea, etiqueta: `Línea ${l.id}`, sentido: DIR_A_SENTIDO[l.direction], apagada: !l.enabled })),
        ];
    }, [cfg]);

    const cambiar = (f: (c: Cfg) => void) => setCfg((c) => { if (!c) return c; const n = structuredClone(c); f(n); return n; });
    const regla = (id: string, c: Cfg) => (id.startsWith("l") ? c.lineas : c.zonas).find((r) => r.id === Number(id.slice(1)));

    const alCrear = (tipo: "poligono" | "linea" | "rect", pts: Pt[]) => {
        if (!cfg) return;
        const lista = tipo === "linea" ? cfg.lineas : cfg.zonas;
        const libre = lista.find((r) => r.vacia);
        if (!libre) { toast.error({ title: `La cámara no tiene lugar para otra ${tipo === "linea" ? "línea" : "zona"}`, description: `Tiene ${lista.length} y están todas dibujadas: borrá una o redibujá encima.` }); setHerramienta(null); return; }
        if (tipo === "poligono" && pts.length > 10) { toast.error({ title: "La zona admite hasta 10 vértices" }); return; }
        cambiar((c) => { const r = regla(`${tipo === "linea" ? "l" : "z"}${libre.id}`, c)!; r.vacia = false; r.enabled = true; r.points = pts; if (tipo === "linea") r.direction = "both"; });
        setSeleccion(`${tipo === "linea" ? "l" : "z"}${libre.id}`); setHerramienta(null);
    };
    const alCambiar = (id: string, c: { puntos?: Pt[] }) => { if (c.puntos) cambiar((n) => { const r = regla(id, n); if (r) r.points = c.puntos!; }); };
    const alBorrar = (id: string) => {
        if (cfg && !cfg.edita.borrar && !(regla(id, JSON.parse(original) as Cfg)?.vacia)) { toast.error({ title: "No se puede borrar desde acá", description: cfg.edita.motivo }); return; }
        cambiar((n) => { const r = regla(id, n); if (r) { r.vacia = true; r.points = []; } });
        setSeleccion(null);
    };

    /** Escribe en la cámara sólo lo que cambió, en una pasada por tipo. */
    const guardar = async () => {
        if (!cfg) return;
        const antes = JSON.parse(original) as Cfg;
        type Cambio = { id: number; borrar?: boolean; points?: { x: number; y: number }[]; direction?: Dir };
        const cambios = (tipo: "lineas" | "zonas"): Cambio[] => cfg[tipo].flatMap((r): Cambio[] => {
            const a = antes[tipo].find((x) => x.id === r.id);
            if (JSON.stringify(a) === JSON.stringify(r)) return [];
            if (r.vacia) return a && !a.vacia ? [{ id: r.id, borrar: true }] : [];
            if (tipo === "lineas" && r.points.length !== 2) return [];
            return [{ id: r.id, points: r.points.map(aCamara), ...(tipo === "lineas" ? { direction: r.direction } : {}) }];
        });
        const lineas = cambios("lineas"), zonas = cambios("zonas");
        if (!lineas.length && !zonas.length) return;
        setGuardando(true);
        try {
            await post({ ...(lineas.length ? { lineas } : {}), ...(zonas.length ? { zonas } : {}) });
            toast.success({ title: "Guardado en la cámara", description: "Se volvió a leer la cámara y quedó igual." });
            await cargar(); cadena.recargar();
        } catch (e) { toast.error({ title: "No se pudo guardar", description: (e as Error).message }); await cargar(); }
        finally { setGuardando(false); }
    };

    /** Sensibilidad u objetivo: van a TODAS las reglas dibujadas, en una escritura (se aplica ya). */
    const ajusteATodas = async (campo: "sensibilidad" | "objetivo", v: number | string) => {
        if (!cfg) return;
        setOcupado(campo);
        try {
            await post({ lineas: dibujadas(cfg.lineas).map((r) => ({ id: r.id, [campo]: v })), zonas: dibujadas(cfg.zonas).map((r) => ({ id: r.id, [campo]: v })) });
            toast.success({ title: campo === "sensibilidad" ? `Sensibilidad → ${v}` : `Objetivo → ${OBJETIVOS.find((o) => o.v === v)?.t}`, description: "Aplicado en todas las líneas y zonas." });
            await cargar();
        } catch (e) { toast.error({ title: "No se pudo aplicar", description: (e as Error).message }); }
        finally { setOcupado(null); }
    };
    const servidor = async (accion: "poner" | "probar") => {
        setOcupado(accion);
        try {
            const a = await fetch(`/api/devices/alarm-host?deviceId=${deviceId}${accion === "probar" ? "&action=test" : ""}`, { method: "POST" }).then((r) => r.json());
            if (!a?.ok) throw new Error(a?.error || "Sin respuesta");
            toast.success({ title: accion === "poner" ? "OmniAccess quedó como servidor de alarmas" : a.reporting ? "La cámara llegó a OmniAccess" : "Servidor puesto; la cámara no confirma la prueba", description: accion === "probar" && !a.reporting ? "Algunos modelos no implementan el aviso de prueba: probá cruzando la línea." : undefined });
            if (accion === "poner") { setAlarma(true); cadena.recargar(); }
        } catch (e) { toast.error({ title: accion === "poner" ? "La cámara no aceptó el servidor" : "No llegó el aviso de prueba", description: (e as Error).message }); }
        finally { setOcupado(null); }
    };

    const ajustes = cfg ? [...dibujadas(cfg.lineas), ...dibujadas(cfg.zonas)].find((r) => r.sensibilidad != null || r.objetivo != null) : null;
    const elegida = cfg && seleccion ? regla(seleccion, cfg) : null;
    const dock = [
        { key: "linea", label: "Línea", icono: Minus, color: COLOR_INTR.linea, herramienta: { tipo: "linea" as const, color: COLOR_INTR.linea, nombre: "Línea de cruce" }, deshabilitado: (cfg && !cfg.support.line ? "La cámara no tiene cruce de línea" : false) as string | false, ayuda: "La línea virtual de cruce: el borde del cerco o del muro. Con sentido se descartan las salidas legítimas." },
        { key: "zona", label: "Zona", icono: Hexagon, color: COLOR_INTR.zona, herramienta: { tipo: "poligono" as const, color: COLOR_INTR.zona, nombre: "Zona de intrusión", max: 10 }, deshabilitado: (cfg && !cfg.support.field ? "La cámara no tiene detección de zona" : false) as string | false, ayuda: "Un polígono: si alguien entra y se queda, la cámara avisa. Hasta 10 vértices." },
        { key: "probar", label: ocupado === "probar" ? "Probando…" : "Probar aviso", icono: Send, color: "#c4b5fd", accion: () => servidor("probar"), deshabilitado: (ocupado ? "…" : false) as string | false, ayuda: "La cámara manda un aviso de prueba a OmniAccess: confirma que el camino entero anda." },
    ];

    const panel = error ? <div className="p-5"><Vacio>{error}. <button className="underline" onClick={cargar}>Reintentar</button></Vacio></div> : !cfg ? <div className="flex items-center gap-2 p-5 text-[12.5px] text-white/60"><Loader2 size={14} className="animate-spin" /> Leyendo la analítica de la cámara…</div> : (<>
        <Seccion titulo="Lo dibujado en la cámara" icono={Layers} ayuda="Las líneas y zonas que la cámara tiene hoy, leídas recién. Lo que dibujes o muevas se escribe en la cámara con «Guardar en la cámara».">
            {dibujadas(cfg.lineas).length + dibujadas(cfg.zonas).length === 0
                ? <Vacio>La cámara no tiene nada dibujado: así no avisa nunca. Elegí <b className="text-white/80">Línea</b> o <b className="text-white/80">Zona</b> abajo y dibujá sobre la imagen.</Vacio>
                : (
                    <div className="space-y-0.5">
                        {dibujadas(cfg.lineas).map((l) => <TarjetaElemento key={`l${l.id}`} color={COLOR_INTR.linea} nombre={`Línea ${l.id}`} detalle={`Cruce · ${l.direction === "ab" ? "A→B" : l.direction === "ba" ? "B→A" : "ambos sentidos"}${l.enabled ? "" : " · apagada"}`} elegido={seleccion === `l${l.id}`} apagado={!l.enabled} alElegir={() => setSeleccion(`l${l.id}`)} />)}
                        {dibujadas(cfg.zonas).map((z) => <TarjetaElemento key={`z${z.id}`} color={COLOR_INTR.zona} nombre={`Zona ${z.id}`} detalle={`Intrusión · ${z.points.length} vértices${z.enabled ? "" : " · apagada"}`} elegido={seleccion === `z${z.id}`} apagado={!z.enabled} alElegir={() => setSeleccion(`z${z.id}`)} />)}
                    </div>
                )}
            <p className="text-[11px] text-white/40">Lugares en la cámara: {cfg.lineas.length} líneas ({cfg.lineas.filter((r) => r.vacia).length} libres) · {cfg.zonas.length} zonas ({cfg.zonas.filter((r) => r.vacia).length} libres).</p>
            {elegida && seleccion && (
                <div className="space-y-2.5 rounded-[10px] border border-white/10 bg-white/[0.04] p-3">
                    {seleccion.startsWith("l") && (<>
                        <Pildoras<Dir> valor={elegida.direction} color={COLOR_INTR.linea} cambiar={(d) => cambiar((n) => { const r = regla(seleccion, n); if (r) r.direction = d; })}
                            opciones={[{ v: "ab", t: "A → B" }, { v: "ba", t: "B → A" }, { v: "both", t: "Ambos" }]} />
                        <p className="text-[11px] leading-snug text-white/50">La flecha blanca es el cruce que dispara. Con un solo sentido se descartan las salidas legítimas.</p>
                    </>)}
                    {seleccion.startsWith("z") && <p className="text-[11px] leading-snug text-white/50">Arrastrá los vértices; el «+» de cada lado agrega uno (hasta 10) y doble clic en un vértice lo saca.</p>}
                    <BotonPanel peligro className="w-full" onClick={() => alBorrar(seleccion)}><Trash2 size={13} /> Quitar de la cámara</BotonPanel>
                </div>
            )}
        </Seccion>

        <Seccion titulo="Qué dispara" icono={Gauge} ayuda="Se aplica a todas las líneas y zonas dibujadas, en el momento.">
            {!ajustes || !cfg.edita.ajustes ? <Vacio>{!cfg.edita.ajustes ? cfg.edita.motivo || "Este equipo no deja cambiarlo desde acá." : "Dibujá una línea o una zona para ajustar la sensibilidad y el objetivo."}</Vacio> : (<>
                {ajustes.sensibilidad != null && (<div>
                    <p className="mb-1.5 flex items-center text-[12px] font-semibold text-white/80">Sensibilidad <span className="ml-auto tabular-nums text-white">{ajustes.sensibilidad}</span>{ocupado === "sensibilidad" && <Loader2 size={12} className="ml-1.5 animate-spin" />}</p>
                    <Pildoras valor={String([40, 60, 80].reduce((a, b) => (Math.abs(b - ajustes.sensibilidad!) < Math.abs(a - ajustes.sensibilidad!) ? b : a)))} opciones={SENS} color="#22d3ee" deshabilitado={!!ocupado} cambiar={(v) => ajusteATodas("sensibilidad", Number(v))} />
                    <p className="mt-1.5 text-[11px] leading-snug text-white/45">Alta detecta todo, también hojas y sombras de noche. En perímetro con vegetación, media suele ser el equilibrio.</p>
                </div>)}
                {ajustes.objetivo != null && (<div>
                    <p className="mb-1.5 flex items-center text-[12px] font-semibold text-white/80">Objetivo {ocupado === "objetivo" && <Loader2 size={12} className="ml-1.5 animate-spin" />}</p>
                    <Pildoras valor={ajustes.objetivo} opciones={OBJETIVOS} color="#34d399" deshabilitado={!!ocupado} cambiar={(v) => ajusteATodas("objetivo", v)} />
                    <p className="mt-1.5 text-[11px] leading-snug text-white/45">Filtrar a personas saca casi todas las falsas alarmas por animales, luces o lluvia.</p>
                </div>)}
            </>)}
        </Seccion>

        <Seccion titulo="Aviso a OmniAccess" icono={BellRing} ayuda="Para que un cruce llegue al monitor: la regla dibujada y prendida, «avisar al centro» en su enlace y OmniAccess como servidor de alarmas.">
            {esCamara ? <EstadoIntrusion ctl={cadena} avisa /> : (
                <div className="flex items-center gap-2.5 rounded-[10px] bg-white/[0.04] px-3 py-2.5">
                    <ShieldCheck size={15} className={alarma ? "text-emerald-400" : "text-amber-400"} />
                    <span className="flex-1 text-[12.5px] text-white">{alarma == null ? "Sin dato del servidor de alarmas" : alarma ? "OmniAccess es servidor de alarmas" : "OmniAccess no es servidor de alarmas"}</span>
                    {!alarma && <BotonPanel primario onClick={() => servidor("poner")} deshabilitado={!!ocupado}>{ocupado === "poner" ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Configurar</BotonPanel>}
                </div>
            )}
        </Seccion>
    </>);

    return {
        disponible: true, formas, seleccion, setSeleccion, herramienta, setHerramienta, dock, alCrear, alCambiar, alBorrar, panel,
        sucio: !!cfg && JSON.stringify(cfg) !== original, guardando, guardar, revertir: cargar, rotuloGuardar: "Guardar en la cámara",
    };
}
