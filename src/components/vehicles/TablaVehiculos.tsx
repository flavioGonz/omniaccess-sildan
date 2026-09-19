"use client";

import { useMemo } from "react";
import Image from "next/image";
import { Car, History, Pencil, Trash2 } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Identidad, Matricula, Miniatura, Nada } from "@/components/ui/celdas";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { deleteVehicle } from "@/app/actions/vehicles";
import { getCarLogo } from "@/lib/car-logos";
import { getImagePath } from "@/lib/image-path";
import { fechaHora, hace } from "@/lib/fechas";

/**
 * El padrón de vehículos.
 *
 * Lo que se corrigió al migrar, más allá de la forma:
 *
 *   **La columna «Estado» mentía.** Todas las filas decían ACTIVO en verde, sin excepción,
 *   porque no había ningún campo de estado detrás: estaba escrito fijo en el JSX. Una
 *   columna que siempre dice lo mismo no informa nada — ocupa lugar y, peor, hace creer al
 *   operador que alguien verificó algo. Ahora la columna dice lo único que efectivamente se
 *   sabe: hace cuánto que el barrio no lee esa chapa. Y se llama **Actividad**, que es lo
 *   que es, porque un vehículo perfectamente en regla puede llevar dos meses sin entrar.
 *
 *   **«Sin detecciones» también mentía**, por otro motivo. La última lectura se buscaba
 *   sólo en `AccessEvent` — los pasos por barrera —, y el seguimiento interior escribe en
 *   `PlateSighting`. En San Nicolás, donde hoy casi todo viene de cámaras de calle, eso
 *   daba la columna entera vacía. Se corrigió del lado del servidor, en `getVehicles`.
 *
 *   **El azul no quería decir nada.** Estaba en el borde de la miniatura al pasar el mouse,
 *   en el ícono del reloj y en los tres botones de fila. Ninguno era una acción azul: eran
 *   decoración. Quedaron neutros, y el rojo sólo en eliminar.
 */

export type VehiculoFila = {
    id: string;
    plate: string;
    brand?: string | null;
    model?: string | null;
    color?: string | null;
    lastPhoto?: string | null;
    lastSeen?: string | Date | null;
    user: { id: string; name: string; email?: string | null; imagePath?: string | null; [k: string]: any };
    [k: string]: any;
};

/** Los cortes de la columna Actividad, en días. */
const ACTIVO_DIAS = 2;
const PAUSA_DIAS = 30;

/**
 * Qué se puede decir de un vehículo a partir de su última lectura — y nada más que eso.
 *
 * No es el estado del vehículo en el padrón: es cuándo lo vio el barrio por última vez.
 * La diferencia importa, y por eso el texto nunca dice «activo» a secas.
 */
function actividad(lastSeen: string | Date | null | undefined) {
    if (!lastSeen) return { tono: "neutro" as const, texto: "Nunca leído" };
    const dias = (Date.now() - new Date(lastSeen).getTime()) / 86_400_000;
    if (!isFinite(dias)) return { tono: "neutro" as const, texto: "Nunca leído" };
    if (dias <= ACTIVO_DIAS) return { tono: "bien" as const, texto: "Circulando" };
    if (dias <= PAUSA_DIAS) return { tono: "quieto" as const, texto: "En pausa" };
    return { tono: "aviso" as const, texto: "Sin actividad" };
}

