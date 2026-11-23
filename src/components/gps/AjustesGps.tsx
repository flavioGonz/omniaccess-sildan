"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Gauge, Loader2, MapPin, Satellite } from "lucide-react";
import { sileo as toast } from "sileo";
import { guardarLimiteVelocidadGps, limiteVelocidadGps } from "@/app/actions/gps";
import { Button } from "@/components/ui/button";
import { HorarioLaboral } from "@/components/mapa/ReportesGps";
import { ServicioDeDirecciones } from "@/components/gps/ServicioDeDirecciones";
import { CAMPO, Panel } from "@/components/gps/piezas";

/**
 * Los ajustes del rastreo: lo que vale para toda la flota.
 *
 * Estaban cada uno donde se usó por primera vez —la velocidad permitida en el panel del recorrido,
 * el horario laboral adentro del cajón de reportes, las direcciones en Dispositivos— y había que
 * acordarse de dónde. Siguen estando ahí, que es donde hacen falta; acá están juntos.
 */
export function AjustesGps({ puedeConfig, puedeEquipo }: { puedeConfig: boolean; puedeEquipo: boolean }) {
    return (
        <div className="mx-auto max-w-3xl space-y-4">
            <Bloque icono={Gauge} titulo="Velocidad permitida" ayuda="La vara de la empresa, una para todos los vehículos. Con ella se pinta el recorrido y se arma el reporte de excesos.">
                <Limite puedeConfig={puedeConfig} />
            </Bloque>
            <Bloque icono={Clock} titulo="Horario laboral" ayuda="Contra esto se mide el «uso fuera de horario» de los reportes. Sin horario cargado, ese reporte no puede decir nada.">
                {/* El editor es el mismo del cajón de reportes: un horario, un solo lugar donde se guarda. */}
                <HorarioLaboral sinRotulo />
            </Bloque>
            <Bloque icono={MapPin} titulo="Direcciones de los lugares" ayuda="Que una parada diga «Cavour 3230, Parque Batlle» y no dos números.">
                <ServicioDeDirecciones puedeConfig={puedeConfig} />
            </Bloque>
            <Bloque icono={Satellite} titulo="Los rastreadores" ayuda="Dar de alta uno nuevo y la puerta del receptor siguen en Dispositivos: es trabajo de quien instala.">
                {puedeEquipo
                    ? <Button asChild variant="outline" className="h-11 w-full text-[14px] sm:h-9 sm:w-auto sm:text-[13px]"><Link href="/admin/devices">Ir a Dispositivos › GPS</Link></Button>
                    : <p className="text-[12.5px] text-muted-foreground">Tu rol no da de alta equipos.</p>}
            </Bloque>
        </div>
    );
}

function Bloque({ icono: Icono, titulo, ayuda, children }: { icono: React.ComponentType<{ size?: number; className?: string }>; titulo: string; ayuda: string; children: React.ReactNode }) {
    return (
        <Panel>
            <header className="flex items-start gap-3 px-4 pt-4">
                <Icono size={17} className="mt-[1px] shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                    <h3 className="text-[14px] font-bold leading-tight">{titulo}</h3>
                    <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{ayuda}</p>
                </div>
            </header>
            <div className="px-4 pb-4 pt-3">{children}</div>
        </Panel>
    );
}

function Limite({ puedeConfig }: { puedeConfig: boolean }) {
    /* `null` mientras se pregunta; el borrador es texto para que el campo se pueda vaciar al escribir. */
    const [guardado, setGuardado] = useState<number | null>(null);
    const [borrador, setBorrador] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { limiteVelocidadGps().then((n) => { setGuardado(n); setBorrador(String(n)); }).catch((e) => setError(e instanceof Error ? e.message : "No se pudo leer.")); }, []);
    const guardar = async () => {
        setGuardando(true); setError(null);
        try {
            const x = await guardarLimiteVelocidadGps(Number(borrador));
            if (!x.ok) { setError(x.error || "No se pudo guardar."); return; }
            setGuardado(x.limite ?? Number(borrador)); toast.success({ title: "Velocidad permitida guardada", description: `${x.limite} km/h. Vale para los recorridos y reportes que se abran desde ahora.` });
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
        finally { setGuardando(false); }
    };
    if (guardado === null && !error) return <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Leyendo…</p>;
    return (
        <div>
            <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2">
                    <input type="number" inputMode="numeric" min={20} max={200} value={borrador} disabled={!puedeConfig} onChange={(e) => setBorrador(e.target.value)} className={`${CAMPO} w-[110px] tabular-nums sm:w-[96px]`} aria-label="Velocidad permitida, en km/h" />
                    <span className="text-[13px] text-muted-foreground">km/h</span>
                </label>
                {puedeConfig && borrador !== String(guardado ?? "") && (
                    <Button onClick={guardar} disabled={guardando} className="h-11 px-5 text-[14px] sm:h-9 sm:text-[13px]">{guardando && <Loader2 size={15} className="animate-spin" />} Guardar</Button>
                )}
            </div>
            {error && <p className="tono-mal mt-2 text-[12.5px] font-semibold" role="alert">{error}</p>}
            <p className="mt-2 text-[11.5px] text-muted-foreground">Entre 20 y 200 km/h. El aviso de exceso que manda el propio rastreador es aparte: se configura en Comandos.</p>
        </div>
    );
}
