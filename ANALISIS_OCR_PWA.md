# Análisis del Problema OCR en PWA
**Fecha**: 11 de febrero de 2026
**Afecta a**: `/guard` y `/guard-iphone`

## 🔴 Problema Reportado
El OCR Scanner no logra leer las matrículas. La cámara muestra "Procesando...", luego "Listo", pero nunca extrae el texto de la foto.

## 🔍 Diagnóstico Técnico

### Arquitectura Actual
```
[Cliente PWA] → Captura Foto → Convierte a Blob → 
POST /api/ocr → [Servidor Next.js] → Tesseract.js → Respuesta
```

### Componentes Involucrados
1. **Cliente**: `src/components/OCRScanner.tsx` y `GuardIphoneConsole.tsx`
2. **API**: `src/app/api/ocr/route.ts`
3. **Motor OCR**: Tesseract.js (v5.x)

### Flujo de Ejecución
1. Usuario captura foto con cámara del dispositivo
2. Canvas convierte imagen a JPEG (calidad 0.6)
3. Se envía FormData con la imagen al endpoint `/api/ocr`
4. Servidor procesa con Tesseract usando parámetros optimizados
5. Devuelve texto detectado

## ⚠️ Problemas Identificados

### 1. **Limitaciones de Tesseract.js en Navegador**
- ❌ Tesseract.js **NO se ejecuta en el cliente** en esta implementación
- ✅ Se ejecuta en el **servidor Next.js** (correcto)
- ⚠️ El servidor puede tener problemas de memoria/CPU con imágenes grandes

### 2. **Calidad de Imagen**
```typescript
// Actual: JPEG quality 0.6
canvas.toBlob(async (blob) => { ... }, 'image/jpeg', 0.6);
```
- Calidad reducida para optimizar velocidad
- Puede afectar precisión del OCR
- Matrículas necesitan **alta resolución** para lectura confiable

### 3. **Configuración de Tesseract**
```typescript
await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    tessedit_pageseg_mode: '7', // Single line
    preserve_interword_spaces: '0'
});
```
- Configuración correcta para matrículas
- Pero puede fallar si la imagen tiene:
  - Baja iluminación
  - Ángulo incorrecto
  - Resolución insuficiente
  - Distorsión por movimiento

### 4. **Timeout y Manejo de Errores**
```typescript
// Cliente: 6 segundos timeout
const controller = new AbortController();
setTimeout(() => controller.abort(), 6000);

// Servidor: Sin timeout explícito
```
- El cliente aborta después de 6s
- El servidor puede seguir procesando
- No hay logs detallados del error

## 🧪 Pruebas Realizadas (Historial)

### Optimizaciones Previas
1. ✅ Reducción de calidad JPEG a 0.6
2. ✅ Timeout de 6 segundos en cliente
3. ✅ Safety interval de 8 segundos para reset UI
4. ✅ Parámetros optimizados de Tesseract
5. ✅ Logs detallados en servidor

### Resultados
- ⚠️ La UI no se congela (mejorado)
- ❌ El OCR sigue sin detectar texto confiablemente

## 🎯 Causas Probables

### Causa #1: Calidad de Imagen Insuficiente
**Probabilidad**: 🔴 ALTA
- JPEG 0.6 puede ser muy bajo para OCR
- Matrículas necesitan nitidez
- **Solución**: Aumentar calidad a 0.85-0.95

### Causa #2: Preprocesamiento Faltante
**Probabilidad**: 🔴 ALTA
- Tesseract funciona mejor con imágenes preprocesadas
- Falta:
  - Conversión a escala de grises
  - Ajuste de contraste
  - Binarización (threshold)
  - Recorte del área de interés
- **Solución**: Agregar Sharp.js en servidor para preprocesar

### Causa #3: Modelo de Tesseract Incorrecto
**Probabilidad**: 🟡 MEDIA
- Tesseract tiene múltiples modelos (eng, spa, etc.)
- Matrículas pueden necesitar modelo específico
- **Solución**: Probar con `eng` + `best` traineddata

