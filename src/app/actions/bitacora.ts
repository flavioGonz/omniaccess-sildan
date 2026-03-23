"use server";

import { prisma } from "@/lib/prisma";
import { uploadToS3 } from "@/lib/s3";
import { revalidatePath } from "next/cache";

export async function createBitacoraEntry(formData: FormData) {
    const type = formData.get("type") as string; // ENTRY or EXIT
    const plate = formData.get("plate") as string;
    const notes = formData.get("notes") as string;
    const name = formData.get("name") as string;
    const dni = formData.get("dni") as string;
    const company = formData.get("company") as string;
    const destination = formData.get("destination") as string;
    const guardName = formData.get("guardName") as string;
    const latitude = formData.get("latitude") ? parseFloat(formData.get("latitude") as string) : null;
    const longitude = formData.get("longitude") ? parseFloat(formData.get("longitude") as string) : null;
    const photo = formData.get("photo") as File;
    const audio = formData.get("audio") as File;

    let photoPath = "";
    if (photo && photo.size > 0) {
        const buffer = Buffer.from(await photo.arrayBuffer());
        const timestamp = Date.now();
        const cleanPlate = plate ? plate.toUpperCase().replace(/[^A-Z0-9]/g, "") : "unknown";
        const filename = `bitacora-${type.toLowerCase()}-${cleanPlate}-${timestamp}.jpg`;
        photoPath = await uploadToS3(buffer, filename, photo.type || "image/jpeg", "lpr");
    }

    let audioPath = "";
    if (audio && audio.size > 0) {
        const buffer = Buffer.from(await audio.arrayBuffer());
        const timestamp = Date.now();
        const cleanPlate = plate ? plate.toUpperCase().replace(/[^A-Z0-9]/g, "") : "unknown";
        const filename = `audio-bitacora-${cleanPlate}-${timestamp}.webm`;
        audioPath = await uploadToS3(buffer, filename, audio.type || "audio/webm", "lpr");
    }

    const entry = await prisma.bitacora.create({
        data: {
            type,
            plate: plate || null,
            notes: notes || null,
            name: name || null,
            dni: dni || null,
            company: company || null,
            destination: destination || null,
            guardName: guardName || null,
            photoPath: photoPath || null,
            audioPath: audioPath || null,
            latitude,
            longitude,
            timestamp: new Date(),
        }
    });

    // Strategy to link with LPR event:
    // When an AccessEvent is created in the webhook, it should look for the latest Bitacora entry 
    // that doesn't have an accessEventId and link it if it's within a 30-second window.

    revalidatePath("/admin/bitacora");
    revalidatePath("/admin/history");
    return entry;
}

export async function getBitacoraEntries() {
    return await prisma.bitacora.findMany({
        orderBy: { timestamp: 'desc' },
        include: {
            accessEvent: {
                include: {
                    user: true,
                    device: true
                }
            }
        },
        take: 50
    });
}

export async function getBitacoraPage(page: number = 0, pageSize: number = 20, query: string = "") {
    const skip = page * pageSize;
    const where = query ? {
        OR: [
            { plate: { contains: query, mode: 'insensitive' as any } },
            { name: { contains: query, mode: 'insensitive' as any } },
            { destination: { contains: query, mode: 'insensitive' as any } },
        ]
    } : {};

    return await prisma.bitacora.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        include: {
            accessEvent: {
                include: {
                    user: true,
                    device: true
                }
            }
        },
        skip,
        take: pageSize
    });
}

export async function deleteBitacoraEntry(id: string) {
    await prisma.bitacora.delete({
        where: { id }
    });
    revalidatePath("/admin/bitacora");
}

export async function searchRecentBitacora(query: string) {
    if (!query || query.length < 3) return [];
    
    return await prisma.bitacora.findMany({
        where: {
            OR: [
                { plate: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } },
                { dni: { contains: query, mode: 'insensitive' } },
                { destination: { contains: query, mode: 'insensitive' } },
            ]
        },
        orderBy: { timestamp: 'desc' },
        take: 5
    });
}

export async function getBitacoraForReport(from: Date, to: Date, query: string = "", guardName: string = "") {
    const where: any = {
        timestamp: {
            gte: from,
            lte: to
        }
    };

    if (query) {
        const queryFilter = [
            { plate: { contains: query, mode: 'insensitive' as any } },
            { name: { contains: query, mode: 'insensitive' as any } },
            { dni: { contains: query, mode: 'insensitive' as any } },
            { destination: { contains: query, mode: 'insensitive' as any } },
            { notes: { contains: query, mode: 'insensitive' as any } },
        ];
        
        if (where.OR) {
             // If we already have OR (unlikely here but for safety)
        } else {
            where.OR = queryFilter;
        }
    }

    if (guardName && guardName !== "ALL") {
        where.guardName = guardName;
    }

    return await prisma.bitacora.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        include: {
            accessEvent: {
                include: {
                    user: true,
                    device: true
                }
            }
        }
    });
}

export async function getBitacoraGuards() {
    try {
        const entries = await prisma.bitacora.findMany({
            where: {
                guardName: { not: null }
            },
            select: {
                guardName: true
            },
            distinct: ['guardName']
        });
        return entries.map(e => e.guardName).filter(Boolean) as string[];
    } catch (error) {
        console.error("Error fetching guards:", error);
        return [];
    }
}
