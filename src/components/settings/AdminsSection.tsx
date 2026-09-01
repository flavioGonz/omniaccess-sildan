"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import {
    Camera,
    Loader2,
    Pencil,
    Plus,
    Trash2,
    Upload,
    User as UserIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { Switch } from "@/components/ui/switch";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getAdminsList as getAdmins, saveAdmin as saveAdminAction, deleteAdmin as deleteAdminAction } from "@/app/actions/users";

export default function AdminsSection() {
    const [admins, setAdmins] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingAdmin, setEditingAdmin] = useState<any>(null);
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        photo: null as File | null,
        currentPhoto: ""
    });

    useEffect(() => {
        loadAdmins();
    }, []);

    const loadAdmins = async () => {
        setLoading(true);
        try {
            const list = await getAdmins();
            setAdmins(list);
        } catch (error) {
            toast.error({ title: "Error al cargar administradores" });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!formData.name) return toast.error({ title: "El nombre de usuario es requerido" });

        const data = new FormData();
        if (editingAdmin) data.append("id", editingAdmin.id);
        data.append("name", formData.name);
        data.append("email", formData.email);
        data.append("password", formData.password); // Plain text mainly as per request
        if (formData.photo) data.append("photo", formData.photo);
        data.append("currentPhoto", formData.currentPhoto);

        try {
            await saveAdminAction(data);
            toast.success({ title: editingAdmin ? "Administrador actualizado" : "Administrador creado" });
            setIsDialogOpen(false);
            loadAdmins();
            setEditingAdmin(null);
            setFormData({ name: "", email: "", password: "", photo: null, currentPhoto: "" });
        } catch (error: any) {
            toast.error({ title: error.message || "Error al guardar administrador" });
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm("¿Estás seguro de eliminar este administrador?")) {
            try {
                await deleteAdminAction(id);
                toast.success({ title: "Administrador eliminado" });
                loadAdmins();
            } catch (error) {
                toast.error({ title: "Error al eliminar" });
            }
        }
    };

    const openEdit = (admin: any) => {
        setEditingAdmin(admin);
        setFormData({
            name: admin.name,
            email: admin.email || "",
            password: admin.password || "", // This might be empty if we don't return passwords for security, but user requested 'pin' style display so we might have it
            photo: null,
            currentPhoto: admin.cara || ""
        });
        setIsDialogOpen(true);
    };

    const openNew = () => {
        setEditingAdmin(null);
        setFormData({ name: "", email: "", password: "", photo: null, currentPhoto: "" });
        setIsDialogOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-2xl p-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground tracking-tight">Administradores del Sistema</h2>
                        <p className="text-sm text-muted-foreground mt-1">Gestión de usuarios con acceso al panel de control</p>
                    </div>
                    <Button
                        onClick={openNew}
                        className="bg-blue-600 hover:bg-blue-500 text-foreground font-bold text-xs uppercase tracking-widest h-10 px-6"
                    >
                        <Plus size={16} className="mr-2" />
                        Nuevo Admin
                    </Button>
                </div>

                <div className="bg-background/30 border border-border rounded-xl overflow-hidden">
                    <Table>
                        <TableHeader className="bg-foreground/10">
                            <TableRow className="border-border hover:bg-transparent">
                                <TableHead className="w-[80px] text-[10px] font-bold text-muted-foreground uppercase">Foto</TableHead>
                                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Usuario / Nombre</TableHead>
                                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Email</TableHead>
                                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Rol</TableHead>
                                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        <Loader2 className="animate-spin mx-auto text-muted-foreground" />
                                    </TableCell>
                                </TableRow>
                            ) : admins.map((admin) => (
                                <TableRow key={admin.id} className="border-border hover:bg-accent transition-colors group">
                                    <TableCell>
                                        <div className="w-10 h-10 rounded-full bg-muted overflow-hidden relative border border-border">
                                            {admin.cara ? (
                                                <img
                                                    src={admin.cara.startsWith('/') ? admin.cara : `/api/files/${admin.cara}`}
                                                    alt={admin.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                                    <UserIcon size={16} />
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-bold text-foreground uppercase text-xs">
                                        {admin.name}
                                        {admin.name === 'fgonzalez' && (
                                            <span className="ml-2 text-[9px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/30">Líder</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground font-mono text-xs">{admin.email || "-"}</TableCell>
                                    <TableCell>
                                        <div className="px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20 w-fit">
                                            <span className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">{admin.role}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => openEdit(admin)}
                                                className="w-8 h-8 rounded-lg bg-blue-500/10 hover:bg-blue-600 text-blue-500 hover:text-foreground flex items-center justify-center transition-all"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(admin.id)}
                                                className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-600 text-red-500 hover:text-foreground flex items-center justify-center transition-all"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {!loading && admins.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground text-xs font-bold uppercase">
                                        No hay administradores registrados
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="bg-background border-border text-foreground sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold uppercase tracking-tight">
                            {editingAdmin ? "Editar Administrador" : "Nuevo Administrador"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-6 py-4">
                        <div className="flex items-center justify-center gap-4">
                            <div className="relative w-24 h-24 rounded-full bg-card border-2 border-border overflow-hidden group cursor-pointer transition-all hover:border-blue-500/50">
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="absolute inset-0 opacity-0 z-20 cursor-pointer"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) setFormData({ ...formData, photo: file });
                                    }}
                                />
                                {formData.photo ? (
                                    <img src={URL.createObjectURL(formData.photo)} className="w-full h-full object-cover" />
                                ) : formData.currentPhoto ? (
                                    <img src={formData.currentPhoto.startsWith('/') ? formData.currentPhoto : `/api/files/${formData.currentPhoto}`} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-1">
                                        <Camera size={20} />
                                        <span className="text-[9px] font-bold uppercase">Foto</span>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                                    <Upload className="text-foreground w-6 h-6" />
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="name" className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Usuario (Login)</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="bg-card border-border h-10"
                                    placeholder="ej: fgonzalez"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="email" className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Email (Opcional)</Label>
                                <Input
                                    id="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="bg-card border-border h-10"
                                    placeholder="ej: usuario@empresa.com"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="password" className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                    {editingAdmin ? "Nueva Contraseña (Dejar vacío para mantener)" : "Contraseña"}
                                </Label>
                                <Input
                                    id="password"
                                    type="text"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="bg-card border-border h-10 font-mono"
                                    placeholder="••••••"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-4">
                        <Button
                            variant="ghost"
                            onClick={() => setIsDialogOpen(false)}
                            className="hover:bg-card text-muted-foreground"
                        >
                            CANCELAR
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            className="bg-blue-600 hover:bg-blue-500 text-foreground font-bold uppercase tracking-widest"
                        >
                            GUARDAR
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}


