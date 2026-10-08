"use client";

import { useState } from "react";
import { AlertTriangle, ListChecks, Loader2, ShieldAlert, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cajon, CajonContenido, CajonDisparador, CajonSeccion } from "@/components/ui/cajon";
import { cn } from "@/lib/utils";

/**
 * Confirmar una acción grave en un cajón, no en un diálogo centrado.
 *
 * `ConfirmarAccion` (DeleteConfirmDialog) sigue siendo lo correcto para la pregunta corta
 * de una fila: "¿borro este grupo?". Esto es para lo otro — lo que afecta a muchos
 * registros a la vez, tarda, y conviene explicar ANTES de apretar: qué se va a tocar,
 * en qué orden, qué pasa si algo falla a mitad de camino. En un diálogo de 420 px eso
 * quedaba como un párrafo apretado en una caja roja que nadie lee; en un cajón cada cosa
 * va en su bloque y la lista de atrás sigue a la vista.
 *
 * Mismo contrato que `ConfirmarAccion` (id, title, description, onDelete, onSuccess,
 * escribir, etiquetaAccion, open/onOpenChange, children como disparador) para que pasar
 * un modal a cajón sea cambiar el nombre del componente y, si se quiere, agregar `pasos`
 * y `cifras`. Así es como se van a ir cambiando los modales uno por uno.
 */

type Resultado = void | { success?: boolean; error?: string | null } | null | undefined;

/** Un número que el operador tiene que ver antes de confirmar. El tono dice si es grave. */
export type CifraConfirmar = { rotulo: string; valor: number | string; tono?: "mal" | "aviso" | "neutro" };

