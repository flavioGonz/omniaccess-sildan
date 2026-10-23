"use client";

import { motion, useReducedMotion, type Transition } from "framer-motion";
import { useId } from "react";

/**
 * La ilustración animada de lo que pasó, arriba del detalle de un mensaje de central (23/10, Nico:
 * «generá una ilustración animada, de calidad, realista, del tipo de evento, para que visualmente se
 * entienda qué fue lo que sucedió»).
 *
 * Una casa vista de frente (la central protege un lugar, no un código) y sobre ella lo que pasó: el
 * intruso que llega a la ventana y la sirena que destella, el humo que sale, el escudo que se cierra
 * al armar, el mensaje que no llega al receptor… Con una frase debajo que lo dice en palabras.
 *
 * Sale de la CLASE del evento (lib-dc09-codigos: categoría + tipo), no del código: «Robo perimetral»
 * y «Robo interior» son la misma escena. Una restauración o el fin de una falla es la misma escena
 * en calma, con el visto bueno.
 *
 * Los colores son de la ilustración (cielo, ladrillo, fuego) y viven acá: no son tonos de estado de
 * la interfaz. Con «reducir movimiento» del sistema, la escena queda quieta en su momento clave.
 */

export type Escena =
    | "robo" | "panico" | "coaccion" | "incendio" | "medica" | "sabotaje" | "gas" | "agua" | "temperatura" | "alarma"
    | "armado" | "desarmado" | "comunicacion" | "corriente" | "bateria" | "dispositivo" | "prueba" | "programacion" | "generico";

type Ev = { categoria?: string | null; tipo?: string | null; texto?: string | null } | null | undefined;

const ALARMA: Record<string, Escena> = {
    ROBO: "robo", PANICO: "panico", COACCION: "coaccion", INCENDIO: "incendio", MEDICA: "medica", SABOTAJE: "sabotaje",
    GAS: "gas", AGUA: "agua", TEMPERATURA: "temperatura", GENERAL: "alarma",
};
const FALLA: Record<string, Escena> = {
    COMUNICACION: "comunicacion", SUPERVISION: "comunicacion", CORRIENTE: "corriente", BATERIA: "bateria",
    PROGRAMACION: "programacion", SENSOR: "dispositivo", SIRENA: "dispositivo", EXPANSOR: "dispositivo", SISTEMA: "dispositivo", INCENDIO: "dispositivo",
};

/** Qué escena y en qué estado: `normal` es la restauración / el fin de la falla. */
export function escenaDe(e: Ev): { escena: Escena; normal: boolean } {
    if (!e) return { escena: "generico", normal: false };
    const t = e.tipo || "";
    switch (e.categoria) {
        case "ALARMA": return { escena: ALARMA[t] || "alarma", normal: false };
        case "RESTAURACION": return { escena: ALARMA[t] || "alarma", normal: true };
        case "ARMADO": return { escena: "armado", normal: false };
        case "DESARMADO": return { escena: "desarmado", normal: false };
        case "FALLA": return { escena: FALLA[t] || "dispositivo", normal: false };
        case "FALLA_FIN": return { escena: FALLA[t] || "dispositivo", normal: true };
        case "PRUEBA": return { escena: "prueba", normal: false };
        case "OTRO": return { escena: t === "PROGRAMACION" || t === "ACCESO" ? "programacion" : t === "ANULADA" ? "dispositivo" : "generico", normal: false };
        default: return { escena: "generico", normal: false };
    }
}

/** La frase que va debajo: lo que muestra la escena, en palabras de guardia. */
const FRASE: Record<Escena, [string, string]> = {
    robo: ["Se abrió o se movió algo en una zona con la alarma armada: alguien pudo haber entrado.", "La zona volvió a la normalidad: el sensor ya no detecta."],
    panico: ["Alguien apretó el botón de pánico: pide ayuda ya.", "El pánico se restableció en la central."],
    coaccion: ["Desarmaron con el código de coacción: la persona está bajo amenaza. Actuar sin avisar.", "La coacción se restableció en la central."],
    incendio: ["Un detector de humo o calor se disparó: posible incendio.", "El detector de incendio volvió a la normalidad."],
    medica: ["Pidieron una emergencia médica desde la central.", "La emergencia médica se restableció."],
    sabotaje: ["Abrieron o forzaron un sensor o la central: alguien la está manipulando.", "El sabotaje se restableció: la tapa volvió a su lugar."],
    gas: ["El detector de gas se disparó: posible pérdida.", "El detector de gas volvió a la normalidad."],
    agua: ["Un sensor detectó agua donde no debería: posible pérdida o inundación.", "El sensor de agua volvió a la normalidad."],
    temperatura: ["La temperatura salió de rango (calor o frío).", "La temperatura volvió a su rango."],
    alarma: ["La central dio una alarma.", "La alarma se restableció."],
    armado: ["Armaron la alarma: el lugar queda vigilado.", "Armaron la alarma: el lugar queda vigilado."],
    desarmado: ["Desarmaron la alarma: alguien entró con su código o a distancia.", "Desarmaron la alarma."],
    comunicacion: ["La central no pudo hacer llegar un evento: se cortó el camino hasta el receptor.", "La comunicación volvió: los eventos llegan de nuevo al receptor."],
    corriente: ["Se cortó la luz: la central sigue con su batería.", "Volvió la luz: la central dejó de usar la batería."],
    bateria: ["La batería de la central (o de un sensor) está baja.", "La batería volvió a estar bien."],
    dispositivo: ["Un equipo de la central informó una falla (sensor, sirena, expansor).", "El equipo volvió a funcionar bien."],
    prueba: ["La central mandó su prueba: está viva y comunica.", "La central mandó su prueba: está viva y comunica."],
    programacion: ["Entraron a la programación de la central o la cambiaron.", "Salieron de la programación de la central."],
    generico: ["La central mandó un evento que no tiene una escena propia.", "La central mandó un evento."],
};

