"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import { Chip } from "@/components/ui/estados";
import { RotateCw, ShieldAlert, ShieldCheck, ShieldQuestion, Search, Check, ExternalLink, KeyRound, FileSearch } from "lucide-react";
import { native } from "@/lib/guard-native";
import { cn } from "@/lib/utils";
import { MIN_INTERIOR_URL, normalizarMatricula, LARGO_CODIGO, type EstadoConsulta } from "@/lib/min-interior";

/**
 * Consulta asistida de "Matrículas Requeridas" del Ministerio del Interior.
 *
 * Tres pasos a la vista del guardia: Verificación → Consulta → Resultado. El del medio es
 * el que antes no existía: al apretar Consultar el diálogo se quedaba quieto con un spinner
 * de 16 px y el guardia no sabía si había mandado algo. Ahora la consulta ocupa el diálogo
 * entero mientras viaja, y el resultado llega con el tono que le corresponde (mal / bien /
 * aviso) y a tamaño de lectura a dos metros.
 *
 * Lo que NO cambia, y es la regla de esta pantalla: la imagen de verificación la resuelve
 * UNA PERSONA. El sistema trae la imagen, lleva el código que escribió el guardia y trae la
 * respuesta. No lee, deduce ni completa el código por software.
 */

type Paso = "verificar" | "consultando" | "resultado";
type Resultado = { status: EstadoConsulta; matricula: string; excerpt: string; hora: Date };

const PASOS: { clave: Paso; rotulo: string; Icono: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { clave: "verificar", rotulo: "Verificación", Icono: KeyRound },
    { clave: "consultando", rotulo: "Consulta", Icono: FileSearch },
    { clave: "resultado", rotulo: "Resultado", Icono: ShieldCheck },
];

/** Si el sitio no dice cuánto vale la imagen, se asume esto (coincide con el TTL de la ruta). */
const VENCE_POR_DEFECTO_MS = 5 * 60 * 1000;
/** Con menos de esto la cuenta regresiva pasa a aviso: da tiempo a tipear antes de que caduque. */
const VENCE_PRONTO_MS = 45_000;

const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
// 24 h como todo el panel: "03:13 p. m." es el formato del navegador, no el del barrio.
const horaCorta = (d: Date) => d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false });

