"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Car, Check, ChevronLeft, ChevronRight, Crosshair, Home, MapPin, Plus, Sparkles, Trash2, Wrench, X } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { getAppBranding } from "@/app/actions/settings";
import { OmniLogo } from "@/components/brand/OmniLogo";
import { normalizarChapa } from "@/lib/formato-chapa";
import {
    DIAS, TENENCIAS, TIPOS_SERVICIO, TIPOS_VEHICULO, VEHICULOS_MAX, SERVICIOS_MAX,
    type Dia, type ServicioCargado, type Tenencia, type TipoServicio, type TipoVehiculo, type VehiculoCargado,
} from "@/lib/registro-padron";
import { cn } from "@/lib/utils";

/**
 * El censo del barrio: la página pública del QR (pedido 18/11, para la asamblea).
 *
 * Es la única pantalla del sistema que **no** sigue la densidad de la consola, y es a propósito.
 * El DESIGN.md dice cuerpo a 13 y secciones a 32 porque un guardia barre cien lecturas buscando
 * una chapa; acá hay una persona parada en una asamblea, con el celular en una mano, mirando UNA
 * cosa por vez y por única vez. Ahí la escala chica no ayuda: molesta. Lo que SÍ se respeta es
 * todo lo demás del sistema —un solo azul de acción, los cinco tonos sólo para estado, Outfit,
 * la gramática de radios, cero degradados de adorno—, que es lo que hace que se vea de la misma
 * familia que el resto.
 *
 * Lo otro que ordena la pantalla: **son tres pasos y ninguno obliga a completar lo que no tenés.**
 * El pedido original traía doce campos de vehículo y tres de servicio. Nadie llena eso de pie.
 * Acá el que tiene un auto termina en cuarenta segundos.
 *
 * El movimiento y los materiales siguen la skill `apple-design` (.claude/skills/apple-design),
 * que Nico pidió usar acá (18/11) porque casi todos la van a abrir desde el celular. Lo que de
 * esa guía se aplicó, y por qué:
 *
 *  · **Resortes, no duraciones.** Los pasos entran con `spring` sin rebote (bounce 0, 0.4 s):
 *    un resorte es interrumpible y arranca del valor que está en pantalla, así que tocar
 *    «seguir» dos veces rápido no produce un salto. El rebote se reserva para lo que el dedo
 *    empujó, y acá no hay gesto: son botones.
 *  · **La respuesta va en el pointer-down, no al soltar.** Cada botón se hunde al tocarlo
 *    (`active:scale`), que es la diferencia entre una pantalla viva y una que parece trabada.
 *  · **Caminos simétricos.** Si un paso entró por la derecha, al volver sale por la derecha. Que
 *    entre por un lado y salga por otro desorienta.
 *  · **La barra de abajo es un material translúcido** con el contenido pasando por debajo
 *    (.censo-barra en globals.css), con su filo claro y el respeto por el área segura del
 *    iPhone.
 *  · **Movimiento y transparencia reducidos** se respetan en CSS: fundido corto en vez de
 *    deslizamiento, barra sólida en vez de vidrio.
 */

/** El mapa entra sólo si lo piden: son ~40 KB de Leaflet que la mayoría no va a abrir. */
const MapaPunto = dynamic(() => import("@/components/mapa/MapaPunto"), { ssr: false, loading: () => <div className="h-[280px] w-full animate-pulse rounded-[10px] bg-card" /> });

const PASOS = ["Tu casa", "Vehículos", "Quién entra"] as const;

/** La bajada de la familia de marcas (material comercial, 26/10). */
const LEMA = "Ve. Verifica. Avisa.";
/** Quién lo hace. El censo lo mira gente que no sabe de dónde sale la herramienta. */
const EMPRESA = "Ingeniería en Seguridad";
/** Dónde se entera el que quiere saber qué es esto (Nico, 18/11). */
const SITIO = "https://infratec.com.uy/omniaccess/";

/** Crítico, sin rebote: lo que la guía pide para algo que no empujó un dedo (apple-design §4). */
const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.4 };
/** Hundirse al tocar. 100 ms y se acabó: la respuesta es inmediata, el retorno no se nota. */
const PULSABLE = "active:scale-[0.97] transition-transform duration-100 ease-out";

type Form = {
    lote: string; apellido: string; nombre: string; tenencia: Tenencia; telefono: string; email: string;
    vehiculos: VehiculoCargado[]; servicios: ServicioCargado[]; comentario: string;
    /** Dónde queda el lote. Opcional de punta a punta: nadie queda afuera por no marcarlo. */
    lat: number | null; lng: number | null;
};
const VACIO: Form = { lote: "", apellido: "", nombre: "", tenencia: "PROPIETARIO", telefono: "", email: "", vehiculos: [{ chapa: "", tipo: "PROPIO" }], servicios: [], comentario: "", lat: null, lng: null };
/** Lo que se va escribiendo se guarda en el teléfono: en una asamblea la señal se corta. */
const CLAVE = "oa.censo.borrador";