/** La paleta de la ilustración (no la de la interfaz): cielo, ladrillo, luz cálida, fuego, sirena. */
const C = {
    nocheA: "#0b1324", nocheB: "#1d2a48", atardecerA: "#2a3a63", atardecerB: "#d98c6a", diaA: "#7fb2e5", diaB: "#d7e9f7",
    pasto: "#20321f", pastoClaro: "#3b5a35", vereda: "#6b6f75",
    pared: "#c8b49a", paredSombra: "#9c8a72", techo: "#3a3f4b", techoLuz: "#59606f", madera: "#6b4a32",
    vidrio: "#1c2c44", luz: "#ffd27a", luzSuave: "#ffe9b8",
    rojo: "#ef4444", rojoOscuro: "#991b1b", ambar: "#f59e0b", verde: "#22c55e", azul: "#38bdf8", humo: "#9aa3ad", fuego: "#ff7a1a",
    metal: "#aeb6c2", metalOscuro: "#545c69", panel: "#e7eaee",
};

type Props = { evento: Ev; className?: string; alto?: number };

export function IlustracionEvento({ evento, className, alto = 210 }: Props) {
    const { escena, normal } = escenaDe(evento);
    const quieto = !!useReducedMotion();
    const uid = useId().replace(/[:]/g, "");
    const alerta = !normal && ["robo", "panico", "coaccion", "incendio", "medica", "sabotaje", "gas", "agua", "temperatura", "alarma"].includes(escena);
    const cielo = alerta || escena === "robo" || escena === "corriente" ? "noche" : escena === "armado" || escena === "desarmado" ? "atardecer" : "dia";
    return (
        <figure className={className}>
            <div className="relative overflow-hidden" style={{ height: alto }}>
                <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" role="img" aria-label={FRASE[escena][normal ? 1 : 0]}>
                    <Fondo uid={uid} cielo={cielo} />
                    <Escenario escena={escena} normal={normal} uid={uid} quieto={quieto} />
                    {/* El destello de una alarma: todo el cuadro late en rojo mientras dura. */}
                    {alerta && !quieto && (
                        <motion.rect x={0} y={0} width={400} height={220} fill={C.rojo} initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 0.16, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} style={{ mixBlendMode: "screen" }} />
                    )}
                    {/* Viñeta: el centro de la escena manda, los bordes se oscurecen. */}
                    <rect x={0} y={0} width={400} height={220} fill={`url(#vin-${uid})`} pointerEvents="none" />
                </svg>
            </div>
            <figcaption className="px-5 pt-2.5 text-[12.5px] leading-snug text-muted-foreground">{FRASE[escena][normal ? 1 : 0]}</figcaption>
        </figure>
    );
}

/* ───────────────────────── El fondo: cielo, suelo, árbol, casa ───────────────────────── */

