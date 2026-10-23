"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Siren, Server, KeyRound, Copy, Eye, EyeOff, Loader2, Plus, Trash2, RefreshCw, ShieldCheck, ShieldOff, Home, Lock, Unlock, Radio, FlaskConical, Wifi, Globe, Check, Camera, X, Info, Network, CircleCheck, Wrench, Activity, Ban, CircleSlash, Flame, WifiOff, AlertTriangle, HeartPulse, MapPin, UserRound, Layers, LockKeyhole, CheckCheck } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { POR_RECEPTOR, PUERTO_CMS } from "@/lib/centrales/limites";
import { sileo as toast } from "sileo";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { ConfirmarEnCajon } from "@/components/ui/cajon-confirmar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Chip, Cargando, ErrorEstado } from "@/components/ui/estados";
import { ElegirArea } from "@/components/devices/ElegirArea";
import { ElegirCamara } from "@/components/devices/ElegirCamara";
import { useAreas } from "@/lib/use-areas";
import { TODAS_LAS_AREAS } from "@/lib/use-filtro-area";
import { getDevices, deleteDevice } from "@/app/actions/devices";
import { cn } from "@/lib/utils";

/**
 * Alta y ficha de una central de alarma (Alarm Hub, SIA DC-09). openspec alarm-hub-sia-dc09, 5.1–5.3.
 *
 * Una pieza aparte del alta de cámaras (CajonDispositivo) a propósito: aquella es un asistente de
 * cámaras —conexión, modo, grabación, puesta a punto— y una central no tiene nada de eso. Lo de la
 * central es otra cosa: qué cuenta y qué clave le toca, a dónde tiene que reportar, si ya habló,
 * qué es cada zona y qué cámaras la miran.
 */
type Modelo = { modelo: string; nombre: string; probado: boolean; ayuda: string; vincula: boolean; controla: boolean };
type Zona = { id?: string; zona: number; particion: number | null; nombre: string | null; areaId: string | null; camaras: string[]; tipo?: string | null };
type Mensaje = { id: string; recibido: string; ip: string | null; transporte: string | null; idMensaje: string | null; cifrado: boolean; seq: number | null; datos: string | null; respuesta: string | null; error: string | null; eventos: any[] | null };
type Ficha = {
    central: { id: string; deviceId: string; modelo: string; cuenta: string; protocolo: string; cifrado: boolean; lanVpn: boolean; prueba: boolean; supervisionSeg: number; estado: string; ultimoMensajeAt: string | null; ipOrigen: string | null; transporte: string | null; device: { id: string; name: string; ip: string; httpPort: number | null; username: string | null; deviceModel?: string | null }; zonas: Zona[];
        /** Las cámaras del abonado: ids de equipo o `nvrch-<nvr>-<ch>` (openspec alarmas-como-funciones). */
        camaras?: string[] };
    mensajes: Mensaje[]; alertas: { type: string; severity: string; message: string }[]; destino: { direccion: string; puerto: number; transporte: string } | null; modelo: Modelo;
};

const MODELOS_ALTA = [
    { modelo: "ax-pro", nombre: "Hikvision AX PRO", que: "Inalámbrica. OmniAccess le escribe el receptor, lee sus zonas y la arma o desarma.", icono: Radio },
    { modelo: "ax-hybrid", nombre: "Hikvision AX Hybrid PRO", que: "Cableada e inalámbrica. Lo mismo que la AX PRO.", icono: Server },
    { modelo: "generica", nombre: "Otra central (DC-09)", que: "Cualquier central que reporte por SIA DC-09 (DSC, Ajax, Paradox…). Los datos se cargan en la central a mano.", icono: Siren },
    { modelo: "por-receptor", nombre: "Por un receptor (IPC10 de Paradox, Sur-Gard)", que: "La central reporta a su receptor y el receptor le pasa los eventos a OmniAccess en Contact ID. Se carga la cuenta que la central tiene en el receptor.", icono: Network },
];
const ESTADO: Record<string, { rotulo: string; tono: "bien" | "info" | "mal" }> = {
    EN_LINEA: { rotulo: "En línea", tono: "bien" }, ESPERANDO: { rotulo: "Esperando a la central", tono: "info" }, SIN_SUPERVISION: { rotulo: "Sin supervisión", tono: "mal" },
};
const RESP_TONO: Record<string, "bien" | "mal" | "aviso"> = { ACK: "bien", NAK: "mal", DUH: "aviso" };
const ERROR_TXT: Record<string, string> = {
    "cuenta-desconocida": "Cuenta que no está dada de alta", "sin-cifrar": "Llegó sin cifrar (por internet se exige cifrado)", "hora-fuera-de-ventana": "La hora de la central está corrida",
    "descifrado": "No se pudo descifrar: la clave no coincide", "sin-clave": "Cifrado de una cuenta sin clave", crc: "Trama dañada (CRC)", largo: "Trama dañada (largo)", forma: "Trama ilegible", id: "Protocolo que no se maneja", hora: "Hora ilegible",
};

function hace(iso: string | null) {
    if (!iso) return "nunca";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `hace ${Math.max(0, s)} s`;
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return new Date(iso).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
const horaCorta = (iso: string) => new Date(iso).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const copiar = (t: string, que: string) => navigator.clipboard?.writeText(t).then(() => toast.success({ title: `${que} copiada` })).catch(() => toast.error({ title: "No se pudo copiar" }));

async function pedir(url: string, init?: RequestInit) {
    const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `El servidor respondió ${r.status}`);
    return j;
}

export function CajonCentral({ abierto, alCerrar, centralId, alCambiar }: { abierto: boolean; alCerrar: () => void; centralId: string | null; alCambiar?: () => void }) {
    const [id, setId] = useState<string | null>(centralId);
    useEffect(() => { if (abierto) setId(centralId); }, [abierto, centralId]);
    return (
        <Cajon open={abierto} onOpenChange={(v) => !v && alCerrar()}>
            <CajonContenido ancho="medio" titulo={id ? "Central de alarma" : "Agregar una central de alarma"} descripcion={id ? undefined : "Alarm Hub: la central le manda sus eventos a OmniAccess por SIA DC-09, cifrados."}>
                {abierto && (id ? <FichaCentral id={id} alCambiar={alCambiar} alBorrada={() => { alCambiar?.(); alCerrar(); }} /> : <AltaCentral alCreada={(nuevo) => { setId(nuevo); alCambiar?.(); }} />)}
            </CajonContenido>
        </Cajon>
    );
}

/* ── Alta ───────────────────────────────────────────────────────────────────────────────── */