export function Formulario({ centro, invitacion }: {
    centro: [number, number];
    /** Cuando se entró por el enlace del correo: el lote y el correo los pone la invitación. */
    invitacion?: { clave: string; lote: string; email: string; nombre: string; lotes?: { nombre: string; vinculo: string }[];
        /** Dónde queda el lote según el plano del barrio (25/11): el punto ya viene puesto. */
        ubicacion?: [number, number] | null;
        /** A quién le llegó este enlace, cuando es la copia del código del lote a otro residente (25/11). */
        de?: string };
}) {
    /** Quien alquila u ocupa arranca marcado como inquilino: es lo que la administración ya sabe de él. */
    const tenenciaDe = (lote: string): Tenencia => { const v = invitacion?.lotes?.find((l) => l.nombre === lote)?.vinculo; return v === "INQUILINO" || v === "OCUPANTE" ? "INQUILINO" : "PROPIETARIO"; };
    const ubicacionLote = invitacion?.ubicacion || null;
    const delaInvitacion = invitacion ? { lote: invitacion.lote, email: invitacion.email, tenencia: tenenciaDe(invitacion.lote), ...(ubicacionLote ? { lat: ubicacionLote[0], lng: ubicacionLote[1] } : {}) } : null;
    const [marca, setMarca] = useState<{ name: string; barrio: string; logoUrl: string }>({ name: "OmniAccess", barrio: "", logoUrl: "" });
    const [paso, setPaso] = useState(0);
    /** Hacia dónde se va: el paso entra por donde se lo empujó y sale por el mismo lado. */
    const [sentido, setSentido] = useState(1);
    const [f, setF] = useState<Form>(delaInvitacion ? { ...VACIO, ...delaInvitacion } : VACIO);
    const [enviando, setEnviando] = useState(false);
    const [errores, setErrores] = useState<string[]>([]);
    const [listo, setListo] = useState(false);

    useEffect(() => { getAppBranding().then((b) => setMarca({ name: b.name, barrio: b.barrio, logoUrl: b.logoUrl })).catch(() => { }); }, []);
    useEffect(() => {
        try {
            const v = localStorage.getItem(CLAVE);
            if (!v) return;
            const guardado = JSON.parse(v);
            // El lote y el correo de la invitación le ganan al borrador: si no, el que entra con el
            // enlace del C7 después de haber mirado el del B4 carga el padrón equivocado.
            /* Con varios lotes, el que venía eligiendo en el borrador vale si es uno de los suyos. */
            const suyo = invitacion?.lotes?.some((l) => l.nombre === guardado.lote) ? guardado.lote : invitacion?.lote;
            /* El punto del plano le gana a un borrador sin punto o con uno lejos (más de 60 m: el GPS
               de adentro de una casa, que es justo lo que no se podía corregir). Uno cerca, que la
               persona ajustó a mano, se respeta. */
            const ub = ubicacionLote && (guardado.lat == null || guardado.lng == null || metrosEntre([guardado.lat, guardado.lng], ubicacionLote) > 60)
                ? { lat: ubicacionLote[0], lng: ubicacionLote[1] } : {};
            setF({ ...VACIO, ...guardado, ...(invitacion ? { lote: suyo, email: invitacion.email || guardado.email || "" } : {}), ...ub });
        } catch { /* sin borrador */ }
    }, [invitacion, ubicacionLote]);
    useEffect(() => { try { localStorage.setItem(CLAVE, JSON.stringify(f)); } catch { /* el navegador puede no dejar */ } }, [f]);

    const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
    /** Cambiar de paso vuelve arriba: si no, el que venía abajo del paso largo entra al siguiente
     *  por la mitad y cree que le falta algo. */
    const irA = (n: number) => { setSentido(n > paso ? 1 : -1); setPaso(n); try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* da igual */ } };
    /* Lo obligatorio del primer paso (18/11, Nico): lote, apellido, celular, correo y el punto en
       el mapa. El correo es por donde vuelve el aviso del alta; el punto es lo que pone la casa en
       el plano, y sin él alguien tiene que ubicar trescientos lotes a mano. */
    const correoSirve = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(f.email.trim());
    const puedeSeguir = paso > 0 || !!(f.lote.trim() && f.apellido.trim().length >= 2
        && f.telefono.replace(/\D/g, "").length >= 8 && correoSirve && f.lat != null && f.lng != null);

    async function enviar() {
        setEnviando(true); setErrores([]);
        try {
            const r = await fetch("/api/registro", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, clave: invitacion?.clave, de: invitacion?.de }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { setErrores(j?.errores?.length ? j.errores : [j?.error || "No se pudo enviar. Probá de nuevo."]); return; }
            try { localStorage.removeItem(CLAVE); } catch { /* da igual */ }
            setListo(true);
        } catch {
            setErrores(["No se pudo enviar: revisá la señal y probá de nuevo. Lo que escribiste quedó guardado."]);
        } finally { setEnviando(false); }
    }

    if (listo) return <Gracias marca={marca} lote={f.lote} vehiculos={f.vehiculos.filter((v) => v.chapa.trim()).length} servicios={f.servicios.length} ubicado={f.lat != null} />;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <Cabecera marca={marca} />

            <main className="mx-auto w-full max-w-[640px] px-4">
                {/* La portada es de la primera pantalla. En los pasos siguientes se va: si se queda,
                    el que llega al paso 3 tiene que pasar por arriba del título cada vez. */}
                <AnimatePresence initial={false}>
                    {paso === 0 && (
                        <motion.div key="portada" initial={false} exit={{ opacity: 0, height: 0 }} transition={RESORTE} className="overflow-hidden">
                            <Portada barrio={marca.barrio} />
                        </motion.div>
                    )}
                </AnimatePresence>
                {paso > 0 && <div className="pt-6" />}

                <Progreso paso={paso} />

                <AnimatePresence mode="wait" initial={false} custom={sentido}>
                    <motion.div key={paso} custom={sentido} className="censo-paso"
                        initial={{ opacity: 0, x: 22 * sentido }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -22 * sentido }}
                        transition={RESORTE}>
                        {paso === 0 && <PasoCasa f={f} set={set} centro={centro} delPlano={ubicacionLote} loteFijo={!!invitacion} lotes={invitacion?.lotes} alElegirLote={(l) => setF((v) => ({ ...v, lote: l, tenencia: tenenciaDe(l) }))} />}
                        {paso === 1 && <PasoVehiculos f={f} set={set} />}
                        {paso === 2 && <PasoServicios f={f} set={set} />}
                    </motion.div>
                </AnimatePresence>

                {errores.length > 0 && (
                    <div className="mt-5 rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] chip-mal p-3.5">
                        <p className="text-[13px] font-bold">Revisá esto antes de enviar</p>
                        <ul className="mt-1.5 space-y-1 text-[13px] leading-snug">{errores.map((e, i) => <li key={i}>· {e}</li>)}</ul>
                    </div>
                )}
            </main>

            {/* el pb-28 vive acá y no en <main>: lo que tiene que esquivar la barra fija es lo último de la página */}
            <Pie conBarra />

            <nav className="censo-barra fixed inset-x-0 bottom-0">
                <div className="mx-auto flex w-full max-w-[640px] items-center gap-3 px-4 pt-3">
                    {paso > 0 && (
                        <button type="button" onClick={() => irA(paso - 1)} disabled={enviando}
                            className={cn("h-12 w-12 shrink-0 grid place-items-center rounded-[10px] border border-border hover:bg-accent disabled:opacity-50", PULSABLE)} aria-label="Volver">
                            <ChevronLeft size={18} />
                        </button>
                    )}
                    {paso < PASOS.length - 1 ? (
                        <button type="button" onClick={() => irA(paso + 1)} disabled={!puedeSeguir}
                            className={cn("h-12 flex-1 rounded-[10px] bg-[var(--accion)] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40", PULSABLE)}>
                            Seguir <ChevronRight size={18} />
                        </button>
                    ) : (
                        <button type="button" onClick={enviar} disabled={enviando}
                            className={cn("h-12 flex-1 rounded-[10px] bg-[var(--accion)] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60", PULSABLE)}>
                            {enviando ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Enviar
                        </button>
                    )}
                </div>
            </nav>
        </div>
    );
}

