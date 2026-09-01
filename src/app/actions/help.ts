"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { uploadToS3 } from "@/lib/s3";

export type FaqItem = {
    question: string;
    answer: string;
};

export type HelpDoc = {
    id: string;
    title: string;
    icon: string;
    color: string;
    bg: string;
    description: string;
    details: string;
    features: string[];
    image: string;
    videoUrl?: string;
    faqs: FaqItem[];
};

export async function getHelpDocs(): Promise<HelpDoc[]> {
    const setting = await prisma.setting.findUnique({
        where: { key: "HELP_DOCS" }
    });

    if (setting) {
        return JSON.parse(setting.value);
    }

    // Default docs if none in DB
    const defaultDocs: HelpDoc[] = [
        {
            id: "dashboard",
            title: "Panel de Control",
            icon: "LayoutDashboard",
            color: "text-blue-400",
            bg: "bg-blue-500/10",
            description: "Vista centralizada en tiempo real de todos los eventos perimetrales.",
            details: "El Dashboard es el corazón de la plataforma. Aquí puedes ver el flujo en vivo de vehículos y peatones. Incluye estadísticas de ocupación de estacionamiento, alertas de seguridad de último minuto y un panel de 'Acciones Rápidas' para abrir barreras o puertas manualmente desde cualquier lugar.",
            features: ["Streaming de eventos", "Estadísticas de ocupación", "Alertas en tiempo real", "Acciones de relé"],
            image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800",
            faqs: [
                { question: "¿Cómo abro una puerta remotamente?", answer: "En el widget de 'Acciones Rápidas', selecciona el dispositivo y presiona 'Abrir'." },
                { question: "¿Por qué no veo el streaming?", answer: "Asegúrate de que la cámara sea compatible con el protocolo WebRTC o HLS configurado en el sistema." }
            ]
        },
        {
            id: "history",
            title: "Historial de Accesos",
            icon: "History",
            color: "text-emerald-400",
            bg: "bg-emerald-500/10",
            description: "Auditoría forense de entradas y salidas.",
            details: "El historial almacena cada evento capturado por las cámaras LPR y terminales faciales. Incluye fotos de las matrículas, rostros, marca del vehículo y decisión de acceso (Permitido/Denegado).",
            features: ["Filtros por fecha/matrícula", "Fotos de evidencia", "Exportación CSV/PDF"],
            image: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&q=80&w=800",
            faqs: [
                { question: "¿Cuánto tiempo se guardan las fotos?", answer: "Depende de tu política de retención configurada en Ajustes > Almacenamiento." }
            ]
        }
    ];

    return defaultDocs;
}

export async function updateHelpDocs(docs: HelpDoc[]) {
    await prisma.setting.upsert({
        where: { key: "HELP_DOCS" },
        update: { value: JSON.stringify(docs) },
        create: { key: "HELP_DOCS", value: JSON.stringify(docs) }
    });
    revalidatePath("/admin/help");
    return { success: true };
}

export async function uploadHelpMedia(formData: FormData) {
    const file = formData.get("file") as File;
    if (!file) return { success: false, message: "No file provided" };

    const buffer = await file.arrayBuffer();
    const filename = `help/${Date.now()}-${file.name}`;

    try {
        const url = await uploadToS3(buffer, filename, file.type, "face"); // Using face bucket as generic storage for now
        return { success: true, url };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}