function AltaCentral({ alCreada }: { alCreada: (id: string) => void }) {
    const { areas } = useAreas();
    const [modelo, setModelo] = useState<string | null>(null);
    const [f, setF] = useState({ nombre: "", ip: "", httpPort: "", usuario: "", clave: "", areaId: TODAS_LAS_AREAS, protocolo: "SIA-DCS", lanVpn: false, prueba: false, supervisionMin: "10", cuenta: "" });
    const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));
    const [guardando, setGuardando] = useState(false);
    const esAx = modelo === "ax-pro" || modelo === "ax-hybrid";
    const porReceptor = modelo === "por-receptor";
    const listo = !!modelo && f.nombre.trim() && (!esAx || f.ip.trim()) && (!porReceptor || /^[0-9A-Fa-f]{3,16}$/.test(f.cuenta.trim()));
    const elegirModelo = (m: string) => {
        setModelo(m);
        // Por un receptor la única señal de vida es la prueba periódica del panel, una por día (Paradox
        // la manda a las 23:00): 25 h deja un margen para que no alerte cada noche.
        setF((p) => ({ ...p, supervisionMin: m === "por-receptor" ? "1500" : p.supervisionMin === "1500" ? "10" : p.supervisionMin }));
    };

    const crear = async () => {
        if (!listo) return;
        setGuardando(true);
        try {
            const j = await pedir("/api/centrales", { method: "POST", body: JSON.stringify({
                nombre: f.nombre, modelo: porReceptor ? "generica" : modelo, porReceptor, cuenta: porReceptor ? f.cuenta.trim() : null, ip: esAx ? f.ip : "", httpPort: esAx && f.httpPort ? Number(f.httpPort) : null, usuario: esAx ? f.usuario : null, clave: esAx ? f.clave : null,
                areaId: f.areaId !== TODAS_LAS_AREAS ? f.areaId : null, protocolo: f.protocolo, lanVpn: f.lanVpn, prueba: f.prueba, supervisionSeg: Math.round(Number(f.supervisionMin || 10) * 60),
            }) });
            toast.success({ title: `«${f.nombre}» dada de alta`, description: `Cuenta ${j.cuenta}. Falta que la central reporte.` });
            alCreada(j.id);
        } catch (e: any) { toast.error({ title: "No se pudo dar de alta", description: e?.message }); }
        finally { setGuardando(false); }
    };

    return (
        <div className="space-y-5">
            <CajonSeccion titulo="¿Qué central es?" icono={Siren}>
                <div className="grid gap-2">
                    {MODELOS_ALTA.map((m) => (
                        <button key={m.modelo} type="button" onClick={() => elegirModelo(m.modelo)} aria-pressed={modelo === m.modelo}
                            className={cn("text-left rounded-[10px] border p-3 flex gap-3 transition-colors", modelo === m.modelo ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border hover:bg-accent/50")}>
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-muted/60 tono-mal"><m.icono size={18} /></span>
                            <span className="min-w-0">
                                <span className="flex items-center gap-2 text-[13.5px] font-semibold">{m.nombre}{m.modelo !== "generica" && <Chip tono="aviso">Sin probar con equipo</Chip>}</span>
                                <span className="block text-[12px] text-muted-foreground leading-snug mt-0.5">{m.que}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </CajonSeccion>

            {modelo && (
                <>
                    <CajonSeccion titulo="Identidad" icono={Info}>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <CajonCampo etiqueta="Nombre"><Input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Central Club House" autoFocus /></CajonCampo>
                            <CajonCampo etiqueta="Área" pista="El área de Dispositivos: sus alarmas se filtran con ella en los monitores.">
                                <ElegirArea areas={areas} valor={f.areaId} alElegir={(v) => set("areaId", v)} vacio="Sin área" alinear="start" className="w-full h-9" />
                            </CajonCampo>
                        </div>
                    </CajonSeccion>
                    {esAx && (
                        <CajonSeccion titulo="Conexión a la central" icono={Wifi} ayuda="Para escribirle el receptor, leer las zonas y armar o desarmar. Cuenta de rol Administrador: la de Instalador no puede usar ISAPI.">
                            <div className="grid sm:grid-cols-2 gap-3">
                                <CajonCampo etiqueta="IP de la central"><Input value={f.ip} onChange={(e) => set("ip", e.target.value)} placeholder="192.168.1.50" className="tabular-nums" /></CajonCampo>
                                <CajonCampo etiqueta="Puerto web" ayuda="Vacío = 80"><Input value={f.httpPort} onChange={(e) => set("httpPort", e.target.value.replace(/\D/g, ""))} placeholder="80" className="tabular-nums" /></CajonCampo>
                                <CajonCampo etiqueta="Usuario"><Input value={f.usuario} onChange={(e) => set("usuario", e.target.value)} placeholder="admin" autoComplete="off" /></CajonCampo>
                                <CajonCampo etiqueta="Clave"><Input type="password" value={f.clave} onChange={(e) => set("clave", e.target.value)} autoComplete="new-password" /></CajonCampo>
                            </div>
                        </CajonSeccion>
                    )}
                    {porReceptor && (
                        <CajonSeccion titulo="Cómo llega" icono={Network} ayuda={<>La central ya reporta a su receptor. En el receptor (IPC10: Configuration › CMS Configuration) se pone como CMS la IP de este servidor en la red local, puerto <b>{PUERTO_CMS}</b>, protocolo <b>MLR2-DG</b>. OmniAccess confirma cada evento y lo traduce.</>}>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <CajonCampo etiqueta="Cuenta en el receptor" ayuda="La columna Account# de los eventos del receptor (p. ej. 2989).">
                                    <Input value={f.cuenta} onChange={(e) => set("cuenta", e.target.value.replace(/[^0-9a-fA-F]/g, "").toUpperCase())} placeholder="2989" className="tabular-nums" />
                                </CajonCampo>
                                <CajonCampo etiqueta="Supervisión (minutos)" ayuda="La prueba periódica del panel es una por día: 1500 min = 25 h.">
                                    <Input value={f.supervisionMin} onChange={(e) => set("supervisionMin", e.target.value.replace(/[^\d.]/g, ""))} className="tabular-nums" />
                                </CajonCampo>
                            </div>
                        </CajonSeccion>
                    )}
                    {!porReceptor && <CajonSeccion titulo="Cómo reporta" icono={Globe} pista="OmniAccess le asigna una cuenta y una clave AES. Por internet la central tiene que mandar cifrado; sin cifrar sólo si está en la misma red o en una VPN.">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <CajonCampo etiqueta="Protocolo">
                                <span className="flex w-full items-center rounded-full border border-border p-0.5">
                                    {["SIA-DCS", "ADM-CID"].map((p) => (
                                        <button key={p} type="button" onClick={() => set("protocolo", p)} aria-pressed={f.protocolo === p}
                                            className={cn("flex-1 h-7 rounded-full text-[12px] font-semibold", f.protocolo === p ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{p === "ADM-CID" ? "Contact ID" : "SIA"}</button>
                                    ))}
                                </span>
                            </CajonCampo>
                            <CajonCampo etiqueta="Supervisión (minutos)" ayuda="Cada cuánto manda algo; con dos períodos callada, alerta.">
                                <Input value={f.supervisionMin} onChange={(e) => set("supervisionMin", e.target.value.replace(/[^\d.]/g, ""))} className="tabular-nums" />
                            </CajonCampo>
                        </div>
                        <div className="mt-3 space-y-2">
                            <Opcion activa={f.lanVpn} alCambiar={(v) => set("lanVpn", v)} icono={ShieldOff} titulo="Está en la LAN o en una VPN" texto="Permite que mande sin cifrar. Por internet, no." />
                            <Opcion activa={f.prueba} alCambiar={(v) => set("prueba", v)} icono={FlaskConical} titulo="Central de prueba" texto="Sus alarmas no disparan avisos ni la salud manda Telegram. Para el simulador." />
                        </div>
                    </CajonSeccion>}
                    <div className="flex justify-end">
                        <Button onClick={crear} disabled={!listo || guardando} className="gap-1.5">{guardando ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Dar de alta</Button>
                    </div>
                </>
            )}
        </div>
    );
}

function Opcion({ activa, alCambiar, icono: I, titulo, texto }: { activa: boolean; alCambiar: (v: boolean) => void; icono: any; titulo: string; texto: string }) {
    return (
        <label className="flex items-start gap-3 rounded-[10px] border border-border p-3 cursor-pointer hover:bg-accent/40">
            <I size={16} className="mt-0.5 text-muted-foreground shrink-0" />
            <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{titulo}</span><span className="block text-[12px] text-muted-foreground">{texto}</span></span>
            <Switch checked={activa} onCheckedChange={alCambiar} />
        </label>
    );
}

/* ── Ficha ──────────────────────────────────────────────────────────────────────────────── */

function FichaCentral({ id, alCambiar, alBorrada }: { id: string; alCambiar?: () => void; alBorrada?: () => void }) {
    const [d, setD] = useState<Ficha | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cargar = useCallback(() => pedir(`/api/centrales/${id}`).then((j) => { setD(j); setError(null); }).catch((e) => setError(e?.message || "No se pudo leer la central")), [id]);
    useEffect(() => { cargar(); const iv = setInterval(cargar, 10_000); return () => clearInterval(iv); }, [cargar]);

    if (error && !d) return <ErrorEstado mensaje={error} alReintentar={cargar} />;
    if (!d) return <Cargando texto="Leyendo la central…" />;
    const c = d.central;
    const est = ESTADO[c.estado] || ESTADO.ESPERANDO;
    return (
        <div className="space-y-5">
            <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-muted/60 tono-mal"><Siren size={20} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[16px] font-bold tracking-tight truncate">{c.device.name}</span>
                        <Chip tono={est.tono} pleno={c.estado === "SIN_SUPERVISION"}>{est.rotulo}</Chip>
                        {c.prueba && <Chip tono="quieto" icono={FlaskConical}>De prueba</Chip>}
                        {!d.modelo.probado && <Chip tono="aviso">Driver sin probar con equipo</Chip>}
                    </div>
                    <div className="text-[12px] text-muted-foreground mt-0.5 tabular-nums">
                        {d.modelo.nombre} · cuenta {c.cuenta} · último mensaje {hace(c.ultimoMensajeAt)}{c.ipOrigen ? ` desde ${c.ipOrigen} (${(c.transporte || "").toUpperCase()})` : ""}
                    </div>
                </div>
            </div>
            {d.alertas.length > 0 && (
                <div className="space-y-1.5">{d.alertas.map((a) => <div key={a.type} className={cn("rounded-[10px] px-3 py-2 text-[12.5px]", a.severity === "critical" ? "chip-mal" : "chip-aviso")}>{a.message}</div>)}</div>
            )}
            <Receptor d={d} recargar={cargar} />
            <CamarasAbonado d={d} recargar={cargar} />
            <Zonas d={d} recargar={cargar} />
            {d.modelo.controla && <Control d={d} />}
            <Mensajes mensajes={d.mensajes} zonas={d.central.zonas} />
            <Ajustes d={d} recargar={() => { cargar(); alCambiar?.(); }} alBorrada={alBorrada} />
        </div>
    );
}

function Fila({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
    return <div className="flex items-center gap-3 py-1.5 border-b border-border/60 last:border-0"><span className="w-[130px] shrink-0 text-[12px] text-muted-foreground">{rotulo}</span><span className="min-w-0 flex-1 text-[13px]">{children}</span></div>;
}

function Receptor({ d, recargar }: { d: Ficha; recargar: () => void }) {
    const c = d.central;
    const porReceptor = c.device.deviceModel === POR_RECEPTOR;
    const [clave, setClave] = useState<string | null>(null);
    const [viendo, setViendo] = useState(false);
    const [dest, setDest] = useState({ direccion: "", puerto: "10010", transporte: "udp" });
    const [guardandoDest, setGuardandoDest] = useState(false);
    const [vinculo, setVinculo] = useState<{ corriendo: boolean; probado?: any; error?: string | null }>({ corriendo: false });
    // «Probar recepción» (tarea 5.2): se anota el momento y se espera el próximo mensaje de la central.
    const [prueba, setPrueba] = useState<number | null>(null);
    const llegado = prueba ? d.mensajes.find((m) => new Date(m.recibido).getTime() >= prueba) || null : null;
    useEffect(() => {
        if (!prueba || llegado) return;
        const iv = setInterval(recargar, 3000);
        const fin = setTimeout(() => setPrueba(null), 3 * 60_000);
        return () => { clearInterval(iv); clearTimeout(fin); };
    }, [prueba, llegado, recargar]);

    const verClave = async () => {
        if (clave) { setClave(null); return; }
        setViendo(true);
        try { const j = await pedir(`/api/centrales/${c.id}?clave=1`); setClave(j.clave || "(sin clave: sin cifrar)"); }
        catch (e: any) { toast.error({ title: "No se pudo ver la clave", description: e?.message }); }
        finally { setViendo(false); }
    };
    const guardarDestino = async () => {
        setGuardandoDest(true);
        try { await pedir("/api/centrales", { method: "PUT", body: JSON.stringify({ destino: { direccion: dest.direccion, puerto: Number(dest.puerto), transporte: dest.transporte } }) }); toast.success({ title: "Dirección del receptor guardada" }); recargar(); }
        catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardandoDest(false); }
    };
    const vincular = async (probar: boolean) => {
        setVinculo({ corriendo: true });
        try {
            const j = await pedir(`/api/centrales/${c.id}/accion`, { method: "POST", body: JSON.stringify({ accion: probar ? "probar-vincular" : "vincular" }) });
            setVinculo({ corriendo: false, probado: probar ? j.actual : null, error: null });
            if (!probar) toast.success({ title: "Receptor escrito en la central", description: j.detalle });
        } catch (e: any) { setVinculo({ corriendo: false, error: e?.message }); }
    };

    return (
        <CajonSeccion titulo="Receptor" icono={Globe} pista="Lo que la central tiene que tener cargado para reportar a OmniAccess. En una AX lo escribe OmniAccess; en otra central se carga a mano, en «centro receptor» / ARC.">
            {porReceptor ? (
                <div className="rounded-[10px] chip-info px-3 py-2.5 text-[12.5px] mb-2">
                    Llega por la <b>salida a CMS</b> de su receptor, no directo. En el receptor (IPC10: Configuration › CMS Configuration): IP de este servidor en la red local, puerto <b className="tabular-nums">{PUERTO_CMS}</b>, protocolo <b>MLR2-DG</b>. Sólo se aceptan receptores de la red local.
                </div>
            ) : d.destino ? (
                <Fila rotulo="Dirección y puerto"><span className="font-semibold tabular-nums">{d.destino.direccion}:{d.destino.puerto}</span> <span className="text-muted-foreground">· {d.destino.transporte.toUpperCase()}</span></Fila>
            ) : (
                <div className="rounded-[10px] chip-aviso p-3 mb-2 space-y-2">
                    <div className="text-[12.5px]">Falta la dirección pública del receptor: el dominio o la IP por la que la central llega a OmniAccess desde internet (con el puerto abierto en el firewall hacia este servidor).</div>
                    <div className="flex gap-2 flex-wrap">
                        <Input value={dest.direccion} onChange={(e) => setDest((p) => ({ ...p, direccion: e.target.value }))} placeholder="alarmas.ies.com.uy" className="h-8 flex-1 min-w-[180px]" />
                        <Input value={dest.puerto} onChange={(e) => setDest((p) => ({ ...p, puerto: e.target.value.replace(/\D/g, "") }))} className="h-8 w-20 tabular-nums" />
                        <Button size="sm" onClick={guardarDestino} disabled={!dest.direccion.trim() || guardandoDest}>{guardandoDest ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar</Button>
                    </div>
                </div>
            )}
            <Fila rotulo="Cuenta"><span className="font-semibold tabular-nums">{c.cuenta}</span> <button type="button" onClick={() => copiar(c.cuenta, "Cuenta")} className="ml-1 text-muted-foreground hover:text-foreground align-middle" aria-label="Copiar la cuenta"><Copy size={13} /></button></Fila>
            <Fila rotulo="Protocolo">{porReceptor ? "Contact ID" : c.cifrado ? `*${c.protocolo}` : c.protocolo} <span className="text-muted-foreground">· {porReceptor ? "por el receptor, sin cifrar (red local)" : c.cifrado ? "cifrado AES" : "sin cifrar (LAN/VPN)"}</span></Fila>
            {c.cifrado && (
                <Fila rotulo="Clave AES">
                    <span className="inline-flex items-center gap-2">
                        <span className="tabular-nums font-semibold">{clave || "••••••••••••••••"}</span>
                        <button type="button" onClick={verClave} className="text-muted-foreground hover:text-foreground" aria-label={clave ? "Ocultar la clave" : "Ver la clave"}>{viendo ? <Loader2 size={13} className="animate-spin" /> : clave ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                        {clave && <button type="button" onClick={() => copiar(clave, "Clave")} className="text-muted-foreground hover:text-foreground" aria-label="Copiar la clave"><Copy size={13} /></button>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">Verla queda en Auditoría. 32 dígitos hex (AES-128); si la central pide texto, la misma clave vale como AES-256.</span>
                </Fila>
            )}
            <Fila rotulo="Supervisión">cada {Math.round(c.supervisionSeg / 60)} min (prueba periódica o NULL)</Fila>
            {d.modelo.vincula && (
                <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => vincular(true)} disabled={vinculo.corriendo || !d.destino}>{vinculo.corriendo ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Ver qué se escribe</Button>
                        <Button size="sm" onClick={() => vincular(false)} disabled={vinculo.corriendo || !d.destino}><KeyRound size={14} /> Escribir en la central</Button>
                    </div>
                    {vinculo.error && <div className="rounded-[10px] chip-mal px-3 py-2 text-[12px]">{vinculo.error}</div>}
                    {vinculo.probado && <pre className="rounded-[10px] bg-muted/60 p-3 text-[11px] overflow-x-auto max-h-48">{JSON.stringify(vinculo.probado, null, 2)}</pre>}
                </div>
            )}
            <div className="mt-3 rounded-[10px] border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold flex-1">Probar recepción</span>
                    <Button size="sm" variant="outline" onClick={() => setPrueba(prueba && !llegado ? null : Date.now())}>{prueba && !llegado ? <><X size={14} /> Dejar de esperar</> : <><Radio size={14} /> Probar</>}</Button>
                </div>
                {!prueba && (
                    <p className="text-[12px] text-muted-foreground">
                        {porReceptor ? <>Desde la central, una prueba manual de comunicación (o esperá su prueba periódica); el receptor la pasa. «Test network» del IPC10 sólo prueba la conexión: no manda un evento. </> : <>Desde la central, mandá una prueba de comunicación al centro receptor ({c.modelo === "generica" ? "«prueba manual» o «test report» en el menú de comunicaciones" : "en Hik-Partner Pro: la central › Centro receptor › Prueba"}). </>}La ficha avisa cuando llega.
                        {c.prueba ? <> En el servidor: <code className="text-[11px]">SIM_CLAVE=… node scripts/simular-central.js --cuenta {c.cuenta} --udp</code></> : null}
                    </p>
                )}
                {prueba && !llegado && <p className="text-[12px] text-muted-foreground inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Esperando el próximo mensaje de la central (hasta 3 minutos)…</p>}
                {llegado && (llegado.respuesta === "ACK"
                    ? <div className="rounded-[10px] chip-bien px-3 py-2 text-[12.5px]">Llegó y se confirmó: {llegado.idMensaje}{llegado.cifrado ? " cifrado" : ""} por {(llegado.transporte || "").toUpperCase()} desde {llegado.ip}. La central está bien configurada.</div>
                    : <div className="rounded-[10px] chip-mal px-3 py-2 text-[12.5px]">Llegó pero se rechazó ({llegado.respuesta}): {ERROR_TXT[llegado.error || ""] || llegado.error || "sin motivo"}. Revisá {llegado.error === "descifrado" ? "la clave" : llegado.error === "hora-fuera-de-ventana" ? "la hora de la central (NTP)" : llegado.error === "sin-cifrar" ? "que la central mande cifrado (*SIA-DCS)" : "la cuenta y el protocolo"} en la central.</div>)}
            </div>
        </CajonSeccion>
    );
}

/**
 * Las cámaras que se pueden elegir para una zona o para el abonado: los equipos cámara y, además, los
 * canales de los NVR que no son equipo (`nvrch-<nvr>-<ch>`, como el Monitor CCTV), cada uno con el área
 * de su equipo o de su NVR (openspec alarmas-como-funciones). Los canales salen de /api/monitor/camaras,
 * que les pregunta a los NVR: si no contesta, quedan los equipos.
 */
function useCamarasElegibles(equipoArea: Record<string, string>) {
    const [equipos, setEquipos] = useState<{ id: string; nombre: string; tipo: string; areaId: string | null }[]>([]);
    const [canales, setCanales] = useState<{ id: string; nombre: string; tipo: string; areaId: string | null }[]>([]);
    useEffect(() => {
        getDevices().then((ds: any[]) => setEquipos((ds || []).filter((x) => ["CAMERA", "LPR_CAMERA", "LPR_INTERIOR", "QUEUE_COUNTER"].includes(String(x.deviceType))).map((x) => ({ id: x.id, nombre: x.name, tipo: String(x.deviceType), areaId: equipoArea[x.id] || null })))).catch(() => { });
    }, [equipoArea]);
    useEffect(() => {
        fetch("/api/monitor/camaras", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
            const cs = (j?.canales || []).filter((c: any) => !c.equipoId && c.nvrId && c.ch != null);
            setCanales(cs.map((c: any) => ({ id: `nvrch-${c.nvrId}-${c.ch}`, nombre: `${c.nombre} · ${c.nvr} CH ${c.ch}`, tipo: "CANAL", areaId: c.areaId || equipoArea[c.nvrId] || null })));
        }).catch(() => { });
    }, [equipoArea]);
    const camaras = useMemo(() => [...equipos, ...canales], [equipos, canales]);
    const nombreCam = useMemo(() => new Map(camaras.map((x) => [x.id, x.nombre])), [camaras]);
    return { camaras, nombreCam };
}

/** Las cámaras del abonado: las de toda la central, para las zonas sin cámaras y para «otras cámaras» en el evento. */
function CamarasAbonado({ d, recargar }: { d: Ficha; recargar: () => void }) {
    const { areas, equipoArea } = useAreas();
    const { camaras, nombreCam } = useCamarasElegibles(equipoArea);
    const [lista, setLista] = useState<string[]>(d.central.camaras || []);
    const [sucia, setSucia] = useState(false);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (!sucia) setLista(d.central.camaras || []); }, [d.central.camaras, sucia]);
    const areaCentral = equipoArea[d.central.deviceId] || null;
    const guardar = async () => {
        setGuardando(true);
        try { await pedir(`/api/centrales/${d.central.id}`, { method: "PATCH", body: JSON.stringify({ camaras: lista }) }); setSucia(false); toast.success({ title: "Cámaras del abonado guardadas" }); recargar(); }
        catch (e: any) { toast.error({ title: "No se pudieron guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    return (
        <CajonSeccion titulo={`Cámaras del abonado (${lista.length})`} icono={Camera}
            ayuda="Las cámaras de este cliente. Una zona sin cámaras ni área usa éstas, y al abrir un evento quedan a mano como «otras cámaras» para seguir lo que pasa."
            pista="Pueden ser equipos o canales de un NVR que no están dados de alta como equipo. Se sugieren primero las del área de la central.">
            <div className="flex items-center gap-1.5 flex-wrap">
                {lista.length === 0 && <span className="text-[12.5px] text-muted-foreground mr-1">Ninguna todavía.</span>}
                {lista.map((cid) => (
                    <span key={cid} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-muted/70 text-[11.5px] font-semibold">
                        <Camera size={11} className="text-muted-foreground" />{nombreCam.get(cid) || (cid.startsWith("nvrch-") ? "Canal de NVR" : "Cámara")}
                        <button type="button" onClick={() => { setLista((l) => l.filter((x) => x !== cid)); setSucia(true); }} className="grid place-items-center h-4 w-4 rounded-full hover:bg-background" aria-label="Quitar"><X size={10} /></button>
                    </span>
                ))}
                <ElegirCamara camaras={camaras.filter((x) => !lista.includes(x.id))} areas={areas} alElegir={(cid) => { if (cid) { setLista((l) => [...l, cid]); setSucia(true); } }}
                    placeholder="Agregar cámara" alinear="start" className="h-7 text-[11.5px]" sugerida={areaCentral ? { areaId: areaCentral, rotulo: "área de la central" } : null} />
                <span className="flex-1" />
                {sucia && <Button size="sm" onClick={guardar} disabled={guardando}>{guardando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar</Button>}
            </div>
        </CajonSeccion>
    );
}

function Zonas({ d, recargar }: { d: Ficha; recargar: () => void }) {
    const { areas, equipoArea } = useAreas();
    const [zonas, setZonas] = useState<Zona[]>(d.central.zonas);
    const [sucias, setSucias] = useState(false);
    const [borrar, setBorrar] = useState<number[]>([]);
    const [nueva, setNueva] = useState("");
    const { camaras, nombreCam } = useCamarasElegibles(equipoArea);
    const [guardando, setGuardando] = useState(false);
    const [leyendo, setLeyendo] = useState(false);
    useEffect(() => { if (!sucias) setZonas(d.central.zonas); }, [d.central.zonas, sucias]);
    /**
     * De dónde salen las cámaras de cada zona, con lo que se está editando (la misma regla que usa el
     * receptor, lib-centrales-camaras.js): las elegidas; si no hay, las del área de la zona (y sus
     * sub-áreas, sólo equipos); si tampoco, las del abonado.
     */
    const origenDe = (z: Zona): { texto: string; tono: "bien" | "info" | "aviso" } => {
        if (z.camaras.length) return { texto: `${z.camaras.length} ${z.camaras.length === 1 ? "elegida" : "elegidas"}`, tono: "bien" };
        if (z.areaId) {
            const bajo = new Set([z.areaId]);
            for (let cambio = true; cambio;) { cambio = false; for (const a of areas) if (a.padre && bajo.has(a.padre) && !bajo.has(a.id)) { bajo.add(a.id); cambio = true; } }
            const n = camaras.filter((c) => !c.id.startsWith("nvrch-") && c.areaId && bajo.has(c.areaId)).length;
            const nombre = areas.find((a) => a.id === z.areaId)?.nombre || "su área";
            if (n) return { texto: `${Math.min(4, n)} del área ${nombre}${n > 4 ? ` (de ${n})` : ""}`, tono: "info" };
        }
        const ab = (d.central.camaras || []).length;
        if (ab) return { texto: `${Math.min(4, ab)} del abonado`, tono: "info" };
        return { texto: "ninguna: sin video para verificar", tono: "aviso" };
    };
    /** El área de la central en Dispositivos: sus cámaras se sugieren primero al elegir las de una zona. */
    const areaCentral = equipoArea[d.central.deviceId] || null;
    const cambiar = (zona: number, p: Partial<Zona>) => { setZonas((zs) => zs.map((z) => (z.zona === zona ? { ...z, ...p } : z))); setSucias(true); };

    const guardar = async () => {
        setGuardando(true);
        try { await pedir(`/api/centrales/${d.central.id}`, { method: "PATCH", body: JSON.stringify({ zonas, borrarZonas: borrar }) }); setSucias(false); setBorrar([]); toast.success({ title: "Zonas guardadas" }); recargar(); }
        catch (e: any) { toast.error({ title: "No se pudieron guardar las zonas", description: e?.message }); }
        finally { setGuardando(false); }
    };
    const leer = async () => {
        setLeyendo(true);
        try { const j = await pedir(`/api/centrales/${d.central.id}/accion`, { method: "POST", body: JSON.stringify({ accion: "leer-zonas" }) }); toast.success({ title: `${j.zonas.length} zonas leídas de la central` }); setSucias(false); recargar(); }
        catch (e: any) { toast.error({ title: "No se pudieron leer las zonas", description: e?.message }); }
        finally { setLeyendo(false); }
    };
    const agregar = () => {
        const n = Number(nueva);
        if (!Number.isInteger(n) || n < 0 || zonas.some((z) => z.zona === n)) return;
        setZonas((zs) => [...zs, { zona: n, particion: null, nombre: null, areaId: null, camaras: [] }].sort((a, b) => a.zona - b.zona)); setNueva(""); setSucias(true);
    };

    return (
        <CajonSeccion titulo={`Zonas (${zonas.length})`} icono={Home} pista="Qué es cada zona y qué cámaras la miran. La alarma de una zona trae un cuadro de cada cámara y se enciende sobre ellas en el Monitor de Intrusión. Una zona que reporta y no estaba cargada aparece sola.">
            {zonas.length === 0 && <p className="text-[12.5px] text-muted-foreground mb-3">Todavía no hay zonas. Aparecen con el primer evento de cada una{d.modelo.vincula ? ", o se leen de la central" : ""}.</p>}
            <div className="space-y-2">
                {zonas.map((z) => (
                    <div key={z.zona} className="rounded-[10px] border border-border p-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="w-14 shrink-0 text-[12px] font-semibold tabular-nums">Zona {z.zona}</span>
                            <Input value={z.nombre || ""} onChange={(e) => cambiar(z.zona, { nombre: e.target.value })} placeholder="Puerta cocina" className="h-8 flex-1" />
                            <ElegirArea areas={areas} valor={z.areaId || TODAS_LAS_AREAS} alElegir={(v) => cambiar(z.zona, { areaId: v === TODAS_LAS_AREAS ? null : v })} vacio="Sin área" compacto />
                            <button type="button" onClick={() => { setZonas((zs) => zs.filter((x) => x.zona !== z.zona)); setBorrar((b) => [...b, z.zona]); setSucias(true); }} className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent" aria-label={`Quitar la zona ${z.zona}`}><Trash2 size={14} /></button>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap pl-16">
                            {(() => { const o = origenDe(z); return <span className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-semibold", `chip-${o.tono}`)} title="Con qué cámaras se verifica un evento de esta zona"><Camera size={11} /> {o.texto}</span>; })()}
                            {z.camaras.map((cid) => (
                                <span key={cid} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-muted/70 text-[11.5px] font-semibold">
                                    <Camera size={11} className="text-muted-foreground" />{nombreCam.get(cid) || "Cámara"}
                                    <button type="button" onClick={() => cambiar(z.zona, { camaras: z.camaras.filter((x) => x !== cid) })} className="grid place-items-center h-4 w-4 rounded-full hover:bg-background" aria-label="Quitar"><X size={10} /></button>
                                </span>
                            ))}
                            {z.camaras.length < 4 && (
                                <ElegirCamara camaras={camaras.filter((x) => !z.camaras.includes(x.id))} areas={areas} alElegir={(cid) => cid && cambiar(z.zona, { camaras: [...z.camaras, cid] })}
                                    placeholder="Cámara que la mira" alinear="start" className="h-7 text-[11.5px]"
                                    // Primero las cámaras del área de la zona; si la zona no tiene, las del área de la central (22/10).
                                    sugerida={z.areaId ? { areaId: z.areaId, rotulo: "área de la zona" } : areaCentral ? { areaId: areaCentral, rotulo: "área de la central" } : null} />
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
                <Input value={nueva} onChange={(e) => setNueva(e.target.value.replace(/\D/g, ""))} placeholder="N° de zona" className="h-8 w-28 tabular-nums" onKeyDown={(e) => e.key === "Enter" && agregar()} />
                <Button size="sm" variant="outline" onClick={agregar} disabled={!nueva}><Plus size={14} /> Agregar zona</Button>
                {d.modelo.vincula && <Button size="sm" variant="outline" onClick={leer} disabled={leyendo}>{leyendo ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Leer de la central</Button>}
                <span className="flex-1" />
                {sucias && <Button size="sm" onClick={guardar} disabled={guardando}>{guardando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar zonas</Button>}
            </div>
        </CajonSeccion>
    );
}

function Control({ d }: { d: Ficha }) {
    const [estado, setEstado] = useState<{ particiones: { id: number; nombre: string | null; estado: string }[] } | null>(null);
    const [leyendo, setLeyendo] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [orden, setOrden] = useState<{ accion: "armar" | "desarmar"; particion: number; modo?: "ausente" | "presente" } | null>(null);
    const leer = useCallback(async () => {
        setLeyendo(true); setError(null);
        try { const j = await pedir(`/api/centrales/${d.central.id}/accion`, { method: "POST", body: JSON.stringify({ accion: "estado" }) }); setEstado(j.estado); }
        catch (e: any) { setError(e?.message); }
        finally { setLeyendo(false); }
    }, [d.central.id]);
    const ROT: Record<string, { r: string; t: "bien" | "mal" | "aviso" | "quieto" | "info" }> = { ausente: { r: "Armada (ausente)", t: "info" }, presente: { r: "Armada (presente)", t: "info" }, desarmada: { r: "Desarmada", t: "quieto" }, alarma: { r: "En alarma", t: "mal" }, desconocido: { r: "Sin dato", t: "quieto" } };
    return (
        <CajonSeccion titulo="Estado y control" icono={ShieldCheck} pista="Leído de la central por ISAPI. Armar y desarmar pide el permiso «Control de centrales» y queda en Auditoría.">
            {!estado && !error && <Button size="sm" variant="outline" onClick={leer} disabled={leyendo}>{leyendo ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Leer el estado</Button>}
            {error && <ErrorEstado mensaje={error} alReintentar={leer} titulo="La central no informó su estado" />}
            {estado && (
                <div className="space-y-2">
                    {estado.particiones.length === 0 && <p className="text-[12.5px] text-muted-foreground">La central no devolvió particiones.</p>}
                    {estado.particiones.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 rounded-[10px] border border-border px-3 py-2">
                            <span className="text-[13px] font-semibold flex-1 min-w-0 truncate">Partición {p.id}{p.nombre ? ` · ${p.nombre}` : ""}</span>
                            <Chip tono={ROT[p.estado]?.t || "quieto"}>{ROT[p.estado]?.r || p.estado}</Chip>
                            <Button size="sm" variant="outline" onClick={() => setOrden({ accion: "armar", particion: p.id, modo: "ausente" })}><Lock size={13} /> Ausente</Button>
                            <Button size="sm" variant="outline" onClick={() => setOrden({ accion: "armar", particion: p.id, modo: "presente" })}><Home size={13} /> Presente</Button>
                            <Button size="sm" variant="outline" onClick={() => setOrden({ accion: "desarmar", particion: p.id })}><Unlock size={13} /> Desarmar</Button>
                        </div>
                    ))}
                    <Button size="sm" variant="ghost" onClick={leer} disabled={leyendo}>{leyendo ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Volver a leer</Button>
                </div>
            )}
            {orden && (
                <ConfirmarEnCajon id={String(orden.particion)} open onOpenChange={(v) => !v && setOrden(null)}
                    title={`${orden.accion === "armar" ? `Armar (${orden.modo})` : "Desarmar"} la partición ${orden.particion} de ${d.central.device.name}`}
                    description={orden.accion === "desarmar" ? "La central deja de vigilar esa partición hasta que alguien la vuelva a armar." : "La central empieza a vigilar: si hay alguien adentro y no corresponde al modo, va a saltar la alarma."}
                    etiquetaAccion={orden.accion === "armar" ? "Armar" : "Desarmar"}
                    onDelete={async () => {
                        try { await pedir(`/api/centrales/${d.central.id}/accion`, { method: "POST", body: JSON.stringify(orden) }); return { success: true }; }
                        catch (e: any) { return { success: false, error: e?.message }; }
                    }}
                    onSuccess={() => { setOrden(null); toast.success({ title: "Orden enviada a la central" }); leer(); }} />
            )}
        </CajonSeccion>
    );
}

// ── Últimos mensajes ─────────────────────────────────────────────────────────────────────────
//
// 23/10, Nico: «estilizá mucho más esto, iconografía clara, tooltips». Era una tabla de cuatro
// columnas en texto plano: la hora con la fecha repetida en cada fila, el protocolo (ADM-CID, igual
// en todas) en negrita, el evento sin distinguir un robo de un armado, y un ACK verde en cada fila
// que, en una central sana, dice siempre lo mismo. Ahora cada evento lleva el ícono y el tono de lo
// que es; los mensajes se agrupan por día; lo técnico (protocolo, secuencia, transporte, origen,
// cifrado, respuesta) pasa a la ayuda del ícono de la derecha, que sólo se pinta cuando la central
// NO recibió confirmación; y se puede filtrar por tipo de evento.

type TonoEvento = "mal" | "aviso" | "bien" | "info" | "quieto";
type ClaseMsg = "alarma" | "restaura" | "armado" | "falla" | "prueba" | "otro";
const CLASES_MSG: { id: ClaseMsg | "todo"; rotulo: string; icono: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { id: "todo", rotulo: "Todo", icono: Radio },
    { id: "alarma", rotulo: "Alarmas", icono: Siren },
    { id: "restaura", rotulo: "Restauraciones", icono: CircleCheck },
    { id: "armado", rotulo: "Armado", icono: ShieldCheck },
    { id: "falla", rotulo: "Fallas", icono: Wrench },
    { id: "prueba", rotulo: "Pruebas y supervisión", icono: Activity },
];

/** Qué es un evento, para el ícono, el tono y el filtro. */
function claseDeEvento(e: any): { clase: ClaseMsg; icono: React.ComponentType<{ size?: number; className?: string }>; tono: TonoEvento } {
    const cat = String(e?.categoria || ""), tipo = String(e?.tipo || "").toUpperCase(), texto = String(e?.texto || "").toLowerCase();
    if (/cancel/.test(texto) || /CANCEL/.test(tipo)) return { clase: "otro", icono: Ban, tono: "quieto" };
    if (/anulad|bypass/.test(texto) || /ANULA|BYPASS/.test(tipo)) return { clase: "otro", icono: CircleSlash, tono: "quieto" };
    if (cat === "ALARMA" && (e?.restaura || /restaurad/.test(texto))) return { clase: "restaura", icono: CircleCheck, tono: "bien" };
    if (cat === "ALARMA") return { clase: "alarma", icono: tipo === "INCENDIO" ? Flame : tipo === "PANICO" ? Siren : Siren, tono: "mal" };
    if (cat === "RESTAURACION") return { clase: "restaura", icono: CircleCheck, tono: "bien" };
    if (cat === "ARMADO") return { clase: "armado", icono: ShieldCheck, tono: "info" };
    if (cat === "DESARMADO") return { clase: "armado", icono: ShieldOff, tono: "quieto" };
    if (cat === "FALLA") return { clase: "falla", icono: Wrench, tono: "aviso" };
    if (cat === "FALLA_FIN") return { clase: "falla", icono: CircleCheck, tono: "bien" };
    if (cat === "PRUEBA" || cat === "SUPERVISION") return { clase: "prueba", icono: Activity, tono: "quieto" };
    if (cat === "COMUNICACION") return { clase: "falla", icono: WifiOff, tono: "aviso" };
    return { clase: "otro", icono: Info, tono: "quieto" };
}

const diaDe = (iso: string) => {
    const d = new Date(iso), hoy = new Date(); const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
    const igual = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    return igual(d, hoy) ? "Hoy" : igual(d, ayer) ? "Ayer" : d.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" });
};
const horaSeg = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** El detalle técnico de un mensaje, para la ayuda: lo que hace falta para diagnosticar una central. */
function DetalleTecnico({ m }: { m: Mensaje }) {
    const filas: [string, React.ReactNode][] = [
        ["Protocolo", m.idMensaje === "ADM-CID" ? "Contact ID (ADM-CID)" : m.idMensaje === "SIA-DCS" ? "SIA (SIA-DCS)" : m.idMensaje === "NULL" ? "Supervisión (NULL)" : m.idMensaje || "—"],
        ["Secuencia", m.seq != null ? <span className="tabular-nums">{m.seq}</span> : "—"],
        ["Llegó por", [m.transporte, m.ip].filter(Boolean).join(" desde ") || "—"],
        ["Cifrado", m.cifrado ? "Sí (AES)" : "No"],
        ["Respuesta", m.respuesta ? `${m.respuesta}${m.respuesta === "ACK" ? " · la central sabe que llegó" : m.respuesta === "NAK" ? " · se rechazó: la central reintenta" : ""}` : "ninguna"],
    ];
    return (
        <span className="block space-y-0.5">
            {filas.map(([k, v]) => <span key={k} className="flex gap-2"><span className="w-[72px] shrink-0 text-muted-foreground">{k}</span><span className="min-w-0">{v}</span></span>)}
            {m.datos && <span className="block pt-1 text-muted-foreground break-all">{m.datos}</span>}
        </span>
    );
}

function Mensajes({ mensajes, zonas }: { mensajes: Mensaje[]; zonas: Zona[] }) {
    const [filtro, setFiltro] = useState<ClaseMsg | "todo">("todo");
    const [conSupervision, setConSupervision] = useState(false);
    const nombreZona = useMemo(() => new Map(zonas.map((z) => [z.zona, z.nombre])), [zonas]);
    // Cada mensaje con la clase de su primer evento (un mensaje SIA puede traer varios).
    const filas = useMemo(() => mensajes.map((m) => {
        const evs = Array.isArray(m.eventos) ? m.eventos : [];
        const c = m.error ? { clase: "falla" as ClaseMsg, icono: AlertTriangle, tono: "mal" as TonoEvento } : evs.length ? claseDeEvento(evs[0]) : m.idMensaje === "NULL" ? { clase: "prueba" as ClaseMsg, icono: HeartPulse, tono: "quieto" as TonoEvento } : { clase: "otro" as ClaseMsg, icono: Info, tono: "quieto" as TonoEvento };
        return { m, evs, ...c, supervision: m.idMensaje === "NULL" && !evs.length };
    }), [mensajes]);
    const cuenta = (c: ClaseMsg | "todo") => filas.filter((f) => (conSupervision || !f.supervision) && (c === "todo" || f.clase === c)).length;
    const visibles = filas.filter((f) => (conSupervision || !f.supervision) && (filtro === "todo" || f.clase === filtro));
    const supervisiones = filas.filter((f) => f.supervision).length;
    const sinConfirmar = filas.filter((f) => f.m.respuesta && f.m.respuesta !== "ACK").length;

    let diaAnterior = "";
    return (
        <CajonSeccion titulo="Últimos mensajes" icono={Radio} plegable abiertaAlInicio={mensajes.length > 0 && mensajes.length < 20}
            resumen={mensajes.length ? `${mensajes.length} · el último ${hace(mensajes[0].recibido)}${sinConfirmar ? ` · ${sinConfirmar} sin confirmar` : ""}` : "ninguno"}>
            {mensajes.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-border px-4 py-5 text-center">
                    <Radio size={20} className="mx-auto mb-1.5 text-muted-foreground" />
                    <p className="text-[12.5px] text-muted-foreground">Todavía no llegó nada de esta central.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {/* Qué se mira: por tipo de evento, con su cuenta. La supervisión aparte: es un latido cada pocos minutos y taparía todo. */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center rounded-[10px] bg-muted/60 p-[3px] gap-0.5 flex-wrap" role="tablist">
                            {CLASES_MSG.map((c) => {
                                const n = cuenta(c.id); const on = filtro === c.id; const I = c.icono;
                                if (c.id !== "todo" && !n && !on) return null;
                                return (
                                    <Pista key={c.id} titulo={c.rotulo} texto={`${n} ${n === 1 ? "mensaje" : "mensajes"}`} lado="arriba">
                                        <button type="button" role="tab" aria-selected={on} onClick={() => setFiltro(c.id)}
                                            className={cn("h-7 px-2.5 rounded-[8px] inline-flex items-center gap-1.5 text-[11.5px] font-semibold transition-colors", on ? "bg-background ring-1 ring-border text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                            <I size={12} className={cn(on && c.id === "alarma" && "tono-mal")} />{c.id === "todo" ? c.rotulo : null}<span className="tabular-nums opacity-70">{n}</span>
                                        </button>
                                    </Pista>
                                );
                            })}
                        </div>
                        {supervisiones > 0 && (
                            <Pista titulo="Supervisión" texto="El latido con que la central avisa que sigue viva. Se esconde porque es uno cada pocos minutos." lado="arriba">
                                <button type="button" onClick={() => setConSupervision((v) => !v)} aria-pressed={conSupervision}
                                    className={cn("ml-auto h-7 px-2.5 rounded-[8px] inline-flex items-center gap-1.5 text-[11.5px] font-semibold border", conSupervision ? "border-[var(--accion)] text-[var(--accion)]" : "border-border text-muted-foreground hover:text-foreground")}>
                                    <HeartPulse size={12} /> {conSupervision ? "Ocultar" : "Mostrar"} supervisión <span className="tabular-nums opacity-70">{supervisiones}</span>
                                </button>
                            </Pista>
                        )}
                    </div>

                    {visibles.length === 0 ? <p className="text-[12.5px] text-muted-foreground px-1">Nada de este tipo en los últimos mensajes.</p> : (
                        <div className="rounded-[10px] border border-border overflow-hidden">
                            {visibles.map(({ m, evs, icono: I, tono }) => {
                                const dia = diaDe(m.recibido);
                                const cabecera = dia !== diaAnterior; diaAnterior = dia;
                                const e0 = evs[0] || null;
                                const zona = e0?.zona != null ? Number(e0.zona) : null;
                                const titulo = m.error ? (ERROR_TXT[m.error] || m.error) : e0 ? String(e0.texto || "Evento") : m.idMensaje === "NULL" ? "Supervisión" : (m.datos || "Mensaje");
                                const confirmado = !m.respuesta || m.respuesta === "ACK";
                                return (
                                    <div key={m.id}>
                                        {cabecera && <div className="px-3 py-1.5 bg-muted/50 border-b border-border text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground first-letter:uppercase">{dia}</div>}
                                        <div className="flex items-center gap-3 px-3 py-2 border-b border-border/60 last:border-0 hover:bg-muted/30">
                                            <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border", `chip-${tono}`)}><I size={15} /></span>
                                            <div className="min-w-0 flex-1 leading-tight">
                                                <div className={cn("text-[13px] font-semibold truncate", tono === "mal" && "tono-mal")}>{titulo}</div>
                                                <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted-foreground min-w-0">
                                                    {zona != null && (
                                                        <Pista titulo={`Zona ${zona}`} texto={nombreZona.get(zona) || "Sin nombre: se le pone en Zonas, arriba."} lado="arriba">
                                                            <span className="inline-flex items-center gap-1 min-w-0"><MapPin size={11} className="shrink-0" /><span className="truncate">Zona {zona}{nombreZona.get(zona) ? ` · ${nombreZona.get(zona)}` : ""}</span></span>
                                                        </Pista>
                                                    )}
                                                    {e0?.usuario != null && (
                                                        <Pista titulo={`Usuario ${e0.usuario}`} texto={e0.nombre ? String(e0.nombre) : "El número de usuario del teclado o la app de la central."} lado="arriba">
                                                            <span className="inline-flex items-center gap-1 shrink-0"><UserRound size={11} /> {e0.nombre || `Usuario ${e0.usuario}`}</span>
                                                        </Pista>
                                                    )}
                                                    {e0?.particion != null && zona == null && <span className="inline-flex items-center gap-1 shrink-0"><Layers size={11} /> Partición {e0.particion}</span>}
                                                    {evs.length > 1 && (
                                                        <Pista titulo={`${evs.length} eventos en este mensaje`} texto={evs.map((x: any) => `${x.texto}${x.zona != null ? ` · zona ${x.zona}` : ""}`).join(" · ")} lado="arriba">
                                                            <span className="shrink-0 rounded-full border border-border px-1.5 text-[10.5px] font-semibold">+{evs.length - 1}</span>
                                                        </Pista>
                                                    )}
                                                    {e0?.codigo && <span className="shrink-0 tabular-nums opacity-70">{e0.codigo}</span>}
                                                </div>
                                            </div>
                                            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{horaSeg(m.recibido)}</span>
                                            <Pista titulo={confirmado ? (m.respuesta ? "Confirmado a la central" : "Recibido") : m.respuesta === "NAK" ? "Rechazado" : `Respuesta ${m.respuesta}`} texto={<DetalleTecnico m={m} />} lado="izquierda" ancho={300}>
                                                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", confirmado ? "text-[var(--bien)] hover:bg-muted" : m.respuesta === "NAK" ? "pleno-mal" : "pleno-aviso")}>
                                                    {confirmado ? (m.cifrado ? <LockKeyhole size={14} /> : <CheckCheck size={15} />) : <AlertTriangle size={14} />}
                                                </span>
                                            </Pista>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </CajonSeccion>
    );
}

function Ajustes({ d, recargar, alBorrada }: { d: Ficha; recargar: () => void; alBorrada?: () => void }) {
    const c = d.central;
    const [min, setMin] = useState(String(Math.round(c.supervisionSeg / 60)));
    const [nuevaClave, setNuevaClave] = useState(false);
    const [borrar, setBorrar] = useState(false);
    const patch = async (cuerpo: any, ok: string) => {
        try { const j = await pedir(`/api/centrales/${c.id}`, { method: "PATCH", body: JSON.stringify(cuerpo) }); toast.success({ title: ok }); recargar(); return j; }
        catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); return null; }
    };
    return (
        <CajonSeccion titulo="Ajustes" icono={KeyRound} plegable resumen={`supervisión ${Math.round(c.supervisionSeg / 60)} min${c.lanVpn ? " · LAN/VPN" : ""}${c.prueba ? " · de prueba" : ""}`}>
            <div className="space-y-2">
                <div className="flex items-end gap-2">
                    <CajonCampo etiqueta="Supervisión (minutos)" className="flex-1"><Input value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} className="tabular-nums" /></CajonCampo>
                    <Button variant="outline" onClick={() => patch({ supervisionSeg: Math.round(Number(min || 10) * 60) }, "Supervisión guardada")} disabled={Math.round(Number(min) * 60) === c.supervisionSeg}>Guardar</Button>
                </div>
                <Opcion activa={c.lanVpn} alCambiar={(v) => patch({ lanVpn: v }, v ? "Acepta mensajes sin cifrar" : "Exige cifrado")} icono={ShieldOff} titulo="Está en la LAN o en una VPN" texto="Acepta mensajes sin cifrar. Por internet, apagado." />
                <Opcion activa={c.prueba} alCambiar={(v) => patch({ prueba: v }, v ? "Marcada de prueba" : "Ya no es de prueba: sus alarmas avisan")} icono={FlaskConical} titulo="Central de prueba" texto="Sus alarmas no disparan avisos ni la salud manda Telegram." />
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setNuevaClave(true)}><KeyRound size={14} /> Cambiar la clave AES</Button>
                    {/* Eliminar la central (22/10): la ficha de una central no tenía cómo. */}
                    <Button variant="outline" size="sm" onClick={() => setBorrar(true)} className="ml-auto text-[var(--mal)] border-[color-mix(in_oklab,var(--mal)_35%,transparent)]"><Trash2 size={14} /> Eliminar la central</Button>
                </div>
            </div>
            {borrar && (
                <ConfirmarEnCajon id={c.deviceId} open onOpenChange={(v) => !v && setBorrar(false)} title={`Eliminar ${c.device.name}`}
                    description={`Se borra de todo OmniAccess: sus zonas, sus mensajes, sus alarmas y su historial. La cuenta ${c.cuenta} queda libre: si la central sigue reportando, sus mensajes se confirman y se anotan como «cuenta no dada de alta». Queda en Auditoría.`}
                    etiquetaAccion="Eliminar" onDelete={deleteDevice} onSuccess={() => { setBorrar(false); alBorrada?.(); }} />
            )}
            {nuevaClave && (
                <ConfirmarEnCajon id={c.id} open onOpenChange={(v) => !v && setNuevaClave(false)} title={`Cambiar la clave de ${c.device.name}`}
                    description="La central deja de poder reportar hasta que se le cargue la clave nueva (en una AX, con «Escribir en la central»)." etiquetaAccion="Cambiar la clave"
                    onDelete={async () => { const j = await patch({ nuevaClave: true }, "Clave nueva generada"); return j ? { success: true } : { success: false, error: "No se pudo" }; }}
                    onSuccess={() => setNuevaClave(false)} />
            )}
        </CajonSeccion>
    );
}
