"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, Loader2, Radio, RefreshCw, Video } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { montarVivo } from "@/lib/vivo";
import { probeDeviceInfo } from "@/app/actions/devices";
import { cn } from "@/lib/utils";

/**
 * El último paso: ir a buscar al equipo y mostrar lo que contestó.
 *
 * Todo lo anterior son cosas que alguien escribió: una IP, un usuario, una URL. Nada de
 * eso prueba que el equipo exista. Un alta que termina en "guardado" y nada más deja al
 * instalador con la sensación de haber terminado, y el equipo aparece en la lista como
 * cualquier otro — gris, sin eventos, y nadie sabe si está mal cargado, mal cableado o
 * apagado hasta que alguien lo reclama días después.
 *
 * Por eso esta hoja no resume: verifica. Le pregunta al equipo quién es y, si es una
 * cámara, le pide el video. Una imagen en movimiento no se puede discutir: o llega o no
 * llega, y si llega es la cámara que se acaba de cargar y no otra.
 *
 * Va DESPUÉS de guardar, no antes, y eso es a propósito. El video sale de go2rtc, y
 * go2rtc conoce el flujo recién cuando el equipo existe — se registra al darlo de alta.
 * Verificar antes de guardar obligaría a levantar un flujo provisorio que después hay que
 * limpiar, y el día que la limpieza falle queda un stream fantasma consumiendo ancho de
 * banda por una cámara que nunca se creó.
 */

type Lectura = {
    ok: boolean;
    model?: string; firmwareVersion?: string; macAddress?: string; serialNumber?: string;
    error?: string;
};

/** Un renglón de la lista de comprobaciones. */
function Punto({ estado, titulo, detalle }: {
    estado: "bien" | "mal" | "aviso" | "esperando";
    titulo: string;
    detalle?: string;
}) {
    const color = estado === "bien" ? "var(--bien)" : estado === "mal" ? "var(--mal)" : estado === "aviso" ? "var(--aviso)" : "var(--muted-foreground)";
    return (
        <div className="flex gap-2.5 items-start py-1.5">
            <span className="mt-[3px] shrink-0" style={{ color }}>
                {estado === "esperando" ? <Loader2 size={14} className="animate-spin" />
                    : estado === "bien" ? <BadgeCheck size={14} />
                        : <AlertTriangle size={14} />}
            </span>
            <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-foreground">{titulo}</span>
                {detalle && <span className="block text-[11.5px] text-muted-foreground leading-snug mt-0.5">{detalle}</span>}
            </span>
        </div>
    );
}

type Linea = { x1: number; y1: number; x2: number; y2: number; sentido?: string };
type Zona = { x: number; y: number; w: number; h: number };

const leerJson = <T,>(txt: string | null | undefined): T | null => {
    if (!txt) return null;
    try { return JSON.parse(String(txt)) as T; } catch { return null; }
};

/**
 * La línea y la zona dibujadas, encima del video en vivo.
 *
 * Están guardadas en fracciones del cuadro, así que sobre el video se dibujan igual sin
 * saber la resolución. Y hay que verlas ací: la línea decide CUÁNDO la cámara avisa, y
 * hasta ahora la única forma de saber dónde quedó era abrir el calibrador — sobre un
 * cuadro congelado, sin tránsito, que es justo cuando menos se nota si está mal puesta.
 * Con el vivo atrás se ve pasar un auto y cruzarla, que es la única comprobación que vale.
 *
 * El video va en `object-contain` y no `object-cover` por esto mismo: recortar la imagen
 * correría el dibujo respecto de lo que se ve, y el dibujo estaría mintiendo sobre dónde
 * está la línea.
 */
