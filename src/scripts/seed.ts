import argon2 from "argon2";
import { connectDb } from "../config/db.ts";
import { logger } from "../config/logger.ts";
import { SUPER_ADMIN } from "../constants/admin.ts";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_KEYS } from "../constants/rbac.ts";
import {
  Admission,
  Alumni,
  Attendance,
  Batch,
  CmsItem,
  Coupon,
  Course,
  CourseCategory,
  Enrollment,
  GalleryAlbum,
  GalleryMedia,
  Installment,
  Job,
  LiveClass,
  Notice,
  Notification,
  NotificationReceipt,
  Payment,
  Permission,
  Quiz,
  Referral,
  Role,
  ScholarshipExam,
  Setting,
  Staff,
  Student,
  StudyMaterial,
  TypingParagraph,
  User,
} from "../models/index.ts";

const CATEGORIES = [
  { slug: "basic-computer", name: "Basic Computer" },
  { slug: "tally", name: "Tally" },
  { slug: "web-dev", name: "Web Dev" },
  { slug: "graphic-design", name: "Graphic Design" },
  { slug: "dca", name: "DCA" },
  { slug: "pgdca", name: "PGDCA" },
  { slug: "typing", name: "Typing" },
  { slug: "programming", name: "Programming" },
  { slug: "digital-marketing", name: "Digital Marketing" },
  { slug: "networking", name: "Networking" },
];

const STAFF_SEED = [
  {
    name: "Dr. Anil Meshram",
    role: "Director & Principal",
    focus: "Academic Leadership",
    bio: "Leading Optech Deori since the early 2000s with a focus on outcome-based technical education across Vidarbha.",
    photo: "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=600&h=750&q=80",
  },
  {
    name: "Prof. Sneha Kale",
    role: "Head of Programming",
    focus: "C · Java · Python",
    bio: "Industry veteran mentoring students through coding foundations, DSA, and project-based learning.",
    photo: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=600&h=750&q=80",
  },
  {
    name: "Mr. Rohit Bhoyar",
    role: "Web & UI Faculty",
    focus: "HTML · CSS · JavaScript",
    bio: "Builds career-ready frontend skills with modern frameworks and real client-style assignments.",
    photo: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=600&h=750&q=80",
  },
  {
    name: "Mrs. Priya Dakhane",
    role: "Accounts & Tally Lead",
    focus: "Tally · GST · Excel",
    bio: "Specializes in practical accounting workflows used by local businesses and CA offices.",
    photo: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=600&h=750&q=80",
  },
  {
    name: "Mr. Sachin Ghodmare",
    role: "Networking Instructor",
    focus: "CCNA · Hardware",
    bio: "Hands-on lab trainer for networking, hardware troubleshooting, and infrastructure basics.",
    photo: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=600&h=750&q=80",
  },
  {
    name: "Ms. Komal Raut",
    role: "Placement Coordinator",
    focus: "Career Cell",
    bio: "Connects students with employers and runs interview readiness workshops year-round.",
    photo: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=600&h=750&q=80",
  },
];

type CourseSeed = {
  slug: string;
  title: string;
  category: string;
  duration: string;
  durationMonths: number;
  mode: "offline" | "online";
  fee: number;
  body: string;
  certificate: string;
  tags: string[];
  popular?: boolean;
  neu?: boolean;
  trending?: boolean;
  staff: string[];
  syllabus: { title: string; topics: string[] }[];
  batches: { label: string; timing: string; seats: number; start: string }[];
};

