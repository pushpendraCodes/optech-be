import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { env } from "../config/env.ts";
import type { CloudinaryAsset } from "../types/common.ts";
import { BadRequestError } from "../utils/errors.ts";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function uploadBuffer(
  buffer: Buffer,
  folder: string,
  mime: string,
  filename?: string,
): Promise<CloudinaryAsset> {
  if (!ALLOWED.has(mime)) throw new BadRequestError("Unsupported file type");
  const resource_type = mime.startsWith("video/") ? "video" : mime === "application/pdf" || mime.includes("word") ? "raw" : "image";

  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type, filename_override: filename, use_filename: true },
      (err, res) => {
        if (err || !res) reject(err ?? new Error("Cloudinary upload failed"));
        else resolve(res);
      },
    );
    stream.end(buffer);
  });

  return {
    publicId: result.public_id,
    url: result.secure_url,
    resourceType: result.resource_type,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
  };
}

export async function destroyAsset(publicId: string, resourceType = "image") {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}
