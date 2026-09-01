import { env } from "../config/env.ts";

export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Optech Computer Institute API",
    version: "1.0.0",
    description:
      "Public website, student portal, and admin panel APIs. Authenticate with Bearer access tokens from /auth/student/login or /auth/admin/login.",
  },
  servers: [{ url: env.API_PREFIX }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Success: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          message: { type: "string" },
          data: { type: "object" },
          meta: { type: "object" },
        },
      },
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          message: { type: "string" },
          errors: { type: "array" },
          code: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/auth/student/login": {
      post: {
        tags: ["Auth"],
        summary: "Student login (issued ID + password, no self-register)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { properties: { studentId: { type: "string" }, password: { type: "string" } } } } },
        },
        responses: { "200": { description: "OK" }, "401": { description: "Invalid" } },
      },
    },
    "/auth/admin/login": {
      post: {
        tags: ["Auth"],
        summary: "Admin/staff login",
        responses: { "200": { description: "OK" } },
      },
    },
    "/public/courses": { get: { tags: ["Public"], summary: "List published courses" } },
    "/public/courses/{slug}": { get: { tags: ["Public"], summary: "Course detail" } },
    "/public/enroll/checkout": { post: { tags: ["Payments"], summary: "Create Razorpay order" } },
    "/public/enroll/verify": { post: { tags: ["Payments"], summary: "Verify checkout signature" } },
    "/webhooks/razorpay": { post: { tags: ["Payments"], summary: "Razorpay webhook (signature + idempotency)" } },
    "/student/dashboard": { get: { tags: ["Student"], security: [{ bearerAuth: [] }], summary: "Own dashboard" } },
    "/student/attendance": { get: { tags: ["Student"], security: [{ bearerAuth: [] }], summary: "Own attendance calendar" } },
    "/admin/courses": {
      get: { tags: ["Admin"], security: [{ bearerAuth: [] }], summary: "Paginated courses (course:read)" },
      post: { tags: ["Admin"], security: [{ bearerAuth: [] }], summary: "Create course (course:create)" },
    },
    "/admin/attendance/bulk": { post: { tags: ["Admin"], security: [{ bearerAuth: [] }], summary: "Bulk mark attendance" } },
    "/admin/admissions/{id}/confirm": { post: { tags: ["Admin"], security: [{ bearerAuth: [] }], summary: "Confirm admission and issue credentials" } },
  },
};
