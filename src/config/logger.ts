import pino from "pino";

export const logger = pino({
  level: "info",
  base: undefined,
  timestamp: false,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "passwordHash",
      "token",
      "refreshToken",
      "accessToken",
      "RAZORPAY_KEY_SECRET",
      "CLOUDINARY_API_SECRET",
    ],
    remove: true,
  },
});
