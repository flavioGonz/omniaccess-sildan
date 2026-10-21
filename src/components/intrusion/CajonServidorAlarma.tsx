"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, Ear, Loader2, RefreshCcw, Server, ShieldAlert, Wifi } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { DestinoEventos } from "@/components/devices/DestinoEventos";

/**
 * El servidor de alarma de una cámara, en un cajón (21/10, Nico: «ese modal debe ser un drawer»).
 *
 * Era un diálogo centrado con dos problemas además de la forma:
 *  · «Destino OmniAccess: 172.16.2.71:10000» estaba ESCRITO A MANO. No era el que se usaba: el real
 *    sale del destino de eventos (actions/destino-eventos), y en el lab ni existía.
 *  · Si configurar fallaba, el mensaje se borraba al releer el equipo enseguida: el botón «no
 *    hacía nada» y el error sólo se veía en la consola (502).
 * Ahora el destino es el real; si falta, se dice acá mismo; y el resultado queda a la vista.
 */
type Cam = { id: string; name: string; nvrName?: string | null };
type Host = { id: string; ip: string; port: string; url?: string };
type Aviso = { ok: boolean; texto: string } | null;

export function CajonServidorAlarma({ cam, onClose, onStatus }: { cam: Cam | null; onClose: () => void; onStatus?: (camId: string, ok: boolean) => void }) {
    const [fase, setFase] = useState<"cargando" | "listo" | "aplicando" | "probando">("cargando");
    const [hosts, setHosts] = useState<Host[]>([]);
    const [hasOmni, setHasOmni] = useState(false);
    const [destino, setDestino] = useState<string | null>(null);
    const [lectura, setLectura] = useState<string | null>(null);
    const [aviso, setAviso] = useState<Aviso>(null);
    const [dahua, setDahua] = useState(false);
    const [nvr, setNvr] = useState<{ ip: string; name: string; reachable: boolean } | null>(null);
    const [info, setInfo] = useState("");
    /** OmniAccess va a buscar los eventos (escucha-eventos): para cuando la cámara no puede llamar. */
    const [escucha, setEscucha] = useState<boolean | null>(null);
    const [cambiandoEscucha, setCambiandoEscucha] = useState(false);
    useEffect(() => {
        if (!cam) return;
        setEscucha(null);
        fetch(`/api/devices/escucha?deviceId=${cam.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setEscucha(!!d.escucha)).catch(() => setEscucha(false));
    }, [cam?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const alternarEscucha = async (v: boolean) => {
        if (!cam) return;
        setCambiandoEscucha(true);
        try {
            const d = await fetch("/api/devices/escucha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: cam.id, escuchar: v }) }).then((r) => r.json());
            if (d.ok) setEscucha(v); else setAviso({ ok: false, texto: d.error || "No se pudo cambiar." });
        } catch (e: any) { setAviso({ ok: false, texto: e?.message || "No se pudo cambiar." }); }
        finally { setCambiandoEscucha(false); }
    };

    const leer = useCallback(async () => {
        if (!cam) return;
        setFase("cargando");
        try {
            const d = await fetch(`/api/devices/alarm-host?deviceId=${cam.id}`, { cache: "no-store" }).then((r) => r.json());
            setHosts(Array.isArray(d.hosts) ? d.hosts : []); setHasOmni(!!d.hasOmni); setDestino(d.destino ?? null);
            setDahua(!!d.dahua); setNvr(d.nvr || null); setInfo(d.info || "");
            setLectura(!d.ok && d.error ? d.error : null);
            onStatus?.(cam.id, !!d.hasOmni);
        } catch { setLectura("No se pudo leer la configuración del equipo."); }
        setFase("listo");
    }, [cam, onStatus]);
    useEffect(() => { setAviso(null); leer(); }, [cam?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const aplicar = async () => {
        if (!cam) return;
        setFase("aplicando"); setAviso(null);
        let a: Aviso;
        try {
            const d = await fetch(`/api/devices/alarm-host?deviceId=${cam.id}`, { method: "POST" }).then((r) => r.json());
            a = d.ok ? { ok: true, texto: d.already ? "Ya estaba configurado." : `Configurado en el equipo${d.slot ? ` (lugar #${d.slot})` : ""}.` } : { ok: false, texto: d.error || "No se pudo configurar." };
            if (d.ok) onStatus?.(cam.id, true);
        } catch (e: any) { a = { ok: false, texto: e?.message || "No se pudo configurar." }; }
        await leer();
        setAviso(a); // después de releer: si no, la lectura lo borraba
    };
    const probar = async () => {
        if (!cam) return;
        setFase("probando"); setAviso(null);
        try {
            const d = await fetch(`/api/devices/alarm-host?deviceId=${cam.id}&action=test`, { method: "POST" }).then((r) => r.json());
            setAviso(d.ok ? { ok: !!d.reporting, texto: d.reporting ? "El equipo le reporta bien a OmniAccess." : "Prueba enviada; el equipo no la confirmó. Revisá que lleguen eventos." } : { ok: false, texto: d.error || "La prueba falló." });
        } catch (e: any) { setAviso({ ok: false, texto: e?.message || "La prueba falló." }); }
        setFase("listo");
    };

    const ocupado = fase === "aplicando" || fase === "probando";
    const pie = fase === "cargando" ? null : dahua ? (
        <>
            <Button variant="outline" onClick={probar} disabled={ocupado} className="gap-1.5">{fase === "probando" ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />} Verificar suscripción</Button>
            <Button onClick={onClose}>Listo</Button>
        </>
    ) : (
        <>
            {hasOmni && <Button variant="outline" onClick={aplicar} disabled={ocupado} className="gap-1.5 mr-auto">{fase === "aplicando" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Reescribir</Button>}
            {hasOmni
                ? <Button onClick={probar} disabled={ocupado} className="gap-1.5">{fase === "probando" ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />} Probar reporte</Button>
                : <Button onClick={aplicar} disabled={ocupado || !destino} className="gap-1.5">{fase === "aplicando" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Configurar OmniAccess como alarma</Button>}
        </>
    );

    return (
        <Cajon open={!!cam} onOpenChange={(o) => { if (!o && !ocupado) onClose(); }}>
            <CajonContenido ancho="angosto" titulo="Servidor de alarma" descripcion={cam ? `${cam.name}${cam.nvrName ? ` · ${cam.nvrName}` : ""}` : ""} sinCerrar={ocupado} pie={pie}>
                <div className="px-6 py-5 space-y-5">
                    {fase === "cargando" ? (
                        <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center text-[13px]"><Loader2 size={16} className="animate-spin" /> Leyendo la configuración del equipo…</div>
                    ) : dahua ? (
                        <section className="rounded-[10px] border border-border p-4 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Recepción de eventos · Dahua</span>
                                <span className={cn("ml-auto inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-semibold", nvr?.reachable ? "chip-bien" : "chip-mal")}>{nvr?.reachable ? <><Check size={11} /> Suscripción activa</> : <><ShieldAlert size={11} /> NVR no accesible</>}</span>
                            </div>
                            <p className="text-[12.5px] text-muted-foreground leading-snug">{info || "OmniAccess recibe los eventos de este NVR Dahua por suscripción directa. No hace falta configurar un servidor de alarma en el equipo."}</p>
                            {nvr && <p className="text-[12px] text-muted-foreground flex items-center gap-1.5"><Server size={12} /> <span className="font-mono">{nvr.name} · {nvr.ip}</span></p>}
                        </section>
                    ) : (
                        <>
                            {/* Estado, en grande: es lo que se vino a ver. */}
                            <div className="flex items-start gap-3">
                                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", hasOmni ? "pleno-bien" : "bg-[color-mix(in_oklab,var(--aviso)_16%,transparent)] tono-aviso")}>{hasOmni ? <Check size={18} /> : <BellRing size={18} />}</span>
                                <div className="min-w-0">
                                    <div className="text-[15px] font-bold leading-tight">{hasOmni ? "Le avisa a OmniAccess" : "No le avisa a OmniAccess"}</div>
                                    <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">{hasOmni ? "Sus cruces de línea y entradas a zona llegan al monitor." : "La cámara detecta, pero sus alarmas no llegan al monitor hasta configurarle OmniAccess como servidor."}</p>
                                </div>
                            </div>

                            <section>
                                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Servidores de alarma en el equipo</div>
                                {lectura ? <p className="text-[12.5px] tono-mal">{lectura}</p> : hosts.length === 0 ? <p className="text-[12.5px] text-muted-foreground">No tiene ninguno configurado.</p> : (
                                    <div className="rounded-[10px] border border-border divide-y divide-border">
                                        {hosts.map((h) => {
                                            const libre = !h.ip || h.ip === "0.0.0.0";
                                            const nuestro = !libre && destino === `${h.ip}:${h.port}`;
                                            return (
                                                <div key={h.id} className="flex items-center gap-3 px-3 h-10 text-[12.5px]">
                                                    <span className="w-6 text-muted-foreground font-mono">#{h.id}</span>
                                                    <span className={cn("flex-1 truncate font-mono", libre && "text-muted-foreground/60")}>{libre ? "libre" : `${h.ip}:${h.port}${h.url && h.url !== "/" ? h.url : ""}`}</span>
                                                    {nuestro && <span className="chip-bien inline-flex items-center gap-1 h-5 px-1.5 rounded-full text-[10.5px] font-semibold"><Check size={10} /> OmniAccess</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>

                            {/* 21/10, Otto Villa: la cámara ve a OmniAccess pero no puede llamarlo (la red no tiene ruta
                                de vuelta; la prueba da «deviceError»). Entonces OmniAccess va a buscar los eventos. */}
                            <section className="rounded-[10px] border border-border p-3.5 space-y-1.5">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <Ear size={16} className="text-muted-foreground shrink-0" />
                                    <span className="flex-1 text-[13px] font-semibold">Escuchar los eventos desde OmniAccess</span>
                                    {escucha === null || cambiandoEscucha ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : <Switch checked={escucha} onCheckedChange={alternarEscucha} />}
                                </label>
                                <p className="text-[12px] text-muted-foreground leading-snug">Para cuando la cámara no puede llamar a OmniAccess (la prueba falla porque la red no tiene ruta de vuelta): OmniAccess se conecta a la cámara y trae sus cruces y zonas. Si la cámara sí llega, dejalo apagado para no recibir cada evento dos veces.</p>
                            </section>

                            <section>
                                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Destino de OmniAccess</div>
                                {destino ? (
                                    <p className="text-[12.5px]">Las cámaras le mandan a <span className="font-mono font-semibold">{destino}</span>. <span className="text-muted-foreground">Es el mismo para todas.</span></p>
                                ) : (
                                    <div className="space-y-2.5">
                                        <p className="text-[12.5px] text-muted-foreground leading-snug">Falta decir a qué IP le mandan los eventos las cámaras: la de este servidor vista desde su red. Se guarda una vez para todas.</p>
                                        <DestinoEventos alGuardar={(d) => { setDestino(d); setAviso(null); }} />
                                    </div>
                                )}
                            </section>
                        </>
                    )}
                    {aviso && (
                        <div className={cn("rounded-[10px] px-3.5 py-2.5 text-[12.5px] leading-snug flex items-start gap-2", aviso.ok ? "bg-[color-mix(in_oklab,var(--bien)_10%,transparent)]" : "bg-[color-mix(in_oklab,var(--mal)_8%,transparent)] tono-mal")}>
                            {aviso.ok ? <Check size={15} className="tono-bien shrink-0 mt-px" /> : <ShieldAlert size={15} className="shrink-0 mt-px" />} {aviso.texto}
                        </div>
                    )}
                </div>
            </CajonContenido>
        </Cajon>
    );
}