function Fondo({ uid, cielo }: { uid: string; cielo: "noche" | "atardecer" | "dia" }) {
    const [a, b] = cielo === "noche" ? [C.nocheA, C.nocheB] : cielo === "atardecer" ? [C.atardecerA, C.atardecerB] : [C.diaA, C.diaB];
    return (
        <>
            <defs>
                <linearGradient id={`cielo-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
                <linearGradient id={`suelo-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={cielo === "dia" ? C.pastoClaro : C.pasto} /><stop offset="1" stopColor="#0d160c" /></linearGradient>
                <linearGradient id={`pared-${uid}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={C.paredSombra} /><stop offset="0.35" stopColor={C.pared} /><stop offset="1" stopColor={C.paredSombra} /></linearGradient>
                <linearGradient id={`techo-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.techoLuz} /><stop offset="1" stopColor={C.techo} /></linearGradient>
                <linearGradient id={`vidrio-${uid}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3b5578" /><stop offset="0.5" stopColor={C.vidrio} /><stop offset="1" stopColor="#0e1726" /></linearGradient>
                <linearGradient id={`vidrioLuz-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.luzSuave} /><stop offset="1" stopColor={C.luz} /></linearGradient>
                <radialGradient id={`halo-${uid}`}><stop offset="0" stopColor={C.luz} stopOpacity="0.55" /><stop offset="1" stopColor={C.luz} stopOpacity="0" /></radialGradient>
                <radialGradient id={`haloRojo-${uid}`}><stop offset="0" stopColor={C.rojo} stopOpacity="0.8" /><stop offset="1" stopColor={C.rojo} stopOpacity="0" /></radialGradient>
                <radialGradient id={`haloVerde-${uid}`}><stop offset="0" stopColor={C.verde} stopOpacity="0.55" /><stop offset="1" stopColor={C.verde} stopOpacity="0" /></radialGradient>
                <radialGradient id={`vin-${uid}`} cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.45" /></radialGradient>
                <filter id={`blur-${uid}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
                <filter id={`sombra-${uid}`} x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000" floodOpacity="0.45" /></filter>
            </defs>
            <rect x={0} y={0} width={400} height={190} fill={`url(#cielo-${uid})`} />
            {cielo === "noche" && (
                <g>
                    {[[30, 22], [72, 40], [110, 18], [330, 30], [362, 52], [300, 14], [250, 38], [150, 44]].map(([x, y], i) => (
                        <circle key={i} cx={x} cy={y} r={i % 3 ? 0.9 : 1.3} fill="#fff" opacity={0.7} />
                    ))}
                    <circle cx={352} cy={34} r={13} fill="#f3f0e2" opacity={0.92} />
                    <circle cx={358} cy={30} r={12} fill={C.nocheA} opacity={0.9} />
                </g>
            )}
            {cielo === "atardecer" && <circle cx={340} cy={150} r={26} fill="#ffd9a8" opacity={0.5} filter={`url(#blur-${uid})`} />}
            {/* Edificios lejanos: el barrio. */}
            <path d="M0 150 h26 v-22 h18 v14 h22 v-30 h16 v38 h30 v-12 h20 v12 H400 V190 H0 Z" fill="#000" opacity={0.18} />
            <rect x={0} y={180} width={400} height={40} fill={`url(#suelo-${uid})`} />
            {/* Árbol de la izquierda. */}
            <g opacity={0.95}>
                <rect x={58} y={140} width={6} height={44} fill="#2a1d14" />
                <circle cx={61} cy={132} r={22} fill="#1e3a24" /><circle cx={47} cy={142} r={15} fill="#17301d" /><circle cx={76} cy={141} r={16} fill="#1a3420" />
            </g>
            {/* Cerco bajo. */}
            <g opacity={0.8}>{Array.from({ length: 12 }, (_, i) => <rect key={i} x={96 + i * 6} y={170} width={3} height={14} rx={1} fill="#4a3a2c" />)}<rect x={94} y={174} width={72} height={2} fill="#4a3a2c" /></g>
            {Array.from({ length: 10 }, (_, i) => <rect key={`d${i}`} x={300 + i * 6} y={170} width={3} height={14} rx={1} fill="#4a3a2c" opacity={0.8} />)}
            <rect x={298} y={174} width={62} height={2} fill="#4a3a2c" opacity={0.8} />
            {/* Camino a la puerta. */}
            <path d="M206 185 L234 185 L262 220 L178 220 Z" fill={C.vereda} opacity={0.55} />
        </>
    );
}

/** La casa. `luces`: ventanas encendidas. `puerta`: cuánto está abierta (0–1). */
function Casa({ uid, luces = false, puerta = 0, ventanaRota = false, quieto }: { uid: string; luces?: boolean; puerta?: number; ventanaRota?: boolean; quieto: boolean }) {
    const vid = luces ? `url(#vidrioLuz-${uid})` : `url(#vidrio-${uid})`;
    return (
        <g filter={`url(#sombra-${uid})`}>
            {/* Chimenea, techo y pared. */}
            <rect x={262} y={66} width={12} height={28} fill={C.paredSombra} />
            <path d="M136 110 L220 58 L304 110 Z" fill={`url(#techo-${uid})`} />
            <path d="M136 110 L220 58 L222 62 L142 110 Z" fill="#fff" opacity={0.08} />
            <rect x={148} y={108} width={144} height={77} fill={`url(#pared-${uid})`} />
            <rect x={148} y={108} width={144} height={4} fill="#000" opacity={0.18} />
            {/* Ladrillos insinuados. */}
            {Array.from({ length: 6 }, (_, f) => <line key={f} x1={148} y1={120 + f * 11} x2={292} y2={120 + f * 11} stroke="#000" strokeOpacity={0.05} />)}
            {/* Ventanas. */}
            {[[160, 122], [248, 122]].map(([x, y], i) => (
                <g key={i}>
                    {luces && <circle cx={x + 16} cy={y + 13} r={26} fill={`url(#halo-${uid})`} />}
                    <rect x={x - 2} y={y - 2} width={36} height={30} rx={2} fill="#efe6d8" />
                    <rect x={x} y={y} width={32} height={26} fill={vid} />
                    <line x1={x + 16} y1={y} x2={x + 16} y2={y + 26} stroke="#efe6d8" strokeWidth={2} />
                    <line x1={x} y1={y + 13} x2={x + 32} y2={y + 13} stroke="#efe6d8" strokeWidth={2} />
                    <path d={`M${x + 3} ${y + 3} l8 0 l-6 9 l-2 0 Z`} fill="#fff" opacity={0.18} />
                    <rect x={x - 3} y={y + 26} width={38} height={3} fill="#d9cdbb" />
                    {i === 0 && ventanaRota && (
                        <motion.g initial={{ opacity: quieto ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 0.2 }}>
                            <path d={`M${x + 9} ${y + 8} l5 4 l-3 7 M${x + 14} ${y + 12} l7 -3 l4 5 M${x + 14} ${y + 12} l2 9`} stroke="#e6f2ff" strokeWidth={0.9} fill="none" />
                            <path d={`M${x + 4} ${y + 22} l3 -1 l1 3 Z M${x + 24} ${y + 4} l3 2 l-2 2 Z`} fill="#e6f2ff" opacity={0.8} />
                        </motion.g>
                    )}
                </g>
            ))}
            {/* Puerta (se abre hacia adentro: se angosta). */}
            <rect x={204} y={138} width={32} height={47} fill="#2b1d12" />
            {puerta > 0 && <rect x={205} y={139} width={30} height={46} fill={C.luz} opacity={0.55} />}
            <rect x={204} y={138} width={32 * (1 - puerta * 0.7)} height={47} fill={C.madera} />
            <rect x={207} y={142} width={Math.max(0, 26 * (1 - puerta * 0.7))} height={18} fill="#000" opacity={0.12} />
            <circle cx={204 + 32 * (1 - puerta * 0.7) - 5} cy={163} r={1.6} fill="#e8c46a" />
            {/* Farol sobre la puerta. */}
            <rect x={217} y={128} width={6} height={7} rx={1} fill="#222" />
            <circle cx={220} cy={133} r={luces ? 12 : 6} fill={`url(#halo-${uid})`} opacity={luces ? 1 : 0.5} />
            {/* Teclado de la alarma junto a la puerta. */}
            <rect x={241} y={148} width={9} height={13} rx={1.5} fill={C.panel} stroke="#9aa3ad" strokeWidth={0.5} />
            <rect x={242.5} y={149.5} width={6} height={3} fill="#1f2937" />
        </g>
    );
}

/** La sirena exterior (caja en la pared). `destella`: luz roja intermitente. */
function Sirena({ uid, destella, quieto, x = 274, y = 112 }: { uid: string; destella: boolean; quieto: boolean; x?: number; y?: number }) {
    return (
        <g>
            {destella && !quieto && (
                <motion.circle cx={x + 8} cy={y + 2} r={34} fill={`url(#haloRojo-${uid})`} initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0, 1, 0] }} transition={{ duration: 1.1, repeat: Infinity, times: [0, 0.1, 0.25, 0.35, 1] }} />
            )}
            <rect x={x} y={y - 3} width={16} height={14} rx={3} fill="#f1f3f5" stroke="#9aa3ad" strokeWidth={0.6} />
            <rect x={x + 3} y={y - 6} width={10} height={4} rx={1.5} fill={destella ? C.rojo : "#6b7280"} />
            {destella && quieto && <circle cx={x + 8} cy={y + 2} r={24} fill={`url(#haloRojo-${uid})`} />}
        </g>
    );
}

