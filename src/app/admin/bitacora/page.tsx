"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
    AlertTriangle, ArrowLeft, Camera, ClipboardList, Clock, FileText, MapPin,
    Play, RefreshCw, Shield, Smartphone, User as UserIcon,
} from "lucide-react";
import { getBitacoraEntries } from "@/app/actions/bitacora";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Filtros } from "@/components/ui/filtros";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Miniatura, Momento, Nada } from "@/components/ui/celdas";
import { getImagePath } from "@/lib/image-path";
import { fecha, hora, paraInput } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * La bitácora: lo que la guardia anotó.
 *
 * Es el registro que después se pide — cuando hubo un reclamo, cuando un vecino pregunta
 * quién entró, cuando hay que reconstruir una noche. Por eso lo que más se gana al migrar
 * no es la forma: es poder **ordenar y exportar**. Hasta acá, sacar la bitácora de un día
 * para mandarla era copiar de la pantalla a mano.
 *
 * Dos arreglos:
 *
 *   **Un fallo al cargar se veía como "Sin registros".** El `catch` escribía en la consola
 *   y seguía, así que la tabla quedaba vacía con el mismo cartel que una noche tranquila.
 *   En una bitácora esa confusión es grave: "no hubo novedades" y "no pudimos leer las
 *   novedades" son cosas muy distintas.
 *
 *   **Siete colores sin sistema.** Manual azul, rondín verde, merodeo rojo, pánico rojo,
 *   visita violeta, novedad ámbar — cada uno su borde y su texto, escritos a mano. Ahora
 *   salen de los tonos de la aplicación, y el tono dice algo: pánico y merodeo son `mal`
 *   porque son alarmas, novedad es `aviso`, rondín es `bien` porque es la guardia
 *   haciendo su trabajo, y una visita o una nota manual no son ni buenas ni malas.
 */

const TIPOS: Record<string, { etiqueta: string; tono: "bien" | "aviso" | "mal" | "info" | "neutro" }> = {
    MANUAL: { etiqueta: "Manual", tono: "neutro" },
    RONDIN: { etiqueta: "Rondín", tono: "bien" },
    PATROL: { etiqueta: "Rondín", tono: "bien" },
    MERODEO: { etiqueta: "Merodeo", tono: "mal" },
    PANIC: { etiqueta: "Pánico", tono: "mal" },
    VISITA: { etiqueta: "Visita", tono: "info" },
    NOVEDAD: { etiqueta: "Novedad", tono: "aviso" },
};

const tipoDe = (t?: string) =>
    TIPOS[(t || "").toUpperCase()] || { etiqueta: t || "Registro", tono: "neutro" as const };

const miniatura = (path?: string | null) => {
    const u = getImagePath(path) || "";
    return u ? (u.includes("?") ? `${u}&w=96` : `${u}?w=96`) : "";
};

const PAGINA = 60;

