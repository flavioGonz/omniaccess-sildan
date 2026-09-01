"use client";

import { useState } from "react";
import { Credential, User, Unit } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Search, Plus, Edit, Trash2, UserPlus, UserMinus, X, CreditCard, Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteTag, assignTag, unassignTag, createTag, purgeTags } from "@/app/actions/tags";
import { cn } from "@/lib/utils";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

type TagWithUser = Credential & {
    user: (User & { unit: Unit | null }) | null;
};

interface TagListProps {
    initialTags: TagWithUser[];
    users: User[];
}

export function TagList({ initialTags, users }: TagListProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [filter, setFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');
    const [selectedTag, setSelectedTag] = useState<TagWithUser | null>(null);
    const [showAssignDialog, setShowAssignDialog] = useState(false);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newTagValue, setNewTagValue] = useState("");

    // Filter tags
    const filteredTags = initialTags.filter(tag => {
        const matchesSearch = tag.value.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (tag.user?.name && tag.user.name.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesFilter =
            filter === 'all' ? true :
                filter === 'assigned' ? (tag.userId && tag.userId !== "") :
                    (!tag.userId || tag.userId === "");

        return matchesSearch && matchesFilter;
    });

    const handleDelete = async (id: string) => {
        if (confirm("¿Estás seguro de eliminar este tag?")) {
            await deleteTag(id);
            window.location.reload();
        }
    };

    const handleAssign = async (tagId: string, userId: string) => {
        await assignTag(tagId, userId);
        setShowAssignDialog(false);
        setSelectedTag(null);
        window.location.reload();
    };

    const handleUnassign = async (tagId: string) => {
        if (confirm("¿Desasignar este tag del usuario?")) {
            await unassignTag(tagId);
            window.location.reload();
        }
    };

    const handleCreate = async () => {
        if (!newTagValue.trim()) {
            alert("Ingresa un valor para el tag");
            return;
        }
        await createTag({ value: newTagValue });
        setNewTagValue("");
        setShowCreateDialog(false);
        window.location.reload();
    };

    const handlePurge = async () => {
        if (confirm("⚠️ CUIDADO: ¿Estás seguro de que quieres ELIMINAR TODOS los tags del sistema? Esta acción no se puede deshacer.")) {
            const res = await purgeTags();
            if (res.success) {
                window.location.reload();
            } else {
                alert(res.error);
            }
        }
    };

    return (
        <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <Input
                        placeholder="Buscar por tag o usuario..."
                        className="pl-10 bg-card border-border h-11 rounded-xl"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>

                <div className="flex gap-2">
                    <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                        <SelectTrigger className="w-[180px] bg-card border-border">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="assigned">Asignados</SelectItem>
                            <SelectItem value="unassigned">Disponibles</SelectItem>
                        </SelectContent>
                    </Select>

                    <Button
                        variant="outline"
                        onClick={handlePurge}
                        className="border-red-500/20 bg-red-500/5 text-red-500 hover:bg-red-500 hover:text-foreground"
                    >
                        <Trash2 size={16} className="mr-2" />
                        Purgar Datos
                    </Button>

                    <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                        <DialogTrigger asChild>
                            <Button className="bg-emerald-600 hover:bg-emerald-700">
                                <Plus size={16} className="mr-2" />
                                Nuevo Tag
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Crear Nuevo Tag</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-4">
                                <div>
                                    <label className="text-sm font-bold text-foreground mb-2 block">
                                        Número de Tag / UID
                                    </label>
                                    <Input
                                        placeholder="Ej: 1234567890"
                                        value={newTagValue}
                                        onChange={(e) => setNewTagValue(e.target.value)}
                                        className="bg-card border-border"
                                    />
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                                        Cancelar
                                    </Button>
                                    <Button onClick={handleCreate} className="bg-emerald-600 hover:bg-emerald-700">
                                        Crear Tag
                                    </Button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Table */}
            <div className="relative bg-card rounded-xl border border-border overflow-hidden">
                <div className="max-h-[calc(100vh-280px)] overflow-y-auto custom-scrollbar">
                    <table className="w-full">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border">
                                <th className="text-left p-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Tag / UID</th>
                                <th className="text-left p-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Usuario Asignado</th>
                                <th className="text-left p-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Unidad</th>
                                <th className="text-left p-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Estado</th>
                                <th className="text-right p-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-800/50">
                            {filteredTags.map((tag, index) => (
                                <tr
                                    key={tag.id}
                                    className="hover:bg-muted/30 transition-colors group"
                                    style={{ animationDelay: `${index * 50}ms` }}
                                >
                                    {/* Tag Value */}
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center border border-border group-hover:border-emerald-500/30 transition-colors">
                                                <CreditCard size={20} className="text-muted-foreground group-hover:text-emerald-400 transition-colors" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-foreground font-mono tracking-wider">
                                                    {tag.value}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground font-mono">
                                                    ID: {tag.id.slice(0, 8)}
                                                </p>
                                            </div>
                                        </div>
                                    </td>

                                    {/* User */}
                                    <td className="p-4">
                                        {tag.user && tag.userId ? (
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                                                    {tag.user.name.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-foreground">
                                                        {tag.user.name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {tag.user.email || tag.user.phone}
                                                    </p>
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">Sin asignar</span>
                                        )}
                                    </td>

                                    {/* Unit */}
                                    <td className="p-4">
                                        {tag.user?.unit ? (
                                            <span className="text-sm text-muted-foreground">
                                                {tag.user.unit.name}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                    </td>

                                    {/* Status */}
                                    <td className="p-4">
                                        {tag.userId && tag.userId !== "" ? (
                                            <Badge variant="default" className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                                ASIGNADO
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-[10px] font-bold bg-blue-500/10 text-blue-400 border-blue-500/20">
                                                DISPONIBLE
                                            </Badge>
                                        )}
                                    </td>

                                    {/* Actions */}
                                    <td className="p-4">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {tag.userId && tag.userId !== "" ? (
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    onClick={() => handleUnassign(tag.id)}
                                                    className="h-8 w-8 rounded-lg hover:bg-orange-500/10 hover:text-orange-400"
                                                    title="Desasignar"
                                                >
                                                    <UserMinus size={16} />
                                                </Button>
                                            ) : (
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    onClick={() => {
                                                        setSelectedTag(tag);
                                                        setShowAssignDialog(true);
                                                    }}
                                                    className="h-8 w-8 rounded-lg hover:bg-emerald-500/10 hover:text-emerald-400"
                                                    title="Asignar"
                                                >
                                                    <UserPlus size={16} />
                                                </Button>
                                            )}
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                onClick={() => handleDelete(tag.id)}
                                                className="h-8 w-8 rounded-lg hover:bg-red-500/10 hover:text-red-400"
                                            >
                                                <Trash2 size={16} />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Empty State */}
                    {filteredTags.length === 0 && (
                        <div className="py-20 text-center">
                            <CreditCard size={48} className="mx-auto text-muted-foreground mb-4 animate-pulse" />
                            <h3 className="text-lg font-bold text-foreground mb-2">
                                No se encontraron tags
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {searchTerm ? 'Intenta con otro término de búsqueda' : 'Agrega tu primer tag RFID'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Bottom Gradient */}
                <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-neutral-900 to-transparent pointer-events-none" />
            </div>

            {/* Results Counter */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
                <p>
                    Mostrando <span className="font-bold text-foreground">{filteredTags.length}</span> de{' '}
                    <span className="font-bold text-foreground">{initialTags.length}</span> tags
                </p>
            </div>

            {/* Assign Dialog */}
            <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Asignar Tag a Usuario</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                        <div>
                            <label className="text-sm font-bold text-foreground mb-2 block">
                                Tag: <span className="font-mono text-emerald-400">{selectedTag?.value}</span>
                            </label>
                        </div>
                        <div>
                            <label className="text-sm font-bold text-foreground mb-2 block">
                                Seleccionar Usuario
                            </label>
                            <Select onValueChange={(userId) => selectedTag && handleAssign(selectedTag.id, userId)}>
                                <SelectTrigger className="bg-card border-border">
                                    <SelectValue placeholder="Selecciona un usuario..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {users.map(user => (
                                        <SelectItem key={user.id} value={user.id}>
                                            {user.name} - {user.email || user.phone}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 8px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #333;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #444;
                }
            `}</style>
        </div>
    );
}
