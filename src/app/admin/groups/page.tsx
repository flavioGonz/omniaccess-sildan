"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createAccessGroup, deleteAccessGroup, getAccessGroups } from "@/app/actions/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Filtros } from "@/components/ui/filtros";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Momento } from "@/components/ui/celdas";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Cpu, Loader2, Plus, ShieldCheck, Trash2, Users } from "lucide-react";

/**
 * Los grupos de acceso.
 *
 * Tres arreglos al migrar, y ninguno es de forma:
 *
 *   **Un fallo al cargar se veía como "no hay grupos".** `load()` tenía `try/finally` sin
 *   `catch`: si la consulta fallaba, la lista quedaba vacía y el cartel decía "No hay
 *   grupos definidos todavía". De ahí a que alguien cree un grupo duplicado hay un paso.
 *   Ahora el error se muestra y se puede reintentar.
 *
 *   **Dos maneras de borrar en la misma aplicación.** Acá el borrado era un botón que hay
 *   que mantener apretado; en usuarios, unidades y vehículos es un diálogo. Ninguna de las
 *   dos está mal, pero tener las dos sí: el operador aprende una y la otra lo sorprende.
 *   Queda el diálogo, porque además puede decir QUÉ se pierde — y borrar un grupo no borra
 *   a su gente, la deja sin ese permiso, que es justo lo que conviene aclarar antes.
 *
 *   **El morado y el azul no querían decir nada.** El ícono del grupo era morado, el conteo
 *   de usuarios azul y el de dispositivos índigo, y ninguno de los tres era un estado ni
 *   una acción. Eran tres colores para tres sustantivos. Ahora el color sólo lo tiene lo
 *   que se aprieta.
 */

type Grupo = {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    _count: { users: number; devices?: number };
};

