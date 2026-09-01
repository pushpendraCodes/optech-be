import { Enquiry } from "../../models/index.js";
import { NotFoundError } from "../../utils/errors.js";
import { paginationMeta, type PaginationQuery } from "../../utils/pagination.js";
import { notifyNewEnquiry } from "../../services/notification.service.js";

type EnquiryInput = {
  name: string;
  email: string;
  phone: string;
  course: string;
  message?: string;
};

export async function createEnquiry(input: EnquiryInput) {
  const row = await Enquiry.create({
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    course: input.course.trim(),
    message: input.message?.trim() || undefined,
    status: "new",
    source: "website",
  });

  await notifyNewEnquiry({
    name: row.name,
    phone: row.phone,
    email: row.email,
    course: row.course,
    message: row.message,
  });

  return row;
}

type AdminEnquiriesQuery = PaginationQuery & {
  status?: "" | "new" | "contacted" | "closed";
};

export async function adminListEnquiries(q: AdminEnquiriesQuery) {
  const page = q.page ?? 1;
  const limit = q.limit ?? 20;
  const filter: Record<string, unknown> = {};
  const term = String(q.search ?? "").trim();

  if (q.status) filter.status = q.status;
  if (term) {
    filter.$or = [
      { name: { $regex: term, $options: "i" } },
      { email: { $regex: term, $options: "i" } },
      { phone: { $regex: term, $options: "i" } },
      { course: { $regex: term, $options: "i" } },
      { message: { $regex: term, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    Enquiry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Enquiry.countDocuments(filter),
  ]);

  return { items, meta: paginationMeta(total, page, limit) };
}

export async function adminUpdateEnquiry(id: string, body: { status?: "new" | "contacted" | "closed" }) {
  const row = await Enquiry.findByIdAndUpdate(id, body, { new: true }).lean();
  if (!row) throw new NotFoundError("Enquiry not found");
  return row;
}

export async function adminEnquiryStats() {
  const [total, unread] = await Promise.all([
    Enquiry.countDocuments(),
    Enquiry.countDocuments({ status: "new" }),
  ]);
  return { total, unread };
}
