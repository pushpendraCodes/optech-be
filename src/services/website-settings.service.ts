export const DEFAULT_WEBSITE_SETTINGS = {
  name: "Optech Computer Institute of Technology",
  email: "info@optech-deori.edu.in",
  mobile: "+91 0712 253 4587",
  address: "Ward No. 04, Ganesh Chowk, behind Shitala Mata Mandir, Deori, Maharashtra 441901",
  logo: null as null | Record<string, unknown>,
  /** Show advertisement Box 1 on the website */
  adBox1Enabled: true,
  /** Show advertisement Box 2 on the website */
  adBox2Enabled: true,
};

export async function getWebsiteSettings() {
  const { Setting } = await import("../models/index.ts");
  const row = await Setting.findOne({ key: "website" }).lean();
  const value = (row?.value as Partial<typeof DEFAULT_WEBSITE_SETTINGS> | undefined) ?? {};
  return { ...DEFAULT_WEBSITE_SETTINGS, ...value };
}

export async function saveWebsiteSettings(body: {
  name?: string;
  email?: string;
  mobile?: string;
  address?: string;
  logo?: Record<string, unknown> | null;
  adBox1Enabled?: boolean;
  adBox2Enabled?: boolean;
}) {
  const { Setting } = await import("../models/index.ts");
  const current = await getWebsiteSettings();
  const value = {
    name: body.name !== undefined ? body.name.trim() : current.name,
    email: body.email !== undefined ? body.email.trim() : current.email,
    mobile: body.mobile !== undefined ? body.mobile.trim() : current.mobile,
    address: body.address !== undefined ? body.address.trim() : current.address,
    logo: body.logo !== undefined ? body.logo : current.logo,
    adBox1Enabled: body.adBox1Enabled !== undefined ? Boolean(body.adBox1Enabled) : Boolean(current.adBox1Enabled),
    adBox2Enabled: body.adBox2Enabled !== undefined ? Boolean(body.adBox2Enabled) : Boolean(current.adBox2Enabled),
  };
  const row = await Setting.findOneAndUpdate({ key: "website" }, { key: "website", value }, { upsert: true, new: true });
  return row.value;
}
