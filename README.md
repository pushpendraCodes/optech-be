# Optech API

Production backend for the Optech Computer Institute public website, student portal, and admin panel.

## Stack

Node.js 20+, Express, TypeScript, MongoDB/Mongoose, Redis, Zod, JWT + Argon2, Cloudinary, Razorpay, BullMQ, pdf-lib.

## Setup

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

API: `http://localhost:4000/api/v1`  
Swagger: `http://localhost:4000/api/v1/docs`  
Health: `http://localhost:4000/health`

## Auth

Students **cannot self-register**. IDs are issued on admission/payment.

| Flow | Endpoint |
|------|----------|
| Student login | `POST /api/v1/auth/student/login` `{ studentId, password }` |
| Admin login | `POST /api/v1/auth/admin/login` `{ email, password }` |
| Refresh | `POST /api/v1/auth/refresh` |
| Logout | `POST /api/v1/auth/logout` |

Send `Authorization: Bearer <accessToken>`. Refresh token is also set as an httpOnly cookie.

Roles: `SUPER_ADMIN`, `ADMIN`, `STAFF`, `TEACHER` with permission middleware such as `requirePermission("course:create")`.

## Route groups

- `/api/v1/public/*` — courses, gallery, jobs, calculator, checkout, scholarship (no login)
- `/api/v1/student/*` — own dashboard, attendance, notes, quizzes, typing, fees, ID card, referrals
- `/api/v1/admin/*` — RBAC-protected CMS, admissions, attendance, payments, notifications
- `/api/v1/webhooks/razorpay` — raw body, HMAC verify, Redis idempotency

Student APIs always use `req.auth.studentId` from the JWT. They never trust a client-supplied student id.

## Payments

Checkout creates a Razorpay order. Success is **not** trusted from the frontend. The server verifies `orderId|paymentId` HMAC and/or the webhook signature, then:

1. upserts the student (issues credentials if new)
2. creates enrollment
3. records payment + installments
4. queues an admission notification

Duplicate webhook event IDs are ignored.

## Tests

```bash
npm test
```

Covers coupon/installment/scholarship/referral math, quiz + typing grading, and HMAC shape.

## Architecture

Feature services live under `src/modules`. Shared models are in `src/models`. Integrations (Cloudinary, Razorpay, WhatsApp/email stubs, YouTube, PDF, queues) are in `src/services` and `src/jobs`.
