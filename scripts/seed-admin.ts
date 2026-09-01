import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const username = 'fgonzalez'
    const password = 'eElbebe*2011'

    console.log(`Seeding admin user: ${username}`)

    // Create or Update
    const user = await prisma.user.upsert({
        where: {
            // Since name is not unique, we try to find one first or just create.
            // But upsert needs a unique field.
            // We don't have a unique username field.
            // We'll use findFirst/create pattern or just create if not exists using a check.
            id: 'admin-seed-id' // reliable way to upsert if we force an ID
        },
        update: {
            name: username,
            role: 'ADMIN',
        },
        create: {
            id: 'admin-seed-id',
            name: username,
            role: 'ADMIN',
        }
    })

    // Create Credential
    // Delete existing password credential if any
    await prisma.credential.deleteMany({
        where: {
            userId: user.id,
            type: 'PASSWORD'
        }
    })

    await prisma.credential.create({
        data: {
            userId: user.id,
            type: 'PASSWORD',
            value: password
        }
    })

    console.log('Admin user seeded successfully')
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
