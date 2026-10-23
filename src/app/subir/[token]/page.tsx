"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Check, ImageUp, Loader2, RotateCcw, ScanSearch, Send, TimerOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La página del celular para mandarle una foto a una pared (openspec pared-vms).
 *
 * Se abre escaneando el QR de «Buscar parecidos». Sin usuario y sin el diseño del panel: quien la
 * abre puede ser un vecino o un guardia con su teléfono, y lo único que tiene que hacer es sacar
 * una foto y mandarla. No muestra nada de la instalación (ni barrio, ni cámaras): el token sólo
 * sirve para mandar una foto, y la página no tiene por qué decir más.
 *
 * La foto se achica EN el celular antes de subirla (lado mayor 1600 px, JPEG 85 %): una foto de
 * celular pesa de 4 a 8 MB y por datos móviles tarda; achicada pesa unos 300 KB y para buscar
 * parecidos alcanza de sobra (OmniVision mira recortes de 256 px).
 */

const LADO_MAX = 1600;
const CALIDAD = 0.85;
const ENTRADA = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.8 };

type Paso =
    | { id: "revisando" }
    | { id: "listo" }
    | { id: "vista"; blob: Blob; url: string }
    | { id: "enviando"; url: string; avance: number }
    | { id: "enviada"; url: string }
    | { id: "error"; texto: string; final: boolean };

