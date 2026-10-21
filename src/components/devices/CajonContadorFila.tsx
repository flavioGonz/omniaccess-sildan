"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Tooltip } from "react-tooltip";
import {
    Users, Sparkles, Tag, Type, MapPin, Plug, Network, User, KeyRound, ShieldCheck, Lock, Unlock, Loader2, Save, X,
    Activity, ExternalLink, AlertTriangle, Check, ListOrdered,
} from "lucide-react";
import { Cajon, CajonContenido, CajonCerrar } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Bloque, Campo, Etiqueta, Opcion, TT_FICHA } from "@/components/devices/CajonDispositivo";
import { updateDevice } from "@/app/actions/devices";
import { fichaContadorFila, ajustesContadorFila, type FichaContadorFila } from "@/app/actions/contador-fila";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/*
 * La ficha de un contador de filas (21/10, Nico: «tiene el modal viejo, revisá esto, debe tener su
 * modal»). La Bosch del Hospital Británico abría «Sincronizar nodo», el formulario de cuatro fases
 * para dar de alta una lectora, con «modelo hardware» y «fase 2». Un contador se mira distinto: si se
 * lo está leyendo, cuánta gente cuenta ahora, cómo se le habla, y si OmniVision cuenta la misma fila
 * para compararla. Usa las mismas piezas que la ficha de las cámaras (CajonDispositivo).
 */

/** Cada cuánto se vuelve a preguntar el aforo y el estado mientras la ficha está abierta. */
const REFRESCO_MS = 5000;

const hace = (iso: string | null) => {
    if (!iso) return null;
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};

