import { z } from "zod";
import { ExternalAdmission } from "../../models/index.ts";
import { NotFoundError, ValidationError } from "../../utils/errors.ts";
import { objectId, paginationQuery } from "../../utils/pagination.ts";

export const externalListQuery = paginationQuery.extend({
  course: z.string().trim().optional(),
  sessionLabel: z.string().trim().optional(),
});

const installmentSchema = z.object({
  amount: z.coerce.number().optional(),
  date: z.string().trim().optional(),
});

export const externalBodySchema = z.object({
  serialNo: z.coerce.number().optional(),
  studentName: z.string().trim().min(2),
  batchTime: z.string().trim().optional(),
  address: z.string().trim().optional(),
  course: z.string().trim().optional(),
  admissionDate: z.string().trim().optional(),
  contactNo: z.string().trim().optional(),
  klic120: z.string().trim().optional(),
  klic60: z.string().trim().optional(),
  klic30: z.string().trim().optional(),
  installments: z.array(installmentSchema).max(4).optional(),
  paidFees: z.coerce.number().optional(),
  balanceFees: z.coerce.number().optional(),
  totalFees: z.coerce.number().optional(),
  sessionLabel: z.string().trim().optional(),
  programLabel: z.string().trim().optional(),
  source: z.enum(["manual", "excel"]).optional(),
});

function normalizeInstallments(rows?: z.infer<typeof installmentSchema>[]) {
  const list = [...(rows ?? [])];
  while (list.length < 4) list.push({});
  return list.slice(0, 4).map((row) => ({
    amount: row.amount != null && !Number.isNaN(Number(row.amount)) ? Number(row.amount) : undefined,
    date: row.date?.trim() || undefined,
  }));
}

function normalizeBody(parsed: z.infer<typeof externalBodySchema>, source: "manual" | "excel") {
  const totalFees = parsed.totalFees != null ? Number(parsed.totalFees) : 0;
  const paidFees = parsed.paidFees != null ? Number(parsed.paidFees) : 0;
  const balanceFees =
    parsed.balanceFees != null && !Number.isNaN(Number(parsed.balanceFees))
      ? Number(parsed.balanceFees)
      : totalFees - paidFees;

  return {
    serialNo: parsed.serialNo,
    studentName: parsed.studentName.trim(),
    batchTime: parsed.batchTime?.trim() || undefined,
    address: parsed.address?.trim() || undefined,
    course: parsed.course?.trim() || undefined,
    admissionDate: parsed.admissionDate?.trim() || undefined,
    contactNo: parsed.contactNo?.trim() || undefined,
    klic120: parsed.klic120?.trim() || undefined,
    klic60: parsed.klic60?.trim() || undefined,
    klic30: parsed.klic30?.trim() || undefined,
    installments: normalizeInstallments(parsed.installments),
    paidFees,
    balanceFees,
    totalFees,
    sessionLabel: parsed.sessionLabel?.trim() || "ADMISSION-2026",
    programLabel: parsed.programLabel?.trim() || "MS-CIT + KLiC",
    source: parsed.source ?? source,
  };
}

export async function listExternalAdmissions(
  query: z.infer<typeof paginationQuery> & { course?: string; sessionLabel?: string },
) {
  const page = Number(query.page || 1);
  const limit = Math.min(100, Number(query.limit || 20));
  const filter: Record<string, unknown> = {};
  if (query.course) filter.course = { $regex: query.course, $options: "i" };
  if (query.sessionLabel) filter.sessionLabel = query.sessionLabel;
  if (query.search) {
    filter.$or = [
      { studentName: { $regex: query.search, $options: "i" } },
      { contactNo: { $regex: query.search, $options: "i" } },
      { course: { $regex: query.search, $options: "i" } },
      { address: { $regex: query.search, $options: "i" } },
      { batchTime: { $regex: query.search, $options: "i" } },
      { klic120: { $regex: query.search, $options: "i" } },
      { klic60: { $regex: query.search, $options: "i" } },
      { klic30: { $regex: query.search, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    ExternalAdmission.find(filter)
      .sort({ serialNo: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ExternalAdmission.countDocuments(filter),
  ]);

  return {
    items,
    meta: { currentPage: page, totalItems: total, limit, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function getExternalAdmission(id: string) {
  const row = await ExternalAdmission.findById(id).lean();
  if (!row) throw new NotFoundError("Record not found");
  return row;
}

export async function createExternalAdmission(body: unknown) {
  const parsed = externalBodySchema.parse(body);
  return ExternalAdmission.create(normalizeBody(parsed, "manual"));
}

export async function updateExternalAdmission(id: string, body: unknown) {
  const parsed = externalBodySchema.partial().extend({ studentName: z.string().trim().min(2).optional() }).parse(body);
  if (!parsed.studentName && parsed.studentName !== undefined) {
    throw new ValidationError("Student name is required");
  }
  const current = await ExternalAdmission.findById(id);
  if (!current) throw new NotFoundError("Record not found");
  const merged = normalizeBody(
    {
      serialNo: parsed.serialNo ?? current.serialNo,
      studentName: parsed.studentName ?? current.studentName,
      batchTime: parsed.batchTime ?? current.batchTime,
      address: parsed.address ?? current.address,
      course: parsed.course ?? current.course,
      admissionDate: parsed.admissionDate ?? current.admissionDate,
      contactNo: parsed.contactNo ?? current.contactNo,
      klic120: parsed.klic120 ?? current.klic120,
      klic60: parsed.klic60 ?? current.klic60,
      klic30: parsed.klic30 ?? current.klic30,
      installments: parsed.installments ?? current.installments,
      paidFees: parsed.paidFees ?? current.paidFees,
      balanceFees: parsed.balanceFees ?? current.balanceFees,
      totalFees: parsed.totalFees ?? current.totalFees,
      sessionLabel: parsed.sessionLabel ?? current.sessionLabel,
      programLabel: parsed.programLabel ?? current.programLabel,
      source: current.source,
    },
    current.source,
  );
  const row = await ExternalAdmission.findByIdAndUpdate(id, merged, { new: true }).lean();
  if (!row) throw new NotFoundError("Record not found");
  return row;
}

export async function deleteExternalAdmission(id: string) {
  const row = await ExternalAdmission.findByIdAndDelete(id);
  if (!row) throw new NotFoundError("Record not found");
  return { deleted: true };
}

export async function importExternalAdmissions(rows: unknown[], defaults?: { sessionLabel?: string; programLabel?: string }) {
  if (!Array.isArray(rows) || !rows.length) throw new ValidationError("No rows to import");
  if (rows.length > 2000) throw new ValidationError("Max 2000 rows per import");

  const prepared = rows.map((raw, index) => {
    try {
      const parsed = externalBodySchema.parse({
        ...(raw as object),
        sessionLabel: (raw as { sessionLabel?: string }).sessionLabel || defaults?.sessionLabel,
        programLabel: (raw as { programLabel?: string }).programLabel || defaults?.programLabel,
        source: "excel",
      });
      return normalizeBody(parsed, "excel");
    } catch (err) {
      throw new ValidationError(`Row ${index + 1}: ${(err as Error).message}`);
    }
  });

  const inserted = await ExternalAdmission.insertMany(prepared, { ordered: false });
  return { imported: inserted.length };
}

export const externalIdParam = z.object({ id: objectId });