export default function BitacoraPage() {
    const router = useRouter();
    const [entradas, setEntradas] = useState<any[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busqueda, setBusqueda] = useState("");
    const [dia, setDia] = useState("");
    /** Los tipos agrupados por lo que hay que hacer con ellos, no por su nombre interno. */
    const [clase, setClase] = useState("todo");
    const [aLaVista, setALaVista] = useState(PAGINA);
    const [elegida, setElegida] = useState<any | null>(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            setEntradas(await getBitacoraEntries());
            setError(null);
        } catch (e: any) {
            setError(e?.message || "No se pudo leer la bitácora.");
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => { setALaVista(PAGINA); }, [busqueda, dia, clase]);

    const filtradas = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return entradas.filter((e: any) => {
            const coincide = !q || [e.plate, e.name, e.destination, e.notes, e.guardName]
                .some((v) => (v || "").toLowerCase().includes(q));
            const mismoDia = !dia || paraInput(e.timestamp).slice(0, 10) === dia;
            const t = (e.type || "").toUpperCase();
            const esClase = clase === "todo"
                || (clase === "alertas" && (t === "PANIC" || t === "MERODEO" || t === "NOVEDAD"))
                || (clase === "rondines" && (t === "RONDIN" || t === "PATROL"))
                || (clase === "visitas" && t === "VISITA");
            return coincide && mismoDia && esClase;
        });
    }, [entradas, busqueda, dia, clase]);

    const visibles = useMemo(() => filtradas.slice(0, aLaVista), [filtradas, aLaVista]);

    const columnas = useMemo<ColumnaTabla<any>[]>(() => [
        {
            clave: "momento", titulo: "Momento", ancho: 140, ordenable: true,
            tituloAyuda: "Cuándo se anotó",
            ayuda: "La hora en que la guardia registró el hecho, que no siempre es la hora del hecho: un rondín se anota al terminarlo.",
            valor: (e) => new Date(e.timestamp).toISOString(),
            celda: (e) => <Momento t={e.timestamp} />,
        },
        {
            clave: "tipo", titulo: "Tipo", ancho: 120, ordenable: true,
            tituloAyuda: "Qué clase de registro es",
            ayuda: "Pánico y merodeo son alarmas; novedad es algo que hay que mirar; rondín es la guardia haciendo su recorrido; visita y manual son registros comunes.",
            valor: (e) => tipoDe(e.type).etiqueta,
            celda: (e) => {
                const t = tipoDe(e.type);
                return <Estado tono={t.tono}>{t.etiqueta}</Estado>;
            },
        },
        {
            clave: "detalle", titulo: "Novedad / detalle", ordenable: true,
            tituloAyuda: "Qué pasó",
            ayuda: "Lo que escribió la guardia. Si hay matrícula, va adelante.",
            valor: (e) => [e.plate, e.name, e.destination, e.notes].filter(Boolean).join(" "),
            celda: (e) => (
                <div className="min-w-0">
                    <div className="text-[13px] text-foreground truncate">
                        {e.plate && <span className="font-bold tabular-nums tracking-[0.08em] mr-2">{e.plate}</span>}
                        {e.name || e.destination || e.notes || "—"}
                    </div>
                    {(e.name || e.destination) && e.notes && (
                        <div className="text-[11px] text-muted-foreground truncate mt-0.5">{e.notes}</div>
                    )}
                </div>
            ),
        },
        {
            clave: "guardia", titulo: "Guardia", ancho: 160, ordenable: true,
            tituloAyuda: "Quién lo anotó",
            ayuda: "El guardia que firmó el registro. Un registro sin guardia vino de un dispositivo, no de una persona.",
            valor: (e) => e.guardName || "",
            celda: (e) => e.guardName
                ? <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Shield size={12} className="opacity-60" />{e.guardName}
                </span>
                : <Nada />,
        },
        {
            clave: "evidencia", titulo: "Evidencia", ancho: 130, auxiliar: true,
            tituloAyuda: "Qué quedó guardado",
            ayuda: "La foto, el audio y la ubicación que el dispositivo de guardia adjuntó al registro.",
            valor: (e) => [e.photoPath && "foto", e.audioPath && "audio", (e.latitude && e.longitude) && "ubicación"].filter(Boolean).join(" "),
            celda: (e) => (
                <div className="flex items-center gap-2">
                    <Miniatura src={miniatura(e.photoPath)} ancho={44} alto={30} />
                    {e.audioPath && <Play size={13} className="text-muted-foreground" />}
                    {e.latitude && e.longitude && <MapPin size={13} className="text-muted-foreground" />}
                </div>
            ),
        },
    ], []);

    return (
        <div className="h-full flex flex-col bg-background overflow-hidden">
            <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md flex items-center justify-between shrink-0 gap-4">
                <div className="flex items-center gap-4">
                    <button type="button" onClick={() => router.back()} title="Volver"
                        className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        <ArrowLeft size={17} />
                    </button>
                    <span className="w-11 h-11 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground">
                        <ClipboardList size={20} />
                    </span>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Bitácora</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Lo que anotó la guardia: novedades, rondines y visitas
                        </p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Registros</p>
                    <p className="text-2xl font-bold text-foreground tabular-nums">{filtradas.length}</p>
                </div>
            </header>

            <main className="flex-1 overflow-hidden px-8 py-6 flex flex-col">
                {/* Sin tarjeta alrededor de la tabla: la tabla es la pantalla. El aire lo
                    pone el margen, no un borde. */}
                <div className="flex-1 flex flex-col min-h-0">
                    <Tabla<any>
                        id="bitacora"
                        nombreArchivo="bitacora"
                        filas={visibles}
                        clave={(e) => e.id}
                        columnas={columnas}
                        cargando={cargando}
                        error={error}
                        alReintentar={cargar}
                        alClickFila={setElegida}
                        vacio={{
                            icono: FileText,
                            titulo: busqueda || dia || clase !== "todo" ? "Ningún registro coincide" : "La bitácora está vacía",
                            ayuda: busqueda || dia || clase !== "todo"
                                ? "Probá con otra palabra o sacá el filtro de fecha."
                                : "Acá aparecen las novedades, los rondines y las visitas que carga la guardia desde su dispositivo.",
                        }}
                        masFilas={{
                            hay: aLaVista < filtradas.length,
                            cargando: false,
                            traer: () => setALaVista((n) => n + PAGINA),
                            modo: "scroll",
                        }}
                        className="flex-1 min-h-0"
                        alto="100%"
                        pie={<span className="tabular-nums">{visibles.length} de {filtradas.length} registros</span>}
                        barra={
                            <Filtros
                                busqueda={busqueda} alBuscar={setBusqueda}
                                placeholder="Matrícula, guardia, novedad"
                                grupos={[{
                                    clave: "clase", titulo: "Qué clase de registro",
                                    valor: clase, alElegir: setClase,
                                    opciones: [
                                        { valor: "todo", rotulo: "Todo" },
                                        { valor: "alertas", rotulo: "Alertas" },
                                        { valor: "rondines", rotulo: "Rondines" },
                                        { valor: "visitas", rotulo: "Visitas" },
                                    ],
                                }]}
                                acciones={
                                    <button type="button" onClick={cargar} title="Volver a pedir"
                                        className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                        <RefreshCw size={15} className={cn(cargando && "animate-spin")} />
                                    </button>
                                }>
                                <input type="date" value={dia} onChange={(e) => setDia(e.target.value)}
                                    className="h-[34px] px-3 rounded-lg bg-muted/60 border-0 text-[12px] text-foreground" />
                                {dia && (
                                    <button type="button" onClick={() => setDia("")}
                                        className="text-[12px] text-muted-foreground hover:text-foreground">
                                        todo
                                    </button>
                                )}
                            </Filtros>
                        }
                    />
                </div>
            </main>

            <Dialog open={!!elegida} onOpenChange={(o) => { if (!o) setElegida(null); }}>
                <DialogContent className="max-w-2xl">
                    {elegida && (() => {
                        const t = tipoDe(elegida.type);
                        const img = getImagePath(elegida.photoPath) || "";
                        return (
                            <div>
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-3">
                                        <Estado tono={t.tono}>{t.etiqueta}</Estado>
                                        <span className="text-[17px] font-bold">
                                            {elegida.plate
                                                ? <span className="tabular-nums tracking-[0.08em]">{elegida.plate}</span>
                                                : (elegida.name || "Registro")}
                                        </span>
                                    </DialogTitle>
                                </DialogHeader>
                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="rounded-xl overflow-hidden border border-border bg-muted aspect-video flex items-center justify-center">
                                        {img
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            ? <img src={img.includes("?") ? `${img}&w=800` : `${img}?w=800`} alt="" className="w-full h-full object-cover" />
                                            : <Camera size={30} className="text-muted-foreground/40" />}
                                    </div>
                                    <div className="space-y-3">
                                        <Campo icono={<Clock size={13} />} etiqueta="Fecha / hora"
                                            valor={`${fecha(elegida.timestamp)} · ${hora(elegida.timestamp)}`} />
                                        <Campo icono={<Shield size={13} />} etiqueta="Guardia" valor={elegida.guardName || "—"} />
                                        {elegida.name && <Campo icono={<UserIcon size={13} />} etiqueta="Nombre" valor={elegida.name} />}
                                        {elegida.dni && <Campo icono={<Smartphone size={13} />} etiqueta="Documento" valor={elegida.dni} />}
                                        {elegida.company && <Campo icono={<FileText size={13} />} etiqueta="Empresa" valor={elegida.company} />}
                                        {elegida.destination && <Campo icono={<MapPin size={13} />} etiqueta="Destino" valor={elegida.destination} />}
                                    </div>
                                </div>
                                {elegida.notes && (
                                    <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                            <AlertTriangle size={12} /> Novedad
                                        </p>
                                        <p className="text-[13px] text-foreground whitespace-pre-wrap">{elegida.notes}</p>
                                    </div>
                                )}
                                <div className="mt-4 flex items-center gap-3">
                                    {elegida.audioPath && (
                                        <audio controls src={getImagePath(elegida.audioPath) || undefined} className="h-9" />
                                    )}
                                    {elegida.latitude && elegida.longitude && (
                                        <a href={`https://www.google.com/maps?q=${elegida.latitude},${elegida.longitude}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 text-[13px] font-semibold tono-accion hover:underline">
                                            <MapPin size={14} /> Ver dónde fue
                                        </a>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Campo({ icono, etiqueta, valor }: { icono: React.ReactNode; etiqueta: string; valor: string }) {
    return (
        <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                {icono}{etiqueta}
            </p>
            <p className="text-[13px] text-foreground font-medium mt-0.5">{valor}</p>
        </div>
    );
}
