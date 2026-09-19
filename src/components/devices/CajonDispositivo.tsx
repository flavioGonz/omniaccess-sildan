"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
    ArrowLeft, ArrowRight, BadgeCheck, BookOpen, Check, ChevronDown, ChevronsUpDown,
    Cpu, ExternalLink, KeyRound, Loader2, MapPin, Network, Plus, Save, Tag, Video, Wifi,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Cajon, CajonDisparador, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { PasoAnimado } from "@/components/devices/Pasos";
import { CompatibilidadMarca, ElegirMarca } from "@/components/devices/Compatibilidad";
import { TIPOS_DE_EQUIPO, tipoDeEquipo } from "@/components/devices/tipos";
import { createDevice, updateDevice, probeDeviceInfo, getDevices } from "@/app/actions/devices";
import { getNvrChannels, getNvrChannelMap, saveNvrChannelMap } from "@/app/actions/nvr";
import { DRIVER_MODELS, type DeviceBrand as DriverDeviceBrand } from "@/lib/driver-models";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * Alta y edición de un equipo.
 *
 * Venía de un diálogo de 6xl partido en dos: a la izquierda el formulario por fases y a la
 * derecha un número de 200px flotando sobre una foto de fondo. Ese 36% de la ventana no
 * decía nada que el formulario no dijera mejor.
 *
 * Tres cambios de fondo, y ninguno es estético.
 *
 * **Lo primero que se pregunta es QUÉ se va a agregar.** Antes el tipo era un desplegable
 * en el medio del primer paso, al lado de la marca, como si fuera un dato más. Pero el
 * tipo decide todo lo que viene después —cuántos pasos hay, qué campos tienen sentido, si
 * se pregunta el sentido de paso, si hay canal de video—, así que preguntarlo tarde
 * significa haber preguntado antes cosas que quizá no correspondían.
 *
 * **La IP y las credenciales van juntas.** Estaban en dos pasos distintos, y el botón
 * "Detectar por ISAPI" —que necesita las tres cosas— vivía en el segundo. Había que
 * cargar la IP, avanzar, cargar usuario y clave, detectar, y volver para ver la MAC que
 * la detección acababa de completar. Ahora la detección está donde están sus datos.
 *
 * **El vocabulario.** "Fase 01", "Sincronizar Nodo", "Usuario Manager", "API Password",
 * "Hardware ID", "Sentido del Flujo", "Finalizar y Vincular". Quien instala una cámara
 * busca "usuario" y "contraseña"; ese lenguaje no hacía al sistema más serio, hacía al
 * instalador más lento.
 */

/** Cómo se prepara cada marca del lado del equipo, antes de que OmniAccess pueda usarlo. */
const GUIAS: Record<string, { titulo: string; pasos: string[]; webhook: string; auth: string; doc?: string }> = {
    HIKVISION: {
        titulo: "Cómo preparar una Hikvision",
        pasos: [
            "Entrar a la cámara por su IP desde el navegador",
            "Configuration → Network → Advanced Settings → HTTP Listening",
            "Agregar un listener con la IP del servidor OmniAccess y el puerto del webhook",
            "Event → Smart Event: activar la detección que haga falta (LPR o rostro)",
            "Configurar la notificación HTTP apuntando al listener recién creado",
            "Verificar en Events que los eventos se disparan",
        ],
        webhook: "/api/webhooks/hikvision",
        auth: "Digest, con el usuario y la clave del equipo",
        doc: "https://www.hikvision.com/en/support/download/sdk/",
    },
    AKUVOX: {
        titulo: "Cómo preparar un Akuvox",
        pasos: [
            "Entrar al portero por su IP desde el navegador",
            "Intercom → Relay → HTTP Notification",
            "Cargar la URL del webhook de OmniAccess",
            "En Access Control, cargar las tarjetas RFID o el reconocimiento facial",
            "Activar el envío de eventos por HTTP POST",
            "Probar con una notificación de prueba",
        ],
        webhook: "/api/webhooks/akuvox",
        auth: "Basic o API key, según el modelo",
    },
    DAHUA: {
        titulo: "Cómo preparar una Dahua",
        pasos: [
            "Entrar a la cámara por su IP desde el navegador",
            "Configuración → Red → Plataformas de acceso",
            "Habilitar HTTP y cargar la URL del webhook",
            "Evento → Detección inteligente: activar LPR o detección facial",
            "Configurar que mande la foto junto con el evento",
            "Verificar que los eventos llegan a OmniAccess",
        ],
        webhook: "/api/webhooks/dahua",
        auth: "Digest, con el usuario admin del equipo",
    },
    INTELBRAS: {
        titulo: "Cómo preparar una Intelbras",
        pasos: [
            "Entrar a la cámara por su IP desde el navegador",
            "Configuração → Rede → HTTP",
            "Cargar la URL del webhook de OmniAccess",
            "Evento → Detecção inteligente: activar LPR o detección facial",
            "Configurar que mande la foto junto con el evento",
            "Verificar que los eventos llegan a OmniAccess",
        ],
        webhook: "/api/webhooks/dahua",
        auth: "Habla el protocolo Dahua. Digest, con las credenciales del equipo",
    },
    BOSCH: {
        titulo: "Cómo preparar una Bosch de conteo",
        pasos: [
            "Entrar al panel de la cámara por HTTPS y loguearse como service",
            "General → ONVIF: habilitarlo y crear un usuario ONVIF con rol Operator",
            "Alarm → VCA: configurar el perfil y dibujar la zona de aforo y las líneas de entrada y salida",
            "Activar el contador de ocupación y los de cruce de línea",
            "Cargar acá la IP y el usuario ONVIF: el servidor lee los metadatos solo, sin webhook",
            "Verificar que el RTSP de la cámara se ve desde el servidor",
            "Confirmar en Filas que llegan el aforo y los cruces",
        ],
        webhook: "ONVIF Profile M — lee los metadatos, no necesita webhook",
        auth: "El usuario ONVIF, que no es el admin del panel web",
    },
};

