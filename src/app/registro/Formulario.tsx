"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Car, Check, ChevronLeft, ChevronRight, Home, Loader2, Plus, ShieldCheck, Sparkles, Trash2, Wrench } from "lucide-react";
import { getAppBranding } from "@/app/actions/settings";
import { EMPRESA, LEMA, MarcaOmni } from "@/components/marca/MarcaOmni";
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

const PASOS = ["Tu casa", "Vehículos", "Quién entra"] as const;

/** Crítico, sin rebote: lo que la guía pide para algo que no empujó un dedo (apple-design §4). */
const RESORTE = { type: "spring" as const, bounce: 0, duration: 0.4 };
/** Hundirse al tocar. 100 ms y se acabó: la respuesta es inmediata, el retorno no se nota. */
const PULSABLE = "active:scale-[0.97] transition-transform duration-100 ease-out";

type Form = {
    lote: string; apellido: string; nombre: string; tenencia: Tenencia; telefono: string; email: string;
    vehiculos: VehiculoCargado[]; servicios: ServicioCargado[]; comentario: string;
};
const VACIO: Form = { lote: "", apellido: "", nombre: "", tenencia: "PROPIETARIO", telefono: "", email: "", vehiculos: [{ chapa: "", tipo: "PROPIO" }], servicios: [], comentario: "" };
/** Lo que se va escribiendo se guarda en el teléfono: en una asamblea la señal se corta. */
const CLAVE = "oa.censo.borrador";

