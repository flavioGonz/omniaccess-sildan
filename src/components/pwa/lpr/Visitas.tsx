"use client";
/**
 * Visitas en «LPR en vivo» (29/10, Nico: «debe tener las visitas también, para verificar los QR»).
 *
 * El guardia que mira las cámaras desde el teléfono es el mismo que recibe al invitado en la
 * barrera: tenía que cambiar de app (o ir a la consola) para validar un pase. Acá escanea el QR,
 * ve si el pase vale y marca el ingreso o la salida, con las mismas acciones del panel
 * (resolveByQr y markEntry) y su usuario como el que validó.
 *
 * El escáner usa BarcodeDetector donde existe y jsQR en el iPhone (src/lib/leer-qr.ts): antes, en
 * Safari, el escaneo decía «este equipo no lo soporta».
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, CalendarClock, ChevronRight, Flashlight, KeyRound, LogIn, LogOut, QrCode, RefreshCw, ScanLine, Search, ShieldAlert, ShieldCheck, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fecha, hace, hora } from "@/lib/fechas";
import { listActiveGuests, markEntry, resolveByQr, searchGuests, type GuestCard, type QrResolve } from "@/app/actions/invitations";
import { crearLectorQr } from "@/lib/leer-qr";
import { Chapa, CURVA_IOS, Hoja } from "./piezas";

/** Cada cuánto se rehace la lista de invitados de hoy mientras la pestaña está a la vista. */
const LISTA_CADA_MS = 30_000;
/** Espera entre tecla y búsqueda: la búsqueda va al servidor (incluye pases de las próximas 24 h). */
const BUSCAR_TRAS_MS = 300;
/** Cuadros por segundo que se miran buscando un QR: más no lee antes y calienta el teléfono. */
const ESCANEO_FPS = 8;
/**
 * Entre cerrar una hoja y abrir otra: el «history.back()» de la que se cierra llega por popstate un
 * instante después, y si la nueva ya estuviera abierta, ese «atrás» la cerraría a ella.
 */
const ESPERA_ATRAS_MS = 260;

type Estado = QrResolve["status"];
const ESTADO: Record<Estado, { titulo: string; detalle: string; pleno: string; ok: boolean }> = {
    valid: { titulo: "Pase vigente", detalle: "Puede pasar.", pleno: "pleno-bien", ok: true },
    notyet: { titulo: "Todavía no vale", detalle: "El pase empieza más tarde.", pleno: "pleno-aviso", ok: false },
    expired: { titulo: "Pase vencido", detalle: "Ya pasó su horario.", pleno: "pleno-quieto", ok: false },
    revoked: { titulo: "Pase revocado", detalle: "Lo anularon o el invitado fue denegado.", pleno: "pleno-mal", ok: false },
    notfound: { titulo: "QR desconocido", detalle: "No es un pase de este barrio.", pleno: "pleno-mal", ok: false },
};

/** El estado de una tarjeta de la lista, sin ir al servidor: la lista ya trae las fechas. */
function estadoDe(c: GuestCard): Estado {
    const ahora = Date.now();
    if (c.status === "DENIED") return "revoked";
    if (ahora < +new Date(c.validFrom)) return "notyet";
    if (ahora > +new Date(c.validTo)) return "expired";
    return "valid";
}
const rangoDe = (c: GuestCard) => {
    const d = new Date(c.validFrom), h = new Date(c.validTo);
    return fecha(d) === fecha(h) ? `${fecha(d)} · ${hora(d)} a ${hora(h)}` : `${fecha(d)} ${hora(d)} → ${fecha(h)} ${hora(h)}`;
};

