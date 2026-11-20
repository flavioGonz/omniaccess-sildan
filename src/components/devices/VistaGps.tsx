"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BatteryCharging, Car, Loader2, MapPin, Plus, Power, Satellite, Signal } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Cargando, Chip, ErrorEstado, Vacio } from "@/components/ui/estados";
import { atarVehiculoGps, darDeAltaGps, rastreadoresGps, type Rastreador } from "@/app/actions/gps";
import { hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Los rastreadores GPS, en Dispositivos.
 *
 * No usan la tabla de los demás equipos: «Grabación», «Hora del equipo» y «Enlaces» no le dicen
 * nada a un rastreador, y lo que sí importa —dónde está, si el motor está encendido, cuánto hace
 * que reportó, cómo está la batería del vehículo— no tiene columna ahí.
 *
 * Dos cosas que la pantalla dice con cuidado:
 *  · **La posición puede ser vieja.** Bajo techo el equipo sigue en línea pero sin satélites, y
 *    lo que se muestra es dónde estaba la última vez que los tuvo. Por eso van separados «reportó
 *    hace 2 min» y «posición de hace 3 h»: juntarlos haría creer que el auto está ahí ahora.
 *  · **El que se presenta solo no entra solo.** Se ve como «sin dar de alta» hasta que alguien
 *    lo acepta (ver actions/gps).
 */

/** Cada cuánto se vuelve a preguntar. El equipo parado reporta cada 3 a 5 minutos. */
const REFRESCO_MS = 20_000;
const SENAL = ["sin señal", "muy baja", "baja", "buena", "fuerte"];

export function VistaGps({ busqueda }: { busqueda?: string }) {
    const [lista, setLista] = useState<Rastreador[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const traer = useCallback(async () => {
        try { setLista(await rastreadoresGps()); setError(null); }
        catch (e: unknown) { setError(e instanceof Error ? e.message : "No se pudieron traer los rastreadores"); }
    }, []);
    useEffect(() => { traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);

    if (error && !lista) return <ErrorEstado mensaje={error} alReintentar={traer} />;
    if (!lista) return <Cargando texto="Trayendo los rastreadores…" />;
    const q = (busqueda || "").trim().toLowerCase();
    const filtrada = q ? lista.filter((r) => [r.nombre, r.imei, r.matricula].some((x) => (x || "").toLowerCase().includes(q))) : lista;
    if (!lista.length) return (
        <Vacio icono={Satellite} titulo="Todavía no se presentó ningún rastreador"
            ayuda="Un rastreador aparece acá solo cuando se conecta al receptor (puerto 1341 de este servidor). Apuntale el servidor al equipo y esperá su primer reporte." />
    );
    if (!filtrada.length) return <Vacio icono={Satellite} titulo="Ninguno coincide con la búsqueda" />;

    return (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
            {filtrada.map((r) => <Tarjeta key={r.imei} r={r} alCambiar={traer} />)}
        </div>
    );
}

function Tarjeta({ r, alCambiar }: { r: Rastreador; alCambiar: () => void }) {
    const [trabajando, setTrabajando] = useState(false);
    const [nombre, setNombre] = useState("");
    const [chapa, setChapa] = useState(r.matricula || "");
    const conPosicion = r.lat !== null && r.lon !== null;

    const alta = async () => {
        setTrabajando(true);
        try {
            const x = await darDeAltaGps(r.imei, nombre);
            if (!x.ok) toast.error({ title: "No se pudo dar de alta", description: x.error });
            else { toast.success({ title: "Rastreador dado de alta" }); alCambiar(); }
        } finally { setTrabajando(false); }
    };
    const atar = async () => {
        setTrabajando(true);
        try {
            const x = await atarVehiculoGps(r.imei, chapa);
            if (!x.ok) toast.error({ title: "No se pudo atar", description: x.error });
            else { toast.success({ title: chapa ? "Atado al vehículo" : "Desatado" }); alCambiar(); }
        } finally { setTrabajando(false); }
    };

    return (
        <article className="rounded-[10px] border border-border bg-card p-4">
            <header className="flex items-start gap-3">
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[10px]", r.enLinea ? "chip-bien" : "bg-muted text-muted-foreground")}><Satellite size={18} /></span>
                <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-bold tracking-[-0.01em] truncate">{r.nombre || `Rastreador ${r.imei.slice(-6)}`}</h3>
                    <p className="text-[11.5px] text-muted-foreground tabular-nums truncate">IMEI {r.imei}</p>
                </div>
                <Chip tono={r.enLinea ? "bien" : "quieto"}>{r.enLinea ? "En línea" : "Sin reportar"}</Chip>
            </header>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                <Dato icono={Power} rotulo="Motor" valor={r.encendido === null ? "—" : r.encendido ? "Encendido" : "Apagado"} />
                <Dato icono={BatteryCharging} rotulo="Batería del vehículo" valor={r.voltaje !== null ? `${r.voltaje.toFixed(1).replace(".", ",")} V` : "—"} />
                <Dato icono={Signal} rotulo="Señal" valor={r.senal !== null ? SENAL[Math.min(4, r.senal)] : "—"} />
                <Dato icono={Satellite} rotulo="Reportó" valor={hace(r.ultimoLatido, "nunca")} />
            </dl>

            <div className="mt-3 rounded-[8px] bg-muted/50 px-3 py-2.5">
                {conPosicion ? (
                    <>
                        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tabular-nums">
                            <MapPin size={13} className="text-muted-foreground shrink-0" /> {r.lat!.toFixed(5)}, {r.lon!.toFixed(5)}
                            {r.velocidad ? <span className="font-normal text-muted-foreground"> · {r.velocidad} km/h</span> : null}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                            Posición de {hace(r.cuando)} · {r.posiciones} {r.posiciones === 1 ? "punto guardado" : "puntos guardados"}
                        </p>
                    </>
                ) : (
                    <p className="text-[12.5px] text-muted-foreground">Todavía no mandó ninguna posición con satélites.</p>
                )}
            </div>

            {r.deviceId ? (
                <div className="mt-3 flex items-center gap-2">
                    <Car size={14} className="text-muted-foreground shrink-0" />
                    <input value={chapa} onChange={(e) => setChapa(e.target.value.toUpperCase())} placeholder="Matrícula del vehículo"
                        className="h-8 min-w-0 flex-1 px-2.5 rounded-[6px] border border-border bg-background text-[12.5px] tabular-nums" />
                    {chapa !== (r.matricula || "") && (
                        <Button variant="outline" size="sm" disabled={trabajando} onClick={atar}>
                            {trabajando && <Loader2 size={13} className="animate-spin" />} {chapa ? "Atar" : "Desatar"}
                        </Button>
                    )}
                    {conPosicion && <Button variant="ghost" size="sm" asChild><Link href={`/admin/mapa?gps=${r.imei}`}><MapPin size={13} /> Mapa</Link></Button>}
                </div>
            ) : (
                <div className="mt-3">
                    <p className="text-[11.5px] tono-aviso mb-1.5">Se presentó solo y no está dado de alta.</p>
                    <div className="flex items-center gap-2">
                        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej. Camioneta 1)"
                            className="h-8 min-w-0 flex-1 px-2.5 rounded-[6px] border border-border bg-background text-[12.5px]" />
                        <Button size="sm" disabled={trabajando} onClick={alta}>
                            {trabajando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Dar de alta
                        </Button>
                    </div>
                </div>
            )}
        </article>
    );
}

function Dato({ icono: Ico, rotulo, valor }: { icono: typeof Power; rotulo: string; valor: string }) {
    return (
        <div className="min-w-0">
            <dt className="flex items-center gap-1 text-[10.5px] text-muted-foreground"><Ico size={11} /> {rotulo}</dt>
            <dd className="font-semibold truncate">{valor}</dd>
        </div>
    );
}
