import { Course, CourseCategory, Batch, Staff } from "../../models/index.js";
import { cache } from "../../services/cache.service.js";
import { CACHE_KEYS } from "../../constants/cache.js";
import { NotFoundError } from "../../utils/errors.js";
import { paginationMeta, skipLimit, type PaginationQuery } from "../../utils/pagination.js";

const PUBLIC_TTL = 60;

export async function listPublicCourses(filters: {
  search?: string;
  category?: string;
  mode?: string;
  tag?: string;
}) {
  return cache.remember(`${CACHE_KEYS.courses}:${JSON.stringify(filters)}`, PUBLIC_TTL, async () => {
    const q: Record<string, unknown> = { active: true, deletedAt: { $exists: false } };
    if (filters.mode) q.mode = filters.mode;
    if (filters.tag === "Popular") q.popular = true;
    if (filters.tag === "New") q.new = true;
    if (filters.tag === "Trending") q.trending = true;
    if (filters.category) {
      const cat = await CourseCategory.findOne({ slug: filters.category });
      if (cat) q.category = cat._id;
    }
    if (filters.search) q["title.en"] = { $regex: filters.search, $options: "i" };
    const courses = await Course.find(q)
      .populate("category", "name slug")
      .populate("instructors", "name role photo")
      .lean();
    const batches = await Batch.find({ course: { $in: courses.map((c) => c._id) }, active: true }).lean();
    return courses.map((c) => ({
      ...c,
      batches: batches.filter((b) => String(b.course) === String(c._id)),
    }));
  });
}

export async function getPublicCourse(slug: string) {
  const course = await Course.findOne({ slug, active: true, deletedAt: { $exists: false } })
    .populate("category")
    .populate("instructors", "name role bio photo")
    .lean();
  if (!course) throw new NotFoundError("Course not found");
  const batches = await Batch.find({ course: course._id, active: true }).lean();
  return { ...course, batches };
}

export async function listCategories() {
  return cache.remember(CACHE_KEYS.categories, PUBLIC_TTL, () =>
    CourseCategory.find({ active: true }).sort({ sortOrder: 1 }).lean(),
  );
}

export async function adminListCourses(q: PaginationQuery) {
  const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
  if (q.search) filter["title.en"] = { $regex: q.search, $options: "i" };
  const { skip, limit } = skipLimit(q.page, q.limit);
  const [items, total] = await Promise.all([
    Course.find(filter)
      .populate("category", "name slug")
      .populate("instructors", "name role photo")
      .sort({ [q.sortBy]: q.sortOrder === "asc" ? 1 : -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Course.countDocuments(filter),
  ]);
  return { items, meta: paginationMeta(total, q.page, q.limit) };
}

export async function createCourse(body: Record<string, unknown>, userId: string) {
  const doc = await Course.create({ ...body, createdBy: userId, updatedBy: userId });
  await cache.delByPrefix(CACHE_KEYS.courses);
  await cache.del(CACHE_KEYS.categories);
  return doc;
}

export async function updateCourse(id: string, body: Record<string, unknown>, userId: string) {
  const doc = await Course.findByIdAndUpdate(id, { ...body, updatedBy: userId }, { new: true });
  if (!doc) throw new NotFoundError("Course not found");
  await cache.delByPrefix(CACHE_KEYS.courses);
  return doc;
}

export async function deleteCourse(id: string) {
  const doc = await Course.findByIdAndUpdate(id, { deletedAt: new Date(), active: false }, { new: true });
  if (!doc) throw new NotFoundError("Course not found");
  await cache.delByPrefix(CACHE_KEYS.courses);
  return doc;
}

export async function upsertBatch(courseId: string, body: Record<string, unknown>) {
  if (body.id) {
    return updateBatch(String(body.id), body);
  }
  return Batch.create({ ...body, course: courseId });
}

export async function updateBatch(id: string, body: Record<string, unknown>) {
  const { id: _omit, ...rest } = body;
  const doc = await Batch.findByIdAndUpdate(id, rest, { new: true });
  if (!doc) throw new NotFoundError("Batch not found");
  await cache.delByPrefix(CACHE_KEYS.courses);
  return doc;
}

export async function deleteBatch(id: string) {
  const doc = await Batch.findByIdAndDelete(id);
  if (!doc) throw new NotFoundError("Batch not found");
  await cache.delByPrefix(CACHE_KEYS.courses);
  return doc;
}

export async function listStaffPublic() {
  return cache.remember(CACHE_KEYS.staff, PUBLIC_TTL, () =>
    Staff.find({ published: true }).sort({ sortOrder: 1 }).lean(),
  );
}