/**
 * Arriba va OmniAccess y a la derecha el barrio, en ese orden y no al revés.
 *
 * Antes la cabecera mostraba el logo del barrio si estaba cargado, y si no, el nombre en texto: el
 * formulario no se veía de nadie. El pedido era justamente ese («la única oportunidad que más de
 * 300 personas conozcan la empresa»), así que la marca va siempre dibujada y el barrio queda como
 * el contexto que es: para quién es este censo.
 */
function Cabecera({ marca }: { marca: { name: string; barrio: string; logoUrl: string } }) {
    const propia = marca.name === "OmniAccess";
    return (
        <div className="border-b border-border">
            <div className="mx-auto flex w-full max-w-[640px] items-center gap-2.5 px-4 py-3.5">
                <OmniLogo size={26} className="shrink-0" />
                <span className="text-[17px] font-bold tracking-[-0.02em] leading-none">
                    {propia ? <>Omni<span className="font-normal">Access</span></> : marca.name}
                </span>
                {marca.logoUrl
                    ? (
                        <span className="ml-auto flex min-w-0 items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={marca.logoUrl} alt={marca.barrio || "logo del barrio"} className="h-6 max-w-[120px] object-contain" />
                        </span>
                    )
                    : marca.barrio && <span className="ml-auto truncate text-[12px] font-semibold text-muted-foreground">{marca.barrio}</span>}
            </div>
        </div>
    );
}

/**
 * La portada.
 *
 * El isotipo de OmniAccess **es** un recuadro de detección: las cuatro esquinas que OmniVision
 * dibuja sobre lo que ve. Acá ese recuadro se agranda hasta encuadrar el título, y traba — que es
 * literalmente lo que hace el producto, y lo que la gente va a ver cuando el portón les lea la
 * matrícula. Es la misma idea del ident («Enfoque», 10/11), hecha con cuatro divs en vez de 3D.
 *
 * Después pasa una línea de barrido, una sola vez: es el gesto de «te estoy leyendo». Una sola,
 * porque algo que parpadea sin parar en una pantalla donde hay que escribir es ruido.
 *
 * Con movimiento reducido no hay nada de esto: el recuadro aparece puesto.
 */
