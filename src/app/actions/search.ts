"use server";
/* eslint-disable */

import { prisma } from "@/lib/prisma";

export async function searchUsers(query: string) {
    if (!query || query.length < 2) return [];

    try {
        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { dni: { contains: query, mode: 'insensitive' } },
                    { vehicles: { some: { plate: { contains: query, mode: 'insensitive' } } } }
                ]
            },
            include: {
                unit: { select: { name: true } },
                vehicles: { select: { plate: true, brand: true, model: true } }
            },
            take: 5
        });

        return users.map(u => ({
            id: u.id,
            name: u.name,
            dni: u.dni,
            unit: u.unit?.name,
            phone: u.phone,
            vehicles: u.vehicles
        }));
    } catch (error) {
        console.error("Error searching users:", error);
        return [];
    }
}
