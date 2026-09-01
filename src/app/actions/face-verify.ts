"use server";

import { prisma } from "@/lib/prisma";
import axios from "axios";
import FormData from "form-data";
import { getImagePath } from "@/lib/image-path";
import { getSetting } from "@/app/actions/settings";
import { revalidatePath } from "next/cache";

const COMPARE_FACE_URL = process.env.COMPARE_FACE_URL || "https://compareface.infratec.com.uy";

const API_KEYS = {
    RECO: "a0986800-8c5b-4583-9146-49281cf02e53",
    DETECT: "3e92c632-8770-4d37-a615-18b0f7ea30bf",
    VERIFY: "60bfa16a-efb9-4c71-8dd2-4264e8965a96",
    VISITORS: "d7bdb468-26af-4306-b35d-499e5373ac4a"
};

export async function verifyFaceAction(
    eventSnapshot: string,
    userId?: string,
    nativeName?: string,
    providedBuffer?: Buffer
) {
    if (!eventSnapshot && !providedBuffer) {
        return { success: false, error: "Missing data" };
    }

    const start = Date.now();

    try {
        let finalSubject = null;
        let dbUser = null;

        // TRUST CAMERA HARDWARE EXACT MATCH ONLY
        const cameraNameMatch = nativeName || eventSnapshot.match(/Persona:\s*([^,|]+)/)?.[1]?.trim();
        const cameraConfidenceMatch = eventSnapshot.match(/Confianza:\s*(\d+)%/);
        const nativeConfidence = cameraConfidenceMatch ? parseInt(cameraConfidenceMatch[1]) : 0;

        // Ensure it has a valid name and is NOT generically unknown
        const hasGoodCameraData = cameraNameMatch && !['Desconocido', 'N/A', 'Persona'].some(s => cameraNameMatch.includes(s));

        if (hasGoodCameraData) {
            finalSubject = cameraNameMatch;

            // Look up the identified person in our DB to fetch their Unit, blacklist role, etc.
            dbUser = await prisma.user.findFirst({
                where: { name: { equals: finalSubject, mode: 'insensitive' } },
                include: { unit: true }
            });
        }

        const isVerified = !!(finalSubject);
        const alertTriggered = dbUser?.role === 'BLACKLISTED' && isVerified;

        // Update the event with the DB User ID if we found a match locally
        if (finalSubject && dbUser && eventSnapshot) {
            try {
                const eventToUpdate = await prisma.accessEvent.findFirst({
                    where: { snapshotPath: eventSnapshot },
                    orderBy: { timestamp: 'desc' }
                });
                if (eventToUpdate && !eventToUpdate.userId) {
                    await prisma.accessEvent.update({
                        where: { id: eventToUpdate.id },
                        data: {
                            userId: dbUser.id
                        }
                    });
                }
            } catch (dbErr) { console.warn("DB update delay", dbErr); }
        }


        revalidatePath("/admin/dashboard-face");
        revalidatePath("/admin/history");

        return {
            success: true,
            verified: isVerified,
            similarity: nativeConfidence / 100, // Use the camera's confidence metric
            recognizedAs: finalSubject || 'Desconocido',
            user: dbUser,
            box: null, // No box mapping without deep neural logic
            collection: 'Camera',
            lowConfidence: nativeConfidence < 85,
            alertTriggered: !!alertTriggered,
            duration: Date.now() - start
        };

    } catch (error: any) {
        console.error("Critical error in native verifyFaceAction:", error.message);
        return { success: false, error: "System failure", details: error.message };
    }
}