const COURSES_SEED: CourseSeed[] = [
  {
    slug: "pgdca",
    title: "PGDCA",
    category: "pgdca",
    duration: "1 Year",
    durationMonths: 12,
    mode: "offline",
    fee: 28000,
    body: "Post Graduate Diploma in Computer Applications — full-stack fundamentals, databases, and workplace readiness.",
    certificate: "Optech PGDCA Certificate — industry recognized, valid nationwide.",
    tags: ["Popular", "Trending"],
    popular: true,
    trending: true,
    staff: ["Dr. Anil Meshram", "Prof. Sneha Kale"],
    syllabus: [
      { title: "Module 1 — Computing Foundations", topics: ["OS & office suite", "Internet & cyber safety", "File systems"] },
      { title: "Module 2 — Programming", topics: ["C & logic", "Python basics", "Mini projects"] },
      { title: "Module 3 — Databases & Web", topics: ["SQL", "HTML/CSS/JS", "Report generation"] },
    ],
    batches: [
      { label: "Morning", timing: "Mon–Sat · 9:00–11:00 AM", seats: 8, start: "2026-09-08" },
      { label: "Evening", timing: "Mon–Sat · 4:00–6:00 PM", seats: 12, start: "2026-09-15" },
    ],
  },
  {
    slug: "dca",
    title: "DCA",
    category: "dca",
    duration: "6 Months",
    durationMonths: 6,
    mode: "offline",
    fee: 14000,
    body: "Diploma in Computer Applications — essential computing, office automation, and entry-level job skills.",
    certificate: "Optech DCA Certificate with grade sheet.",
    tags: ["New"],
    neu: true,
    staff: ["Mrs. Priya Dakhane"],
    syllabus: [
      { title: "Module 1 — Computer Basics", topics: ["Hardware", "Windows", "Typing intro"] },
      { title: "Module 2 — MS Office", topics: ["Word", "Excel", "PowerPoint"] },
    ],
    batches: [{ label: "Morning", timing: "Mon–Sat · 10:00–12:00 PM", seats: 10, start: "2026-09-01" }],
  },
  {
    slug: "web-development",
    title: "Web Development",
    category: "web-dev",
    duration: "12 Weeks",
    durationMonths: 3,
    mode: "offline",
    fee: 18000,
    body: "Build modern, responsive websites using HTML5, CSS3, JavaScript, and popular frameworks.",
    certificate: "Optech Web Development Certificate + project portfolio review.",
    tags: ["Popular", "Trending"],
    popular: true,
    trending: true,
    staff: ["Mr. Rohit Bhoyar"],
    syllabus: [
      { title: "Module 1 — Markup & Style", topics: ["HTML5", "CSS3", "Responsive layouts"] },
      { title: "Module 2 — JavaScript", topics: ["DOM", "Fetch", "ES modules"] },
    ],
    batches: [
      { label: "Weekend", timing: "Sat–Sun · 10:00 AM–1:00 PM", seats: 6, start: "2026-09-06" },
      { label: "Evening", timing: "Mon–Fri · 5:00–7:00 PM", seats: 9, start: "2026-09-14" },
    ],
  },
  {
    slug: "python-ai",
    title: "Python & AI",
    category: "programming",
    duration: "4 Months",
    durationMonths: 4,
    mode: "offline",
    fee: 22000,
    body: "Learn Python programming with practical AI concepts for automation and data-driven projects.",
    certificate: "Optech Python & AI Certificate.",
    tags: ["Trending", "New"],
    trending: true,
    neu: true,
    staff: ["Prof. Sneha Kale"],
    syllabus: [{ title: "Module 1 — Python Core", topics: ["Syntax", "OOP", "Files"] }],
    batches: [{ label: "Morning", timing: "Mon–Sat · 8:00–10:00 AM", seats: 11, start: "2026-09-10" }],
  },
  {
    slug: "tally-prime",
    title: "Tally Prime",
    category: "tally",
    duration: "8 Weeks",
    durationMonths: 2,
    mode: "offline",
    fee: 9000,
    body: "Gain expertise in modern accounting and GST compliance using Tally Prime tools.",
    certificate: "Optech Tally Prime Certificate.",
    tags: ["Popular"],
    popular: true,
    staff: ["Mrs. Priya Dakhane"],
    syllabus: [{ title: "Module 1 — Company setup", topics: ["Ledgers", "Vouchers", "GST"] }],
    batches: [
      { label: "Morning", timing: "Mon–Sat · 11:00 AM–1:00 PM", seats: 14, start: "2026-09-02" },
      { label: "Online", timing: "Tue–Thu · 7:00–8:30 PM", seats: 20, start: "2026-09-08" },
    ],
  },
  {
    slug: "networking-ccna",
    title: "Networking & CCNA",
    category: "networking",
    duration: "6 Months",
    durationMonths: 6,
    mode: "offline",
    fee: 32000,
    body: "Industry networking skills with routing, switching, and CCNA-oriented lab practice.",
    certificate: "Optech Networking Certificate + CCNA exam guidance.",
    tags: ["Popular"],
    popular: true,
    staff: ["Mr. Sachin Ghodmare"],
    syllabus: [{ title: "Module 1 — Networks", topics: ["OSI", "IP", "Cabling"] }],
    batches: [{ label: "Evening", timing: "Mon–Sat · 3:00–5:00 PM", seats: 7, start: "2026-09-21" }],
  },
  {
    slug: "graphic-design",
    title: "Graphic Design",
    category: "graphic-design",
    duration: "3 Months",
    durationMonths: 3,
    mode: "offline",
    fee: 15000,
    body: "Design visual identities, marketing creatives, and digital assets for real client briefs.",
    certificate: "Optech Graphic Design Certificate + portfolio review.",
    tags: ["New"],
    neu: true,
    staff: ["Mr. Rohit Bhoyar"],
    syllabus: [{ title: "Module 1 — Tools", topics: ["Photoshop", "Illustrator", "Canva pro"] }],
    batches: [{ label: "Weekend", timing: "Sat–Sun · 2:00–5:00 PM", seats: 10, start: "2026-09-05" }],
  },
  {
    slug: "advanced-excel",
    title: "Advanced Excel",
    category: "basic-computer",
    duration: "6 Weeks",
    durationMonths: 2,
    mode: "offline",
    fee: 6000,
    body: "Unlock data power with pivot tables, complex formulas, VBA macros, and automation.",
    certificate: "Optech Advanced Excel Certificate.",
    tags: ["Popular"],
    popular: true,
    staff: ["Mrs. Priya Dakhane"],
    syllabus: [{ title: "Module 1 — Formulas", topics: ["Lookups", "Logic", "Named ranges"] }],
    batches: [{ label: "Morning", timing: "Mon–Fri · 9:00–10:30 AM", seats: 16, start: "2026-09-03" }],
  },
  {
    slug: "computer-basics",
    title: "Computer Basics",
    category: "basic-computer",
    duration: "4 Weeks",
    durationMonths: 1,
    mode: "offline",
    fee: 3500,
    body: "Master fundamental computing skills, from hardware basics to essential software.",
    certificate: "Optech Computer Literacy Certificate.",
    tags: ["Popular"],
    popular: true,
    staff: ["Mrs. Priya Dakhane"],
    syllabus: [{ title: "Module 1 — Hardware & Windows", topics: ["Parts", "Files", "Settings"] }],
    batches: [{ label: "Morning", timing: "Mon–Sat · 9:00–10:00 AM", seats: 18, start: "2026-09-01" }],
  },
  {
    slug: "programming",
    title: "Programming (C, Java, Python)",
    category: "programming",
    duration: "16 Weeks",
    durationMonths: 4,
    mode: "offline",
    fee: 20000,
    body: "Master core logic and syntax of industry-standard languages across multiple tracks.",
    certificate: "Optech Programming Certificate (language tracks listed).",
    tags: ["Trending"],
    trending: true,
    staff: ["Prof. Sneha Kale"],
    syllabus: [{ title: "Module 1 — C", topics: ["Pointers", "Arrays", "Functions"] }],
    batches: [{ label: "Evening", timing: "Mon–Sat · 5:30–7:30 PM", seats: 9, start: "2026-09-16" }],
  },
  {
    slug: "digital-marketing",
    title: "Digital Marketing",
    category: "digital-marketing",
    duration: "10 Weeks",
    durationMonths: 3,
    mode: "online",
    fee: 12000,
    body: "Master SEO, SEM, social media marketing, and content strategy to drive business growth.",
    certificate: "Optech Digital Marketing Certificate.",
    tags: ["New", "Trending"],
    neu: true,
    trending: true,
    staff: ["Ms. Komal Raut"],
    syllabus: [{ title: "Module 1 — Discovery", topics: ["SEO", "Keywords", "Analytics"] }],
    batches: [{ label: "Online", timing: "Tue–Thu · 7:00–8:30 PM", seats: 22, start: "2026-09-09" }],
  },
  {
    slug: "english-hindi-typing",
    title: "English + Hindi Typing",
    category: "typing",
    duration: "6 Weeks",
    durationMonths: 2,
    mode: "offline",
    fee: 4000,
    body: "Build speed and accuracy for government and office exams — English and Hindi (Kruti Dev / Inscript).",
    certificate: "Optech Typing Speed Certificate (WPM + accuracy).",
    tags: ["New"],
    neu: true,
    staff: ["Ms. Komal Raut"],
    syllabus: [{ title: "Module 1 — English", topics: ["Home row", "Accuracy", "Timed drills"] }],
    batches: [{ label: "Morning", timing: "Mon–Sat · 8:00–9:00 AM", seats: 20, start: "2026-09-01" }],
  },
];

