import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import axios from "axios";

const BROWN = rgb(0.42, 0.27, 0.2);
const BROWN_DARK = rgb(0.32, 0.2, 0.15);
const CREAM = rgb(0.98, 0.93, 0.87);
const GOLD = rgb(0.9, 0.72, 0.25);
const WHITE = rgb(1, 1, 1);
const TEXT = rgb(0.35, 0.22, 0.16);
const PHOTO_BG = rgb(0.9, 0.84, 0.78);

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

async function embedPhoto(doc: PDFDocument, url?: string) {
  if (!url) return null;
  try {
    const { data, headers } = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 10000,
    });
    const bytes = new Uint8Array(data);
    const type = String(headers["content-type"] ?? "").toLowerCase();
    if (type.includes("png") || url.toLowerCase().includes(".png")) {
      return doc.embedPng(bytes);
    }
    return doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

function drawLogo(
  page: ReturnType<PDFDocument["getPages"]>[number],
  cx: number,
  cy: number,
  r: number,
) {
  page.drawCircle({ x: cx, y: cy, size: r, color: BROWN_DARK });
  page.drawCircle({ x: cx, y: cy, size: r - 2.5, borderColor: WHITE, borderWidth: 1.1 });
  page.drawCircle({ x: cx, y: cy, size: r - 5, borderColor: GOLD, borderWidth: 0.8 });
  const petal = r * 0.32;
  for (const [dx, dy] of [
    [0, petal * 0.55],
    [-petal * 0.65, -petal * 0.15],
    [petal * 0.65, -petal * 0.15],
    [0, -petal * 0.5],
  ] as const) {
    page.drawEllipse({
      x: cx + dx,
      y: cy + dy,
      xScale: petal * 0.42,
      yScale: petal * 0.65,
      color: WHITE,
    });
  }
  page.drawCircle({ x: cx, y: cy - 1, size: 2, color: GOLD });
}

