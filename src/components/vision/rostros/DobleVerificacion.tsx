"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ScanFace, ShieldCheck, Users } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Miniatura, Momento, Nada } from "@/components/ui/celdas";
import { Filtros } from "@/components/ui/filtros";
import { ErrorEstado } from "@/components/ui/estados";
import { pasadasDobles, type PasadaDoble, type RespuestaDoble } from "@/app/actions/rostros-doble";
import type { Veredicto } from "@/lib/rostros-doble";
import { cn } from "@/lib/utils";

/**
 * Doble verificación: qué reconoció el EQUIPO y qué reconocimos NOSOTROS, en la misma pasada.
 *
 * Pedido de Nico (18/11). La pantalla no inventa una conclusión: pone las dos opiniones una al
 * lado de la otra y dice si coinciden. Cuando habló uno solo, lo dice también — que es el estado
 * normal hasta que las dos integraciones estén completas, y es información, no un hueco.
 */

const TONO: Record<Veredicto, { tono: "bien" | "mal" | "aviso" | "info" | "neutro"; texto: string; ayuda: string }> = {
    coinciden: { tono: "bien", texto: "Coinciden", ayuda: "Los dos reconocieron a la misma persona." },
    discrepan: { tono: "mal", texto: "Discrepan", ayuda: "Cada uno dijo que es otra persona: hay que mirar la pasada." },
    "solo-equipo": { tono: "aviso", texto: "Sólo el equipo", ayuda: "El equipo la reconoció y nosotros no: esa cara todavía no está en nuestro motor." },
    "solo-nosotros": { tono: "info", texto: "Sólo nosotros", ayuda: "La reconocimos nosotros y el equipo no dijo nada de esa pasada." },
    nadie: { tono: "neutro", texto: "Nadie", ayuda: "Pasó alguien y ninguno de los dos lo reconoció." },
};

const DIAS = [1, 7, 30];

