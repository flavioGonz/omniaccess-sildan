"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Clock, Users, WifiOff } from "lucide-react";
import { hora } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { REFRESCO_PANTALLA_MS, rotuloDe, esperaTexto, type FilaEnPantalla } from "@/lib/filas/pantalla-comun";

/**
 * La pantalla de la sala de espera.
 *
 * Es lo que hacía /admin/kiosko (el semáforo PASE / AGUARDE / AFORO COMPLETO con personas y
 * espera), con tres cambios que pidió ponerla en un monitor:
 *   - abre sin sesión, por su dirección (/k/<slug>?t=<token>), sin el panel alrededor;
 *   - no tiene controles a la vista: el selector de fila y los botones del kiosco viejo quedaban
 *     encima del cartel en la tele. Las filas se eligen al armar la pantalla, en el panel;
 *   - muestra una o varias filas: con una, el cartel ocupa todo; con varias, una tarjeta por fila.
 *
 * El color del cartel es el estado de la fila (pleno-bien / aviso / mal) y nada más: de lejos,
 * el color es lo primero que se lee y no puede decir otra cosa.
 */

type Datos = {
    pantalla: { nombre: string; tema: string; verEspera: boolean; verHora: boolean; mensaje: string | null };
    marca: { nombre: string; logo: string | null };
    filas: FilaEnPantalla[];
};

/** Sin respuesta durante esto, se avisa en una esquina (los números de la pantalla quedan viejos). */
const SIN_CONEXION_TRAS_MS = 30_000;
/** El puntero se esconde si nadie lo mueve: en una tele queda en el medio del cartel. */
const ESCONDER_PUNTERO_MS = 3_000;