export default function GroupsPage() {
    const [grupos, setGrupos] = useState<Grupo[]>([]);
    const [abierto, setAbierto] = useState(false);
    const [busqueda, setBusqueda] = useState("");
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [enviando, setEnviando] = useState(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const datos = await getAccessGroups();
            setGrupos(datos as Grupo[]);
            setError(null);
        } catch (e: any) {
            setError(e?.message || "No se pudieron traer los grupos.");
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    async function crear(formData: FormData) {
        setEnviando(true);
        try {
            await createAccessGroup(formData);
            setAbierto(false);
            await cargar();
        } finally {
            setEnviando(false);
        }
    }

    const visibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        if (!q) return grupos;
        return grupos.filter((g) => g.name.toLowerCase().includes(q));
    }, [grupos, busqueda]);

    const personasEnGrupos = useMemo(
        () => grupos.reduce((a, g) => a + (g._count?.users || 0), 0), [grupos]);

    const columnas = useMemo<ColumnaTabla<Grupo>[]>(() => [
        {
            clave: "grupo", titulo: "Grupo", ancho: 300, ordenable: true,
            tituloAyuda: "Cómo se llama este permiso",
            ayuda: "Un grupo junta a la gente que puede abrir las mismas puertas en los mismos horarios. El nombre es lo que van a ver quienes lo asignen.",
            valor: (g) => g.name,
            celda: (g) => (
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-md bg-muted border border-border text-muted-foreground flex items-center justify-center shrink-0">
                        <ShieldCheck size={15} />
                    </span>
                    <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-foreground truncate">{g.name}</div>
                        <div className="text-[10.5px] text-muted-foreground">#{g.id.slice(-6)}</div>
                    </div>
                </div>
            ),
        },
        {
            clave: "usuarios", titulo: "Personas", ancho: 130, ordenable: true, alinear: "der",
            tituloAyuda: "Cuánta gente lo tiene",
            ayuda: "Residentes y personal con este permiso asignado. Un grupo sin nadie no es un error: puede estar recién creado.",
            valor: (g) => String(g._count?.users ?? 0).padStart(6, "0"),
            celda: (g) => (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] tabular-nums">
                    <Users size={12} className="text-muted-foreground" />
                    {g._count?.users ?? 0}
                </span>
            ),
        },
        {
            clave: "dispositivos", titulo: "Dispositivos", ancho: 140, ordenable: true, alinear: "der",
            tituloAyuda: "Qué abre",
            ayuda: "Las puertas, barreras y terminales sobre las que este grupo tiene permiso.",
            valor: (g) => String(g._count?.devices ?? 0).padStart(6, "0"),
            celda: (g) => (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] tabular-nums">
                    <Cpu size={12} className="text-muted-foreground" />
                    {g._count?.devices ?? 0}
                </span>
            ),
        },
        {
            clave: "creado", titulo: "Creado", ancho: 140, ordenable: true,
            valor: (g) => new Date(g.createdAt).toISOString(),
            celda: (g) => <Momento t={g.createdAt} soloFecha />,
        },
        {
            clave: "acciones", titulo: "", ancho: 70, alinear: "der", auxiliar: true,
            celda: (g) => (
                <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <DeleteConfirmDialog
                        id={g.id}
                        title={g.name}
                        description={`Se elimina el grupo. Las ${g._count?.users ?? 0} persona${(g._count?.users ?? 0) === 1 ? "" : "s"} que lo tienen no se borran: pierden este permiso y conservan los demás.`}
                        onDelete={deleteAccessGroup}
                        onSuccess={cargar}>
                        <button type="button" title="Eliminar"
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-[var(--mal-texto)] hover:bg-[var(--mal-suave)] transition-colors">
                            <Trash2 size={13} />
                        </button>
                    </DeleteConfirmDialog>
                </div>
            ),
        },
    ], [cargar]);

    return (
        <div className="h-full flex flex-col bg-background overflow-hidden animate-in fade-in duration-500">
            <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <span className="w-11 h-11 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground">
                        <Users size={20} />
                    </span>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Grupos de acceso</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Quién puede abrir qué, y cuándo
                        </p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Personas con permiso</p>
                    <p className="text-2xl font-bold text-foreground tabular-nums">{personasEnGrupos}</p>
                </div>
            </header>

            <main className="flex-1 overflow-hidden px-8 py-6 flex flex-col">
                {/* Sin tarjeta alrededor de la tabla: la tabla es la pantalla. El aire lo
                    pone el margen, no un borde. */}
                <div className="flex-1 flex flex-col min-h-0">
                    <Tabla<Grupo>
                        id="grupos"
                        nombreArchivo="grupos"
                        filas={visibles}
                        clave={(g) => g.id}
                        columnas={columnas}
                        cargando={cargando}
                        error={error}
                        alReintentar={cargar}
                        vacio={{
                            icono: ShieldCheck,
                            titulo: busqueda ? "Ningún grupo coincide" : "Todavía no hay grupos",
                            ayuda: busqueda
                                ? "Probá con parte del nombre."
                                : "Un grupo junta a la gente que abre las mismas puertas en los mismos horarios. Sin grupos, cada permiso se asigna de a uno.",
                        }}
                        className="flex-1 min-h-0"
                        alto="100%"
                        pie={<span className="tabular-nums">{visibles.length} grupos</span>}
                        barra={
                            <Filtros
                                busqueda={busqueda} alBuscar={setBusqueda}
                                placeholder="Nombre del grupo"
                                acciones={
                                <Dialog open={abierto} onOpenChange={setAbierto}>
                                    <DialogTrigger asChild>
                                        <Button size="sm" className="accion h-8 px-4 rounded-md font-semibold text-[12px] gap-1.5">
                                            <Plus size={15} /> Crear grupo
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-sm">
                                        <DialogHeader>
                                            <span className="w-10 h-10 rounded-xl bg-muted border border-border flex items-center justify-center text-muted-foreground mb-2">
                                                <ShieldCheck size={18} />
                                            </span>
                                            <DialogTitle>Nuevo grupo de acceso</DialogTitle>
                                        </DialogHeader>
                                        <form action={crear} className="space-y-4 pt-2">
                                            <div className="space-y-1.5">
                                                <Label htmlFor="name" className="text-[12px] font-medium">Nombre del grupo</Label>
                                                <Input id="name" name="name" required className="h-10"
                                                    placeholder="Ej: Residentes Torre Norte" />
                                                <p className="text-[11px] text-muted-foreground">
                                                    Conviene que diga a quiénes junta, no qué abre: las puertas cambian más seguido que la gente.
                                                </p>
                                            </div>
                                            <Button type="submit" disabled={enviando}
                                                className="accion w-full h-10 font-semibold gap-2">
                                                {enviando ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                                                Crear grupo
                                            </Button>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                                }
                            />
                        }
                    />
                </div>
            </main>
        </div>
    );
}
