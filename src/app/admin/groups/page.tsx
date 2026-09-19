"use client";

import { useEffect, useMemo, useState } from "react";
import { createAccessGroup, deleteAccessGroup, getAccessGroups } from "@/app/actions/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Users, Search, Cpu, ShieldCheck, Loader2 } from "lucide-react";
import { DeleteButton } from "@/components/ui/delete-button";
import { fecha } from "@/lib/fechas";

type AccessGroupWithCounts = {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    _count: { users: number; devices?: number };
};

export default function GroupsPage() {
    const [groups, setGroups] = useState<AccessGroupWithCounts[]>([]);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    async function load() {
        try {
            const data = await getAccessGroups();
            setGroups(data as AccessGroupWithCounts[]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    async function handleSubmit(formData: FormData) {
        setSubmitting(true);
        try {
            await createAccessGroup(formData);
            setOpen(false);
            await load();
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(id: string) {
        // la confirmacion la hace el propio boton (hay que mantenerlo apretado)
        await deleteAccessGroup(id);
        await load();
    }

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return groups;
        return groups.filter((g) => g.name.toLowerCase().includes(q));
    }, [groups, query]);

    const totalUsers = useMemo(() => groups.reduce((a, g) => a + (g._count?.users || 0), 0), [groups]);

    return (
        <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                        <Users size={20} className="text-purple-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Grupos de Acceso</h1>
                        <p className="text-xs text-muted-foreground">Niveles de permisos y jerarquías del recinto</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar grupo…" className="pl-8 h-9 w-48 bg-muted/40 border-border text-sm" />
                    </div>
                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-9 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold gap-1.5">
                                <Plus size={16} /> Crear grupo
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-sm">
                            <DialogHeader>
                                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-500 mb-2">
                                    <ShieldCheck size={18} />
                                </div>
                                <DialogTitle>Nuevo grupo de acceso</DialogTitle>
                            </DialogHeader>
                            <form action={handleSubmit} className="space-y-4 pt-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="name" className="text-xs font-medium text-foreground/80">Nombre del grupo</Label>
                                    <Input id="name" name="name" placeholder="Ej: Residentes Torre Norte" required className="h-10 bg-muted/40 border-border" />
                                </div>
                                <Button type="submit" disabled={submitting} className="w-full h-10 bg-purple-600 hover:bg-purple-500 text-white font-semibold gap-2">
                                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Crear grupo
                                </Button>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Summary chips */}
            <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50 border border-border text-muted-foreground">
                    <Users size={12} className="text-purple-500" /> {groups.length} grupos
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50 border border-border text-muted-foreground">
                    <ShieldCheck size={12} className="text-blue-500" /> {totalUsers} usuarios asignados
                </span>
            </div>

            {/* Table */}
            <div className="border border-border rounded-xl overflow-hidden bg-card">
                <Table>
                    <TableHeader className="bg-muted/40">
                        <TableRow className="border-border hover:bg-transparent">
                            <TableHead className="text-muted-foreground text-xs font-semibold">Grupo</TableHead>
                            <TableHead className="text-muted-foreground text-xs font-semibold">Usuarios</TableHead>
                            <TableHead className="text-muted-foreground text-xs font-semibold">Dispositivos</TableHead>
                            <TableHead className="text-muted-foreground text-xs font-semibold">Creado</TableHead>
                            <TableHead className="text-right text-muted-foreground text-xs font-semibold pr-4">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">
                                    <Loader2 size={20} className="mx-auto mb-2 animate-spin" />
                                    <p className="text-xs">Cargando grupos…</p>
                                </TableCell>
                            </TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">
                                    <Users size={32} className="mx-auto mb-3 opacity-30" />
                                    <p className="text-xs font-medium">{query ? "Sin resultados para tu búsqueda" : "No hay grupos definidos todavía"}</p>
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map((g) => (
                                <TableRow key={g.id} className="border-border hover:bg-muted/30 transition-colors">
                                    <TableCell className="py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-muted border border-border flex items-center justify-center text-purple-500 shrink-0">
                                                <Users size={16} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-semibold text-sm text-foreground truncate">{g.name}</p>
                                                <p className="text-[10px] text-muted-foreground font-mono">#{g.id.slice(-6)}</p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-500 text-xs font-medium">
                                            <Users size={12} /> {g._count.users}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-500 text-xs font-medium">
                                            <Cpu size={12} /> {g._count.devices || 0}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {fecha(new Date(g.createdAt))}
                                    </TableCell>
                                    <TableCell className="text-right pr-4">
                                        <div className="flex justify-end">
                                            <DeleteButton onConfirm={() => handleDelete(g.id)} />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
