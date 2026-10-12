'use server'

import { prisma } from '@/lib/prisma'
import { MODULE_DEFINITIONS, type ModuleId } from '@/lib/module-definitions';
export type { ModuleId } from '@/lib/module-definitions';

// ─── Module Definitions ─────────────────────────────

// ─── Get Enabled Modules ────────────────────────────
export async function getEnabledModules(): Promise<Record<ModuleId, boolean>> {
    const settings = await prisma.setting.findMany({
        where: {
            key: { in: MODULE_DEFINITIONS.map(m => m.id) },
        },
    });

    const result: Record<string, boolean> = {};

    for (const mod of MODULE_DEFINITIONS) {
        const setting = settings.find(s => s.key === mod.id);
        result[mod.id] = setting ? setting.value === 'true' : mod.defaultEnabled;
    }

    // Los modos se excluyen: si lo guardado (o lo de fábrica) deja más de uno prendido, vale el
    // primero en el orden de MODULE_DEFINITIONS y los demás se leen apagados. Mostrar dos «en
    // uso» sería un estado que la aplicación no sabe correr: cada pantalla elegiría distinto.
    // No se escribe nada acá; el modo se cambia por setExclusiveMode, con su clave.
    let hayModo = false;
    for (const mod of MODULE_DEFINITIONS) {
        if (!mod.exclusive || !result[mod.id]) continue;
        if (hayModo) result[mod.id] = false; else hayModo = true;
    }

    return result as Record<ModuleId, boolean>;
}

// ─── Toggle Module ──────────────────────────────────
export async function toggleModule(moduleId: ModuleId, enabled: boolean): Promise<{ success: boolean }> {
    // Validate moduleId
    if (!MODULE_DEFINITIONS.find(m => m.id === moduleId)) {
        return { success: false };
    }

    await prisma.setting.upsert({
        where: { key: moduleId },
        update: { value: String(enabled) },
        create: { key: moduleId, value: String(enabled) },
    });

    return { success: true };
}

// ─── Check if a specific module is enabled ──────────
export async function isModuleEnabled(moduleId: ModuleId): Promise<boolean> {
    // Por el mismo camino que la pantalla, para que «¿está prendido?» y lo que se ve en Modos
    // no puedan contestar distinto (con dos modos guardados, sólo vale el primero).
    return (await getEnabledModules())[moduleId] ?? false;
}

// ─── Set exclusive mode (enable one module, disable the rest) ───────────────
export async function setExclusiveMode(moduleId: ModuleId): Promise<{ success: boolean }> {
    if (!MODULE_DEFINITIONS.find(m => m.id === moduleId)) return { success: false };
    await prisma.$transaction(
        MODULE_DEFINITIONS.filter(m => m.exclusive !== false).map(m =>
            prisma.setting.upsert({
                where: { key: m.id },
                update: { value: String(m.id === moduleId) },
                create: { key: m.id, value: String(m.id === moduleId) },
            })
        )
    );
    return { success: true };
}
