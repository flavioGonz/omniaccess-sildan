# Análisis de Problemas LPR - 29/12/2025

## 1. Error de Claves Duplicadas en VehicleList ✅ RESUELTO

**Problema:** Console error indicando claves duplicadas en el componente VehicleList
**Causa:** La query de Prisma podría estar retornando registros duplicados
**Solución:** Añadido `distinct: ['id']` a la query de vehículos en `vehicles.ts`

## 2. Diferencia Cámara vs App BBDD (676 vs 673)

**Análisis:**
- Cámara reporta: 676 matrículas
- App BBDD tiene: 673 matrículas
- Diferencia: 3 matrículas

**Posibles causas:**
1. **Matrículas inválidas filtradas**: El sistema filtra matrículas con menos de 3 caracteres o caracteres especiales
2. **Timing de sincronización**: Si se añadieron 3 matrículas a la cámara después de la última importación
3. **Normalización**: Algunas matrículas pueden tener formato diferente (espacios, guiones) que al normalizarse se convierten en duplicados

**Recomendación:** 
- Usar el filtro naranja (🔶) en el Control LPR para ver exactamente cuáles son esas 3 matrículas
- Verificar si son matrículas válidas o registros de prueba

## 3. Logo del Auto No Figura en la Lista

**Estado actual:**
- El código en `VehicleList.tsx` (líneas 175-183) SÍ muestra logos
- Usa la función `getCarLogo()` de `car-logos.ts`
- Tiene fallback a icono genérico de auto

**Verificación necesaria:**
- Los vehículos deben tener el campo `brand` correctamente guardado
- El nombre de la marca debe coincidir con los aliases en `BRAND_ALIASES`
- Ejemplo: "MITSUBISHI" → debe estar en mayúsculas o coincidir con alias

**Marcas soportadas actualmente:**
- Códigos numéricos: 1101 (Land Rover), 1028 (Audi), 1775 (Isuzu), 1128 (Mitsubishi), 1108 (Maserati), 1849 (Mini)
- Nombres: VW, MB, BMW, CHEVY, FORD, FIAT, TOYOTA, HONDA, HYUNDAI, KIA, NISSAN, PEUGEOT, RENAULT, etc.

## 4. Colores Capturados - Solo Plateado y Blanco

**Mapeo actual en `hikvision-codes.js`:**
```javascript
const HIKVISION_VEHICLE_COLORS = {
    0: 'Desconocido',
    1: 'Blanco',
    2: 'Plateado',
    3: 'Gris',
    4: 'Negro',
    5: 'Rojo',
    6: 'Azul Oscuro',
    7: 'Azul',
    8: 'Amarillo',
    9: 'Verde',
    10: 'Marrón',
    11: 'Rosa',
    12: 'Púrpura',
    13: 'Púrpura Oscuro',
    14: 'Cian'
}
```

**El sistema PUEDE reconocer 15 colores diferentes**

**Problema identificado:**
La cámara Hikvision está enviando SOLO códigos 1 (Blanco) y 2 (Plateado) en los eventos.

**Campos que se buscan en el XML (server.js líneas 283-286):**
```javascript
const colorCode = vehicleInfo.colorDepth ||
    vehicleInfo.vehicleColor ||
    xmlData.ANPR?.vehicleColor ||
    eventAlert.ANPR?.vehicleColor;
```

**Posibles causas:**
1. **Configuración de la cámara**: La cámara puede tener deshabilitada la detección avanzada de colores
2. **Iluminación**: En condiciones de poca luz, la cámara simplifica los colores a blanco/plateado/gris
3. **Modelo de cámara**: Algunos modelos Hikvision tienen detección de color limitada
4. **Firmware**: Versiones antiguas pueden no soportar todos los colores

**Logs de debug activos:**
El servidor ya tiene logs detallados (líneas 320-330) que muestran:
- `vehicleInfo object`
- `colorCode` capturado
- `color` traducido

**Próximos pasos para diagnóstico:**
1. Revisar los logs del servidor webhook cuando llegue un evento
2. Verificar qué código de color está enviando la cámara
3. Si siempre envía 1 o 2, revisar configuración de la cámara en su interfaz web
4. Posiblemente necesite habilitar "Detección Avanzada de Atributos de Vehículo" en la configuración de ANPR

**Ruta de configuración típica en Hikvision:**
Configuration → Traffic → ANPR → Advanced Settings → Vehicle Attribute Detection

## Resumen de Acciones

✅ **Completado:**
- Error de claves duplicadas corregido

🔍 **Requiere verificación del usuario:**
- Usar filtro naranja para identificar las 3 matrículas faltantes
- Verificar que los vehículos tengan el campo `brand` guardado correctamente
- Revisar logs del webhook para ver códigos de color reales
- Revisar configuración de la cámara Hikvision para habilitar detección completa de colores

📋 **Documentación de referencia:**
- Hikvision ANPR API: Soporta 15 colores diferentes
- Sistema actual: Configurado para reconocer todos los colores
- Limitación: La cámara física solo está enviando 2 códigos de color
