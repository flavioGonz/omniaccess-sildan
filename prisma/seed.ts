import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Starting database seed...\n')

    // 0. Clean slate
    console.log('🧹 Cleaning existing data...')
    await prisma.accessEvent.deleteMany()
    await prisma.callEvent.deleteMany()
    await prisma.hardwareMirror.deleteMany()
    await prisma.credential.deleteMany()
    await prisma.vehicle.deleteMany()
    await prisma.accessGroup.deleteMany()
    await prisma.parkingSlot.deleteMany()
    await prisma.user.deleteMany()
    await prisma.unit.deleteMany()
    await prisma.topologyNode.deleteMany()
    console.log('✅ Base cleaned\n')

    // 1. Create Admin User
    console.log('👤 Creating admin user...')
    const admin = await prisma.user.create({
        data: {
            name: 'Administrador',
            email: 'admin@secureaccess.com',
            phone: '+54 9 11 1234-5678',
            dni: '12345678',
            role: 'ADMIN',
        }
    })

    await prisma.credential.create({
        data: {
            type: 'PASSWORD',
            value: 'Flavio20',
            userId: admin.id
        }
    })
    console.log(`✅ Admin created: ${admin.email} with password: Flavio20\n`)

    // 2. Create Units
    console.log('🏢 Creating units...')
    const units = await Promise.all([
        prisma.unit.create({
            data: {
                name: 'Torre A',
                number: 'A-101',
                type: 'EDIFICIO',
                floors: 10,
                address: 'Av. Principal 1234',
                deviceCount: 2,
                deviceType: 'BOTH'
            }
        }),
        prisma.unit.create({
            data: {
                name: 'Torre B',
                number: 'B-205',
                type: 'EDIFICIO',
                floors: 10,
                address: 'Av. Principal 1234',
                deviceCount: 1,
                deviceType: 'LPR'
            }
        }),
        prisma.unit.create({
            data: {
                name: 'Casa 1',
                number: 'C-001',
                type: 'CASA',
                address: 'Calle Secundaria 567',
                deviceCount: 1,
                deviceType: 'FACE'
            }
        })
    ])
    console.log(`✅ Created ${units.length} units\n`)

    // 3. Create Residents
    console.log('👥 Creating residents...')
    const residents = await Promise.all([
        prisma.user.create({
            data: {
                name: 'Juan Pérez',
                email: 'juan.perez@email.com',
                phone: '+54 9 11 2345-6789',
                dni: '23456789',
                role: 'RESIDENT',
                unitId: units[0].id
            }
        }),
        prisma.user.create({
            data: {
                name: 'María González',
                email: 'maria.gonzalez@email.com',
                phone: '+54 9 11 3456-7890',
                dni: '34567890',
                role: 'RESIDENT',
                unitId: units[0].id
            }
        }),
        prisma.user.create({
            data: {
                name: 'Carlos Rodríguez',
                email: 'carlos.rodriguez@email.com',
                phone: '+54 9 11 4567-8901',
                dni: '45678901',
                role: 'RESIDENT',
                unitId: units[1].id
            }
        }),
        prisma.user.create({
            data: {
                name: 'Ana Martínez',
                email: 'ana.martinez@email.com',
                phone: '+54 9 11 5678-9012',
                dni: '56789012',
                role: 'RESIDENT',
                unitId: units[2].id
            }
        })
    ])
    console.log(`✅ Created ${residents.length} residents\n`)

    // 4. Create Credentials (Plates)
    console.log('🚗 Creating vehicle credentials...')
    const credentials = await Promise.all([
        prisma.credential.create({
            data: {
                type: 'PLATE',
                value: 'ABC123',
                userId: residents[0].id,
                notes: 'Toyota Corolla Blanco'
            }
        }),
        prisma.credential.create({
            data: {
                type: 'PLATE',
                value: 'XYZ789',
                userId: residents[1].id,
                notes: 'Honda Civic Negro'
            }
        }),
        prisma.credential.create({
            data: {
                type: 'PLATE',
                value: 'DEF456',
                userId: residents[2].id,
                notes: 'Ford Focus Azul'
            }
        }),
        prisma.credential.create({
            data: {
                type: 'TAG',
                value: '1234567890',
                userId: residents[0].id,
                notes: 'Tag RFID Principal'
            }
        })
    ])
    console.log(`✅ Created ${credentials.length} credentials\n`)

    // 5. Create Devices
    console.log('📷 Creating devices...')
    const devices = await Promise.all([
        prisma.device.create({
            data: {
                name: 'LPR Entrada .50',
                brand: 'HIKVISION',
                deviceType: 'LPR_CAMERA',
                ip: '10.10.10.50',
                mac: 'd4:e8:53:9c:7f:24',
                username: 'admin',
                password: 'Hik12345',
                authType: 'DIGEST',
                direction: 'ENTRY'
            }
        }),
        prisma.device.create({
            data: {
                name: 'LPR Salida .51',
                brand: 'HIKVISION',
                deviceType: 'LPR_CAMERA',
                ip: '10.10.10.51',
                mac: 'd4:e8:53:9c:7f:25',
                username: 'admin',
                password: 'Hik12345',
                authType: 'DIGEST',
                direction: 'EXIT'
            }
        }),
        prisma.device.create({
            data: {
                name: 'Terminal Facial .202',
                brand: 'AKUVOX',
                deviceType: 'FACE_TERMINAL',
                ip: '10.10.10.202',
                mac: '00:1a:2b:3c:4d:5e',
                username: 'api',
                password: 'Api*2011',
                authType: 'BASIC',
                direction: 'ENTRY'
            }
        })
    ])
    console.log(`✅ Created ${devices.length} devices\n`)

    // 6. Create Access Groups
    console.log('🔐 Creating access groups...')
    const groups = await Promise.all([
        prisma.accessGroup.create({
            data: {
                name: 'Residentes Torre A',
                users: {
                    connect: [
                        { id: residents[0].id },
                        { id: residents[1].id }
                    ]
                }
            }
        }),
        prisma.accessGroup.create({
            data: {
                name: 'Todos los Residentes',
                users: {
                    connect: residents.map(r => ({ id: r.id }))
                }
            }
        })
    ])
    console.log(`✅ Created ${groups.length} access groups\n`)

    // Summary
    console.log('📊 Seed Summary:')
    console.log(`   • 1 Admin user`)
    console.log(`   • ${units.length} Units`)
    console.log(`   • ${residents.length} Residents`)
    console.log(`   • ${credentials.length} Credentials (${credentials.filter(c => c.type === 'PLATE').length} plates)`)
    console.log(`   • ${devices.length} Devices`)
    console.log(`   • ${groups.length} Access Groups`)
    console.log('\n✨ Database seeded successfully!')
    console.log('\n📝 Note: This system uses email-based authentication.')
    console.log('   You can now add users through the web interface.')
}

main()
    .catch((e) => {
        console.error('❌ Error seeding database:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
