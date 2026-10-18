"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { sileo as toast } from "sileo";
import { AlertTriangle, Car, Check, Clock, Loader2, Minus, Pencil, Plus, RefreshCw, ScanEye, SquareParking, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { cn } from "@/lib/utils";
import { horaSeg } from "@/lib/fechas";
import {
    listarEstacionamiento, guardarEstacionamiento, borrarEstacionamiento, probarAhora,
    type CamaraEstacionamiento,
} from "@/app/actions/estacionamiento";

/**
 * Visión → Estacionamiento (18/10, Nico: «que sea una analítica más de OmniVision, activable
 * como el resto; auditá, mejorá y corregí lo visual y lo lógico»).
 *
 * Una pantalla para las dos cosas que se hacen con el estacionamiento: DIBUJAR dónde se estaciona
 * (la franja sobre el cordón y cuántos lugares entran) y MIRAR cómo está cada lugar ahora, con la
 * chapa de quien lo ocupa y desde cuándo. Antes el dibujo vivía escondido en el calibrador del
 * monitor de intrusión, sólo para cámaras LPR interiores, con un «Tomar cuadro» que no mostraba
 * la foto y un «Está vacía ahora» que siempre contestaba «libre».
 *
 * El estado de cada lugar lo decide OmniVision viendo los vehículos (lib/estacionamiento): no hay
 * que enseñarle la calle vacía.
 */

type Punto = { x: number; y: number };
type Esq = [Punto, Punto, Punto, Punto];
type Datos = Awaited<ReturnType<typeof listarEstacionamiento>>;
type Prueba = Awaited<ReturnType<typeof probarAhora>>;

/** Franja de arranque: la mitad baja del cuadro, donde suele caer la calzada. Para mover, no para usar tal cual. */
const FRANJA_INICIAL: Esq = [{ x: 0.08, y: 0.62 }, { x: 0.92, y: 0.52 }, { x: 0.92, y: 0.78 }, { x: 0.08, y: 0.95 }];
const REFRESCO_MS = 10_000;

const mezclar = (p: Punto, q: Punto, t: number): Punto => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
/** La misma fórmula que lib/franja (celda i entre lerp(a,b) y lerp(d,c)): el dibujo no puede esperar un viaje. */
function celdaDe(e: Esq, i: number, n: number): Punto[] {
    const p = (u: number, v: number) => { const t = (i + u) / n; return mezclar(mezclar(e[0], e[1], t), mezclar(e[3], e[2], t), v); };
    return [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
}
const lapso = (desdeMs: number) => {
    const m = Math.max(0, Math.round((Date.now() - desdeMs) / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
};

export default function Pagina() {
    return <Suspense fallback={<Cargando />}><Estacionamiento /></Suspense>;
}

function Estacionamiento() {
    const sp = useSearchParams();
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [elegida, setElegida] = useState<string | null>(sp.get("camara"));
    const [, setTic] = useState(0);

    const cargar = useCallback(async () => {
        try { setDatos(await listarEstacionamiento()); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudo traer el estacionamiento"); }
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(() => { cargar(); setTic((n) => n + 1); }, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);

    const conFranja = useMemo(() => (datos?.camaras || []).filter((c) => c.franja), [datos]);
    const sinFranja = useMemo(() => (datos?.camaras || []).filter((c) => !c.franja), [datos]);
    // De entrada, la primera con franja.
    useEffect(() => { if (!elegida && conFranja[0]) setElegida(conFranja[0].id); }, [elegida, conFranja]);
    const cam = datos?.camaras.find((c) => c.id === elegida) || null;

    const totales = useMemo(() => {
        let lugares = 0, ocupados = 0;
        for (const c of conFranja) { if (!c.franja?.activa) continue; lugares += c.franja.lugares; ocupados += c.abiertas.length; }
        return { lugares, ocupados };
    }, [conFranja]);

    if (error && !datos) return <div className="p-6"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6"><Cargando texto="Trayendo los lugares…" /></div>;

    return (
        <div className="px-6 lg:px-8 py-5 max-w-[1500px] mx-auto space-y-5">
            <header className="flex flex-wrap items-start gap-4">
                <span className="w-11 h-11 rounded-[10px] grid place-items-center bg-muted border border-border shrink-0"><SquareParking size={20} className="text-[var(--accion)]" /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[22px] font-bold tracking-[-0.01em] leading-tight">Estacionamiento</h1>
                    <p className="text-[13px] text-muted-foreground mt-0.5 max-w-[760px]">
                        Se dibuja una franja sobre el cordón con los lugares que entran, y OmniVision mira qué lugares tienen un vehículo.
                        Un lugar se ocupa cuando el vehículo se queda {datos.ocuparSeg} s, avisa «estacionó» a los 3 min y queda libre a los {datos.liberarSeg} s de no verlo.
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {datos.prendida
                        ? <Chip tono="bien" icono={Check}>Analítica prendida</Chip>
                        : <Chip tono="aviso" icono={AlertTriangle}>Analítica apagada</Chip>}
                    <Link href="/admin/vision/analiticas" className="text-[12.5px] font-semibold text-[var(--accion)] hover:underline">{datos.prendida ? "Analíticas" : "Prenderla en Analíticas"}</Link>
                </div>
            </header>

            {!datos.prendida && (
                <div className="rounded-[10px] border border-[var(--aviso)]/40 bg-[var(--aviso)]/10 px-4 py-3 text-[12.5px] tono-aviso">
                    Con la analítica apagada nadie mira los lugares: lo que se ve abajo es lo último que se midió.
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5 items-start">
                {/* ── Las cámaras ── */}
                <aside className="space-y-3">
                    <div className="flex items-baseline justify-between">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cámaras con lugares</div>
                        <div className="text-[12px] text-muted-foreground tabular-nums">{totales.ocupados} de {totales.lugares} ocupados</div>
                    </div>
                    {conFranja.length === 0 && <p className="text-[12.5px] text-muted-foreground">Todavía no hay ninguna. Elegí una cámara abajo y dibujá dónde se estaciona.</p>}
                    <div className="space-y-1.5">
                        {conFranja.map((c) => <TarjetaCamara key={c.id} c={c} activa={c.id === elegida} onClick={() => setElegida(c.id)} />)}
                    </div>
                    {sinFranja.length > 0 && (
                        <div className="pt-2">
                            <label className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground" htmlFor="otra">Agregar en otra cámara</label>
                            <select id="otra" value="" onChange={(e) => e.target.value && setElegida(e.target.value)}
                                className="mt-1.5 w-full h-9 rounded-[6px] border border-border bg-background px-2 text-[13px]">
                                <option value="">Elegir cámara…</option>
                                {sinFranja.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.mirada ? "" : " (no la mira OmniVision)"}</option>)}
                            </select>
                        </div>
                    )}
                </aside>

                {/* ── La cámara elegida ── */}
                <section className="min-w-0">
                    {cam ? <PanelCamara key={cam.id} c={cam} alCambiar={cargar} prendida={datos.prendida} /> : (
                        <div className="h-[360px] rounded-[10px] border border-dashed border-border grid place-items-center text-[13px] text-muted-foreground">Elegí una cámara.</div>
                    )}
                </section>
            </div>

            {datos.recientes.length > 0 && (
                <section>
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Se retiraron en las últimas 24 h</div>
                    <div className="rounded-[10px] border border-border divide-y divide-border">
                        {datos.recientes.map((o) => (
                            <div key={o.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                                <span className="w-16 text-muted-foreground tabular-nums">{horaSeg(o.hasta)}</span>
                                <PlacaChica texto={o.plate} />
                                <span className="text-muted-foreground truncate">{o.camara} · lugar {o.lugar + 1}</span>
                                <span className="ml-auto text-muted-foreground tabular-nums">{lapsoEntre(o.desde, o.hasta)}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

const lapsoEntre = (a: string, b: string) => {
    const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function PlacaChica({ texto }: { texto: string | null }) {
    return texto
        ? <span className="inline-flex items-center h-[20px] px-1.5 rounded-[4px] bg-white text-black text-[11px] font-bold tabular-nums tracking-[0.06em] ring-1 ring-black/15">{texto}</span>
        : <span className="inline-flex items-center h-[20px] px-1.5 rounded-[4px] border border-dashed border-border text-muted-foreground text-[11px]">sin chapa</span>;
}

function TarjetaCamara({ c, activa, onClick }: { c: CamaraEstacionamiento; activa: boolean; onClick: () => void }) {
    const f = c.franja!;
    const ocupado = new Set(c.abiertas.map((o) => o.lugar));
    const sinDatos = !c.mirada || !c.vivo || c.vivo.vieja;
    return (
        <button type="button" onClick={onClick} aria-pressed={activa}
            className={cn("w-full text-left rounded-[10px] border px-3 py-2.5 transition-colors", activa ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-muted/60")}>
            <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold truncate">{f.nombre || c.nombre}</span>
                <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">{ocupado.size}/{f.lugares}</span>
            </div>
            {f.nombre && <div className="text-[11px] text-muted-foreground truncate">{c.nombre}</div>}
            {/* Los lugares en fila: lleno = ocupado. Se lee de un vistazo cuántos quedan. */}
            <div className="mt-2 flex gap-[3px]">
                {Array.from({ length: f.lugares }, (_, i) => (
                    <span key={i} className={cn("h-1.5 flex-1 rounded-full", !f.activa ? "bg-muted" : ocupado.has(i) ? "bg-[var(--accion)]" : "bg-muted-foreground/20")} />
                ))}
            </div>
            {(!f.activa || sinDatos) && (
                <div className={cn("mt-1.5 text-[11px]", !f.activa ? "text-muted-foreground" : "tono-aviso")}>
                    {!f.activa ? "Apagada" : !c.mirada ? "OmniVision no mira esta cámara" : "Sin miradas recientes"}
                </div>
            )}
        </button>
    );
}

/**
 * Una cámara: el cuadro con los lugares encima (en vivo, o editando la franja), y la lista de lugares.
 */
function PanelCamara({ c, alCambiar, prendida }: { c: CamaraEstacionamiento; alCambiar: () => void; prendida: boolean }) {
    const [editando, setEditando] = useState(!c.franja);
    const [esq, setEsq] = useState<Esq>((c.franja?.esquinas as Esq) || FRANJA_INICIAL);
    const [lugares, setLugares] = useState(c.franja?.lugares || 6);
    const [nombre, setNombre] = useState(c.franja?.nombre || "");
    const [activa, setActiva] = useState(c.franja?.activa ?? true);
    const [guardando, setGuardando] = useState(false);
    const [prueba, setPrueba] = useState<Prueba | null>(null);
    const [probando, setProbando] = useState(false);
    const [borrar, setBorrar] = useState(false);
    // El cuadro de la cámara: el mismo stream que mira OmniVision; se renueva solo mientras no se edita.
    const [vuelta, setVuelta] = useState(0);
    useEffect(() => { if (editando) return; const iv = setInterval(() => setVuelta((v) => v + 1), REFRESCO_MS); return () => clearInterval(iv); }, [editando]);
    const foto = prueba?.foto || `/api/vision/cuadro?camara=${encodeURIComponent(c.id)}&v=${vuelta}`;
    const [fotoMal, setFotoMal] = useState(false);

    const cancelar = () => {
        setEsq((c.franja?.esquinas as Esq) || FRANJA_INICIAL); setLugares(c.franja?.lugares || 6); setNombre(c.franja?.nombre || ""); setActiva(c.franja?.activa ?? true);
        setPrueba(null); setEditando(!c.franja);
    };
    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await guardarEstacionamiento(c.id, { esquinas: esq, lugares, activa, nombre });
            if (!r.ok) { toast.error({ title: r.error || "No se pudo guardar" }); return; }
            toast.success({ title: "Lugares guardados", description: r.cerradas ? `Se cerraron ${r.cerradas} ocupaciones de la franja anterior.` : "OmniVision empieza a mirarlos en la próxima vuelta." });
            setEditando(false); setPrueba(null); alCambiar();
        } catch (e: any) { toast.error({ title: e?.message || "No se pudo guardar" }); }
        finally { setGuardando(false); }
    };
    const probar = async () => {
        setProbando(true);
        try {
            const r = await probarAhora(c.id, esq, lugares);
            setPrueba(r);
            if (!r.ok) toast.error({ title: r.error || "No se pudo probar" });
        } catch (e: any) { toast.error({ title: e?.message || "No se pudo probar" }); }
        finally { setProbando(false); }
    };

    const porLugar = new Map(c.abiertas.map((o) => [o.lugar, o]));
    const n = editando ? lugares : c.franja?.lugares || lugares;
    const geom = editando ? esq : ((c.franja?.esquinas as Esq) || esq);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[16px] font-bold mr-1">{c.franja?.nombre || c.nombre}</h2>
                {!c.mirada && <Chip tono="aviso" icono={AlertTriangle} title="Agregala en Visión → Laboratorio → cámaras">OmniVision no la mira</Chip>}
                {c.mirada && c.franja && !editando && (c.vivo && !c.vivo.vieja
                    ? <Chip tono="bien" icono={ScanEye}>Mirando · {horaSeg(c.vivo.ultimaMirada!)}</Chip>
                    : <Chip tono="quieto" icono={Clock}>{prendida ? "Esperando la primera mirada" : "Sin mirar"}</Chip>)}
                <div className="ml-auto flex items-center gap-2">
                    {!editando && c.franja && <Button size="sm" variant="outline" onClick={() => setEditando(true)}><Pencil size={14} /> Editar lugares</Button>}
                    {!editando && c.franja && <Button size="sm" variant="outline" onClick={() => setBorrar(true)}><Trash2 size={14} /> Quitar</Button>}
                </div>
            </div>

            {/* ── El cuadro con los lugares ── */}
            <div className="relative rounded-[10px] overflow-hidden bg-black select-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={foto} alt={`Cuadro de ${c.nombre}`} className="block w-full h-auto" draggable={false}
                    onLoad={() => setFotoMal(false)} onError={() => setFotoMal(true)} />
                {fotoMal && <div className="absolute inset-0 grid place-items-center text-white/80 text-[13px]">La cámara no entregó un cuadro.</div>}
                <Lienzo esq={geom} n={n} editable={editando} setEsq={setEsq} abiertas={editando ? new Map() : porLugar}
                    vivo={editando ? null : c.vivo} prueba={prueba} />
            </div>

            {editando ? (
                <div className="rounded-[10px] border border-border p-4 space-y-4">
                    <p className="text-[12.5px] text-muted-foreground">Arrastrá las cuatro esquinas sobre el cordón: el lado de arriba y el de abajo siguen la calle, y los lugares se achican solos con la distancia. Poné cuántos autos entran.</p>
                    <div className="flex flex-wrap items-end gap-5">
                        <div>
                            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Lugares</div>
                            <div className="flex items-center rounded-[6px] border border-border">
                                <button type="button" onClick={() => setLugares((x) => Math.max(1, x - 1))} className="w-9 h-9 grid place-items-center hover:bg-muted" aria-label="Uno menos"><Minus size={15} /></button>
                                <span className="w-10 text-center text-[15px] font-bold tabular-nums">{lugares}</span>
                                <button type="button" onClick={() => setLugares((x) => Math.min(40, x + 1))} className="w-9 h-9 grid place-items-center hover:bg-muted" aria-label="Uno más"><Plus size={15} /></button>
                            </div>
                        </div>
                        <div className="min-w-[220px] flex-1">
                            <label htmlFor="nombre-franja" className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Nombre (opcional)</label>
                            <input id="nombre-franja" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Calle 21, vereda norte"
                                className="mt-1.5 w-full h-9 rounded-[6px] border border-border bg-background px-3 text-[13px]" />
                        </div>
                        <label className="flex items-center gap-2 h-9 text-[13px]">
                            <Switch checked={activa} onCheckedChange={setActiva} /> {activa ? "Mide" : "Apagada"}
                        </label>
                    </div>
                    {prueba?.ok && (
                        <p className="text-[12.5px]">
                            <b>Ahora:</b> OmniVision ve {prueba.vehiculos?.length || 0} {prueba.vehiculos?.length === 1 ? "vehículo" : "vehículos"}; {prueba.ocupados?.filter((x) => x != null).length || 0} {prueba.ocupados?.filter((x) => x != null).length === 1 ? "cae" : "caen"} en algún lugar.
                            {(prueba.vehiculos || []).some((v) => v.lugar == null) && " Los que están afuera de la franja se ven en gris."}
                        </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" onClick={probar} disabled={probando}>{probando ? <Loader2 size={14} className="animate-spin" /> : <ScanEye size={14} />} Probar ahora</Button>
                        <span className="ml-auto flex items-center gap-2">
                            {c.franja && <Button size="sm" variant="outline" onClick={cancelar} disabled={guardando}><X size={14} /> Cancelar</Button>}
                            <Button size="sm" onClick={guardar} disabled={guardando}>{guardando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar lugares</Button>
                        </span>
                    </div>
                </div>
            ) : c.franja && (
                <div className="rounded-[10px] border border-border divide-y divide-border">
                    {Array.from({ length: c.franja.lugares }, (_, i) => {
                        const o = porLugar.get(i);
                        const viendo = c.vivo?.lugares?.[i];
                        const confirmando = !o && viendo?.vistoDesde != null && !c.vivo?.vieja;
                        return (
                            <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                                <span className="w-7 h-7 rounded-[6px] grid place-items-center bg-muted text-[12px] font-bold tabular-nums">{i + 1}</span>
                                {o ? (
                                    <>
                                        <span className={cn("inline-flex items-center gap-1 text-[12px] font-semibold", o.avisado ? "tono-info" : "tono-aviso")}><Car size={14} /> {o.avisado ? "Estacionado" : "Recién llegado"}</span>
                                        <PlacaChica texto={o.plate} />
                                        <span className="ml-auto text-muted-foreground tabular-nums">desde {horaSeg(o.desde)} · {lapso(new Date(o.desde).getTime())}</span>
                                    </>
                                ) : confirmando ? (
                                    <span className="text-[12px] tono-aviso">Hay un vehículo · confirmando</span>
                                ) : (
                                    <span className="text-[12px] text-muted-foreground">Libre</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {borrar && (
                <ConfirmarAccion id={c.id} title={`los lugares de ${c.franja?.nombre || c.nombre}`}
                    description={`Se borra la franja. ${c.abiertas.length ? `Las ${c.abiertas.length} ocupaciones abiertas se cierran con su «se retiró».` : ""}`}
                    etiquetaAccion="Quitar" open={borrar} onOpenChange={setBorrar}
                    onDelete={async (id) => { await borrarEstacionamiento(id); }}
                    onSuccess={() => { setBorrar(false); alCambiar(); }} />
            )}
        </div>
    );
}

/**
 * Los lugares sobre el cuadro. Dibuja en fracciones de la imagen (la imagen va a lo ancho, sin
 * bandas), así que no hay encuadre que calcular. Editando, las esquinas se arrastran.
 */
function Lienzo({ esq, n, editable, setEsq, abiertas, vivo, prueba }: {
    esq: Esq; n: number; editable: boolean; setEsq: (e: Esq) => void;
    abiertas: Map<number, { plate: string | null; desde: string; avisado: boolean }>;
    vivo: CamaraEstacionamiento["vivo"]; prueba: Prueba | null;
}) {
    const caja = useRef<HTMLDivElement>(null);
    const arrastra = useRef<number | null>(null);
    const esqRef = useRef(esq); esqRef.current = esq;
    useEffect(() => {
        if (!editable) return;
        const mover = (ev: PointerEvent) => {
            const i = arrastra.current; const r = caja.current?.getBoundingClientRect();
            if (i == null || !r) return;
            const p = { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
            const q = [...esqRef.current] as Esq; q[i] = p; setEsq(q);
        };
        const soltar = () => { arrastra.current = null; };
        window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar);
        return () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
    }, [editable, setEsq]);
    const pts = (q: Punto[]) => q.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
    const ocupadosPrueba = prueba?.ok ? prueba.ocupados || [] : [];

    return (
        <div ref={caja} className="absolute inset-0">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                {Array.from({ length: n }, (_, i) => {
                    const q = celdaDe(esq, i, n);
                    const o = abiertas.get(i);
                    const viendo = vivo?.lugares?.[i]?.vistoDesde != null && !vivo?.vieja;
                    const enPrueba = ocupadosPrueba[i] != null;
                    const lleno = !!o || enPrueba;
                    return (
                        <polygon key={i} points={pts(q)} vectorEffect="non-scaling-stroke"
                            fill={lleno ? "color-mix(in oklab, var(--accion-en-oscuro) 34%, transparent)" : viendo ? "color-mix(in oklab, var(--aviso) 22%, transparent)" : "rgba(255,255,255,0.04)"}
                            stroke={lleno ? "var(--accion-en-oscuro)" : viendo ? "var(--aviso)" : "rgba(255,255,255,0.75)"}
                            strokeWidth={lleno ? 2 : 1.25} strokeDasharray={!lleno && viendo ? "5 3" : undefined} />
                    );
                })}
                {/* Lo que vio OmniVision al probar: cada vehículo con su caja; gris si cae afuera de la franja. */}
                {prueba?.ok && (prueba.vehiculos || []).map((v, k) => (
                    <rect key={k} x={v.caja[0] * 100} y={v.caja[1] * 100} width={(v.caja[2] - v.caja[0]) * 100} height={(v.caja[3] - v.caja[1]) * 100} vectorEffect="non-scaling-stroke"
                        fill="none" stroke={v.lugar != null ? "var(--accion-en-oscuro)" : "rgba(255,255,255,0.45)"} strokeWidth={1.5} strokeDasharray={v.lugar != null ? undefined : "4 3"} />
                ))}
            </svg>
            {/* Los rótulos de cada lugar: número, y chapa y tiempo si está ocupado. En HTML para que no se deformen. */}
            {Array.from({ length: n }, (_, i) => {
                const q = celdaDe(esq, i, n);
                const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
                const o = abiertas.get(i);
                return (
                    <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center gap-0.5" style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}>
                        <span className="min-w-5 h-5 px-1 rounded-full bg-black/60 text-white text-[10.5px] font-bold tabular-nums grid place-items-center">{i + 1}</span>
                        {o && (
                            <span className="flex flex-col items-center">
                                {o.plate && <span className="px-1 rounded-[3px] bg-white text-black text-[10px] font-bold tracking-[0.05em] tabular-nums">{o.plate}</span>}
                                <span className="mt-0.5 px-1 rounded-[3px] bg-black/65 text-white text-[9.5px] tabular-nums">{lapso(new Date(o.desde).getTime())}</span>
                            </span>
                        )}
                    </div>
                );
            })}
            {editable && esq.map((p, i) => (
                <button key={i} type="button" aria-label={`Esquina ${i + 1}`} onPointerDown={(e) => { e.preventDefault(); arrastra.current = i; }}
                    className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-[var(--accion-en-oscuro)] cursor-grab active:cursor-grabbing touch-none"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
            ))}
            {editable && <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-[6px] bg-black/60 text-white text-[11px] font-semibold pointer-events-none"><RefreshCw size={11} /> Editando: arrastrá las esquinas</span>}
        </div>
    );
}
