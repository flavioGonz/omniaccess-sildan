"use server";

import axios from "axios";
import NodeFormData from "form-data";
import { prisma } from "@/lib/prisma";
import { getCompreFace, invalidarConfigRostros } from "@/lib/compareface";

// Config del motor: fuente única en lib/compareface.ts (Settings).
async function getCompareFaceConfig() {
    const { url, recoKey } = await getCompreFace();
    return { url, apiKey: recoKey };
}

// Umbral de similitud (0..1) sobre el que un match cuenta como identidad.
// Medido en el lab: ~0.89 deja separados los impostores. Configurable acá.
const CLAVE_UMBRAL = "FACE_UMBRAL";
const UMBRAL_POR_DEFECTO = 0.89;

export async function getFaceUmbral(): Promise<number> {
    const s = await prisma.setting.findUnique({ where: { key: CLAVE_UMBRAL } });
    const v = s ? parseFloat(s.value) : NaN;
    return Number.isFinite(v) ? v : UMBRAL_POR_DEFECTO;
}

export async function setFaceUmbral(valor: number) {
    // Acotar a un rango sano: por debajo de 0.5 el motor empieza a confundir personas.
    const v = Math.min(0.99, Math.max(0.5, valor));
    await prisma.setting.upsert({
        where: { key: CLAVE_UMBRAL },
        update: { value: String(v) },
        create: { key: CLAVE_UMBRAL, value: String(v) }
    });
    return { success: true, value: v };
}

// Probar el motor: subir una foto y ver qué reconoce, sin tocar la base de usuarios.
// Devuelve, por cada cara, el mejor match y su similitud (para comparar contra el umbral).
export async function recognizeTestAction(formData: FormData) {
    try {
        const file = formData.get("photo") as File | null;
        if (!file || file.size === 0) return { success: false, error: "Falta la foto" };
        const buf = Buffer.from(await file.arrayBuffer());
        const { url, recoKey } = await getCompreFace();

        const form = new NodeFormData();
        form.append("file", buf, { filename: "test.jpg", contentType: file.type || "image/jpeg" });
        const res = await axios.post(
            `${url}/api/v1/recognition/recognize?det_prob_threshold=0.7&prediction_count=3`,
            form,
            { headers: { ...form.getHeaders(), "x-api-key": recoKey }, timeout: 12000 }
        );
        const result = res.data.result || [];
        const caras = result.map((f: any) => ({
            box: f.box || null,
            matches: (f.subjects || []).map((s: any) => ({ subject: s.subject, similarity: s.similarity }))
        }));
        return { success: true, caras };
    } catch (error: any) {
        return { success: false, error: error.response?.data?.message || error.message || "Motor no disponible" };
    }
}

// Releer la config del motor tras cambiarla en los Settings.
export async function refrescarConfigRostros() {
    invalidarConfigRostros();
    return { success: true };
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
        { url: (await getCompareFaceConfig()).url, key: (await getCompareFaceConfig()).apiKey },
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