export function CajonContadorFila({ device, open, onOpenChange, onSuccess }: {
    device: any | null; open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void;
}) {
    const [ficha, setFicha] = useState<FichaContadorFila | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [f, setF] = useState({ name: "", location: "", ip: "", username: "", password: "", authType: "DIGEST", soloHttp: false, enOmniVision: false });
    const [guardando, setGuardando] = useState(false);
    const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));

    const traer = useCallback(async (primera: boolean) => {
        if (!device?.id) return;
        try {
            const r = await fichaContadorFila(device.id);
            setFicha(r); setError(null);
            if (primera) setF({ name: r.name, location: r.location || "", ip: r.ip, username: r.username || "", password: "", authType: r.authType || "DIGEST", soloHttp: r.soloHttp, enOmniVision: r.vision.enOmniVision });
        } catch (e: any) { setError(e?.message || "No se pudo leer el equipo"); }
    }, [device?.id]);
    useEffect(() => {
        if (!open) return;
        setFicha(null); setError(null);
        traer(true);
        const t = setInterval(() => traer(false), REFRESCO_MS);
        return () => clearInterval(t);
    }, [open, traer]);

    const ipValida = /^\d{1,3}(\.\d{1,3}){3}$/.test(f.ip.trim());
    const guardar = async () => {
        if (!ficha) return;
        if (!f.name.trim()) { toast.error({ title: "Falta el nombre" }); return; }
        if (!ipValida) { toast.error({ title: "La IP no es válida", description: "Ejemplo: 10.96.8.77" }); return; }
        setGuardando(true);
        try {
            const fd = new FormData();
            fd.set("name", f.name.trim()); fd.set("ip", f.ip.trim()); fd.set("location", f.location.trim());
            fd.set("brand", ficha.brand); fd.set("deviceType", "QUEUE_COUNTER"); fd.set("direction", ficha.direction);
            fd.set("username", f.username.trim()); fd.set("authType", f.authType);
            // Vacía = no se toca (updateDevice): la clave guardada no viaja al navegador.
            if (f.password) fd.set("password", f.password);
            if (ficha.deviceModel) fd.set("deviceModel", ficha.deviceModel);
            await updateDevice(ficha.id, fd);
            await ajustesContadorFila(ficha.id, { soloHttp: f.soloHttp, enOmniVision: f.enOmniVision, ipAnterior: ficha.ip, ip: f.ip.trim() });
            toast.success({ title: "Cambios guardados", description: f.name });
            onSuccess(); onOpenChange(false);
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };

    const b = ficha?.bosch;
    const v = ficha?.vision;
    const marca = ficha?.brand === "BOSCH" ? "Bosch" : ficha?.brand || "";

    const pie = (
        <div className="flex items-center gap-2 w-full">
            <span className="text-[11.5px] text-muted-foreground mr-auto">La contraseña vacía deja la que está guardada.</span>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || !ficha} className="gap-1.5">{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar cambios</Button>
        </div>
    );

    return (
        <Cajon open={open} onOpenChange={(x) => { if (!guardando) onOpenChange(x); }}>
            <CajonContenido ancho="intermedio" tituloOculto sinCabecera titulo={device?.name || "Contador de filas"} descripcion={`Contador de filas · ${marca}`} pie={pie}>
                <CabeceraContador id={device?.id} titulo={f.name || device?.name || "Contador de filas"} subtitulo={`Contador de filas · ${marca}${ficha?.deviceModel ? ` · ${ficha.deviceModel}` : ""}`}
                    ip={f.ip || device?.ip} http={f.soloHttp} bosch={b || null} />

                {error && !ficha ? (
                    <div className="px-6 py-10 text-center">
                        <AlertTriangle size={22} className="mx-auto mb-2 tono-mal" />
                        <div className="text-[13px] font-semibold">No se pudo leer el equipo</div>
                        <div className="text-[12px] text-muted-foreground mt-1">{error}</div>
                        <Button variant="outline" size="sm" className="mt-3" onClick={() => traer(true)}>Reintentar</Button>
                    </div>
                ) : !ficha ? (
                    <div className="px-6 py-10 grid place-items-center text-muted-foreground text-[13px]"><span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Leyendo el contador…</span></div>
                ) : (
                    <div>
                        <Bloque titulo={`Conteo de ${marca}`} icono={Users} ayuda="Lo que cuenta la analítica de la propia cámara (sus reglas de conteo / cola). OmniAccess se suscribe a sus eventos ONVIF y guarda cada cambio de aforo."
                            accion={<Link href="/admin/monitor-queue" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accion)] hover:underline">Monitor de filas <ExternalLink size={12} /></Link>}>
                            <div className="grid grid-cols-3 gap-3">
                                <Cifra rotulo="Estado" valor={b!.leyendo ? "Leyendo" : "Sin lectura"} tono={b!.leyendo ? "bien" : "mal"}
                                    detalle={b!.ultimaLectura ? `última ${hace(b!.ultimaLectura)}` : "nunca se leyó"} />
                                <Cifra rotulo="Aforo ahora" valor={b!.aforo != null ? `${b!.aforo}` : "—"} unidad={b!.aforo === 1 ? "persona" : "personas"}
                                    detalle={b!.aforoTs ? `${b!.canal || "conteo"} · ${hace(b!.aforoTs)}` : "todavía sin eventos"} />
                                <Cifra rotulo="Cambios en 24 h" valor={b!.eventos24h.toLocaleString("es-UY")} detalle="eventos de aforo guardados" />
                            </div>
                            {!b!.leyendo && (
                                <p className="text-[12px] text-muted-foreground flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0 tono-aviso" />
                                    Sin lectura: revisá la IP, las credenciales y el protocolo de abajo. Si la cámara está detrás de una VPN lenta, la suscripción puede tardar en armarse.</p>
                            )}
                        </Bloque>

                        <Bloque titulo="Doble verificación con OmniVision" icono={Sparkles} ayuda="OmniVision mira el mismo video y cuenta la fila por su cuenta (regla «fila»). Con las dos cifras se ve si la analítica de la cámara cuenta bien."
                            accion={<Link href="/admin/vision/filas" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accion)] hover:underline">Filas en OmniVision <ExternalLink size={12} /></Link>}>
                            <div className="grid grid-cols-2 gap-3">
                                <Opcion activa={f.enOmniVision} onClick={() => set("enOmniVision", true)} icono={Sparkles} color="text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]"
                                    titulo="OmniVision la mira" detalle="Cuenta la fila con su propia detección." />
                                <Opcion activa={!f.enOmniVision} onClick={() => set("enOmniVision", false)} icono={X} color="text-muted-foreground bg-muted"
                                    titulo="Sólo la cámara" detalle="Sin segunda opinión." />
                            </div>
                            {f.enOmniVision && (
                                v!.reglas.length ? (
                                    <div className="space-y-1.5">
                                        {v!.reglas.map((r) => (
                                            <div key={r.id} className="flex items-center gap-2 text-[12.5px] rounded-lg border border-border px-3 h-9">
                                                <ListOrdered size={14} className="text-muted-foreground shrink-0" />
                                                <span className="font-semibold truncate">{r.nombre}</span>
                                                <span className={cn("ml-auto text-[11px] font-semibold", r.activa ? "tono-bien" : "text-muted-foreground")}>{r.activa ? "activa" : "apagada"}</span>
                                            </div>
                                        ))}
                                        <p className="text-[11.5px] text-muted-foreground">{v!.ultimoEvento ? `Último movimiento de la fila ${hace(v!.ultimoEvento)} · ${v!.eventos24h} en 24 h.` : "Todavía no registró movimientos en la fila."}</p>
                                    </div>
                                ) : (
                                    <p className="text-[12px] text-muted-foreground flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0 tono-aviso" />
                                        No hay una regla de fila para esta cámara: dibujá la zona en OmniVision › Analíticas › Filas.</p>
                                )
                            )}
                        </Bloque>

                        <Bloque titulo="Identidad" icono={Tag} ayuda="Cómo se llama y dónde está. Es lo que se ve en el monitor de filas y en los avisos.">
                            <Campo etiqueta="Nombre" icono={Type} value={f.name} onChange={(x) => set("name", x)} placeholder="Cola Caja 1" />
                            <Campo etiqueta="Ubicación" icono={MapPin} value={f.location} onChange={(x) => set("location", x)} placeholder="Hall de cajas" />
                        </Bloque>

                        <Bloque titulo="Conexión" icono={Plug} ayuda="Cómo le habla OmniAccess a la cámara para leer su conteo y su video.">
                            <div className="grid grid-cols-2 gap-4">
                                <Campo etiqueta="IP" icono={Network} value={f.ip} onChange={(x) => set("ip", x)} mono placeholder="10.96.8.77" />
                                <Campo etiqueta="Usuario" icono={User} value={f.username} onChange={(x) => set("username", x)} placeholder="service" />
                            </div>
                            <Campo etiqueta="Contraseña" icono={KeyRound} tipo="password" value={f.password} onChange={(x) => set("password", x)} placeholder="Sin cambios" />
                            <div>
                                <Etiqueta texto="Autenticación" ayuda="Las Bosch por HTTP piden Digest. Si la cámara contesta 401 con Digest, OmniAccess lo usa igual." />
                                <div className="grid grid-cols-2 gap-3">
                                    <Opcion activa={f.authType === "DIGEST"} onClick={() => set("authType", "DIGEST")} icono={ShieldCheck} color="text-emerald-600 bg-emerald-500/10" titulo="Digest" detalle="La de las Bosch." />
                                    <Opcion activa={f.authType === "BASIC"} onClick={() => set("authType", "BASIC")} icono={KeyRound} color="text-muted-foreground bg-muted" titulo="Básica" detalle="Usuario y clave en claro." />
                                </div>
                            </div>
                            <div>
                                <Etiqueta texto="Protocolo" ayuda="HTTPS es lo normal. HTTP sirve cuando el HTTPS de la cámara se cuelga (pasó con la Bosch del Hospital Británico): también le da más tiempo para contestar, pensando en una VPN lenta." />
                                <div className="grid grid-cols-2 gap-3">
                                    <Opcion activa={!f.soloHttp} onClick={() => set("soloHttp", false)} icono={Lock} color="text-emerald-600 bg-emerald-500/10" titulo="HTTPS" detalle="Cifrado, lo de siempre." />
                                    <Opcion activa={f.soloHttp} onClick={() => set("soloHttp", true)} icono={Unlock} color="text-amber-600 bg-amber-500/10" titulo="HTTP" detalle="Si el HTTPS se cuelga." />
                                </div>
                            </div>
                        </Bloque>
                    </div>
                )}
                <Tooltip id={TT_FICHA} place="top" className="!max-w-[300px] !text-[12px] !leading-snug !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}