export function MinInteriorDialog({ plate, open, onOpenChange }: { plate?: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
    const [paso, setPaso] = useState<Paso>("verificar");
    const [sid, setSid] = useState("");
    const [image, setImage] = useState("");
    const [vence, setVence] = useState<number | null>(null);
    const [ahora, setAhora] = useState(() => Date.now());
    const [mat, setMat] = useState(normalizarMatricula(plate));
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [aviso, setAviso] = useState("");
    const [resultado, setResultado] = useState<Resultado | null>(null);
    const [desdeEnvio, setDesdeEnvio] = useState(0);
    const codigoRef = useRef<HTMLInputElement>(null);

    const startCaptcha = useCallback(async () => {
        setLoading(true); setError(""); setCode(""); setImage(""); setVence(null);
        try {
            const r = await fetch("/api/min-interior?action=start", { cache: "no-store" });
            const d = await r.json();
            if (!d.ok) throw new Error(d.error || "No se pudo iniciar la consulta.");
            setSid(d.sid); setImage(d.image); setVence(Date.now() + (Number(d.venceEnMs) || VENCE_POR_DEFECTO_MS));
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    const nuevaConsulta = useCallback(() => { setResultado(null); setAviso(""); setPaso("verificar"); startCaptcha(); }, [startCaptcha]);

    useEffect(() => {
        if (open) { setMat(normalizarMatricula(plate)); nuevaConsulta(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, plate]);

    // Reloj de un segundo: mueve la cuenta regresiva de la imagen y el "hace N s" de la consulta.
    useEffect(() => { if (!open) return; const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, [open]);

    const restante = vence ? vence - ahora : null;
    // La imagen caducó mientras el guardia miraba otra cosa: se renueva sola. Mandar un
    // código de una imagen vencida sólo devolvía "sesión expirada" después de tipearlo.
    useEffect(() => {
        if (paso === "verificar" && !loading && restante !== null && restante <= 0) { setAviso("La imagen venció y se pidió una nueva."); startCaptcha(); }
    }, [paso, loading, restante, startCaptcha]);

    const reload = async () => {
        if (!sid) return startCaptcha();
        setLoading(true); setError(""); setCode(""); setAviso("");
        try {
            const r = await fetch("/api/min-interior?action=reload&sid=" + encodeURIComponent(sid), { cache: "no-store" });
            const d = await r.json();
            if (!d.ok) { if (r.status === 410) return startCaptcha(); throw new Error(d.error); }
            setImage(d.image); setVence(Date.now() + (Number(d.venceEnMs) || VENCE_POR_DEFECTO_MS));
            codigoRef.current?.focus();
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    const listo = !!mat && code.trim().length > 0 && !!image && !loading;

    const consultar = async () => {
        if (!listo) { setError(!mat ? "Falta la matrícula." : "Escribí el código de la imagen."); return; }
        setError(""); setAviso(""); setResultado(null); setPaso("consultando"); setDesdeEnvio(Date.now());
        try {
            const r = await fetch("/api/min-interior", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid, matricula: mat, captcha_code: code.trim() }) });
            const d = await r.json();
            if (!d.ok) {
                if (r.status === 410) { setPaso("verificar"); setAviso("La sesión venció: hay una imagen nueva, probá de nuevo."); startCaptcha(); return; }
                throw new Error(d.error);
            }
            if (d.status === "CAPTCHA") {
                // El código no era el de la imagen: no es un resultado, es volver a la verificación.
                setPaso("verificar"); setAviso("El código no coincidió con la imagen. Hay una nueva."); startCaptcha(); return;
            }
            setResultado({ status: d.status, matricula: d.matricula, excerpt: d.excerpt, hora: new Date() });
            setPaso("resultado");
        } catch (e: any) {
            setPaso("verificar"); setError(e?.message || String(e));
            // La imagen ya se gastó en el intento fallido: pedir otra para que el próximo envío valga.
            startCaptcha();
        }
    };

    const indice = PASOS.findIndex((p) => p.clave === paso);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] tono-accion"><ShieldAlert size={18} /></span>
                        Matrículas requeridas · Ministerio del Interior
                    </DialogTitle>
                    <DialogDescription>
                        Consulta al sitio oficial. El código de la imagen lo resolvés vos: OmniAccess sólo lleva la consulta y trae la respuesta.
                    </DialogDescription>
                </DialogHeader>

                {/* Los tres pasos, con la línea que se va llenando: el guardia ve dónde está sin leer. */}
                <ol className="relative flex items-center justify-between px-1 pt-1">
                    <span className="absolute left-5 right-5 top-[21px] h-px bg-border" aria-hidden />
                    <motion.span className="absolute left-5 top-[21px] h-px bg-[var(--accion)]" aria-hidden initial={false} animate={{ width: `calc((100% - 2.5rem) * ${indice / (PASOS.length - 1)})` }} transition={{ type: "spring", stiffness: 160, damping: 24 }} />
                    {PASOS.map((p, i) => {
                        const hecho = i < indice, actual = i === indice;
                        return (
                            <li key={p.clave} className="relative z-[1] flex flex-col items-center gap-1.5 bg-background px-2">
                                <motion.span
                                    className={cn("grid h-9 w-9 place-items-center rounded-full border-2 transition-colors", hecho ? "pleno-bien border-transparent" : actual ? "border-[var(--accion)] tono-accion bg-background" : "border-border text-muted-foreground bg-background")}
                                    animate={actual ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={actual ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
                                >
                                    {hecho ? <Check size={16} /> : <p.Icono size={16} />}
                                </motion.span>
                                <span className={cn("text-[11px] font-semibold", actual ? "text-foreground" : "text-muted-foreground")}>{p.rotulo}</span>
                            </li>
                        );
                    })}
                </ol>

                <div className="relative min-h-[270px]">
                    <AnimatePresence mode="wait" initial={false}>
                        {paso === "verificar" && (
                            <motion.div key="verificar" className="space-y-4" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
                                <div>
                                    <label className="text-[11px] font-semibold text-muted-foreground">Matrícula a consultar</label>
                                    <Input value={mat} onChange={(e) => setMat(normalizarMatricula(e.target.value))} onFocus={() => { try { native.showKeyboard(); } catch { } }}
                                        className="mt-1 h-11 text-[20px] font-bold uppercase tracking-[0.25em] tabular-nums" placeholder="ABC1234" maxLength={10} />
                                </div>

                                <div className="rounded-[10px] border bg-muted/30 p-3 space-y-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-[11px] font-semibold text-muted-foreground inline-flex items-center gap-1.5"><KeyRound size={12} /> Verificación del sitio oficial</div>
                                        {restante !== null && !loading && (
                                            <Pista texto="La imagen vale unos minutos. Si vence, se pide una nueva sola." lado="izquierda">
                                                <Chip tono={restante < VENCE_PRONTO_MS ? "aviso" : "neutro"}>vence en {mmss(restante)}</Chip>
                                            </Pista>
                                        )}
                                    </div>
                                    <div className="flex items-stretch gap-2">
                                        {/* Fondo blanco a propósito: la imagen del Ministerio viene sobre blanco y sobre la superficie oscura se ve recortada. */}
                                        <div className="relative flex h-14 flex-1 items-center justify-center overflow-hidden rounded-[6px] border bg-white">
                                            <AnimatePresence mode="wait">
                                                {loading || !image ? (
                                                    <motion.div key="cargando" className="absolute inset-0" exit={{ opacity: 0 }}>
                                                        {!error && <motion.span className="absolute left-0 right-0 h-[2px] bg-[var(--accion)]" style={{ top: 0 }} animate={{ top: ["0%", "100%"] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} />}
                                                        <span className="absolute inset-0 grid place-items-center text-[11px] text-neutral-500">{error ? "Sin imagen" : "Pidiendo la imagen…"}</span>
                                                    </motion.div>
                                                ) : (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <motion.img key={image.slice(-24)} src={image} alt="Código de verificación del sitio del Ministerio" className="h-10" initial={{ opacity: 0, filter: "blur(6px)", scale: 1.04 }} animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }} transition={{ duration: 0.35 }} />
                                                )}
                                            </AnimatePresence>
                                        </div>
                                        <Pista texto="Pedir otra imagen al sitio si ésta no se lee." lado="arriba">
                                            <Button type="button" variant="outline" size="icon" className="h-14 w-11" onClick={reload} disabled={loading} aria-label="Otra imagen">
                                                <RotateCw size={16} className={cn(loading && "animate-spin")} />
                                            </Button>
                                        </Pista>
                                        <Input ref={codigoRef} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") consultar(); }} onFocus={() => { try { native.showKeyboard(); } catch { } }}
                                            maxLength={LARGO_CODIGO} autoFocus autoComplete="off" spellCheck={false} placeholder="código"
                                            className="h-14 w-32 text-center text-[22px] font-bold tracking-[0.3em] tabular-nums placeholder:text-[12px] placeholder:tracking-normal placeholder:font-normal" />
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">Escribí los caracteres de la imagen tal como se ven. Es el paso que el sitio exige a una persona; no se hace solo.</p>
                                </div>

                                <AnimatePresence>
                                    {(error || aviso) && (
                                        <motion.p key={error || aviso} className={cn("rounded-[6px] border px-3 py-2 text-[12px]", error ? "chip-mal" : "chip-aviso")} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                                            {error || aviso}
                                        </motion.p>
                                    )}
                                </AnimatePresence>

                                <div className="flex items-center justify-end gap-2 pt-1">
                                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                                    <Button type="button" onClick={consultar} disabled={!listo} className={cn("min-w-[132px] bg-[var(--accion)] text-[var(--accion-texto)] hover:bg-[var(--accion-sobre)]", listo && "boton-armar")}>
                                        <Search size={16} /> Consultar
                                    </Button>
                                </div>
                            </motion.div>
                        )}

                        {paso === "consultando" && (
                            <motion.div key="consultando" className="flex min-h-[270px] flex-col items-center justify-center gap-4 text-center" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.22 }}>
                                <div className="relative grid h-32 w-32 place-items-center">
                                    {[0, 0.7, 1.4].map((d) => <span key={d} className="mi-anillo" style={{ animationDelay: `${d}s` }} />)}
                                    <span className="relative grid h-16 w-16 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] tono-accion"><ShieldAlert size={30} /></span>
                                </div>
                                <div>
                                    <div className="text-[17px] font-bold tracking-[-0.01em]">Consultando al Ministerio del Interior…</div>
                                    <div className="mt-1 text-[13px] text-muted-foreground tabular-nums">Matrícula <span className="font-semibold text-foreground tracking-[0.15em]">{mat}</span> · {Math.max(0, Math.round((ahora - desdeEnvio) / 1000))} s</div>
                                </div>
                                <p className="max-w-[340px] text-[11px] text-muted-foreground">La respuesta viene del sitio oficial, tal cual la publica. Si tarda, es el sitio: no cierres este cuadro.</p>
                            </motion.div>
                        )}

                        {paso === "resultado" && resultado && (
                            <motion.div key="resultado" className="space-y-4" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
                                <TarjetaResultado r={resultado} />
                                <div className="flex items-center justify-between gap-2 pt-1">
                                    <span className="text-[11px] text-muted-foreground">Fuente: sitio oficial del Ministerio del Interior · {horaCorta(resultado.hora)}</span>
                                    <div className="flex items-center gap-2">
                                        <Button type="button" variant="outline" onClick={nuevaConsulta}>Otra consulta</Button>
                                        <Button type="button" onClick={() => onOpenChange(false)} className="bg-[var(--accion)] text-[var(--accion-texto)] hover:bg-[var(--accion-sobre)]">Listo</Button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** El resultado con su tono: mal = requerida, bien = sin requerimiento, aviso = hay que leer el texto. */
function TarjetaResultado({ r }: { r: Resultado }) {
    if (r.status === "REQUERIDA")
        return (
            <motion.div className="mi-requerida relative overflow-hidden rounded-[14px] pleno-mal px-5 py-6 text-center" initial={{ scale: 0.94 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 220, damping: 18 }}>
                <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }} className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/15"><ShieldAlert size={36} /></motion.div>
                <div className="mt-3 text-[24px] font-bold leading-none tracking-[-0.01em]">MATRÍCULA REQUERIDA</div>
                <div className="mt-2 text-[15px] font-semibold tracking-[0.2em] tabular-nums">{r.matricula}</div>
                <p className="mt-2 text-[13px] opacity-90">Figura con requerimiento en el Ministerio del Interior. Actuá según el protocolo del barrio.</p>
            </motion.div>
        );
    if (r.status === "NO")
        return (
            <motion.div className="rounded-[14px] border chip-bien px-5 py-6 text-center" initial={{ scale: 0.96 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 220, damping: 20 }}>
                <motion.span className="mx-auto grid h-16 w-16 place-items-center rounded-full pleno-bien" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}><ShieldCheck size={36} /></motion.span>
                <div className="mt-3 text-[22px] font-bold leading-none tracking-[-0.01em]">Sin requerimiento</div>
                <div className="mt-2 text-[15px] font-semibold tracking-[0.2em] tabular-nums text-foreground">{r.matricula}</div>
                <p className="mt-2 text-[13px] text-muted-foreground">No figura como requerida en la consulta de recién.</p>
            </motion.div>
        );
    return (
        <div className="rounded-[14px] border chip-aviso px-5 py-5">
            <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full pleno-aviso"><ShieldQuestion size={26} /></span>
                <div>
                    <div className="text-[17px] font-bold leading-tight">Respuesta sin clasificar</div>
                    <div className="text-[12px] text-muted-foreground">El sitio contestó algo que OmniAccess no reconoce. Leé el texto; ante la duda, abrí el sitio oficial.</div>
                </div>
            </div>
            {r.excerpt && <p className="mt-3 rounded-[6px] border bg-background/60 p-3 text-[12px] text-foreground whitespace-pre-wrap">{r.excerpt}</p>}
            <a href={MIN_INTERIOR_URL} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold tono-accion hover:underline"><ExternalLink size={13} /> Abrir el sitio oficial</a>
        </div>
    );
}
