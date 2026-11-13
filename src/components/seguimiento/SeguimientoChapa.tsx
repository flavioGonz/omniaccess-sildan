"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, CircleParking, History, Loader2, LogIn, LogOut, MoveRight, Radio, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getImagePath } from "@/lib/image-path";
import { useTiempoReal } from "@/lib/tiempo-real";
import { CartelRequerida } from "@/components/CartelRequerida";
import { cuantoDuro, puedeSerLaMisma, type Seguimiento, type Tramo } from "@/lib/seguimiento-chapa";

/**
 * «Seguirlo»: el cajón de una matrícula — dónde está ahora y desde cuándo, o cuándo se fue y
 * cuánto estuvo, y su recorrido (13/11, Nico: «debe ser posible ver su llegada y partida, un
 * seguimiento más cercano sobre esa detección»).
 *
 * Es una vista, no un interruptor: no hay nada que «activar» para que una chapa se pueda seguir;
 * la historia sale de lo que el sistema ya guarda (api/seguimiento). Lo que sí es automático para
 * las de la lista negra son los avisos de llegada («a la vista») y de partida («se fue»).
 *
 * Se actualiza solo: con cada estadía que abre o cierra, con cada lectura de esa chapa, y cada
 * REFRESCO_MS por las dudas. Quien lo abre decide qué hacen «Ver ahora» y «Ver la grabación»
 * (`alVer`): la pared abre el canal; sin eso, los botones no se dibujan.
 */
const REFRESCO_MS = 30_000;
/** La grabación se abre un poco antes del momento: se ve llegar (o irse), no el instante ya pasado. */
const ANTES_MS = 15_000;

type Lista = { categoria: string; requerida: boolean; confirmada: string | null; motivo: string | null; etiqueta: string | null };
type Datos = { chapa: string; dias: number; lista: Lista | null; seguimiento: Seguimiento };