/** El visto bueno de una restauración: un círculo verde que aparece sobre la escena. */
function VistoBueno({ uid, x = 340, y = 70, quieto }: { uid: string; x?: number; y?: number; quieto: boolean }) {
    return (
        <motion.g initial={quieto ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.3 }} style={{ transformOrigin: "50% 50%", transformBox: "fill-box" } as any}>
            <circle cx={x} cy={y} r={26} fill={`url(#haloVerde-${uid})`} />
            <circle cx={x} cy={y} r={14} fill={C.verde} />
            <motion.path d={`M${x - 6} ${y} l4 4.5 l8 -9`} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
                initial={quieto ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.6, duration: 0.4 }} />
        </motion.g>
    );
}

/** Una persona vista de perfil, en silueta (el intruso, quien arma o desarma). */
function Persona({ x, y, escala = 1, color = "#05070c" }: { x: number; y: number; escala?: number; color?: string }) {
    return (
        <g transform={`translate(${x} ${y}) scale(${escala})`} fill={color}>
            <circle cx={0} cy={-46} r={6.5} />
            <path d="M-7 -38 q7 -3 14 0 l3 22 l-4 1 l-1 -10 l-1 18 l3 21 l-6 0 l-3 -18 l-2 18 l-6 0 l2 -21 l0 -18 l-2 10 l-4 -1 Z" />
        </g>
    );
}

/* ───────────────────────── Cada escena ───────────────────────── */