function Portada({ barrio }: { barrio: string }) {
    const quieto = useReducedMotion();
    const esquina = (i: number, clases: string, dx: number, dy: number) => (
        <motion.span aria-hidden key={i} className={cn("absolute h-6 w-6 border-[var(--accion)]", clases)}
            initial={quieto ? false : { opacity: 0, x: dx, y: dy }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ ...RESORTE, delay: 0.08 + i * 0.05 }} />
    );
    return (
        <header className="pb-7 pt-9">
            <div className="relative px-5 py-5">
                {esquina(0, "left-0 top-0 rounded-tl-[8px] border-l-2 border-t-2", -14, -14)}
                {esquina(1, "right-0 top-0 rounded-tr-[8px] border-r-2 border-t-2", 14, -14)}
                {esquina(2, "right-0 bottom-0 rounded-br-[8px] border-b-2 border-r-2", 14, 14)}
                {esquina(3, "left-0 bottom-0 rounded-bl-[8px] border-b-2 border-l-2", -14, 14)}

                {/* el barrido: una pasada y se va */}
                {!quieto && (
                    <motion.span aria-hidden className="censo-barrido"
                        initial={{ top: "0%", opacity: 0 }}
                        animate={{ top: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
                        transition={{ duration: 1.1, delay: 0.42, ease: "easeInOut" }} />
                )}

                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    <motion.span aria-hidden className="censo-punto"
                        initial={quieto ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ ...RESORTE, delay: 0.5 }} />
                    Censo de vehículos{barrio ? ` · ${barrio}` : ""}
                </p>
                <h1 className="censo-titulo mt-2.5 font-bold">Que la entrada te conozca</h1>
            </div>

            <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">
                {/* Nada de «la barrera se abre sola»: San Nicolás no tiene barreras, y prometer en un
                    formulario algo que el barrio no tiene es la peor forma de empezar. Lo que SÍ pasa en
                    todas las instalaciones es que la cámara lee y la guardia ya sabe quién llega. */}
                Cargá las matrículas que entran a tu casa y quién te visita seguido. La cámara las lee en la
                entrada y la guardia ya sabe quién llega: no tenés que parar a dar explicaciones. Son dos
                minutos y lo hacés una sola vez.
            </p>
        </header>
    );
}

/**
 * El pie: quién hizo esto y qué pasa con lo que la persona acaba de escribir.
 *
 * Las dos cosas son la misma pregunta para alguien que carga la matrícula de su auto en un
 * formulario que le llegó por QR en una asamblea. Si no está escrito, lo pregunta — y en una
 * asamblea lo pregunta en voz alta.
 */
function Pie({ conBarra = false }: { conBarra?: boolean }) {
    return (
        <footer className={cn("mt-12 border-t border-border px-4 pt-6", conBarra ? "pb-28" : "pb-10")}>
            <div className="mx-auto w-full max-w-[640px]">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <OmniLogo size={20} className="mr-0.5 shrink-0" />
                    <span className="text-[13px] font-bold tracking-[-0.01em]">Omni<span className="font-normal">Access</span></span>
                    <span className="text-[12px] text-muted-foreground">· {LEMA}</span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                    Control de acceso por matrícula, con la foto de cada paso. Un desarrollo de {EMPRESA}.
                    Los datos que cargás quedan en el servidor del barrio y los usa la administración para
                    darte de alta.
                </p>
                {/* El censo lo abren trescientas personas que no saben qué es OmniAccess: una línea
                    para que puedan averiguarlo, sin robarle la pantalla al formulario. */}
                <a href={SITIO} target="_blank" rel="noopener noreferrer"
                    className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold tono-accion hover:underline">
                    Conocé OmniAccess <ArrowUpRight size={14} />
                </a>
            </div>
        </footer>
    );
}

function Progreso({ paso }: { paso: number }) {
    return (
        <div className="mb-6 flex items-center gap-2">
            {PASOS.map((p, i) => (
                <div key={p} className="flex-1">
                    <div className={cn("h-1 rounded-full transition-colors", i <= paso ? "bg-[var(--accion)]" : "bg-border")} />
                    <p className={cn("mt-1.5 text-[11px] font-semibold", i === paso ? "text-foreground" : "text-muted-foreground")}>{p}</p>
                </div>
            ))}
        </div>
    );
}

/* ── Piezas de formulario, en la escala de esta pantalla (no la de la consola) ── */

function Campo({ rotulo, ayuda, children }: { rotulo: string; ayuda?: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-[13px] font-semibold mb-1.5">{rotulo}</span>
            {children}
            {ayuda && <span className="block mt-1 text-[12px] text-muted-foreground leading-snug">{ayuda}</span>}
        </label>
    );
}

const ENTRADA = "w-full h-12 rounded-[10px] border border-border bg-card px-3.5 text-[15px] outline-none focus:ring-2 focus:ring-[var(--accion)]/30 focus:border-[var(--accion)] transition-shadow";

function Seccion({ icono: I, titulo, children }: { icono: typeof Car; titulo: string; children: React.ReactNode }) {
    return (
        <section className="space-y-4">
            <h2 className="flex items-center gap-2 text-[17px] font-bold"><I size={17} className="tono-accion" /> {titulo}</h2>
            {children}
        </section>
    );
}

