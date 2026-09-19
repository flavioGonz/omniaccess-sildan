"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Credential, User, Unit } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Filtros } from "@/components/ui/filtros";
import { Plus, Trash2 } from "lucide-react";
import { assignTag, createTag, purgeTags, unassignTag } from "@/app/actions/tags";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { TablaTags, type TagFila } from "./TablaTags";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type TagWithUser = Credential & { user: (User & { unit: Unit | null }) | null };

interface TagListProps {
    initialTags: TagWithUser[];
    users: User[];
}

export function TagList({ initialTags, users }: TagListProps) {
    const router = useRouter();
    const [refrescando, refrescar] = useTransition();

    const [busqueda, setBusqueda] = useState("");
    const [filtro, setFiltro] = useState<"todos" | "asignados" | "disponibles">("todos");
    const [asignando, setAsignando] = useState<TagFila | null>(null);
    const [aQuien, setAQuien] = useState("");
    const [creando, setCreando] = useState(false);
    const [nuevo, setNuevo] = useState("");
    const [errorAlta, setErrorAlta] = useState<string | null>(null);

    const asignados = useMemo(() => initialTags.filter((t) => t.userId).length, [initialTags]);

    /**
     * Refrescar los datos, no recargar la página.
     *
     * Cada acción acá terminaba en `window.location.reload()`: desasignar un tag volvía a
     * pedir toda la pantalla desde cero y se perdían el filtro, la búsqueda y la posición
     * del scroll. `router.refresh()` vuelve a pedir sólo los datos del servidor y deja la
     * vista donde estaba.
     */
    const recargar = () => refrescar(() => router.refresh());

    const visibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return (initialTags as unknown as TagFila[]).filter((t) => {
            const coincide = !q
                || t.value.toLowerCase().includes(q)
                || (t.user?.name || "").toLowerCase().includes(q);
            const pasaFiltro = filtro === "todos" ? true
                : filtro === "asignados" ? !!t.userId
                    : !t.userId;
            return coincide && pasaFiltro;
        });
    }, [initialTags, busqueda, filtro]);

    const asignar = async () => {
        if (!asignando || !aQuien) return;
        await assignTag(asignando.id, aQuien);
        setAsignando(null);
        setAQuien("");
        recargar();
    };

    const desasignar = async (t: TagFila) => {
        await unassignTag(t.id);
        recargar();
    };

    const crear = async () => {
        const valor = nuevo.trim();
        if (!valor) { setErrorAlta("Escribí el número que trae la tarjeta."); return; }
        const r: any = await createTag({ value: valor });
        if (r && r.success === false) { setErrorAlta(r.error || "No se pudo crear el tag."); return; }
        setNuevo("");
        setErrorAlta(null);
        setCreando(false);
        recargar();
    };

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <TablaTags
                tags={visibles}
                cargando={refrescando}
                alAsignar={(t) => { setAsignando(t); setAQuien(""); }}
                alDesasignar={desasignar}
                alRecargar={recargar}
                barra={
                    <Filtros
                        busqueda={busqueda} alBuscar={setBusqueda}
                        placeholder="Número de tag o nombre"
                        /* Era un <Select> de tres opciones: dos clics y las otras dos
                           escondidas. Una lista desplegable se justifica con muchas. */
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
                            {/*
                             * Purgar estaba detrás de un `confirm()` del navegador: dos
                             * botones iguales y un texto que nadie lee. Borra TODOS los tags
                             * del sistema, o sea que deja a todo el barrio sin tarjeta.
                             * Ahora hay que escribir la palabra.
                             */}
                            <DeleteConfirmDialog
                                id="__todos__"
                                title="Eliminar todos los tags"
                                description={`Se borran los ${initialTags.length} tags del sistema, asignados y disponibles. Todas las tarjetas dejan de abrir en el acto, y hay que volver a cargarlas una por una. No se puede deshacer.`}
                                escribir="ELIMINAR"
                                etiquetaAccion="Eliminar todo"
                                onDelete={async () => await purgeTags()}
                                onSuccess={recargar}>
                                <Button variant="outline" size="sm"
                                    className="h-8 px-3 rounded-md text-[12px] font-semibold gap-1.5 text-[var(--mal-texto)] hover:bg-[var(--mal-suave)]">
                                    <Trash2 size={14} /> Purgar
                                </Button>
                            </DeleteConfirmDialog>

                            <Dialog open={creando} onOpenChange={(o) => { setCreando(o); if (!o) setErrorAlta(null); }}>
                                <DialogTrigger asChild>
                                    <Button size="sm" className="accion h-8 px-4 rounded-md font-semibold text-[12px] gap-1.5">
                                        <Plus size={15} /> Nuevo tag
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-sm">
                                    <DialogHeader><DialogTitle>Nuevo tag</DialogTitle></DialogHeader>
                                    <div className="space-y-3 pt-1">
                                        <div className="space-y-1.5">
                                            <label className="text-[12px] font-medium">Número de tag / UID</label>
                                            <Input value={nuevo} autoComplete="off"
                                                onChange={(e) => { setNuevo(e.target.value); setErrorAlta(null); }}
                                                onKeyDown={(e) => { if (e.key === "Enter") crear(); }}
                                                placeholder="El número que trae la tarjeta" className="h-10" />
                                            <p className="text-[11px] text-muted-foreground">
                                                Tiene que ser igual al que lee el equipo. Un dígito de diferencia y la tarjeta no abre.
                                            </p>
                                        </div>
                                        {errorAlta && (
                                            <p className="text-[12px] tono-mal">{errorAlta}</p>
                                        )}
                                        <div className="flex gap-2 justify-end pt-1">
                                            <Button variant="ghost" onClick={() => setCreando(false)}>Cancelar</Button>
                                            <Button onClick={crear} className="accion">Crear tag</Button>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </>
                        }
                    />
                }
            />

            {/* Asignar a quién. */}
            <Dialog open={!!asignando} onOpenChange={(o) => { if (!o) setAsignando(null); }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Asignar el tag {asignando?.value}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 pt-1">
                        <Select value={aQuien} onValueChange={setAQuien}>
                            <SelectTrigger className="h-10"><SelectValue placeholder="Elegí a quién" /></SelectTrigger>
                            <SelectContent>
                                {users.map((u) => (
                                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className="flex gap-2 justify-end">
                            <Button variant="ghost" onClick={() => setAsignando(null)}>Cancelar</Button>
                            <Button onClick={asignar} disabled={!aQuien} className="accion">Asignar</Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
