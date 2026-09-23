"use client";

/**
 * Modos: qué módulos tiene esta instalación y qué hace cada uno.
 *
 * ── QUÉ ESTABA MAL ────────────────────────────────────────────────────────────────
 *
 * Esta pantalla vivía adentro de `page.tsx`, que tiene 2.817 líneas, y acumulaba casi
 * todas las infracciones del sistema de diseño a la vez:
 *
 * - **Un color por módulo** (ámbar, verde azulado, violeta) más verde esmeralda en el
 *   interruptor. Cuatro familias de color para decir cuatro nombres. En este sistema el
 *   color no es identidad: el azul dice "apretame" y los cinco tonos dicen "así están las
 *   cosas". Un módulo no es ninguna de las dos, así que no le toca ninguna — lo que
 *   distingue a un módulo es su nombre, su ícono y su ilustración.
 * - **Sombra de colores sobre tarjetas que no flotan** (`shadow-lg shadow-amber-500/20`).
 *   El sistema tiene exactamente dos sombras y las dos tienen trabajo: una va abajo de una
 *   foto y la otra abajo de lo que flota de verdad. Una tarjeta apoyada en la página no es
 *   ninguna de las dos, y cuando todo lleva sombra, lo que flota de verdad ya no se nota.
 * - **`rounded-2xl`** (16px), que no está en la gramática de radios (0 / 6 / 10 / 14).
 * - **Dos interruptores distintos** dibujados a mano, uno verde y otro azul, para la misma
 *   clase de decisión, en la misma pantalla, a quince píxeles de distancia.
 * - **`animate-in zoom-in-95 duration-500`**: media página creciendo cada vez que se entra.
 *   En una pantalla de configuración —donde se viene a cambiar UNA cosa y salir— esperar
 *   medio segundo a que algo termine de acomodarse es puro peaje.
 * - **El ícono estaba roto**: ver el comentario en `module-definitions.ts`. Los cuatro
 *   módulos salían con el mismo chip genérico.
 *
 * ── CÓMO QUEDA ────────────────────────────────────────────────────────────────────
 *
 * La jerarquía sale de donde tiene que salir: **cambio de superficie primero, línea
 * después, sombra nunca**. Un módulo apagado no cambia de color, cambia de superficie.
 *
 * Y las funciones dejan de estar sueltas abajo de todo: cuelgan del módulo al que
 * pertenecen, que es lo que son. Una función que depende de otra va indentada abajo de
 * ella y se apaga sola cuando su padre se apaga — y lo DICE, en vez de quedar prendida
 * gobernando algo que ya no corre.
 *
 * ── UN MODO NO SE PRENDE: SE ELIGE ────────────────────────────────────────────────
 *
 * La primera versión de esta pantalla le puso un interruptor a cada módulo, y eso estaba
 * mal por una razón que no se ve mirando la pantalla: **los tres modos se excluyen**. El
 * camino que ya existía (`setExclusiveMode`) prende uno y apaga los otros dos, pide clave
 * y recarga la aplicación. El interruptor nuevo llamaba a `toggleModule`, que prende ese
 * solo y sin clave.
 *
 * O sea que en la misma pantalla convivían dos controles sobre los mismos cuatro módulos
 * que hacían cosas distintas, y el nuevo además rompía en silencio la regla que el viejo
 * protegía — y salteaba el PIN, que con eso dejaba de proteger nada.
 *
 * Ahora la forma dice la regla: los tres modos son una ELECCIÓN entre tres, así que se
 * dibujan como tal y activar uno pasa por la clave. Guardia no es un modo sino una capa
 * (`exclusive: false`): convive con cualquiera, así que va aparte y con interruptor de
 * verdad. Las dos cosas se ven distintas porque SON distintas.
 */

