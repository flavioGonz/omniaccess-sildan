"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    ArrowLeft, Check, ChevronDown, CircleHelp, Fingerprint, FolderPlus, Globe, HardDrive, KeyRound, LockOpen, Monitor, Network, Phone,
    Plus, Printer, Radar, Router, Server, ShieldAlert, Sparkles, Tablet, Trash2, Wifi, X,
} from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { sileo as toast } from "sileo";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { ErrorEstado } from "@/components/ui/estados";
import { IconoTipo } from "@/components/devices/ArbolAreas";
import { ImportarCanalesNvr } from "@/components/devices/ImportarCanalesNvr";
import { crearArea, leerAreas } from "@/app/actions/areas";
import { leerRango } from "@/lib/descubrir-red";
import { CATEGORIAS, FABRICANTES, type Categoria, type Clasificacion } from "@/lib/descubrir-rotulos";
import { cn } from "@/lib/utils";

/**
 * «Descubrir equipos en la red», el descubridor inteligente (26/11). Nico: «que sea más inteligente,
 * detecte si es una cámara, un switch, etc.; identifique los OUI de fabricantes cuando estás en la
 * misma LAN; pregunte antes de comenzar el scan las credenciales, incluso SNMP; el objetivo es
 * capturar cámaras, porteros, NVR, controles de acceso y todo tipo de dispositivos. Debe preguntar
 * para agregarlos, consultar un área para cada uno, y si es un NVR preguntar si importamos sus
 * canales como cámaras y mapeamos sus grabaciones».
 *
 * Cuatro pasos, en el orden en que se piensa:
 *  1. **La red y las llaves.** Antes de barrer: el rango, hasta tres usuario/clave para entrar a
 *     los equipos y la comunidad SNMP. Con eso cada equipo se identifica por lo que dice de sí
 *     mismo (su ficha, su modelo) y no por qué puertos tiene abiertos.
 *  2. **El barrido, a la vista.** Primero el ping a todo el rango; después la identificación de a
 *     tandas, con su barra. Así ninguna llamada pasa el minuto del proxy (el error del 26/11 en la
 *     sincronización de matrículas) y se ve aparecer cada cosa.
 *  3. **Revisar.** Lo de OmniAccess agrupado por clase (cámaras LPR, cámaras, grabadores,
 *     porteros, controles de acceso, terminales faciales), cada uno con su nombre, su tipo, su área y
 *     el porqué de lo que se dedujo. La red (routers, switches, WiFi) y lo demás se muestran aparte
 *     y no se dan de alta: OmniAccess no los administra.
 *  4. **Confirmar y listo.** Se pregunta antes de dar de alta. Y a cada grabador que entró se le
 *     ofrece importar sus canales con el asistente de siempre, que mapea las grabaciones.
 */

type Acceso = { estado: "ok" | "clave" | "muda" | "sin-probar"; credencial: number | null; detalle: string | null };
type Identificado = {
    ip: string; rtt: number | null; mac: string | null; nombreDns: string | null; puertos: number[];
    servidor: string | null; reino: string | null; habla: string[];
    snmp: { descr: string | null; objectId: string | null; nombre: string | null } | null;
    acceso: Acceso;
    ficha: { modelo: string | null; serie: string | null; firmware: string | null; nombre: string | null; clase: string | null; protocolo: string | null } | null;
    canales: { total: number; conCamara: number } | null;
    anpr: boolean | null;
    clasificacion: Clasificacion;
    nombre: string;
    equipo: { id: string; nombre: string; tipo: string } | null;
};
type Viva = { ip: string; rtt: number | null; mac: string | null; fabricanteMac: string | null };
type Credencial = { usuario: string; clave: string };
type Area = { id: string; nombre: string; padre: string | null; orden: number };
/** Lo que se va a dar de alta de cada fila, editable. */
type Plan = { nombre: string; tipo: string; areaId: string; sentido: "ENTRY" | "EXIT" };
type Paso = "config" | "barriendo" | "revisar" | "listo";
type Alta = { ip: string; id: string; nombre: string; tipo: string };

const TANDA = 6;
const CREDENCIALES_MAX = 3;
const PARA_OMNI: Categoria[] = ["camara-lpr", "camara", "nvr", "portero", "control-acceso", "terminal-facial"];
const RED: Categoria[] = ["router", "switch", "ap"];
const TIPOS_ALTA = [
    { id: "LPR_CAMERA", rotulo: "Cámara LPR" }, { id: "CAMERA", rotulo: "Cámara" }, { id: "LPR_INTERIOR", rotulo: "Cámara interior (seguimiento)" },
    { id: "NVR", rotulo: "Grabador (NVR)" }, { id: "DOOR_INTERCOM", rotulo: "Portero" }, { id: "ACCESS_CONTROL", rotulo: "Control de acceso" },
    { id: "FACE_TERMINAL", rotulo: "Terminal facial" },
] as const;
/** Cómo se dice cada tipo en una cuenta: «1 cámara LPR», «3 cámaras LPR». Las siglas quedan en mayúscula. */
const TIPO_CUENTA: Record<string, [string, string]> = {
    LPR_CAMERA: ["cámara LPR", "cámaras LPR"], CAMERA: ["cámara", "cámaras"], LPR_INTERIOR: ["cámara interior", "cámaras interiores"], NVR: ["grabador", "grabadores"],
    DOOR_INTERCOM: ["portero", "porteros"], ACCESS_CONTROL: ["control de acceso", "controles de acceso"], FACE_TERMINAL: ["terminal facial", "terminales faciales"],
};
const minuscula = (t: string) => t.replace(/^\p{Lu}(?!\p{Lu})/u, (x) => x.toLowerCase());
const PUERTO_ROTULO: Record<number, string> = { 80: "web", 443: "web segura", 554: "RTSP", 8000: "Hikvision", 37777: "Dahua", 22: "SSH", 8291: "Winbox", 9100: "impresión", 3389: "escritorio remoto", 5060: "SIP", 8443: "UniFi" };
const ICONO_CATEGORIA: Partial<Record<Categoria, React.ComponentType<{ size?: number; className?: string }>>> = {
    router: Router, switch: Network, ap: Wifi, telefono: Phone, almacenamiento: HardDrive, computadora: Server, impresora: Printer, monitor: Tablet, otro: CircleHelp,
};
const ENTRADA = "w-full h-9 rounded-[6px] border border-border bg-background px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--accion)]/30 focus:border-[var(--accion)]";
const ROTULO = "block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5";

