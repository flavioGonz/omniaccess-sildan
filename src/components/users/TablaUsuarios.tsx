"use client";

import { useMemo } from "react";
import {
    Briefcase, CreditCard, Edit, Hash, KeyRound, Mail, MapPin, Phone, ScanFace,
    Shield, ShieldAlert, Trash2, Truck, UserCheck, UserX, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Identidad, Matricula, Nada } from "@/components/ui/celdas";
import { Chip } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";

/**
 * El padrón de residentes.
 *
 * Esta tabla estaba escrita a mano — `<table>`, `<thead>` con `sticky`, y un comentario que
 * explicaba por qué: *"el `<Table>` de shadcn envuelve en un div overflow-auto propio que
 * rompía el sticky"*. Era cierto, y era el síntoma de algo más grande: la pieza compartida
 * tenía un defecto, así que la pantalla se escribió su propia versión. Multiplicado por
 * once pantallas, así se llega a 5.958 clases distintas en un proyecto de 194 archivos.
 *
 * El defecto está arreglado en `ui/tabla.tsx` — el contenedor con scroll ES el de la tabla
 * y el encabezado queda pegado adentro de él — así que ya no hace falta la copia.
 *
 * Tres cosas que se corrigen al pasar:
 *
 *   El scroll infinito **se apagaba al buscar**. Paginaba sobre el arreglo crudo, así que
 *   cuando había búsqueda o filtro había que mostrar la lista entera de golpe. Con un
 *   padrón chico no se nota; con dos mil residentes, buscar cuelga la pantalla. Ahora la
 *   paginación va sobre lo filtrado, que es lo que siempre tendría que haber hecho.
 *
 *   No había estado de error. `loadData` hacía `console.error` y la tabla quedaba vacía:
 *   un padrón vacío porque el servidor se cayó se veía igual que un barrio sin residentes.
 *
 *   Las credenciales se pintaban de cuatro colores inventados — azul las matrículas, verde
 *   los tags, ámbar los PIN, índigo el rostro. Ninguno de esos colores significaba nada: el
 *   verde no quería decir "esto está bien", quería decir "esto es un tag". El tipo de
 *   credencial lo lleva el ícono, que es lo que un ícono hace; el color queda libre para
 *   cuando de verdad haya que decir algo sobre el estado.
 */

export type UsuarioFila = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    dni: string | null;
    cara: string | null;
    role: string;
    unit: any | null;
    credentials: any[];
    vehicles: any[];
    [k: string]: any;
};

export const ROLES: Record<string, { label: string; icono: any; tono: "neutro" | "bien" | "aviso" | "mal" | "info" | "quieto" }> = {
    RESIDENT: { label: "Residente", icono: UserCheck, tono: "info" },
    VISITOR: { label: "Visitante", icono: UserX, tono: "quieto" },
    STAFF: { label: "Personal", icono: Briefcase, tono: "bien" },
    PROVIDER: { label: "Proveedor", icono: Truck, tono: "aviso" },
    ADMIN: { label: "Admin", icono: Shield, tono: "mal" },
    WHITELISTED: { label: "Lista blanca", icono: UserCheck, tono: "info" },
    BLACKLISTED: { label: "Lista negra", icono: ShieldAlert, tono: "mal" },
};

/** Qué credenciales tiene cargadas este residente. */
export function credenciales(u: UsuarioFila) {
    const creds = u.credentials || [];
    const rostro = creds.some((c: any) => c.type === "FACE") || !!u.cara;
    const tags = creds.filter((c: any) => c.type === "TAG");
    const pines = creds.filter((c: any) => c.type === "PIN");
    const chapas = creds.filter((c: any) => c.type === "PLATE").map((c: any) => c.value);
    // Las matrículas viven en dos lados: como credencial y como vehículo del residente.
    for (const v of u.vehicles || []) if (!chapas.includes(v.plate)) chapas.push(v.plate);
    return { rostro, tags, pines, chapas };
}

/** Varias credenciales del mismo tipo: se ve la primera y el resto al pasar el mouse. */
function Pila({ items, icono: Icono, rotulo, mono }: {
    items: string[]; icono: any; rotulo: string; mono?: boolean;
}) {
    if (!items.length) return <Nada />;
    const resto = items.length - 1;
    const uno = (
        <Chip tono="info" icono={Icono} className={cn("max-w-[130px]", mono && "tracking-[0.1em] tabular-nums")}>
            <span className="truncate">{items[0]}</span>
        </Chip>
    );
    if (!resto) return uno;
    return (
        <Pista titulo={rotulo} texto={<span className="block space-y-0.5">{items.map((v) => <span key={v} className="block tabular-nums">{v}</span>)}</span>}>
            <span className="inline-flex items-center gap-1 cursor-help">
                {uno}
                <span className="text-[10px] text-muted-foreground">+{resto}</span>
            </span>
        </Pista>
    );
}