function PasoCasa({ f, set, centro, delPlano, loteFijo, lotes, alElegirLote }: {
    f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; centro: [number, number]; loteFijo?: boolean;
    /** El punto del lote según el plano del barrio, si se sabe. */
    delPlano?: [number, number] | null;
    /** Los lotes de la invitación, cuando son más de uno: se elige para cuál es esta carga. */
    lotes?: { nombre: string; vinculo: string }[]; alElegirLote?: (lote: string) => void;
}) {
    const varios = (lotes?.length || 0) > 1;
    return (
        <Seccion icono={Home} titulo="Tu casa">
            {/* Quien tiene más de un lote carga uno por vez: los vehículos de una casa no son los de la otra. */}
            {varios && (
                <div className="mb-3">
                    <span className="block text-[13px] font-semibold mb-1.5">Tenés {lotes!.length} lotes. ¿Para cuál es esta carga?</span>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Lote">
                        {lotes!.map((l) => (
                            <button key={l.nombre} type="button" role="radio" aria-checked={f.lote === l.nombre} onClick={() => alElegirLote?.(l.nombre)}
                                className={cn("h-11 px-4 rounded-full border text-[14px] font-bold tabular-nums transition-colors", f.lote === l.nombre ? "bg-foreground text-background border-foreground" : "border-border bg-background")}>{l.nombre}</button>
                        ))}
                    </div>
                    <p className="mt-1.5 text-[12px] text-muted-foreground">Cuando termines con éste, entrás de nuevo por el mismo enlace y cargás el otro.</p>
                </div>
            )}
            <div className="grid grid-cols-2 gap-3">
                {/* Con invitación el lote no se escribe: lo trae la clave del correo, y dejarlo
                    editable sería ofrecer cargar el padrón del vecino. */}
                <Campo rotulo="Lote" ayuda={loteFijo ? "Viene de tu invitación." : undefined}>
                    <input value={f.lote} onChange={(e) => set("lote", e.target.value)} placeholder="B4" readOnly={loteFijo}
                        autoCapitalize="characters" className={cn(ENTRADA, "tabular-nums font-bold", !loteFijo && "uppercase", loteFijo && "bg-muted/60 text-muted-foreground")} />
                </Campo>
                <Campo rotulo="Apellido"><input value={f.apellido} onChange={(e) => set("apellido", e.target.value)} placeholder="Pérez" autoCapitalize="words" className={ENTRADA} /></Campo>
            </div>
            <Campo rotulo="Nombre" ayuda="Opcional."><input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} autoCapitalize="words" className={ENTRADA} /></Campo>
            <Campo rotulo="Celular" ayuda="Es por donde te avisamos. No se comparte con nadie.">
                <input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} placeholder="099 123 456" inputMode="tel" className={cn(ENTRADA, "tabular-nums")} />
            </Campo>
            <Campo rotulo="Correo" ayuda="Ahí te avisamos cuando quede dado de alta.">
                <input value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="nombre@correo.com" inputMode="email" autoCapitalize="none" className={ENTRADA} />
            </Campo>
            <div>
                <span className="block text-[13px] font-semibold mb-1.5">¿Cómo vivís en el lote?</span>
                <div className="grid grid-cols-2 gap-2">
                    {TENENCIAS.map((t) => (
                        <button key={t.id} type="button" onClick={() => set("tenencia", t.id)}
                            className={cn("h-12 rounded-[10px] border text-[14px] font-semibold transition-colors", PULSABLE,
                                f.tenencia === t.id ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                            {t.rotulo}
                        </button>
                    ))}
                </div>
            </div>
            {delPlano ? <UbicacionDelPlano f={f} set={set} delPlano={delPlano} /> : <Ubicacion f={f} set={set} centro={centro} />}
        </Seccion>
    );
}

/**
 * El campo de matrícula, dibujado como una matrícula.
 *
 * No es decoración: la persona está cargando el dato que la cámara va a leer en la entrada, y
 * verlo tomar forma de chapa mientras lo escribe es la única parte del censo donde se entiende
 * de un vistazo para qué sirve todo esto. El molde es el del Mercosur, que es el que se usa acá.
 */
function Chapa({ valor, alCambiar, tono, alto = true }: {
    valor: string; alCambiar: (v: string) => void; tono: "bien" | "aviso" | null; alto?: boolean;
}) {
    return (
        <div className="censo-chapa" data-tono={tono || undefined}>
            <div className="censo-chapa-banda">Uruguay</div>
            <input value={valor} onChange={(e) => alCambiar(e.target.value.toUpperCase())} placeholder="ABC 1234"
                autoCapitalize="characters" autoCorrect="off" spellCheck={false} inputMode="text"
                aria-label="Matrícula" style={alto ? undefined : { height: 42, fontSize: 20 }} />
        </div>
    );
}

/**
 * Dónde queda el lote. Opcional, y se dice que es opcional.
 *
 * Sirve para dos cosas concretas: que el lote quede dibujado en el mapa del barrio sin que nadie
 * lo marque a mano uno por uno (son más de trescientos), y que un aviso de la guardia sepa a qué
 * casa ir. Por eso se pide acá y no después.
 *
 * El GPS de un teléfono adentro de una casa se corre; cuando viene con poca precisión se abre el
 * mapa en vez de dar el punto por bueno.
 */