function Escenario({ escena, normal, uid, quieto }: { escena: Escena; normal: boolean; uid: string; quieto: boolean }) {
    const rep = (d: number, extra: object = {}): Transition => (quieto ? { duration: 0 } : { duration: d, repeat: Infinity, ease: "easeInOut", ...extra });
    switch (escena) {
        case "robo": {
            return (
                <>
                    <Casa uid={uid} ventanaRota={!normal} quieto={quieto} />
                    {/* El sensor de movimiento en la esquina, con su abanico. */}
                    <g>
                        <motion.path d="M150 112 L120 175 L190 175 Z" fill={normal ? C.verde : C.rojo}
                            initial={{ opacity: normal ? 0.08 : 0.15 }} animate={normal ? { opacity: 0.08 } : { opacity: [0.08, 0.32, 0.08] }} transition={rep(0.9)} />
                        <rect x={146} y={108} width={9} height={7} rx={2} fill="#f1f3f5" />
                        <circle cx={150.5} cy={112} r={1.6} fill={normal ? C.verde : C.rojo} />
                    </g>
                    <Sirena uid={uid} destella={!normal} quieto={quieto} />
                    {!normal ? (
                        /* El intruso cruza el jardín hasta la ventana. */
                        <motion.g initial={{ x: quieto ? 0 : -70 }} animate={{ x: 0 }} transition={quieto ? { duration: 0 } : { duration: 1.5, ease: "easeOut" }}>
                            <Persona x={150} y={184} escala={0.95} />
                            {/* Linterna. */}
                            <motion.path d="M158 150 L184 136 L186 146 Z" fill="#fff6c8" opacity={0.35} animate={quieto ? undefined : { opacity: [0.2, 0.45, 0.2] }} transition={rep(0.6)} />
                        </motion.g>
                    ) : <VistoBueno uid={uid} quieto={quieto} />}
                </>
            );
        }
        case "panico":
        case "coaccion": {
            const coaccion = escena === "coaccion";
            return (
                <>
                    <Casa uid={uid} luces quieto={quieto} />
                    <Sirena uid={uid} destella={!normal && !coaccion} quieto={quieto} />
                    {/* El teclado en grande, en primer plano. */}
                    <g filter={`url(#sombra-${uid})`}>
                        <rect x={36} y={50} width={96} height={136} rx={12} fill="#eef1f4" stroke="#b6bec9" />
                        <rect x={46} y={60} width={76} height={24} rx={4} fill="#0f172a" />
                        <text x={84} y={77} textAnchor="middle" fontSize={11} fontWeight={700} fill={normal ? C.verde : coaccion ? "#c084fc" : C.rojo} fontFamily="monospace">
                            {normal ? "NORMAL" : coaccion ? "* * * *" : "PÁNICO"}
                        </text>
                        {Array.from({ length: 9 }, (_, i) => (
                            <rect key={i} x={50 + (i % 3) * 23} y={92 + Math.floor(i / 3) * 18} width={18} height={13} rx={3} fill="#fff" stroke="#c7ced8" strokeWidth={0.6} />
                        ))}
                        <motion.rect x={50} y={146} width={64} height={30} rx={6} fill={coaccion ? "#7c3aed" : C.rojo}
                            animate={!normal && !quieto ? { opacity: [1, 0.55, 1] } : { opacity: normal ? 0.4 : 1 }} transition={rep(0.8)} />
                        <text x={82} y={166} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff">{coaccion ? "CÓDIGO" : "SOS"}</text>
                    </g>
                    {!normal && (
                        <>
                            {/* El dedo que aprieta. */}
                            <motion.g initial={{ y: quieto ? 0 : -16 }} animate={quieto ? undefined : { y: [-16, 0, 0, -16] }} transition={rep(1.6, { times: [0, 0.25, 0.7, 1] })}>
                                <path d="M88 186 q-6 -10 -2 -22 q3 -6 8 -2 l3 10 q8 -2 14 6 l2 18 Z" fill="#e0b18f" stroke="#b9876a" strokeWidth={0.6} />
                            </motion.g>
                            {/* Ondas que salen: el pedido de ayuda (silencioso en la coacción). */}
                            {[0, 0.5, 1].map((d) => (
                                <motion.circle key={d} cx={84} cy={160} r={18} fill="none" stroke={coaccion ? "#c084fc" : C.rojo} strokeWidth={2}
                                    initial={{ scale: 1, opacity: 0.8 }} animate={quieto ? undefined : { scale: [1, 3.2], opacity: [0.8, 0] }}
                                    transition={quieto ? undefined : { duration: 1.6, repeat: Infinity, delay: d, ease: "easeOut" }} style={{ transformOrigin: "50% 50%", transformBox: "fill-box" } as any} />
                            ))}
                            {coaccion && <Persona x={160} y={184} escala={1.05} color="#0a0d14" />}
                        </>
                    )}
                    {normal && <VistoBueno uid={uid} quieto={quieto} />}
                </>
            );
        }
        case "incendio": {
            return (
                <>
                    <Casa uid={uid} quieto={quieto} />
                    <Sirena uid={uid} destella={!normal} quieto={quieto} />
                    {!normal ? (
                        <>
                            {/* Fuego en la ventana izquierda. */}
                            <circle cx={176} cy={135} r={30} fill={C.fuego} opacity={0.35} filter={`url(#blur-${uid})`} />
                            {[0, 1, 2].map((i) => (
                                <motion.path key={i} d={`M${166 + i * 7} 148 q-4 -10 2 -18 q1 8 5 6 q-1 -8 4 -12 q4 10 0 24 Z`} fill={i === 1 ? "#ffd166" : C.fuego}
                                    animate={quieto ? undefined : { scaleY: [1, 1.25, 0.95, 1.15, 1], opacity: [0.9, 1, 0.85, 1, 0.9] }}
                                    transition={rep(0.7 + i * 0.15)} style={{ transformOrigin: "50% 100%", transformBox: "fill-box" } as any} />
                            ))}
                            {/* Humo que sube. */}
                            {[0, 0.8, 1.6, 2.4].map((d, i) => (
                                <motion.circle key={i} cx={178 + (i % 2) * 8} cy={118} r={9 + i * 2} fill={C.humo}
                                    initial={{ y: 0, opacity: 0.55 }} animate={quieto ? { y: -40 - i * 12, opacity: 0.35 } : { y: [0, -110], x: [0, 18], opacity: [0.55, 0], scale: [0.8, 1.8] }}
                                    transition={quieto ? { duration: 0 } : { duration: 3.2, repeat: Infinity, delay: d, ease: "easeOut" }} />
                            ))}
                        </>
                    ) : <VistoBueno uid={uid} quieto={quieto} />}
                </>
            );
        }
        case "medica": {
            return (
                <>
                    <Casa uid={uid} luces quieto={quieto} />
                    <g filter={`url(#sombra-${uid})`}>
                        <motion.g animate={!normal && !quieto ? { scale: [1, 1.08, 1] } : undefined} transition={rep(0.9)} style={{ transformOrigin: "50% 50%", transformBox: "fill-box" } as any}>
                            <circle cx={80} cy={90} r={30} fill="#fff" />
                            <path d="M73 70 h14 v13 h13 v14 h-13 v13 h-14 v-13 h-13 v-14 h13 Z" fill={normal ? C.verde : C.rojo} />
                        </motion.g>
                    </g>
                    {/* El electro que se dibuja. */}
                    <motion.path d="M20 160 H120 l8 -22 l10 40 l9 -30 l6 12 H390" fill="none" stroke={normal ? C.verde : C.rojo} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
                        initial={{ pathLength: quieto ? 1 : 0 }} animate={{ pathLength: 1 }} transition={quieto ? { duration: 0 } : { duration: 1.8, repeat: Infinity, ease: "linear", repeatDelay: 0.4 }} />
                    {normal && <VistoBueno uid={uid} quieto={quieto} />}
                </>
            );
        }
        case "sabotaje": {
            return (
                <>
                    <Casa uid={uid} quieto={quieto} />
                    {/* El sensor en grande, con la tapa que se abre. */}
                    <g filter={`url(#sombra-${uid})`}>
                        <rect x={34} y={58} width={78} height={110} rx={10} fill="#e9edf1" stroke="#b6bec9" />
                        <rect x={48} y={74} width={50} height={36} rx={18} fill="#cfd6df" />
                        <circle cx={73} cy={92} r={10} fill="#334155" />
                        <circle cx={73} cy={128} r={4} fill={normal ? C.verde : C.rojo} />
                        <motion.g initial={{ rotate: 0 }} animate={normal ? { rotate: 0 } : quieto ? { rotate: -32 } : { rotate: [0, -32, -32, 0] }}
                            transition={normal || quieto ? { duration: 0 } : { duration: 2.4, repeat: Infinity, times: [0, 0.3, 0.8, 1] }} style={{ transformOrigin: "0% 100%", transformBox: "fill-box" } as any}>
                            <rect x={34} y={58} width={78} height={110} rx={10} fill="#f6f8fa" stroke="#b6bec9" opacity={0.92} />
                            <rect x={44} y={150} width={58} height={6} rx={3} fill="#d8dee6" />
                        </motion.g>
                        {!normal && (
                            <motion.g animate={quieto ? undefined : { rotate: [-8, 8, -8] }} transition={rep(0.3)} style={{ transformOrigin: "0% 50%", transformBox: "fill-box" } as any}>
                                <rect x={112} y={137} width={26} height={5} rx={1} fill={C.metal} />
                                <rect x={136} y={133} width={30} height={13} rx={4} fill="#dc2626" />
                            </motion.g>
                        )}
                        {!normal && !quieto && [0, 1, 2].map((i) => (
                            <motion.circle key={i} cx={112} cy={139} r={1.6} fill="#ffd166"
                                animate={{ x: [0, -10 - i * 4], y: [0, -8 + i * 6], opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.15 }} />
                        ))}
                    </g>
                    {normal && <VistoBueno uid={uid} quieto={quieto} />}
                </>
            );
        }
        case "gas":
        case "agua":
        case "temperatura":
        case "alarma": {
            return (
                <>
                    <Casa uid={uid} luces={escena !== "alarma"} quieto={quieto} />
                    <Sirena uid={uid} destella={!normal} quieto={quieto} />
                    <g filter={`url(#sombra-${uid})`}>
                        <rect x={30} y={56} width={92} height={120} rx={12} fill="#eef1f4" stroke="#b6bec9" />
                        {escena === "gas" && (
                            <>
                                <rect x={52} y={118} width={48} height={8} rx={2} fill={C.metalOscuro} /><rect x={70} y={104} width={12} height={16} rx={2} fill={C.ambar} />
                                {!normal && [0, 0.6, 1.2].map((d, i) => (
                                    <motion.path key={i} d="M76 100 q-10 -10 0 -20 q10 -10 0 -20" fill="none" stroke="#84cc16" strokeWidth={4} strokeLinecap="round" opacity={0.7}
                                        animate={quieto ? undefined : { y: [0, -18], opacity: [0.8, 0] }} transition={quieto ? undefined : { duration: 1.8, repeat: Infinity, delay: d }} style={{ translateX: (i - 1) * 12 }} />
                                ))}
                            </>
                        )}
                        {escena === "agua" && (
                            <>
                                <path d="M44 74 h46 v10 h-34 v12 h-12 Z" fill={C.metalOscuro} />
                                {!normal && [0, 0.4, 0.8].map((d) => (
                                    <motion.path key={d} d="M50 100 q4 6 0 9 q-4 -3 0 -9 Z" fill={C.azul}
                                        animate={quieto ? undefined : { y: [0, 48], opacity: [1, 1, 0] }} transition={quieto ? undefined : { duration: 1.1, repeat: Infinity, delay: d, ease: "easeIn" }} />
                                ))}
                                <motion.ellipse cx={58} cy={160} rx={normal ? 6 : 28} ry={normal ? 2 : 5} fill={C.azul} opacity={0.55}
                                    animate={!normal && !quieto ? { rx: [22, 30, 22] } : undefined} transition={rep(1.4)} />
                            </>
                        )}
                        {escena === "temperatura" && (
                            <>
                                <rect x={68} y={66} width={16} height={84} rx={8} fill="#fff" stroke="#b6bec9" />
                                <circle cx={76} cy={154} r={12} fill={normal ? C.verde : C.rojo} />
                                <motion.rect x={72} width={8} rx={4} fill={normal ? C.verde : C.rojo}
                                    initial={{ y: 130, height: 24 }} animate={normal ? { y: 120, height: 34 } : quieto ? { y: 74, height: 80 } : { y: [130, 74, 130], height: [24, 80, 24] }} transition={normal || quieto ? { duration: 0 } : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }} />
                                {[0, 1, 2, 3, 4].map((i) => <line key={i} x1={88} y1={78 + i * 14} x2={96} y2={78 + i * 14} stroke="#94a3b8" strokeWidth={1.4} />)}
                            </>
                        )}
                        {escena === "alarma" && (
                            <motion.g animate={!normal && !quieto ? { rotate: [-10, 10, -10] } : undefined} transition={rep(0.35)} style={{ transformOrigin: "50% 0%", transformBox: "fill-box" } as any}>
                                <path d="M76 76 c-16 0 -24 12 -24 28 v18 l-8 10 h64 l-8 -10 v-18 c0 -16 -8 -28 -24 -28 Z" fill={normal ? C.verde : C.rojo} />
                                <circle cx={76} cy={140} r={6} fill={normal ? C.verde : C.rojo} />
                            </motion.g>
                        )}
                    </g>
                    {normal && <VistoBueno uid={uid} quieto={quieto} />}
                </>
            );
        }
        case "armado":
        case "desarmado": {
            const arma = escena === "armado";
            return (
                <>
                    <Casa uid={uid} luces={!arma} puerta={arma ? 0 : 0.6} quieto={quieto} />
                    {/* Quien arma o desarma, en la puerta. */}
                    <motion.g initial={{ x: quieto ? 0 : arma ? 0 : -40, opacity: quieto ? 1 : arma ? 1 : 0 }}
                        animate={arma ? (quieto ? { x: 40, opacity: 0.0 } : { x: [0, 0, 60], opacity: [1, 1, 0] }) : { x: 0, opacity: 1 }}
                        transition={quieto ? { duration: 0 } : arma ? { duration: 3, times: [0, 0.5, 1], repeat: Infinity, repeatDelay: 1 } : { duration: 1.4, ease: "easeOut" }}>
                        <Persona x={252} y={186} escala={0.9} color={arma ? "#111827" : "#1f2937"} />
                    </motion.g>
                    {/* El escudo: se dibuja alrededor de la casa al armar; se abre al desarmar. */}
                    <motion.path d="M220 30 C 280 34 318 52 322 70 C 330 140 290 186 220 204 C 150 186 110 140 118 70 C 122 52 160 34 220 30 Z"
                        fill={arma ? "rgba(56,189,248,0.10)" : "rgba(255,210,122,0.06)"} stroke={arma ? C.azul : C.luz} strokeWidth={2.5} strokeDasharray={arma ? undefined : "8 8"}
                        initial={{ pathLength: quieto ? (arma ? 1 : 0.55) : arma ? 0 : 1, opacity: 0.9 }}
                        animate={{ pathLength: arma ? 1 : 0.55, opacity: arma ? 0.95 : 0.5 }} transition={quieto ? { duration: 0 } : { duration: 1.6, ease: "easeInOut", delay: 0.3 }} />
                    {/* El candado. */}
                    <g transform="translate(220 34)" filter={`url(#sombra-${uid})`}>
                        <motion.path d="M-9 0 v-8 a9 9 0 0 1 18 0 v8" fill="none" stroke="#e5e7eb" strokeWidth={4} strokeLinecap="round"
                            initial={{ y: quieto ? (arma ? 0 : -7) : arma ? -7 : 0 }} animate={{ y: arma ? 0 : -7 }} transition={quieto ? { duration: 0 } : { delay: 1.6, duration: 0.3, type: "spring", stiffness: 500 }} />
                        <rect x={-13} y={0} width={26} height={20} rx={4} fill={arma ? C.azul : C.ambar} />
                        <circle cx={0} cy={9} r={2.6} fill="#0b1324" /><rect x={-1} y={10} width={2} height={5} fill="#0b1324" />
                    </g>
                    {arma && !quieto && (
                        <motion.circle cx={220} cy={44} r={30} fill={`url(#haloVerde-${uid})`} initial={{ opacity: 0 }} animate={{ opacity: [0, 0.9, 0.3] }} transition={{ delay: 1.8, duration: 1.2 }} />
                    )}
                </>
            );
        }
        case "comunicacion":
        case "prueba": {
            const prueba = escena === "prueba";
            const ok = normal || prueba;
            return (
                <>
                    {/* La central (con su antena) a la izquierda y el centro de monitoreo a la derecha. */}
                    <g filter={`url(#sombra-${uid})`}>
                        <rect x={40} y={92} width={70} height={88} rx={8} fill="#eef1f4" stroke="#b6bec9" />
                        <rect x={50} y={104} width={50} height={18} rx={3} fill="#0f172a" />
                        <motion.circle cx={58} cy={113} r={3} fill={ok ? C.verde : C.ambar} animate={quieto ? undefined : { opacity: [1, 0.3, 1] }} transition={rep(1)} />
                        {Array.from({ length: 6 }, (_, i) => <rect key={i} x={52 + (i % 3) * 16} y={130 + Math.floor(i / 3) * 14} width={12} height={9} rx={2} fill="#fff" stroke="#c7ced8" strokeWidth={0.6} />)}
                        <rect x={98} y={56} width={4} height={38} fill={C.metalOscuro} /><circle cx={100} cy={54} r={4} fill={C.metal} />
                        {/* Centro de monitoreo. */}
                        <rect x={290} y={70} width={78} height={110} rx={6} fill="#273449" />
                        {Array.from({ length: 12 }, (_, i) => <rect key={i} x={298 + (i % 3) * 22} y={80 + Math.floor(i / 3) * 22} width={16} height={12} rx={1.5} fill={C.luz} opacity={0.75} />)}
                        <rect x={300} y={58} width={58} height={14} rx={3} fill="#1e293b" />
                        <text x={329} y={68} textAnchor="middle" fontSize={8} fontWeight={700} fill="#cbd5e1">RECEPTOR</text>
                    </g>
                    {/* El camino. */}
                    <path d="M104 60 Q 200 10 296 64" fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 6" opacity={0.7} />
                    {[0, 0.7, 1.4].map((d) => {
                        // El paquete recorre la curva (cx/cy por fotogramas): offset-path no anda en todos los SVG.
                        const hasta = ok ? 1 : 0.5;
                        const ts = Array.from({ length: 11 }, (_, i) => (i / 10) * hasta);
                        const pt = (t: number) => ({ x: (1 - t) * (1 - t) * 104 + 2 * (1 - t) * t * 200 + t * t * 296, y: (1 - t) * (1 - t) * 60 + 2 * (1 - t) * t * 10 + t * t * 64 });
                        const fin = pt(hasta);
                        return (
                            <motion.circle key={d} r={5} fill={ok ? C.verde : C.ambar} initial={{ cx: 104, cy: 60, opacity: 0 }}
                                animate={quieto ? { cx: fin.x, cy: fin.y, opacity: 1 } : { cx: ts.map((t) => pt(t).x), cy: ts.map((t) => pt(t).y), opacity: ok ? [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0] : [0, 1, 1, 1, 1, 1, 1, 1, 1, 0.6, 0] }}
                                transition={quieto ? { duration: 0 } : { duration: ok ? 2.1 : 1.4, repeat: Infinity, delay: d, ease: "linear", repeatDelay: ok ? 0 : 0.7 }} />
                        );
                    })}
                    {!ok && (
                        <motion.g animate={quieto ? undefined : { scale: [1, 1.15, 1] }} transition={rep(0.9)} style={{ transformOrigin: "50% 50%", transformBox: "fill-box" } as any}>
                            <circle cx={200} cy={36} r={13} fill={C.rojo} />
                            <path d="M195 31 l10 10 M205 31 l-10 10" stroke="#fff" strokeWidth={3} strokeLinecap="round" />
                        </motion.g>
                    )}
                    {ok && <VistoBueno uid={uid} x={329} y={36} quieto={quieto} />}
                    {prueba && (
                        <motion.path d="M130 160 h40 l8 -18 l10 32 l9 -24 l6 10 h60" fill="none" stroke={C.verde} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                            initial={{ pathLength: quieto ? 1 : 0 }} animate={{ pathLength: 1 }} transition={quieto ? { duration: 0 } : { duration: 1.6, repeat: Infinity, repeatDelay: 0.5 }} />
                    )}
                </>
            );
        }
        case "corriente": {
            return (
                <>
                    <Casa uid={uid} luces={normal} quieto={quieto} />
                    {/* El poste y el cable que llega a la casa. */}
                    <rect x={350} y={60} width={6} height={124} fill="#4b3a2a" /><rect x={336} y={66} width={34} height={4} fill="#4b3a2a" />
                    <path d={normal ? "M340 68 Q 315 92 292 112" : "M340 68 Q 330 95 326 110"} fill="none" stroke="#111" strokeWidth={2} />
                    {!normal && !quieto && [0, 1, 2, 3].map((i) => (
                        <motion.circle key={i} cx={326} cy={111} r={1.8} fill="#ffd166"
                            animate={{ x: [0, (i - 1.5) * 10], y: [0, 10 + i * 3], opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12 }} />
                    ))}
                    {/* La batería de la central, que toma el relevo. */}
                    <g transform="translate(40 96)" filter={`url(#sombra-${uid})`}>
                        <rect x={0} y={0} width={70} height={36} rx={6} fill="#eef1f4" stroke="#b6bec9" /><rect x={70} y={12} width={6} height={12} rx={2} fill="#b6bec9" />
                        {[0, 1, 2, 3].map((i) => (
                            <motion.rect key={i} x={6 + i * 16} y={6} width={12} height={24} rx={2} fill={normal ? C.verde : i < 3 ? C.ambar : "#d1d5db"}
                                animate={!normal && !quieto && i === 2 ? { opacity: [1, 0.25, 1] } : undefined} transition={rep(1.1)} />
                        ))}
                        <text x={35} y={52} textAnchor="middle" fontSize={9} fontWeight={700} fill="#e5e7eb">{normal ? "CON LUZ" : "A BATERÍA"}</text>
                    </g>
                    {normal && <VistoBueno uid={uid} quieto={quieto} />}
                </>
            );
        }
        case "bateria": {
            return (
                <>
                    <Casa uid={uid} quieto={quieto} />
                    <g transform="translate(36 70)" filter={`url(#sombra-${uid})`}>
                        <rect x={0} y={0} width={96} height={52} rx={9} fill="#eef1f4" stroke="#b6bec9" /><rect x={96} y={16} width={8} height={20} rx={3} fill="#b6bec9" />
                        <motion.rect x={6} y={6} height={40} rx={5} fill={normal ? C.verde : C.rojo}
                            initial={{ width: normal ? 30 : 60 }} animate={normal ? { width: [30, 84] } : quieto ? { width: 16 } : { width: [60, 14, 60] }}
                            transition={normal ? { duration: quieto ? 0 : 1.6 } : quieto ? { duration: 0 } : { duration: 3, repeat: Infinity, ease: "easeInOut" }} />
                        {normal && <path d="M50 12 l-8 16 h8 l-4 14 l12 -18 h-8 l4 -12 Z" fill="#fff" />}
                    </g>
                    {normal && <VistoBueno uid={uid} quieto={quieto} />}
                </>
            );
        }
        case "dispositivo": {
            return (
                <>
                    <Casa uid={uid} quieto={quieto} />
                    <Sirena uid={uid} destella={false} quieto={quieto} />
                    <g filter={`url(#sombra-${uid})`}>
                        <rect x={36} y={62} width={84} height={104} rx={12} fill="#eef1f4" stroke="#b6bec9" />
                        <rect x={50} y={78} width={56} height={34} rx={17} fill="#cfd6df" /><circle cx={78} cy={95} r={9} fill="#334155" />
                        {!normal ? (
                            <motion.g animate={quieto ? undefined : { opacity: [1, 0.35, 1] }} transition={rep(1)}>
                                <path d="M78 122 l16 28 h-32 Z" fill={C.ambar} /><rect x={76.5} y={131} width={3} height={10} rx={1.2} fill="#1f2937" /><circle cx={78} cy={145} r={1.7} fill="#1f2937" />
                            </motion.g>
                        ) : <circle cx={78} cy={136} r={6} fill={C.verde} />}
                    </g>
                    {normal && <VistoBueno uid={uid} quieto={quieto} />}
                </>
            );
        }
        case "programacion": {
            return (
                <>
                    <Casa uid={uid} luces quieto={quieto} />
                    <g filter={`url(#sombra-${uid})`}>
                        <rect x={30} y={70} width={110} height={70} rx={6} fill="#1f2937" /><rect x={36} y={76} width={98} height={56} rx={3} fill="#0f172a" />
                        <rect x={20} y={140} width={130} height={8} rx={3} fill="#374151" />
                        {[0, 1, 2].map((i) => (
                            <motion.rect key={i} x={44} y={86 + i * 14} height={5} rx={2} fill={i === 1 ? C.azul : "#64748b"}
                                initial={{ width: 10 }} animate={quieto ? { width: 60 - i * 12 } : { width: [10, 70 - i * 14, 70 - i * 14] }} transition={quieto ? { duration: 0 } : { duration: 1.8, repeat: Infinity, delay: i * 0.25 }} />
                        ))}
                    </g>
                    <motion.g animate={quieto ? undefined : { rotate: 360 }} transition={quieto ? undefined : { duration: 6, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: "50% 50%", transformBox: "fill-box" } as any}>
                        <path d="M120 46 l4 0 l1 5 l5 2 l4 -3 l3 3 l-3 4 l2 5 l5 1 l0 4 l-5 1 l-2 5 l3 4 l-3 3 l-4 -3 l-5 2 l-1 5 l-4 0 l-1 -5 l-5 -2 l-4 3 l-3 -3 l3 -4 l-2 -5 l-5 -1 l0 -4 l5 -1 l2 -5 l-3 -4 l3 -3 l4 3 l5 -2 Z" fill={C.ambar} />
                        <circle cx={122} cy={62} r={5} fill="#1f2937" />
                    </motion.g>
                </>
            );
        }
        default: {
            return (
                <>
                    <Casa uid={uid} quieto={quieto} />
                    <g filter={`url(#sombra-${uid})`}>
                        <rect x={40} y={78} width={74} height={92} rx={10} fill="#eef1f4" stroke="#b6bec9" />
                        <rect x={50} y={88} width={54} height={20} rx={3} fill="#0f172a" />
                        <motion.text x={77} y={150} textAnchor="middle" fontSize={34} fontWeight={800} fill="#64748b" animate={quieto ? undefined : { opacity: [1, 0.4, 1] }} transition={rep(1.4)}>?</motion.text>
                    </g>
                </>
            );
        }
    }
}