/** Cómo se llama cada hoja. Reemplaza a la barra de pasos: dice dónde se está, sin
 *  agregar una interfaz aparte que después hay que mirar. */
const TITULOS: Record<string, string> = {
    que: "¿Qué vas a agregar?",
    marca: "¿De qué fabricante es?",
    cual: "¿Cuál es exactamente?",
    conexion: "¿Cómo se llega al equipo?",
    lugar: "¿Dónde está y quién pasa?",
    video: "El canal de video",
    canales: "Los canales del grabador",
};

export function CajonDispositivo({ device, groups, onSuccess, children }: {
    device?: any;
    groups: any[];
    onSuccess: () => void;
    children: React.ReactNode;
}) {
    const esEdicion = !!device;
    const [abierto, setAbierto] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [paso, setPaso] = useState(0);
    const [hacia, setHacia] = useState(1);
    const [verGuia, setVerGuia] = useState(false);
    const [abreModelos, setAbreModelos] = useState(false);

    const enBlanco = useCallback(() => ({
        name: device?.name || "",
        deviceType: device?.deviceType || "",
        brand: device?.brand || "HIKVISION",
        deviceModel: device?.deviceModel || "",
        ip: device?.ip || "",
        mac: device?.mac || "",
        location: device?.location || "",
        direction: device?.direction || "ENTRY",
        username: device?.username || "admin",
        password: device?.password || "",
        authType: device?.authType || "BASIC",
        rtspUrl: device?.rtspUrl || "",
        trackScene: device?.trackScene != null ? String(device.trackScene) : "",
        trackEnabled: device?.trackEnabled === false ? "false" : "true",
        /**
         * El grupo de acceso.
         *
         * Esto es lo que FALTABA. `createDevice` lee `groupId` del formulario desde
         * siempre, y el diálogo recibía la lista de grupos como prop y no la usaba en
         * ninguna parte: ni un selector, ni un campo oculto. Todo equipo dado de alta
         * quedaba sin ningún grupo, y el grupo es lo que decide quién puede pasar por ahí.
         * Había que ir a Grupos de Acceso y agregarlo a mano, sin que nada lo dijera.
         */
        groupId: device?.accessGroups?.[0]?.id || "none",
    }), [device]);

    const [f, setF] = useState(enBlanco());

    // ── Detección por ISAPI
    const [detectando, setDetectando] = useState(false);
    const [detectado, setDetectado] = useState<any>(null);

    // ── Prueba del RTSP
    const [probando, setProbando] = useState(false);
    const [prueba, setPrueba] = useState<any>(null);

    // ── Canales del grabador
    const [nvrCamaras, setNvrCamaras] = useState<any[]>([]);
    const [nvrMapa, setNvrMapa] = useState<Record<string, number>>({});
    const [nvrCanales, setNvrCanales] = useState<any[]>([]);
    const [nvrOcupado, setNvrOcupado] = useState(false);
    const [nvrAviso, setNvrAviso] = useState("");

    const tipo = tipoDeEquipo(f.deviceType);

    /**
     * Qué pasos hay, según el tipo.
     *
     * El primero —elegir qué es— sólo existe al dar de alta: editando ya se sabe qué es, y
     * cambiarle el tipo a un equipo que ya está en producción no es una edición, es otra
     * cosa. Los últimos dos son de un tipo cada uno y no aparecen para el resto.
     */
    const pasos = useMemo(() => {
        const l: { clave: string; rotulo: string }[] = [];
        if (!esEdicion) l.push({ clave: "que", rotulo: "Qué es" });
        l.push({ clave: "marca", rotulo: "Fabricante" });
        l.push({ clave: "cual", rotulo: "Cuál es" });
        l.push({ clave: "conexion", rotulo: "Cómo se llega" });
        l.push({ clave: "lugar", rotulo: "Dónde está" });
        if (f.deviceType === "LPR_INTERIOR") l.push({ clave: "video", rotulo: "Canal de video" });
        if (f.deviceType === "NVR") l.push({ clave: "canales", rotulo: "Canales" });
        return l;
    }, [esEdicion, f.deviceType]);

    const clave = pasos[Math.min(paso, pasos.length - 1)]?.clave || "cual";
    const ultimo = paso >= pasos.length - 1;

    /* Si el tipo cambia y quedan menos pasos que antes, el índice puede apuntar afuera. */
    useEffect(() => { if (paso > pasos.length - 1) setPaso(pasos.length - 1); }, [pasos.length, paso]);

    useEffect(() => {
        if (!abierto) return;
        setF(enBlanco());
        setPaso(0); setHacia(1);
        setDetectado(null); setPrueba(null);
        setNvrCanales([]); setNvrAviso("");
        setGuardando(false);
    }, [abierto, enBlanco]);

    /* Los datos del grabador se piden recién cuando hace falta: son dos consultas que para
       una cámara común no tienen ningún sentido. */
    useEffect(() => {
        if (!abierto || f.deviceType !== "NVR") return;
        (async () => {
            try {
                const [devs, mapa] = await Promise.all([getDevices(), getNvrChannelMap()]);
                setNvrCamaras((devs || []).filter((d: any) => d.deviceType === "LPR_CAMERA"));
                setNvrMapa(mapa || {});
            } catch { /* la pantalla sigue siendo utilizable sin esto */ }
        })();
    }, [abierto, f.deviceType]);

    const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
    const ir = (i: number) => { setHacia(i > paso ? 1 : -1); setPaso(i); };

    const detectar = async () => {
        setDetectando(true); setDetectado(null);
        try {
            const r: any = await probeDeviceInfo({
                ip: f.ip, username: f.username, password: f.password,
                authType: f.authType, brand: f.brand,
            });
            setDetectado(r);
            if (r?.ok) {
                /* Sólo completa lo que está vacío: si alguien escribió un nombre a mano, el
                   equipo no tiene por qué pisárselo con el suyo de fábrica. */
                setF((p) => ({
                    ...p,
                    mac: p.mac || r.macAddress || "",
                    deviceModel: p.deviceModel || r.model || "",
                    name: p.name || r.deviceName || r.model || "",
                }));
            }
        } catch (e: any) {
            setDetectado({ ok: false, error: e?.message || "No se pudo conectar" });
        } finally { setDetectando(false); }
    };

    const escanearCanales = async () => {
        setNvrOcupado(true); setNvrAviso("");
        try {
            const r: any = await getNvrChannels({ ip: f.ip, username: f.username, password: f.password, authType: f.authType });
            if (r?.ok && r.channels?.length) {
                setNvrCanales(r.channels);
                setNvrMapa((prev) => {
                    const m = { ...prev };
                    for (const ch of r.channels) if (ch.ip) m[ch.ip] = m[ch.ip] ?? ch.channel;
                    return m;
                });
                setNvrAviso(`${r.channels.length} canales leídos del grabador`);
            } else setNvrAviso(r?.error || "El grabador no devolvió ningún canal");
        } catch (e: any) { setNvrAviso(e?.message || "No se pudo leer el grabador"); }
        finally { setNvrOcupado(false); }
    };

    const guardarMapa = async () => {
        setNvrOcupado(true);
        try {
            const r: any = await saveNvrChannelMap(nvrMapa);
            setNvrAviso(r?.ok ? "Mapeo guardado" : "No se pudo guardar el mapeo");
        } catch { setNvrAviso("No se pudo guardar el mapeo"); }
        finally { setNvrOcupado(false); }
    };

    const crearCamaraDeCanal = async (ch: any) => {
        setNvrOcupado(true);
        try {
            const fd = new FormData();
            fd.set("name", ch.name || `Cámara ${ch.ip}`);
            fd.set("ip", ch.ip);
            fd.set("brand", "HIKVISION");
            fd.set("deviceType", "LPR_CAMERA");
            fd.set("direction", /salida|egres/i.test(ch.name || "") ? "EXIT" : "ENTRY");
            fd.set("location", "");
            fd.set("username", f.username || "admin");
            fd.set("password", f.password || "");
            fd.set("authType", "DIGEST");
            fd.set("mac", "");
            fd.set("groupId", "none");
            await createDevice(fd);
            const devs: any = await getDevices();
            setNvrCamaras((devs || []).filter((d: any) => d.deviceType === "LPR_CAMERA"));
            setNvrMapa((prev) => ({ ...prev, [ch.ip]: ch.channel }));
            setNvrAviso(`Cámara creada: ${ch.name || ch.ip}`);
        } catch (e: any) {
            setNvrAviso("No se pudo crear: " + (e?.message || ""));
        } finally { setNvrOcupado(false); }
    };

    const probarRtsp = async () => {
        if (!f.rtspUrl.trim()) return;
        setProbando(true); setPrueba(null);
        try {
            const r = await fetch("/api/tracking/probe", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rtsp: f.rtspUrl.trim() }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || "No se pudo probar");
            setPrueba(j);
        } catch (e: any) {
            setPrueba({ error: e?.message || "No se pudo probar la cámara" });
        } finally { setProbando(false); }
    };

    const guardar = async () => {
        if (!f.deviceType) { toast.error({ title: "Falta decir qué equipo es" }); return; }
        if (!f.name.trim()) { toast.error({ title: "Falta el nombre", description: "Es como va a figurar en las listas y en el historial." }); return; }
        setGuardando(true);
        const datos = new FormData();
        Object.entries(f).forEach(([k, v]) => datos.append(k, v as string));
        try {
            if (esEdicion) await updateDevice(device.id, datos);
            else await createDevice(datos);
            toast.success({ title: esEdicion ? "Equipo guardado" : "Equipo dado de alta" });
            setAbierto(false);
            onSuccess();
        } catch (e: any) {
            /* Antes esto era un console.error y nada más: el equipo no se guardaba, el
               diálogo quedaba abierto igual y no había una sola señal de por qué. */
            toast.error({ title: "No se pudo guardar", description: e?.message });
        } finally { setGuardando(false); }
    };

    const guia = GUIAS[f.brand];

    return (
        <Cajon open={abierto} onOpenChange={setAbierto}>
            <CajonDisparador asChild>{children}</CajonDisparador>

            <CajonContenido
                ancho="angosto"
                /* El título dice en qué paso se está. Al sacar la barra, el encabezado es
                   lo único que ubica: si dijera siempre "Nuevo equipo", pasar de hoja no
                   se distinguiría de que la pantalla se quedó. */
                titulo={TITULOS[clave] || (esEdicion ? f.name || "Equipo" : "Nuevo equipo")}
                descripcion={
                    clave === "que" ? "Lo primero, porque de esto depende todo lo demás."
                        : [tipo?.rotulo, esEdicion ? f.name : null].filter(Boolean).join(" · ")
                        || "Cargá los datos y seguí."
                }
                /* Sin barra de pasos con números ni nombres: esto se lee como una hoja que
                   pasa, y lo único que hace falta es saber cuánto queda. Una línea que
                   avanza lo dice sin agregar una interfaz que después hay que mirar. */
                encabezado={
                    <div className="h-0.5 bg-border/60 overflow-hidden">
                        <motion.div className="h-full bg-[var(--accion)]"
                            initial={false}
                            animate={{ width: `${((paso + 1) / pasos.length) * 100}%` }}
                            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }} />
                    </div>
                }
                pie={
                    <>
                        {paso > 0 && (
                            <Button type="button" variant="ghost" onClick={() => ir(paso - 1)}>
                                <ArrowLeft size={15} /> Atrás
                            </Button>
                        )}
                        <div className="flex-1" />
                        {!ultimo ? (
                            <Button type="button" onClick={() => ir(paso + 1)}
                                /* Sin tipo elegido no hay nada que preguntar después: todo lo
                                   que viene depende de qué clase de equipo es. */
                                disabled={clave === "que" && !f.deviceType}>
                                Siguiente <ArrowRight size={15} />
                            </Button>
                        ) : (
                            <Button type="button" onClick={guardar} disabled={guardando}>
                                {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                {guardando ? "Guardando…" : esEdicion ? "Guardar cambios" : "Dar de alta"}
                            </Button>
                        )}
                    </>
                }>

                <PasoAnimado clave={clave} hacia={hacia}>
                    {clave === "que" && (
                        <CajonSeccion titulo="Qué vas a agregar"
                            ayuda="Lo primero, porque de esto depende todo lo demás: cuántos pasos hay, qué datos hacen falta y a qué circuito entra el equipo.">
                            <div className="grid grid-cols-1 gap-2">
                                {TIPOS_DE_EQUIPO.map((t) => {
                                    const puesto = f.deviceType === t.valor;
                                    return (
                                        <button key={t.valor} type="button"
                                            onClick={() => { set("deviceType", t.valor); setHacia(1); setPaso(paso + 1); }}
                                            className={cn(
                                                "text-left p-3.5 rounded-[10px] border transition-colors flex gap-3",
                                                puesto ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]"
                                                    : "border-border bg-card/40 hover:bg-accent",
                                            )}>
                                            <span className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                                                puesto ? "text-[var(--accion)]" : "text-muted-foreground bg-muted")}>
                                                <t.icono size={18} />
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-[13.5px] font-semibold text-foreground">{t.rotulo}</span>
                                                <span className="block text-[11.5px] text-muted-foreground leading-snug mt-0.5">{t.que}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </CajonSeccion>
                    )}

                    {clave === "marca" && (
                        <CajonSeccion titulo="De qué fabricante es" icono={Tag}
                            ayuda="No todas las marcas están al mismo nivel. Cada una habla por su propio driver, y algunos todavía no están escritos: acá se dice cuál es cuál antes de cargar nada.">
                            <ElegirMarca valor={f.brand} alElegir={(v) => set("brand", v)} />
                            <CompatibilidadMarca marca={f.brand} tipo={f.deviceType}
                                rotuloTipo={tipo?.rotulo || "equipo"} />
                        </CajonSeccion>
                    )}

                    {clave === "cual" && (
                        <>
                            <CajonSeccion titulo="Cuál es" icono={Cpu}>
                                <CajonCampo etiqueta="Cómo se lo va a llamar"
                                    pista="Es el nombre que sale en el historial, en el mapa y en los avisos. Conviene el del lugar donde está puesto — 'Portón principal' dice más que el modelo.">
                                    <Input value={f.name} placeholder="Portón principal, Calle 21…" autoFocus
                                        onChange={(e) => set("name", e.target.value)} />
                                </CajonCampo>
                                <div className="grid grid-cols-1 gap-4">
                                    <CajonCampo etiqueta="Modelo"
                                        pista="Decide qué controlador usa OmniAccess para hablarle. Si no está en la lista, se puede dejar vacío y probar igual: la detección de abajo suele completarlo.">
                                        <Popover open={abreModelos} onOpenChange={setAbreModelos}>
                                            <PopoverTrigger asChild>
                                                <Button type="button" variant="outline" className="w-full justify-between font-normal">
                                                    <span className="truncate">
                                                        {f.deviceModel
                                                            ? (DRIVER_MODELS[f.brand as DriverDeviceBrand]?.find((m) => m.value === f.deviceModel)?.label || f.deviceModel)
                                                            : "Elegir modelo…"}
                                                    </span>
                                                    <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-[360px] p-0" align="start">
                                                <Command>
                                                    <CommandInput placeholder="Buscar modelo…" />
                                                    <CommandEmpty>No hay modelos cargados para esta marca.</CommandEmpty>
                                                    <CommandGroup className="max-h-60 overflow-y-auto">
                                                        {DRIVER_MODELS[f.brand as DriverDeviceBrand]?.map((m) => (
                                                            <CommandItem key={m.value} value={m.value}
                                                                onSelect={(v) => { set("deviceModel", v); setAbreModelos(false); }}>
                                                                <span className="flex flex-col">
                                                                    <span className="text-[12.5px] font-semibold text-foreground">{m.label}</span>
                                                                    <span className="text-[11px] text-muted-foreground">{m.category}</span>
                                                                </span>
                                                                {f.deviceModel === m.value && <Check size={14} className="ml-auto text-[var(--accion)]" />}
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                </Command>
                                            </PopoverContent>
                                        </Popover>
                                    </CajonCampo>
                                </div>
                            </CajonSeccion>

                            {guia && (
                                <CajonSeccion titulo="Del lado del equipo" icono={BookOpen}
                                    ayuda="Esto no se hace acá: se hace entrando al equipo por su IP. Si no está configurado así, OmniAccess lo va a ver pero no va a recibir sus eventos.">
                                    <button type="button" onClick={() => setVerGuia(!verGuia)}
                                        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-[10px] border border-border bg-card/40 hover:bg-accent transition-colors">
                                        <span className="text-[12.5px] font-semibold text-foreground">{guia.titulo}</span>
                                        <ChevronDown size={15} className={cn("text-muted-foreground transition-transform duration-200", verGuia && "rotate-180")} />
                                    </button>
                                    <AnimatePresence initial={false}>
                                        {verGuia && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                                                className="overflow-hidden">
                                                <ol className="space-y-2 pt-3.5">
                                                    {guia.pasos.map((s, i) => (
                                                        <li key={i} className="flex gap-2.5">
                                                            <span className="w-[19px] h-[19px] rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center shrink-0 mt-px">{i + 1}</span>
                                                            <span className="text-[12px] text-muted-foreground leading-relaxed">{s}</span>
                                                        </li>
                                                    ))}
                                                </ol>
                                                <div className="mt-3.5 pt-3 border-t border-border space-y-1.5">
                                                    <p className="text-[12px] text-muted-foreground">
                                                        A dónde manda los eventos: <code className="text-foreground tabular-nums">{guia.webhook}</code>
                                                    </p>
                                                    <p className="text-[12px] text-muted-foreground">Cómo se autentica: {guia.auth}</p>
                                                    {guia.doc && (
                                                        <a href={guia.doc} target="_blank" rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--accion)] hover:underline">
                                                            <ExternalLink size={12} /> Documentación del fabricante
                                                        </a>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </CajonSeccion>
                            )}
                        </>
                    )}

                    {clave === "conexion" && (
                        <CajonSeccion titulo="Cómo se llega al equipo" icono={Wifi}
                            ayuda="La IP y las credenciales van juntas porque la detección las necesita a las tres. Antes estaban en pasos separados y había que ir y volver para ver lo que la detección completaba.">
                            <div className="grid grid-cols-1 gap-4">
                                <CajonCampo etiqueta="Dirección IP"
                                    pista="La del equipo en la red del barrio. Tiene que ser alcanzable desde el servidor: si está en otra red o detrás de un router, hay que mapearle el puerto.">
                                    <Input value={f.ip} placeholder="172.26.20.21" className="tabular-nums"
                                        onChange={(e) => set("ip", e.target.value)} />
                                </CajonCampo>
                                <CajonCampo etiqueta="MAC"
                                    pista="La completa la detección sola. Sirve para reconocer el equipo aunque le cambien la IP.">
                                    <Input value={f.mac} placeholder="La completa la detección" className="tabular-nums uppercase"
                                        onChange={(e) => set("mac", e.target.value)} />
                                </CajonCampo>
                                <CajonCampo etiqueta="Usuario">
                                    <Input value={f.username} onChange={(e) => set("username", e.target.value)} />
                                </CajonCampo>
                                <CajonCampo etiqueta="Contraseña">
                                    <PasswordInput value={f.password} onChange={(e) => set("password", e.target.value)} />
                                </CajonCampo>
                                <CajonCampo etiqueta="Cómo se autentica" 
                                    pista="Hikvision y Dahua usan Digest. Si con uno no conecta, probá el otro: la detección de abajo lo dice en el acto.">
                                    <Select value={f.authType} onValueChange={(v) => set("authType", v)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="BASIC">Basic</SelectItem>
                                            <SelectItem value="DIGEST">Digest</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </CajonCampo>
                            </div>

                            <div>
                                <Button type="button" variant="outline" className="w-full"
                                    onClick={detectar} disabled={detectando || !f.ip}>
                                    {detectando ? <Loader2 size={15} className="animate-spin" /> : <Cpu size={15} />}
                                    {detectando ? "Preguntándole al equipo…" : "Probar la conexión y leer sus datos"}
                                </Button>
                                <AnimatePresence initial={false}>
                                    {detectado && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                                            transition={{ duration: 0.2 }}
                                            className={cn("mt-2.5 rounded-[10px] border p-3.5",
                                                detectado.ok ? "border-[var(--bien)]/35 bg-[var(--bien-suave)]"
                                                    : "border-[var(--mal)]/35 bg-[var(--mal-suave)]")}>
                                            {detectado.ok ? (
                                                <>
                                                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--bien-texto)]">
                                                        <BadgeCheck size={14} /> El equipo contestó
                                                    </p>
                                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-[12px] text-muted-foreground">
                                                        <span>Modelo: <b className="text-foreground">{detectado.model || "—"}</b></span>
                                                        <span>Firmware: <b className="text-foreground">{detectado.firmwareVersion || "—"}</b></span>
                                                        <span>MAC: <b className="text-foreground tabular-nums">{detectado.macAddress || "—"}</b></span>
                                                        <span>Serie: <b className="text-foreground tabular-nums">{detectado.serialNumber || "—"}</b></span>
                                                    </div>
                                                </>
                                            ) : (
                                                <p className="text-[12.5px] text-[var(--mal-texto)]">
                                                    {detectado.error || "No contestó. Revisá la IP, el usuario y la forma de autenticarse."}
                                                </p>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </CajonSeccion>
                    )}

                    {clave === "lugar" && (
                        <CajonSeccion titulo="Dónde está y quién pasa" icono={MapPin}>
                            <CajonCampo etiqueta="En qué lugar del barrio"
                                pista="En palabras, como lo diría un guardia por radio. Para ubicarlo en el plano hay una pantalla aparte.">
                                <Input value={f.location} placeholder="Portón de entrada, esquina de Calle 21…"
                                    onChange={(e) => set("location", e.target.value)} />
                            </CajonCampo>
                            {/*
                              * El grupo de acceso: lo que faltaba.
                              *
                              * `createDevice` lee `groupId` del formulario desde siempre, y el
                              * diálogo recibía la lista de grupos como prop sin usarla nunca. Todo
                              * equipo nuevo quedaba sin grupo —o sea, sin nadie autorizado a pasar—
                              * y había que ir a Grupos de Acceso a arreglarlo, sin una sola señal.
                              *
                              * Sólo se elige AL DAR DE ALTA. `updateDevice` no toca los grupos, así
                              * que un selector acá al editar dejaría cambiar algo que no se guarda,
                              * que es peor que no ofrecerlo: al editar se muestra el que tiene y
                              * dónde se cambia de verdad.
                              */}
                            {esEdicion ? (
                                <CajonCampo etiqueta="Quiénes pueden pasar por acá"
                                    ayuda="Los grupos de un equipo ya cargado se cambian en Grupos de Acceso.">
                                    <div className="flex flex-wrap gap-1.5 min-h-9 items-center">
                                        {device?.accessGroups?.length ? device.accessGroups.map((g: any) => (
                                            <span key={g.id} className="px-2.5 py-1 rounded-full border border-border text-[12px] text-muted-foreground">
                                                {g.name}
                                            </span>
                                        )) : (
                                            <span className="text-[12.5px] text-[var(--aviso-texto)]">
                                                Sin ningún grupo: hoy no deja pasar a nadie.
                                            </span>
                                        )}
                                    </div>
                                </CajonCampo>
                            ) : (
                                <CajonCampo etiqueta="Quiénes pueden pasar por acá"
                                    pista="El grupo de acceso decide qué personas tienen permiso en este equipo y en qué horarios. Sin grupo, el equipo queda cargado pero no deja pasar a nadie.">
                                    <Select value={f.groupId} onValueChange={(v) => set("groupId", v)}>
                                        <SelectTrigger><SelectValue placeholder="Elegir…" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Ninguno por ahora</SelectItem>
                                            {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </CajonCampo>
                            )}
                            {tipo?.sentido && (
                                <CajonCampo etiqueta="Por dónde pasa la gente acá"
                                    pista="Decide si lo que lea este equipo cuenta como una entrada o como una salida, y de ahí sale quién está adentro del barrio.">
                                    <Select value={f.direction} onValueChange={(v) => set("direction", v)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ENTRY">Entra</SelectItem>
                                            <SelectItem value="EXIT">Sale</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </CajonCampo>
                            )}
                        </CajonSeccion>
                    )}

                    {clave === "video" && (
                        <>
                            <CajonSeccion titulo="Qué hace esta cámara" icono={Video}
                                ayuda="No abre la barrera. La pasarela le saca cuadros por RTSP y se los manda al lector, que saca la matrícula; con eso se dibuja por dónde anduvo cada vehículo adentro del barrio. El control de acceso lo siguen haciendo las cámaras de entrada y salida.">
                                <CajonCampo etiqueta="URL del canal RTSP"
                                    pista="Usá siempre el flujo principal. El secundario no tiene resolución para leer una matrícula, y la cámara va a parecer que no funciona cuando en realidad está mandando una imagen que no alcanza.">
                                    <div className="flex gap-2">
                                        <Input value={f.rtspUrl} className="font-mono text-[12px]"
                                            placeholder="rtsp://usuario:clave@172.26.20.21:554/Streaming/Channels/101"
                                            onChange={(e) => set("rtspUrl", e.target.value)} />
                                        <Button type="button" variant="outline" className="shrink-0"
                                            onClick={probarRtsp} disabled={probando || !f.rtspUrl.trim()}>
                                            {probando ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Probar
                                        </Button>
                                    </div>
                                </CajonCampo>

                                <div className="rounded-[10px] border border-border bg-card/40 p-3 space-y-1">
                                    <p className="text-[12px] text-muted-foreground"><b className="text-foreground/85">Hikvision</b> <span className="font-mono">…:554/Streaming/Channels/101</span> — 101 es el canal 1, 201 el 2, 301 el 3.</p>
                                    <p className="text-[12px] text-muted-foreground"><b className="text-foreground/85">Dahua</b> <span className="font-mono">…:554/cam/realmonitor?channel=1&amp;subtype=0</span></p>
                                    <p className="text-[12px] text-muted-foreground"><b className="text-foreground/85">ONVIF genérica</b> <span className="font-mono">…:554/onvif1</span></p>
                                </div>

                                <AnimatePresence initial={false}>
                                    {prueba && (
                                        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                                            transition={{ duration: 0.2 }}
                                            className="rounded-[10px] border border-border bg-card/60 p-3">
                                            {prueba.error ? (
                                                <p className="text-[12.5px] text-[var(--mal-texto)]">{prueba.error}</p>
                                            ) : (
                                                <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-4">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={prueba.imagen} alt="Cuadro de prueba" className="rounded-lg w-full object-cover border border-border" />
                                                    <div className="space-y-1.5">
                                                        <p className="text-[11.5px] text-muted-foreground tabular-nums">
                                                            Cuadro de {Math.round(prueba.bytes / 1024)} KB · capturar {prueba.msCaptura} ms · leer {prueba.msLectura} ms
                                                        </p>
                                                        {prueba.lecturas?.length ? prueba.lecturas.slice(0, 3).map((l: any, i: number) => (
                                                            <div key={i} className="flex items-center gap-2 text-[13px]">
                                                                <Check size={13} className={l.confidence >= prueba.umbral ? "text-[var(--bien)]" : "text-[var(--aviso)]"} />
                                                                <span className="font-bold tracking-[0.12em] tabular-nums text-foreground">{l.plate}</span>
                                                                <span className="text-muted-foreground tabular-nums">{Math.round(l.confidence * 100)}%</span>
                                                            </div>
                                                        )) : (
                                                            <p className="text-[12px] text-muted-foreground leading-relaxed">
                                                                La cámara contestó y el cuadro llegó bien. No se ve ninguna matrícula, que es
                                                                lo normal si en ese instante no pasaba un auto.
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </CajonSeccion>

                            <CajonSeccion titulo="Cuánto trabaja" icono={Cpu}>
                                <div className="grid grid-cols-1 gap-4">
                                    <CajonCampo etiqueta="Sensibilidad de escena"
                                        pista="Cuánto tiene que cambiar la imagen para que se mande un cuadro al lector. Más bajo, más cuadros y más GPU. Se termina de afinar en el calibrador, sobre un cuadro real.">
                                        <Input value={f.trackScene} placeholder="0.08" className="tabular-nums"
                                            onChange={(e) => set("trackScene", e.target.value)} />
                                    </CajonCampo>
                                    <CajonCampo etiqueta="Seguimiento"
                                        pista="Pausada queda cargada y con toda su configuración, pero no se le pide un solo cuadro. Sirve para sacarla de circulación sin borrarla.">
                                        <Select value={f.trackEnabled} onValueChange={(v) => set("trackEnabled", v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="true">Activo</SelectItem>
                                                <SelectItem value="false">Pausado</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </CajonCampo>
                                </div>
                            </CajonSeccion>
                        </>
                    )}

                    {clave === "canales" && (
                        <CajonSeccion titulo="Qué cámara es cada canal" icono={Network}
                            ayuda="El grabador numera sus canales; OmniAccess conoce las cámaras por su IP. Este mapeo une las dos cosas, y es lo que después permite ir de un evento a su grabación.">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] text-muted-foreground">
                                    {nvrCanales.length ? `${nvrCanales.length} canales leídos` : "Todavía no se leyó el grabador"}
                                </span>
                                <Button type="button" variant="outline" onClick={escanearCanales} disabled={nvrOcupado || !f.ip}>
                                    {nvrOcupado ? <Loader2 size={15} className="animate-spin" /> : <Cpu size={15} />} Leer canales
                                </Button>
                            </div>

                            {nvrCanales.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 rounded-[10px] border border-dashed border-border text-muted-foreground gap-2">
                                    <Network size={26} className="opacity-40" />
                                    <span className="text-[12.5px]">Tocá «Leer canales» para preguntarle al grabador qué tiene conectado.</span>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-2.5">
                                    {nvrCanales.map((ch: any) => {
                                        const asignada = nvrCamaras.find((c: any) => nvrMapa[c.ip] === ch.channel);
                                        const hayCamaraConEsaIp = ch.ip ? nvrCamaras.find((c: any) => c.ip === ch.ip) : null;
                                        return (
                                            <div key={ch.channel} className={cn("rounded-[10px] overflow-hidden border transition-colors",
                                                asignada ? "border-[var(--bien)]/50" : "border-border")}>
                                                <div className="relative aspect-video bg-black">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={`/api/nvr/snapshot?ch=${ch.channel}`} alt="" loading="lazy"
                                                        className="absolute inset-0 w-full h-full object-cover"
                                                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }} />
                                                    <span className="absolute top-1.5 left-1.5 min-w-6 h-6 px-1.5 rounded-md bg-black/75 border border-white/20 flex items-center justify-center text-white text-[12px] font-bold tabular-nums">
                                                        {ch.channel}
                                                    </span>
                                                    {asignada && (
                                                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-[var(--bien)] text-white text-[10px] font-bold flex items-center gap-1">
                                                            <BadgeCheck size={10} /> Asignado
                                                        </span>
                                                    )}
                                                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-6">
                                                        <span className="block text-[11px] font-semibold text-white truncate">{ch.name || `Canal ${ch.channel}`}</span>
                                                        <span className="block text-[10px] text-white/60 tabular-nums">{ch.ip || "sin IP"}</span>
                                                    </span>
                                                </div>
                                                <div className="p-2 space-y-1.5 bg-card/60">
                                                    <select
                                                        value={asignada ? asignada.id : ""}
                                                        onChange={(e) => {
                                                            const camId = e.target.value;
                                                            setNvrMapa((prev) => {
                                                                const m: Record<string, number> = { ...prev };
                                                                /* Un canal es de una sola cámara: al asignarlo hay que
                                                                   soltar la que lo tenía, o quedan dos apuntando al
                                                                   mismo lugar y la grabación sale de cualquiera. */
                                                                for (const k of Object.keys(m)) if (m[k] === ch.channel) delete m[k];
                                                                if (camId) {
                                                                    const cam = nvrCamaras.find((x: any) => x.id === camId);
                                                                    if (cam) m[cam.ip] = ch.channel;
                                                                }
                                                                return m;
                                                            });
                                                        }}
                                                        className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accion-foco)]">
                                                        <option value="">Sin asignar</option>
                                                        {nvrCamaras.map((c: any) => (
                                                            <option key={c.id} value={c.id}>{c.name} ({c.ip})</option>
                                                        ))}
                                                    </select>
                                                    {!hayCamaraConEsaIp && ch.ip && !asignada && (
                                                        <Button type="button" size="sm" className="w-full"
                                                            onClick={() => crearCamaraDeCanal(ch)} disabled={nvrOcupado}>
                                                            <Plus size={12} /> Crear la cámara
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] text-muted-foreground">{nvrAviso}</span>
                                <Button type="button" variant="outline" onClick={guardarMapa} disabled={nvrOcupado || !nvrCanales.length}>
                                    Guardar el mapeo
                                </Button>
                            </div>
                        </CajonSeccion>
                    )}
                </PasoAnimado>
            </CajonContenido>
        </Cajon>
    );
}
