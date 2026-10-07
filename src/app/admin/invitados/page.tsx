"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import {
    Ticket, Search, UserPlus, LogIn, LogOut, Circle, Clock, Home, Car, ShieldCheck, ShieldAlert,
    X, Trash2, Loader2, Users, MessageCircle, Globe, UserCheck, CalendarClock, QrCode, ScanLine, Download, Copy, Camera, KeyRound, Home as HomeIcon, MapPin,
} from "lucide-react";
import {
    listActiveGuests, searchGuests, markEntry, revokeInvitation, quickInvite, getQrSvg, resolveByQr,
    getOrCreatePortalToken, listResidentsForPortal,
    type GuestCard, type QrResolve,
} from "@/app/actions/invitations";

function cn(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(" "); }

const fmtDT = (s: string) => new Date(s).toLocaleString("es-UY", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtT = (s: string | null) => s ? new Date(s).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" }) : "";

function viaBadge(v: string) {
    if (v === "WHATSAPP") return { icon: <MessageCircle size={11} />, label: "WhatsApp", cls: "text-emerald-600 bg-emerald-500/10" };
    if (v === "PORTAL") return { icon: <Globe size={11} />, label: "Portal", cls: "text-sky-600 bg-sky-500/10" };
    return { icon: <UserCheck size={11} />, label: "Guardia", cls: "text-amber-600 bg-amber-500/10" };
}

type Toast = { id: number; name: string; host: string; gate: string; dir: string; plate: string };

export default function InvitadosPage() {
    const [all, setAll] = useState<GuestCard[]>([]);
    const [q, setQ] = useState("");
    const [results, setResults] = useState<GuestCard[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [showScan, setShowScan] = useState(false);
    const [showLink, setShowLink] = useState(false);
    const [qrFor, setQrFor] = useState<GuestCard | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);

    const load = useCallback(async () => {
        try { const r = await listActiveGuests(); setAll(r); } catch { } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv); }, [load]);

    useEffect(() => {
        const term = q.trim();
        if (!term) { setResults(null); return; }
        const t = setTimeout(async () => { try { setResults(await searchGuests(term)); } catch { } }, 280);
        return () => clearTimeout(t);
    }, [q]);

    useEffect(() => {
        let s: any;
        try {
            s = io(getSocketUrl(), { path: "/io/socket.io", transports: ["polling", "websocket"] });
            s.on("guest_entry", (d: any) => {
                const id = Date.now() + Math.random();
                setToasts((p) => [{ id, name: d.name || d.plate || "Invitado", host: d.hostLabel || d.hostName || "", gate: d.device?.name || "", dir: d.direction || "ENTRY", plate: d.plate || "" }, ...p].slice(0, 4));
                setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 8000);
                load();
            });
        } catch { }
        return () => { try { s && s.disconnect(); } catch { } };
    }, [load]);

    const shown = results ?? all;
    const aforo = useMemo(() => ({ total: all.length, inside: all.filter((c) => c.inside).length }), [all]);

    const refresh = useCallback(async () => { await load(); if (results) setResults(await searchGuests(q)); }, [load, results, q]);

    const doMark = async (c: GuestCard, direction: "ENTRY" | "EXIT") => {
        setBusy(c.guestId);
        try { await markEntry({ guestId: c.guestId, direction, method: "SEARCH", validatedBy: "Guardia" }); await refresh(); } finally { setBusy(null); }
    };
    const doRevoke = async (c: GuestCard) => {
        if (!confirm(`¿Revocar el pase de ${c.name || "este invitado"}? Dejará de validar en las garitas.`)) return;
        setBusy(c.guestId);
        try { await revokeInvitation(c.invitationId); await refresh(); } finally { setBusy(null); }
    };

    return (
        <div className="min-h-full p-4 sm:p-6 max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 grid place-items-center text-white shadow-lg"><Ticket size={20} /></div>
                    <div>
                        <h1 className="text-xl font-extrabold leading-tight">Invitados</h1>
                        <p className="text-xs text-muted-foreground">Visitas temporales — validación en vivo en todas las garitas</p>
                    </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <div className="hidden sm:flex items-center gap-3 px-3 h-10 rounded-2xl bg-card ring-1 ring-border">
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold"><Users size={15} className="text-muted-foreground" /> {aforo.total} activos</span>
                        <span className="w-px h-5 bg-border" />
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-600"><Circle size={8} className="fill-emerald-500 text-emerald-500" /> {aforo.inside} adentro</span>
                    </div>
                    <button onClick={() => setShowLink(true)} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-2xl bg-card ring-1 ring-border hover:bg-accent font-bold text-sm transition-colors"><KeyRound size={17} /> Link residente</button>
                    <button onClick={() => setShowScan(true)} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-2xl bg-card ring-1 ring-border hover:bg-accent font-bold text-sm transition-colors"><ScanLine size={17} /> Escanear QR</button>
                    <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-lg transition-colors"><UserPlus size={17} /> Nuevo pase</button>
                </div>
            </div>

            <div className="relative mb-5">
                <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o patente…"
                    className="w-full h-14 pl-12 pr-10 rounded-2xl bg-card ring-1 ring-border focus:ring-2 focus:ring-amber-500 outline-none text-lg font-semibold transition-all" />
                {q && <button onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"><X size={16} /></button>}
            </div>

            {loading ? (
                <div className="grid place-items-center py-20 text-muted-foreground"><Loader2 className="animate-spin" /></div>
            ) : shown.length === 0 ? (
                <div className="grid place-items-center py-20 text-center text-muted-foreground">
                    <Ticket size={40} className="mb-3 opacity-30" />
                    <p className="font-semibold">{results ? "Sin resultados para la búsqueda." : "No hay invitados activos ahora."}</p>
                    {!results && <p className="text-sm mt-1">Creá un pase con “Nuevo pase” o pedile al residente que invite por WhatsApp.</p>}
                </div>
            ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {shown.map((c) => (
                        <div key={c.guestId} className={cn("rounded-2xl bg-card ring-1 p-4 flex flex-col gap-3 transition-all", c.inside ? "ring-emerald-500/50 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]" : "ring-border")}>
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="font-extrabold text-base leading-tight truncate">{c.name || "(sin nombre)"}</div>
                                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-0.5"><Home size={11} /> {c.hostLabel || c.hostName || "—"}</div>
                                </div>
                                {c.inside
                                    ? <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-600 text-[11px] font-extrabold"><Circle size={7} className="fill-emerald-500 text-emerald-500" /> Adentro</span>
                                    : <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-muted-foreground text-[11px] font-bold">Afuera</span>}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                                {c.plates.length ? c.plates.map((p) => (
                                    <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-muted text-xs font-bold tracking-wide"><Car size={11} /> {p}</span>
                                )) : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-muted/60 text-xs text-muted-foreground font-semibold">a pie</span>}
                                {(() => { const v = viaBadge(c.createdVia); return <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold", v.cls)}>{v.icon} {v.label}</span>; })()}
                            </div>

                            <div className="text-xs text-muted-foreground inline-flex items-center gap-1"><CalendarClock size={12} /> {fmtDT(c.validFrom)} → {fmtDT(c.validTo)}</div>
                            {c.lastEntryAt && <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Clock size={11} /> último {c.lastDirection === "EXIT" ? "egreso" : "ingreso"} {fmtT(c.lastEntryAt)}</div>}

                            <div className="mt-auto flex items-center gap-1.5 pt-1">
                                <button disabled={busy === c.guestId} onClick={() => doMark(c, "ENTRY")} className="flex-1 inline-flex items-center justify-center gap-1 h-9 rounded-xl bg-emerald-500/90 hover:bg-emerald-600 text-white text-xs font-extrabold disabled:opacity-50 transition-colors"><LogIn size={14} /> Ingreso</button>
                                <button disabled={busy === c.guestId} onClick={() => doMark(c, "EXIT")} className="flex-1 inline-flex items-center justify-center gap-1 h-9 rounded-xl bg-muted hover:bg-accent text-xs font-extrabold disabled:opacity-50 transition-colors"><LogOut size={14} /> Egreso</button>
                                <button onClick={() => setQrFor(c)} title="Ver / compartir QR" className="w-9 h-9 grid place-items-center rounded-xl bg-muted hover:bg-sky-500 hover:text-white text-muted-foreground transition-colors"><QrCode size={15} /></button>
                                <button disabled={busy === c.guestId} onClick={() => doRevoke(c)} title="Revocar pase" className="w-9 h-9 grid place-items-center rounded-xl bg-muted hover:bg-red-500 hover:text-white text-muted-foreground disabled:opacity-50 transition-colors"><Trash2 size={14} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
                {toasts.map((t) => (
                    <div key={t.id} className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-600 text-white shadow-2xl ring-1 ring-white/20 animate-[slideIn_.2s_ease]">
                        <div className="w-9 h-9 rounded-full bg-white/20 grid place-items-center">{t.dir === "EXIT" ? <LogOut size={18} /> : <LogIn size={18} />}</div>
                        <div className="min-w-0">
                            <div className="font-extrabold leading-tight">INVITADO · {t.name}</div>
                            <div className="text-xs opacity-90 truncate">{t.dir === "EXIT" ? "Salió" : "Entró"}{t.gate ? ` · ${t.gate}` : ""}{t.host ? ` · ${t.host}` : ""}{t.plate ? ` · ${t.plate}` : ""}</div>
                        </div>
                    </div>
                ))}
            </div>

            {showNew && <NewPassModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
            {showScan && <ScanModal onClose={() => setShowScan(false)} onMarked={refresh} />}
            {showLink && <ResidentLinkModal onClose={() => setShowLink(false)} />}
            {qrFor && <QrModal card={qrFor} onClose={() => setQrFor(null)} />}
            <style jsx global>{`@keyframes slideIn { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
        </div>
    );
}

// ── QR del invitado (ver / compartir / descargar) ──
function QrModal({ card, onClose }: { card: GuestCard; onClose: () => void }) {
    const [svg, setSvg] = useState("");
    const [copied, setCopied] = useState(false);
    const link = typeof window !== "undefined" ? `${window.location.origin}/invitado/${card.qrToken}` : "";
    useEffect(() => { getQrSvg(card.qrToken).then(setSvg).catch(() => { }); }, [card.qrToken]);
    const dl = () => { const b = new Blob([svg], { type: "image/svg+xml" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `pase-${(card.name || "invitado").replace(/\s+/g, "_")}.svg`; a.click(); URL.revokeObjectURL(u); };
    const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { } };
    return (
        <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
            <div className="w-full max-w-xs rounded-3xl bg-card ring-1 ring-border shadow-2xl p-5 text-center" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-3">
                    <h2 className="font-extrabold">{card.name || "Invitado"}</h2>
                    <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"><X size={18} /></button>
                </div>
                <div className="inline-block p-3 bg-white rounded-2xl" dangerouslySetInnerHTML={{ __html: svg || "" }} />
                <p className="text-xs text-muted-foreground mt-3">Mostralo en la garita o compartí el link con el invitado.</p>
                <div className="flex items-center gap-2 mt-3">
                    <button onClick={copy} className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-muted hover:bg-accent text-sm font-bold transition-colors"><Copy size={15} /> {copied ? "¡Copiado!" : "Copiar link"}</button>
                    <button onClick={dl} className="inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-muted hover:bg-accent text-sm font-bold transition-colors"><Download size={15} /></button>
                </div>
            </div>
        </div>
    );
}

// ── Escáner de QR (BarcodeDetector nativo) ──
function ScanModal({ onClose, onMarked }: { onClose: () => void; onMarked: () => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<any>(null);
    const lockRef = useRef(false);
    const [res, setRes] = useState<QrResolve | null>(null);
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);
    const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
    const [geoErr, setGeoErr] = useState("");
    const geoWatch = useRef<number | null>(null);
    const [guardName] = useState<string>(() => { try { return localStorage.getItem("guard_name") || "Guardia"; } catch { return "Guardia"; } });
    const hasBarcode = typeof window !== "undefined" && "BarcodeDetector" in window;

    const stop = useCallback(() => { try { cancelAnimationFrame(rafRef.current); } catch { } try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { } streamRef.current = null; }, []);

    const start = useCallback(async () => {
        setErr(""); setRes(null); lockRef.current = false;
        if (!hasBarcode) { setErr("Este equipo no soporta escaneo de QR por cámara. Usá el buscador."); return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            streamRef.current = stream;
            if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => { }); }
            const Det = (window as any).BarcodeDetector;
            const det = new Det({ formats: ["qr_code"] });
            const loop = async () => {
                if (!streamRef.current || !videoRef.current || lockRef.current) return;
                try {
                    const codes = await det.detect(videoRef.current);
                    if (codes && codes[0]?.rawValue) {
                        lockRef.current = true;
                        const r = await resolveByQr(codes[0].rawValue);
                        setRes(r); stop(); return;
                    }
                } catch { }
                rafRef.current = requestAnimationFrame(loop);
            };
            rafRef.current = requestAnimationFrame(loop);
        } catch { setErr("No se pudo abrir la cámara. Revisá los permisos."); }
    }, [hasBarcode, stop]);

    useEffect(() => { start(); return stop; }, [start, stop]);
    // GPS obligatorio para registrar la lectura del QR
    useEffect(() => {
        if (typeof navigator === "undefined" || !("geolocation" in navigator)) { setGeoErr("Este equipo no tiene GPS"); return; }
        try {
            geoWatch.current = navigator.geolocation.watchPosition(
                (p) => { setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); setGeoErr(""); },
                (e) => { setGeoErr(e.code === 1 ? "Permiso de ubicacion denegado" : "No se pudo obtener GPS"); },
                { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 }
            );
        } catch { setGeoErr("No se pudo iniciar GPS"); }
        return () => { if (geoWatch.current != null) { try { navigator.geolocation.clearWatch(geoWatch.current); } catch { } } };
    }, []);

    const mark = async (direction: "ENTRY" | "EXIT") => {
        if (!res?.card || !geo) return; setBusy(true);
        try { await markEntry({ guestId: res.card.guestId, direction, method: "QR", validatedBy: guardName, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy }); onMarked(); onClose(); } finally { setBusy(false); }
    };

    const statusView = () => {
        if (!res) return null;
        const c = res.card;
        const map: Record<string, { t: string; theme: "ok" | "warn" | "bad"; ok: boolean }> = {
            valid: { t: "ACCESO AUTORIZADO", theme: "ok", ok: true },
            notyet: { t: "AÚN NO VIGENTE", theme: "warn", ok: false },
            expired: { t: "PASE VENCIDO", theme: "bad", ok: false },
            revoked: { t: "PASE REVOCADO", theme: "bad", ok: false },
            notfound: { t: "QR NO RECONOCIDO", theme: "bad", ok: false },
        };
        const s = map[res.status] || map.notfound;
        const band = s.theme === "ok" ? "bg-emerald-600" : s.theme === "warn" ? "bg-amber-500" : "bg-red-600";
        const panel = s.theme === "ok" ? "bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-500/30" : s.theme === "warn" ? "bg-amber-50 dark:bg-amber-950/40 ring-amber-500/30" : "bg-red-50 dark:bg-red-950/40 ring-red-500/30";
        const row = "flex items-center gap-2.5 text-sm";
        const ico = "shrink-0 text-muted-foreground";
        return (
            <div className={cn("rounded-2xl ring-1 overflow-hidden", panel)}>
                <div className={cn("px-4 py-4 text-white text-center", band)}>
                    <div className="mx-auto w-14 h-14 rounded-full bg-white/20 grid place-items-center mb-2">{s.ok ? <ShieldCheck size={30} /> : <ShieldAlert size={30} />}</div>
                    <div className="text-base font-extrabold tracking-wide">{s.t}</div>
                </div>
                <div className="p-4 space-y-2.5">
                    {c ? (<>
                        <div className={row}><UserCheck size={16} className={ico} /><span className="font-bold">{c.name || "Invitado"}</span></div>
                        <div className={row}><HomeIcon size={16} className={ico} /><span>{c.hostLabel || c.hostName || "—"}</span></div>
                        {c.plates.length > 0 && <div className={row}><Car size={16} className={ico} /><span className="font-bold tracking-wide">{c.plates.join(", ")}</span></div>}
                        <div className={row}><CalendarClock size={16} className={ico} /><span className="text-muted-foreground">{fmtDT(c.validFrom)} → {fmtDT(c.validTo)}</span></div>
                    </>) : <p className="text-sm text-muted-foreground">No encontramos este código en el sistema.</p>}
                    <div className="h-px bg-border my-1" />
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Datos de la lectura</div>
                    <div className={row}><Clock size={16} className={ico} /><span className="tabular-nums">{new Date().toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>
                    <div className={row}><ShieldCheck size={16} className={ico} /><span>{guardName}</span></div>
                    <div className={row}><MapPin size={16} className={cn("shrink-0", geo ? "text-emerald-600" : "text-red-500")} />{geo ? <span className="tabular-nums">{geo.lat.toFixed(5)}, {geo.lng.toFixed(5)} <span className="text-muted-foreground">(±{Math.round(geo.accuracy)} m)</span></span> : <span className="text-red-600 font-semibold">{geoErr || "Obteniendo ubicación GPS…"}</span>}</div>
                </div>
                <div className="flex items-center gap-2 p-4 pt-0">
                    {res.ok && c ? (<>
                        <button disabled={busy || !geo} onClick={() => mark("ENTRY")} className="flex-1 inline-flex items-center justify-center gap-1 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold disabled:opacity-40"><LogIn size={16} /> Ingreso</button>
                        <button disabled={busy || !geo} onClick={() => mark("EXIT")} className="flex-1 inline-flex items-center justify-center gap-1 h-11 rounded-xl bg-muted hover:bg-accent font-extrabold disabled:opacity-40"><LogOut size={16} /> Egreso</button>
                    </>) : (
                        <button onClick={start} className="flex-1 h-11 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold">Escanear otro</button>
                    )}
                </div>
                {res.ok && c && !geo && <div className="px-4 pb-4 -mt-1 text-[11px] text-red-600 font-semibold text-center">GPS obligatorio para registrar la lectura. Activá la ubicación.</div>}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
            <div className="w-full max-w-sm rounded-3xl bg-card ring-1 ring-border shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-sky-500/15 text-sky-600 grid place-items-center"><ScanLine size={18} /></div>
                    <h2 className="font-extrabold text-lg">Escanear QR del invitado</h2>
                    <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"><X size={18} /></button>
                </div>
                {res ? statusView() : (
                    <div className="relative aspect-square rounded-2xl overflow-hidden bg-black grid place-items-center">
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute inset-8 rounded-2xl border-2 border-white/70 shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]" />
                        {!streamRef.current && !err && <div className="relative text-white/70 flex flex-col items-center gap-2"><Camera size={28} /><span className="text-sm font-semibold">Iniciando cámara…</span></div>}
                        {err && <p className="relative text-white text-center text-sm font-semibold px-6">{err}</p>}
                    </div>
                )}
                {!res && <p className="text-xs text-muted-foreground text-center mt-3">Apuntá al QR del pase. También podés cerrar y buscar por nombre o patente.</p>}
            </div>
        </div>
    );
}

// Presets y parser de duracion en lenguaje natural para la validez del pase.
const VALID_PRESETS: { k: string; label: string; calc: (f: Date) => Date }[] = [
    { k: "1h", label: "1 h", calc: (f) => new Date(f.getTime() + 3600e3) },
    { k: "2h", label: "2 h", calc: (f) => new Date(f.getTime() + 2 * 3600e3) },
    { k: "4h", label: "4 h", calc: (f) => new Date(f.getTime() + 4 * 3600e3) },
    { k: "hoy", label: "Hoy", calc: (f) => { const y = new Date(f); y.setHours(23, 59, 0, 0); return y; } },
    { k: "man", label: "Mañana", calc: (f) => { const y = new Date(f); y.setDate(y.getDate() + 1); y.setHours(23, 59, 0, 0); return y; } },
    { k: "finde", label: "Fin de semana", calc: (f) => { const y = new Date(f); y.setDate(y.getDate() + ((7 - y.getDay()) % 7)); y.setHours(23, 59, 0, 0); return y; } },
    { k: "3d", label: "3 días", calc: (f) => { const y = new Date(f); y.setDate(y.getDate() + 3); return y; } },
    { k: "1w", label: "1 semana", calc: (f) => { const y = new Date(f); y.setDate(y.getDate() + 7); return y; } },
];
function parseDur(text: string, from: Date): Date | null {
    const t = (text || "").toLowerCase().trim(); if (!t) return null;
    const d = new Date(from.getTime());
    const eod = (x: Date) => { const y = new Date(x); y.setHours(23, 59, 0, 0); return y; };
    if (/(todo el d[ií]a|hoy)/.test(t)) return eod(d);
    if (/pasado ma[nñ]ana/.test(t)) { const y = new Date(d); y.setDate(y.getDate() + 2); return eod(y); }
    if (/ma[nñ]ana/.test(t)) { const y = new Date(d); y.setDate(y.getDate() + 1); return eod(y); }
    if (/fin de semana|finde/.test(t)) { const y = new Date(d); y.setDate(y.getDate() + ((7 - y.getDay()) % 7)); return eod(y); }
    const mh = t.match(/hasta (?:las? )?(\d{1,2})(?::(\d{2}))?/);
    if (mh) { const y = new Date(d); y.setHours(parseInt(mh[1]), mh[2] ? parseInt(mh[2]) : 0, 0, 0); if (y <= d) y.setDate(y.getDate() + 1); return y; }
    const mn = t.match(/(\d+(?:[.,]\d+)?)\s*(semanas?|sem|d[ií]as?|horas?|hs?|minutos?|mins?|h|d|m)/);
    if (mn) { const n = parseFloat(mn[1].replace(",", ".")); const u = mn[2]; const y = new Date(d);
        if (/^sem/.test(u)) y.setDate(y.getDate() + n * 7);
        else if (/^d/.test(u)) y.setDate(y.getDate() + n);
        else if (/^h/.test(u)) y.setTime(y.getTime() + n * 3600e3);
        else y.setTime(y.getTime() + n * 60e3);
        return y;
    }
    return null;
}
function NewPassModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const now = new Date();
    const toLocal = (d: Date) => { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
    const [guestName, setGuestName] = useState("");
    const [plate, setPlate] = useState("");
    const [hostLabel, setHostLabel] = useState("");
    const [from, setFrom] = useState(toLocal(now));
    const [to, setTo] = useState(toLocal(new Date(now.getTime() + 8 * 3600 * 1000)));
    const [durText, setDurText] = useState("");
    const applyDur = (txt: string) => { const d = parseDur(txt, new Date(from)); if (d) { setTo(toLocal(d)); setErr(""); } else setErr("No entend\u00ed la duraci\u00f3n. Prob\u00e1: \"2 horas\", \"hasta ma\u00f1ana\", \"3 d\u00edas\"."); };
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState("");
    const [done, setDone] = useState<{ code: string; qrToken?: string } | null>(null);
    const [svg, setSvg] = useState("");

    useEffect(() => { if (done?.qrToken) getQrSvg(done.qrToken).then(setSvg).catch(() => { }); }, [done]);

    const submit = async () => {
        setErr("");
        if (guestName.trim().length < 2) { setErr("Ingresá el nombre del invitado."); return; }
        if (new Date(to) <= new Date(from)) { setErr("La ventana horaria es inválida."); return; }
        setSaving(true);
        try {
            const r = await quickInvite({ guestName: guestName.trim(), plate: plate.trim() || undefined, hostLabel: hostLabel.trim(), hostName: hostLabel.trim(), validFrom: from, validTo: to, reentry: "MULTI", createdVia: "GUARD", createdBy: "guardia" });
            if (r.ok) setDone({ code: r.code || "OK", qrToken: r.qrToken }); else setErr(r.error || "No se pudo crear.");
        } catch (e: any) { setErr(e?.message || "Error"); } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
            <div className="w-full max-w-md rounded-3xl bg-card ring-1 ring-border shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 grid place-items-center"><UserPlus size={18} /></div>
                    <h2 className="font-extrabold text-lg">Nuevo pase de visita</h2>
                    <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"><X size={18} /></button>
                </div>

                {done ? (
                    <div className="text-center py-2">
                        <div className="w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-600 grid place-items-center mx-auto mb-2"><ShieldCheck size={24} /></div>
                        <p className="font-bold">Pase creado y avisado a las garitas.</p>
                        <p className="text-sm text-muted-foreground mt-0.5">Código: <span className="font-extrabold tracking-widest">{done.code}</span></p>
                        {svg && <div className="inline-block p-3 bg-white rounded-2xl mt-3" dangerouslySetInnerHTML={{ __html: svg }} />}
                        <p className="text-xs text-muted-foreground mt-2">El invitado puede mostrar este QR en la garita.</p>
                        <button onClick={onCreated} className="mt-4 h-11 px-6 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold">Listo</button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <Field label="Nombre del invitado"><input autoFocus value={guestName} onChange={(e) => setGuestName(e.target.value)} className="inp" placeholder="Juan Pérez" /></Field>
                        <Field label="Patente (dejar vacío si viene a pie)"><input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className="inp tracking-wide" placeholder="SAB1234" /></Field>
                        <Field label="Lote / quién invita"><input value={hostLabel} onChange={(e) => setHostLabel(e.target.value)} className="inp" placeholder="Flia. García · Lote 12" /></Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Desde"><input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="inp" /></Field>
                            <Field label="Hasta"><input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="inp" /></Field>
                        </div>
                        <div>
                            <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 inline-flex items-center gap-1.5"><Clock size={12} /> Validez rápida</div>
                            <div className="flex flex-wrap gap-1.5">
                                {VALID_PRESETS.map((p) => (
                                    <button key={p.k} type="button" onClick={() => { setTo(toLocal(p.calc(new Date(from)))); setErr(""); }} className="px-2.5 py-1 rounded-full bg-accent hover:bg-accent/70 text-xs font-bold transition-colors">{p.label}</button>
                                ))}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                                <input value={durText} onChange={(e) => setDurText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyDur(durText); } }} placeholder='Escribí cuánto: "2 horas", "hasta mañana", "3 días"' className="inp flex-1" />
                                <button type="button" onClick={() => applyDur(durText)} className="h-10 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shrink-0">Aplicar</button>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1.5">Vence: <b className="text-foreground">{fmtDT(to)}</b></div>
                        </div>
                        {err && <p className="text-sm text-red-500 font-semibold">{err}</p>}
                        <button disabled={saving} onClick={submit} className="w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
                            {saving ? <Loader2 size={18} className="animate-spin" /> : <UserPlus size={18} />} Crear pase
                        </button>
                    </div>
                )}
            </div>
            <style jsx>{`.inp{width:100%;height:44px;padding:0 12px;border-radius:14px;background:hsl(var(--muted));outline:none;font-weight:600}.inp:focus{box-shadow:0 0 0 2px rgb(245 158 11)}`}</style>
        </div>
    );
}

function ResidentLinkModal({ onClose }: { onClose: () => void }) {
    const [q, setQ] = useState("");
    const [list, setList] = useState<{ id: string; name: string; label: string; phone: string | null }[]>([]);
    const [link, setLink] = useState<{ name: string; url: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        const term = q.trim(); if (term.length < 2) { setList([]); return; }
        const t = setTimeout(async () => { setLoading(true); try { setList(await listResidentsForPortal(term)); } finally { setLoading(false); } }, 280);
        return () => clearTimeout(t);
    }, [q]);
    const gen = async (r: { id: string; name: string }) => {
        const res = await getOrCreatePortalToken(r.id);
        if (res.ok && res.token) setLink({ name: r.name, url: `${window.location.origin}/residente/${res.token}` });
    };
    const copy = async () => { if (!link) return; try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { } };
    return (
        <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
            <div className="w-full max-w-md rounded-3xl bg-card ring-1 ring-border shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-sky-500/15 text-sky-600 grid place-items-center"><KeyRound size={18} /></div>
                    <h2 className="font-extrabold text-lg">Link de portal del residente</h2>
                    <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"><X size={18} /></button>
                </div>
                {link ? (
                    <div className="text-center py-2">
                        <p className="text-sm text-muted-foreground">Link personal de <b className="text-foreground">{link.name}</b> para autogestionar sus invitaciones:</p>
                        <div className="mt-3 p-3 rounded-xl bg-muted text-xs font-mono break-all">{link.url}</div>
                        <div className="flex items-center gap-2 mt-3">
                            <button onClick={copy} className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold transition-colors"><Copy size={15} /> {copied ? "¡Copiado!" : "Copiar link"}</button>
                            <button onClick={() => setLink(null)} className="h-11 px-4 rounded-xl bg-muted hover:bg-accent text-sm font-bold">Otro</button>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-3">Reenvíaselo por WhatsApp o mail. Con ese link entra sin contraseña.</p>
                    </div>
                ) : (
                    <>
                        <div className="relative">
                            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar residente por nombre o lote…" className="w-full h-12 pl-10 pr-3 rounded-xl bg-muted outline-none font-semibold focus:ring-2 focus:ring-sky-500" />
                        </div>
                        <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-border rounded-xl">
                            {loading && <div className="py-6 grid place-items-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>}
                            {!loading && q.trim().length >= 2 && list.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">Sin residentes para “{q}”.</div>}
                            {list.map((r) => (
                                <button key={r.id} onClick={() => gen(r)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent transition-colors">
                                    <div className="w-8 h-8 rounded-full bg-muted grid place-items-center shrink-0"><HomeIcon size={14} className="text-muted-foreground" /></div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-sm truncate">{r.name}</div>
                                        <div className="text-xs text-muted-foreground truncate">{r.label || "—"}{r.phone ? ` · ${r.phone}` : ""}</div>
                                    </div>
                                    <KeyRound size={15} className="text-sky-500 shrink-0" />
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="block text-xs font-bold text-muted-foreground mb-1">{label}</span>{children}</label>;
}