/** Una cifra del conteo: el número grande, la unidad y una línea de contexto. */
function Cifra({ rotulo, valor, unidad, detalle, tono }: { rotulo: string; valor: string; unidad?: string; detalle?: string; tono?: "bien" | "mal" }) {
    return (
        <div className="rounded-lg bg-muted/50 px-3 py-2.5 min-w-0">
            <div className="text-[11px] font-semibold text-muted-foreground">{rotulo}</div>
            <div className={cn("text-[20px] font-bold leading-tight tabular-nums truncate", tono === "bien" && "tono-bien", tono === "mal" && "tono-mal")}>
                {valor}{unidad && <span className="text-[12px] font-semibold text-muted-foreground ml-1">{unidad}</span>}
            </div>
            {detalle && <div className="text-[11px] text-muted-foreground truncate">{detalle}</div>}
        </div>
    );
}

/** El video de la fila arriba, con el aforo de la cámara encima: es lo que se vino a mirar. */
function CabeceraContador({ id, titulo, subtitulo, ip, http, bosch }: { id?: string; titulo: string; subtitulo: string; ip?: string; http: boolean; bosch: FichaContadorFila["bosch"] | null }) {
    const [listo, setListo] = useState(false);
    const [falla, setFalla] = useState(false);
    useEffect(() => { setListo(false); setFalla(false); }, [id]);
    const chip = "inline-flex items-center gap-1 h-6 px-2 rounded-md bg-black/45 backdrop-blur-md text-white text-[10.5px] font-bold ring-1 ring-white/10";
    return (
        <div className="sticky top-0 z-20">
            <div className="relative w-full aspect-video overflow-hidden bg-black">
                {id && !falla && (
                    <video key={id} src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(`lpr_${id}`)}&video=h264`} autoPlay muted playsInline
                        onPlaying={() => setListo(true)} onError={() => setFalla(true)}
                        className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-500", listo ? "opacity-100" : "opacity-0")} />
                )}
                {!listo && (
                    <span className="absolute inset-0 grid place-items-center text-white/70 text-[12px] font-semibold">
                        {falla ? <span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Sin video de la cámara</span> : <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Conectando el vivo…</span>}
                    </span>
                )}
                <span className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />
                <span className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 to-transparent pointer-events-none" />
                <div className="absolute left-5 top-4 right-4 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-[19px] font-bold text-white leading-tight truncate drop-shadow">{titulo}</h2>
                        <p className="text-[12px] text-white/75 truncate drop-shadow">{subtitulo}</p>
                        <div className="flex items-center gap-1.5 mt-2">
                            <span className={chip}><ListOrdered size={12} /> Contador de filas</span>
                            {listo && <span className={cn(chip, "!bg-red-600/85")}><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> EN VIVO</span>}
                        </div>
                    </div>
                    <CajonCerrar className="shrink-0 h-9 w-9 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md text-white grid place-items-center ring-1 ring-white/15 transition-colors" aria-label="Cerrar"><X size={17} /></CajonCerrar>
                </div>
                <div className="absolute left-4 right-4 bottom-3 flex items-end gap-3">
                    <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                        {ip && <span className={cn(chip, "font-mono")}><Network size={11} /> {ip}</span>}
                        <span className={chip}>{http ? <Unlock size={11} /> : <Lock size={11} />} {http ? "HTTP" : "HTTPS"}</span>
                        {bosch && <span className={cn(chip, bosch.leyendo ? "!bg-emerald-600/80" : "!bg-red-600/80")}>{bosch.leyendo ? <Check size={11} /> : <AlertTriangle size={11} />} {bosch.leyendo ? "Leyendo el conteo" : "Sin lectura"}</span>}
                    </div>
                    {bosch?.aforo != null && (
                        <div className="shrink-0 rounded-xl bg-white/95 text-black px-3 py-1.5 text-right shadow-lg">
                            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-black/55 inline-flex items-center gap-1"><Activity size={10} /> Aforo</div>
                            <div className="text-[22px] font-extrabold leading-none tabular-nums">{bosch.aforo}<span className="text-[11px] font-bold text-black/55 ml-1">{bosch.aforo === 1 ? "persona" : "personas"}</span></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
