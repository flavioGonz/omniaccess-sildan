import { prisma } from "../src/lib/prisma";
import axios from "axios";

const VISITORS_API_KEY = "d7bdb468-26af-4306-b35d-499e5373ac4a";
const COMPEREFACE_URL = "https://compareface.infratec.com.uy";

async function clearVisitors() {
    console.log("--- STARTING VISITORS CLEARANCE ---");

    try {
        console.log("[DB] Finding visitors in Database...");
        const visitorUsers = await prisma.user.findMany({
            where: {
                role: { in: ["VISITOR", "TEMPORARY_VISITOR"] }
            },
            select: { id: true, name: true }
        });

        console.log(`[DB] Found ${visitorUsers.length} visitors to delete.`);

        let count = 0;
        for (const visitor of visitorUsers) {
            count++;
            console.log(`[${count}/${visitorUsers.length}] Removing visitor: ${visitor.name}`);

            try {
                // Remove from CompareFace, ignore errors if it doesn't exist
                await axios.delete(`${COMPEREFACE_URL}/api/v1/recognition/subjects/${encodeURIComponent(visitor.name)}`, {
                    headers: { "x-api-key": VISITORS_API_KEY },
                    timeout: 4000
                }).catch(() => { });

                // Clear from Database
                await prisma.credential.deleteMany({ where: { userId: visitor.id } });
                await prisma.user.delete({ where: { id: visitor.id } });

            } catch (err: any) {
                console.error(`Error deleting DB user ${visitor.name}`);
            }
        }

        console.log("--- VISITORS CLEARANCE COMPLETE ---");
    } catch (error: any) {
        console.error("Error during clearance:", error.message);
    }
}

clearVisitors();
