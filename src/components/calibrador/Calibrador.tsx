"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, Image as ImageIcon, Video, RefreshCw, Aperture, ScanLine, Radar, MousePointer2, Save, RotateCcw, Camera, Keyboard } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { cn } from "@/lib/utils";
import { equipoParaCalibrar } from "@/app/actions/devices";
import { modoLprDe } from "@/lib/modo-camara";
import { ControlesLente } from "@/components/devices/LenteYLecturas";
import { Escenario, type Fondo } from "@/components/calibrador/Escenario";
import { Lienzo } from "@/components/calibrador/Lienzo";
import type { Modulo } from "@/components/calibrador/piezas";
import { useImagen } from "@/components/calibrador/modulos/imagen";
import { useLecturaOmni } from "@/components/calibrador/modulos/lectura-omni";
import { useIntrusion } from "@/components/calibrador/modulos/intrusion";

/**
 * El calibrador ÚNICO (26/11). Nico: «hay como tres calibradores distintos; el de la imagen es el
 * que deseo, a pantalla completa; dibujar en vivo sobre el video o cambiar a imagen (imagen por
 * defecto); un único calibrador, que habilite los controles según la clasificación de la cámara
 * (LPR, intrusión…), imagen, LPR e intrusión en uno solo, mejorando el uso del espacio».
 *
 * Antes eran cuatro pantallas con cuatro maneras de dibujar: el calibrador de imagen (con la
 * región ANPR en un editor aparte), el de lectura de las interiores, el de intrusión y el de
 * carriles. Ahora es una sola, a pantalla completa:
 *
 *   ┌ barra: la cámara · los módulos que corresponden · foto/vivo · cerrar ────────────────┐
 *   │ la escena (foto o vivo) con el lienzo encima          │ el panel del módulo           │
 *   │            [ herramientas de dibujo, flotando ]       │ … guardar / revertir          │
 *   └────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Qué módulos se ofrecen lo decide el tipo de la cámara (no lo que eligió quien la abrió):
 *  · Imagen — toda cámara Hikvision (exposición, IR, foco; y si es ANPR, el modo vía y su región).
 *  · Lectura — las que lee OmniVision (LPR interior y LPR de acceso sin ANPR): disparo, recorte,
 *    carriles, zonas y líneas de cruce, ajustes del lector.
 *  · Intrusión — cámaras de intrusión y LPR interiores Hikvision o Dahua: la analítica de la cámara.
 * Cada módulo guarda lo suyo; cambiar de módulo no pierde lo que no se guardó (un punto lo marca).
 */
export type ModuloId = "imagen" | "lectura" | "intrusion";
type Equipo = { id: string; name: string; deviceType: string; brand: string; deviceModel: string | null; direction: string; trackAcceso: boolean; lprVerifica: boolean; intrusionModo: string | null; tieneRtsp: boolean };

const ROTULO_TIPO: Record<string, string> = { LPR_CAMERA: "Cámara LPR", LPR_INTERIOR: "LPR interior", CAMERA: "Cámara de intrusión", DOOR_INTERCOM: "Portero", FACE_TERMINAL: "Terminal facial" };