### Causa #4: Limitaciones de PWA
**Probabilidad**: 🟢 BAJA
- Las PWAs SÍ pueden hacer OCR
- El problema está en la implementación, no en la tecnología
- Tesseract.js funciona en servidor Node.js

## 📋 Plan de Reparación

### Fase 1: Diagnóstico Inmediato ⚡
```bash
# 1. Verificar logs del servidor cuando se usa OCR
pm2 logs --lines 100 | grep "OCR"

# 2. Probar con imagen de prueba
curl -X POST http://localhost:3000/api/ocr \
  -F "image=@test-plate.jpg"
```

### Fase 2: Mejoras Rápidas 🔧
1. **Aumentar calidad de imagen**
   ```typescript
   canvas.toBlob(async (blob) => { ... }, 'image/jpeg', 0.95);
   ```

2. **Agregar preprocesamiento con Sharp**
   ```typescript
   import sharp from 'sharp';
   
   const processed = await sharp(buffer)
       .greyscale()
       .normalize()
       .threshold(128)
       .toBuffer();
   ```

3. **Mejorar logs**
   ```typescript
   console.log('[OCR] Image size:', buffer.length);
   console.log('[OCR] Tesseract result:', result.data.text);
   console.log('[OCR] Confidence:', result.data.confidence);
   ```

### Fase 3: Solución Robusta 🚀
1. **Implementar servicio OCR dedicado**
   - Usar API externa (Google Vision, AWS Textract)
   - O mantener Tesseract con preprocesamiento avanzado

2. **Agregar guías visuales**
   - Overlay en cámara para alinear matrícula
   - Feedback en tiempo real de calidad de imagen

3. **Fallback manual**
   - Si OCR falla, permitir entrada manual
   - Guardar imagen para análisis posterior

## 🔬 Pruebas Recomendadas

### Test 1: Calidad de Imagen
```typescript
// Probar con diferentes calidades
[0.6, 0.8, 0.95, 1.0].forEach(quality => {
    canvas.toBlob(blob => testOCR(blob), 'image/jpeg', quality);
});
```

### Test 2: Preprocesamiento
```typescript
// Comparar con/sin preprocesamiento
const raw = await tesseract(originalImage);
const processed = await tesseract(preprocessedImage);
console.log('Raw:', raw.text, 'Processed:', processed.text);
```

### Test 3: Diferentes Condiciones
- ✅ Matrícula frontal, buena luz
- ✅ Matrícula con ángulo
- ✅ Matrícula con poca luz
- ✅ Matrícula en movimiento (borrosa)

## 💡 Recomendaciones Finales

### Opción A: Mejorar Tesseract (Corto Plazo)
**Esfuerzo**: Medio | **Costo**: $0 | **Confiabilidad**: 70%
1. Aumentar calidad JPEG a 0.95
2. Agregar Sharp para preprocesamiento
3. Mejorar logs y debugging
4. Agregar guías visuales

### Opción B: API Externa (Largo Plazo)
**Esfuerzo**: Bajo | **Costo**: $$ | **Confiabilidad**: 95%
1. Google Cloud Vision API
2. AWS Textract
3. Azure Computer Vision
4. Ventaja: Mejor precisión, menos mantenimiento

### Opción C: Híbrida (Recomendada)
**Esfuerzo**: Medio | **Costo**: $ | **Confiabilidad**: 85%
1. Tesseract como primario (gratis)
2. API externa como fallback
3. Entrada manual como última opción
4. Guardar imágenes fallidas para entrenamiento

## 📊 Métricas de Éxito
- ✅ Tasa de detección > 80%
- ✅ Tiempo de respuesta < 3 segundos
- ✅ Confianza promedio > 70%
- ✅ Tasa de error < 10%

---

**Estado Actual**: 🔴 NO FUNCIONAL
**Próximo Paso**: Implementar Fase 2 (Mejoras Rápidas)