export function DobleVerificacion() {
    const [dias, setDias] = useState(7);
    const [equipo, setEquipo] = useState<string>("");
    const [datos, setDatos] = useState<RespuestaDoble | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);

    const cargar = useCallback(async () => {
        setCargando(true);
        try { setDatos(await pasadasDobles({ dias, deviceId: equipo || null })); setError(null); }
        catch (e: unknown) { setError(e instanceof Error ? e.message : "No se pudo traer la comparación"); }
        finally { setCargando(false); }
    }, [dias, equipo]);
    useEffect(() => { cargar(); }, [cargar]);

    if (error) return <ErrorEstado mensaje={error} alReintentar={cargar} />;

    const r = datos?.resumen;
    const columnas: ColumnaTabla<PasadaDoble>[] = [
        {
            clave: "cuando", titulo: "Cuándo", ancho: 150, ordenable: true,
            valor: (f) => new Date(f.cuando).toISOString(),
            celda: (f) => <Momento t={new Date(f.cuando)} />,
        },
        {
            clave: "equipo", titulo: "Equipo", ancho: 190,
            valor: (f) => f.equipoNombre || "",
            celda: (f) => <span className="truncate text-[12.5px]">{f.equipoNombre || <Nada />}</span>,
        },
        {
            clave: "cara", titulo: "Cara", ancho: 72, auxiliar: true,
            celda: (f) => f.nuestro?.cara
                ? <Miniatura src={f.nuestro.cara} alt="" ancho={48} alto={48} />
                : <span className="grid h-12 w-12 place-items-center rounded-md bg-muted text-muted-foreground"><ScanFace size={16} /></span>,
        },
        {
            clave: "dijoEquipo", titulo: "Dijo el equipo", ayuda: "El nombre que tiene cargado adentro el portero o el control de acceso.",
            valor: (f) => f.equipo?.nombre || "",
            celda: (f) => <Opinion nombre={f.equipo?.nombre} similitud={f.equipo?.similitud} detalle={f.equipo?.legajo ? `legajo ${f.equipo.legajo}` : null} />,
        },
        {
            clave: "dijimos", titulo: "Dijimos nosotros", ayuda: "Lo que reconoció el motor de rostros de OmniVision sobre el mismo instante.",
            valor: (f) => f.nuestro?.nombre || "",
            celda: (f) => <Opinion nombre={f.nuestro?.nombre} similitud={f.nuestro?.similitud} detalle={null} />,
        },
        {
            clave: "veredicto", titulo: "Veredicto", ancho: 150,
            valor: (f) => TONO[f.veredicto].texto,
            celda: (f) => <Estado tono={TONO[f.veredicto].tono} icono={f.veredicto === "coinciden" ? Check : f.veredicto === "discrepan" ? AlertTriangle : undefined}>{TONO[f.veredicto].texto}</Estado>,
        },
    ];

    return (
        <div className="space-y-4">
            {datos && !datos.prendida && (
                <p className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-[12.5px] text-muted-foreground flex items-start gap-2">
                    <ShieldCheck size={15} className="mt-0.5 shrink-0 tono-aviso" />
                    <span>
                        La doble verificación está <b className="text-foreground">apagada</b>: acá se ve igual, pero no se usa para decidir nada.
                        Se prende en <Link href="/admin/settings?seccion=caracteristicas" className="font-semibold text-[var(--accion)] hover:underline">Ajustes › Características</Link>.
                    </span>
                </p>
            )}

            {r && (
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                    <Cifra titulo="Acuerdo" valor={r.acuerdo != null ? `${r.acuerdo} %` : "—"} ayuda={r.acuerdo != null ? `De las ${r.coinciden + r.discrepan} pasadas en que hablaron los dos.` : "Todavía no hay ninguna pasada con las dos opiniones."} tono={r.acuerdo == null ? "neutro" : r.acuerdo >= 90 ? "bien" : r.acuerdo >= 70 ? "aviso" : "mal"} />
                    <Cifra titulo="Coinciden" valor={String(r.coinciden)} tono="bien" />
                    <Cifra titulo="Discrepan" valor={String(r.discrepan)} tono={r.discrepan ? "mal" : "neutro"} />
                    <Cifra titulo="Sólo el equipo" valor={String(r["solo-equipo"])} ayuda="Esas caras no están en nuestro motor todavía." />
                    <Cifra titulo="Sólo nosotros" valor={String(r["solo-nosotros"])} ayuda="El equipo no nos contó esas pasadas." />
                </div>
            )}

            <Filtros solido grupos={[
                { clave: "dias", titulo: "Período", valor: String(dias), alElegir: (v) => setDias(Number(v)), opciones: DIAS.map((d) => ({ valor: String(d), rotulo: d === 1 ? "Hoy" : `${d} días` })) },
                ...(datos && datos.equipos.length > 1 ? [{
                    clave: "equipo", titulo: "Equipo", valor: equipo, alElegir: setEquipo,
                    opciones: [{ valor: "", rotulo: "Todos" }, ...datos.equipos.map((e) => ({ valor: e.id, rotulo: e.nombre }))],
                }] : []),
            ]} />

            <Tabla
                filas={datos?.pares || []}
                clave={(f: PasadaDoble) => `${f.equipo?.id || ""}|${f.nuestro?.id || ""}`}
                columnas={columnas}
                cargando={cargando && !datos}
                alto="calc(100vh - 430px)"
                vacio={{
                    icono: Users,
                    titulo: "Todavía no hay pasadas para comparar",
                    ayuda: "Hace falta que los dos lados registren algo en este período.",
                }}
            />

            {/* Por qué no hay pares: el número de cada lado lo explica sin que haya que adivinar. */}
            {datos && datos.equipos.length > 0 && (
                <div className="rounded-lg border border-border divide-y divide-border">
                    {datos.equipos.map((e) => (
                        <div key={e.id} className="flex items-center gap-3 px-3.5 py-2 text-[12.5px]">
                            <span className="font-semibold truncate flex-1">{e.nombre}</span>
                            <span className="tabular-nums text-muted-foreground">{e.delEquipo} del equipo</span>
                            <span className="tabular-nums text-muted-foreground">{e.propias} nuestras</span>
                            {!e.delEquipo && <span className="text-[11.5px] tono-aviso">no nos cuenta sus pasadas</span>}
                            {!e.propias && <span className="text-[11.5px] tono-aviso">no le estamos mirando la cara</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Lo que dijo un lado: el nombre manda, la similitud va al lado y con su tono. */
function Opinion({ nombre, similitud, detalle }: { nombre?: string | null; similitud?: number | null; detalle?: string | null }) {
    const hay = !!nombre && !/^(desconocido|unknown|-)?$/i.test(nombre.trim());
    return (
        <span className="min-w-0 flex items-baseline gap-2">
            <span className={cn("truncate text-[13px]", hay ? "font-bold" : "text-muted-foreground italic")}>{hay ? nombre : nombre ? "Desconocido" : "—"}</span>
            {similitud != null && (
                <span className={cn("text-[11.5px] font-semibold tabular-nums shrink-0", similitud >= 85 ? "tono-bien" : similitud >= 65 ? "tono-aviso" : "tono-mal")}>{Math.round(similitud)} %</span>
            )}
            {detalle && <span className="text-[11px] text-muted-foreground shrink-0">{detalle}</span>}
        </span>
    );
}

/** Una cifra del resumen. Sin sombra ni caja de color: superficie y una línea, como el resto. */
function Cifra({ titulo, valor, ayuda, tono = "neutro" }: { titulo: string; valor: string; ayuda?: string; tono?: "bien" | "mal" | "aviso" | "neutro" }) {
    return (
        <div className="rounded-[10px] border border-border bg-card px-3.5 py-3">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{titulo}</div>
            <div className={cn("mt-1 text-[22px] font-bold leading-none tabular-nums",
                tono === "bien" ? "tono-bien" : tono === "mal" ? "tono-mal" : tono === "aviso" ? "tono-aviso" : "")}>{valor}</div>
            {ayuda && <div className="mt-1.5 text-[11.5px] text-muted-foreground leading-snug">{ayuda}</div>}
        </div>
    );
}
