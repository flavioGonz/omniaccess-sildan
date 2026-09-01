const { PrismaClient } = require("@prisma/client");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

async function main() {
    const p = new PrismaClient();
    
    // Check bcrypt
    let bcryptLib = null;
    try { bcryptLib = require("bcrypt"); console.log("bcrypt: native"); } catch(e) {
        try { bcryptLib = require("bcryptjs"); console.log("bcrypt: bcryptjs"); } catch(e2) {
            console.log("bcrypt: NONE");
        }
    }
    
    // Check passwords
    const creds = await p.credential.findMany({
        where: { type: { in: ["PASSWORD", "PIN"] } },
        select: { id: true, type: true, value: true, userId: true }
    });
    console.log("Password credentials:", JSON.stringify(creds, null, 2));
    
    // Check admin users
    const admins = await p.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true, name: true, role: true }
    });
    console.log("Admin users:", JSON.stringify(admins, null, 2));
    
    await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
