
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
    console.log("DATABASE_URL no está definida en .env");
} else {
    // Ocultar contraseña para seguridad
    const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
    console.log(`DATABASE_URL actual: ${maskedUrl}`);
}