function photo(url: string) {
  return { url, publicId: "", resourceType: "image" };
}

async function seed() {
  await connectDb();

  for (const key of PERMISSIONS) {
    await Permission.updateOne({ key }, { key, description: key }, { upsert: true });
  }
  for (const key of ROLE_KEYS) {
    const permissions = ROLE_PERMISSIONS[key] === "*" ? [...PERMISSIONS] : ROLE_PERMISSIONS[key];
    await Role.updateOne({ key }, { key, name: key, permissions, isSystem: true }, { upsert: true });
  }

  const superRole = await Role.findOne({ key: "SUPER_ADMIN" });
  const existingAdmin = await User.findOne({ email: SUPER_ADMIN.email });
  if (!existingAdmin) {
    await User.create({
      kind: "staff",
      name: SUPER_ADMIN.name,
      email: SUPER_ADMIN.email,
      passwordHash: await argon2.hash(SUPER_ADMIN.password),
      roles: superRole ? [superRole._id] : [],
      status: "active",
    });
    logger.info("Seeded super admin");
  }

  for (const [i, cat] of CATEGORIES.entries()) {
    await CourseCategory.updateOne(
      { slug: cat.slug },
      { slug: cat.slug, name: { en: cat.name }, active: true, sortOrder: i },
      { upsert: true },
    );
  }

  const staffByName = new Map<string, string>();
  for (const [i, member] of STAFF_SEED.entries()) {
    const doc = await Staff.findOneAndUpdate(
      { name: member.name },
      { ...member, photo: photo(member.photo), published: true, sortOrder: i },
      { upsert: true, new: true },
    );
    staffByName.set(member.name, String(doc._id));
  }

  const courseBySlug = new Map<string, string>();
  const batchByKey = new Map<string, string>();
  for (const course of COURSES_SEED) {
    const category = await CourseCategory.findOne({ slug: course.category });
    if (!category) continue;
    const instructors = course.staff.map((name) => staffByName.get(name)).filter(Boolean);
    const doc = await Course.findOneAndUpdate(
      { slug: course.slug },
      {
        $set: {
          title: { en: course.title },
          slug: course.slug,
          description: { en: course.body },
          shortDescription: { en: course.body },
          category: category._id,
          duration: course.duration,
          durationMonths: course.durationMonths,
          mode: course.mode,
          fee: course.fee,
          discount: 0,
          syllabus: course.syllabus,
          instructors,
          certificate: course.certificate,
          tags: course.tags,
          popular: Boolean(course.popular),
          new: Boolean(course.neu),
          trending: Boolean(course.trending),
          active: true,
        },
        $unset: { deletedAt: 1 },
      },
      { upsert: true, new: true },
    );
    courseBySlug.set(course.slug, String(doc._id));
    for (const batch of course.batches) {
      const saved = await Batch.findOneAndUpdate(
        { course: doc._id, label: batch.label },
        {
          course: doc._id,
          label: batch.label,
          timing: batch.timing,
          seats: batch.seats,
          start: new Date(batch.start),
          active: true,
        },
        { upsert: true, new: true },
      );
      batchByKey.set(`${course.slug}:${batch.label}`, String(saved._id));
    }
  }

  await Setting.updateOne({ key: "installments" }, { key: "installments", value: { parts: 3, minFeeForEmi: 8000 } }, { upsert: true });
  await Setting.updateOne(
    { key: "website" },
    {
      key: "website",
      value: {
        name: "Optech Computer Institute",
        email: "info@optech-deori.edu.in",
        mobile: "+91 0712 253 4587",
        address: "Ward No. 04, Ganesh Chowk, behind Shitala Mata Mandir, Deori, Maharashtra 441901",
        logo: null,
      },
    },
    { upsert: true },
  );

  for (const coupon of [
    { code: "OPTECH10", label: "Institute offer", type: "percent" as const, value: 10 },
    { code: "SCHOLAR10", label: "Scholarship 75–89%", type: "percent" as const, value: 10 },
    { code: "SCHOLAR20", label: "Scholarship 90%+", type: "percent" as const, value: 20 },
  ]) {
    await Coupon.updateOne({ code: coupon.code }, { ...coupon, active: true }, { upsert: true });
  }

  await TypingParagraph.updateOne(
    { language: "en", text: /The quick/ },
    { language: "en", text: "The quick brown fox jumps over the lazy dog in the Deori computer lab.", active: true },
    { upsert: true },
  );

  const notices = [
    { title: "Independence Day holiday — 15 Aug", body: "Institute closed. Regular batches resume 16 Aug.", category: "urgent", pinned: true },
    { title: "PGDCA mid-term mock — 28 Aug", body: "Timed test opens 9:00 AM. Auto-submit at 10:30 AM.", category: "exam", pinned: true },
    { title: "New Tally Prime evening batch", body: "Online Tue–Thu 7:00–8:30 PM. Fee calculator updated.", category: "general", pinned: false },
    { title: "Ganesh Chaturthi short break", body: "Schedule will be posted on the student notice board.", category: "holiday", pinned: false },
  ];
  for (const n of notices) {
    await Notice.updateOne(
      { "title.en": n.title },
      { title: { en: n.title }, body: { en: n.body }, category: n.category, pinned: n.pinned, audience: "ALL", published: true },
      { upsert: true },
    );
  }

  const albums = [
    {
      title: "Annual Function 2025",
      cover: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=900&h=680&q=80",
      photos: [
        "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&h=800&q=80",
        "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&h=800&q=80",
        "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?auto=format&fit=crop&w=1200&h=800&q=80",
      ],
    },
    {
      title: "Workshops & Labs",
      cover: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&h=680&q=80",
      photos: [
        "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&h=800&q=80",
        "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1200&h=800&q=80",
      ],
    },
    {
      title: "Campus & Events",
      cover: "https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=900&h=680&q=80",
      photos: [
        "https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=1200&h=800&q=80",
        "https://images.unsplash.com/photo-1541339908493-71d65c3acc5e?auto=format&fit=crop&w=1200&h=800&q=80",
      ],
    },
  ];
  for (const [i, album] of albums.entries()) {
    const saved = await GalleryAlbum.findOneAndUpdate(
      { title: album.title },
      { title: album.title, kind: "photo", cover: photo(album.cover), published: true, sortOrder: i },
      { upsert: true, new: true },
    );
    for (const url of album.photos) {
      await GalleryMedia.updateOne({ album: saved._id, "asset.url": url }, { album: saved._id, asset: photo(url) }, { upsert: true });
    }
  }

  const alumni = [
    { name: "Priya Sharma", batchYear: "2023", course: "pgdca", role: "Associate — TCS", story: "Placed within two months. Labs and interview drills made the difference.", featured: true },
    { name: "Rahul Meshram", batchYear: "2024", course: "web-development", role: "Junior Frontend — Nagpur startup", story: "Portfolio projects from class became my interview talking points.", featured: true },
    { name: "Snehal Wankhede", batchYear: "2022", course: "tally-prime", role: "Accounts Executive — Gondia", story: "GST practice matched what my CA office uses every day.", featured: false },
    { name: "Amit Raut", batchYear: "2021", course: "networking-ccna", role: "Network Support — MSP", story: "Hardware lab hours were the reason I cleared the first technical round.", featured: false },
  ];
  for (const a of alumni) {
    await Alumni.updateOne(
      { name: a.name },
      { ...a, course: courseBySlug.get(a.course), published: true },
      { upsert: true },
    );
  }

  const jobs = [
    { title: "Data Entry Operator", employer: "District e-Seva Partner", location: "Deori / Gondia", course: "computer-basics", type: "Full-time", description: "Data entry for citizen service forms, document digitization, and daily report maintenance.", contact: "Placement Cell: +91 0712 253 4587" },
    { title: "Computer Operator", employer: "Local Municipal Contractor", location: "Deori", course: "dca", type: "Contract", description: "Office operations role covering typing, Excel updates, print workflows, and basic system handling.", contact: "Placement Cell: +91 0712 253 4587" },
    { title: "DTP Artist", employer: "Print & Flex Studio", location: "Gondia", course: "graphic-design", type: "Full-time", description: "Design and pre-press support for pamphlets, banners, and local business branding materials.", contact: "Placement Cell: +91 0712 253 4587" },
    { title: "Junior Web Intern", employer: "Vidarbha Web Lab", location: "Remote / Nagpur", course: "web-development", type: "Internship", description: "Assist in frontend UI updates, responsive fixes, and QA checks for client websites.", contact: "Placement Cell: +91 0712 253 4587" },
  ];
  for (const job of jobs) {
    await Job.updateOne({ title: job.title }, { ...job, course: courseBySlug.get(job.course), published: true }, { upsert: true });
  }

  const cms = [
    { kind: "marquee" as const, title: "New PGDCA & Web Dev batches start September 2026 — seats limited", href: "/courses", sortOrder: 0 },
    { kind: "marquee" as const, title: "Scholarship exam open — score 75%+ and unlock a fee coupon", href: "/scholarship", sortOrder: 1 },
    { kind: "marquee" as const, title: "Admission open at Deori campus · Mon–Sat 9 AM–6 PM", href: "/contact", sortOrder: 2 },
    { kind: "ad" as const, title: "Refer a friend. Earn rewards.", body: "Enrolled students get a unique code. When a friend joins a paid course, you earn.", href: "/student/login", cta: "Student login", slot: "home-between", sortOrder: 0 },
    { kind: "ad" as const, title: "PGDCA evening batch — seats open", body: "One-year professional track with placement cell support. Starts 15 Sep 2026.", href: "/courses/pgdca", cta: "View PGDCA", slot: "home-between", sortOrder: 1 },
    { kind: "ad" as const, title: "Placement jobs this week", body: "Data entry, DTP, and computer operator roles matched to your course.", href: "/jobs", cta: "See listings", slot: "home-between", sortOrder: 2 },
    { kind: "ad" as const, title: "English + Hindi Typing", body: "6 weeks · ₹4,000 · morning batch", href: "/courses/english-hindi-typing", cta: "View course", slot: "side", sortOrder: 3 },
    { kind: "ad" as const, title: "Tally Prime evening", body: "GST labs · 8 weeks · campus + online", href: "/courses/tally-prime", cta: "View course", slot: "side", sortOrder: 4 },
    { kind: "popup" as const, title: "Admission open — Scholarship exam live", body: "Register for the public scholarship test. Score 75%+ and unlock a 10–20% course coupon you can use at checkout.", href: "/scholarship", cta: "Take scholarship exam", sortOrder: 0 },
    { kind: "link" as const, title: "SSC / Govt exam portal", body: "Official notifications and applications.", href: "https://ssc.gov.in", sortOrder: 0 },
    { kind: "link" as const, title: "Maharashtra results", body: "Board and university result lookup.", href: "https://mahresult.nic.in", sortOrder: 1 },
    { kind: "link" as const, title: "NSDC skill resources", body: "National skill development materials.", href: "https://www.nsdcindia.org", sortOrder: 2 },
  ];
  for (const item of cms) {
    await CmsItem.updateOne({ kind: item.kind, title: item.title }, { ...item, active: true }, { upsert: true });
  }

  const pgdcaId = courseBySlug.get("pgdca");
  if (pgdcaId) {
    await LiveClass.updateOne(
      { title: "PGDCA — Database Lab (Live)" },
      {
        title: "PGDCA — Database Lab (Live)",
        course: pgdcaId,
        batch: batchByKey.get("pgdca:Evening"),
        youtubeId: "",
        youtubeUrl: "",
        startsAt: new Date("2026-08-23T17:00:00+05:30"),
        isLive: false,
      },
      { upsert: true },
    );
    const notes = [
      { title: "PGDCA Module 1 notes", chapter: "Module 1 — Computing Foundations", type: "link" as const, externalUrl: "https://optech-deori.edu.in" },
      { title: "SQL joins cheat sheet", chapter: "Module 3 — Databases", type: "pdf" as const },
      { title: "Python lab workbook", chapter: "Module 2 — Programming", type: "doc" as const },
      { title: "HTML forms lecture", chapter: "Module 3 — Web", type: "video" as const, externalUrl: "https://www.youtube.com" },
    ];
    for (const note of notes) {
      await StudyMaterial.updateOne(
        { title: note.title },
        { course: pgdcaId, published: true, views: 12, ...note },
        { upsert: true },
      );
    }
    await Quiz.updateOne(
      { title: "PGDCA Mid-term Mock" },
      {
        title: "PGDCA Mid-term Mock",
        course: pgdcaId,
        minutes: 20,
        passing: 60,
        negative: true,
        negativeValue: 0.25,
        open: true,
        questions: [
          { type: "mcq", prompt: "PRIMARY KEY in SQL must be:", options: ["Nullable and unique", "Unique and not null", "Always a string", "A foreign file"], answerIndex: 1, marks: 1 },
          { type: "tf", prompt: "CSS can change the visual presentation of HTML.", options: ["True", "False"], answerIndex: 0, marks: 1 },
          { type: "blank", prompt: "The expansion of CPU is ______.", options: ["Central Processing Unit"], answerIndex: 0, marks: 1 },
          { type: "mcq", prompt: "Which protocol is used to browse websites?", options: ["SMTP", "HTTP", "FTP only", "SSH"], answerIndex: 1, marks: 1 },
        ],
      },
      { upsert: true },
    );
  }

  await ScholarshipExam.updateOne(
    { title: "Optech Scholarship Exam 2026" },
    {
      title: "Optech Scholarship Exam 2026",
      minutes: 15,
      active: true,
      slabs: [
        { minPercent: 90, couponPercent: 20, couponPrefix: "SCHOLAR20" },
        { minPercent: 75, couponPercent: 10, couponPrefix: "SCHOLAR10" },
      ],
      questions: [
        { type: "mcq", prompt: "Which key combination copies selected text in most editors?", options: ["Ctrl + X", "Ctrl + C", "Ctrl + V", "Ctrl + Z"], answerIndex: 1, marks: 1 },
        { type: "mcq", prompt: "GST in Tally is primarily used for:", options: ["Drawing", "Tax compliance", "Video editing", "Networking"], answerIndex: 1, marks: 1 },
        { type: "mcq", prompt: "HTML is used to:", options: ["Style pages only", "Structure web pages", "Route packets", "Balance ledgers"], answerIndex: 1, marks: 1 },
        { type: "mcq", prompt: "1 KB equals:", options: ["10 bytes", "100 bytes", "1024 bytes", "1000 bits"], answerIndex: 2, marks: 1 },
        { type: "mcq", prompt: "A strong password should include:", options: ["Only your name", "Mixed characters", "123456", "The word password"], answerIndex: 1, marks: 1 },
      ],
    },
    { upsert: true },
  );

  const studentCode = "OPT-2024-1847";
  let studentUser = await User.findOne({ studentCode });
  if (!studentUser) {
    studentUser = await User.create({
      kind: "student",
      name: "Aarav Kulkarni",
      email: "aarav.k@example.com",
      phone: "9876544120",
      studentCode,
      passwordHash: await argon2.hash("optech1847"),
      status: "active",
    });
  }
  let student = await Student.findOne({ studentCode });
  if (!student) {
    student = await Student.create({
      user: studentUser._id,
      studentCode,
      rollNumber: "PGD-1847",
      parentPhone: "9822011890",
      batch: batchByKey.get("pgdca:Evening"),
      referralCode: "AARAV1847",
      validTill: new Date("2027-07-31"),
      blocked: false,
    });
  }

  if (pgdcaId) {
    await Admission.updateOne(
      { phone: "9876544120", course: pgdcaId },
      {
        student: student._id,
        name: "Aarav Kulkarni",
        phone: "9876544120",
        email: "aarav.k@example.com",
        course: pgdcaId,
        batch: batchByKey.get("pgdca:Evening"),
        status: "confirmed",
        feePlan: "installment",
        paymentMode: "online",
      },
      { upsert: true },
    );
    const enrollment = await Enrollment.findOneAndUpdate(
      { student: student._id, course: pgdcaId },
      {
        student: student._id,
        course: pgdcaId,
        batch: batchByKey.get("pgdca:Evening"),
        status: "active",
        progress: 68,
        feePlan: "installment",
        source: "offline",
      },
      { upsert: true, new: true },
    );
    await Payment.updateOne(
      { student: student._id, notes: "seed-pgdca-part-1" },
      {
        student: student._id,
        enrollment: enrollment?._id,
        course: pgdcaId,
        amount: 10000,
        status: "paid",
        mode: "upi",
        notes: "seed-pgdca-part-1",
      },
      { upsert: true },
    );
    if (enrollment) {
      await Installment.updateOne(
        { enrollment: enrollment._id, sequence: 2 },
        {
          enrollment: enrollment._id,
          student: student._id,
          amount: 9333,
          dueDate: new Date("2026-09-12"),
          status: "due",
          sequence: 2,
        },
        { upsert: true },
      );
    }
    await Referral.updateOne(
      { referrer: student._id, refereePhone: "9876500001" },
      {
        referrer: student._id,
        code: "AARAV1847",
        refereePhone: "9876500001",
        status: "successful",
        rewardType: "fixed",
        rewardValue: 500,
        payoutStatus: "pending",
      },
      { upsert: true },
    );
    const today = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      if (date.getDay() === 0) continue;
      await Attendance.updateOne(
        { student: student._id, date: new Date(date.toDateString()), session: "default" },
        {
          student: student._id,
          batch: batchByKey.get("pgdca:Evening"),
          course: pgdcaId,
          date: new Date(date.toDateString()),
          session: "default",
          status: i === 3 ? "late" : i === 7 ? "absent" : "present",
        },
        { upsert: true },
      );
    }
  }

  const note = await Notification.findOneAndUpdate(
    { title: "Fee installment reminder" },
    {
      type: "fee_due",
      title: "Fee installment reminder",
      body: "Your next PGDCA installment is due this week. Pay at campus or online.",
      audience: "STUDENT",
      student: student._id,
      sentAt: new Date(),
    },
    { upsert: true, new: true },
  );
  if (note) {
    await NotificationReceipt.updateOne(
      { notification: note._id, student: student._id },
      { notification: note._id, student: student._id },
      { upsert: true },
    );
  }

  logger.info("Seed complete — courses, CMS, student OPT-2024-1847 / optech1847");
  process.exit(0);
}

seed().catch((err) => {
  logger.fatal({ err }, "Seed failed");
  process.exit(1);
});
