"use server";

import { cloudinary } from "@/lib/cloudinary";

export async function uploadImageToCloudinary(
  file: File,
  folder = "linx-living/products",
) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result as any);
          },
        );
        uploadStream.end(buffer);
      },
    );

    return { success: true, url: result.secure_url, key: result.public_id };
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error);
    return { success: false, error: "Upload failed" };
  }
}
