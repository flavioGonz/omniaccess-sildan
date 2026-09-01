"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCredential, updateCredential } from "@/app/actions/credentials";
import { Loader2 } from "lucide-react";
import { User, Credential } from "@prisma/client";

interface CredentialFormDialogProps {
    children: React.ReactNode;
    credential?: Credential & { userId: string }; // Extended slightly
    users: User[];
    onSuccess?: () => void;
}

export function CredentialFormDialog({ children, credential, users, onSuccess }: CredentialFormDialogProps) {
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        userId: "",
        type: "PLATE",
        value: ""
    });

    useEffect(() => {
        if (credential) {
            setFormData({
                userId: credential.userId,
                type: credential.type,
                value: credential.value
            });
        } else {
            setFormData({
                userId: "",
                type: "PLATE",
                value: ""
            });
        }
    }, [credential, open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const data = new FormData();
            data.append("userId", formData.userId);
            data.append("type", formData.type);
            data.append("value", formData.value);

            if (credential) {
                await updateCredential(credential.id, data);
            } else {
                await createCredential(data);
            }

            setOpen(false);
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error("Error saving credential:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold uppercase tracking-tight">
                        {credential ? "Editar Credencial" : "Nueva Credencial"}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        {credential ? "Modifique los datos de la credencial existente." : "Asocie una nueva credencial a un usuario del sistema."}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6 pt-4">
                    <div className="space-y-4">
                        {/* User Selection */}
                        <div className="space-y-2">
                            <Label htmlFor="user" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Usuario Asignado</Label>
                            <Select
                                value={formData.userId}
                                onValueChange={(val) => setFormData({ ...formData, userId: val })}
                                required
                            >
                                <SelectTrigger id="user" className="bg-black/40 border-neutral-800 h-10 font-medium">
                                    <SelectValue placeholder="Seleccione un usuario..." />
                                </SelectTrigger>
                                <SelectContent className="bg-card border-border text-foreground">
                                    {users.map((u) => (
                                        <SelectItem key={u.id} value={u.id}>
                                            {u.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Credential Type */}
                        <div className="space-y-2">
                            <Label htmlFor="type" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tipo de Credencial</Label>
                            <Select
                                value={formData.type}
                                onValueChange={(val) => setFormData({ ...formData, type: val })}
                                required
                            >
                                <SelectTrigger id="type" className="bg-black/40 border-neutral-800 h-10 font-medium">
                                    <SelectValue placeholder="Tipo" />
                                </SelectTrigger>
                                <SelectContent className="bg-card border-border text-foreground">
                                    <SelectItem value="PLATE">LPR / Patente</SelectItem>
                                    <SelectItem value="TAG">Tarjeta RFID / Tag</SelectItem>
                                    <SelectItem value="FACE">Reconocimiento Facial</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Value Input */}
                        <div className="space-y-2">
                            <Label htmlFor="value" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                {formData.type === 'PLATE' ? 'Número de Patente' : formData.type === 'TAG' ? 'Código RFID' : 'Hash / Valor Facial'}
                            </Label>
                            <Input
                                id="value"
                                value={formData.value}
                                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                                className="bg-black/40 border-neutral-800 h-10 font-mono"
                                placeholder={formData.type === 'PLATE' ? 'ABC-123' : '...'}
                                required
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="hover:bg-muted text-muted-foreground block mt-2 sm:mt-0">
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="bg-orange-600 hover:bg-orange-700 text-foreground font-bold"
                        >
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {credential ? "Guardar Cambios" : "Crear Credencial"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
