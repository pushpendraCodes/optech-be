export const DEFAULT_WEBSITE_SETTINGS = {
  name: "Optech Computer Institute",
  email: "info@optech-deori.edu.in",
  mobile: "+91 0712 253 4587",
  address: "Ward No. 04, Ganesh Chowk, behind Shitala Mata Mandir, Deori, Maharashtra 441901",
  logo: null as null | Record<string, unknown>,
};

export async function getWebsiteSettings() {
  const { Setting } = await import("../models/index.ts");
  const row = await Setting.findOne({ key: "website" }).lean();
  const value = (row?.value as typeof DEFAULT_WEBSITE_SETTINGS | undefined) ?? {};
  return { ...DEFAULT_WEBSITE_SETTINGS, ...value };
}

export async function saveWebsiteSettings(body: {
  name: string;
  email: string;
  mobile: string;
  address: string;
  logo?: Record<string, unknown> | null;
}) {
  const { Setting } = await import("../models/index.ts");
  const value = {
    name: body.name.trim(),
    email: body.email.trim(),
    mobile: body.mobile.trim(),
    address: body.address.trim(),
    logo: body.logo ?? null,
  };
  const row = await Setting.findOneAndUpdate({ key: "website" }, { key: "website", value }, { upsert: true, new: true });
  return row.value;
}
