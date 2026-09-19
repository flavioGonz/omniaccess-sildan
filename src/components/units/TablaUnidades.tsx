"use client";

import { useMemo } from "react";
import { Building2, Home, MapPin, Pencil, Phone, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Matricula, Nada } from "@/components/ui/celdas";
import { Chip } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { deleteUnit } from "@/app/actions/units";

/**
 * El catastro: barrios, edificios, lotes y casas.
 *
 * Dos arreglos que se llevó al migrar, y el primero no se ve hasta que el padrón crece:
 *
 *   **La columna del complejo costaba O(n²).** Para saber a qué barrio pertenece un lote,
 *   cada fila hacía `units.find(u => u.id === unit.parentId)` — o sea, recorría el padrón
 *   entero. Con cien unidades son diez mil comparaciones por render; con mil, un millón, y
 *   la pantalla se traba al escribir en el buscador. Ahora el índice se arma una vez y la
 *   búsqueda es directa.
 *
 *   **No paginaba.** Renderizaba el padrón completo de una, y cada fila con su avatar, sus
 *   chips de matrícula y su menú. Ahora entra de a tanda, con el centinela de la tabla.
 *
 * Y el color: el azul estaba en seis lugares distintos diciendo seis cosas — el ícono de
 * una casa, la insignia de sub-unidad, el nombre del complejo, la matrícula de un
 * residente, el botón de alta y el filtro activo. De esos, sólo dos eran acciones. Ahora
 * el azul es sólo lo que se aprieta, y el estado lo dicen los tonos: ocupado es `bien`,
 * vacante es `neutro` — que es exactamente lo que son, porque una unidad vacante no está
 * mal, está vacante.
 */

export type UnidadFila = {
    id: string;
    name: string;
    type: string;
    lot?: string | null;
    houseNumber?: string | null;
    parentId?: string | null;
    address?: string | null;
    contactName?: string | null;
    adminPhone?: string | null;
    users: any[];
    children?: any[];
    [k: string]: any;
};

/** Qué se ve en la primera celda según la clase de unidad. */
const icono = (u: UnidadFila) =>
    (u.lot || u.houseNumber) ? Home : (u.type === "BARRIO" ? MapPin : Building2);