export function PantallaKiosco({ slug, token }: { slug: string; token: string }) {
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<"invalida" | "desactivada" | null>(null);
    const [ultimoOk, setUltimoOk] = useState<number>(Date.now());
    const [ahora, setAhora] = useState(new Date());
    const [puntero, setPuntero] = useState(true);
    const { setTheme } = useTheme();
    const temaPuesto = useRef<string | null>(null);

    const cargar = useCallback(async () => {
        try {
            const r = await fetch(`/api/pantalla/${encodeURIComponent(slug)}?t=${encodeURIComponent(token)}`, { cache: "no-store" });
            if (r.status === 404) { setError("invalida"); return; }
            if (r.status === 410) { setError("desactivada"); return; }
            if (!r.ok) return; // un tropiezo: se queda lo último y avisa la esquina si dura
            const d: Datos = await r.json();
            setDatos(d); setError(null); setUltimoOk(Date.now());
        } catch { /* sin red: igual que arriba */ }
    }, [slug, token]);

    useEffect(() => { cargar(); const t = setInterval(cargar, REFRESCO_PANTALLA_MS); return () => clearInterval(t); }, [cargar]);
    useEffect(() => { const c = setInterval(() => setAhora(new Date()), 1000); return () => clearInterval(c); }, []);

    // El tema lo elige quien arma la pantalla, no el navegador del monitor.
    useEffect(() => {
        const t = datos?.pantalla.tema === "claro" ? "light" : "dark";
        if (temaPuesto.current !== t) { temaPuesto.current = t; setTheme(t); }
    }, [datos?.pantalla.tema, setTheme]);

    useEffect(() => {
        let t: ReturnType<typeof setTimeout>;
        const mover = () => { setPuntero(true); clearTimeout(t); t = setTimeout(() => setPuntero(false), ESCONDER_PUNTERO_MS); };
        mover();
        window.addEventListener("mousemove", mover);
        return () => { window.removeEventListener("mousemove", mover); clearTimeout(t); };
    }, []);

    // Pantalla completa con un toque en cualquier lado: sin botón que tape el cartel.
    const completa = () => {
        const el: any = document.documentElement;
        if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    };

    if (error) {
        return (
            <div className="fixed inset-0 grid place-items-center bg-background text-foreground p-8 text-center">
                <div>
                    <div className="text-[34px] font-bold tracking-[-0.02em]">{error === "desactivada" ? "Pantalla desactivada" : "Enlace no válido"}</div>
                    <p className="text-[17px] text-muted-foreground mt-2 max-w-[520px]">
                        {error === "desactivada"
                            ? "Esta pantalla está apagada desde el panel (Filas › Pantalla / Kiosko)."
                            : "La dirección no corresponde a ninguna pantalla, o cambió su enlace. Copiala de nuevo desde Filas › Pantalla / Kiosko."}
                    </p>
                </div>
            </div>
        );
    }

    if (!datos) return <div className="fixed inset-0 bg-background" />;

    const { pantalla, marca, filas } = datos;
    const sinConexion = Date.now() - ultimoOk > SIN_CONEXION_TRAS_MS;
    const una = filas.length === 1 ? filas[0] : null;

    const cabecera = (
        <div className="flex items-center gap-4 px-[3vw] py-[2.2vh] shrink-0">
            {marca.logo && <img src={marca.logo} alt="" className="h-[5.5vh] w-auto max-w-[18vw] object-contain" />}
            <div className="min-w-0 leading-tight">
                <div className="text-[clamp(16px,2.2vh,28px)] font-bold truncate">{una ? una.nombre : pantalla.nombre}</div>
                {pantalla.mensaje && <div className="text-[clamp(13px,1.7vh,22px)] opacity-80 truncate">{pantalla.mensaje}</div>}
            </div>
            <div className="ml-auto flex items-center gap-4">
                {sinConexion && (
                    <span className="inline-flex items-center gap-1.5 text-[clamp(12px,1.6vh,20px)] font-semibold px-3 py-1 rounded-full border chip-aviso">
                        <WifiOff size={16} /> Sin conexión
                    </span>
                )}
                {pantalla.verHora && <div className="text-[clamp(18px,3vh,40px)] font-bold tabular-nums">{hora(ahora)}</div>}
            </div>
        </div>
    );

    // ── Una fila: el cartel ocupa toda la pantalla ──
    if (una) {
        const r = rotuloDe(una);
        return (
            <div onClick={completa} className={cn("fixed inset-0 flex flex-col overflow-hidden select-none transition-colors duration-700", `pleno-${una.estado}`, !puntero && "cursor-none")}>
                {cabecera}
                <div className="flex-1 min-h-0 grid place-items-center text-center px-[4vw]">
                    <div>
                        <div className="font-bold tracking-[-0.03em] leading-none text-[clamp(56px,13vw,220px)]">{r.titulo}</div>
                        <div className="font-semibold mt-[2vh] opacity-90 text-[clamp(20px,3.6vw,56px)]">{r.sub}</div>
                    </div>
                </div>
                <div className={cn("grid shrink-0 border-t border-current/20", pantalla.verEspera ? "grid-cols-2" : "grid-cols-1")}>
                    <Medida icono={Users} rotulo="Personas en fila" valor={una.aforo ?? "—"} resto={`/ ${una.limite}`} />
                    {pantalla.verEspera && <Medida icono={Clock} rotulo="Espera estimada" valor={esperaTexto(una.esperaMin)} resto="min" borde />}
                </div>
            </div>
        );
    }

    // ── Varias filas: una tarjeta por fila ──
    const cols = filas.length <= 2 ? filas.length : filas.length === 4 ? 2 : 3;
    return (
        <div onClick={completa} className={cn("fixed inset-0 flex flex-col bg-background text-foreground overflow-hidden select-none", !puntero && "cursor-none")}>
            {cabecera}
            {filas.length === 0 ? (
                <div className="flex-1 grid place-items-center text-[clamp(18px,3vh,36px)] text-muted-foreground">Esta pantalla no tiene filas para mostrar.</div>
            ) : (
                <div className="flex-1 min-h-0 grid gap-[1.6vw] px-[3vw] pb-[3vh]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}>
                    {filas.map((f) => {
                        const r = rotuloDe(f);
                        return (
                            <div key={f.id} className="min-h-0 rounded-[14px] border border-border bg-card flex flex-col overflow-hidden">
                                <div className={cn("px-[1.6vw] py-[1.6vh] flex items-baseline gap-3 transition-colors duration-700", `pleno-${f.estado}`)}>
                                    <span className="font-bold tracking-[-0.02em] text-[clamp(22px,3.4vh,52px)] leading-none">{r.titulo}</span>
                                    <span className="ml-auto font-semibold opacity-90 text-[clamp(13px,1.8vh,24px)] truncate">{f.nombre}</span>
                                </div>
                                <div className="flex-1 min-h-0 grid place-items-center">
                                    <div className="text-center">
                                        <div className={cn("font-bold tabular-nums leading-none text-[clamp(56px,13vh,200px)]", `tono-${f.estado}`)}>
                                            {f.aforo ?? "—"}<span className="text-[0.32em] font-semibold text-muted-foreground"> / {f.limite}</span>
                                        </div>
                                        <div className="text-[clamp(13px,1.9vh,26px)] text-muted-foreground mt-[1vh]">personas en fila</div>
                                    </div>
                                </div>
                                {pantalla.verEspera && (
                                    <div className="border-t border-border px-[1.6vw] py-[1.4vh] flex items-center gap-2 text-[clamp(14px,2.2vh,30px)]">
                                        <Clock className="text-muted-foreground shrink-0" size={20} />
                                        <span className="text-muted-foreground">Espera</span>
                                        <b className="ml-auto tabular-nums">{esperaTexto(f.esperaMin)} min</b>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function Medida({ icono: I, rotulo, valor, resto, borde }: { icono: any; rotulo: string; valor: React.ReactNode; resto: string; borde?: boolean }) {
    return (
        <div className={cn("flex flex-col items-center justify-center py-[3vh]", borde && "border-l border-current/20")}>
            <div className="flex items-center gap-2 font-semibold opacity-85 text-[clamp(13px,2vh,26px)]"><I size={20} /> {rotulo}</div>
            <div className="font-bold tabular-nums leading-none mt-[1vh] text-[clamp(44px,8vh,120px)]">
                {valor}<span className="text-[0.4em] font-semibold opacity-75"> {resto}</span>
            </div>
        </div>
    );
}