function Dibujo({ linea, zona }: { linea: Linea | null; zona: Zona | null }) {
    if (!linea && !zona) return null;
    const p = (n: number) => Math.max(0, Math.min(100, n * 100));
    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {zona && zona.w > 0 && zona.h > 0 && (
                <rect x={p(zona.x)} y={p(zona.y)} width={p(zona.w)} height={p(zona.h)}
                    fill="none" stroke="#38bdf8" strokeWidth={0.5} strokeDasharray="2 1.6"
                    vectorEffect="non-scaling-stroke" opacity={0.85} />
            )}
            {linea && (
                <>
                    {/* Dos trazos: uno oscuro y ancho abajo, el vivo arriba. Sobre una calle
                        clara una línea de un color solo desaparece. */}
                    <line x1={p(linea.x1)} y1={p(linea.y1)} x2={p(linea.x2)} y2={p(linea.y2)}
                        stroke="rgba(0,0,0,.55)" strokeWidth={4} strokeLinecap="round"
                        vectorEffect="non-scaling-stroke" />
                    <line x1={p(linea.x1)} y1={p(linea.y1)} x2={p(linea.x2)} y2={p(linea.y2)}
                        stroke="#f59e0b" strokeWidth={2} strokeLinecap="round"
                        vectorEffect="non-scaling-stroke" />
                    {[[linea.x1, linea.y1], [linea.x2, linea.y2]].map(([x, y], i) => (
                        <circle key={i} cx={p(x)} cy={p(y)} r={3.5} fill="#f59e0b"
                            stroke="rgba(0,0,0,.55)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    ))}
                </>
            )}
        </svg>
    );
}

/** El video en vivo del equipo, con lo que le hayan dibujado encima. */
function Vivo({ deviceId, linea, zona }: { deviceId: string; linea: Linea | null; zona: Zona | null }) {
    const ref = useRef<HTMLVideoElement>(null);
    const [anda, setAnda] = useState<boolean | null>(null);
    const [intento, setIntento] = useState(0);

    useEffect(() => {
        const v = ref.current;
        if (!v) return;
        setAnda(null);
        /* `playing` y no `loadeddata`: go2rtc contesta con la cabecera del mp4 antes de
           tener un solo cuadro, así que un evento de carga puede llegar con la pantalla
           todavía en negro y diríamos que anda cuando no se ve nada. */
        const bien = () => setAnda(true);
        const mal = () => setAnda((a) => (a === true ? a : false));
        v.addEventListener("playing", bien);
        v.addEventListener("error", mal);
        const cortar = montarVivo(v, deviceId);
        /* Si a los diez segundos no empezó, no empezó: go2rtc reintenta unas pocas veces
           y después se queda esperando en silencio, que en pantalla es una caja negra
           indistinguible de una cámara apuntando a una pared oscura. */
        const plazo = setTimeout(mal, 10000);
        return () => {
            clearTimeout(plazo);
            v.removeEventListener("playing", bien);
            v.removeEventListener("error", mal);
            cortar?.();
        };
    }, [deviceId, intento]);

    return (
        <div className="space-y-2">
            <div className="relative rounded-[10px] overflow-hidden border border-border bg-black aspect-video">
                <video ref={ref} muted autoPlay playsInline className="block w-full h-full object-contain" />
                {anda === true && <Dibujo linea={linea} zona={zona} />}
                {anda === null && (
                    <span className="absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-white/70">
                        <Loader2 size={14} className="animate-spin" /> Pidiendo el video…
                    </span>
                )}
                {anda === true && (
                    <span className="absolute top-2 left-2 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold flex items-center gap-1">
                            <Radio size={10} className="text-[var(--mal)]" /> EN VIVO
                        </span>
                        {linea && (
                            <span className="px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold flex items-center gap-1" style={{ color: "#f59e0b" }}>
                                <span className="w-2 h-0.5 rounded-full" style={{ background: "#f59e0b" }} /> línea de paso
                            </span>
                        )}
                        {zona && (
                            <span className="px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold flex items-center gap-1" style={{ color: "#38bdf8" }}>
                                <span className="w-2 h-0.5 rounded-full" style={{ background: "#38bdf8" }} /> zona
                            </span>
                        )}
                    </span>
                )}
                {anda === false && (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                        <Video size={22} className="text-white/40" />
                        <span className="text-[12px] text-white/70 leading-snug">
                            No llegó imagen. Puede ser el usuario y la clave, que el RTSP apunte al flujo
                            secundario, o que el equipo no sea alcanzable desde el servidor.
                        </span>
                        <Button type="button" variant="outline" size="sm" onClick={() => setIntento((n) => n + 1)}>
                            <RefreshCw size={13} /> Probar de nuevo
                        </Button>
                    </span>
                )}
            </div>
        </div>
    );
}

export function Verificacion({ deviceId, datos, tipo, faltantes, linea, zona }: {
    /** El equipo ya creado. Null mientras todavía no se guardó. */
    deviceId: string | null;
    datos: { name: string; ip: string; brand: string; username: string; password: string; authType: string; rtspUrl?: string };
    tipo?: { rotulo: string; vivo?: boolean } | null;
    /** Lo que quedó a medias y conviene decir antes de dar por terminado. */
    faltantes: { titulo: string; detalle: string }[];
    /** La línea de paso guardada, para dibujarla encima del vivo. */
    linea?: string | null;
    /** La zona de interés guardada. */
    zona?: string | null;
}) {
    const [lectura, setLectura] = useState<Lectura | null>(null);
    const [leyendo, setLeyendo] = useState(false);

    const leer = async () => {
        setLeyendo(true);
        try {
            const r: any = await probeDeviceInfo({
                ip: datos.ip, username: datos.username, password: datos.password,
                authType: datos.authType, brand: datos.brand,
            });
            setLectura(r);
        } catch (e: any) {
            setLectura({ ok: false, error: e?.message || "No se pudo conectar" });
        } finally { setLeyendo(false); }
    };

    /* Se lee sola apenas el equipo existe: llegar hasta acá ya fue decir "dalo de alta". */
    useEffect(() => { if (deviceId) leer(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [deviceId]);

    if (!deviceId) {
        return (
            <div className="space-y-4">
                <div className="rounded-[10px] border border-border bg-card/40 p-3.5">
                    <p className="text-[12.5px] font-semibold text-foreground">{datos.name || "Sin nombre"}</p>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5">
                        {[tipo?.rotulo, datos.brand, datos.ip].filter(Boolean).join(" · ")}
                    </p>
                </div>
                <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                    Al dar de alta, OmniAccess va a ir a buscar al equipo y mostrar acá mismo lo que
                    contestó{tipo?.vivo ? ", con el video en vivo" : ""}. Si algo está mal cargado se va a ver
                    en el momento y no dentro de una semana.
                </p>
                {faltantes.length > 0 && (
                    <div className="rounded-[10px] border border-[var(--aviso)]/35 bg-[var(--aviso-suave)] p-3.5">
                        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--aviso-texto)]">
                            <AlertTriangle size={14} /> Se puede dar de alta igual, pero falta
                        </p>
                        <div className="mt-1">
                            {faltantes.map((x) => (
                                <Punto key={x.titulo} estado="aviso" titulo={x.titulo} detalle={x.detalle} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const hikvision = (datos.brand || "").toUpperCase() === "HIKVISION";

    return (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}
            className="space-y-4">
            {tipo?.vivo && (
                <Vivo deviceId={deviceId}
                    linea={leerJson<Linea>(linea)}
                    zona={leerJson<Zona>(zona)} />
            )}

            <div className={cn("rounded-[10px] border p-3.5",
                lectura?.ok ? "border-[var(--bien)]/35 bg-[var(--bien-suave)]"
                    : lectura ? "border-[var(--aviso)]/35 bg-[var(--aviso-suave)]"
                        : "border-border bg-card/40")}>
                {leyendo && <Punto estado="esperando" titulo="Preguntándole al equipo quién es…" />}

                {!leyendo && lectura?.ok && (
                    <>
                        <Punto estado="bien" titulo="El equipo contestó" />
                        {/* El número de serie es una tira de cuarenta caracteres sin un solo
                            espacio: en su media columna no tenía dónde cortar y se salía del
                            cajón. Va solo, a lo ancho, y con permiso para partirse. */}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1.5 text-[12px] text-muted-foreground">
                            <span className="min-w-0 break-words">Modelo: <b className="text-foreground">{lectura.model || "—"}</b></span>
                            <span className="min-w-0 break-words">Firmware: <b className="text-foreground">{lectura.firmwareVersion || "—"}</b></span>
                            <span className="min-w-0 break-words">MAC: <b className="text-foreground tabular-nums">{lectura.macAddress || "—"}</b></span>
                            <span className="col-span-2 min-w-0">Serie: <b className="text-foreground tabular-nums break-all">{lectura.serialNumber || "—"}</b></span>
                        </div>
                    </>
                )}

                {!leyendo && lectura && !lectura.ok && (
                    <Punto estado="aviso"
                        titulo={hikvision ? "No se lo pudo leer" : "Esta marca todavía no se puede leer"}
                        detalle={hikvision
                            ? (lectura.error || "Revisá la IP, el usuario y la forma de autenticarse.")
                            : `La lectura de modelo y firmware por ahora sólo habla Hikvision. Para ${datos.brand} la verificación que vale es que llegue el video.`} />
                )}

                {!leyendo && (
                    <Button type="button" variant="outline" size="sm" className="mt-2.5" onClick={leer}>
                        <RefreshCw size={13} /> Volver a preguntar
                    </Button>
                )}
            </div>

            {faltantes.length > 0 && (
                <div className="rounded-[10px] border border-border bg-card/40 p-3.5">
                    <p className="text-[12.5px] font-semibold text-foreground">Queda pendiente</p>
                    <div className="mt-1">
                        {faltantes.map((x) => (
                            <Punto key={x.titulo} estado="aviso" titulo={x.titulo} detalle={x.detalle} />
                        ))}
                    </div>
                </div>
            )}
        </motion.div>
    );
}