const fechaHora = (ms: number) => {
    const d = new Date(ms), hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    return `${mismoDia ? "hoy" : d.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", timeZone: "America/Montevideo" })} ${d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" })}`;
};
const limpia = (p: unknown) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function SeguimientoChapa({ plate, alCerrar, alVer }: {
    plate: string; alCerrar: () => void;
    /** Abrir esa cámara: en vivo (`instante` null) o en su grabación desde ese momento. */
    alVer?: (deviceId: string, instante: number | null) => void;
}) {
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [ahora, setAhora] = useState(() => Date.now());
    const pedir = useCallback(() => {
        setCargando(true);
        fetch(`/api/seguimiento?plate=${encodeURIComponent(plate)}`, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`); return j as Datos; })
            .then((j) => { setDatos(j); setError(null); setAhora(Date.now()); })
            .catch((e) => setError(e?.message || "No se pudo consultar"))
            .finally(() => setCargando(false));
    }, [plate]);
    useEffect(() => { setDatos(null); pedir(); const t = setInterval(pedir, REFRESCO_MS); return () => clearInterval(t); }, [pedir]);
    // Lo que cambia la historia: una estadía que abre o cierra, o una lectura que puede ser esta chapa.
    const siEsEsta = (p: unknown) => { const c = limpia(p); if (c && puedeSerLaMisma(limpia(plate), c)) pedir(); };
    useTiempoReal("estadia_abierta", (e: any) => siEsEsta(e?.plate));
    useTiempoReal("estadia_cerrada", (e: any) => siEsEsta(e?.plate));
    useTiempoReal("access_event", (e: any) => siEsEsta(e?.plateDetected));
    useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") alCerrar(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [alCerrar]);

    if (typeof document === "undefined") return null;
    const s = datos?.seguimiento, a = s?.actual || null, lista = datos?.lista || null;
    return createPortal(
        <aside role="dialog" aria-label={`Seguimiento de ${plate}`} className="fixed right-0 top-0 z-[70] h-full w-[420px] max-w-[94vw] flex flex-col bg-card text-foreground border-l border-border shadow-[var(--sombra-flotante)]">
            <header className="shrink-0 px-5 pt-4 pb-3 border-b border-border">
                <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Seguimiento</div>
                        <div className="text-[26px] font-bold tabular-nums tracking-[0.06em] leading-tight">{limpia(plate)}</div>
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={pedir} title="Actualizar" aria-label="Actualizar">{cargando ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}</Button>
                    <Button variant="ghost" size="icon-sm" onClick={alCerrar} title="Cerrar  ( Esc )" aria-label="Cerrar"><X size={17} /></Button>
                </div>
                {lista?.requerida ? <CartelRequerida motivo={lista.motivo} className="mt-2 w-full" />
                    : lista && <span className={cn("mt-2 inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold", lista.categoria === "BLACKLISTED" ? "chip-mal" : lista.categoria === "SEARCH" ? "chip-aviso" : "chip-info")} title={lista.motivo || undefined}>
                        {lista.categoria === "BLACKLISTED" ? "Lista negra" : lista.categoria === "SEARCH" ? "Lista Amarilla" : "VIP"}{lista.etiqueta ? ` · ${lista.etiqueta}` : ""}</span>}
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
                {error && !datos ? (
                    <div className="rounded-[10px] border chip-mal px-3 py-3 text-[13px]">
                        No se pudo armar el seguimiento: {error}.
                        <div className="mt-2"><Button size="sm" variant="outline" onClick={pedir}>Reintentar</Button></div>
                    </div>
                ) : !s ? (
                    <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-[10px] bg-muted animate-pulse" />)}</div>
                ) : s.estado === "sin-datos" ? (
                    <p className="text-[13px] text-muted-foreground">Ninguna cámara leyó esta matrícula en los últimos {datos!.dias} días.</p>
                ) : (
                    <>
                        {a && <Estado s={s} a={a} ahora={ahora} alVer={alVer} />}
                        {s.variantes.length > 0 && (
                            <p className="text-[12px] text-muted-foreground leading-snug">
                                En esas mismas cámaras también se leyó como {s.variantes.map((v, i) => <span key={v.chapa}>{i > 0 ? ", " : ""}<b className="text-foreground tabular-nums">{v.chapa}</b> (×{v.lecturas})</span>)}.
                                Se toman como la misma matrícula mal leída; puede no serlo.
                            </p>
                        )}
                        <section>
                            <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Recorrido · últimos {datos!.dias} días</h3>
                            <ol className="space-y-2">{s.tramos.map((t) => <Fila key={t.clave} t={t} ahora={ahora} alVer={alVer} />)}</ol>
                        </section>
                    </>
                )}
                {error && datos && <p className="text-[12px] tono-aviso">No se pudo actualizar ({error}); se muestra lo último que llegó.</p>}
            </div>
        </aside>, document.body);
}

/** Lo que importa primero: está o se fue, dónde, desde cuándo, cuánto. */
function Estado({ s, a, ahora, alVer }: { s: Seguimiento; a: Tramo; ahora: number; alVer?: (deviceId: string, instante: number | null) => void }) {
    const esta = s.estado === "esta", seFue = s.estado === "se-fue";
    const estadia = a.tipo === "estadia";
    return (
        <section className={cn("rounded-[10px] border px-4 py-3", esta ? "chip-mal" : "bg-muted border-border")}>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em]">
                {esta ? <><span className="h-2 w-2 rounded-full bg-[var(--mal)] animate-pulse" /> Está ahí ahora</> : seFue ? <><MoveRight size={14} /> Se fue</> : <><History size={14} /> {estadia ? "Dejó de leerse ahí" : "Última vez que se la vio"}</>}
            </div>
            <div className="mt-1 text-[17px] font-bold leading-snug text-foreground">{a.camara || "Cámara sin nombre"}</div>
            <div className="text-[13px] text-foreground/80 tabular-nums">
                {esta ? <>Se la lee ahí desde {fechaHora(a.desde)} · lleva {cuantoDuro(ahora - a.desde)}</>
                    : estadia ? <>Estuvo de {fechaHora(a.desde)} a {fechaHora(a.hasta)} · {cuantoDuro(a.hasta - a.desde)}</>
                    : <>{fechaHora(a.hasta)}{a.tipo === "acceso" ? ` · ${a.sentido === "EXIT" ? "saliendo" : "entrando"}` : " · de paso"} · hace {cuantoDuro(ahora - a.hasta)}</>}
            </div>
            {/* Una estadía por chapa se corta cuando dejan de leerla: lo que se sabe es desde cuándo se la lee, no cuándo llegó. */}
            {estadia && a.primeraEnCamara != null && (
                <div className="mt-1 text-[12px] text-foreground/70 tabular-nums">En esta cámara se la leyó por primera vez el {fechaHora(a.primeraEnCamara)}{!a.porLugar ? " (con cortes: puede no haberse movido)" : ""}.</div>
            )}
            {!esta && !seFue && estadia && (
                <div className="mt-1 text-[12px] text-foreground/70">No se la volvió a leer desde entonces: pudo irse, o no pasó nadie que la hiciera releer. «Ver ahora» lo confirma.</div>
            )}
            {alVer && a.deviceId && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {(esta || (!seFue && estadia)) && <Button size="sm" variant={esta ? "default" : "outline"} onClick={() => alVer(a.deviceId!, null)}><Radio size={14} /> Ver ahora</Button>}
                    <Button size="sm" variant={esta ? "outline" : "default"} onClick={() => alVer(a.deviceId!, (a.primeraEnCamara ?? a.desde) - ANTES_MS)}><History size={14} /> {estadia ? "Ver la llegada" : "Ver ese momento"}</Button>
                    {!esta && estadia && <Button size="sm" variant="outline" onClick={() => alVer(a.deviceId!, a.hasta - ANTES_MS)}><History size={14} /> {seFue ? "Ver la partida" : "Ver la última lectura"}</Button>}
                </div>
            )}
        </section>
    );
}

function Fila({ t, ahora, alVer }: { t: Tramo; ahora: number; alVer?: (deviceId: string, instante: number | null) => void }) {
    const foto = getImagePath(t.foto);
    const [rota, setRota] = useState(false);
    const Ico = t.tipo === "estadia" ? CircleParking : t.tipo === "acceso" ? (t.sentido === "EXIT" ? LogOut : LogIn) : MoveRight;
    const que = t.tipo === "estadia" ? (t.abierta ? `Estacionada · lleva ${cuantoDuro(ahora - t.desde)}` : `Estacionada ${cuantoDuro(t.hasta - t.desde)}`)
        : t.tipo === "acceso" ? `${t.sentido === "EXIT" ? "Salida" : "Entrada"}${t.decision ? (t.decision === "GRANT" ? " · autorizada" : " · denegada") : ""}` : `De paso${t.lecturas > 1 ? ` · ${t.lecturas} lecturas` : ""}`;
    const otras = t.leidaComo.length > 1;
    return (
        <li className="flex gap-3 rounded-[10px] border border-border bg-background p-2">
            <div className="relative w-[104px] shrink-0 aspect-video rounded-[6px] overflow-hidden bg-muted grid place-items-center text-muted-foreground">
                {foto && !rota
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={`${foto}${foto.includes("?") ? "&" : "?"}w=240`} alt="" loading="lazy" decoding="async" onError={() => setRota(true)} className="absolute inset-0 w-full h-full object-cover" />
                    : <Camera size={18} />}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold"><Ico size={14} className="shrink-0 text-muted-foreground" /><span className="truncate">{t.camara || "Cámara sin nombre"}</span></div>
                <div className="text-[12px] text-muted-foreground tabular-nums">{t.tipo === "estadia" ? `${fechaHora(t.desde)} → ${t.abierta ? "sigue ahí" : fechaHora(t.hasta)}` : fechaHora(t.desde)}</div>
                <div className="text-[12px]">{que}</div>
                {otras && <div className="text-[11px] text-muted-foreground tabular-nums truncate">Leída como {t.leidaComo.map((x) => `${x.chapa} ×${x.lecturas}`).join(", ")}</div>}
            </div>
            {alVer && t.deviceId && (
                <Button variant="ghost" size="icon-sm" className="self-center shrink-0" title="Ver la grabación de ese momento" aria-label="Ver la grabación" onClick={() => alVer(t.deviceId!, t.desde - ANTES_MS)}><History size={16} /></Button>
            )}
        </li>
    );
}
