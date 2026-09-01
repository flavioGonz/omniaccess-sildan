"use server";

import axios from "axios";
import { prisma } from "@/lib/prisma";

async function getCompareFaceConfig() {
    const [urlSet, keySet] = await Promise.all([
        prisma.setting.findUnique({ where: { key: "COMPAREFACE_URL" } }),
        prisma.setting.findUnique({ where: { key: "COMPAREFACE_KEY" } })
    ]);
    return {
        url: urlSet?.value || process.env.COMPARE_FACE_URL || "https://compareface.infratec.com.uy",
        apiKey: keySet?.value || process.env.COMPAREFACE_API_KEY || ""
    };
}

export async function testCompareFaceConnection() {
    try {
        const { url, apiKey } = await getCompareFaceConfig();
        const response = await axios.get(`${url}/api/v1/recognition/subjects`, {
            headers: { "x-api-key": apiKey },
            timeout: 5000
        });
        return { success: true, subjectsCount: response.data.subjects?.length || 0 };
    } catch (error: any) {
        console.error("CompareFace connection test failed:", error.message);
        return { success: false, error: error.message };
    }
}

export async function getCompareFaceSubjects() {
    try {
        const { url, apiKey } = await getCompareFaceConfig();
        const response = await axios.get(`${url}/api/v1/recognition/subjects`, {
            headers: { "x-api-key": apiKey },
            timeout: 10000
        });

        const subjects = response.data.subjects || [];

        // Enhance subjects with face counts if possible
        // Note: some versions of CompareFace don't provide this in the subject list
        return { success: true, subjects };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deleteCompareFaceSubject(subject: string) {
    try {
        const { url, apiKey } = await getCompareFaceConfig();
        await axios.delete(`${url}/api/v1/recognition/subjects/${encodeURIComponent(subject)}`, {
            headers: { "x-api-key": apiKey },
            timeout: 10000
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function clearAllVisitorFaces() {
    const targets = [
        { url: (await getCompareFaceConfig()).url, key: "d7bdb468-26af-4306-b35d-499e5373ac4a" },
        ...(process.env.FACE_ENGINE_2_URL ? [{ url: process.env.FACE_ENGINE_2_URL, key: process.env.FACE_ENGINE_2_KEY || "" }] : [])
    ];

    let totalDeleted = 0;
    const errors: string[] = [];

    for (const target of targets) {
        try {
            const response = await axios.get(`${target.url}/api/v1/recognition/subjects`, {
                headers: { "x-api-key": target.key },
                timeout: 5000
            });

            const subjects = response.data.subjects || [];

            if (subjects.length > 0) {
                const chunkSize = 5;
                for (let i = 0; i < subjects.length; i += chunkSize) {
                    const chunk = subjects.slice(i, i + chunkSize);
                    await Promise.all(chunk.map((subject: string) =>
                        axios.delete(`${target.url}/api/v1/recognition/subjects/${encodeURIComponent(subject)}`, {
                            headers: { "x-api-key": target.key },
                            timeout: 10000
                        }).catch(e => console.error(`Failed to delete ${subject} at ${target.url}`, e.message))
                    ));
                }
                totalDeleted += subjects.length;
            }
        } catch (error: any) {
            console.error(`Error clearing visitors at ${target.url}:`, error.message);
            // We don't stop, we try the next target
            errors.push(`${target.url}: ${error.message}`);
        }
    }

    if (totalDeleted === 0 && errors.length > 0) {
        return { success: false, error: errors.join("; ") };
    }

    return { success: true, count: totalDeleted, message: `Cleared ${totalDeleted} visitors across ${targets.length} targets.` };
}