function inr(n: number) {
  return `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;
}

export async function buildReceiptPdf(opts: {
  studentName: string;
  studentCode: string;
  course: string;
  amount: number;
  receiptId: string;
}) {
  return buildInvoicePdf({
    instituteName: "Optech Computer Institute",
    invoiceNumber: opts.receiptId,
    date: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    payerName: opts.studentName,
    course: opts.course,
    fee: opts.amount,
    discount: 0,
    total: opts.amount,
  });
}

export async function buildInvoicePdf(opts: {
  instituteName: string;
  instituteEmail?: string;
  institutePhone?: string;
  instituteAddress?: string;
  invoiceNumber: string;
  date: string;
  payerName: string;
  payerEmail?: string;
  payerPhone?: string;
  course: string;
  fee: number;
  discount: number;
  total: number;
  paymentId?: string;
  orderId?: string;
  mode?: string;
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const H = 842;
  const ink = rgb(0.12, 0.12, 0.14);
  const muted = rgb(0.4, 0.4, 0.44);
  const line = rgb(0.9, 0.9, 0.92);
  const gold = rgb(0.83, 0.64, 0.18);
  const navy = rgb(0.1, 0.12, 0.18);
  const cream = rgb(0.99, 0.97, 0.93);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
  page.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: gold });
  page.drawRectangle({ x: 0, y: H - 118, width: W, height: 108, color: navy });

  drawLogo(page, 52, H - 64, 20);
  page.drawText((opts.instituteName || "Optech Computer Institute").toUpperCase(), {
    x: 82,
    y: H - 52,
    size: 13,
    font: bold,
    color: WHITE,
  });
  page.drawText("TAX INVOICE  /  FEE RECEIPT", {
    x: 82,
    y: H - 70,
    size: 8,
    font,
    color: gold,
  });
  page.drawText("PAID", { x: W - 92, y: H - 48, size: 16, font: bold, color: gold });
  page.drawText(opts.invoiceNumber, { x: W - 150, y: H - 68, size: 9, font, color: WHITE });
  page.drawText(opts.date, { x: W - 150, y: H - 82, size: 9, font, color: rgb(0.75, 0.75, 0.78) });

  let y = H - 150;
  page.drawText("FROM", { x: 40, y, size: 8, font: bold, color: gold });
  page.drawText("BILL TO", { x: 320, y, size: 8, font: bold, color: gold });
  y -= 18;
  page.drawText(opts.instituteName || "Optech Computer Institute", { x: 40, y, size: 11, font: bold, color: ink });
  page.drawText(opts.payerName, { x: 320, y, size: 11, font: bold, color: ink });
  y -= 14;
  const fromLines = [
    opts.instituteAddress,
    opts.institutePhone ? `Tel ${opts.institutePhone}` : "",
    opts.instituteEmail,
  ].filter(Boolean) as string[];
  const toLines = [opts.payerPhone, opts.payerEmail].filter(Boolean) as string[];
  const maxLines = Math.max(fromLines.length, toLines.length, 1);
  for (let i = 0; i < maxLines; i++) {
    if (fromLines[i]) {
      wrapText(font, fromLines[i], 9, 250).slice(0, 2).forEach((line, li) => {
        page.drawText(line, { x: 40, y: y - li * 12, size: 9, font, color: muted });
      });
    }
    if (toLines[i]) page.drawText(toLines[i], { x: 320, y, size: 9, font, color: muted });
    y -= 14;
  }

  y -= 18;
  page.drawRectangle({ x: 40, y: y - 8, width: W - 80, height: 26, color: navy });
  page.drawText("DESCRIPTION", { x: 52, y: y, size: 8, font: bold, color: WHITE });
  page.drawText("AMOUNT", { x: W - 120, y, size: 8, font: bold, color: WHITE });
  y -= 28;
  page.drawRectangle({ x: 40, y: y - 10, width: W - 80, height: 32, color: cream });
  const courseLines = wrapText(font, opts.course || "Course fee", 10, 360);
  page.drawText(courseLines[0], { x: 52, y, size: 10, font: bold, color: ink });
  if (courseLines[1]) page.drawText(courseLines[1], { x: 52, y: y - 12, size: 8, font, color: muted });
  const feeLabel = inr(opts.fee);
  page.drawText(feeLabel, { x: W - 52 - bold.widthOfTextAtSize(feeLabel, 10), y, size: 10, font: bold, color: ink });

  y -= 36;
  if (opts.discount > 0) {
    page.drawText("Discount", { x: 52, y, size: 10, font, color: muted });
    const d = `- ${inr(opts.discount)}`;
    page.drawText(d, { x: W - 52 - font.widthOfTextAtSize(d, 10), y, size: 10, font, color: muted });
    y -= 20;
  }
  page.drawLine({ start: { x: 40, y: y + 8 }, end: { x: W - 40, y: y + 8 }, thickness: 1, color: line });
  page.drawText("Amount paid", { x: 52, y: y - 8, size: 12, font: bold, color: ink });
  const total = inr(opts.total);
  page.drawText(total, { x: W - 52 - bold.widthOfTextAtSize(total, 14), y: y - 8, size: 14, font: bold, color: gold });

  y -= 48;
  page.drawRectangle({ x: 40, y: y - 54, width: W - 80, height: 70, borderColor: line, borderWidth: 1 });
  page.drawText("PAYMENT DETAILS", { x: 52, y: y + 2, size: 8, font: bold, color: gold });
  page.drawText(`Mode: ${(opts.mode || "Razorpay").toUpperCase()}`, { x: 52, y: y - 16, size: 9, font, color: ink });
  if (opts.paymentId) page.drawText(`Payment ID: ${opts.paymentId}`, { x: 52, y: y - 30, size: 8, font, color: muted });
  if (opts.orderId) page.drawText(`Order ID: ${opts.orderId}`, { x: 52, y: y - 42, size: 8, font, color: muted });

  page.drawText("Admission is confirmed by campus staff after this payment.", {
    x: 40,
    y: 78,
    size: 8,
    font,
    color: muted,
  });
  page.drawText("This is a computer-generated invoice and does not require a signature.", {
    x: 40,
    y: 64,
    size: 8,
    font,
    color: muted,
  });
  page.drawRectangle({ x: 0, y: 0, width: W, height: 28, color: navy });
  page.drawText("Thank you for choosing Optech Computer Institute", {
    x: 40,
    y: 11,
    size: 9,
    font,
    color: WHITE,
  });

  return doc.save();
}

export async function buildIdCardPdf(opts: {
  name: string;
  studentCode: string;
  course?: string;
  roll?: string;
  validTill?: string;
  mobile?: string;
  email?: string;
  address?: string;
  photoUrl?: string;
  logoUrl?: string;
  instituteName?: string;
}) {
  const W = 320;
  const H = 500;
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const photo = await embedPhoto(doc, opts.photoUrl);
  const logo = await embedPhoto(doc, opts.logoUrl);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: CREAM });

  const headerH = 78;
  page.drawRectangle({ x: 0, y: H - headerH, width: W, height: headerH, color: BROWN });
  page.drawSvgPath(`M ${W - 48},${H} L ${W},${H} L ${W},${H - 32} Z`, { color: BROWN_DARK });
  page.drawSvgPath(`M ${W - 30},${H} L ${W},${H} L ${W},${H - 20} Z`, { color: BROWN_DARK, opacity: 0.75 });

  const brand = (opts.instituteName || "Optech Computer Institute").trim();
  const brandMain = brand.split(/\s+/)[0]?.toUpperCase() || "OPTECH";
  const brandSub = brand.replace(new RegExp(`^${brand.split(/\s+/)[0]}\\s*`, "i"), "").toUpperCase() || "COMPUTER INSTITUTE";

  let textX = 66;
  if (logo) {
    const maxH = 44;
    const maxW = 44;
    const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
    const drawW = logo.width * scale;
    const drawH = logo.height * scale;
    const logoX = 16;
    const logoY = H - headerH / 2 - drawH / 2;
    page.drawRectangle({
      x: logoX - 2,
      y: logoY - 2,
      width: drawW + 4,
      height: drawH + 4,
      color: WHITE,
    });
    page.drawImage(logo, { x: logoX, y: logoY, width: drawW, height: drawH });
    textX = logoX + drawW + 10;
  } else {
    drawLogo(page, 38, H - headerH / 2 - 2, 18);
  }

  page.drawText(brandMain.slice(0, 18), { x: textX, y: H - 36, size: 14, font: bold, color: WHITE });
  if (brandSub) {
    page.drawText(brandSub.slice(0, 28), { x: textX, y: H - 52, size: 7, font: bold, color: WHITE });
  }

  // Top-left accent under header
  page.drawSvgPath(
    `M 0,${H - headerH} L 56,${H - headerH} L 44,${H - headerH - 24} L 0,${H - headerH - 24} Z`,
    { color: BROWN_DARK },
  );
  for (let i = 0; i < 4; i++) {
    const ox = 10 + i * 9;
    const y = H - headerH - 40;
    page.drawSvgPath(`M ${ox},${y} L ${ox + 5},${y} L ${ox + 11},${y + 14} L ${ox + 6},${y + 14} Z`, {
      color: GOLD,
    });
  }

  const photoW = 148;
  const photoH = 178;
  const photoX = (W - photoW) / 2;
  const photoY = H - headerH - 52 - photoH;
  page.drawRectangle({
    x: photoX - 3,
    y: photoY - 3,
    width: photoW + 6,
    height: photoH + 6,
    color: WHITE,
    borderColor: BROWN,
    borderWidth: 1.2,
  });
  page.drawRectangle({ x: photoX, y: photoY, width: photoW, height: photoH, color: PHOTO_BG });

  if (photo) {
    const scale = Math.max(photoW / photo.width, photoH / photo.height);
    const drawW = photo.width * scale;
    const drawH = photo.height * scale;
    page.drawImage(photo, {
      x: photoX + (photoW - drawW) / 2,
      y: photoY + (photoH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  } else {
    const initials = opts.name
      .split(/\s+/)
      .map((p) => p[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const label = initials || "ST";
    const tw = bold.widthOfTextAtSize(label, 28);
    page.drawText(label, {
      x: photoX + (photoW - tw) / 2,
      y: photoY + photoH / 2 - 10,
      size: 28,
      font: bold,
      color: BROWN,
    });
  }

  const labelX = 36;
  const valueX = 108;
  const maxValueW = W - valueX - 28;
  let rowY = photoY - 34;

  const rows: { label: string; value: string }[] = [
    { label: "Name", value: opts.name || "—" },
    { label: "Mobile", value: opts.mobile || "—" },
    { label: "ID", value: opts.studentCode || "—" },
  ];
  if (opts.email) rows.push({ label: "Email", value: opts.email });
  rows.push({ label: "Address", value: opts.address || "—" });

  for (const row of rows) {
    page.drawText(row.label, { x: labelX, y: rowY, size: 10, font: bold, color: TEXT });
    page.drawText(":", { x: valueX - 14, y: rowY, size: 10, font: bold, color: TEXT });
    const lines = wrapText(font, row.value, 10, maxValueW).slice(0, 2);
    lines.forEach((line, i) => {
      page.drawText(line, { x: valueX, y: rowY - i * 12, size: 10, font, color: TEXT });
    });
    rowY -= 18 + (lines.length > 1 ? 12 : 0);
  }

  // Bottom-right accent
  for (let i = 0; i < 4; i++) {
    const ox = W - 54 + i * 9;
    const y = 32;
    page.drawSvgPath(`M ${ox + 6},${y} L ${ox + 11},${y} L ${ox + 5},${y + 14} L ${ox},${y + 14} Z`, {
      color: GOLD,
    });
  }
  page.drawSvgPath(`M ${W - 56},30 L ${W},30 L ${W},12 L ${W - 44},12 Z`, { color: BROWN_DARK });

  page.drawRectangle({ x: 0, y: 0, width: W, height: 14, color: BROWN });

  return doc.save();
}

function drawCertificateBorder(
  page: ReturnType<PDFDocument["getPages"]>[number],
  W: number,
  H: number,
  gold: ReturnType<typeof rgb>,
  goldLight: ReturnType<typeof rgb>,
) {
  const m = 26;
  page.drawRectangle({ x: m, y: m, width: W - 2 * m, height: H - 2 * m, borderColor: gold, borderWidth: 2.2 });
  page.drawRectangle({
    x: m + 10,
    y: m + 10,
    width: W - 2 * m - 20,
    height: H - 2 * m - 20,
    borderColor: goldLight,
    borderWidth: 0.9,
  });
  for (const [cx, cy] of [
    [m + 6, m + 6],
    [W - m - 6, m + 6],
    [m + 6, H - m - 6],
    [W - m - 6, H - m - 6],
  ] as const) {
    page.drawCircle({ x: cx, y: cy, size: 5, color: gold });
    page.drawCircle({ x: cx, y: cy, size: 2.2, color: goldLight });
  }
  for (let x = m + 40; x < W - m - 40; x += 36) {
    page.drawCircle({ x, y: m + 3, size: 1.2, color: goldLight });
    page.drawCircle({ x, y: H - m - 3, size: 1.2, color: goldLight });
  }
}

export async function buildCertificatePdf(opts: {
  instituteName: string;
  studentName: string;
  courseTitle: string;
  certificateNumber: string;
  issuedDate: string;
  studentCode?: string;
  logoUrl?: string;
}) {
  const W = 842;
  const H = 595;
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const titleFont = await doc.embedFont(StandardFonts.TimesRomanBold);
  const scriptFont = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const logo = await embedPhoto(doc, opts.logoUrl);

  const BLACK = rgb(0.06, 0.06, 0.08);
  const GOLD = rgb(0.83, 0.64, 0.18);
  const GOLD_LIGHT = rgb(0.92, 0.78, 0.35);
  const WHITE = rgb(1, 1, 1);
  const MUTED = rgb(0.72, 0.72, 0.76);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: BLACK });
  for (let x = 0; x < W; x += 28) {
    for (let y = 0; y < H; y += 28) {
      page.drawCircle({ x: x + 14, y: y + 14, size: 0.6, color: rgb(0.1, 0.1, 0.12) });
    }
  }
  drawCertificateBorder(page, W, H, GOLD, GOLD_LIGHT);

  let topY = H - 36;
  if (logo) {
    const maxH = 52;
    const maxW = 180;
    const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
    const drawW = logo.width * scale;
    const drawH = logo.height * scale;
    page.drawImage(logo, {
      x: (W - drawW) / 2,
      y: topY - drawH,
      width: drawW,
      height: drawH,
    });
    topY = topY - drawH - 14;
  }

  const institute = (opts.instituteName || "Optech Computer Institute").toUpperCase();
  const ribbonW = Math.min(340, bold.widthOfTextAtSize(institute, 11) + 48);
  const ribbonX = (W - ribbonW) / 2;
  const ribbonY = topY - 34;
  page.drawRectangle({ x: ribbonX, y: ribbonY, width: ribbonW, height: 34, color: GOLD });
  page.drawSvgPath(`M ${ribbonX},${ribbonY} L ${ribbonX - 20},${ribbonY + 17} L ${ribbonX},${ribbonY + 34} Z`, {
    color: GOLD_LIGHT,
  });
  page.drawSvgPath(
    `M ${ribbonX + ribbonW},${ribbonY} L ${ribbonX + ribbonW + 20},${ribbonY + 17} L ${ribbonX + ribbonW},${ribbonY + 34} Z`,
    { color: GOLD_LIGHT },
  );
  const instW = bold.widthOfTextAtSize(institute, 11);
  page.drawText(institute, { x: (W - instW) / 2, y: ribbonY + 12, size: 11, font: bold, color: BLACK });

  const mainTitle = "Certificate of Completion";
  const titleSize = 34;
  const titleW = titleFont.widthOfTextAtSize(mainTitle, titleSize);
  const titleY = ribbonY - 48;
  page.drawText(mainTitle, { x: (W - titleW) / 2, y: titleY, size: titleSize, font: titleFont, color: WHITE });

  const sub = "This Certificate Is Proudly Presented To";
  const subW = font.widthOfTextAtSize(sub, 11);
  const subY = titleY - 30;
  page.drawText(sub, { x: (W - subW) / 2, y: subY, size: 11, font, color: MUTED });

  const divY = subY - 16;
  page.drawLine({ start: { x: W / 2 - 130, y: divY }, end: { x: W / 2 - 10, y: divY }, thickness: 0.9, color: GOLD });
  page.drawLine({ start: { x: W / 2 + 10, y: divY }, end: { x: W / 2 + 130, y: divY }, thickness: 0.9, color: GOLD });
  page.drawSvgPath(`M ${W / 2},${divY + 6} L ${W / 2 + 6},${divY} L ${W / 2},${divY - 6} L ${W / 2 - 6},${divY} Z`, {
    color: GOLD_LIGHT,
  });

  const nameSize = 30;
  const nameW = scriptFont.widthOfTextAtSize(opts.studentName, nameSize);
  const nameY = divY - 42;
  page.drawText(opts.studentName, {
    x: (W - nameW) / 2,
    y: nameY,
    size: nameSize,
    font: scriptFont,
    color: GOLD_LIGHT,
  });

  const body = `For successfully completing the course "${opts.courseTitle}" at ${opts.instituteName}, demonstrating dedication, skill, and commitment to excellence.`;
  const bodyLines = wrapText(font, body, 10, W - 180);
  let bodyY = nameY - 36;
  for (const line of bodyLines.slice(0, 4)) {
    const lw = font.widthOfTextAtSize(line, 10);
    page.drawText(line, { x: (W - lw) / 2, y: bodyY, size: 10, font, color: MUTED });
    bodyY -= 14;
  }

  const dateStr = `On ${opts.issuedDate}`;
  const dateW = bold.widthOfTextAtSize(dateStr, 11);
  page.drawText(dateStr, { x: (W - dateW) / 2, y: bodyY - 18, size: 11, font: bold, color: GOLD });

  const sealY = 78;
  page.drawCircle({ x: W / 2, y: sealY, size: 40, borderColor: GOLD, borderWidth: 2 });
  page.drawCircle({ x: W / 2, y: sealY, size: 33, borderColor: GOLD_LIGHT, borderWidth: 0.7 });
  const year = new Date().getFullYear().toString();
  const yearW = bold.widthOfTextAtSize(year, 9);
  page.drawText(year, { x: W / 2 - yearW / 2, y: sealY + 6, size: 9, font: bold, color: GOLD });
  const sealText = "AWARD";
  const sealW = bold.widthOfTextAtSize(sealText, 8);
  page.drawText(sealText, { x: W / 2 - sealW / 2, y: sealY - 5, size: 8, font: bold, color: GOLD_LIGHT });

  page.drawLine({ start: { x: 96, y: 88 }, end: { x: 248, y: 88 }, thickness: 0.8, color: WHITE });
  page.drawText("Director", { x: 148, y: 72, size: 9, font, color: MUTED });
  page.drawLine({ start: { x: W - 248, y: 88 }, end: { x: W - 96, y: 88 }, thickness: 0.8, color: WHITE });
  page.drawText("Principal", { x: W - 214, y: 72, size: 9, font, color: MUTED });

  page.drawText(`Cert. No: ${opts.certificateNumber}`, { x: 40, y: 38, size: 7.5, font, color: GOLD_LIGHT });
  if (opts.studentCode) {
    const idLabel = `Student ID: ${opts.studentCode}`;
    const idW = font.widthOfTextAtSize(idLabel, 7.5);
    page.drawText(idLabel, { x: W - 40 - idW, y: 38, size: 7.5, font, color: GOLD_LIGHT });
  }

  return doc.save();
}