export function TablaUsuarios({
    usuarios, cargando, error, alReintentar, hayMas, traerMas, alAbrir, alBorrar, barra,
}: {
    usuarios: UsuarioFila[];
    cargando?: boolean;
    error?: string | null;
    alReintentar?: () => void;
    hayMas?: boolean;
    traerMas?: () => void;
    alAbrir: (u: UsuarioFila) => void;
    alBorrar: (u: UsuarioFila) => void;
    barra?: React.ReactNode;
}) {
    const columnas = useMemo<ColumnaTabla<UsuarioFila>[]>(() => [
        {
            clave: "identidad", titulo: "Residente", ancho: 300, ordenable: true,
            valor: (u) => u.name,
            celda: (u) => {
                const rol = ROLES[u.role] || ROLES.RESIDENT;
                return (
                    <Identidad
                        foto={u.cara}
                        nombre={u.name}
                        insignia={<Chip tono={rol.tono} icono={rol.icono}>{rol.label}</Chip>}
                        sub={
                            u.phone || u.email ? (
                                <span className="inline-flex items-center gap-2.5">
                                    {u.phone && <span className="inline-flex items-center gap-1"><Phone size={9} /> {u.phone}</span>}
                                    {u.email && <span className="inline-flex items-center gap-1 truncate max-w-[170px]"><Mail size={9} /> {u.email}</span>}
                                </span>
                            ) : <span className="italic opacity-70">Sin contacto</span>
                        }
                    />
                );
            },
        },
        {
            clave: "unidad", titulo: "Unidad / DNI", ancho: 150, ordenable: true,
            tituloAyuda: "Dónde vive y con qué documento",
            ayuda: "La unidad o lote del barrio al que pertenece, y su documento. Sin unidad asignada, el residente existe pero no está atado a ninguna casa.",
            valor: (u) => u.unit?.name || u.dni || "",
            celda: (u) => (
                <div className="leading-tight">
                    {u.unit
                        ? <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold"><MapPin size={10} className="text-muted-foreground" />{u.unit.name}</div>
                        : <span className="text-[11px] text-muted-foreground italic">Sin unidad</span>}
                    <div className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground tabular-nums mt-0.5">
                        <Hash size={9} />{u.dni || "S/DNI"}
                    </div>
                </div>
            ),
        },
        {
            clave: "chapas", titulo: "Matrículas", alinear: "centro", ancho: 150,
            tituloAyuda: "Con qué vehículos entra",
            ayuda: "Las matrículas con las que este residente pasa la barrera. Salen de sus credenciales y de los vehículos que tenga cargados.",
            valor: (u) => credenciales(u).chapas.join(" "),
            celda: (u) => {
                const { chapas } = credenciales(u);
                if (!chapas.length) return <Nada />;
                return chapas.length === 1
                    ? <Matricula p={chapas[0]} />
                    : (
                        <Pista titulo="Matrículas" texto={<span className="block space-y-0.5">{chapas.map((p) => <span key={p} className="block tabular-nums tracking-wider">{p}</span>)}</span>}>
                            <span className="inline-flex items-center gap-1 cursor-help">
                                <Matricula p={chapas[0]} />
                                <span className="text-[10px] text-muted-foreground">+{chapas.length - 1}</span>
                            </span>
                        </Pista>
                    );
            },
        },
        {
            clave: "tags", titulo: "RFID", alinear: "centro", ancho: 140,
            tituloAyuda: "Tarjetas y llaveros",
            ayuda: "Las credenciales de proximidad asignadas. Un residente puede tener varias — una por persona de la casa, por ejemplo.",
            valor: (u) => credenciales(u).tags.map((t: any) => t.value).join(" "),
            celda: (u) => <Pila items={credenciales(u).tags.map((t: any) => t.value)} icono={CreditCard} rotulo="Tags RFID" mono />,
        },
        {
            clave: "pines", titulo: "PIN", alinear: "centro", ancho: 110,
            tituloAyuda: "Códigos de teclado",
            ayuda: "Los códigos con los que puede abrir desde un teclado, sin llevar nada encima.",
            valor: (u) => credenciales(u).pines.map((p: any) => p.value).join(" "),
            celda: (u) => <Pila items={credenciales(u).pines.map((p: any) => p.value)} icono={KeyRound} rotulo="Códigos PIN" mono />,
        },
        {
            clave: "rostro", titulo: "Rostro", alinear: "centro", ancho: 90,
            tituloAyuda: "Biometría cargada",
            ayuda: "Si tiene el rostro enrolado en los equipos de reconocimiento facial.",
            valor: (u) => (credenciales(u).rostro ? "sí" : ""),
            celda: (u) => credenciales(u).rostro
                ? <span className="inline-flex items-center justify-center w-6 h-6 rounded-md chip-bien border" title="Rostro enrolado"><ScanFace size={12} /></span>
                : <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-muted border border-border text-muted-foreground/50" title="Sin rostro"><ScanFace size={12} /></span>,
        },
        {
            clave: "acciones", titulo: "", alinear: "der", ancho: 90, auxiliar: true,
            celda: (u) => (
                /* Aparecen al pasar por la fila. Permanentes, dos botones por fila
                   multiplicado por el padrón entero es una columna de ruido. */
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" title="Editar"
                        onClick={(e) => { e.stopPropagation(); alAbrir(u); }}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                        <Edit size={12} />
                    </button>
                    <button type="button" title="Eliminar"
                        onClick={(e) => { e.stopPropagation(); alBorrar(u); }}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-[var(--mal-texto)] hover:bg-[var(--mal-suave)] transition-colors">
                        <Trash2 size={12} />
                    </button>
                </div>
            ),
        },
    ], [alAbrir, alBorrar]);

    return (
        <Tabla<UsuarioFila>
            id="usuarios"
            nombreArchivo="residentes"
            filas={usuarios}
            clave={(u) => u.id}
            columnas={columnas}
            barra={barra}
            cargando={cargando}
            error={error}
            alReintentar={alReintentar}
            vacio={{
                icono: Users,
                titulo: "Sin residentes",
                ayuda: "Probá con otra búsqueda, o quitá el filtro de rol. Si el padrón está vacío, se puede importar desde una planilla.",
            }}
            alClickFila={alAbrir}
            masFilas={hayMas && traerMas ? { hay: hayMas, cargando, traer: traerMas, modo: "scroll" } : undefined}
            alto="calc(100vh - 210px)"
            pie={<span className="tabular-nums">{usuarios.length} residentes</span>}
        />
    );
}