export function TablaUnidades({
    unidades, indicePadres, cargando, error, alReintentar, hayMas, traerMas,
    seleccionada, alElegir, alEditar, alRecargar, barra,
}: {
    unidades: UnidadFila[];
    /** id → nombre del complejo padre. Se arma una vez, no una por fila. */
    indicePadres: Map<string, string>;
    cargando?: boolean;
    error?: string | null;
    alReintentar?: () => void;
    hayMas?: boolean;
    traerMas?: () => void;
    seleccionada?: string | null;
    alElegir: (u: UnidadFila) => void;
    alEditar: (u: UnidadFila) => void;
    alRecargar: () => void;
    barra?: React.ReactNode;
}) {
    const columnas = useMemo<ColumnaTabla<UnidadFila>[]>(() => [
        {
            clave: "unidad", titulo: "Unidad", ancho: 280, ordenable: true,
            tituloAyuda: "Qué propiedad es",
            ayuda: "El nombre con el que se la conoce en el barrio, y su lote o número si los tiene. «Sub» marca una unidad que vive adentro de otra — un piso dentro de un edificio, una casa dentro de un barrio.",
            valor: (u) => u.name,
            celda: (u) => {
                const Ico = icono(u);
                const detalle = [u.lot ? `Lote ${u.lot}` : "", u.houseNumber ? `N° ${u.houseNumber}` : ""].filter(Boolean).join(" · ");
                return (
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-md bg-muted border border-border text-muted-foreground flex items-center justify-center shrink-0">
                            <Ico size={15} />
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[13px] font-semibold text-foreground truncate">{u.name}</span>
                                {u.parentId && <Chip tono="neutro">Sub</Chip>}
                            </div>
                            {detalle && <div className="text-[11px] text-muted-foreground truncate">{detalle}</div>}
                        </div>
                    </div>
                );
            },
        },
        {
            clave: "complejo", titulo: "Complejo", ancho: 180, ordenable: true,
            tituloAyuda: "De qué depende",
            ayuda: "El barrio o edificio al que pertenece. Las unidades principales no dependen de ninguna: son el complejo.",
            valor: (u) => u.parentId ? (indicePadres.get(u.parentId) || "") : `Principal · ${u.type}`,
            celda: (u) => u.parentId
                ? <span className="text-[12px] text-muted-foreground">{indicePadres.get(u.parentId) || "—"}</span>
                : <span className="text-[12px] font-semibold">Principal · {u.type}</span>,
        },
        {
            clave: "estado", titulo: "Estado", ancho: 150, ordenable: true,
            tituloAyuda: "Si vive alguien",
            ayuda: "Ocupado cuando tiene residentes asignados. Vacante no es un problema: es una unidad sin nadie cargado todavía.",
            valor: (u) => (u.users?.length ? `Ocupado ${u.users.length}` : "Vacante"),
            celda: (u) => (
                <div className="flex items-center gap-2">
                    <Chip tono={u.users?.length ? "bien" : "neutro"}>{u.users?.length ? "Ocupado" : "Vacante"}</Chip>
                    {!!u.users?.length && <span className="text-[11px] text-muted-foreground tabular-nums">{u.users.length} pers.</span>}
                </div>
            ),
        },
        {
            clave: "residentes", titulo: "Residentes", ordenable: true,
            tituloAyuda: "Quiénes viven acá, y con qué entran",
            ayuda: "Los residentes asignados a esta unidad y las matrículas con las que pasan la barrera.",
            valor: (u) => (u.users || []).map((r: any) => r.name).join(", "),
            celda: (u) => {
                const gente = u.users || [];
                if (!gente.length) {
                    return u.contactName
                        ? <span className="text-[12px] text-muted-foreground italic">{u.contactName}</span>
                        : <Nada />;
                }
                const resto = gente.length - 2;
                return (
                    <div className="flex flex-col gap-0.5">
                        {gente.slice(0, 2).map((r: any) => (
                            <div key={r.id} className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[12px] truncate max-w-[140px]">{r.name}</span>
                                {(r.vehicles || []).slice(0, 2).map((v: any, i: number) => (
                                    <Matricula key={i} p={v.plate} className="text-[10px] px-1.5 py-0" />
                                ))}
                            </div>
                        ))}
                        {resto > 0 && (
                            <Pista titulo="Residentes" texto={<span className="block space-y-0.5">{gente.map((r: any) => <span key={r.id} className="block">{r.name}</span>)}</span>}>
                                <span className="text-[11px] text-muted-foreground cursor-help">y {resto} más…</span>
                            </Pista>
                        )}
                    </div>
                );
            },
        },
        {
            clave: "contacto", titulo: "Contacto", ancho: 150,
            tituloAyuda: "A quién llamar",
            ayuda: "El teléfono del administrador o responsable de la propiedad.",
            valor: (u) => u.adminPhone || "",
            celda: (u) => u.adminPhone
                ? <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground tabular-nums"><Phone size={11} />{u.adminPhone}</span>
                : <Nada />,
        },
        {
            clave: "acciones", titulo: "", alinear: "der", ancho: 90, auxiliar: true,
            celda: (u) => (
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" title="Editar"
                        onClick={(e) => { e.stopPropagation(); alEditar(u); }}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        <Pencil size={13} />
                    </button>
                    <span onClick={(e) => e.stopPropagation()}>
                        <DeleteConfirmDialog id={u.id} title={u.name} onDelete={deleteUnit} onSuccess={alRecargar}>
                            <button type="button" title="Eliminar"
                                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-[var(--mal-texto)] hover:bg-[var(--mal-suave)] transition-colors">
                                <Trash2 size={13} />
                            </button>
                        </DeleteConfirmDialog>
                    </span>
                </div>
            ),
        },
    ], [indicePadres, alEditar, alRecargar]);

    return (
        <Tabla<UnidadFila>
            id="unidades"
            nombreArchivo="unidades"
            filas={unidades}
            clave={(u) => u.id}
            columnas={columnas}
            barra={barra}
            cargando={cargando}
            error={error}
            alReintentar={alReintentar}
            vacio={{
                icono: Building2,
                titulo: "No hay unidades que mostrar",
                ayuda: "Probá con otra búsqueda, o mirá otra categoría. Si el catastro está vacío, se puede cargar un barrio y después generar sus lotes de una vez.",
            }}
            alClickFila={alElegir}
            filaActiva={(u) => u.id === seleccionada}
            masFilas={hayMas && traerMas ? { hay: hayMas, cargando, traer: traerMas, modo: "scroll" } : undefined}
            className="flex-1 min-h-0"
            alto="100%"
            pie={<span className="tabular-nums">{unidades.length} unidades</span>}
        />
    );
}
