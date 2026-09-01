"use server";

import { prisma } from "@/lib/prisma";

export type TreeNode = {
    id: string;
    name: string;
    type: 'section' | 'feature' | 'action';
    status: 'done' | 'pending';
    children?: TreeNode[];
    description?: string;
    icon?: string;
    slug?: string;
};

export async function getProjectStructure(): Promise<TreeNode> {
    const setting = await prisma.setting.findUnique({
        where: { key: "PROJECT_STRUCTURE" }
    });

    if (setting) {
        return JSON.parse(setting.value);
    }

    // Default structure if not found
    const defaultStructure: TreeNode = {
        id: "root",
        name: "LPR-NODE CORE",
        type: "section",
        status: "done",
        children: [
            {
                id: "1",
                name: "Monitorización",
                type: "section",
                status: "done",
                icon: "LayoutDashboard",
                description: "Vigilancia en tiempo real y alertas",
                children: [
                    { id: "1-1", name: "Stream de Eventos", type: "feature", status: "done", icon: "Activity", slug: "dashboard" },
                    { id: "1-2", name: "Búsqueda LPR", type: "feature", status: "done", icon: "Search", slug: "dashboard" },
                    { id: "1-3", name: "Acciones de Relé", type: "feature", status: "done", icon: "Zap", slug: "dashboard" }
                ]
            },
            {
                id: "2",
                name: "Administración",
                type: "section",
                status: "done",
                icon: "Users",
                description: "Gestión de sujetos y unidades",
                children: [
                    { id: "2-1", name: "Residentes", type: "feature", status: "done", icon: "User", slug: "users" },
                    { id: "2-2", name: "Unidades", type: "feature", status: "done", icon: "Home", slug: "units" },
                    { id: "2-3", name: "Grupos de Acceso", type: "feature", status: "done", icon: "ShieldCheck", slug: "groups" }
                ]
            },
            {
                id: "3",
                name: "Flota Vehicular",
                type: "section",
                status: "done",
                icon: "Car",
                description: "Control de patentes y estacionamiento",
                children: [
                    { id: "3-1", name: "Listado Maestro", type: "feature", status: "done", icon: "FileText", slug: "vehicles" },
                    { id: "3-2", name: "Mapas de Plazas", type: "feature", status: "done", icon: "LayoutGrid", slug: "plazas" },
                    { id: "3-3", name: "Control de RFID", type: "feature", status: "done", icon: "CreditCard", slug: "rfid" }
                ]
            },
            {
                id: "4",
                name: "Hardware & Red",
                type: "section",
                status: "done",
                icon: "Cpu",
                description: "Conectividad Hikvision/Akuvox",
                children: [
                    { id: "4-1", name: "Nodos LPR", type: "feature", status: "done", icon: "Camera", slug: "devices" },
                    { id: "4-2", name: "Terminales SIP", type: "feature", status: "done", icon: "Tablet", slug: "devices" },
                    { id: "4-3", name: "Webhooks ISAPI", type: "feature", status: "done", icon: "Code2", slug: "debug" }
                ]
            },
            {
                id: "5",
                name: "Sistema & Auditoría",
                type: "section",
                status: "done",
                icon: "Settings",
                description: "Logs, histórico y configuración",
                children: [
                    { id: "5-1", name: "Histórico Forense", type: "feature", status: "done", icon: "History", slug: "history" },
                    { id: "5-2", name: "Calendario", type: "feature", status: "done", icon: "Calendar", slug: "calendar" },
                    { id: "5-3", name: "Ajustes Globales", type: "feature", status: "done", icon: "Settings", slug: "settings" }
                ]
            }
        ]
    };

    return defaultStructure;
}

export async function updateProjectStructure(data: TreeNode) {
    await prisma.setting.upsert({
        where: { key: "PROJECT_STRUCTURE" },
        update: { value: JSON.stringify(data) },
        create: { key: "PROJECT_STRUCTURE", value: JSON.stringify(data) }
    });
    return { success: true };
}
