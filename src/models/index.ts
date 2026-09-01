import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { CloudinaryAsset, Localized } from "../types/common.ts";

const AssetSchema = new Schema<CloudinaryAsset>(
  {
    publicId: String,
    url: String,
    resourceType: String,
    format: String,
    bytes: Number,
    width: Number,
    height: Number,
  },
  { _id: false },
);

const LocSchema = new Schema<Localized>(
  { en: { type: String, required: true }, hi: String, mr: String },
  { _id: false },
);

export interface PermissionDoc extends Document {
  key: string;
  description: string;
}
const PermissionSchema = new Schema<PermissionDoc>(
  { key: { type: String, unique: true, required: true }, description: String },
  { timestamps: true },
);

export interface RoleDoc extends Document {
  key: string;
  name: string;
  permissions: string[];
  isSystem: boolean;
}
const RoleSchema = new Schema<RoleDoc>(
  {
    key: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    permissions: [{ type: String }],
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export interface UserDoc extends Document {
  kind: "student" | "staff";
  name: string;
  email?: string;
  phone?: string;
  studentCode?: string;
  passwordHash: string;
  roles: Types.ObjectId[];
  status: "active" | "blocked" | "pending";
  refreshTokenHash?: string;
  passwordChangedAt?: Date;
  lastLoginAt?: Date;
  pushToken?: string;
}
const UserSchema = new Schema<UserDoc>(
  {
    kind: { type: String, enum: ["student", "staff"], required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, lowercase: true, sparse: true, index: true },
    phone: { type: String, sparse: true, index: true },
    studentCode: { type: String, sparse: true, unique: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    roles: [{ type: Schema.Types.ObjectId, ref: "Role" }],
    status: { type: String, enum: ["active", "blocked", "pending"], default: "active", index: true },
    refreshTokenHash: { type: String, select: false },
    passwordChangedAt: Date,
    lastLoginAt: Date,
    pushToken: String,
  },
  { timestamps: true },
);

export interface StudentDoc extends Document {
  user: Types.ObjectId;
  studentCode: string;
  rollNumber?: string;
  parentPhone?: string;
  address?: string;
  dob?: Date;
  photo?: CloudinaryAsset;
  idProof?: CloudinaryAsset;
  batch?: Types.ObjectId;
  referralCode: string;
  validTill?: Date;
  blocked: boolean;
  pushToken?: string;
}
const StudentSchema = new Schema<StudentDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", unique: true, required: true },
    studentCode: { type: String, unique: true, required: true, index: true },
    rollNumber: String,
    parentPhone: String,
    address: String,
    dob: Date,
    photo: AssetSchema,
    idProof: AssetSchema,
    batch: { type: Schema.Types.ObjectId, ref: "Batch" },
    referralCode: { type: String, unique: true, required: true, index: true },
    validTill: Date,
    blocked: { type: Boolean, default: false },
    pushToken: String,
  },
  { timestamps: true },
);

export interface CategoryDoc extends Document {
  name: Localized;
  slug: string;
  active: boolean;
  sortOrder: number;
}
const CategorySchema = new Schema<CategoryDoc>(
  {
    name: LocSchema,
    slug: { type: String, unique: true, required: true, index: true },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const ModuleSchema = new Schema(
  { title: { type: String, required: true }, topics: [String] },
  { _id: true },
);

export interface CourseDoc extends Document {
  title: Localized;
  slug: string;
  description: Localized;
  shortDescription?: Localized;
  thumbnail?: CloudinaryAsset;
  category: Types.ObjectId;
  duration: string;
  durationMonths: number;
  mode: "offline" | "online";
  fee: number;
  discount: number;
  syllabus: { title: string; topics: string[] }[];
  instructors: Types.ObjectId[];
  certificate?: string;
  demoVideo?: string;
  tags: string[];
  popular: boolean;
  new: boolean;
  trending: boolean;
  active: boolean;
  deletedAt?: Date;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
}
const CourseSchema = new Schema<CourseDoc>(
  {
    title: LocSchema,
    slug: { type: String, unique: true, required: true, index: true },
    description: LocSchema,
    shortDescription: LocSchema,
    thumbnail: AssetSchema,
    category: { type: Schema.Types.ObjectId, ref: "CourseCategory", required: true, index: true },
    duration: String,
    durationMonths: Number,
    mode: { type: String, enum: ["offline", "online"], default: "offline" },
    fee: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    syllabus: [ModuleSchema],
    instructors: [{ type: Schema.Types.ObjectId, ref: "Staff" }],
    certificate: String,
    demoVideo: String,
    tags: [String],
    popular: { type: Boolean, default: false },
    new: { type: Boolean, default: false },
    trending: { type: Boolean, default: false },
    active: { type: Boolean, default: true, index: true },
    deletedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
CourseSchema.index({ active: 1, slug: 1 });

export interface BatchDoc extends Document {
  course: Types.ObjectId;
  label: string;
  timing: string;
  seats: number;
  start: Date;
  teachers: Types.ObjectId[];
  active: boolean;
}
const BatchSchema = new Schema<BatchDoc>(
  {
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    label: String,
    timing: String,
    seats: Number,
    start: Date,
    teachers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export interface StaffDoc extends Document {
  name: string;
  role: string;
  focus?: string;
  bio?: string;
  photo?: CloudinaryAsset;
  linkedin?: string;
  twitter?: string;
  website?: string;
  courses: Types.ObjectId[];
  published: boolean;
  sortOrder: number;
}
const StaffSchema = new Schema<StaffDoc>(
  {
    name: { type: String, required: true },
    role: String,
    focus: String,
    bio: String,
    photo: AssetSchema,
    linkedin: String,
    twitter: String,
    website: String,
    courses: [{ type: Schema.Types.ObjectId, ref: "Course" }],
    published: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export interface CouponDoc extends Document {
  code: string;
  label: string;
  type: "percent" | "fixed";
  value: number;
  active: boolean;
  startsAt?: Date;
  endsAt?: Date;
  maxRedemptions?: number;
  used: number;
}
const CouponSchema = new Schema<CouponDoc>(
  {
    code: { type: String, unique: true, uppercase: true, required: true, index: true },
    label: String,
    type: { type: String, enum: ["percent", "fixed"], default: "percent" },
    value: { type: Number, required: true },
    active: { type: Boolean, default: true },
    startsAt: Date,
    endsAt: Date,
    maxRedemptions: Number,
    used: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export interface EnrollmentDoc extends Document {
  student: Types.ObjectId;
  course: Types.ObjectId;
  batch?: Types.ObjectId;
  status: "pending" | "active" | "cancelled" | "completed";
  progress: number;
  feePlan: "full" | "installment";
  source: "online" | "offline";
  agreedFee?: number;
  listFee?: number;
  discount?: number;
  couponCode?: string;
}
const EnrollmentSchema = new Schema<EnrollmentDoc>(
  {
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    batch: { type: Schema.Types.ObjectId, ref: "Batch" },
    status: { type: String, enum: ["pending", "active", "cancelled", "completed"], default: "pending" },
    progress: { type: Number, default: 0 },
    feePlan: { type: String, enum: ["full", "installment"], default: "full" },
    source: { type: String, enum: ["online", "offline"], default: "online" },
    agreedFee: Number,
    listFee: Number,
    discount: Number,
    couponCode: String,
  },
  { timestamps: true },
);
EnrollmentSchema.index({ student: 1, course: 1 }, { unique: true });

export interface PaymentDoc extends Document {
  student?: Types.ObjectId;
  enrollment?: Types.ObjectId;
  course?: Types.ObjectId;
  amount: number;
  listFee?: number;
  discount?: number;
  couponCode?: string;
  currency: string;
  status: "created" | "pending" | "paid" | "failed" | "refunded";
  mode: "razorpay" | "cash" | "upi";
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  webhookEventId?: string;
  receiptUrl?: string;
  notes?: string;
  payerName?: string;
  payerEmail?: string;
  payerPhone?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const PaymentSchema = new Schema<PaymentDoc>(
  {
    student: { type: Schema.Types.ObjectId, ref: "Student", index: true },
    enrollment: { type: Schema.Types.ObjectId, ref: "Enrollment" },
    course: { type: Schema.Types.ObjectId, ref: "Course" },
    amount: { type: Number, required: true },
    listFee: Number,
    discount: Number,
    couponCode: { type: String, index: true },
    currency: { type: String, default: "INR" },
    status: {
      type: String,
      enum: ["created", "pending", "paid", "failed", "refunded"],
      default: "created",
      index: true,
    },
    mode: { type: String, enum: ["razorpay", "cash", "upi"], default: "razorpay" },
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String, index: true },
    razorpaySignature: String,
    webhookEventId: { type: String, unique: true, sparse: true },
    receiptUrl: String,
    notes: String,
    payerName: { type: String, index: true },
    payerEmail: { type: String, index: true },
    payerPhone: { type: String, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export interface InstallmentDoc extends Document {
  enrollment: Types.ObjectId;
  student: Types.ObjectId;
  amount: number;
  dueDate: Date;
  status: "due" | "paid" | "overdue";
  payment?: Types.ObjectId;
  sequence: number;
}
const InstallmentSchema = new Schema<InstallmentDoc>(
  {
    enrollment: { type: Schema.Types.ObjectId, ref: "Enrollment", required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    amount: Number,
    dueDate: { type: Date, index: true },
    status: { type: String, enum: ["due", "paid", "overdue"], default: "due" },
    payment: { type: Schema.Types.ObjectId, ref: "Payment" },
    sequence: Number,
  },
  { timestamps: true },
);

export interface AdmissionDoc extends Document {
  student?: Types.ObjectId;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  dob?: Date;
  parentPhone?: string;
  course: Types.ObjectId;
  batch?: Types.ObjectId;
  status: "draft" | "hold" | "confirmed" | "cancelled";
  feePlan: "full" | "installment";
  paymentMode: "cash" | "online";
  photo?: CloudinaryAsset;
  idProof?: CloudinaryAsset;
  referrerCode?: string;
  notes?: string;
  createdBy?: Types.ObjectId;
}
const AdmissionSchema = new Schema<AdmissionDoc>(
  {
    student: { type: Schema.Types.ObjectId, ref: "Student" },
    name: String,
    phone: String,
    email: String,
    address: String,
    dob: Date,
    parentPhone: String,
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    batch: { type: Schema.Types.ObjectId, ref: "Batch" },
    status: { type: String, enum: ["draft", "hold", "confirmed", "cancelled"], default: "draft", index: true },
    feePlan: { type: String, enum: ["full", "installment"], default: "full" },
    paymentMode: { type: String, enum: ["cash", "online"], default: "online" },
    photo: AssetSchema,
    idProof: AssetSchema,
    referrerCode: String,
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export interface AttendanceDoc extends Document {
  student: Types.ObjectId;
  batch: Types.ObjectId;
  course: Types.ObjectId;
  date: Date;
  session?: string;
  status: "present" | "absent" | "late";
  markedBy?: Types.ObjectId;
}
const AttendanceSchema = new Schema<AttendanceDoc>(
  {
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    batch: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    date: { type: Date, required: true },
    session: { type: String, default: "default" },
    status: { type: String, enum: ["present", "absent", "late"], required: true },
    markedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
AttendanceSchema.index({ student: 1, date: 1, session: 1 }, { unique: true });
AttendanceSchema.index({ batch: 1, date: 1 });

export interface QuizQuestion {
  type: "mcq" | "tf" | "blank";
  prompt: string;
  options: string[];
  answerIndex: number;
  marks: number;
  negativeMarks?: number;
  difficulty?: "easy" | "medium" | "hard";
  explanation?: string;
  topic?: string;
  tags?: string[];
  bankId?: Types.ObjectId;
}

const QuizQuestionSchema = {
  type: { type: String, enum: ["mcq", "tf", "blank"], default: "mcq" },
  prompt: String,
  options: [String],
  answerIndex: Number,
  marks: { type: Number, default: 1 },
  negativeMarks: { type: Number, default: 0 },
  difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
  explanation: String,
  topic: String,
  tags: [String],
  bankId: { type: Schema.Types.ObjectId, ref: "QuestionBank" },
};

export interface QuizDoc extends Document {
  title: string;
  description?: string;
  course: Types.ObjectId;
  subject?: string;
  minutes: number;
  passing: number;
  negative: boolean;
  negativeValue: number;
  scheduledAt?: Date;
  endsAt?: Date;
  open: boolean;
  questions: QuizQuestion[];
}
const QuizSchema = new Schema<QuizDoc>(
  {
    title: String,
    description: String,
    course: { type: Schema.Types.ObjectId, ref: "Course", index: true },
    subject: { type: String, index: true },
    minutes: Number,
    passing: Number,
    negative: { type: Boolean, default: false },
    negativeValue: { type: Number, default: 0.25 },
    scheduledAt: Date,
    endsAt: Date,
    open: { type: Boolean, default: false, index: true },
    questions: [QuizQuestionSchema],
  },
  { timestamps: true },
);

export interface QuestionBankDoc extends Document {
  course?: Types.ObjectId;
  subject?: string;
  topic?: string;
  tags: string[];
  type: "mcq" | "tf" | "blank";
  prompt: string;
  options: string[];
  answerIndex: number;
  marks: number;
  negativeMarks: number;
  difficulty: "easy" | "medium" | "hard";
  explanation?: string;
  active: boolean;
}
const QuestionBankSchema = new Schema<QuestionBankDoc>(
  {
    course: { type: Schema.Types.ObjectId, ref: "Course", index: true },
    subject: { type: String, index: true },
    topic: { type: String, index: true },
    tags: [String],
    type: { type: String, enum: ["mcq", "tf", "blank"], default: "mcq" },
    prompt: { type: String, required: true },
    options: [String],
    answerIndex: Number,
    marks: { type: Number, default: 1 },
    negativeMarks: { type: Number, default: 0 },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    explanation: String,
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export interface QuizAttemptDoc extends Document {
  quiz: Types.ObjectId;
  student: Types.ObjectId;
  startedAt: Date;
  submittedAt?: Date;
  answers: { questionId: string; value: string | number }[];
  score?: number;
  percent?: number;
  correct?: number;
  wrong?: number;
  skipped?: number;
  timeTakenSeconds?: number;
  status: "in_progress" | "submitted" | "auto_submitted";
}
const QuizAttemptSchema = new Schema<QuizAttemptDoc>(
  {
    quiz: { type: Schema.Types.ObjectId, ref: "Quiz", required: true },
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    startedAt: Date,
    submittedAt: Date,
    answers: [{ questionId: String, value: Schema.Types.Mixed }],
    score: Number,
    percent: Number,
    correct: Number,
    wrong: Number,
    skipped: Number,
    timeTakenSeconds: Number,
    status: { type: String, enum: ["in_progress", "submitted", "auto_submitted"], default: "in_progress" },
  },
  { timestamps: true },
);
QuizAttemptSchema.index({ quiz: 1, student: 1, status: 1 });

export interface TypingParagraphDoc extends Document {
  language: "en" | "hi";
  text: string;
  active: boolean;
}
const TypingParagraphSchema = new Schema<TypingParagraphDoc>(
  {
    language: { type: String, enum: ["en", "hi"], required: true },
    text: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export interface TypingAttemptDoc extends Document {
  student: Types.ObjectId;
  language: "en" | "hi";
  minutes: number;
  typed: string;
  source: string;
  wpm: number;
  accuracy: number;
  errorCount: number;
}
const TypingAttemptSchema = new Schema<TypingAttemptDoc>(
  {
    student: { type: Schema.Types.ObjectId, ref: "Student", index: true },
    language: { type: String, enum: ["en", "hi"] },
    minutes: Number,
    typed: String,
    source: String,
    wpm: Number,
    accuracy: Number,
    errorCount: Number,
  },
  { timestamps: true },
);

export interface StudyMaterialDoc extends Document {
  course: Types.ObjectId;
  chapter: string;
  title: string;
  type: "pdf" | "doc" | "video" | "link";
  asset?: CloudinaryAsset;
  externalUrl?: string;
  views: number;
  published: boolean;
}
const StudyMaterialSchema = new Schema<StudyMaterialDoc>(
  {
    course: { type: Schema.Types.ObjectId, ref: "Course", index: true },
    chapter: String,
    title: String,
    type: { type: String, enum: ["pdf", "doc", "video", "link"] },
    asset: AssetSchema,
    externalUrl: String,
    views: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export interface NoticeDoc extends Document {
  title: Localized;
  body: Localized;
  category: "general" | "exam" | "holiday" | "urgent";
  pinned: boolean;
  audience: "ALL" | "COURSE" | "BATCH";
  course?: Types.ObjectId;
  batch?: Types.ObjectId;
  expiresAt?: Date;
  published: boolean;
}
const NoticeSchema = new Schema<NoticeDoc>(
  {
    title: LocSchema,
    body: LocSchema,
    category: { type: String, enum: ["general", "exam", "holiday", "urgent"], default: "general" },
    pinned: { type: Boolean, default: false },
    audience: { type: String, enum: ["ALL", "COURSE", "BATCH"], default: "ALL" },
    course: { type: Schema.Types.ObjectId, ref: "Course" },
    batch: { type: Schema.Types.ObjectId, ref: "Batch" },
    expiresAt: Date,
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export interface NotificationDoc extends Document {
  type: "fee_due" | "notice" | "exam" | "live_class" | "admission" | "general";
  title: string;
  body: string;
  audience: "ALL" | "COURSE" | "BATCH" | "STUDENT";
  course?: Types.ObjectId;
  batch?: Types.ObjectId;
  student?: Types.ObjectId;
  scheduledAt?: Date;
  sentAt?: Date;
  createdBy?: Types.ObjectId;
}
const NotificationSchema = new Schema<NotificationDoc>(
  {
    type: { type: String, enum: ["fee_due", "notice", "exam", "live_class", "admission", "general"] },
    title: String,
    body: String,
    audience: { type: String, enum: ["ALL", "COURSE", "BATCH", "STUDENT"] },
    course: { type: Schema.Types.ObjectId, ref: "Course" },
    batch: { type: Schema.Types.ObjectId, ref: "Batch" },
    student: { type: Schema.Types.ObjectId, ref: "Student", index: true },
    scheduledAt: Date,
    sentAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export interface NotificationReceiptDoc extends Document {
  notification: Types.ObjectId;
  student: Types.ObjectId;
  readAt?: Date;
}
const NotificationReceiptSchema = new Schema<NotificationReceiptDoc>(
  {
    notification: { type: Schema.Types.ObjectId, ref: "Notification", required: true },
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    readAt: Date,
  },
  { timestamps: true },
);
NotificationReceiptSchema.index({ student: 1, readAt: 1 });
NotificationReceiptSchema.index({ notification: 1, student: 1 }, { unique: true });

export interface AdminAlertDoc extends Document {
  type: string;
  title: string;
  body: string;
  link?: string;
}
const AdminAlertSchema = new Schema<AdminAlertDoc>(
  {
    type: { type: String, default: "general" },
    title: String,
    body: String,
    link: String,
  },
  { timestamps: true },
);

export interface AdminAlertReceiptDoc extends Document {
  alert: Types.ObjectId;
  user: Types.ObjectId;
  readAt?: Date;
}
const AdminAlertReceiptSchema = new Schema<AdminAlertReceiptDoc>(
  {
    alert: { type: Schema.Types.ObjectId, ref: "AdminAlert", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    readAt: Date,
  },
  { timestamps: true },
);
AdminAlertReceiptSchema.index({ alert: 1, user: 1 }, { unique: true });
AdminAlertReceiptSchema.index({ user: 1, readAt: 1 });

export interface LiveClassDoc extends Document {
  title: string;
  course: Types.ObjectId;
  batch?: Types.ObjectId;
  youtubeUrl?: string;
  youtubeId?: string;
  startsAt: Date;
  endsAt?: Date;
  isLive: boolean;
  notifyAt?: Date;
}
const LiveClassSchema = new Schema<LiveClassDoc>(
  {
    title: String,
    course: { type: Schema.Types.ObjectId, ref: "Course" },
    batch: { type: Schema.Types.ObjectId, ref: "Batch" },
    youtubeUrl: String,
    youtubeId: String,
    startsAt: Date,
    endsAt: Date,
    isLive: { type: Boolean, default: false },
    notifyAt: Date,
  },
  { timestamps: true },
);

export interface GalleryAlbumDoc extends Document {
  title: string;
  kind: "photo" | "video";
  category?: string;
  youtubeUrl?: string;
  cover?: CloudinaryAsset;
  published: boolean;
  sortOrder: number;
}
const GalleryAlbumSchema = new Schema<GalleryAlbumDoc>(
  {
    title: String,
    kind: { type: String, enum: ["photo", "video"], default: "photo", index: true },
    category: String,
    youtubeUrl: String,
    cover: AssetSchema,
    published: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export interface GalleryMediaDoc extends Document {
  album: Types.ObjectId;
  asset: CloudinaryAsset;
  caption?: string;
}
const GalleryMediaSchema = new Schema<GalleryMediaDoc>(
  {
    album: { type: Schema.Types.ObjectId, ref: "GalleryAlbum", index: true },
    asset: AssetSchema,
    caption: String,
  },
  { timestamps: true },
);

export interface AlumniDoc extends Document {
  name: string;
  batchYear: string;
  course?: Types.ObjectId;
  role?: string;
  story?: string;
  photo?: CloudinaryAsset;
  featured: boolean;
  published: boolean;
}
const AlumniSchema = new Schema<AlumniDoc>(
  {
    name: String,
    batchYear: String,
    course: { type: Schema.Types.ObjectId, ref: "Course" },
    role: String,
    story: String,
    photo: AssetSchema,
    featured: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export interface JobDoc extends Document {
  title: string;
  employer: string;
  location: string;
  course?: Types.ObjectId;
  type: string;
  description: string;
  contact: string;
  published: boolean;
}
const JobSchema = new Schema<JobDoc>(
  {
    title: String,
    employer: String,
    location: String,
    course: { type: Schema.Types.ObjectId, ref: "Course" },
    type: String,
    description: String,
    contact: String,
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export interface VideoDoc extends Document {
  title: string;
  description?: string;
  youtubeUrl: string;
  youtubeId: string;
  category?: string;
  featured: boolean;
  published: boolean;
  sortOrder: number;
}
const VideoSchema = new Schema<VideoDoc>(
  {
    title: String,
    description: String,
    youtubeUrl: String,
    youtubeId: String,
    category: String,
    featured: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export interface ReferralDoc extends Document {
  referrer: Types.ObjectId;
  code: string;
  refereePhone?: string;
  refereeStudent?: Types.ObjectId;
  status: "pending" | "successful" | "rejected";
  rewardType: "fixed" | "percent";
  rewardValue: number;
  payoutStatus: "none" | "pending" | "paid";
}
const ReferralSchema = new Schema<ReferralDoc>(
  {
    referrer: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    code: { type: String, required: true, index: true },
    refereePhone: String,
    refereeStudent: { type: Schema.Types.ObjectId, ref: "Student" },
    status: { type: String, enum: ["pending", "successful", "rejected"], default: "pending" },
    rewardType: { type: String, enum: ["fixed", "percent"], default: "percent" },
    rewardValue: Number,
    payoutStatus: { type: String, enum: ["none", "pending", "paid"], default: "none" },
  },
  { timestamps: true },
);

export interface ScholarshipExamDoc extends Document {
  title: string;
  description?: string;
  minutes: number;
  slabs: { minPercent: number; couponPercent: number; couponPrefix: string }[];
  questions: QuizQuestion[];
  active: boolean;
}
const ScholarshipExamSchema = new Schema<ScholarshipExamDoc>(
  {
    title: String,
    description: String,
    minutes: Number,
    slabs: [{ minPercent: Number, couponPercent: Number, couponPrefix: String }],
    questions: [QuizQuestionSchema],
    active: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export interface ScholarshipResultDoc extends Document {
  exam: Types.ObjectId;
  student?: Types.ObjectId;
  name: string;
  phone: string;
  email?: string;
  score: number;
  percent: number;
  correct?: number;
  wrong?: number;
  skipped?: number;
  timeTakenSeconds?: number;
  couponCode?: string;
  redeemedAt?: Date;
  paymentId?: Types.ObjectId;
}
const ScholarshipResultSchema = new Schema<ScholarshipResultDoc>(
  {
    exam: { type: Schema.Types.ObjectId, ref: "ScholarshipExam", index: true },
    student: { type: Schema.Types.ObjectId, ref: "Student", index: true },
    name: String,
    phone: String,
    email: String,
    score: Number,
    percent: Number,
    correct: Number,
    wrong: Number,
    skipped: Number,
    timeTakenSeconds: Number,
    couponCode: { type: String, index: true },
    redeemedAt: Date,
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
  },
  { timestamps: true },
);

export interface SettingDoc extends Document {
  key: string;
  value: unknown;
}
const SettingSchema = new Schema<SettingDoc>(
  { key: { type: String, unique: true }, value: Schema.Types.Mixed },
  { timestamps: true },
);

export interface CmsItemDoc extends Document {
  kind: "marquee" | "ad" | "popup" | "link";
  title: string;
  body?: string;
  href?: string;
  cta?: string;
  image?: CloudinaryAsset;
  slot?: string;
  active: boolean;
  startsAt?: Date;
  endsAt?: Date;
  sortOrder: number;
}
const CmsItemSchema = new Schema<CmsItemDoc>(
  {
    kind: { type: String, enum: ["marquee", "ad", "popup", "link"], index: true },
    title: String,
    body: String,
    href: String,
    cta: String,
    image: AssetSchema,
    slot: String,
    active: { type: Boolean, default: true },
    startsAt: Date,
    endsAt: Date,
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export interface TranslationDoc extends Document {
  key: string;
  en: string;
  hi?: string;
  mr?: string;
}
const TranslationSchema = new Schema<TranslationDoc>(
  {
    key: { type: String, unique: true, required: true },
    en: { type: String, required: true },
    hi: String,
    mr: String,
  },
  { timestamps: true },
);

export interface AuditLogDoc extends Document {
  user?: Types.ObjectId;
  action: string;
  module: string;
  resourceId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string;
  userAgent?: string;
}
const AuditLogSchema = new Schema<AuditLogDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    action: { type: String, required: true },
    module: { type: String, required: true, index: true },
    resourceId: String,
    oldValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: true },
);
AuditLogSchema.index({ createdAt: -1 });

export interface DigitalIdCardDoc extends Document {
  student: Types.ObjectId;
  qrPayload: string;
  pdfUrl?: string;
}
const DigitalIdCardSchema = new Schema<DigitalIdCardDoc>(
  {
    student: { type: Schema.Types.ObjectId, ref: "Student", unique: true },
    qrPayload: String,
    pdfUrl: String,
  },
  { timestamps: true },
);

export interface CourseCertificateDoc extends Document {
  enrollment: Types.ObjectId;
  student: Types.ObjectId;
  course: Types.ObjectId;
  certificateNumber: string;
  issuedAt: Date;
  issuedBy?: Types.ObjectId;
  status: "issued" | "revoked";
}
const CourseCertificateSchema = new Schema<CourseCertificateDoc>(
  {
    enrollment: { type: Schema.Types.ObjectId, ref: "Enrollment", unique: true, required: true },
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    certificateNumber: { type: String, required: true, unique: true },
    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["issued", "revoked"], default: "issued" },
  },
  { timestamps: true },
);
CourseCertificateSchema.index({ student: 1, issuedAt: -1 });

export interface EnquiryDoc extends Document {
  name: string;
  email: string;
  phone: string;
  course: string;
  message?: string;
  status: "new" | "contacted" | "closed";
  source: "website";
}
const EnquirySchema = new Schema<EnquiryDoc>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true, index: true },
    course: { type: String, required: true, trim: true, index: true },
    message: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ["new", "contacted", "closed"], default: "new", index: true },
    source: { type: String, enum: ["website"], default: "website" },
  },
  { timestamps: true },
);
EnquirySchema.index({ createdAt: -1 });

export const Permission = mongoose.model("Permission", PermissionSchema);
export const Role = mongoose.model("Role", RoleSchema);
export const User = mongoose.model("User", UserSchema);
export const Student = mongoose.model("Student", StudentSchema);
export const CourseCategory = mongoose.model("CourseCategory", CategorySchema);
export const Course = mongoose.model("Course", CourseSchema);
export const Batch = mongoose.model("Batch", BatchSchema);
export const Staff = mongoose.model("Staff", StaffSchema);
export const Coupon = mongoose.model("Coupon", CouponSchema);
export const Enrollment = mongoose.model("Enrollment", EnrollmentSchema);
export const Payment = mongoose.model("Payment", PaymentSchema);
export const Installment = mongoose.model("Installment", InstallmentSchema);
export const Admission = mongoose.model("Admission", AdmissionSchema);
export const Attendance = mongoose.model("Attendance", AttendanceSchema);
export const Quiz = mongoose.model("Quiz", QuizSchema);
export const QuestionBank = mongoose.model("QuestionBank", QuestionBankSchema);
export const QuizAttempt = mongoose.model("QuizAttempt", QuizAttemptSchema);
export const TypingParagraph = mongoose.model("TypingParagraph", TypingParagraphSchema);
export const TypingAttempt = mongoose.model("TypingAttempt", TypingAttemptSchema);
export const StudyMaterial = mongoose.model("StudyMaterial", StudyMaterialSchema);
export const Notice = mongoose.model("Notice", NoticeSchema);
export const Notification = mongoose.model("Notification", NotificationSchema);
export const NotificationReceipt = mongoose.model("NotificationReceipt", NotificationReceiptSchema);
export const AdminAlert = mongoose.model("AdminAlert", AdminAlertSchema);
export const AdminAlertReceipt = mongoose.model("AdminAlertReceipt", AdminAlertReceiptSchema);
export const LiveClass = mongoose.model("LiveClass", LiveClassSchema);
export const GalleryAlbum = mongoose.model("GalleryAlbum", GalleryAlbumSchema);
export const GalleryMedia = mongoose.model("GalleryMedia", GalleryMediaSchema);
export const Alumni = mongoose.model("Alumni", AlumniSchema);
export const Job = mongoose.model("Job", JobSchema);
export const Video = mongoose.model("Video", VideoSchema);
export const Referral = mongoose.model("Referral", ReferralSchema);
export const ScholarshipExam = mongoose.model("ScholarshipExam", ScholarshipExamSchema);
export const ScholarshipResult = mongoose.model("ScholarshipResult", ScholarshipResultSchema);
export const Setting = mongoose.model("Setting", SettingSchema);
export const CmsItem = mongoose.model("CmsItem", CmsItemSchema);
export const Translation = mongoose.model("Translation", TranslationSchema);
export const AuditLog = mongoose.model("AuditLog", AuditLogSchema);
export const DigitalIdCard = mongoose.model("DigitalIdCard", DigitalIdCardSchema);
export const CourseCertificate = mongoose.model("CourseCertificate", CourseCertificateSchema);
export const Enquiry = mongoose.model("Enquiry", EnquirySchema);