export function TablaVehiculos({
    vehiculos, cargando, error, alReintentar, hayMas, traerMas,
    alVerHistorial, alAbrirFoto, alRecargar, editar, barra, total,
}: {
    vehiculos: VehiculoFila[];
    cargando?: boolean;
    error?: string | null;
    alReintentar?: () => void;
    hayMas?: boolean;
    traerMas?: () => void;
    alVerHistorial: (v: VehiculoFila) => void;
    alAbrirFoto: (url: string) => void;
    alRecargar: () => void;
    /** El diálogo de edición, que lo arma la página porque necesita el padrón de usuarios. */
    editar: (v: VehiculoFila) => React.ReactNode;
    barra?: React.ReactNode;
    total?: number;
}) {
    const columnas = useMemo<ColumnaTabla<VehiculoFila>[]>(() => [
        {
            clave: "matricula", titulo: "Matrícula", ancho: 230, ordenable: true,
            tituloAyuda: "La chapa, y el último cuadro donde se la leyó",
            ayuda: "La miniatura es la última captura guardada de ese vehículo. Se puede abrir para verla entera.",
            valor: (v) => v.plate,
            celda: (v) => {
                const foto = v.lastPhoto ? getImagePath(v.lastPhoto) : null;
                const chico = foto ? (foto.includes("?") ? `${foto}&w=160` : `${foto}?w=160`) : null;
                return (
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Miniatura src={chico} alt={v.plate} ancho={56} alto={38}
                            alAbrir={foto ? () => alAbrirFoto(foto) : undefined} />
                        <div className="min-w-0">
                            <Matricula p={v.plate} />
                            <div className="text-[10px] text-muted-foreground mt-0.5">{v.id.slice(0, 8)}</div>
                        </div>
                    </div>
                );
            },
        },
        {
            clave: "vehiculo", titulo: "Vehículo", ancho: 200, ordenable: true,
            tituloAyuda: "Marca y modelo declarados",
            ayuda: "Lo que figura en el padrón, no lo que reconoce la cámara: la cámara lee la chapa, no la marca.",
            valor: (v) => [v.brand, v.model].filter(Boolean).join(" ") || "",
            celda: (v) => {
                const logo = getCarLogo(v.brand);
                return (
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="relative w-8 h-8 rounded-md bg-muted border border-border flex items-center justify-center shrink-0 p-1.5">
                            {logo
                                ? <Image src={logo} alt={v.brand || ""} fill sizes="32px" className="object-contain p-1.5 opacity-70" />
                                : <Car size={14} className="text-muted-foreground" />}
                        </span>
                        <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-foreground truncate">{v.brand || "Genérico"}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{v.model || "Sin modelo"}</div>
                        </div>
                    </div>
                );
            },
        },
        {
            clave: "propietario", titulo: "Propietario", ancho: 220, ordenable: true,
            tituloAyuda: "A quién está asignado",
            ayuda: "El residente responsable del vehículo. De él cuelgan las credenciales con las que abre.",
            valor: (v) => v.user?.name || "",
            celda: (v) => <Identidad foto={v.user?.imagePath ? getImagePath(v.user.imagePath) : null}
                nombre={v.user?.name} sub={v.user?.email} tam={30} />,
        },
        {
            clave: "color", titulo: "Color", ancho: 120, ordenable: true,
            valor: (v) => v.color || "",
            celda: (v) => v.color ? (
                <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border border-border shrink-0" style={{ backgroundColor: v.color }} />
                    <span className="text-[12px] text-muted-foreground capitalize">{v.color}</span>
                </span>
            ) : <Nada />,
        },
        {
            clave: "vista", titulo: "Última lectura", ancho: 150, ordenable: true,
            tituloAyuda: "Cuándo lo vio el barrio por última vez",
            ayuda: "Incluye tanto los pasos por barrera como las lecturas de las cámaras de calle. Si está vacío es que todavía no se leyó esa chapa en ningún lado.",
            valor: (v) => (v.lastSeen ? new Date(v.lastSeen).toISOString() : ""),
            celda: (v) => v.lastSeen
                ? <span className="text-[12px] text-muted-foreground" title={fechaHora(v.lastSeen)}>{hace(v.lastSeen)}</span>
                : <Nada />,
        },
        {
            clave: "actividad", titulo: "Actividad", ancho: 130, ordenable: true,
            tituloAyuda: "Derivado de la última lectura",
            ayuda: `No es un estado del padrón: el padrón no tiene ninguno. Es hace cuánto que no se lee esta chapa — «Circulando» hasta ${ACTIVO_DIAS} días, «En pausa» hasta ${PAUSA_DIAS}, y después «Sin actividad». Un vehículo en regla que no entró en dos meses figura sin actividad, y está bien que así figure.`,
            valor: (v) => actividad(v.lastSeen).texto,
            celda: (v) => {
                const a = actividad(v.lastSeen);
                return <Estado tono={a.tono}>{a.texto}</Estado>;
            },
        },
        {
            clave: "acciones", titulo: "", alinear: "der", ancho: 110, auxiliar: true,
            celda: (v) => (
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" title="Ver historial de accesos"
                        onClick={(e) => { e.stopPropagation(); alVerHistorial(v); }}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        <History size={13} />
                    </button>
                    <span onClick={(e) => e.stopPropagation()}>{editar(v)}</span>
                    <span onClick={(e) => e.stopPropagation()}>
                        <DeleteConfirmDialog id={v.id} title={v.plate}
                            description={`Se elimina el vehículo ${v.plate} del padrón. Las lecturas ya registradas no se borran.`}
                            onDelete={deleteVehicle} onSuccess={alRecargar}>
                            <button type="button" title="Eliminar"
                                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-[var(--mal-texto)] hover:bg-[var(--mal-suave)] transition-colors">
                                <Trash2 size={13} />
                            </button>
                        </DeleteConfirmDialog>
                    </span>
                </div>
            ),
        },
    ], [alVerHistorial, alAbrirFoto, alRecargar, editar]);

    return (
        <Tabla<VehiculoFila>
            id="vehiculos"
            nombreArchivo="vehiculos"
            filas={vehiculos}
            clave={(v) => v.id}
            columnas={columnas}
            barra={barra}
            cargando={cargando}
            error={error}
            alReintentar={alReintentar}
            vacio={{
                icono: Car,
                titulo: "No hay vehículos que mostrar",
                ayuda: "Probá con otra búsqueda. Si el padrón está vacío, se carga un vehículo asignándolo a un residente: la matrícula queda como credencial y empieza a abrir.",
            }}
            masFilas={hayMas && traerMas ? { hay: hayMas, cargando, traer: traerMas, modo: "scroll" } : undefined}
            className="flex-1 min-h-0"
            alto="100%"
            pie={<span className="tabular-nums">{vehiculos.length}{typeof total === "number" && total > vehiculos.length ? ` de ${total}` : ""} vehículos</span>}
        />
    );
}
