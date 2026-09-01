"use server";

import { revalidatePath } from "next/cache";
import fs from "fs/promises";
import path from "path";

const MODELS_FILE_PATH = path.join(process.cwd(), "src", "lib", "driver-models.ts");

export async function addDeviceModel(brand: string, model: { value: string; label: string; category: string; photo: string }) {
    try {
        // Read current file
        const fileContent = await fs.readFile(MODELS_FILE_PATH, "utf-8");

        // Find the brand section and add the model
        const brandKey = brand.toUpperCase();
        const regex = new RegExp(`(${brandKey}:\\s*\\[)([\\s\\S]*?)(\\])`, "m");

        const match = fileContent.match(regex);
        if (!match) {
            throw new Error(`Brand ${brand} not found in driver-models.ts`);
        }

        const existingModels = match[2];
        const newModelString = `\n        { value: "${model.value}", label: "${model.label}", category: "${model.category}", photo: "${model.photo}" },`;

        const updatedContent = fileContent.replace(
            regex,
            `$1${existingModels}${newModelString}\n    $3`
        );

        await fs.writeFile(MODELS_FILE_PATH, updatedContent, "utf-8");
        revalidatePath("/admin/settings");

        return { success: true };
    } catch (error) {
        console.error("Error adding device model:", error);
        return { success: false, error: (error as Error).message };
    }
}

export async function deleteDeviceModel(brand: string, modelValue: string) {
    try {
        const fileContent = await fs.readFile(MODELS_FILE_PATH, "utf-8");

        // Remove the model line
        const modelRegex = new RegExp(`\\s*\\{\\s*value:\\s*"${modelValue}"[^}]*\\},?\\n?`, "gm");
        const updatedContent = fileContent.replace(modelRegex, "");

        await fs.writeFile(MODELS_FILE_PATH, updatedContent, "utf-8");
        revalidatePath("/admin/settings");

        return { success: true };
    } catch (error) {
        console.error("Error deleting device model:", error);
        return { success: false, error: (error as Error).message };
    }
}

export async function updateDeviceModel(
    brand: string,
    originalValue: string,
    model: { value: string; label: string; category: string; photo: string }
) {
    try {
        const fileContent = await fs.readFile(MODELS_FILE_PATH, "utf-8");

        // Find and replace the specific model
        // Match the model with the original value
        const modelRegex = new RegExp(
            `(\\{\\s*value:\\s*"${originalValue}",\\s*label:\\s*")[^"]*(",\\s*category:\\s*")[^"]*(",\\s*photo:\\s*")[^"]*("\\s*\\})`,
            "gm"
        );

        const updatedContent = fileContent.replace(
            modelRegex,
            `{ value: "${model.value}", label: "${model.label}", category: "${model.category}", photo: "${model.photo}" }`
        );

        if (updatedContent === fileContent) {
            throw new Error(`Model with value "${originalValue}" not found`);
        }

        await fs.writeFile(MODELS_FILE_PATH, updatedContent, "utf-8");
        revalidatePath("/admin/settings");

        return { success: true };
    } catch (error) {
        console.error("Error updating device model:", error);
        return { success: false, error: (error as Error).message };
    }
}