export default function SubirFoto({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
    const [paso, setPaso] = useState<Paso>({ id: "revisando" });
    const camara = useRef<HTMLInputElement>(null);
    const galeria = useRef<HTMLInputElement>(null);

    // ¿El código sirve? Antes de pedir la foto: si venció, que no la saquen en vano.
    useEffect(() => {
        fetch(`/api/subida/${encodeURIComponent(token)}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((j) => setPaso(j.ok ? { id: "listo" } : { id: "error", texto: j.error || "Este código no sirve.", final: true }))
            .catch(() => setPaso({ id: "error", texto: "No hay conexión. Revisá los datos o el wifi y volvé a escanear.", final: false }));
    }, [token]);

    const elegida = useCallback(async (f: File | undefined) => {
        if (!f) return;
        try {
            const blob = await achicar(f);
            setPaso({ id: "vista", blob, url: URL.createObjectURL(blob) });
        } catch {
            setPaso({ id: "error", texto: "No se pudo abrir esa imagen. Probá con otra foto.", final: false });
        }
    }, []);

    const enviar = (blob: Blob, url: string) => {
        setPaso({ id: "enviando", url, avance: 0 });
        // Con XMLHttpRequest y no fetch: es lo único que informa el avance de una subida.
        const x = new XMLHttpRequest();
        x.open("POST", `/api/subida/${encodeURIComponent(token)}`);
        x.setRequestHeader("content-type", "image/jpeg");
        x.upload.onprogress = (e) => { if (e.lengthComputable) setPaso({ id: "enviando", url, avance: e.loaded / e.total }); };
        x.onload = () => {
            let j: any = {}; try { j = JSON.parse(x.responseText); } catch { }
            if (x.status >= 200 && x.status < 300 && j.ok) { setPaso({ id: "enviada", url }); navigator.vibrate?.(40); }
            else setPaso({ id: "error", texto: j.error || "No se pudo mandar la foto.", final: ["vencido", "usado", "no-existe"].includes(j.motivo) });
        };
        x.onerror = () => setPaso({ id: "error", texto: "Se cortó la conexión. Probá de nuevo.", final: false });
        x.send(blob);
    };

    return (
        <main className="dark min-h-[100dvh] bg-[#07090d] text-white flex flex-col items-center px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] overflow-hidden relative select-none">
            {/* El halo de fondo: la única decoración, y respira despacio. */}
            <motion.div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[620px] h-[620px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accion)_38%,transparent),transparent)]"
                animate={{ opacity: [0.55, 0.85, 0.55], scale: [1, 1.06, 1] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }} />

            <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...ENTRADA, delay: 0.05 }} className="relative w-full max-w-[420px] flex items-center gap-3">
                <span className="grid place-items-center h-10 w-10 rounded-[12px] bg-white/10 border border-white/15 backdrop-blur-md"><ScanSearch size={19} /></span>
                <div className="leading-tight">
                    <div className="text-[16px] font-bold tracking-[-0.01em]">Foto para la pared</div>
                    <div className="text-[12.5px] text-white/60">OmniAccess · buscar parecidos</div>
                </div>
            </motion.header>

            <section className="relative w-full max-w-[420px] flex-1 flex flex-col justify-center py-6">
                <AnimatePresence mode="wait" initial={false}>
                    {paso.id === "revisando" && (
                        <Pantalla key="revisando">
                            <Loader2 size={30} className="mx-auto animate-spin text-white/70" />
                            <p className="mt-3 text-center text-[14px] text-white/70">Abriendo…</p>
                        </Pantalla>
                    )}

                    {paso.id === "listo" && (
                        <Pantalla key="listo">
                            <h1 className="text-[26px] font-bold leading-[1.1] tracking-[-0.02em]">¿Qué querés que busque la pared?</h1>
                            <p className="mt-2 text-[14.5px] text-white/65 leading-snug">Sacale una foto a la persona, el vehículo o el objeto, o elegí una que ya tengas. La foto se usa sólo para esta búsqueda.</p>
                            <div className="mt-7 space-y-3">
                                <BotonGrande Ico={Camera} titulo="Sacar una foto" texto="Con la cámara del teléfono" primario onClick={() => camara.current?.click()} retardo={0.08} />
                                <BotonGrande Ico={ImageUp} titulo="Elegir de la galería" texto="Una foto que ya tengas" onClick={() => galeria.current?.click()} retardo={0.14} />
                            </div>
                        </Pantalla>
                    )}

                    {(paso.id === "vista" || paso.id === "enviando" || paso.id === "enviada") && (
                        <Pantalla key="foto">
                            <motion.div layout className="relative rounded-[20px] overflow-hidden border border-white/12 bg-black shadow-[0_24px_60px_-20px_rgba(0,0,0,.8)]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={paso.url} alt="La foto elegida" className={cn("block w-full max-h-[52dvh] object-contain transition-[filter] duration-500", paso.id === "enviando" && "brightness-[.55]")} />
                                {paso.id === "enviando" && (
                                    <div className="absolute inset-x-0 bottom-0 p-4">
                                        <div className="h-1.5 rounded-full bg-white/15 overflow-hidden"><motion.div className="h-full bg-[var(--accion-en-oscuro)]" animate={{ width: `${Math.max(6, paso.avance * 100)}%` }} transition={{ ease: "easeOut" }} /></div>
                                        <div className="mt-2 text-[13px] font-semibold tabular-nums">Mandando… {Math.round(paso.avance * 100)} %</div>
                                    </div>
                                )}
                                <AnimatePresence>
                                    {paso.id === "enviada" && (
                                        <motion.div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                            <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 520, damping: 22, delay: 0.05 }}
                                                className="grid place-items-center h-20 w-20 rounded-full bg-[var(--bien)] shadow-[0_0_0_10px_color-mix(in_oklab,var(--bien)_25%,transparent)]">
                                                <Check size={40} strokeWidth={3} />
                                            </motion.span>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                            {paso.id === "vista" && (
                                <div className="mt-5 grid grid-cols-[auto_1fr] gap-3">
                                    <button type="button" onClick={() => { URL.revokeObjectURL(paso.url); setPaso({ id: "listo" }); }}
                                        className="h-14 px-5 rounded-[16px] border border-white/15 bg-white/5 inline-flex items-center gap-2 text-[15px] font-semibold active:scale-[.97] transition-transform"><RotateCcw size={18} /> Otra</button>
                                    <button type="button" onClick={() => enviar(paso.blob, paso.url)}
                                        className="h-14 rounded-[16px] bg-[var(--accion)] text-white inline-flex items-center justify-center gap-2 text-[16px] font-bold active:scale-[.97] transition-transform shadow-[0_12px_30px_-12px_var(--accion)]"><Send size={18} /> Mandar a la pared</button>
                                </div>
                            )}
                            {paso.id === "enviada" && (
                                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...ENTRADA, delay: 0.2 }} className="mt-6 text-center">
                                    <div className="text-[22px] font-bold tracking-[-0.01em]">Ya está en la pared</div>
                                    <p className="mt-1.5 text-[14px] text-white/65">El operador elige qué buscar en la foto. Podés cerrar esta página.</p>
                                </motion.div>
                            )}
                        </Pantalla>
                    )}

                    {paso.id === "error" && (
                        <Pantalla key="error">
                            <span className={cn("mx-auto grid place-items-center h-16 w-16 rounded-full", paso.final ? "bg-white/10" : "bg-[color-mix(in_oklab,var(--mal)_30%,transparent)]")}>
                                <TimerOff size={28} className={paso.final ? "text-white/80" : "text-[var(--mal-texto)]"} />
                            </span>
                            <p className="mt-4 text-center text-[17px] font-semibold leading-snug">{paso.texto}</p>
                            {!paso.final && (
                                <button type="button" onClick={() => setPaso({ id: "listo" })} className="mt-6 mx-auto flex h-12 px-6 rounded-[14px] bg-white/10 border border-white/15 items-center gap-2 text-[15px] font-semibold"><RotateCcw size={17} /> Probar de nuevo</button>
                            )}
                        </Pantalla>
                    )}
                </AnimatePresence>
            </section>

            <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { elegida(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={galeria} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={(e) => { elegida(e.target.files?.[0]); e.target.value = ""; }} />
        </main>
    );
}

/** Cada paso entra desde abajo con un poco de desenfoque y sale hacia arriba: se lee como avanzar. */
function Pantalla({ children }: { children: React.ReactNode }) {
    return (
        <motion.div initial={{ opacity: 0, y: 18, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -14, filter: "blur(4px)" }} transition={ENTRADA}>
            {children}
        </motion.div>
    );
}

function BotonGrande({ Ico, titulo, texto, primario, onClick, retardo }: { Ico: any; titulo: string; texto: string; primario?: boolean; onClick: () => void; retardo: number }) {
    return (
        <motion.button type="button" onClick={onClick} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...ENTRADA, delay: retardo }} whileTap={{ scale: 0.97 }}
            className={cn("w-full flex items-center gap-4 rounded-[18px] p-4 text-left border",
                primario ? "bg-[var(--accion)] border-transparent shadow-[0_16px_40px_-16px_var(--accion)]" : "bg-white/[.06] border-white/12")}>
            <span className={cn("grid place-items-center h-12 w-12 rounded-[14px] shrink-0", primario ? "bg-white/20" : "bg-white/10")}><Ico size={23} /></span>
            <span className="min-w-0">
                <span className="block text-[17px] font-bold">{titulo}</span>
                <span className={cn("block text-[13px]", primario ? "text-white/80" : "text-white/55")}>{texto}</span>
            </span>
        </motion.button>
    );
}

/** La foto achicada en el teléfono (ver arriba). Respeta la orientación de la cámara. */
async function achicar(f: File): Promise<Blob> {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" } as any);
    const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("sin imagen"))), "image/jpeg", CALIDAD));
}