export function ConfirmarEnCajon({
    id, title, description, onDelete, onSuccess, children, escribir, etiquetaAccion,
    open: abiertoControlado, onOpenChange, pasos, cifras, siFalla, vacio, onFallo,
}: {
    id: string;
    title: string;
    /** Qué se pierde, en una o dos frases. Va en el bloque rojo de arriba. */
    description?: string;
    onDelete: (id: string) => Promise<Resultado>;
    onSuccess: () => void;
    children?: React.ReactNode;
    /** Si viene, hay que escribir esta palabra. Para lo que no tiene vuelta atrás. */
    escribir?: string;
    etiquetaAccion?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Qué hace el sistema, en orden. Cada paso una frase. */
    pasos?: string[];
    /** Los números que importan: cuántos registros, cuántos asignados, cuántos equipos. */
    cifras?: CifraConfirmar[];
    /** Qué pasa si algo sale mal a mitad de camino. */
    siFalla?: string;
    /**
     * Si viene, no hay nada sobre qué actuar y el botón no se habilita: se dice esto en
     * su lugar. Un "Eliminar todo" activo sobre una lista vacía promete algo que no va a pasar.
     */
    vacio?: string;
    /**
     * Se llama si falla. Una operación de muchos registros puede fallar a la mitad: lo que
     * sí se hizo ya cambió la lista de atrás, y hay que refrescarla aunque haya error.
     */
    onFallo?: () => void;
}) {
    const [abiertoPropio, setAbiertoPropio] = useState(false);
    const abierto = abiertoControlado !== undefined ? abiertoControlado : abiertoPropio;
    const setAbierto = onOpenChange !== undefined ? onOpenChange : setAbiertoPropio;

    const [corriendo, setCorriendo] = useState(false);
    const [fallo, setFallo] = useState<string | null>(null);
    const [escrito, setEscrito] = useState("");
    const habilitado = !vacio && (!escribir || escrito.trim().toUpperCase() === escribir.toUpperCase());

    const cambiar = (o: boolean) => {
        // Mientras corre no se cierra: cerrar no frena al servidor, sólo esconde el resultado.
        if (!o && corriendo) return;
        if (!o) { setFallo(null); setEscrito(""); }
        setAbierto(o);
    };

    const ejecutar = async () => {
        setCorriendo(true);
        setFallo(null);
        try {
            const r = await onDelete(id);
            if (r && typeof r === "object" && r.success === false) {
                setFallo(r.error || "El servidor rechazó la operación.");
                onFallo?.();
                return;
            }
            setCorriendo(false);
            setEscrito("");
            setAbierto(false);
            onSuccess();
        } catch (e: any) {
            setFallo(e?.message || "No se pudo completar.");
            onFallo?.();
        } finally {
            setCorriendo(false);
        }
    };

    return (
        <Cajon open={abierto} onOpenChange={cambiar}>
            {children && <CajonDisparador asChild>{children}</CajonDisparador>}
            <CajonContenido ancho="angosto" titulo={title} descripcion="Esta acción no se puede deshacer."
                onEscapeKeyDown={(e) => { if (corriendo) e.preventDefault(); }}
                onPointerDownOutside={(e) => { if (corriendo) e.preventDefault(); }}
                pie={
                    <>
                        <Button variant="ghost" onClick={() => cambiar(false)} disabled={corriendo}
                            className="h-9 px-4 rounded-md text-[13px] font-semibold text-muted-foreground hover:text-foreground">
                            Cancelar
                        </Button>
                        <Button onClick={ejecutar} disabled={corriendo || !habilitado}
                            className="pleno-mal h-9 px-4 rounded-md text-[13px] font-semibold gap-1.5 hover:brightness-110 disabled:opacity-40">
                            {corriendo ? <><Loader2 size={14} className="animate-spin" /> Trabajando…</>
                                : fallo ? "Reintentar" : <><Trash2 size={14} /> {etiquetaAccion || "Eliminar"}</>}
                        </Button>
                    </>
                }>

                <CajonSeccion titulo="" className="pt-6 pb-6">
                    <div className="rounded-[10px] border chip-mal p-4 flex items-start gap-3">
                        <ShieldAlert size={18} className="shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <p className="text-[13px] font-semibold">{vacio ? "No hay nada para eliminar" : "Lo que se pierde"}</p>
                            <p className="text-[12.5px] leading-relaxed text-foreground/80 mt-1">{vacio || description}</p>
                        </div>
                    </div>

                    {cifras && cifras.length > 0 && (
                        <div className={cn("grid gap-2", cifras.length >= 3 ? "grid-cols-3" : "grid-cols-2")}>
                            {cifras.map((c) => (
                                <div key={c.rotulo} className="rounded-[10px] border border-border bg-card px-3 py-2.5">
                                    <p className={cn("text-[20px] font-bold tabular-nums leading-none",
                                        c.tono === "mal" ? "tono-mal" : c.tono === "aviso" ? "tono-aviso" : "text-foreground")}>{c.valor}</p>
                                    <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">{c.rotulo}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </CajonSeccion>

                {pasos && pasos.length > 0 && (
                    <CajonSeccion titulo="Qué va a hacer el sistema" icono={ListChecks}>
                        <ol className="space-y-2.5">
                            {pasos.map((p, i) => (
                                <li key={i} className="flex items-start gap-3 text-[12.5px] leading-relaxed text-foreground/85">
                                    <span className="w-5 h-5 shrink-0 rounded-full border border-border bg-muted text-[10.5px] font-bold tabular-nums flex items-center justify-center text-muted-foreground">{i + 1}</span>
                                    <span className="pt-px">{p}</span>
                                </li>
                            ))}
                        </ol>
                    </CajonSeccion>
                )}

                {siFalla && (
                    <CajonSeccion titulo="Si algo falla" icono={Undo2}>
                        <p className="text-[12.5px] leading-relaxed text-foreground/85">{siFalla}</p>
                    </CajonSeccion>
                )}

                {!vacio && escribir && (
                    <CajonSeccion titulo="Confirmación" icono={AlertTriangle}
                        ayuda="Un botón se aprieta por reflejo; una palabra no se escribe por reflejo.">
                        <label className="block">
                            <span className="block text-[12px] text-muted-foreground mb-1.5">
                                Escribí <span className="font-bold text-foreground tracking-wide">{escribir}</span> para habilitar el botón.
                            </span>
                            <Input value={escrito} onChange={(e) => setEscrito(e.target.value)} disabled={corriendo}
                                autoComplete="off" spellCheck={false} placeholder={escribir}
                                className="h-10 font-semibold tracking-wide" />
                        </label>
                    </CajonSeccion>
                )}

                {corriendo && (
                    <CajonSeccion titulo="">
                        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                            <Loader2 size={14} className="animate-spin tono-accion" />
                            Trabajando. Puede tardar: no cierres esta ventana hasta que termine.
                        </p>
                    </CajonSeccion>
                )}

                {fallo && (
                    <CajonSeccion titulo="">
                        <div className="rounded-[10px] border chip-mal p-4">
                            <p className="text-[13px] font-semibold">No se completó</p>
                            <p className="text-[12.5px] leading-relaxed text-foreground/80 mt-1">{fallo}</p>
                        </div>
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}