import { useEffect, useState } from "react";
import { Car, ScanFace, Users, ShieldCheck, Cpu, CornerDownRight, Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { MODULE_DEFINITIONS, type ModuleId, type ModuleInfo } from "@/lib/module-definitions";
import { FUNCIONES, dependenciaCumplida, type FuncionId, type Funcion } from "@/lib/funciones";
import { getEnabledModules, toggleModule } from "@/app/actions/modules";
import { getFunciones, toggleFuncion } from "@/app/actions/funciones";

/** Los íconos que los módulos pueden pedir por nombre. */
const ICONOS: Record<string, LucideIcon> = { Car, ScanFace, Users, ShieldCheck };

/* ── El interruptor ───────────────────────────────────────────────────────────────
 *
 * Uno solo para toda la pantalla, y con el azul de acción — no verde. Prender un módulo
 * es una ACCIÓN, y en este sistema todo lo que se aprieta es del mismo azul; el verde
 * significa "salió bien", que es otra cosa. Que estuvieran los dos, con los dos colores,
 * en la misma pantalla, es exactamente lo que el sistema viene a evitar.
 *
 * No usa `ui/switch.tsx` porque ese trae `shadow-xs` y se pinta con `bg-primary`; acá la
 * regla es sin sombra y con `--accion`. Cuando ese componente se migre, esto se reemplaza.
 */
function Interruptor({ encendido, ocupado, deshabilitado, onClick, etiqueta }: {
    encendido: boolean; ocupado?: boolean; deshabilitado?: boolean; onClick: () => void; etiqueta: string;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={encendido}
            aria-label={etiqueta}
            disabled={ocupado || deshabilitado}
            onClick={onClick}
            className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion-foco)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                encendido ? "bg-[var(--accion)]" : "bg-muted border border-border",
                (ocupado || deshabilitado) && "opacity-50 cursor-not-allowed",
            )}
        >
            <span className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-background transition-all duration-200",
                encendido ? "left-[22px]" : "left-0.5",
            )} />
        </button>
    );
}

/* ── La ilustración ───────────────────────────────────────────────────────────────
 *
 * El lugar para la foto del módulo. Mientras no haya foto dibuja un esquema en SVG, en
 * vez del rectángulo gris con un ícono al medio que es el relleno de costumbre: un hueco
 * gris se lee como algo que no cargó, y esto tiene que leerse como algo terminado.
 *
 * Todo el esquema va en `currentColor` sobre `--muted`, así que sigue al tema solo y no
 * hay un segundo juego de colores que mantener.
 */
function Ilustracion({ mod, encendido }: { mod: ModuleInfo; encendido: boolean }) {
    const Icono = ICONOS[mod.icon] || Cpu;
    return (
        <div
            className={cn(
                "relative h-28 overflow-hidden rounded-[var(--radius-sm)] bg-muted transition-opacity duration-200",
                !encendido && "opacity-45",
            )}
        >
            {mod.ilustracion ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mod.ilustracion} alt="" className="h-full w-full object-cover" />
            ) : (
                <>
                    <EsquemaModulo id={mod.id} />
                    <Icono
                        size={22}
                        strokeWidth={1.75}
                        className="absolute bottom-3 right-3 text-muted-foreground"
                    />
                </>
            )}
        </div>
    );
}

/**
 * Un dibujito por módulo: lo que ese módulo MIRA, no su logo.
 *
 * Son cuatro escenas distintas —una barrera con un auto, una cara encuadrada, gente en
 * fila, un puesto de guardia— para que se distingan de un vistazo sin leer el nombre, que
 * es justamente lo que un ícono genérico repetido cuatro veces no hacía.
 */
