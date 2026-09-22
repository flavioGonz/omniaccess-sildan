"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Credential, User, Unit } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Filtros } from "@/components/ui/filtros";
import { Plus, Trash2 } from "lucide-react";
import { purgeTags } from "@/app/actions/tags";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { TablaTags, type TagFila } from "./TablaTags";
import { CajonTag } from "./CajonTag";

type TagWithUser = Credential & { user: (User & { unit: Unit | null }) | null };

/**
 * La lista de tarjetas.
 *
 * Antes tenía dos diálogos chicos —uno para crear, otro para asignar— y dos botones de fila
 * que abrían cada uno el suyo. Una tarjeta quedaba repartida en tres pantallas y ninguna
 * mostraba lo único que importa de verdad: si esa tarjeta llegó a algún lector.
 *
 * Ahora la fila abre un cajón y ahí está todo. Un objeto, una pantalla.
 */
export function TagList({ initialTags, users }: { initialTags: TagWithUser[]; users: User[] }) {
    const router = useRouter();
    const [refrescando, refrescar] = useTransition();

    const [busqueda, setBusqueda] = useState("");
    const [filtro, setFiltro] = useState<"todos" | "asignados" | "disponibles">("todos");
    const [abierto, setAbierto] = useState(false);
    const [editando, setEditando] = useState<TagFila | null>(null);

    const asignados = useMemo(() => initialTags.filter((t) => t.userId).length, [initialTags]);

    /* Refrescar los datos, no recargar la página: `router.refresh()` vuelve a pedir sólo lo
       del servidor y deja el filtro, la búsqueda y el scroll donde estaban. */
    const recargar = () => refrescar(() => router.refresh());

    const visibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return (initialTags as unknown as TagFila[]).filter((t) => {
            const coincide = !q
                || t.value.toLowerCase().includes(q)
                || (t.user?.name || "").toLowerCase().includes(q);
            const pasaFiltro = filtro === "todos" ? true : filtro === "asignados" ? !!t.userId : !t.userId;
            return coincide && pasaFiltro;
        });
    }, [initialTags, busqueda, filtro]);

    const abrir = (t: TagFila | null) => { setEditando(t); setAbierto(true); };

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <TablaTags
                tags={visibles}
                cargando={refrescando}
                alAbrir={abrir}
                alRecargar={recargar}
                barra={
                    <Filtros
                        busqueda={busqueda} alBuscar={setBusqueda}
                        placeholder="Número de tag o nombre"
                        grupos={[{
                            clave: "estado", titulo: "Si está en uso",
                            valor: filtro, alElegir: (v) => setFiltro(v as any),
                            opciones: [
                                { valor: "todos", rotulo: "Todos", cuenta: initialTags.length },
                                { valor: "asignados", rotulo: "Asignados", cuenta: asignados },
                                { valor: "disponibles", rotulo: "En el cajón", cuenta: initialTags.length - asignados },
                            ],
                        }]}
                        acciones={
                            <>
                                {/* Purgar borra TODOS los tags: deja a todo el barrio sin tarjeta.
                                    Por eso hay que escribir la palabra, y no alcanza con un clic.

                                    El texto decía "todas las tarjetas dejan de abrir en el acto" y
                                    era falso, y acá el engaño era mayor que en el borrado de a uno:
                                    `purgeTags` ni siquiera llama a `quitarTagDeLosLectores`. Borra
                                    las credenciales y el espejo, y nada más. Las asignadas siguen
                                    cargadas en los porteros y siguen abriendo.

                                    Peor todavía: al borrar los `credential.id` se pierde el
                                    identificador con el que el lector reconoce cada tarjeta, así
                                    que después de purgar no queda forma de saber cuáles ir a sacar.
                                    Por eso el aviso dice el número de las que SIGUEN abriendo, que
                                    es el dato con el que el operador decide si aprieta o no. */}
                                <DeleteConfirmDialog
                                    id="__todos__"
                                    title="Eliminar todos los tags"
                                    description={`Se borran los ${initialTags.length} tags del sistema. Pero NO se sacan de los lectores: las ${asignados} que están asignadas siguen abriendo, y al borrarlas se pierde el registro de en qué equipo quedó cada una — después no hay forma de saber cuáles ir a quitar a mano. No se puede deshacer.`}
                                    escribir="ELIMINAR"
                                    etiquetaAccion="Eliminar todo"
                                    onDelete={async () => {
                                        const r = await purgeTags();
                                        return r.ok ? { success: true } : { success: false, error: r.error };
                                    }}
                                    onSuccess={recargar}>
                                    <Button variant="outline" size="sm"
                                        className="h-8 px-3 rounded-md text-[12px] font-semibold gap-1.5 text-[var(--mal-texto)] hover:bg-[var(--mal-suave)]">
                                        <Trash2 size={14} /> Purgar
                                    </Button>
                                </DeleteConfirmDialog>

                                <Button size="sm" onClick={() => abrir(null)}
                                    className="accion h-8 px-4 rounded-md font-semibold text-[12px] gap-1.5">
                                    <Plus size={15} /> Nueva tarjeta
                                </Button>
                            </>
                        }
                    />
                }
            />

            <CajonTag
                tag={editando as any}
                personas={users.map((u) => ({ id: u.id, name: u.name }))}
                abierto={abierto}
                alCerrar={() => { setAbierto(false); setEditando(null); }}
                alGuardar={recargar}
            />
        </div>
    );
}
