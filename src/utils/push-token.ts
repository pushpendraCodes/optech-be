import { Student, User } from "../models/index.ts";

const emptyPushToken = { $or: [{ pushToken: { $exists: false } }, { pushToken: null }, { pushToken: "" }] };

export async function saveUserPushToken(userId: string, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return { saved: false };
  await User.findByIdAndUpdate(userId, { pushToken: trimmed });
  return { saved: true };
}

export async function saveStudentPushToken(studentId: string, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return { saved: false };
  await Student.findByIdAndUpdate(studentId, { pushToken: trimmed });
  return { saved: true };
}

export async function saveUserPushTokenIfEmpty(userId: string, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return { saved: false };
  const result = await User.updateOne({ _id: userId, ...emptyPushToken }, { $set: { pushToken: trimmed } });
  return { saved: result.modifiedCount > 0 };
}

export async function saveStudentPushTokenIfEmpty(studentId: string, token: string) {
  const trimmed = token.trim();
  if (!trimmed) return { saved: false };
  const result = await Student.updateOne({ _id: studentId, ...emptyPushToken }, { $set: { pushToken: trimmed } });
  return { saved: result.modifiedCount > 0 };
}

export async function clearUserPushToken(userId: string) {
  await User.findByIdAndUpdate(userId, { $unset: { pushToken: 1 } });
}

export async function clearStudentPushToken(studentId: string) {
  await Student.findByIdAndUpdate(studentId, { $unset: { pushToken: 1 } });
}