async function postear<T>(cuerpo: unknown): Promise<T> {
    const r = await fetch("/api/devices/descubrir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
    return j as T;
}

export function DescubrirRed({ abierto, alCerrar, alDarDeAlta, alAbrirEquipo, alCambiarEquipos }: {
    abierto: boolean;
    alCerrar: () => void;
    /** Dar de alta esa IP de a una: la pantalla de Dispositivos abre su alta con lo que se sepa. */
    alDarDeAlta: (datos: { ip: string; marca: string | null; tipo: string | null; nombre: string | null }) => void;
    alAbrirEquipo?: (id: string) => void;
    /** El alta escribe sola: la pantalla de atrás tiene que releer su lista. */
    alCambiarEquipos?: () => void;
}) {
    const [paso, setPaso] = useState<Paso>("config");
    const [subredes, setSubredes] = useState<string[]>([]);
    const [rango, setRango] = useState("");
    const [credenciales, setCredenciales] = useState<Credencial[]>([{ usuario: "admin", clave: "" }]);
    const [conSnmp, setConSnmp] = useState(false);
    const [comunidad, setComunidad] = useState("public");

    const [fase, setFase] = useState<"ping" | "identificando">("ping");
    const [vivas, setVivas] = useState<Viva[]>([]);
    const [mismaRed, setMismaRed] = useState(false);
    const [filas, setFilas] = useState<Identificado[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [msPing, setMsPing] = useState(0);
    const cancelado = useRef(false);

    const [areas, setAreas] = useState<Area[]>([]);
    const [elegidas, setElegidas] = useState<string[]>([]);
    const [planes, setPlanes] = useState<Record<string, Plan>>({});
    const [confirmando, setConfirmando] = useState(false);
    const [dandoAlta, setDandoAlta] = useState(false);
    const [altas, setAltas] = useState<Alta[]>([]);
    const [fallados, setFallados] = useState<{ ip: string; motivo: string }[]>([]);
    const [nvrImportar, setNvrImportar] = useState<{ id: string; name: string; ip: string } | null>(null);
    /** Los grabadores a los que ya se les importaron los canales en esta vuelta. */
    const [importados, setImportados] = useState<string[]>([]);

    useEffect(() => {
        if (!abierto) return;
        fetch("/api/devices/descubrir", { cache: "no-store" })
            .then((r) => r.json())
            .then((j) => { setSubredes(j.subredes || []); setRango((s) => s || `${j.subredes?.[0] || "192.168.1"}.0/24`); })
            .catch(() => setRango((s) => s || "192.168.1.0/24"));
        leerAreas().then((e) => setAreas(e.areas)).catch(() => setAreas([]));
    }, [abierto]);

    const leido = useMemo(() => leerRango(rango), [rango]);
    const rangoSirve = !("error" in leido);
    const credsValidas = useMemo(() => credenciales.filter((c) => c.usuario.trim()), [credenciales]);

    const cerrar = () => { cancelado.current = true; alCerrar(); };
    const volverAEmpezar = () => { cancelado.current = true; setPaso("config"); setFilas([]); setVivas([]); setElegidas([]); setPlanes({}); setAltas([]); setFallados([]); setError(null); };

    /** El barrido: ping a todo el rango y, de a tandas, la identificación de lo que contestó. */
    const barrer = useCallback(async () => {
        cancelado.current = false;
        setPaso("barriendo"); setFase("ping"); setError(null); setFilas([]); setVivas([]); setElegidas([]); setPlanes({}); setAltas([]); setFallados([]);
        try {
            const p = await postear<{ vivas: Viva[]; total: number; mismaRed: boolean; ms: number }>({ accion: "ping", rango });
            if (cancelado.current) return;
            setVivas(p.vivas); setMismaRed(p.mismaRed); setMsPing(p.ms); setFase("identificando");
            const juntadas: Identificado[] = [];
            for (let i = 0; i < p.vivas.length; i += TANDA) {
                if (cancelado.current) return;
                const r = await postear<{ identificados: Identificado[] }>({ accion: "identificar", vivas: p.vivas.slice(i, i + TANDA), credenciales: credsValidas, comunidad: conSnmp ? comunidad : null });
                juntadas.push(...r.identificados);
                setFilas([...juntadas]);
            }
            if (cancelado.current) return;
            // Lo que se elige solo: lo nuevo que es de OmniAccess y del que hay certeza (o se entró con la clave).
            const auto = juntadas.filter((f) => !f.equipo && f.clasificacion.tipo && (f.acceso.estado === "ok" || f.clasificacion.confianza !== "baja"));
            setElegidas(auto.map((f) => f.ip));
            setPlanes(Object.fromEntries(juntadas.filter((f) => !f.equipo).map((f) => [f.ip, {
                nombre: f.nombre, tipo: f.clasificacion.tipo || "CAMERA", areaId: "", sentido: /salida|exit/i.test(f.nombre) ? "EXIT" : "ENTRY",
            } as Plan])));
            setPaso("revisar");
        } catch (e) {
            if (!cancelado.current) { setError(e instanceof Error ? e.message : "No se pudo barrer la red"); setPaso("config"); }
        }
    }, [rango, credsValidas, conSnmp, comunidad]);

    const nuevosOmni = useMemo(() => filas.filter((f) => !f.equipo && PARA_OMNI.includes(f.clasificacion.categoria)), [filas]);
    const yaEstan = useMemo(() => filas.filter((f) => f.equipo), [filas]);
    const deRed = useMemo(() => filas.filter((f) => !f.equipo && RED.includes(f.clasificacion.categoria)), [filas]);
    const otros = useMemo(() => filas.filter((f) => !f.equipo && !PARA_OMNI.includes(f.clasificacion.categoria) && !RED.includes(f.clasificacion.categoria)), [filas]);
    const elegibles = useMemo(() => filas.filter((f) => !f.equipo && f.clasificacion.categoria !== "monitor"), [filas]);

    const setPlan = (ip: string, cambio: Partial<Plan>) => setPlanes((p) => ({ ...p, [ip]: { ...p[ip], ...cambio } }));
    const alternar = (ip: string) => setElegidas((l) => (l.includes(ip) ? l.filter((x) => x !== ip) : [...l, ip]));
    const areaParaTodas = (areaId: string) => setPlanes((p) => { const n = { ...p }; for (const ip of elegidas) if (n[ip]) n[ip] = { ...n[ip], areaId }; return n; });

    async function nuevaArea(nombre: string): Promise<string | null> {
        const n = nombre.trim();
        if (!n) return null;
        try {
            const e = await crearArea(n, null);
            setAreas(e.areas);
            return e.areas.find((a) => a.nombre === n && !areas.some((x) => x.id === a.id))?.id || e.areas[e.areas.length - 1]?.id || null;
        } catch (err) { toast.error({ title: "No se pudo crear el área", description: err instanceof Error ? err.message : undefined }); return null; }
    }

    async function darDeAlta() {
        const lista = filas.filter((f) => elegidas.includes(f.ip) && !f.equipo);
        if (!lista.length) return;
        setDandoAlta(true);
        try {
            const equipos = lista.map((f) => {
                const plan = planes[f.ip];
                const cred = f.acceso.estado === "ok" && f.acceso.credencial != null ? credsValidas[f.acceso.credencial] : null;
                return {
                    ip: f.ip, nombre: plan?.nombre || f.nombre, tipo: plan?.tipo || f.clasificacion.tipo || "CAMERA",
                    marca: f.clasificacion.marca || "GENERICA", modelo: f.ficha?.modelo || null, mac: f.mac,
                    usuario: cred?.usuario || null, clave: cred?.clave ?? null,
                    areaId: plan?.areaId || null, sentido: plan?.sentido || "ENTRY",
                };
            });
            const j = await postear<{ hechos: Alta[]; fallados: { ip: string; motivo: string }[] }>({ accion: "alta", equipos });
            setAltas(j.hechos); setFallados(j.fallados || []);
            setConfirmando(false); setPaso("listo");
            alCambiarEquipos?.();
        } catch (e) {
            toast.error({ title: "No se pudo dar de alta", description: e instanceof Error ? e.message : undefined });
        } finally { setDandoAlta(false); }
    }

    const elegidasNuevas = filas.filter((f) => elegidas.includes(f.ip) && !f.equipo);
    const resumenElegidas = useMemo(() => {
        const c = new Map<string, number>();
        for (const f of elegidasNuevas) { const t = planes[f.ip]?.tipo || "CAMERA"; c.set(t, (c.get(t) || 0) + 1); }
        return [...c.entries()].map(([t, n]) => `${n} ${(TIPO_CUENTA[t] || [t, t])[n === 1 ? 0 : 1]}`).join(", ");
    }, [elegidasNuevas, planes]);
    const sinArea = elegidasNuevas.filter((f) => !planes[f.ip]?.areaId).length;
    const sinClave = elegidasNuevas.filter((f) => f.acceso.estado !== "ok").length;

    const PASOS: { k: Paso; t: string }[] = [{ k: "config", t: "Red y llaves" }, { k: "barriendo", t: "Barrido" }, { k: "revisar", t: "Revisar" }, { k: "listo", t: "Listo" }];
    const iPaso = PASOS.findIndex((p) => p.k === paso);
    const pctIdent = vivas.length ? Math.round((filas.length / vivas.length) * 100) : 0;

    /* Un cajón por vez (26/11, Nico: «está raro el proceso con dos cajones que se abren uno encima del
       otro»). Al importar los canales de un grabador, el descubridor se corre (queda montado, con su
       paso «Listo» intacto) y vuelve cuando el importador se cierra. */
    return (
        <>
        <Cajon open={abierto && !nvrImportar} onOpenChange={(v) => !v && !nvrImportar && cerrar()}>
            <CajonContenido ancho="ancho" titulo="Descubrir equipos en la red"
                descripcion="Encuentra lo que hay en la red, dice qué es cada cosa y da de alta lo que sirve para OmniAccess. Sólo lee: a ningún equipo se le escribe nada."
                encabezado={
                    <div className="px-6 py-3">
                        <ol className="flex items-center gap-2">
                            {PASOS.map((p, i) => (
                                <li key={p.k} className="flex items-center gap-2 min-w-0">
                                    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                                        i < iPaso ? "bg-[var(--accion)] text-white" : i === iPaso ? "border-2 border-[var(--accion)] text-[var(--accion)]" : "border border-border text-muted-foreground")}>
                                        {i < iPaso ? <Check size={13} strokeWidth={3} /> : i + 1}
                                    </span>
                                    <span className={cn("text-[12px] font-semibold truncate", i === iPaso ? "text-foreground" : "text-muted-foreground")}>{p.t}</span>
                                    {i < PASOS.length - 1 && <span className={cn("h-px w-6 sm:w-10", i < iPaso ? "bg-[var(--accion)]" : "bg-border")} />}
                                </li>
                            ))}
                        </ol>
                    </div>
                }
                pie={
                    paso === "config" ? (
                        <div className="flex w-full items-center gap-2">
                            <p className="text-[11.5px] text-muted-foreground mr-auto">{rangoSirve ? `${leido.total} direcciones · ${credsValidas.length} ${credsValidas.length === 1 ? "clave" : "claves"}${conSnmp ? " · SNMP" : ""}` : ""}</p>
                            <Button onClick={barrer} disabled={!rangoSirve}><Radar size={15} /> Buscar equipos</Button>
                        </div>
                    ) : paso === "barriendo" ? (
                        <div className="flex w-full justify-end"><Button variant="outline" onClick={volverAEmpezar}><X size={15} /> Cancelar</Button></div>
                    ) : paso === "revisar" ? (
                        <div className="flex w-full items-center gap-2">
                            <Button variant="outline" onClick={volverAEmpezar}><ArrowLeft size={15} /> Otra búsqueda</Button>
                            <p className="ml-auto hidden sm:block text-[11.5px] text-muted-foreground">{elegidasNuevas.length ? resumenElegidas : "Elegí qué dar de alta"}</p>
                            <Button onClick={() => setConfirmando(true)} disabled={!elegidasNuevas.length}><Plus size={15} /> Dar de alta {elegidasNuevas.length || ""}</Button>
                        </div>
                    ) : (
                        <div className="flex w-full items-center gap-2">
                            <Button variant="outline" onClick={volverAEmpezar}><Radar size={15} /> Buscar otra red</Button>
                            <Button className="ml-auto" onClick={cerrar}>Cerrar</Button>
                        </div>
                    )
                }>

                <div className="relative px-6 py-5">
                    {paso === "config" && (
                        <PasoConfig {...{ rango, setRango, leido, rangoSirve, subredes, credenciales, setCredenciales, conSnmp, setConSnmp, comunidad, setComunidad, error }} alBuscar={barrer} />
                    )}

                    {paso === "barriendo" && (
                        <div className="space-y-4">
                            <div className="rounded-[10px] border border-border bg-card p-4">
                                <div className="flex items-center gap-2 text-[13px]">
                                    <Loader2 size={16} className="animate-spin text-[var(--accion)]" />
                                    <b>{fase === "ping" ? `Buscando quién contesta en ${rangoSirve ? `${leido.subred}.${leido.desde}–${leido.hasta}` : rango}…` : `Identificando ${filas.length} de ${vivas.length}`}</b>
                                    {fase === "identificando" && <span className="ml-auto text-[12px] font-bold tabular-nums text-[var(--accion)]">{pctIdent}%</span>}
                                </div>
                                <div className="mt-2.5 h-1.5 rounded-full bg-muted overflow-hidden">
                                    {fase === "ping"
                                        ? <motion.div className="h-full w-1/3 bg-[var(--accion)]/60" animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />
                                        : <motion.div className="h-full bg-[var(--accion)]" initial={false} animate={{ width: `${pctIdent}%` }} transition={{ duration: 0.35 }} />}
                                </div>
                                <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
                                    {fase === "ping"
                                        ? "Un ping a cada dirección. Tarda unos diez segundos por cada 254."
                                        : `${vivas.length} contestaron en ${(msPing / 1000).toFixed(1)} s. A cada una se le miran los puertos y la página web${conSnmp ? ", se le pregunta por SNMP" : ""}${credsValidas.length ? " y se prueba la clave" : ""}.${mismaRed ? " Están en la misma red que el servidor: la MAC dice el fabricante." : ""}`}
                                </p>
                            </div>
                            {filas.length > 0 && <ConteoVivo filas={filas} />}
                        </div>
                    )}

                    {paso === "revisar" && (
                        <div className="space-y-5">
                            <ConteoVivo filas={filas} />
                            {!mismaRed && <p className="flex items-start gap-2 text-[11.5px] leading-snug text-muted-foreground"><Fingerprint size={13} className="mt-0.5 shrink-0" /> Esta red no es la del servidor (está detrás de un router o de una VPN): no se ven las MAC, así que el fabricante sale de la ficha, de SNMP o de lo que el equipo dice al conectarse.</p>}

                            {nuevosOmni.length > 0 && (
                                <section className="space-y-2.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-[13.5px] font-bold">Para OmniAccess · {nuevosOmni.length}</h3>
                                        <button type="button" onClick={() => setElegidas((l) => { const ips = nuevosOmni.map((f) => f.ip); const todas = ips.every((ip) => l.includes(ip)); return todas ? l.filter((x) => !ips.includes(x)) : [...new Set([...l, ...ips])]; })}
                                            className="text-[11.5px] font-semibold text-[var(--accion)] hover:underline">{nuevosOmni.every((f) => elegidas.includes(f.ip)) ? "Ninguno" : "Elegir todos"}</button>
                                        <AreaMasiva areas={areas} deshabilitado={!elegidasNuevas.length} alElegir={areaParaTodas} alCrear={nuevaArea} />
                                    </div>
                                    {PARA_OMNI.map((cat) => {
                                        const del = nuevosOmni.filter((f) => f.clasificacion.categoria === cat);
                                        if (!del.length) return null;
                                        return (
                                            <div key={cat} className="space-y-1.5">
                                                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground"><IconoTipo tipo={CATEGORIAS[cat].tipo || ""} size={12} />{CATEGORIAS[cat].plural} · {del.length}</p>
                                                <div className="rounded-[10px] border border-border divide-y divide-border">
                                                    {del.map((f) => <FilaRevisar key={f.ip} f={f} plan={planes[f.ip]} areas={areas} elegida={elegidas.includes(f.ip)} credenciales={credsValidas}
                                                        alElegir={() => alternar(f.ip)} alCambiar={(c) => setPlan(f.ip, c)} alCrearArea={nuevaArea}
                                                        alAltaCompleta={() => alDarDeAlta({ ip: f.ip, marca: f.clasificacion.marca, tipo: f.clasificacion.tipo, nombre: planes[f.ip]?.nombre || f.nombre })} />)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </section>
                            )}

                            {nuevosOmni.length === 0 && (
                                <div className="rounded-[10px] border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
                                    No apareció nada nuevo para OmniAccess en esta red.{yaEstan.length ? ` ${yaEstan.length} ya están dados de alta.` : ""}
                                </div>
                            )}

                            {yaEstan.length > 0 && (
                                <Plegable titulo={`Ya están en OmniAccess · ${yaEstan.length}`} ayuda="Se reconocen por la IP. No se tocan.">
                                    {yaEstan.map((f) => <FilaSimple key={f.ip} f={f} accion={alAbrirEquipo ? <Button size="sm" variant="outline" onClick={() => alAbrirEquipo(f.equipo!.id)}>Abrir</Button> : null} />)}
                                </Plegable>
                            )}
                            {deRed.length > 0 && (
                                <Plegable titulo={`Red e infraestructura · ${deRed.length}`} ayuda="Routers, switches y WiFi. Se muestran para que se sepa qué hay, pero OmniAccess no los administra.">
                                    {deRed.map((f) => <FilaSimple key={f.ip} f={f} elegida={elegidas.includes(f.ip)} alElegir={() => alternar(f.ip)} />)}
                                </Plegable>
                            )}
                            {otros.length > 0 && (
                                <Plegable titulo={`Otros y sin identificar · ${otros.length}`} ayuda="Teléfonos, computadoras, impresoras y lo que no se pudo saber. Si alguno es una cámara, elegilo y cambiale el tipo.">
                                    {otros.map((f) => <FilaSimple key={f.ip} f={f} elegida={f.clasificacion.categoria === "monitor" ? undefined : elegidas.includes(f.ip)} alElegir={f.clasificacion.categoria === "monitor" ? undefined : () => alternar(f.ip)} />)}
                                </Plegable>
                            )}
                            {elegibles.length > 0 && elegidasNuevas.some((f) => !PARA_OMNI.includes(f.clasificacion.categoria)) && (
                                <section className="space-y-1.5">
                                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Elegidos de las otras listas</p>
                                    <div className="rounded-[10px] border border-border divide-y divide-border">
                                        {elegidasNuevas.filter((f) => !PARA_OMNI.includes(f.clasificacion.categoria)).map((f) => <FilaRevisar key={f.ip} f={f} plan={planes[f.ip]} areas={areas} elegida credenciales={credsValidas}
                                            alElegir={() => alternar(f.ip)} alCambiar={(c) => setPlan(f.ip, c)} alCrearArea={nuevaArea} />)}
                                    </div>
                                </section>
                            )}
                        </div>
                    )}

                    {paso === "listo" && (
                        <PasoListo altas={altas} fallados={fallados} filas={filas} importados={importados} alAbrirEquipo={alAbrirEquipo} alImportar={(a) => setNvrImportar({ id: a.id, name: a.nombre, ip: a.ip })} />
                    )}

                    {/* La pregunta antes de dar de alta: «debe preguntar para agregarlos». */}
                    <AnimatePresence>
                        {confirmando && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => !dandoAlta && setConfirmando(false)}>
                                <motion.div initial={{ y: 12, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                                    onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-[14px] border border-border bg-background p-5 shadow-[var(--sombra-flotante,0_12px_40px_rgba(0,0,0,.18))]">
                                    <p className="flex items-center gap-2 text-[15px] font-bold"><Sparkles size={16} className="text-[var(--accion)]" /> ¿Damos de alta {elegidasNuevas.length} {elegidasNuevas.length === 1 ? "equipo" : "equipos"}?</p>
                                    <p className="mt-1 text-[13px] text-muted-foreground">{resumenElegidas}.</p>
                                    <ul className="mt-3 space-y-1.5 text-[12.5px]">
                                        <li className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 tono-bien" /> Quedan en Dispositivos con su nombre, tipo y marca; las cámaras, con su video.</li>
                                        {sinArea > 0 ? <li className="flex items-start gap-2"><ShieldAlert size={14} className="mt-0.5 shrink-0 tono-aviso" /> {sinArea} sin área: van a quedar en «Sin área».</li>
                                            : <li className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 tono-bien" /> Cada uno en su área.</li>}
                                        {sinClave > 0 && <li className="flex items-start gap-2"><KeyRound size={14} className="mt-0.5 shrink-0 tono-aviso" /> {sinClave} sin clave que entre: hay que cargarla en su ficha para que funcionen.</li>}
                                        <li className="flex items-start gap-2"><LockOpen size={14} className="mt-0.5 shrink-0 text-muted-foreground" /> A los equipos no se les escribe nada: sólo se guardan en OmniAccess.</li>
                                    </ul>
                                    <div className="mt-5 flex justify-end gap-2">
                                        <Button variant="outline" onClick={() => setConfirmando(false)} disabled={dandoAlta}>Revisar de nuevo</Button>
                                        <Button onClick={darDeAlta} disabled={dandoAlta}>{dandoAlta ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Sí, dar de alta</Button>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </CajonContenido>
        </Cajon>
        <ImportarCanalesNvr nvr={nvrImportar} open={abierto && !!nvrImportar} onOpenChange={(v) => { if (!v) setNvrImportar(null); }}
            onListo={() => { if (nvrImportar) setImportados((l) => [...l, nvrImportar.id]); setNvrImportar(null); alCambiarEquipos?.(); }} />
        </>
    );
}

/* ═══════════════════════ Paso 1: la red y las llaves ═══════════════════════ */

function PasoConfig({ rango, setRango, leido, rangoSirve, subredes, credenciales, setCredenciales, conSnmp, setConSnmp, comunidad, setComunidad, error, alBuscar }: {
    rango: string; setRango: (v: string) => void; leido: ReturnType<typeof leerRango>; rangoSirve: boolean; subredes: string[];
    credenciales: Credencial[]; setCredenciales: (f: (c: Credencial[]) => Credencial[]) => void;
    conSnmp: boolean; setConSnmp: (v: boolean) => void; comunidad: string; setComunidad: (v: string) => void; error: string | null; alBuscar: () => void;
}) {
    return (
        <div className="space-y-5">
            {error && <ErrorEstado mensaje={error} alReintentar={alBuscar} />}
            <Seccion icono={Globe} titulo="Qué red" ayuda="Una /24 por vez. Se puede escribir 192.168.1, un CIDR (192.168.1.0/24) o un tramo (192.168.1.10-60). Sólo redes privadas.">
                <input value={rango} onChange={(e) => setRango(e.target.value)} placeholder="192.168.1.0/24" onKeyDown={(e) => { if (e.key === "Enter" && rangoSirve) alBuscar(); }}
                    className={cn(ENTRADA, "tabular-nums", rango && !rangoSirve && "border-[var(--mal)] focus:ring-[var(--mal)]/25")} />
                <p className={cn("mt-1.5 text-[11.5px]", rango && !rangoSirve ? "tono-mal" : "text-muted-foreground")}>
                    {rango && !rangoSirve ? (leido as { error: string }).error : rangoSirve && "subred" in leido ? `${leido.subred}.${leido.desde} a ${leido.subred}.${leido.hasta} · ${leido.total} ${leido.total === 1 ? "dirección" : "direcciones"}` : ""}
                </p>
                {subredes.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11.5px] text-muted-foreground">Redes con equipos:</span>
                        {subredes.map((s) => (
                            <button key={s} type="button" onClick={() => setRango(`${s}.0/24`)} className={cn("h-6 px-2 rounded-full border text-[11.5px] font-semibold tabular-nums",
                                rangoSirve && "subred" in leido && leido.subred === s ? "border-[var(--accion)] text-[var(--accion)]" : "border-border text-muted-foreground hover:bg-accent")}>{s}.0/24</button>
                        ))}
                    </div>
                )}
            </Seccion>

            <Seccion icono={KeyRound} titulo="Claves para entrar a los equipos" ayuda="Con una clave que entra, el equipo dice qué es (modelo, si es grabador o cámara, si lee matrículas) y queda cargado con ella. Se prueban en orden con los equipos nuevos que hablan Hikvision o Dahua, sólo leyendo su ficha.">
                <div className="space-y-2">
                    {credenciales.map((c, i) => (
                        <div key={i} className="flex items-end gap-2">
                            <label className="w-[150px] shrink-0">{i === 0 && <span className={ROTULO}>Usuario</span>}
                                <input value={c.usuario} onChange={(e) => setCredenciales((l) => l.map((x, j) => (j === i ? { ...x, usuario: e.target.value } : x)))} autoComplete="off" className={ENTRADA} /></label>
                            <label className="flex-1 min-w-0">{i === 0 && <span className={ROTULO}>Clave</span>}
                                <input type="password" value={c.clave} onChange={(e) => setCredenciales((l) => l.map((x, j) => (j === i ? { ...x, clave: e.target.value } : x)))} autoComplete="new-password" className={ENTRADA} /></label>
                            {credenciales.length > 1 && <button type="button" onClick={() => setCredenciales((l) => l.filter((_, j) => j !== i))} className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent" aria-label="Quitar esta clave"><Trash2 size={14} /></button>}
                        </div>
                    ))}
                </div>
                {credenciales.length < CREDENCIALES_MAX && (
                    <button type="button" onClick={() => setCredenciales((l) => [...l, { usuario: "admin", clave: "" }])} className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accion)] hover:underline"><Plus size={13} /> Otra clave</button>
                )}
                <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-muted-foreground"><ShieldAlert size={13} className="mt-0.5 shrink-0" /> Hasta tres. Cada clave equivocada es un intento fallido para el equipo, y las Hikvision bloquean al servidor después de varios. Las claves no se guardan: sólo quedan en los equipos que se den de alta.</p>
            </Seccion>

            <Seccion icono={Network} titulo="SNMP (opcional)" ayuda="Switches, routers y puntos de acceso no hablan como las cámaras, pero casi todos dicen quiénes son por SNMP. Se pregunta sólo la descripción, el fabricante y el nombre.">
                <label className="flex items-center gap-2.5 text-[13px] cursor-pointer select-none">
                    <input type="checkbox" checked={conSnmp} onChange={(e) => setConSnmp(e.target.checked)} className="h-4 w-4 accent-[var(--accion)]" /> Preguntar por SNMP v2c
                </label>
                {conSnmp && (
                    <label className="mt-2 block max-w-[260px]"><span className={ROTULO}>Comunidad de lectura</span>
                        <input value={comunidad} onChange={(e) => setComunidad(e.target.value)} autoComplete="off" className={ENTRADA} /></label>
                )}
            </Seccion>
        </div>
    );
}

function Seccion({ icono: I, titulo, ayuda, children }: { icono: React.ComponentType<{ size?: number; className?: string }>; titulo: string; ayuda: string; children: React.ReactNode }) {
    return (
        <section className="rounded-[10px] border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-[13.5px] font-bold"><span className="grid h-7 w-7 place-items-center rounded-[8px] bg-muted"><I size={14} className="text-[var(--accion)]" /></span>{titulo}</p>
            <p className="mt-1 mb-3 text-[11.5px] leading-snug text-muted-foreground">{ayuda}</p>
            {children}
        </section>
    );
}

/* ═══════════════════════ El conteo que se va armando ═══════════════════════ */

function ConteoVivo({ filas }: { filas: Identificado[] }) {
    const cuenta = new Map<Categoria, number>();
    for (const f of filas) cuenta.set(f.clasificacion.categoria, (cuenta.get(f.clasificacion.categoria) || 0) + 1);
    const orden = (Object.keys(CATEGORIAS) as Categoria[]).filter((c) => cuenta.get(c));
    return (
        <div className="flex flex-wrap gap-1.5">
            {orden.map((c) => (
                <motion.span key={c} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                    className={cn("inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] font-semibold", PARA_OMNI.includes(c) ? "border-[var(--accion)]/40 bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "border-border text-muted-foreground")}>
                    <IconoCategoria c={c} /> {cuenta.get(c)} {minuscula(cuenta.get(c) === 1 ? CATEGORIAS[c].rotulo : CATEGORIAS[c].plural)}
                </motion.span>
            ))}
        </div>
    );
}

function IconoCategoria({ c, size = 13 }: { c: Categoria; size?: number }) {
    const I = ICONO_CATEGORIA[c];
    if (I) return <I size={size} className="text-muted-foreground" />;
    return <IconoTipo tipo={CATEGORIAS[c].tipo || ""} size={size} />;
}

/* ═══════════════════════ Paso 3: revisar ═══════════════════════ */

/** De dónde sale lo que se dedujo, en una línea chica: «la ficha dice DS-7616NI · MAC de Hikvision». */
function Porque({ f }: { f: Identificado }) {
    const c = f.clasificacion;
    const conf = c.confianza === "alta" ? "chip-bien" : c.confianza === "media" ? "chip-info" : "chip-quieto";
    return (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold", conf)}>{c.confianza === "alta" ? "seguro" : c.confianza === "media" ? "probable" : "a confirmar"}</span>
            {c.por.slice(0, 3).map((p) => <span key={p}>· {p}</span>)}
        </span>
    );
}

function SelloAcceso({ a, credenciales }: { a: Acceso; credenciales: Credencial[] }) {
    const comun = "shrink-0 inline-flex items-center gap-1 rounded-full px-2 h-6 text-[11px] font-bold";
    if (a.estado === "ok") return <span className={cn(comun, "chip-bien")} title={`Entró con el usuario ${credenciales[a.credencial ?? 0]?.usuario || "?"}`}><LockOpen size={11} /> {credenciales.length > 1 ? `Clave ${(a.credencial ?? 0) + 1}` : "Entra"}</span>;
    if (a.estado === "clave") return <span className={cn(comun, "chip-mal")} title={a.detalle || undefined}><ShieldAlert size={11} /> Clave</span>;
    if (a.estado === "muda") return <span className={cn(comun, "chip-quieto")} title={a.detalle || undefined}><X size={11} /> No habla</span>;
    return null;
}

function FilaRevisar({ f, plan, areas, elegida, credenciales, alElegir, alCambiar, alCrearArea, alAltaCompleta }: {
    f: Identificado; plan?: Plan; areas: Area[]; elegida: boolean; credenciales: Credencial[];
    alElegir: () => void; alCambiar: (c: Partial<Plan>) => void; alCrearArea: (n: string) => Promise<string | null>; alAltaCompleta?: () => void;
}) {
    const fab = f.clasificacion.fabricante ? FABRICANTES[f.clasificacion.fabricante]?.rotulo : null;
    const detalle = [fab, f.ficha?.modelo, f.canales ? `${f.canales.total} canales (${f.canales.conCamara} con cámara)` : null, f.puertos.map((p) => PUERTO_ROTULO[p] || p).join(" · ")].filter(Boolean).join(" · ");
    const tipo = plan?.tipo || f.clasificacion.tipo || "CAMERA";
    return (
        <div className={cn("px-3.5 py-3 transition-colors", elegida && "bg-[color-mix(in_oklab,var(--accion)_5%,transparent)]")}>
            <div className="flex items-start gap-3">
                <button type="button" role="checkbox" aria-checked={elegida} onClick={alElegir} aria-label={`Elegir ${f.ip}`}
                    className={cn("mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[5px] border grid place-items-center", elegida ? "border-[var(--accion)] bg-[var(--accion)] text-white" : "border-border hover:border-[var(--accion)]")}>
                    {elegida && <Check size={13} strokeWidth={3} />}
                </button>
                <span className="mt-0.5"><IconoCategoria c={f.clasificacion.categoria} size={15} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="w-[104px] shrink-0 text-[13px] font-bold tabular-nums">{f.ip}</span>
                        <span className="text-[12.5px] font-semibold">{CATEGORIAS[f.clasificacion.categoria].rotulo}</span>
                        {f.rtt != null && <span className="text-[11px] text-muted-foreground tabular-nums">{f.rtt} ms</span>}
                    </div>
                    <p className="text-[11.5px] text-muted-foreground truncate">{detalle || "sin puertos conocidos abiertos"}</p>
                    <Porque f={f} />
                </div>
                <SelloAcceso a={f.acceso} credenciales={credenciales} />
                {alAltaCompleta && <button type="button" onClick={alAltaCompleta} className="hidden sm:block shrink-0 text-[11.5px] font-semibold text-muted-foreground hover:text-[var(--accion)] hover:underline">Alta completa</button>}
            </div>
            {elegida && plan && (
                <div className="mt-2.5 ml-[30px] grid gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
                    <label className="min-w-0"><span className={ROTULO}>Nombre</span><input value={plan.nombre} onChange={(e) => alCambiar({ nombre: e.target.value })} className={ENTRADA} /></label>
                    <label className="min-w-0"><span className={ROTULO}>Tipo</span>
                        <select value={tipo} onChange={(e) => alCambiar({ tipo: e.target.value })} className={cn(ENTRADA, "px-2")}>
                            {TIPOS_ALTA.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
                        </select></label>
                    <SelectorArea areas={areas} valor={plan.areaId} alElegir={(a) => alCambiar({ areaId: a })} alCrear={alCrearArea} />
                    {tipo === "LPR_CAMERA" ? (
                        <div><span className={ROTULO}>Sentido</span>
                            <div className="flex h-9 rounded-[6px] border border-border p-0.5">
                                {(["ENTRY", "EXIT"] as const).map((s) => <button key={s} type="button" onClick={() => alCambiar({ sentido: s })} className={cn("flex-1 rounded-[4px] px-2.5 text-[12px] font-semibold", plan.sentido === s ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:bg-accent")}>{s === "ENTRY" ? "Entrada" : "Salida"}</button>)}
                            </div></div>
                    ) : <span className="hidden sm:block" />}
                    {tipo === "NVR" && <p className="sm:col-span-4 flex items-start gap-1.5 text-[11.5px] text-muted-foreground"><HardDrive size={12} className="mt-0.5 shrink-0" /> Al terminar se ofrece importar sus canales como cámaras y vincular las grabaciones.</p>}
                </div>
            )}
        </div>
    );
}

/** Elegir un área (del árbol de Dispositivos) o crear una nueva ahí mismo. */
function SelectorArea({ areas, valor, alElegir, alCrear }: { areas: Area[]; valor: string; alElegir: (id: string) => void; alCrear: (n: string) => Promise<string | null> }) {
    const [creando, setCreando] = useState(false);
    const [nombre, setNombre] = useState("");
    const ordenadas = useMemo(() => {
        const out: { a: Area; nivel: number }[] = [];
        const rec = (p: string | null, n: number) => { for (const a of areas.filter((x) => (x.padre || null) === p).sort((x, y) => x.orden - y.orden)) { out.push({ a, nivel: n }); if (n < 6) rec(a.id, n + 1); } };
        rec(null, 0);
        return out;
    }, [areas]);
    if (creando) return (
        <label className="min-w-0"><span className={ROTULO}>Área nueva</span>
            <span className="flex gap-1">
                <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Portería norte" className={ENTRADA}
                    onKeyDown={async (e) => { if (e.key === "Enter") { const id = await alCrear(nombre); if (id) { alElegir(id); setCreando(false); setNombre(""); } } if (e.key === "Escape") setCreando(false); }} />
                <button type="button" onClick={async () => { const id = await alCrear(nombre); if (id) { alElegir(id); setCreando(false); setNombre(""); } }} className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[var(--accion)] text-white" aria-label="Crear área"><Check size={14} /></button>
            </span></label>
    );
    return (
        <label className="min-w-0"><span className={ROTULO}>Área</span>
            <select value={valor} onChange={(e) => { if (e.target.value === "__nueva") setCreando(true); else alElegir(e.target.value); }} className={cn(ENTRADA, "px-2", !valor && "text-muted-foreground")}>
                <option value="">Sin área</option>
                {ordenadas.map(({ a, nivel }) => <option key={a.id} value={a.id}>{"  ".repeat(nivel)}{a.nombre}</option>)}
                <option value="__nueva">+ Crear un área…</option>
            </select></label>
    );
}

/** Poner la misma área a todos los elegidos de una. */
function AreaMasiva({ areas, deshabilitado, alElegir, alCrear }: { areas: Area[]; deshabilitado: boolean; alElegir: (id: string) => void; alCrear: (n: string) => Promise<string | null> }) {
    const [abierto, setAbierto] = useState(false);
    const [valor, setValor] = useState("");
    return (
        <div className="ml-auto flex items-center gap-1.5">
            {abierto ? (
                <>
                    <div className="w-[200px]"><SelectorArea areas={areas} valor={valor} alElegir={(id) => { setValor(id); alElegir(id); setAbierto(false); }} alCrear={alCrear} /></div>
                    <button type="button" onClick={() => setAbierto(false)} className="mt-5 grid h-9 w-9 place-items-center rounded-[6px] text-muted-foreground hover:bg-accent" aria-label="Cerrar"><X size={14} /></button>
                </>
            ) : (
                <Button size="sm" variant="outline" disabled={deshabilitado} onClick={() => setAbierto(true)}><FolderPlus size={14} /> Área para los elegidos</Button>
            )}
        </div>
    );
}

function Plegable({ titulo, ayuda, children }: { titulo: string; ayuda: string; children: React.ReactNode }) {
    const [abierto, setAbierto] = useState(false);
    return (
        <section>
            <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center gap-2 text-left">
                <ChevronDown size={15} className={cn("text-muted-foreground transition-transform", !abierto && "-rotate-90")} />
                <span className="text-[13px] font-bold text-muted-foreground">{titulo}</span>
            </button>
            <p className="ml-[23px] text-[11.5px] text-muted-foreground">{ayuda}</p>
            {abierto && <div className="mt-2 rounded-[10px] border border-border divide-y divide-border">{children}</div>}
        </section>
    );
}

function FilaSimple({ f, accion, elegida, alElegir }: { f: Identificado; accion?: React.ReactNode; elegida?: boolean; alElegir?: () => void }) {
    const fab = f.clasificacion.fabricante ? FABRICANTES[f.clasificacion.fabricante]?.rotulo : null;
    const abajo = [fab, f.snmp?.nombre || f.nombreDns, f.ficha?.modelo || (f.snmp?.descr ? f.snmp.descr.slice(0, 60) : null), f.puertos.map((p) => PUERTO_ROTULO[p] || p).join(" · ")].filter(Boolean).join(" · ");
    return (
        <div className="flex items-center gap-3 px-3.5 py-2.5">
            {alElegir && (
                <button type="button" role="checkbox" aria-checked={!!elegida} onClick={alElegir} aria-label={`Elegir ${f.ip}`}
                    className={cn("h-[18px] w-[18px] shrink-0 rounded-[5px] border grid place-items-center", elegida ? "border-[var(--accion)] bg-[var(--accion)] text-white" : "border-border")}>{elegida && <Check size={13} strokeWidth={3} />}</button>
            )}
            {f.equipo ? <IconoTipo tipo={f.equipo.tipo} size={15} /> : <IconoCategoria c={f.clasificacion.categoria} size={15} />}
            <span className="w-[104px] shrink-0 text-[13px] font-bold tabular-nums">{f.ip}</span>
            <div className="min-w-0 flex-1">
                <p className={cn("text-[12.5px] font-semibold truncate", f.equipo && "tono-bien")}>{f.equipo ? f.equipo.nombre : CATEGORIAS[f.clasificacion.categoria].rotulo}</p>
                <p className="text-[11.5px] text-muted-foreground truncate">{abajo || "sin puertos conocidos abiertos"}</p>
            </div>
            {accion}
        </div>
    );
}

/* ═══════════════════════ Paso 4: listo ═══════════════════════ */

function PasoListo({ altas, fallados, filas, importados, alAbrirEquipo, alImportar }: { altas: Alta[]; fallados: { ip: string; motivo: string }[]; filas: Identificado[]; importados: string[]; alAbrirEquipo?: (id: string) => void; alImportar: (a: Alta) => void }) {
    const nvrs = altas.filter((a) => a.tipo === "NVR");
    return (
        <div className="space-y-5">
            <div className="rounded-[10px] border border-border bg-card p-4">
                <p className="flex items-center gap-2 text-[14px] font-bold"><Check size={16} className="tono-bien" /> {altas.length} {altas.length === 1 ? "equipo dado de alta" : "equipos dados de alta"}</p>
                {fallados.length > 0 && <p className="mt-1 text-[12px] tono-aviso">{fallados.length} quedaron afuera: {fallados.map((x) => `${x.ip ? `${x.ip}: ` : ""}${x.motivo}`).join(" · ")}</p>}
            </div>
            {nvrs.map((a) => {
                const f = filas.find((x) => x.ip === a.ip);
                return (
                    <div key={a.id} className="rounded-[10px] border border-[var(--accion)]/40 bg-[color-mix(in_oklab,var(--accion)_5%,transparent)] p-4">
                        <p className="flex items-center gap-2 text-[13.5px] font-bold"><HardDrive size={15} className="text-[var(--accion)]" /> {a.nombre} es un grabador</p>
                        <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                            {f?.canales ? `Tiene ${f.canales.total} canales, ${f.canales.conCamara} con cámara. ` : ""}¿Importamos sus canales como cámaras y vinculamos sus grabaciones? Se elige qué es cada una (LPR, intrusión) y su área, con su imagen al lado.
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                            {importados.includes(a.id)
                                ? <><span className="inline-flex items-center gap-1 rounded-full chip-bien px-2 py-0.5 text-[11.5px] font-bold"><Check size={12} /> Canales importados</span><Button size="sm" variant="outline" onClick={() => alImportar(a)}>Revisar de nuevo</Button></>
                                : <Button size="sm" onClick={() => alImportar(a)}><Monitor size={14} /> Importar sus canales</Button>}
                        </div>
                    </div>
                );
            })}
            <div className="rounded-[10px] border border-border divide-y divide-border">
                {altas.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5">
                        <IconoTipo tipo={a.tipo} size={15} />
                        <span className="w-[104px] shrink-0 text-[13px] font-bold tabular-nums">{a.ip}</span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{a.nombre}</span>
                        {alAbrirEquipo && <Button size="sm" variant="outline" onClick={() => alAbrirEquipo(a.id)}>Abrir</Button>}
                    </div>
                ))}
            </div>
        </div>
    );
}