export async function searchByPhotoAction(photoData: Uint8Array | Buffer) {
    const photoBuffer = Buffer.from(photoData);
    const start = Date.now();

    try {

        const search = async (apiKey: string) => {
            const form = new FormData();
            form.append('file', photoBuffer, { filename: 'search.jpg', contentType: 'image/jpeg' });
            return axios.post(`${COMPARE_FACE_URL}/api/v1/recognition/recognize`, form, {
                headers: { ...form.getHeaders(), "x-api-key": apiKey },
                timeout: 8000 // Faster timeout for guard live feedback
            });
        };

        const results = await Promise.allSettled([
            search(API_KEYS.RECO),
            search(API_KEYS.VISITORS)
        ]);

        let bestMatch: any = null;
        let usedCollection = 'None';

        results.forEach((res, idx) => {
            if (res.status === 'fulfilled' && res.value.data.result) {
                const faces = res.value.data.result;
                for (const face of faces) {
                    if (face.subjects && face.subjects.length > 0) {
                        const top = face.subjects[0];
                        if (!bestMatch || top.similarity > bestMatch.similarity) {
                            bestMatch = top;
                            usedCollection = idx === 0 ? 'Residents' : 'Visitors';
                        }
                    }
                }
            }
        });

        if (!bestMatch) {
            return { success: true, match: null, user: null, duration: Date.now() - start };
        }

        const user = await prisma.user.findFirst({
            where: { name: { equals: bestMatch.subject, mode: 'insensitive' } },
            include: { unit: true }
        });

        return {
            success: true,
            match: bestMatch,
            user: user,
            collection: usedCollection,
            duration: Date.now() - start
        };
    } catch (error: any) {
        console.error("[Guard Search] Error:", error.response?.data || error.message);
        return { success: false, error: error.message || "Motor biometría no disponible" };
    }
}


export async function registerFaceInCompereFace(subjectName: string, photoBuffer: Buffer, apiKey?: string) {
    try {
        const actualKey = apiKey || API_KEYS.RECO;

        // Limit check: Don't over-train if profile already robust
        const countRes = await axios.get(`${COMPARE_FACE_URL}/api/v1/recognition/faces?subject=${encodeURIComponent(subjectName)}`, {
            headers: { "x-api-key": actualKey }, timeout: 5000
        }).catch(() => ({ data: { faces: new Array(100) } })); // If error, assume full

        if ((countRes.data.faces || []).length >= 15) {
            return { success: true, message: "Profile already robust" };
        }

        const form = new FormData();
        form.append('file', photoBuffer, { filename: 'subject.jpg', contentType: 'image/jpeg' });
        const url = `${COMPARE_FACE_URL}/api/v1/recognition/faces?subject=${encodeURIComponent(subjectName)}`;
        const response = await axios.post(url, form, {
            headers: { ...form.getHeaders(), "x-api-key": actualKey },
            timeout: 10000
        });
        return { success: true, data: response.data };
    } catch (error: any) {
        return { success: false, error: "Registration service error" };
    }
}

export async function detectFaceAction(photoData: Uint8Array | Buffer) {
    const photoBuffer = Buffer.from(photoData);
    try {
        const form = new FormData();
        form.append('file', photoBuffer, { filename: 'detect.jpg', contentType: 'image/jpeg' });
        const response = await axios.post(`${COMPARE_FACE_URL}/api/v1/detection/detect`, form, {
            headers: { ...form.getHeaders(), "x-api-key": API_KEYS.DETECT },
            timeout: 10000
        });
        return { success: true, faces: response.data.result || [] };
    } catch (error: any) {
        return { success: false, error: "Detection service error" };
    }
}

export async function verifyIdentityAction(sourcePhoto: Buffer, targetPhoto: Buffer) {
    try {
        const form = new FormData();
        form.append('source_image', sourcePhoto, { filename: 'source.jpg', contentType: 'image/jpeg' });
        form.append('target_image', targetPhoto, { filename: 'target.jpg', contentType: 'image/jpeg' });
        const response = await axios.post(`${COMPARE_FACE_URL}/api/v1/verification/verify`, form, {
            headers: { ...form.getHeaders(), "x-api-key": API_KEYS.VERIFY },
            timeout: 15000
        });
        const result = response.data.result?.[0];
        return { success: true, verified: (result?.similarity || 0) > 0.8, similarity: result?.similarity || 0 };
    } catch (error: any) {
        return { success: false, error: "Verification service error" };
    }
}

export async function purgeSubjectFacesAction(subjectName: string, useVisitors = false) {
    try {
        const apiKey = useVisitors ? API_KEYS.VISITORS : API_KEYS.RECO;
        await axios.delete(`${COMPARE_FACE_URL}/api/v1/recognition/faces?subject=${encodeURIComponent(subjectName)}`, {
            headers: { "x-api-key": apiKey }, timeout: 10000
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: "Cleanup service error" };
    }
}