function Ubicacion({ f, set, centro }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; centro: [number, number] }) {
    const [mapa, setMapa] = useState(false);
    const [buscando, setBuscando] = useState(false);
    const [aviso, setAviso] = useState("");
    const punto: [number, number] | null = f.lat != null && f.lng != null ? [f.lat, f.lng] : null;

    const marcar = (lat: number, lng: number) => { set("lat", lat); set("lng", lng); };

    function usarGps() {
        if (!navigator.geolocation) { setAviso("Este teléfono no da la ubicación. Marcala en el mapa."); setMapa(true); return; }
        setBuscando(true); setAviso("");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setBuscando(false);
                marcar(Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6)));
                setMapa(true);
                // 50 m es media manzana: con eso el punto puede caer en la casa del vecino.
                if (pos.coords.accuracy > 50) setAviso("El GPS no está fino acá adentro. Movelo hasta tu casa.");
            },
            (e) => {
                setBuscando(false);
                setAviso(e.code === e.PERMISSION_DENIED
                    ? "No nos diste permiso de ubicación. Podés marcarla en el mapa."
                    : "No se pudo leer el GPS. Marcala en el mapa.");
                setMapa(true);
            },
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
        );
    }

    return (
        <div className="rounded-[10px] border border-border bg-card p-3.5">
            <div className="flex items-start gap-2">
                <MapPin size={16} className="mt-0.5 shrink-0 tono-accion" />
                <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold">¿Dónde queda tu lote?</p>
                    <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                        Para que tu casa quede en el mapa del barrio y la guardia sepa adónde ir. Hace falta
                        para poder enviar.
                    </p>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={usarGps} disabled={buscando}
                    className={cn("h-11 rounded-[10px] border border-border text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-accent disabled:opacity-60", PULSABLE)}>
                    {buscando ? <Loader2 size={15} className="animate-spin" /> : <Crosshair size={15} />} Mi ubicación
                </button>
                <button type="button" onClick={() => setMapa((v) => !v)}
                    className={cn("h-11 rounded-[10px] border border-border text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-accent", PULSABLE)}>
                    <MapPin size={15} /> {mapa ? "Cerrar mapa" : "En el mapa"}
                </button>
            </div>

            {aviso && <p className="mt-2 text-[12.5px] leading-snug tono-aviso">{aviso}</p>}

            <AnimatePresence initial={false}>
                {mapa && (
                    <motion.div key="mapa" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={RESORTE} className="overflow-hidden">
                        <div className="pt-3">
                            <MapaPunto punto={punto} centro={centro} alElegir={marcar} />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {punto && (
                <div className="mt-2.5 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full chip-bien px-2.5 py-1 text-[12px] font-bold">
                        <Check size={13} /> Ubicación marcada
                    </span>
                    <span className="truncate text-[11.5px] tabular-nums text-muted-foreground">{punto[0].toFixed(5)}, {punto[1].toFixed(5)}</span>
                    <button type="button" onClick={() => { set("lat", null); set("lng", null); }}
                        className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:text-[var(--mal)]" aria-label="Quitar la ubicación">
                        <X size={13} />
                    </button>
                </div>
            )}
        </div>
    );
}

/** Distancia aproximada en metros entre dos puntos (alcanza para saber si un punto está en la casa o a media cuadra). */
function metrosEntre(a: [number, number], b: [number, number]): number {
    const k = Math.cos((a[0] * Math.PI) / 180);
    return Math.hypot((a[0] - b[0]) * 110_574, (a[1] - b[1]) * 111_320 * k);
}

/**
 * La ubicación cuando el lote ya está en el plano del barrio (25/11).
 *
 * Nico: «tienen que corregir el GPS de la ubicación de las casas: no lo toma automático, y mover el
 * punto hasta tu casa es imposible y poco agradable». El GPS de un teléfono adentro de una casa se
 * corre media cuadra, y arrastrar un mapa satelital con el pulgar hasta el techo propio es justo lo
 * que nadie quiere hacer para cargar sus autos. Cada lote ya tiene su punto, sacado del croquis del
 * barrio calibrado contra el mapa: viene puesto, se muestra para que la persona lo reconozca, y sólo
 * si no es su casa abre el mapa para corregirlo.
 */
function UbicacionDelPlano({ f, set, delPlano }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; delPlano: [number, number] }) {
    const [corrigiendo, setCorrigiendo] = useState(false);
    const punto: [number, number] = f.lat != null && f.lng != null ? [f.lat, f.lng] : delPlano;
    const movido = metrosEntre(punto, delPlano) > 3;
    const marcar = (lat: number, lng: number) => { set("lat", Number(lat.toFixed(6))); set("lng", Number(lng.toFixed(6))); };
    return (
        <div className="rounded-[10px] border border-border bg-card p-3.5">
            <div className="flex items-start gap-2">
                <MapPin size={16} className="mt-0.5 shrink-0 tono-accion" />
                <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold">Tu lote ya está ubicado</p>
                    <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                        Lo tomamos del plano del barrio: no tenés que hacer nada. Si el punto no cae en tu casa, corregilo.
                    </p>
                </div>
            </div>
            <div className="pt-3">
                {/* Mirar, sin arrastrar: así nadie lo corre sin querer al bajar por la página. */}
                {corrigiendo ? <MapaPunto punto={punto} centro={delPlano} alElegir={marcar} /> : <MapaPunto punto={punto} centro={delPlano} soloVer alto={180} />}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full chip-bien px-2.5 py-1 text-[12px] font-bold">
                    <Check size={13} /> {movido ? "Ubicación corregida" : "Ubicación del plano"}
                </span>
                <div className="ml-auto flex gap-1.5">
                    {movido && (
                        <button type="button" onClick={() => { set("lat", delPlano[0]); set("lng", delPlano[1]); setCorrigiendo(false); }}
                            className={cn("h-8 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-accent", PULSABLE)}>Volver a la del plano</button>
                    )}
                    <button type="button" onClick={() => setCorrigiendo((v) => !v)}
                        className={cn("h-8 rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-accent", PULSABLE)}>
                        {corrigiendo ? "Listo" : "No es mi casa: corregir"}
                    </button>
                </div>
            </div>
        </div>
    );
}

