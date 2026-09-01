import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import path from "path";
import fs from "fs/promises";

import { uploadToS3 } from "@/lib/s3";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const userId = params.id;

  if (!userId) {
    return NextResponse.json({ error: "User ID is required" }, { status: 400 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("faceImage") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `face_${userId}_${Date.now()}${path.extname(file.name) || ".jpg"}`;

    const fileUrl = await uploadToS3(buffer, filename, file.type || "image/jpeg", "face");

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { cara: fileUrl },
    });

    revalidatePath("/admin/users");

    return NextResponse.json(updatedUser);

  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
