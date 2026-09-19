"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Trash2 } from "lucide-react";

/**
 * Confirmar una eliminación. Uno solo para toda la aplicación.
 *
 * Tres cosas estaban mal, y las tres se notaban recién en el peor momento:
 *
 *   **Decía «este usuario» siempre.** El texto de advertencia estaba escrito fijo — «Si
 *   eliminas este usuario del dispositivo, dejará de tener acceso inmediatamente» — así que
 *   al borrar un vehículo, una unidad o un grupo el diálogo hablaba de un usuario que no
 *   existía. Peor: `description`, la prop pensada justamente para decir qué se pierde en
 *   cada caso, estaba declarada y **nunca se usaba**.
 *
 *   **Un borrado fallido se veía igual que uno exitoso.** `onDelete` devuelve
 *   `{ success, error }` en casi todas las acciones, y acá se ignoraba: el diálogo cerraba
 *   y avisaba éxito aunque la base hubiera rechazado la operación. El registro volvía a
 *   aparecer al recargar y nadie sabía por qué. Ahora, si falla, el diálogo queda abierto y
 *   muestra el motivo.
 *
 *   **El botón rojo usaba `text-foreground`**, que en tema claro es casi negro: texto
 *   oscuro sobre rojo. El blanco sobre rojo no depende del tema, y por eso va fijo.
 */

type Resultado = void | { success?: boolean; error?: string | null } | null | undefined;

/*
 * Se llama ConfirmarAccion y no DeleteConfirmDialog porque no todas las acciones que hay
 * que confirmar son borrados: cambiar la base de datos, volcar el padrón sobre un equipo o
 * resetear un plano no borran un registro y son igual de difíciles de deshacer. El nombre
 * viejo queda exportado al final del archivo para no tener que tocar los veinte lugares que
 * ya lo usan — cambiarlos todos de golpe sería churn sin ninguna ganancia.
 */

interface ConfirmarAccionProps {
    id: string;
    /** Qué se va a borrar, con su nombre. Es lo que el operador lee para confirmar. */
    title: string;
    /** Qué se pierde exactamente. Si no viene, se dice lo genérico y nada más. */
    description?: string;
    onDelete: (id: string) => Promise<Resultado>;
    onSuccess: () => void;
    /**
     * El disparador. Es OPCIONAL: sin él, el diálogo es puramente controlado.
     *
     * Hay dos maneras legítimas de pedir una confirmación. Una es envolver el botón que la
     * dispara — cómoda cuando el botón existe y está ahí. La otra es abrirla desde un
     * manejador que ya está corriendo, que es el caso de todo lo que antes usaba
     * `confirm()`: ahí no hay un botón que envolver, hay una función a mitad de camino.
     * Soportar las dos evita que aparezca un quinto mecanismo de confirmación para el
     * segundo caso.
     */
    /**
     * Si viene, hay que ESCRIBIR esta palabra para que el botón se habilite.
     *
     * Es para lo que no tiene vuelta atrás y afecta a muchos registros a la vez — purgar
     * una tabla entera, por ejemplo. Un botón de confirmar se aprieta por reflejo; nadie
     * escribe una palabra por reflejo. No es burocracia: es el único freno que obliga a
     * leer qué se está por hacer.
     */
    escribir?: string;
    /** Qué dice el botón. Por defecto "Eliminar". */
    etiquetaAccion?: string;
    children?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function ConfirmarAccion({
    id, title, description, onDelete, onSuccess, children, escribir, etiquetaAccion,
    open: abiertoControlado, onOpenChange,
}: ConfirmarAccionProps) {
    const [abiertoPropio, setAbiertoPropio] = useState(false);
    const abierto = abiertoControlado !== undefined ? abiertoControlado : abiertoPropio;
    const setAbierto = onOpenChange !== undefined ? onOpenChange : setAbiertoPropio;

    const [borrando, setBorrando] = useState(false);
    const [fallo, setFallo] = useState<string | null>(null);
    const [escrito, setEscrito] = useState("");
    const habilitado = !escribir || escrito.trim().toUpperCase() === escribir.toUpperCase();

    const borrar = async () => {
        setBorrando(true);
        setFallo(null);
        try {
            const r = await onDelete(id);
            if (r && typeof r === "object" && r.success === false) {
                setFallo(r.error || "El servidor rechazó la eliminación.");
                return;
            }
            setAbierto(false);
            onSuccess();
        } catch (e: any) {
            setFallo(e?.message || "No se pudo completar la eliminación.");
        } finally {
            setBorrando(false);
        }
    };

    return (
        <Dialog open={abierto} onOpenChange={(o) => { if (!o) { setFallo(null); setEscrito(""); } setAbierto(o); }}>
            {children && <DialogTrigger asChild>{children}</DialogTrigger>}
            <DialogContent className="max-w-[420px] p-0 gap-0 overflow-hidden">
                <div className="flex flex-col items-center text-center px-8 pt-9 pb-6 space-y-5">
                    <span className="w-14 h-14 rounded-2xl bg-[var(--mal-suave)] border border-border flex items-center justify-center text-[var(--mal-texto)]">
                        <Trash2 size={24} />
                    </span>

                    <div className="space-y-2">
                        <DialogHeader>
                            <DialogTitle className="text-[17px] font-bold text-center">{title}</DialogTitle>
                        </DialogHeader>
                        <DialogDescription className="text-[13px] text-muted-foreground leading-relaxed">
                            Esta acción no se puede deshacer.
                        </DialogDescription>
                    </div>

                    {description && (
                        <div className="w-full rounded-xl border border-border bg-[var(--mal-suave)] p-3.5 flex items-start gap-2.5 text-left">
                            <AlertTriangle className="shrink-0 text-[var(--mal-texto)] mt-0.5" size={15} />
                            <p className="text-[12px] text-muted-foreground leading-normal">{description}</p>
                        </div>
                    )}

                    {escribir && (
                        <div className="w-full text-left space-y-1.5">
                            <p className="text-[12px] text-muted-foreground">
                                Escribí <span className="font-bold text-foreground">{escribir}</span> para confirmar.
                            </p>
                            <Input value={escrito} onChange={(e) => setEscrito(e.target.value)}
                                autoComplete="off" spellCheck={false} className="h-10" />
                        </div>
                    )}

                    {fallo && (
                        <div className="w-full rounded-xl border bg-[var(--mal-suave)] border-[color-mix(in_oklab,var(--mal)_34%,transparent)] p-3.5 text-left">
                            <p className="text-[12px] font-semibold text-[var(--mal-texto)]">No se eliminó</p>
                            <p className="text-[12px] text-muted-foreground leading-normal mt-0.5">{fallo}</p>
                        </div>
                    )}
                </div>

                <div className="px-6 pb-6 flex flex-col gap-2">
                    <Button
                        onClick={borrar}
                        disabled={borrando || !habilitado}
                        className="pleno-mal h-11 w-full rounded-lg hover:brightness-110 font-semibold text-[13px] transition-all disabled:opacity-40"
                    >
                        {borrando ? "Eliminando…" : fallo ? "Reintentar" : (etiquetaAccion || "Eliminar")}
                    </Button>
                    <Button
                        onClick={() => setAbierto(false)}
                        variant="ghost"
                        className="h-11 w-full rounded-lg text-muted-foreground hover:text-foreground font-semibold text-[13px]"
                    >
                        Cancelar
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** El nombre anterior. Sigue siendo el mismo componente. */
export const DeleteConfirmDialog = ConfirmarAccion;
