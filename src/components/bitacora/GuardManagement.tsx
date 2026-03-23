"use client";

import React, { useState, useEffect } from "react";
import {
    Shield,
    Plus,
    X,
    Loader2,
    Pencil,
    Trash2,
    Upload,
    Camera,
    User as UserIcon
} from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getGuardsList, saveGuard, deleteGuard } from "@/app/actions/users";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

export default function GuardManagement() {
    const [guardsList, setGuardsList] = useState<any[]>([]);
    const [loadingGuards, setLoadingGuards] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editingGuard, setEditingGuard] = useState<any>(null);
    const [guardForm, setGuardForm] = useState({
        name: "",
        dni: "",
        username: "",
        password: "",
        photo: null as File | null,
        currentPhoto: ""
    });

    const loadGuards = async () => {
        setLoadingGuards(true);
        try {
            const guards = await getGuardsList();
            setGuardsList(guards);
        } catch (e) {
            console.error(e);
            toast.error("Error al cargar lista de guardias");
        } finally {
            setLoadingGuards(false);
        }
    };

    useEffect(() => {
        loadGuards();
    }, []);

    const handleSaveGuard = async () => {
        if (!guardForm.name || !guardForm.dni) {
            toast.error("Nombre y DNI son obligatorios");
            return;
        }

        const formData = new FormData();
        if (editingGuard) formData.append("id", editingGuard.id);
        formData.append("name", guardForm.name);
        formData.append("username", guardForm.username);
        formData.append("dni", guardForm.dni);
        if (guardForm.password) formData.append("password", guardForm.password);
        if (guardForm.photo) formData.append("photo", guardForm.photo);
        formData.append("currentPhoto", guardForm.currentPhoto);

        try {
            await saveGuard(formData);
            toast.success("Guardia guardado correctamente");
            setIsEditing(false);
            loadGuards();
        } catch (e) {
            console.error(e);
            toast.error("Error al guardar guardia");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("¿Está seguro de eliminar este guardia?")) return;
        try {
            await deleteGuard(id);
            toast.success("Guardia eliminado");
            loadGuards();
        } catch (e) {
            console.error(e);
            toast.error("Error al eliminar guardia");
        }
    };

    if (loadingGuards) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight">Gestión de Personal</h2>
                    <p className="text-xs text-neutral-500 font-bold uppercase tracking-widest mt-1">Administración de accesos y credenciales de guardias</p>
                </div>
                {!isEditing && (
                    <Button
                        onClick={() => {
                            setEditingGuard(null);
                            setGuardForm({ name: "", dni: "", username: "", password: "", photo: null, currentPhoto: "" });
                            setIsEditing(true);
                        }}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest px-8 h-12 rounded-2xl shadow-lg shadow-blue-500/20"
                    >
                        <Plus className="mr-2" size={18} /> Nuevo Guardia
                    </Button>
                )}
            </div>

            <AnimatePresence mode="wait">
                {isEditing ? (
                    <motion.div
                        key="edit-form"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="bg-neutral-900 border border-neutral-800 rounded-[2.5rem] p-8"
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase text-neutral-500 tracking-widest ml-1">Nombre Completo</label>
                                    <Input
                                        value={guardForm.name}
                                        onChange={(e) => setGuardForm({ ...guardForm, name: e.target.value })}
                                        className="bg-neutral-950 border-neutral-800 text-white h-12"
                                        placeholder="Ej: Juan Pérez"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase text-neutral-500 tracking-widest ml-1">Usuario (Login)</label>
                                    <Input
                                        value={guardForm.username}
                                        onChange={(e) => setGuardForm({ ...guardForm, username: e.target.value })}
                                        className="bg-neutral-950 border-neutral-800 text-white h-12"
                                        placeholder="Ej: juan.perez"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-neutral-500 tracking-widest ml-1">DNI / Documento</label>
                                        <Input
                                            value={guardForm.dni}
                                            onChange={(e) => setGuardForm({ ...guardForm, dni: e.target.value })}
                                            className="bg-neutral-950 border-neutral-800 text-white h-12"
                                            placeholder="Ej: 12345678"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-neutral-500 tracking-widest ml-1">Contraseña (PIN)</label>
                                        <Input
                                            value={guardForm.password}
                                            onChange={(e) => setGuardForm({ ...guardForm, password: e.target.value })}
                                            className="bg-neutral-950 border-neutral-800 text-white h-12"
                                            type="password"
                                            placeholder={editingGuard ? "••••••" : "Ingrese PIN"}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col items-center justify-center gap-6">
                                <div className="relative w-48 h-48 rounded-[2.5rem] bg-black border-4 border-neutral-800 overflow-hidden group cursor-pointer shadow-2xl">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="absolute inset-0 opacity-0 z-20 cursor-pointer"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) setGuardForm({ ...guardForm, photo: file });
                                        }}
                                    />
                                    {guardForm.photo ? (
                                        <img src={URL.createObjectURL(guardForm.photo)} className="w-full h-full object-cover" />
                                    ) : guardForm.currentPhoto ? (
                                        <Image src={guardForm.currentPhoto.startsWith('/') ? guardForm.currentPhoto : `/api/files/${guardForm.currentPhoto}`} fill className="object-cover" alt="Guard" />
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center text-neutral-800 gap-3">
                                            <Camera size={48} />
                                            <span className="text-[10px] font-black uppercase tracking-widest">Subir Foto</span>
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-blue-600/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none backdrop-blur-sm">
                                        <Upload className="text-white" size={32} />
                                    </div>
                                </div>
                                <p className="text-[10px] text-neutral-500 text-center font-bold uppercase tracking-tight max-w-[200px]">Formatos aceptados: JPG, PNG. Máximo 5MB.</p>
                            </div>
                        </div>

                        <div className="flex justify-end gap-4 mt-12 pt-8 border-t border-neutral-800/50">
                            <Button
                                variant="ghost"
                                onClick={() => setIsEditing(false)}
                                className="text-xs font-black uppercase tracking-widest text-neutral-500 hover:text-white"
                            >
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleSaveGuard}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest px-10 h-12 rounded-2xl shadow-lg shadow-emerald-500/20"
                            >
                                Guardar Cambios
                            </Button>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="list"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="bg-neutral-900/50 border border-neutral-800 rounded-[2.5rem] overflow-hidden"
                    >
                        <Table>
                            <TableHeader>
                                <TableRow className="border-neutral-800 bg-black/40 hover:bg-black/40 transition-none">
                                    <TableHead className="w-[100px] text-[10px] font-black uppercase text-neutral-500 tracking-widest py-6">Perfil</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase text-neutral-500 tracking-widest">Nombre del Guardia</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase text-neutral-500 tracking-widest">Documento</TableHead>
                                    <TableHead className="text-[10px] font-black uppercase text-neutral-500 tracking-widest text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {guardsList.map((guard) => (
                                    <TableRow key={guard.id} className="border-neutral-800/50 hover:bg-white/5 transition-colors group">
                                        <TableCell className="py-4">
                                            <div className="relative w-12 h-12 rounded-2xl overflow-hidden bg-neutral-800 border border-neutral-700 shadow-inner">
                                                {guard.cara ? (
                                                    <Image src={guard.cara.startsWith('/') ? guard.cara : `/api/files/${guard.cara}`} alt={guard.name} fill className="object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-neutral-700">
                                                        <UserIcon size={20} />
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-black text-white uppercase text-sm tracking-tight">{guard.name}</TableCell>
                                        <TableCell className="text-neutral-500 font-mono text-sm tracking-wider">{guard.dni || "-----------"}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => {
                                                        setEditingGuard(guard);
                                                        setGuardForm({
                                                            name: guard.name,
                                                            dni: guard.dni || "",
                                                            username: guard.username || "",
                                                            password: "",
                                                            photo: null,
                                                            currentPhoto: guard.cara || ""
                                                        });
                                                        setIsEditing(true);
                                                    }}
                                                    className="w-10 h-10 rounded-xl bg-blue-500/10 hover:bg-blue-600 text-blue-500 hover:text-white flex items-center justify-center transition-all shadow-lg"
                                                >
                                                    <Pencil size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(guard.id)}
                                                    className="w-10 h-10 rounded-xl bg-red-500/10 hover:bg-red-600 text-red-500 hover:text-white flex items-center justify-center transition-all shadow-lg"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
