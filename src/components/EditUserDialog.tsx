"use client";

import { useState } from "react";
import { User, Unit, AccessGroup } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, User as UserIcon } from "lucide-react";
import Image from 'next/image';

type UserWithRelations = User & {
    unit: Unit | null;
    accessGroups: AccessGroup[];
};

interface EditUserDialogProps {
    user: UserWithRelations;
    onUserUpdated: () => void;
}

export function EditUserDialog({ user, onUserUpdated }: EditUserDialogProps) {
    const [open, setOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(user.cara);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const file = event.target.files[0];
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;

        const formData = new FormData();
        formData.append("faceImage", selectedFile);

        try {
            const response = await fetch(`/api/users/${user.id}/face`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Failed to upload image');
            }

            // Success
            setOpen(false);
            onUserUpdated(); // Reload data in parent

        } catch (error) {
            console.error("Upload error:", error);
            // Here you could add a toast notification to show the error
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-blue-500 hover:bg-blue-900/20 hover:text-blue-400">
                    <Pencil size={16} />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl bg-card border-border text-foreground sm:rounded-xl p-6">
                <DialogHeader>
                    <DialogTitle>Editar Usuario: {user.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                    <div className="flex flex-col items-center space-y-4">
                        <div className="w-32 h-32 rounded-full bg-muted relative overflow-hidden flex items-center justify-center">
                            {previewUrl ? (
                                <Image src={previewUrl} alt="User face" fill sizes="128px" className="object-cover" />
                            ) : (
                                <UserIcon size={64} className="text-muted-foreground" />
                            )}
                        </div>
                        <Input
                            id="face-upload"
                            type="file"
                            accept="image/*"
                            onChange={handleFileChange}
                            className="bg-muted border-border file:text-foreground"
                        />
                        <Label htmlFor="face-upload" className="text-sm text-muted-foreground cursor-pointer">
                            Selecciona una imagen para el rostro.
                        </Label>
                    </div>

                    {/* User fields are managed via the main UserFormDialog */}

                    <Button onClick={handleUpload} className="w-full bg-blue-600 hover:bg-blue-700" disabled={!selectedFile}>
                        Guardar Cambios
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
