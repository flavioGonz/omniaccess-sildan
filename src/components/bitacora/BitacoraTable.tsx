"use client";

import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, ClipboardList, Play, Shield, X } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Matricula, Miniatura, Momento, Nada } from "@/components/ui/celdas";
import { getImagePath } from "@/lib/image-path";

/**
 * La bitácora de la consola de guardia.
 *
 * **Las fotos estaban rotas y nadie lo había notado.** El `src` usaba `entry.photoPath`
 * crudo — algo como `bitacora/abc.jpg` —, que el navegador resuelve contra la ruta actual y
 * termina pidiendo `/admin/consolas/bitacora/abc.jpg`: 404. Toda la aplicación pasa esos
 * caminos por `getImagePath`, que sabe dónde viven los archivos; acá se había salteado. Se
 * veía un recuadro vacío, que es indistinguible de un registro sin foto, y por eso podía
 * quedar así mucho tiempo.
 *
 * El resto es la tabla compartida. Lo que gana, además del encabezado fijo y el estado de
 * error: se puede ordenar por hora y por guardia, y se puede exportar — que en una
 * bitácora es media función.
 */

interface BitacoraTableProps {
    entries: any[];
    cargando?: boolean;
    error?: string | null;
    alReintentar?: () => void;
    hayMas?: boolean;
    traerMas?: () => void;
    barra?: React.ReactNode;
}

export default function BitacoraTable({
    entries, cargando, error, alReintentar, hayMas, traerMas, barra,
}: BitacoraTableProps) {
    const [foto, setFoto] = useState<string | null>(null);
    const [audio, setAudio] = useState<string | null>(null);

    const columnas = useMemo<ColumnaTabla<any>[]>(() => [
        {
            clave: "momento", titulo: "Momento", ancho: 130, ordenable: true,
            valor: (e) => new Date(e.timestamp).toISOString(),
            celda: (e) => <Momento t={e.timestamp} />,
        },
        {
            clave: "tipo", titulo: "Movimiento", ancho: 120, ordenable: true,
            tituloAyuda: "Si entró o salió",
            ayuda: "Lo que registró la guardia al levantar la barrera. No es un juicio: entrar y salir son igual de normales, así que ninguno va en verde ni en rojo.",
            valor: (e) => (e.type === "ENTRY" ? "Entrada" : "Salida"),
            celda: (e) => (
                <Estado tono={e.type === "ENTRY" ? "info" : "neutro"}>
                    {e.type === "ENTRY" ? "Entrada" : "Salida"}
                </Estado>
            ),
        },
        {
            clave: "matricula", titulo: "Matrícula", ancho: 140, ordenable: true,
            valor: (e) => e.plate || "",
            celda: (e) => e.plate ? <Matricula p={e.plate} /> : <Nada />,
        },
        {
            clave: "visitante", titulo: "Visitante", ancho: 190, ordenable: true,
            valor: (e) => e.name || "",
            celda: (e) => e.name
                ? <span className="text-[13px] font-semibold text-foreground truncate">{e.name}</span>
                : <span className="text-[12px] text-muted-foreground/60 italic">sin nombre</span>,
        },
        {
            clave: "destino", titulo: "Destino", ancho: 170, ordenable: true,
            tituloAyuda: "A qué unidad iba",
            ayuda: "Lo que dijo el visitante. Es el dato que después permite preguntarle al residente si lo esperaba.",
            valor: (e) => e.destination || "",
            celda: (e) => e.destination
                ? <span className="text-[12px] text-muted-foreground truncate">{e.destination}</span>
                : <Nada />,
        },
        {
            clave: "guardia", titulo: "Registrado por", ancho: 170, ordenable: true,
            valor: (e) => e.guardName || e.guard?.name || "",
            celda: (e) => {
                const quien = e.guardName || e.guard?.name;
                return quien
                    ? <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <Shield size={12} className="opacity-60" />{quien}
                    </span>
                    : <span className="text-[12px] text-muted-foreground/60 italic">el sistema</span>;
            },
        },
        {
            clave: "evidencia", titulo: "Evidencia", ancho: 120, auxiliar: true,
            valor: (e) => [e.photoPath && "foto", e.audioPath && "audio"].filter(Boolean).join(" "),
            celda: (e) => {
                const img = getImagePath(e.photoPath);
                return (
                    <div className="flex items-center gap-2">
                        <Miniatura src={img ? (img.includes("?") ? `${img}&w=96` : `${img}?w=96`) : null}
                            ancho={44} alto={30}
                            alAbrir={img ? () => setFoto(img) : undefined} />
                        {e.audioPath && (
                            <button type="button" title="Escuchar la nota de audio"
                                onClick={(ev) => { ev.stopPropagation(); setAudio(getImagePath(e.audioPath) || null); }}
                                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                <Play size={13} />
                            </button>
                        )}
                        {!img && !e.audioPath && <Nada />}
                    </div>
                );
            },
        },
    ], []);

    return (
        <>
            <Tabla<any>
                id="bitacora-consola"
                nombreArchivo="bitacora-guardia"
                filas={entries}
                clave={(e) => e.id}
                columnas={columnas}
                barra={barra}
                cargando={cargando}
                error={error}
                alReintentar={alReintentar}
                vacio={{
                    icono: ClipboardList,
                    titulo: "Sin registros",
                    ayuda: "Acá aparece lo que la guardia carga desde la consola: entradas, salidas y visitas, con su foto y su nota de audio.",
                }}
                masFilas={hayMas && traerMas ? { hay: hayMas, cargando, traer: traerMas, modo: "scroll" } : undefined}
                className="flex-1 min-h-0"
                alto="100%"
                pie={<span className="tabular-nums">{entries.length} registros</span>}
            />

            <AnimatePresence>
                {foto && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-background/92 backdrop-blur-sm z-[200] flex items-center justify-center p-6"
                        onClick={() => setFoto(null)}>
                        <button type="button" onClick={() => setFoto(null)} title="Cerrar"
                            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-card border border-border text-foreground flex items-center justify-center hover:bg-accent transition-colors">
                            <X size={18} />
                        </button>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <motion.img
                            initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
                            src={foto.includes("?") ? `${foto}&w=1400` : `${foto}?w=1400`} alt=""
                            onClick={(e) => e.stopPropagation()}
                            className="max-w-full max-h-full object-contain rounded-xl sombra-flotante" />
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {audio && (
                    <motion.div
                        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
                        className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] w-full max-w-md px-4">
                        <div className="bg-card border border-border rounded-2xl p-5 sombra-flotante flex flex-col items-center gap-3">
                            <span className="w-11 h-11 rounded-xl bg-muted border border-border flex items-center justify-center text-muted-foreground">
                                <Camera size={20} />
                            </span>
                            <p className="text-[13px] font-semibold text-foreground">Nota de audio del registro</p>
                            <audio autoPlay controls src={audio} className="w-full h-10" />
                            <button type="button" onClick={() => setAudio(null)}
                                className="text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors">
                                Cerrar
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