export function Visitas({ activa, quien }: { activa: boolean; quien: string | null }) {
    const [lista, setLista] = useState<GuestCard[] | null>(null);
    const [error, setError] = useState(false);
    const [q, setQ] = useState("");
    const [encontrados, setEncontrados] = useState<GuestCard[] | null>(null);
    const [escaneando, setEscaneando] = useState(false);
    const [codigo, setCodigo] = useState(false);
    const [resultado, setResultado] = useState<{ estado: Estado; card?: GuestCard; reason?: string; via: "QR" | "SEARCH" } | null>(null);

    const cargar = useCallback(async () => {
        try { setLista(await listActiveGuests()); setError(false); } catch { setError(true); }
    }, []);
    useEffect(() => {
        if (!activa) return;
        cargar();
        const iv = setInterval(cargar, LISTA_CADA_MS);
        return () => clearInterval(iv);
    }, [activa, cargar]);

    useEffect(() => {
        const t = q.trim();
        if (!t) { setEncontrados(null); return; }
        const h = setTimeout(() => { searchGuests(t).then(setEncontrados).catch(() => setEncontrados([])); }, BUSCAR_TRAS_MS);
        return () => clearTimeout(h);
    }, [q]);

    const alLeer = async (raw: string) => {
        navigator.vibrate?.(30);
        setEscaneando(false); setCodigo(false);
        try {
            const r = await resolveByQr(raw);
            setTimeout(() => setResultado({ estado: r.status, card: r.card, reason: r.reason, via: "QR" }), ESPERA_ATRAS_MS);
        } catch { setTimeout(() => setResultado({ estado: "notfound", via: "QR", reason: "No se pudo consultar el pase." }), ESPERA_ATRAS_MS); }
    };

    const visibles = encontrados ?? lista ?? [];
    const adentro = (lista || []).filter((c) => c.inside).length;

    return (
        <div className="h-full overflow-y-auto [&::-webkit-scrollbar]:hidden pb-28">
            {/* Escanear: lo primero y lo más grande, es a lo que se viene a esta pestaña. */}
            <div className="px-4">
                <motion.button type="button" onClick={() => setEscaneando(true)} whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}
                    className="w-full rounded-[14px] bg-[var(--accion)] text-white px-4 py-4 flex items-center gap-3 text-left">
                    <span className="w-12 h-12 rounded-[12px] bg-white/15 grid place-items-center shrink-0"><ScanLine size={26} /></span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-[17px] font-bold leading-tight">Escanear QR del pase</span>
                        <span className="block text-[12.5px] text-white/80">Apuntá la cámara al código del invitado</span>
                    </span>
                    <ChevronRight size={20} className="text-white/70" />
                </motion.button>
                <div className="mt-2 grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => setCodigo(true)} className="rounded-[10px] border border-border bg-card px-3 py-2 text-left active:bg-muted">
                        <KeyRound size={15} className="text-muted-foreground" />
                        <div className="text-[12px] font-semibold mt-1">Escribir código</div>
                    </button>
                    <div className="rounded-[10px] border border-border bg-card px-3 py-2">
                        <div className="text-[11px] text-muted-foreground">Vigentes</div>
                        <div className="text-[20px] font-bold tabular-nums leading-tight">{lista ? lista.length : "—"}</div>
                    </div>
                    <div className="rounded-[10px] border border-border bg-card px-3 py-2">
                        <div className="text-[11px] text-muted-foreground">Adentro</div>
                        <div className="text-[20px] font-bold tabular-nums leading-tight tono-bien">{lista ? adentro : "—"}</div>
                    </div>
                </div>
            </div>

            <div className="px-4 mt-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invitado, anfitrión o matrícula" enterKeyHint="search"
                        className="w-full h-11 rounded-full border border-border bg-card pl-9 pr-9 text-[15px] outline-none focus:border-[var(--accion)]" />
                    {q && <button type="button" aria-label="Borrar" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-muted-foreground"><X size={15} /></button>}
                </div>
            </div>

            <div className="px-4 mt-4 mb-1.5 flex items-center justify-between">
                <span className="text-[13px] font-semibold">{encontrados ? `${encontrados.length} encontrados` : "Invitados de hoy"}</span>
                {!encontrados && <button type="button" onClick={cargar} aria-label="Actualizar" className="w-8 h-8 grid place-items-center rounded-full text-muted-foreground active:bg-muted"><RefreshCw size={15} /></button>}
            </div>
            <div className="px-3">
                {lista === null && !error ? (
                    <div className="space-y-1.5">{[0, 1, 2].map((i) => <div key={i} className="h-[64px] rounded-[10px] bg-muted animate-pulse" />)}</div>
                ) : error && !encontrados ? (
                    <div className="text-center py-12 text-[13px] text-muted-foreground">No se pudieron traer los invitados. <button type="button" onClick={cargar} className="tono-accion font-semibold">Reintentar</button></div>
                ) : visibles.length === 0 ? (
                    <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground text-center px-6"><Users size={26} />
                        <span className="text-[13px]">{encontrados ? "Nadie coincide con esa búsqueda." : "No hay pases vigentes ahora."}</span>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {visibles.map((c) => {
                            const est = ESTADO[estadoDe(c)];
                            return (
                                <button key={c.guestId} type="button" onClick={() => setResultado({ estado: estadoDe(c), card: c, via: "SEARCH" })}
                                    className="w-full flex items-center gap-3 rounded-[10px] border border-border bg-card p-2.5 text-left active:bg-muted">
                                    <span className={cn("w-10 h-10 rounded-full grid place-items-center shrink-0 text-[14px] font-bold", c.inside ? "pleno-bien" : "bg-muted text-muted-foreground")}>
                                        {(c.name || "?").trim().charAt(0).toUpperCase()}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2 min-w-0">
                                            <span className="text-[14px] font-semibold truncate">{c.name || "Invitado"}</span>
                                            {c.plates[0] && <Chapa p={c.plates[0]} className="text-[11px] px-1.5 py-0" />}
                                        </span>
                                        <span className="block text-[11.5px] text-muted-foreground truncate">{[c.hostLabel || c.hostName, `hasta ${hora(new Date(c.validTo))}`].filter(Boolean).join(" · ")}</span>
                                    </span>
                                    <span className="flex flex-col items-end gap-1 shrink-0">
                                        {est.ok
                                            ? <span className={cn("text-[10.5px] font-semibold px-2 py-0.5 rounded-full border", c.inside ? "chip-bien" : "chip-neutro")}>{c.inside ? "Adentro" : "Afuera"}</span>
                                            : <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full border chip-mal">{est.titulo}</span>}
                                        {c.lastEntryAt && <span className="text-[10.5px] tabular-nums text-muted-foreground">{hace(c.lastEntryAt)}</span>}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <Escaner abierto={escaneando} alCerrar={() => setEscaneando(false)} alLeer={alLeer} />
            <Hoja abierta={codigo} alCerrar={() => setCodigo(false)} alto="media"><IngresarCodigo alEnviar={alLeer} alCerrar={() => setCodigo(false)} /></Hoja>
            <Hoja abierta={!!resultado} alCerrar={() => setResultado(null)} alto="media">
                {resultado && <Resultado r={resultado} quien={quien} alCerrar={() => setResultado(null)} alMarcar={cargar} alOtro={() => { setResultado(null); setTimeout(() => setEscaneando(true), ESPERA_ATRAS_MS); }} />}
            </Hoja>
        </div>
    );
}

/** El código del pase escrito a mano: para el QR roto, la pantalla rajada o el papel mojado. */
function IngresarCodigo({ alEnviar, alCerrar }: { alEnviar: (t: string) => void; alCerrar: () => void }) {
    const [t, setT] = useState("");
    return (
        <form onSubmit={(e) => { e.preventDefault(); if (t.trim()) alEnviar(t.trim()); }} className="px-4 pt-2 pb-[max(1.2rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between mb-3">
                <span className="text-[17px] font-bold">Código del pase</span>
                <button type="button" aria-label="Cerrar" onClick={alCerrar} className="w-9 h-9 grid place-items-center rounded-full border border-border"><X size={16} /></button>
            </div>
            <input autoFocus value={t} onChange={(e) => setT(e.target.value.toUpperCase())} placeholder="Ej. K7Q2XB" autoCapitalize="characters" autoComplete="off"
                className="w-full h-14 rounded-[12px] border border-border bg-card px-4 text-[22px] font-bold tracking-[0.2em] text-center outline-none focus:border-[var(--accion)]" />
            <p className="text-[12px] text-muted-foreground mt-2 text-center">El código que figura abajo del QR, o el enlace completo del pase.</p>
            <button type="submit" disabled={!t.trim()} className="mt-3 w-full h-12 rounded-full bg-[var(--accion)] text-white text-[15px] font-semibold disabled:opacity-50">Verificar</button>
        </form>
    );
}

/** El veredicto de un pase y los botones para marcar el paso. */
function Resultado({ r, quien, alCerrar, alMarcar, alOtro }: {
    r: { estado: Estado; card?: GuestCard; reason?: string; via: "QR" | "SEARCH" }; quien: string | null;
    alCerrar: () => void; alMarcar: () => void; alOtro: () => void;
}) {
    const est = ESTADO[r.estado];
    const c = r.card;
    const [marcando, setMarcando] = useState<"ENTRY" | "EXIT" | null>(null);
    const [hecho, setHecho] = useState<"ENTRY" | "EXIT" | null>(null);
    const [falla, setFalla] = useState("");
    const marcar = async (d: "ENTRY" | "EXIT") => {
        if (!c) return;
        setMarcando(d); setFalla("");
        try {
            const x = await markEntry({ guestId: c.guestId, direction: d, method: r.via, validatedBy: quien || "Guardia", plate: c.plates[0] });
            if (x.ok) { navigator.vibrate?.([20, 40, 20]); setHecho(d); alMarcar(); setTimeout(alCerrar, 900); }
            else setFalla(x.error || "No se pudo marcar.");
        } catch { setFalla("No se pudo marcar: revisá la conexión."); }
        finally { setMarcando(null); }
    };
    const Ico = est.ok ? ShieldCheck : ShieldAlert;
    return (
        <div className="overflow-y-auto px-4 pt-1 pb-[max(1.2rem,env(safe-area-inset-bottom))]">
            <div className="flex justify-end"><button type="button" aria-label="Cerrar" onClick={alCerrar} className="w-9 h-9 grid place-items-center rounded-full border border-border"><X size={16} /></button></div>
            <div className="flex flex-col items-center text-center -mt-3">
                <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.08 }}
                    className={cn("w-[72px] h-[72px] rounded-full grid place-items-center", hecho ? "pleno-bien" : est.pleno)}>
                    {hecho ? (hecho === "ENTRY" ? <LogIn size={32} /> : <LogOut size={32} />) : <Ico size={34} />}
                </motion.span>
                <div className="text-[22px] font-bold tracking-[-0.01em] mt-3">{hecho ? (hecho === "ENTRY" ? "Ingreso marcado" : "Salida marcada") : est.titulo}</div>
                <div className="text-[13px] text-muted-foreground">{hecho ? `Validó ${quien || "Guardia"}` : r.reason || est.detalle}</div>
            </div>
            {c ? (
                <div className="mt-4 rounded-[12px] border border-border bg-card divide-y divide-border">
                    <div className="px-3 py-3">
                        <div className="text-[17px] font-bold">{c.name || "Invitado"}</div>
                        <div className="text-[12.5px] text-muted-foreground">Visita a {c.hostLabel || c.hostName || "—"}{c.title && c.kind === "EVENT" ? ` · ${c.title}` : ""}</div>
                        {c.plates.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{c.plates.map((p) => <Chapa key={p} p={p} />)}</div>}
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 text-[12.5px]"><CalendarClock size={15} className="text-muted-foreground" /><span className="flex-1">{rangoDe(c)}</span></div>
                    <div className="flex items-center gap-2 px-3 py-2.5 text-[12.5px]">
                        {c.inside ? <LogIn size={15} className="tono-bien" /> : <LogOut size={15} className="text-muted-foreground" />}
                        <span className="flex-1">{c.lastEntryAt ? `${c.inside ? "Adentro" : "Salió"} · ${hace(c.lastEntryAt)}` : "Todavía no entró"}</span>
                    </div>
                </div>
            ) : (
                <div className="mt-4 rounded-[12px] border border-border bg-card p-4 text-center text-[13px] text-muted-foreground"><QrCode size={22} className="mx-auto mb-1.5" />El código no corresponde a ningún pase. Pedile al invitado que muestre el de la invitación o buscalo por nombre.</div>
            )}
            {falla && <div className="mt-3 text-[12.5px] tono-mal text-center">{falla}</div>}
            {!hecho && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                    {est.ok && c ? (
                        <>
                            <button type="button" disabled={!!marcando} onClick={() => marcar("ENTRY")} className="h-12 rounded-full bg-[var(--accion)] text-white text-[15px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
                                {marcando === "ENTRY" ? <RefreshCw size={16} className="animate-spin" /> : <LogIn size={17} />} Ingreso
                            </button>
                            <button type="button" disabled={!!marcando} onClick={() => marcar("EXIT")} className="h-12 rounded-full border border-border text-[15px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
                                {marcando === "EXIT" ? <RefreshCw size={16} className="animate-spin" /> : <LogOut size={17} />} Salida
                            </button>
                        </>
                    ) : (
                        <button type="button" onClick={alOtro} className="col-span-2 h-12 rounded-full bg-[var(--accion)] text-white text-[15px] font-semibold flex items-center justify-center gap-1.5"><ScanLine size={17} /> Escanear otro</button>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * La cámara buscando un QR, a pantalla completa. Se prende al abrir y se apaga al cerrar: dejar la
 * cámara encendida en una pestaña escondida gasta batería y deja la luz verde del iPhone prendida.
 */
function Escaner({ abierto, alCerrar, alLeer }: { abierto: boolean; alCerrar: () => void; alLeer: (t: string) => void }) {
    const video = useRef<HTMLVideoElement>(null);
    const [aviso, setAviso] = useState("");
    const [linterna, setLinterna] = useState<boolean | null>(null);
    const pista = useRef<MediaStreamTrack | null>(null);

    useEffect(() => {
        if (!abierto) return;
        let vivo = true, flujo: MediaStream | null = null, reloj: any = null;
        setAviso(""); setLinterna(null);
        (async () => {
            try {
                flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
                if (!vivo) { flujo.getTracks().forEach((t) => t.stop()); return; }
                pista.current = flujo.getVideoTracks()[0] || null;
                const caps: any = pista.current?.getCapabilities?.() || {};
                if (caps.torch) setLinterna(false);
                if (video.current) { video.current.srcObject = flujo; await video.current.play().catch(() => {}); }
                const lector = await crearLectorQr();
                let ocupado = false;
                reloj = setInterval(async () => {
                    if (!vivo || ocupado || !video.current) return;
                    ocupado = true;
                    try { const t = await lector.leer(video.current); if (t && vivo) { vivo = false; alLeer(t); } } catch { /* cuadro sin QR */ }
                    ocupado = false;
                }, 1000 / ESCANEO_FPS);
            } catch (e: any) {
                setAviso(e?.name === "NotAllowedError" ? "La cámara está bloqueada. Habilitala para este sitio en los ajustes del teléfono." : "No se pudo abrir la cámara.");
            }
        })();
        return () => { vivo = false; clearInterval(reloj); flujo?.getTracks().forEach((t) => t.stop()); pista.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto]);

    const alternarLinterna = async () => {
        const nuevo = !linterna;
        try { await (pista.current as any)?.applyConstraints({ advanced: [{ torch: nuevo }] }); setLinterna(nuevo); } catch { setLinterna(null); }
    };

    return (
        <Hoja abierta={abierto} alCerrar={alCerrar} className="bg-black text-white">
            <div className="relative flex-1 min-h-0 overflow-hidden">
                <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                {/* El visor: oscurece todo menos el cuadrado y una línea recorre el código. */}
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                    <motion.div initial={{ scale: 1.15, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.45, ease: CURVA_IOS, delay: 0.15 }}
                        className="relative w-[68vw] max-w-[300px] aspect-square rounded-[26px] shadow-[0_0_0_200vmax_rgba(0,0,0,0.5)]">
                        {(["top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-[26px]", "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-[26px]", "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-[26px]", "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-[26px]"]).map((k) => (
                            <span key={k} className={cn("absolute w-12 h-12 border-white", k)} />
                        ))}
                        {!aviso && (
                            <motion.span className="absolute inset-x-4 h-[2px] rounded-full bg-[var(--accion-en-oscuro,var(--accion))] shadow-[0_0_14px_2px_var(--accion)]"
                                initial={{ top: "12%" }} animate={{ top: ["12%", "88%", "12%"] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }} />
                        )}
                    </motion.div>
                </div>
                <header className="absolute top-0 inset-x-0 flex items-center gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 bg-gradient-to-b from-black/60 to-transparent">
                    <button type="button" onClick={alCerrar} aria-label="Volver" className="w-10 h-10 grid place-items-center rounded-full active:bg-white/15"><ArrowLeft size={20} /></button>
                    <span className="flex-1 text-[15px] font-semibold">Escanear pase</span>
                    {linterna !== null && (
                        <button type="button" onClick={alternarLinterna} aria-label="Linterna" aria-pressed={linterna}
                            className={cn("w-10 h-10 grid place-items-center rounded-full", linterna ? "bg-white text-black" : "bg-white/15")}><Flashlight size={18} /></button>
                    )}
                </header>
                <div className="absolute bottom-0 inset-x-0 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10 bg-gradient-to-t from-black/70 to-transparent text-center">
                    <div className="text-[14px] font-semibold">{aviso || "Apuntá al QR del pase"}</div>
                    {!aviso && <div className="text-[12px] text-white/70 mt-0.5">Se lee solo, no hace falta tocar nada.</div>}
                </div>
            </div>
        </Hoja>
    );
}