export function Calibrador({ device, modulo: inicial, onClose }: { device: { id: string; name?: string }; modulo?: ModuloId; onClose: () => void }) {
    const [eq, setEq] = useState<Equipo | null>(null);
    const [fondo, setFondo] = useState<Fondo>("imagen");
    const [nonce, setNonce] = useState(() => Date.now());
    const [lupa, setLupa] = useState<string | null>(null);
    const [activo, setActivo] = useState<ModuloId | null>(inicial || null);
    const [salir, setSalir] = useState(false);
    const [atajos, setAtajos] = useState(false);
    const [montado, setMontado] = useState(false);
    useEffect(() => { const t = setTimeout(() => setMontado(true), 0); return () => clearTimeout(t); }, []);

    useEffect(() => { equipoParaCalibrar(device.id).then((d) => setEq(d as Equipo | null)).catch(() => setEq(null)); }, [device.id]);

    // Qué corresponde a esta cámara.
    const disp = useMemo(() => {
        if (!eq) return null;
        const hik = eq.brand === "HIKVISION", dahua = eq.brand === "DAHUA";
        const omni = eq.deviceType === "LPR_INTERIOR" || modoLprDe({ deviceType: eq.deviceType, trackAcceso: eq.trackAcceso }) === "omnivision";
        const anpr = eq.deviceType === "LPR_CAMERA";
        return {
            imagen: { ok: hik, motivo: hik ? "" : "La imagen se calibra en cámaras Hikvision." },
            lectura: { ok: omni && eq.tieneRtsp, motivo: !omni ? (anpr ? "La lee el ANPR de la cámara: su región está en Imagen." : "Esta cámara no lee matrículas.") : "Falta el video (RTSP) de la cámara." },
            intrusion: { ok: (eq.deviceType === "CAMERA" || eq.deviceType === "LPR_INTERIOR") && (hik || dahua), motivo: "La analítica de intrusión es de cámaras de intrusión Hikvision o Dahua." },
            anpr,
        };
    }, [eq]);
    useEffect(() => {
        if (!disp || (activo && disp[activo].ok)) return;
        const primero = (["lectura", "intrusion", "imagen"] as ModuloId[]).find((m) => disp[m].ok);
        const t = setTimeout(() => setActivo(primero || null), 0); return () => clearTimeout(t);
    }, [disp, activo]);

    const refrescar = useCallback(() => setNonce(Date.now()), []);
    const mImagen = useImagen(device.id, !!disp?.imagen.ok && activo === "imagen", !!disp?.anpr, refrescar);
    const mLectura = useLecturaOmni(device.id, !!disp?.lectura.ok && activo === "lectura");
    const mIntr = useIntrusion(device.id, !!disp?.intrusion.ok && activo === "intrusion", eq?.deviceType === "CAMERA");
    const mods: Record<ModuloId, Modulo> = { imagen: mImagen, lectura: mLectura, intrusion: mIntr };
    const m = activo ? mods[activo] : null;
    const algunoSucio = (Object.keys(mods) as ModuloId[]).some((k) => mods[k].sucio);

    const cerrar = useCallback(() => { if (algunoSucio) setSalir(true); else onClose(); }, [algunoSucio, onClose]);
    // Teclado: 1–9 eligen herramienta, V vuelve a elegir, F alterna foto/vivo, Esc cierra (si nada lo tomó antes).
    useEffect(() => {
        const k = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === "Escape") { if (salir) setSalir(false); else cerrar(); return; }
            if (!m) return;
            if (e.key.toLowerCase() === "v") m.setHerramienta(null);
            if (e.key.toLowerCase() === "f") setFondo((f) => (f === "imagen" ? "vivo" : "imagen"));
            const n = Number(e.key);
            if (n >= 1 && n <= m.dock.length) { const d = m.dock[n - 1]; if (d.deshabilitado) return; if (d.accion) d.accion(); else { m.setSeleccion(null); m.setHerramienta(m.herramienta === d.key ? null : d.key); } }
        };
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    }, [m, cerrar, salir]);

    const herramienta = m?.herramienta ? m.dock.find((d) => d.key === m.herramienta)?.herramienta || null : null;
    const MODULOS: { id: ModuloId; t: string; icono: typeof Aperture }[] = [
        { id: "imagen", t: "Imagen", icono: Aperture },
        { id: "lectura", t: "Lectura LPR", icono: ScanLine },
        { id: "intrusion", t: "Intrusión", icono: Radar },
    ];

    const ui = (
        <div className="dark fixed inset-0 z-[3400] flex flex-col bg-[#07090d] text-white animate-in fade-in duration-200">
            {/* ── La barra ── */}
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/[0.06] text-white/80"><Camera size={17} /></span>
                <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold leading-tight">{eq?.name || device.name || "Cámara"}</p>
                    <p className="truncate text-[11px] text-white/45">{eq ? [ROTULO_TIPO[eq.deviceType] || eq.deviceType, eq.brand === "HIKVISION" ? "Hikvision" : eq.brand === "DAHUA" ? "Dahua" : eq.brand, eq.deviceModel].filter(Boolean).join(" · ") : "Leyendo el equipo…"}</p>
                </div>

                <nav className="mx-auto flex items-center gap-1 rounded-full bg-white/[0.05] p-1">
                    {MODULOS.map((x) => {
                        const d = disp?.[x.id]; const on = activo === x.id;
                        return (
                            <button key={x.id} type="button" disabled={!d?.ok} title={d && !d.ok ? d.motivo : undefined} onClick={() => setActivo(x.id)}
                                className={cn("relative inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors", on ? "text-black" : "text-white/70 hover:text-white", !d?.ok && "cursor-not-allowed opacity-35")}>
                                {on && <motion.span layoutId="calib-modulo" className="absolute inset-0 rounded-full bg-white" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                                <x.icono size={14} className="relative" /><span className="relative">{x.t}</span>
                                {mods[x.id].sucio && <span className={cn("relative h-1.5 w-1.5 rounded-full", on ? "bg-amber-600" : "bg-amber-400")} title="Cambios sin guardar" />}
                            </button>
                        );
                    })}
                </nav>

                <div className="flex items-center gap-1 rounded-full bg-white/[0.05] p-1">
                    {([["imagen", "Foto", ImageIcon], ["vivo", "Vivo", Video]] as const).map(([k, t, I]) => (
                        <button key={k} type="button" onClick={() => setFondo(k)} title={k === "imagen" ? "Dibujar sobre una foto de la cámara (F)" : "Dibujar sobre el video en vivo (F)"}
                            className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold", fondo === k ? "bg-white/15 text-white" : "text-white/60 hover:text-white")}>
                            {k === "vivo" && fondo === "vivo" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> : <I size={13} />}{t}
                        </button>
                    ))}
                </div>
                {fondo === "imagen" && <button type="button" onClick={refrescar} title="Sacar una foto nueva" className="grid h-9 w-9 place-items-center rounded-full text-white/60 hover:bg-white/[0.08] hover:text-white"><RefreshCw size={15} /></button>}
                <button type="button" onClick={() => setAtajos((v) => !v)} title="Atajos de teclado" className="grid h-9 w-9 place-items-center rounded-full text-white/60 hover:bg-white/[0.08] hover:text-white"><Keyboard size={15} /></button>
                <button type="button" onClick={cerrar} title="Cerrar (Esc)" className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/80 hover:bg-white/[0.14]"><X size={17} /></button>
            </header>

            <div className="flex min-h-0 flex-1">
                {/* ── La escena ── */}
                <main className={cn("relative min-w-0 flex-1 p-4", m && m.dock.length ? "pb-24" : "pb-4")}>
                    <Escenario deviceId={device.id} fondo={fondo} nonce={nonce} alCargarFoto={setLupa}>
                        {m?.capa}
                        {m && <Lienzo formas={m.formas} seleccion={m.seleccion} herramienta={herramienta} lupa={lupa}
                            alSeleccionar={m.setSeleccion} alCambiar={m.alCambiar} alCrear={m.alCrear} alCancelar={() => m.setHerramienta(null)} alBorrar={m.alBorrar} />}
                    </Escenario>
                    {activo === "imagen" && <ControlesLente deviceId={device.id} className="z-20" />}

                    {/* Las herramientas, flotando abajo de la escena. */}
                    {m && m.dock.length > 0 && (
                        <div className="absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
                            <div className="flex items-center gap-1 rounded-[16px] border border-white/10 bg-[#0f131a]/90 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                                <BotonDock activo={!m.herramienta} onClick={() => m.setHerramienta(null)} icono={MousePointer2} label="Elegir" atajo="V" color="#ffffff" ayuda="Elegir y ajustar lo dibujado: arrastrá vértices o la figura entera." />
                                <span className="mx-1 h-8 w-px bg-white/10" />
                                {m.dock.map((d, i) => (
                                    <BotonDock key={d.key} activo={m.herramienta === d.key} deshabilitado={d.deshabilitado || undefined} onClick={() => { if (d.accion) d.accion(); else { m.setSeleccion(null); m.setHerramienta(m.herramienta === d.key ? null : d.key); } }}
                                        icono={d.icono} label={d.label} atajo={String(i + 1)} color={d.color} ayuda={d.ayuda} separado={!!d.accion && !m.dock[i - 1]?.accion} />
                                ))}
                            </div>
                        </div>
                    )}

                    <AnimatePresence>
                        {atajos && (
                            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="absolute right-5 top-5 z-40 w-[290px] rounded-[14px] border border-white/10 bg-[#0f131a]/95 p-4 text-[12px] shadow-2xl backdrop-blur-xl">
                                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/50">Atajos</p>
                                {[["1 – 9", "Elegir herramienta"], ["V", "Volver a elegir"], ["Enter / doble clic", "Cerrar la figura"], ["Backspace", "Sacar el último punto"], ["Supr", "Borrar lo elegido"], ["Doble clic en un vértice", "Sacarlo"], ["«+» en un lado", "Agregar un vértice"], ["F", "Foto / vivo"], ["Esc", "Cancelar · cerrar"]].map(([a, b]) => (
                                    <div key={a} className="flex items-center justify-between gap-3 py-1"><span className="text-white/70">{b}</span><kbd className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-white/85">{a}</kbd></div>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </main>

                {/* ── El panel del módulo ── */}
                <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/[0.07] bg-[#0b0e14]">
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {!eq || !disp ? <div className="flex items-center gap-2 p-5 text-[12.5px] text-white/60"><Loader2 size={14} className="animate-spin" /> Leyendo el equipo…</div>
                            : !m ? <div className="p-5 text-[12.5px] text-white/60">Esta cámara no tiene nada para calibrar desde acá.</div>
                                : <AnimatePresence mode="wait"><motion.div key={activo} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.16 }}>{m.panel}</motion.div></AnimatePresence>}
                    </div>
                    {m?.guardar && (
                        <footer className="flex shrink-0 items-center gap-2 border-t border-white/[0.07] px-4 py-3">
                            <span className={cn("flex-1 whitespace-nowrap text-[11.5px]", m.sucio ? "text-amber-300" : "text-white/40")}>{m.guardando ? "Aplicando…" : m.sucio ? "Sin guardar" : "Guardado"}</span>
                            <button type="button" onClick={m.revertir} disabled={!m.sucio || m.guardando} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-[12.5px] font-semibold text-white/75 hover:bg-white/[0.07] disabled:opacity-35"><RotateCcw size={14} /> Revertir</button>
                            <button type="button" onClick={() => m.guardar?.()} disabled={!m.sucio || m.guardando} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[6px] bg-[var(--accion)] px-4 text-[12.5px] font-bold text-white hover:brightness-110 disabled:opacity-35">
                                {m.guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {m.rotuloGuardar || "Guardar"}
                            </button>
                        </footer>
                    )}
                </aside>
            </div>

            {/* Salir con cambios sin guardar. */}
            <AnimatePresence>
                {salir && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
                        <motion.div initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }} className="w-[380px] rounded-[14px] border border-white/10 bg-[#0f131a] p-5">
                            <p className="text-[14px] font-bold">Hay cambios sin guardar</p>
                            <p className="mt-1 text-[12.5px] text-white/60">En {(Object.keys(mods) as ModuloId[]).filter((k) => mods[k].sucio).map((k) => MODULOS.find((x) => x.id === k)!.t).join(" y ")}. Si salís, se pierden.</p>
                            <div className="mt-4 flex justify-end gap-2">
                                <button type="button" onClick={() => setSalir(false)} className="h-9 rounded-[6px] px-3 text-[12.5px] font-semibold text-white/80 hover:bg-white/[0.07]">Seguir calibrando</button>
                                <button type="button" onClick={onClose} className="h-9 rounded-[6px] bg-red-500/90 px-3 text-[12.5px] font-bold text-white hover:bg-red-500">Salir sin guardar</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
    return montado ? createPortal(ui, document.body) : null;
}

function BotonDock({ activo, onClick, icono: I, label, atajo, color, ayuda, deshabilitado, separado }: { activo: boolean; onClick: () => void; icono: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>; label: string; atajo: string; color: string; ayuda: string; deshabilitado?: string; separado?: boolean }) {
    return (<>
        {separado && <span className="mx-1 h-8 w-px bg-white/10" />}
        <button type="button" onClick={onClick} disabled={!!deshabilitado} title={deshabilitado ? `${label}: ${deshabilitado}` : `${label} (${atajo}) — ${ayuda}`}
            className={cn("group relative flex h-14 w-[74px] flex-col items-center justify-center gap-1 rounded-[12px] text-[11px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30",
                activo ? "bg-white/[0.12] text-white" : "text-white/65 hover:bg-white/[0.06] hover:text-white")}
            style={activo ? { boxShadow: `inset 0 0 0 1.5px ${color}, 0 0 18px ${color}33` } : undefined}>
            <I size={18} style={{ color }} />
            <span>{label}</span>
            <span className="absolute right-1.5 top-1 text-[8.5px] font-bold text-white/30">{atajo}</span>
        </button>
    </>);
}