export function Formulario() {
    const [marca, setMarca] = useState<{ name: string; barrio: string; logoUrl: string }>({ name: "OmniAccess", barrio: "", logoUrl: "" });
    const [paso, setPaso] = useState(0);
    /** Hacia dónde se va: el paso entra por donde se lo empujó y sale por el mismo lado. */
    const [sentido, setSentido] = useState(1);
    const [f, setF] = useState<Form>(VACIO);
    const [enviando, setEnviando] = useState(false);
    const [errores, setErrores] = useState<string[]>([]);
    const [listo, setListo] = useState(false);

    useEffect(() => { getAppBranding().then((b) => setMarca({ name: b.name, barrio: b.barrio, logoUrl: b.logoUrl })).catch(() => { }); }, []);
    useEffect(() => { try { const v = localStorage.getItem(CLAVE); if (v) setF({ ...VACIO, ...JSON.parse(v) }); } catch { /* sin borrador */ } }, []);
    useEffect(() => { try { localStorage.setItem(CLAVE, JSON.stringify(f)); } catch { /* el navegador puede no dejar */ } }, [f]);

    const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
    const puedeSeguir = paso > 0 || (f.lote.trim() && f.apellido.trim().length >= 2 && f.telefono.replace(/\D/g, "").length >= 8);

    async function enviar() {
        setEnviando(true); setErrores([]);
        try {
            const r = await fetch("/api/registro", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { setErrores(j?.errores?.length ? j.errores : [j?.error || "No se pudo enviar. Probá de nuevo."]); return; }
            try { localStorage.removeItem(CLAVE); } catch { /* da igual */ }
            setListo(true);
        } catch {
            setErrores(["No se pudo enviar: revisá la señal y probá de nuevo. Lo que escribiste quedó guardado."]);
        } finally { setEnviando(false); }
    }

    if (listo) return <Gracias marca={marca} lote={f.lote} vehiculos={f.vehiculos.filter((v) => v.chapa.trim()).length} />;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <Cabecera marca={marca} />

            <main className="mx-auto w-full max-w-[640px] px-4">
                <header className="pt-8 pb-6">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] tono-accion">Censo de vehículos</p>
                    <h1 className="censo-titulo mt-2 font-bold">
                        Que el portón te conozca
                    </h1>
                    <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
                        Cargá las matrículas que entran a tu casa y quién te visita seguido. Son dos minutos y lo
                        hacés una sola vez.
                    </p>
                </header>

                <Progreso paso={paso} />

                <AnimatePresence mode="wait" initial={false} custom={sentido}>
                    <motion.div key={paso} custom={sentido} className="censo-paso"
                        initial={{ opacity: 0, x: 22 * sentido }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -22 * sentido }}
                        transition={RESORTE}>
                        {paso === 0 && <PasoCasa f={f} set={set} />}
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
                        <button type="button" onClick={() => { setSentido(-1); setPaso(paso - 1); }} disabled={enviando}
                            className={cn("h-12 w-12 shrink-0 grid place-items-center rounded-[10px] border border-border hover:bg-accent disabled:opacity-50", PULSABLE)} aria-label="Volver">
                            <ChevronLeft size={18} />
                        </button>
                    )}
                    {paso < PASOS.length - 1 ? (
                        <button type="button" onClick={() => { setSentido(1); setPaso(paso + 1); }} disabled={!puedeSeguir}
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
                <MarcaOmni size={26} className="shrink-0" />
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
                    <MarcaOmni size={20} className="mr-0.5 shrink-0" />
                    <span className="text-[13px] font-bold tracking-[-0.01em]">Omni<span className="font-normal">Access</span></span>
                    <span className="text-[12px] text-muted-foreground">· {LEMA}</span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                    Control de acceso por matrícula, con la foto de cada paso. Un desarrollo de {EMPRESA}.
                    Los datos que cargás quedan en el servidor del barrio y los usa la administración para
                    darte de alta.
                </p>
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

function PasoCasa({ f, set }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void }) {
    return (
        <Seccion icono={Home} titulo="Tu casa">
            <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Lote"><input value={f.lote} onChange={(e) => set("lote", e.target.value)} placeholder="B4" autoCapitalize="characters" className={cn(ENTRADA, "uppercase tabular-nums font-bold")} /></Campo>
                <Campo rotulo="Apellido"><input value={f.apellido} onChange={(e) => set("apellido", e.target.value)} placeholder="Pérez" autoCapitalize="words" className={ENTRADA} /></Campo>
            </div>
            <Campo rotulo="Nombre" ayuda="Opcional."><input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} autoCapitalize="words" className={ENTRADA} /></Campo>
            <Campo rotulo="Celular" ayuda="Es por donde te avisamos. No se comparte con nadie.">
                <input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} placeholder="099 123 456" inputMode="tel" className={cn(ENTRADA, "tabular-nums")} />
            </Campo>
            <Campo rotulo="Correo" ayuda="Opcional."><input value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="nombre@correo.com" inputMode="email" autoCapitalize="none" className={ENTRADA} /></Campo>
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
        </Seccion>
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
                                <input value={v.chapa} onChange={(e) => cambiar(i, { chapa: e.target.value.toUpperCase() })} placeholder="ABC 1234"
                                    autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                                    // El color del estado le gana al del foco: si no, la chapa que hay que revisar
                                    // se ve azul justo mientras se la está escribiendo, que es cuando hay que verla.
                                    className={cn(ENTRADA, "h-14 text-[22px] font-bold tracking-[0.12em] tabular-nums text-center",
                                        est.tono === "bien" && "border-[var(--bien)] focus:border-[var(--bien)] focus:ring-[var(--bien)]/25",
                                        est.tono === "aviso" && "border-[var(--aviso)] focus:border-[var(--aviso)] focus:ring-[var(--aviso)]/25")} />
                                {est.dice && <p className={cn("mt-1.5 text-[12.5px] leading-snug", est.tono === "bien" ? "tono-bien" : "tono-aviso")}>{est.dice}</p>}
                            </div>
                            {f.vehiculos.length > 1 && (
                                <button type="button" onClick={() => set("vehiculos", f.vehiculos.filter((_, j) => j !== i))}
                                    className="h-14 w-11 shrink-0 grid place-items-center rounded-[10px] border border-border text-muted-foreground hover:text-[var(--mal)]" aria-label="Quitar">
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
                        <input value={s.chapa || ""} onChange={(e) => cambiar(i, { chapa: e.target.value.toUpperCase() })} placeholder="ABC 1234"
                            autoCapitalize="characters" autoCorrect="off" spellCheck={false} className={cn(ENTRADA, "h-11 text-[15px] font-bold tracking-[0.1em] tabular-nums")} />
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

function Gracias({ marca, lote, vehiculos }: { marca: { name: string; barrio: string; logoUrl: string }; lote: string; vehiculos: number }) {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Cabecera marca={marca} />
            <main className="mx-auto w-full max-w-[640px] px-4 pt-14 text-center">
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 18 }}
                    className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[color-mix(in_oklab,var(--bien)_14%,transparent)]">
                    <ShieldCheck size={38} className="tono-bien" />
                </motion.div>
                <h1 className="mt-6 text-[28px] font-bold leading-tight tracking-[-0.02em]">Listo, lote {lote}</h1>
                <p className="mx-auto mt-3 max-w-[460px] text-[15px] leading-relaxed text-muted-foreground">
                    {vehiculos > 0
                        ? `Quedaron ${vehiculos === 1 ? "tu matrícula" : `tus ${vehiculos} matrículas`} para que la administración las dé de alta.`
                        : "Quedó tu registro para que la administración lo dé de alta."}{" "}
                    Si falta algo, volvé a escanear el QR y cargalo de nuevo.
                </p>
                <div className="mx-auto mt-8 max-w-[460px] rounded-[10px] border border-border bg-card p-4 text-left">
                    <p className="flex items-center gap-2 text-[14px] font-bold"><Sparkles size={15} className="tono-accion" /> Lo que viene</p>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                        Cuando esté aprobado, el portón reconoce tu matrícula sola: no hay que llamar ni tocar nada.
                        Lo que pase en tu entrada queda registrado con su foto.
                    </p>
                </div>
            </main>

            <Pie />
        </div>
    );
}