function EsquemaModulo({ id }: { id: ModuleId }) {
    const trazo = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    return (
        <svg viewBox="0 0 160 64" className="h-full w-full text-muted-foreground/45" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            {/* El piso, común a los cuatro: ata las cuatro escenas entre sí. */}
            <line x1="0" y1="52" x2="160" y2="52" stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

            {id === "MODULE_LPR" && (
                <g {...trazo}>
                    <path d="M28 46h34l6-11h20l6 11h10" />
                    <circle cx="44" cy="46" r="4" /><circle cx="94" cy="46" r="4" />
                    <rect x="58" y="39" width="16" height="6" rx="1" />
                    <path d="M116 46V20h4" /><path d="M120 24h30" strokeDasharray="6 4" />
                </g>
            )}
            {id === "MODULE_FACE" && (
                <g {...trazo}>
                    <circle cx="80" cy="30" r="13" />
                    <path d="M75 27v2M85 27v2M76 35c2 2 6 2 8 0" />
                    <path d="M56 14v-6h8M104 14v-6h-8M56 46v6h8M104 46v6h-8" />
                </g>
            )}
            {id === "MODULE_QUEUE" && (
                <g {...trazo}>
                    {[48, 70, 92].map((x, i) => (
                        <g key={x} opacity={1 - i * 0.22}>
                            <circle cx={x} cy="30" r="5" />
                            <path d={`M${x - 7} 46c0-5 3-8 7-8s7 3 7 8`} />
                        </g>
                    ))}
                    <path d="M108 38h14m0 0-4-4m4 4-4 4" />
                </g>
            )}
            {id === "MODULE_GUARD" && (
                <g {...trazo}>
                    <path d="M80 14l16 6v12c0 9-7 15-16 18-9-3-16-9-16-18V20z" />
                    <path d="M73 31l5 5 9-10" />
                </g>
            )}
        </svg>
    );
}

/* ── Una función ──────────────────────────────────────────────────────────────── */
function FilaFuncion({ f, encendida, ocupada, bloqueada, padre, onToggle }: {
    f: Funcion; encendida: boolean; ocupada: boolean; bloqueada: boolean; padre?: string; onToggle: () => void;
}) {
    return (
        <div className={cn(
            "flex items-start gap-3 px-4 py-3.5",
            // La función que cuelga de otra se indenta y lleva la flechita. Es la única
            // forma de que se vea que no son hermanas sin escribir "depende de" al lado.
            f.requiere && "pl-9",
        )}>
            {f.requiere && <CornerDownRight size={13} className="mt-0.5 shrink-0 text-muted-foreground/60" />}
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-snug text-foreground">{f.nombre}</div>
                <p className="mt-1 text-[11px] leading-[1.45] text-muted-foreground">{f.que}</p>

                {/* Lo que deja de pasar se dice ANTES de apagar, no después. */}
                {!bloqueada && (
                    <p className="mt-1.5 text-[11px] leading-[1.45] text-muted-foreground">
                        <span className="font-semibold text-foreground/75">Si se apaga:</span> {f.siSeApaga}
                    </p>
                )}

                {/* Y si está bloqueada por su padre, se dice POR QUÉ — no se deja un
                    interruptor gris sin explicación, que es lo que obliga a adivinar. */}
                {bloqueada && (
                    <p className="mt-1.5 text-[11px] leading-[1.45] text-[var(--aviso-texto)]">
                        Necesita «{padre}» prendida: sin estadías no hay ocupación que medir.
                    </p>
                )}
            </div>
            <Interruptor
                encendido={encendida && !bloqueada}
                ocupado={ocupada}
                deshabilitado={bloqueada}
                onClick={onToggle}
                etiqueta={`${encendida ? "Apagar" : "Prender"} ${f.nombre}`}
            />
        </div>
    );
}

