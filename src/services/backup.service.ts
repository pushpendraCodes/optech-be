import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import dayjs from "dayjs";
import { env } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import type { CloudinaryAsset } from "../types/common.ts";
// Ensure Cloudinary credentials are configured (side-effect import).
import "./cloudinary.service.ts";

export type BackupResult = {
  asset: CloudinaryAsset;
  bytes: number;
  filename: string;
  durationMs: number;
  pruned: number;
};

function runMongodump(archivePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "mongodump",
      ["--uri", env.MONGO_URI, `--archive=${archivePath}`, "--gzip"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "mongodump not found. Install MongoDB Database Tools and ensure mongodump is on PATH.",
          ),
        );
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mongodump exited with code ${code}: ${stderr.trim() || "unknown error"}`));
    });
  });
}

async function uploadArchive(filePath: string, folder: string, filename: string): Promise<CloudinaryAsset> {
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "raw",
        public_id: filename.replace(/\.gz$/i, ""),
        use_filename: true,
        unique_filename: false,
        overwrite: true,
      },
      (err, res) => {
        if (err || !res) reject(err ?? new Error("Cloudinary backup upload failed"));
        else resolve(res);
      },
    );
    createReadStream(filePath).pipe(stream);
  });

  return {
    publicId: result.public_id,
    url: result.secure_url,
    resourceType: result.resource_type,
    format: result.format,
    bytes: result.bytes,
  };
}

async function listBackupResources(folder: string): Promise<Array<{ publicId: string; createdAt: string }>> {
  const prefix = folder.replace(/\/$/, "");
  const items: Array<{ publicId: string; createdAt: string }> = [];
  let nextCursor: string | undefined;

  do {
    const page = (await cloudinary.api.resources({
      type: "upload",
      resource_type: "raw",
      prefix,
      max_results: 100,
      next_cursor: nextCursor,
    })) as {
      resources: Array<{ public_id: string; created_at: string }>;
      next_cursor?: string;
    };

    for (const r of page.resources ?? []) {
      items.push({ publicId: r.public_id, createdAt: r.created_at });
    }
    nextCursor = page.next_cursor;
  } while (nextCursor);

  return items;
}

async function pruneOldBackups(folder: string, retentionDays: number): Promise<number> {
  if (retentionDays <= 0) return 0;
  const cutoff = dayjs().subtract(retentionDays, "day");
  const resources = await listBackupResources(folder);
  let pruned = 0;

  for (const r of resources) {
    if (dayjs(r.createdAt).isBefore(cutoff)) {
      try {
        await cloudinary.uploader.destroy(r.publicId, { resource_type: "raw" });
        pruned += 1;
      } catch (err) {
        logger.warn({ err, publicId: r.publicId }, "Failed to prune old backup");
      }
    }
  }

  return pruned;
}

/** Run mongodump → gzip archive → Cloudinary raw upload, then prune old backups. */
export async function runMongoBackup(): Promise<BackupResult> {
  const started = Date.now();
  const folder = env.BACKUP_FOLDER;
  const stamp = dayjs().format("YYYY-MM-DD_HH-mm-ss");
  const filename = `optech-mongo-${stamp}.gz`;
  const workDir = await mkdtemp(join(tmpdir(), "optech-backup-"));
  const archivePath = join(workDir, filename);

  logger.info({ folder, filename }, "Starting MongoDB backup");

  try {
    await runMongodump(archivePath);
    const fileStat = await stat(archivePath);
    if (!fileStat.size) throw new Error("mongodump produced an empty archive");

    const asset = await uploadArchive(archivePath, folder, filename);
    const pruned = await pruneOldBackups(folder, env.BACKUP_RETENTION_DAYS);
    const durationMs = Date.now() - started;

    logger.info(
      {
        publicId: asset.publicId,
        url: asset.url,
        bytes: fileStat.size,
        pruned,
        durationMs,
      },
      "MongoDB backup uploaded to Cloudinary",
    );

    return {
      asset,
      bytes: fileStat.size,
      filename,
      durationMs,
      pruned,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
