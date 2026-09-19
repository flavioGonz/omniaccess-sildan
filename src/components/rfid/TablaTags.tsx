"use client";

import { useMemo } from "react";
import { CreditCard, UserMinus, UserPlus } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Identidad, Nada } from "@/components/ui/celdas";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { deleteTag } from "@/app/actions/tags";

/**
 * Los tags RFID: qué tarjeta abre, y de quién es.
 *
 * Dos cosas que se llevó la migración:
 *
 *   **Tres `confirm()` del navegador**, uno de ellos delante de "eliminar TODOS los tags
 *   del sistema". Un `confirm()` es un cartel del navegador con dos botones iguales que se
 *   aprieta por reflejo, y detrás de él estaba la acción más destructiva de esta pantalla.
 *   Ahora el borrado de a uno usa el diálogo de siempre, y la purga pide escribir la
 *   palabra: nadie escribe una palabra por reflejo.
 *
 *   **`window.location.reload()` después de cada acción.** Desasignar un tag recargaba la
 *   página entera: se perdían el filtro, la búsqueda y la posición del scroll, y se volvían
 *   a pedir todos los datos de la pantalla para cambiar una fila. Ahora refresca los datos
 *   del servidor sin tirar la vista.
 */

export type TagFila = {
    id: string;
    value: string;
    userId?: string | null;
    user?: { id: string; name: string; email?: string | null; phone?: string | null; imagePath?: string | null; unit?: { name: string } | null } | null;
    [k: string]: any;
};

export function TablaTags({ tags, cargando, error, alReintentar, alAsignar, alDesasignar, alRecargar, barra }: {
    tags: TagFila[];
    cargando?: boolean;
    error?: string | null;
    alReintentar?: () => void;
    alAsignar: (t: TagFila) => void;
    alDesasignar: (t: TagFila) => void;
    alRecargar: () => void;
    barra?: React.ReactNode;
}) {
    const columnas = useMemo<ColumnaTabla<TagFila>[]>(() => [
        {
            clave: "tag", titulo: "Tag", ancho: 240, ordenable: true,
            tituloAyuda: "El número de la tarjeta",
            ayuda: "El UID que la tarjeta le dice al lector. Es lo que el equipo compara: si no coincide exactamente, no abre.",
            valor: (t) => t.value,
            celda: (t) => (
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-md bg-muted border border-border text-muted-foreground flex items-center justify-center shrink-0">
                        <CreditCard size={15} />
                    </span>
                    <div className="min-w-0">
                        <div className="text-[13px] font-semibold tabular-nums tracking-[0.06em] text-foreground truncate">{t.value}</div>
                        <div className="text-[10.5px] text-muted-foreground">{t.id.slice(0, 8)}</div>
                    </div>
                </div>
            ),
        },
        {
            clave: "persona", titulo: "Asignado a", ancho: 240, ordenable: true,
            tituloAyuda: "Quién la usa",
            ayuda: "Un tag sin asignar existe pero no abre nada: el sistema no sabe a quién dejar pasar.",
            valor: (t) => t.user?.name || "",
            celda: (t) => t.user && t.userId
                ? <Identidad foto={t.user.imagePath} nombre={t.user.name} sub={t.user.email || t.user.phone} tam={30} />
                : <span className="text-[12px] text-muted-foreground/60 italic">sin asignar</span>,
        },
        {
            clave: "unidad", titulo: "Unidad", ancho: 160, ordenable: true,
            valor: (t) => t.user?.unit?.name || "",
            celda: (t) => t.user?.unit?.name
                ? <span className="text-[12px] text-muted-foreground">{t.user.unit.name}</span>
                : <Nada />,
        },
        {
            clave: "estado", titulo: "Estado", ancho: 130, ordenable: true,
            tituloAyuda: "Si está en uso",
            ayuda: "Disponible no es un problema: es una tarjeta en el cajón, lista para entregar.",
            valor: (t) => (t.userId ? "Asignado" : "Disponible"),
            celda: (t) => (
                <Estado tono={t.userId ? "bien" : "neutro"}>
                    {t.userId ? "Asignado" : "Disponible"}
                </Estado>
            ),
        },
        {
            clave: "acciones", titulo: "", ancho: 90, alinear: "der", auxiliar: true,
            celda: (t) => (
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {t.userId ? (
                        <button type="button" title="Desasignar del usuario"
                            onClick={(e) => { e.stopPropagation(); alDesasignar(t); }}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                            <UserMinus size={13} />
                        </button>
                    ) : (
                        <button type="button" title="Asignar a un usuario"
                            onClick={(e) => { e.stopPropagation(); alAsignar(t); }}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                            <UserPlus size={13} />
                        </button>
                    )}
                    <span onClick={(e) => e.stopPropagation()}>
                        <DeleteConfirmDialog
                            id={t.id}
                            title={`Tag ${t.value}`}
                            description={t.user?.name
                                ? `Está asignado a ${t.user.name}. Al eliminarlo, esa tarjeta deja de abrir en el acto.`
                                : "La tarjeta deja de existir en el sistema. Si aparece después, no va a abrir."}
                            onDelete={deleteTag}
                            onSuccess={alRecargar}>
                            <button type="button" title="Eliminar"
                                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-[var(--mal-texto)] hover:bg-[var(--mal-suave)] transition-colors">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                            </button>
                        </DeleteConfirmDialog>
                    </span>
                </div>
            ),
        },
    ], [alAsignar, alDesasignar, alRecargar]);

    return (
        <Tabla<TagFila>
            id="tags"
            nombreArchivo="tags-rfid"
            filas={tags}
            clave={(t) => t.id}
            columnas={columnas}
            barra={barra}
            cargando={cargando}
            error={error}
            alReintentar={alReintentar}
            vacio={{
                icono: CreditCard,
                titulo: "No hay tags que mostrar",
                ayuda: "Probá con otra búsqueda o cambiá el filtro. Un tag se da de alta con el número que trae la tarjeta y después se asigna a alguien.",
            }}
            className="flex-1 min-h-0"
            alto="100%"
            pie={<span className="tabular-nums">{tags.length} tags</span>}
        />
    );
}