/** La matrícula, mientras se escribe: el mismo molde con el que leen las cámaras. */
function estadoChapa(v: string): { tono: "bien" | "aviso" | null; dice: string } {
    const s = v.trim();
    if (s.length < 5) return { tono: null, dice: "" };
    const n = normalizarChapa(s);
    if (!n) return { tono: "aviso", dice: "Eso no tiene forma de matrícula." };
    if (n.cambios > 0) return { tono: "aviso", dice: `¿Es ${n.plate}? Hay letras y números que se parecen.` };
    return { tono: "bien", dice: "Las cámaras la van a leer así." };
}

function PasoVehiculos({ f, set }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void }) {
    const cambiar = (i: number, v: Partial<VehiculoCargado>) => set("vehiculos", f.vehiculos.map((x, j) => (j === i ? { ...x, ...v } : x)));
    return (
        <Seccion icono={Car} titulo="Vehículos que entran">
            <p className="-mt-1 text-[14px] leading-relaxed text-muted-foreground">
                Los de la casa, los de la familia que entra sin avisar y los de quien viene a trabajar. Agregá los
                que tengas: no hay que llenar todo.
            </p>
            {f.vehiculos.map((v, i) => {
                const est = estadoChapa(v.chapa);
                return (
                    <motion.div key={i} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={RESORTE}
                        className="rounded-[10px] border border-border bg-card p-3.5 space-y-3">
                        <div className="flex items-start gap-2">
                            <div className="flex-1">
                                {/* El tono del estado va en la chapa misma: la que hay que revisar se ve
                                    marcada mientras se la escribe, que es cuando sirve verla. */}
                                <Chapa valor={v.chapa} alCambiar={(x) => cambiar(i, { chapa: x })} tono={est.tono} />
                                {est.dice && <p className={cn("mt-1.5 text-[12.5px] leading-snug", est.tono === "bien" ? "tono-bien" : "tono-aviso")}>{est.dice}</p>}
                            </div>
                            {f.vehiculos.length > 1 && (
                                <button type="button" onClick={() => set("vehiculos", f.vehiculos.filter((_, j) => j !== i))}
                                    className="h-[71px] w-11 shrink-0 grid place-items-center rounded-[10px] border border-border text-muted-foreground hover:text-[var(--mal)]" aria-label="Quitar">
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {TIPOS_VEHICULO.map((t) => (
                                <button key={t.id} type="button" onClick={() => cambiar(i, { tipo: t.id as TipoVehiculo })}
                                    className={cn("h-10 rounded-full border text-[12.5px] font-semibold px-2 transition-colors", PULSABLE,
                                        v.tipo === t.id ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                                    {t.rotulo}
                                </button>
                            ))}
                        </div>
                        {v.tipo !== "PROPIO" && (
                            <input value={v.quien || ""} onChange={(e) => cambiar(i, { quien: e.target.value })}
                                placeholder={v.tipo === "FAMILIAR" ? "¿De quién es? (opcional)" : "¿Qué empresa o servicio? (opcional)"} className={cn(ENTRADA, "h-11 text-[14px]")} />
                        )}
                    </motion.div>
                );
            })}
            {f.vehiculos.length < VEHICULOS_MAX && (
                <button type="button" onClick={() => set("vehiculos", [...f.vehiculos, { chapa: "", tipo: "PROPIO" }])}
                    className={cn("w-full h-12 rounded-[10px] border border-dashed border-border text-[14px] font-semibold text-muted-foreground hover:bg-accent inline-flex items-center justify-center gap-2", PULSABLE)}>
                    <Plus size={16} /> Agregar otro vehículo
                </button>
            )}
        </Seccion>
    );
}

function PasoServicios({ f, set }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void }) {
    const cambiar = (i: number, v: Partial<ServicioCargado>) => set("servicios", f.servicios.map((x, j) => (j === i ? { ...x, ...v } : x)));
    const alternarDia = (i: number, d: Dia) => {
        const s = f.servicios[i];
        cambiar(i, { dias: s.dias.includes(d) ? s.dias.filter((x) => x !== d) : [...s.dias, d] });
    };
    return (
        <Seccion icono={Wrench} titulo="Quién entra seguido">
            <p className="-mt-1 text-[14px] leading-relaxed text-muted-foreground">
                El jardinero, el piscinero, la limpieza. Con el día y la hora, la guardia sabe que los espera y no
                te llama cada vez.
            </p>
            {f.servicios.map((s, i) => (
                <motion.div key={i} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={RESORTE}
                    className="rounded-[10px] border border-border bg-card p-3.5 space-y-3">
                    <div className="flex items-center gap-2">
                        <select value={s.tipo} onChange={(e) => cambiar(i, { tipo: e.target.value as TipoServicio })} className={cn(ENTRADA, "h-11 flex-1 text-[14px]")}>
                            {TIPOS_SERVICIO.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
                        </select>
                        <button type="button" onClick={() => set("servicios", f.servicios.filter((_, j) => j !== i))}
                            className="h-11 w-11 shrink-0 grid place-items-center rounded-[10px] border border-border text-muted-foreground hover:text-[var(--mal)]" aria-label="Quitar">
                            <Trash2 size={16} />
                        </button>
                    </div>
                    <input value={s.nombre || ""} onChange={(e) => cambiar(i, { nombre: e.target.value })} placeholder="Nombre (opcional)" autoCapitalize="words" className={cn(ENTRADA, "h-11 text-[14px]")} />
                    <div className="flex flex-wrap gap-1.5">
                        {DIAS.map((d) => (
                            <button key={d} type="button" onClick={() => alternarDia(i, d)}
                                className={cn("h-9 w-11 rounded-full border text-[12.5px] font-semibold capitalize transition-colors", PULSABLE,
                                    s.dias.includes(d) ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                                {d}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <Campo rotulo="Desde"><input type="time" value={s.desde || ""} onChange={(e) => cambiar(i, { desde: e.target.value })} className={cn(ENTRADA, "h-11 text-[14px] tabular-nums")} /></Campo>
                        <Campo rotulo="Hasta"><input type="time" value={s.hasta || ""} onChange={(e) => cambiar(i, { hasta: e.target.value })} className={cn(ENTRADA, "h-11 text-[14px] tabular-nums")} /></Campo>
                    </div>
                    <Campo rotulo="Matrícula" ayuda="Si viene siempre en el mismo vehículo. Opcional.">
                        <Chapa valor={s.chapa || ""} alCambiar={(x) => cambiar(i, { chapa: x })} tono={estadoChapa(s.chapa || "").tono} alto={false} />
                    </Campo>
                </motion.div>
            ))}
            {f.servicios.length < SERVICIOS_MAX && (
                <button type="button" onClick={() => set("servicios", [...f.servicios, { tipo: "JARDINERO", dias: [] }])}
                    className={cn("w-full h-12 rounded-[10px] border border-dashed border-border text-[14px] font-semibold text-muted-foreground hover:bg-accent inline-flex items-center justify-center gap-2", PULSABLE)}>
                    <Plus size={16} /> Agregar un servicio
                </button>
            )}
            <Campo rotulo="Algo más que tengamos que saber" ayuda="Opcional.">
                <textarea value={f.comentario} onChange={(e) => set("comentario", e.target.value)} rows={3}
                    className={cn(ENTRADA, "h-auto py-3 text-[14px] leading-relaxed resize-none")} />
            </Campo>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
                Lo que cargás lo revisa la administración del barrio antes de darlo de alta. Se usa sólo para el
                control de acceso: no se comparte ni se publica.
            </p>
        </Seccion>
    );
}

function Gracias({ marca, lote, vehiculos, servicios, ubicado }: {
    marca: { name: string; barrio: string; logoUrl: string };
    lote: string; vehiculos: number; servicios: number; ubicado: boolean;
}) {
    const quieto = useReducedMotion();
    const linea = [
        vehiculos > 0 ? `${vehiculos} ${vehiculos === 1 ? "matrícula" : "matrículas"}` : null,
        servicios > 0 ? `${servicios} ${servicios === 1 ? "servicio" : "servicios"}` : null,
        ubicado ? "la ubicación del lote" : null,
    ].filter(Boolean) as string[];
    const dice = linea.length ? linea.join(", ").replace(/, ([^,]*)$/, " y $1") : "tus datos";

    return (
        <div className="min-h-screen bg-background text-foreground">
            <Cabecera marca={marca} />
            <main className="mx-auto w-full max-w-[640px] px-4 pt-14 text-center">
                {/* El mismo recuadro de la portada, pero cerrado sobre el isotipo: lo que la
                    persona acaba de hacer es, justamente, quedar dentro del cuadro. */}
                <div className="relative mx-auto grid h-24 w-24 place-items-center">
                    {[
                        ["left-0 top-0 rounded-tl-[10px] border-l-[3px] border-t-[3px]", -16, -16],
                        ["right-0 top-0 rounded-tr-[10px] border-r-[3px] border-t-[3px]", 16, -16],
                        ["right-0 bottom-0 rounded-br-[10px] border-b-[3px] border-r-[3px]", 16, 16],
                        ["left-0 bottom-0 rounded-bl-[10px] border-b-[3px] border-l-[3px]", -16, 16],
                    ].map(([clases, dx, dy], k) => (
                        <motion.span aria-hidden key={k} className={cn("absolute h-7 w-7 border-[var(--bien)]", clases as string)}
                            initial={quieto ? false : { opacity: 0, x: dx as number, y: dy as number }}
                            animate={{ opacity: 1, x: 0, y: 0 }} transition={{ ...RESORTE, delay: 0.05 + k * 0.05 }} />
                    ))}
                    <motion.span initial={quieto ? false : { scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        transition={{ ...RESORTE, delay: 0.26 }} className="tono-bien">
                        <Check size={42} strokeWidth={2.6} />
                    </motion.span>
                </div>

                <h1 className="mt-7 text-[28px] font-bold leading-tight tracking-[-0.02em]">Listo, lote {lote}</h1>
                <p className="mx-auto mt-3 max-w-[460px] text-[15px] leading-relaxed text-muted-foreground">
                    Cargaste {dice}. La administración lo revisa y lo da de alta en los próximos días.
                    Si falta algo, volvé a escanear el QR y cargalo de nuevo.
                </p>

                <div className="mx-auto mt-8 max-w-[460px] rounded-[10px] border border-border bg-card p-4 text-left">
                    <p className="flex items-center gap-2 text-[14px] font-bold"><Sparkles size={15} className="tono-accion" /> Lo que viene</p>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                        Cuando esté aprobado, la cámara reconoce tu matrícula al llegar y la guardia te ve
                        entrar sin que tengas que avisar. Lo que pasa en tu entrada queda registrado con su foto.
                    </p>
                </div>
            </main>

            <Pie />
        </div>
    );
}
