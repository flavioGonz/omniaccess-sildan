'use server'

import { prisma } from '@/lib/prisma'
import { MODULE_DEFINITIONS, type ModuleId } from '@/lib/module-definitions';

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
    const setting = await prisma.setting.findUnique({
        where: { key: moduleId },
    });

    if (!setting) {
        const def = MODULE_DEFINITIONS.find(m => m.id === moduleId);
        return def?.defaultEnabled ?? false;
    }

    return setting.value === 'true';
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
