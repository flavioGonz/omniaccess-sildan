import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

// Pattern for Uruguay: AAA 1234
const URUGUAY_PATTERN = /^[A-Z]{3}[0-9]{4}$/;
// Generic Mercosur pattern (e.g. Brazil LLLNLNN)
const MERCOSUR_PATTERN = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
// Argentina: LL NNN LL
const ARGENTINA_PATTERN = /^[A-Z]{2}[0-9]{3}[A-Z]{2}$/;

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("image") as File;

        if (!file) {
            console.error("OCR API: No image in request");
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }


        const buffer = Buffer.from(await file.arrayBuffer());

        // Pre-processing with Sharp for better OCR
        const processedBuffer = await sharp(buffer)
            .greyscale()
            .ensureAlpha(1) // Keep it simple
            .toBuffer();

        // Second pass: higher contrast and thresholding
        const highContrastBuffer = await sharp(processedBuffer)
            .resize(1000, null, { withoutEnlargement: false }) // Upscale a bit
            .linear(1.5, -0.2) // Increase contrast (simulating modulate)
            .threshold(120) // Binarize
            .toBuffer();

        // Tesseract OCR
        const worker = await createWorker('eng', 1);

        await worker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            tessedit_pageseg_mode: 7 as any, // Single line
            tessjs_create_pdf: '0',
            tessjs_create_hocr: '0'
        });

        const { data: { text, confidence } } = await worker.recognize(highContrastBuffer);
        await worker.terminate();

        const cleanedText = text.replace(/[^A-Z0-9]/g, "").toUpperCase();

        // More extensive patterns
        let isMatch = false;
        let bestPlate = "";

        if (URUGUAY_PATTERN.test(cleanedText) || MERCOSUR_PATTERN.test(cleanedText) || ARGENTINA_PATTERN.test(cleanedText)) {
            bestPlate = cleanedText;
            isMatch = true;
        } else if (cleanedText.length >= 6 && confidence > 70) {
            bestPlate = cleanedText;
            isMatch = true;
        }
        if (isMatch) {
            return NextResponse.json({
                success: true,
                plate: bestPlate,
                confidence,
                raw: text
            });
        } else {
            return NextResponse.json({
                success: false,
                error: "No se detectó una matrícula válida",
                detected: cleanedText,
                confidence
            });
        }

    } catch (error: any) {
        console.error("OCR Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