/* ── La pantalla ──────────────────────────────────────────────────────────────── */
export default function ModosSection({ onActivar }: {
    /**
     * Activar un modo NO se resuelve acá.
     *
     * Apaga los otros dos, pide la clave de operación y recarga la aplicación entera, y
     * ese flujo —con su modal de PIN y su splash— ya vive en la pantalla de configuración.
     * Duplicarlo sería repetir el error que esta pantalla viene a arreglar: dos caminos
     * para lo mismo que pueden empezar a diferir.
     */
    onActivar: (moduleId: ModuleId, label: string) => void;
}) {
    const [modulos, setModulos] = useState<Record<string, boolean>>({});
    const [funciones, setFunciones] = useState<Record<string, boolean>>({});
    const [cargando, setCargando] = useState(true);
    const [alternando, setAlternando] = useState<string | null>(null);

    useEffect(() => {
        getEnabledModules()
            .then(setModulos)
            .catch(() => toast.error({ title: "No se pudieron leer los módulos" }))
            .finally(() => setCargando(false));
        getFunciones().then(setFunciones).catch(() => { });
    }, []);

    const alternarCapa = async (mod: ModuleInfo) => {
        setAlternando(mod.id);
        const valor = !(modulos[mod.id] ?? mod.defaultEnabled);
        const r = await toggleModule(mod.id, valor);
        if (r.success) {
            setModulos((p) => ({ ...p, [mod.id]: valor }));
            toast.success({ title: valor ? `${mod.name} activado` : `${mod.name} desactivado` });
        } else {
            toast.error({ title: "No se pudo cambiar" });
        }
        setAlternando(null);
    };

    const alternarFuncion = async (f: Funcion) => {
        setAlternando(f.id);
        /*
         * `f.porDefecto`, no `true`.
         *
         * Acá decía `funciones[id] ?? true`: si el valor todavía no estaba cargado, daba
         * por sentado que la función estaba prendida. Con la única función que existía eso
         * coincidía por casualidad — su defecto ES true. La próxima que naciera apagada
         * habría hecho que el primer clic no hiciera nada visible.
         */
        const valor = !(funciones[f.id] ?? f.porDefecto);
        const r = await toggleFuncion(f.id as FuncionId, valor);
        if (r.ok) {
            setFunciones((p) => ({ ...p, [f.id]: valor }));
            toast.success({ title: valor ? "Función activada" : "Función desactivada" });
        } else {
            toast.error({ title: "No se pudo cambiar la función" });
        }
        setAlternando(null);
    };

    const modos = MODULE_DEFINITIONS.filter((m) => m.exclusive);
    const capas = MODULE_DEFINITIONS.filter((m) => !m.exclusive);
    const prendido = (m: ModuleInfo) => modulos[m.id] ?? m.defaultEnabled;

    if (cargando) {
        return (
            <div className="space-y-6">
                <div className="h-5 w-56 rounded-[var(--radius-sm)] bg-muted" />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {modos.map((m) => (
                        <div key={m.id} className="h-60 rounded-[var(--radius)] border border-border bg-card" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* ── Los tres modos ───────────────────────────────────────────── */}
            <section className="space-y-3">
                <div>
                    <h2 className="text-[20px] font-bold leading-tight tracking-[-0.015em] text-foreground">
                        Modo de la instalación
                    </h2>
                    <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                        San Nicolás corre en <b className="font-semibold text-foreground">uno</b> de estos tres.
                        Cambiarlo apaga el anterior, pide la clave de operación y recarga la aplicación con la
                        interfaz del modo nuevo.
                    </p>
                </div>

                {/* `radiogroup` y no una fila de interruptores: es una elección entre tres,
                    y el lector de pantalla tiene que escuchar lo mismo que se ve. */}
                <div role="radiogroup" aria-label="Modo de la instalación" className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {modos.map((mod) => {
                        const activo = prendido(mod);
                        const Icono = ICONOS[mod.icon] || Cpu;

                        return (
                            <article
                                key={mod.id}
                                role="radio"
                                aria-checked={activo}
                                className={cn(
                                    "flex flex-col rounded-[var(--radius)] border p-3.5 transition-colors duration-200",
                                    activo ? "border-[var(--accion)] bg-card" : "border-border bg-muted/40",
                                )}
                            >
                                <Ilustracion mod={mod} encendido={activo} />

                                <div className="mt-3.5 flex items-center gap-2">
                                    <Icono size={16} className={activo ? "text-foreground" : "text-muted-foreground"} />
                                    <h3 className="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
                                        {mod.name}
                                    </h3>
                                    {activo && (
                                        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--bien-suave)] px-2 py-0.5 text-[11px] font-semibold text-[var(--bien-texto)]">
                                            <Check size={11} /> En uso
                                        </span>
                                    )}
                                </div>

                                <p className="mt-2 flex-1 text-[11px] leading-[1.45] text-muted-foreground">
                                    {mod.description}
                                </p>

                                {/* El botón sólo existe en los que NO están puestos. Un botón
                                    deshabilitado que dice "Activo" es un control que no controla
                                    nada: el chip de arriba ya lo dice, y mejor. */}
                                {!activo && (
                                    <button
                                        type="button"
                                        onClick={() => onActivar(mod.id, mod.name)}
                                        className="mt-3 w-full rounded-[var(--radius-sm)] bg-[var(--accion)] px-4 py-2 text-[12px] font-semibold text-[var(--accion-texto)] transition-colors hover:bg-[var(--accion-sobre)]"
                                    >
                                        Cambiar a este modo
                                    </button>
                                )}
                            </article>
                        );
                    })}
                </div>
            </section>

            {/* ── Las capas ────────────────────────────────────────────────── */}
            {capas.length > 0 && (
                <section className="space-y-2.5">
                    <h3 className="text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-muted-foreground">
                        Capas
                    </h3>
                    <p className="max-w-2xl text-[11px] leading-[1.45] text-muted-foreground">
                        No son modos: conviven con el que esté puesto, y se prenden y apagan por su cuenta
                        sin recargar nada.
                    </p>
                    <div className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
                        {capas.map((mod) => {
                            const Icono = ICONOS[mod.icon] || Cpu;
                            const on = prendido(mod);
                            return (
                                <div key={mod.id} className="flex items-start gap-3 px-4 py-3.5">
                                    <Icono size={16} className={cn("mt-0.5 shrink-0", on ? "text-foreground" : "text-muted-foreground")} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[13px] font-semibold leading-snug text-foreground">{mod.name}</div>
                                        <p className="mt-1 text-[11px] leading-[1.45] text-muted-foreground">{mod.description}</p>
                                    </div>
                                    <Interruptor
                                        encendido={on}
                                        ocupado={alternando === mod.id}
                                        onClick={() => alternarCapa(mod)}
                                        etiqueta={`${on ? "Apagar" : "Prender"} ${mod.name}`}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/*
              * Las funciones, colgadas del módulo al que pertenecen.
              *
              * Antes estaban sueltas al final de la pantalla, abajo de las tarjetas, sin
              * decir de cuál. Con una sola función se podía adivinar; con dos ya no.
              */}
            {MODULE_DEFINITIONS.map((mod) => {
                const delModulo = FUNCIONES.filter((f) => f.modulo === mod.id);
                if (!delModulo.length || !prendido(mod)) return null;

                return (
                    <section key={`fn-${mod.id}`} className="space-y-2.5">
                        <h3 className="text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-muted-foreground">
                            Funciones de {mod.name}
                        </h3>
                        <p className="max-w-2xl text-[11px] leading-[1.45] text-muted-foreground">
                            Cosas que este módulo puede hacer o no hacer sin dejar de ser él mismo. No cambian
                            qué pantallas se ven: cambian cuánto trabajo hace el servidor y qué se registra.
                        </p>
                        <div className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
                            {delModulo.map((f) => {
                                const bloqueada = !dependenciaCumplida(f, funciones);
                                const padre = f.requiere
                                    ? FUNCIONES.find((x) => x.id === f.requiere)?.nombre
                                    : undefined;
                                return (
                                    <FilaFuncion
                                        key={f.id}
                                        f={f}
                                        encendida={funciones[f.id] ?? f.porDefecto}
                                        ocupada={alternando === f.id}
                                        bloqueada={bloqueada}
                                        padre={padre}
                                        onToggle={() => alternarFuncion(f)}
                                    />
                                );
                            })}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
