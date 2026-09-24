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

function imageCandidates(url: string) {
  const list = [url];
  const marker = "/image/upload/";
  const index = url.indexOf(marker);
  if (index >= 0) {
    list.unshift(`${url.slice(0, index + marker.length)}f_png,q_90,w_600/${url.slice(index + marker.length)}`);
  }
  return [...new Set(list)];
}

async function embedPhoto(doc: PDFDocument, url?: string) {
  if (!url) return null;
  for (const candidate of imageCandidates(url)) {
    try {
      const { data, headers } = await axios.get<ArrayBuffer>(candidate, {
        responseType: "arraybuffer",
        timeout: 10000,
      });
      const bytes = new Uint8Array(data);
      const type = String(headers["content-type"] ?? "").toLowerCase();
      const looksPng = type.includes("png") || candidate.toLowerCase().includes(".png") || candidate.includes("f_png");
      if (looksPng) return await doc.embedPng(bytes);
      if (type.includes("jpeg") || type.includes("jpg") || /\.jpe?g/i.test(candidate)) {
        return await doc.embedJpg(bytes);
      }
      try {
        return await doc.embedPng(bytes);
      } catch {
        return await doc.embedJpg(bytes);
      }
    } catch {
      continue;
    }
  }
  return null;
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

function pdfText(value: string) {
  return value
    .replace(/\u20B9/g, "Rs. ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function inr(n: number) {
  return `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;
}

const WORDS_ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const WORDS_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function wordsUnder100(n: number) {
  if (n < 20) return WORDS_ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${WORDS_TENS[tens]} ${WORDS_ONES[ones]}` : WORDS_TENS[tens];
}

function wordsUnder1000(n: number) {
  if (n < 100) return wordsUnder100(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return rest ? `${WORDS_ONES[hundreds]} Hundred ${wordsUnder100(rest)}` : `${WORDS_ONES[hundreds]} Hundred`;
}

function inrWords(amount: number) {
  const n = Math.round(Math.abs(amount));
  if (!n) return "Rupees Zero Only";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${wordsUnder1000(crore)} Crore`);
  if (lakh) parts.push(`${wordsUnder100(lakh)} Lakh`);
  if (thousand) parts.push(`${wordsUnder100(thousand)} Thousand`);
  if (rest) parts.push(wordsUnder1000(rest));
  return `Rupees ${parts.join(" ")} Only`;
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
  logoUrl?: string;
  invoiceNumber: string;
  date: string;
  payerName: string;
  payerEmail?: string;
  payerPhone?: string;
  course: string;
  fee: number;
  discount: number;
  coupon?: string;
  total: number;
  paymentId?: string;
  orderId?: string;
  mode?: string;
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedPhoto(doc, opts.logoUrl);
  const W = 595;
  const H = 842;
  const ink = rgb(0.11, 0.12, 0.15);
  const muted = rgb(0.4, 0.42, 0.46);
  const line = rgb(0.86, 0.87, 0.89);
  const gold = rgb(0.83, 0.64, 0.18);
  const navy = rgb(0.08, 0.1, 0.16);
  const cream = rgb(0.98, 0.96, 0.92);
  const soft = rgb(0.96, 0.96, 0.97);
  const green = rgb(0.1, 0.48, 0.32);
  const paper = rgb(0.94, 0.94, 0.95);

  const institute = pdfText(opts.instituteName || "Optech Computer Institute");
  const invoiceNo = pdfText(opts.invoiceNumber);
  const date = pdfText(opts.date);
  const payer = pdfText(opts.payerName || "Student");
  const course = pdfText(opts.course || "Course fee");
  const mode = pdfText((opts.mode || "razorpay").replace(/_/g, " "));
  const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);

  function rightText(text: string, right: number, y: number, size: number, face: PDFFont, color: ReturnType<typeof rgb>) {
    page.drawText(text, { x: right - face.widthOfTextAtSize(text, size), y, size, font: face, color });
  }

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: paper });
  const cardX = 22;
  const cardY = 22;
  const cardW = W - 44;
  const cardH = H - 44;
  page.drawRectangle({ x: cardX, y: cardY, width: cardW, height: cardH, color: WHITE });
  page.drawRectangle({ x: cardX, y: cardY, width: cardW, height: cardH, borderColor: line, borderWidth: 0.8 });
  page.drawRectangle({ x: cardX, y: cardY + cardH - 7, width: cardW, height: 7, color: gold });

  const headerH = 118;
  const headerBottom = cardY + cardH - 7 - headerH;
  page.drawRectangle({ x: cardX, y: headerBottom, width: cardW, height: headerH, color: navy });

  const logoSize = 62;
  const logoX = cardX + 18;
  const logoY = headerBottom + (headerH - logoSize) / 2;
  page.drawRectangle({ x: logoX, y: logoY, width: logoSize, height: logoSize, color: WHITE });
  if (logo) {
    const pad = 5;
    const scale = Math.min((logoSize - pad * 2) / logo.width, (logoSize - pad * 2) / logo.height);
    const drawW = logo.width * scale;
    const drawH = logo.height * scale;
    page.drawImage(logo, {
      x: logoX + (logoSize - drawW) / 2,
      y: logoY + (logoSize - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  } else {
    drawLogo(page, logoX + logoSize / 2, logoY + logoSize / 2, 18);
  }

  const textX = logoX + logoSize + 12;
  const nameLines = wrapText(bold, institute.toUpperCase(), 12, 250).slice(0, 2);
  let nameY = headerBottom + headerH - 32;
  for (const row of nameLines) {
    page.drawText(row, { x: textX, y: nameY, size: 12, font: bold, color: WHITE });
    nameY -= 15;
  }
  const addressLines = wrapText(font, pdfText(opts.instituteAddress || ""), 8, 250).slice(0, 2);
  for (const row of addressLines) {
    if (!row) continue;
    page.drawText(row, { x: textX, y: nameY, size: 8, font, color: rgb(0.78, 0.79, 0.82) });
    nameY -= 11;
  }
  const contact = [opts.institutePhone ? pdfText(opts.institutePhone) : "", opts.instituteEmail ? pdfText(opts.instituteEmail) : ""]
    .filter(Boolean)
    .join("  |  ");
  if (contact) {
    page.drawText(contact, { x: textX, y: nameY - 2, size: 8, font, color: gold });
  }

  const right = cardX + cardW - 18;
  page.drawText("INVOICE", {
    x: right - bold.widthOfTextAtSize("INVOICE", 20),
    y: headerBottom + 86,
    size: 20,
    font: bold,
    color: gold,
  });
  rightText("FEE RECEIPT", right, headerBottom + 72, 8, font, rgb(0.78, 0.79, 0.82));

  const paid = "PAID";
  const paidW = bold.widthOfTextAtSize(paid, 8) + 16;
  const paidX = right - paidW;
  const paidY = headerBottom + 50;
  page.drawRectangle({ x: paidX, y: paidY, width: paidW, height: 16, color: green });
  page.drawText(paid, { x: paidX + 8, y: paidY + 4, size: 8, font: bold, color: WHITE });
  rightText(invoiceNo, right, headerBottom + 32, 9, bold, WHITE);
  rightText(date, right, headerBottom + 18, 8, font, rgb(0.75, 0.76, 0.8));

  const contentX = cardX + 18;
  const contentW = cardW - 36;
  let y = headerBottom - 16;

  const metaH = 44;
  const metaGap = 8;
  const metaW = (contentW - metaGap * 2) / 3;
  const metas = [
    { label: "INVOICE NO.", value: invoiceNo },
    { label: "INVOICE DATE", value: date },
    { label: "STATUS", value: "Paid in full" },
  ];
  metas.forEach((item, i) => {
    const x = contentX + i * (metaW + metaGap);
    page.drawRectangle({ x, y: y - metaH, width: metaW, height: metaH, color: soft, borderColor: line, borderWidth: 0.6 });
    page.drawText(item.label, { x: x + 10, y: y - 16, size: 7, font: bold, color: gold });
    page.drawText(item.value, { x: x + 10, y: y - 32, size: 10, font: bold, color: ink });
  });
  y -= metaH + 16;

  const partyH = 86;
  const partyW = (contentW - 10) / 2;
  page.drawRectangle({ x: contentX, y: y - partyH, width: partyW, height: partyH, borderColor: line, borderWidth: 0.7 });
  page.drawRectangle({ x: contentX, y: y - 18, width: partyW, height: 18, color: cream });
  page.drawText("BILLED TO", { x: contentX + 12, y: y - 13, size: 8, font: bold, color: gold });
  page.drawText(payer, { x: contentX + 12, y: y - 38, size: 12, font: bold, color: ink });
  if (opts.payerPhone) page.drawText(pdfText(opts.payerPhone), { x: contentX + 12, y: y - 54, size: 9, font, color: muted });
  if (opts.payerEmail) page.drawText(pdfText(opts.payerEmail), { x: contentX + 12, y: y - 68, size: 9, font, color: muted });

  const payX = contentX + partyW + 10;
  page.drawRectangle({ x: payX, y: y - partyH, width: partyW, height: partyH, color: navy });
  page.drawText("AMOUNT PAID", { x: payX + 12, y: y - 18, size: 8, font: bold, color: gold });
  const totalLabel = inr(opts.total);
  page.drawText(totalLabel, { x: payX + 12, y: y - 46, size: 18, font: bold, color: WHITE });
  page.drawText(`via ${modeLabel}`, { x: payX + 12, y: y - 66, size: 9, font, color: rgb(0.78, 0.79, 0.82) });
  y -= partyH + 18;

  const cols = { no: contentX + 10, desc: contentX + 40, qty: contentX + contentW - 230, rate: contentX + contentW - 118, amt: contentX + contentW - 12 };
  page.drawRectangle({ x: contentX, y: y - 22, width: contentW, height: 22, color: navy });
  page.drawText("#", { x: cols.no, y: y - 15, size: 8, font: bold, color: WHITE });
  page.drawText("DESCRIPTION", { x: cols.desc, y: y - 15, size: 8, font: bold, color: WHITE });
  page.drawText("QTY", { x: cols.qty, y: y - 15, size: 8, font: bold, color: WHITE });
  rightText("RATE", cols.rate, y - 15, 8, bold, WHITE);
  rightText("AMOUNT", cols.amt, y - 15, 8, bold, WHITE);
  y -= 22;

  const courseLines = wrapText(bold, course, 10, cols.qty - cols.desc - 12).slice(0, 2);
  const rowH = courseLines.length > 1 ? 40 : 34;
  page.drawRectangle({ x: contentX, y: y - rowH, width: contentW, height: rowH, color: cream });
  page.drawText("01", { x: cols.no, y: y - 16, size: 9, font, color: muted });
  courseLines.forEach((row, i) => {
    page.drawText(row, { x: cols.desc, y: y - 16 - i * 12, size: i === 0 ? 10 : 8, font: i === 0 ? bold : font, color: i === 0 ? ink : muted });
  });
  if (courseLines.length === 1) {
    page.drawText("Course enrollment fee", { x: cols.desc, y: y - 28, size: 8, font, color: muted });
  }
  page.drawText("1", { x: cols.qty, y: y - 16, size: 9, font, color: ink });
  rightText(inr(opts.fee), cols.rate, y - 16, 9, font, ink);
  rightText(inr(opts.fee), cols.amt, y - 16, 9, bold, ink);
  y -= rowH;

  const totalsW = 220;
  const totalsX = contentX + contentW - totalsW;
  y -= 14;
  const rows: { label: string; value: string }[] = [{ label: "Subtotal", value: inr(opts.fee) }];
  if (opts.discount > 0) {
    const coupon = opts.coupon ? ` (${pdfText(opts.coupon)})` : "";
    rows.push({ label: `Discount${coupon}`, value: `- ${inr(opts.discount)}` });
  }
  rows.forEach((row) => {
    page.drawText(row.label, { x: totalsX, y, size: 9, font, color: muted });
    rightText(row.value, cols.amt, y, 9, font, ink);
    y -= 16;
  });
  page.drawRectangle({ x: totalsX - 8, y: y - 8, width: totalsW + 8, height: 28, color: navy });
  page.drawText("Total paid", { x: totalsX, y: y, size: 10, font: bold, color: WHITE });
  rightText(inr(opts.total), cols.amt, y, 12, bold, gold);
  y -= 36;

  const words = wrapText(font, inrWords(opts.total), 9, contentW - 24).slice(0, 2);
  const wordsH = 18 + words.length * 12;
  page.drawRectangle({ x: contentX, y: y - wordsH, width: contentW, height: wordsH, color: cream });
  page.drawText("AMOUNT IN WORDS", { x: contentX + 12, y: y - 14, size: 7, font: bold, color: gold });
  words.forEach((row, i) => {
    page.drawText(row, { x: contentX + 12, y: y - 28 - i * 12, size: 9, font: bold, color: ink });
  });
  y -= wordsH + 16;

  page.drawText("PAYMENT DETAILS", { x: contentX, y, size: 8, font: bold, color: gold });
  y -= 8;
  const details = [
    ["Mode", modeLabel],
    ["Payment ID", pdfText(opts.paymentId || "-")],
    ["Order ID", pdfText(opts.orderId || "-")],
  ];
  const detailW = contentW / 3;
  page.drawRectangle({ x: contentX, y: y - 42, width: contentW, height: 42, borderColor: line, borderWidth: 0.7 });
  details.forEach(([label, value], i) => {
    const x = contentX + i * detailW + 10;
    page.drawText(label.toUpperCase(), { x, y: y - 16, size: 7, font: bold, color: muted });
    const valueLines = wrapText(font, value, 8, detailW - 18).slice(0, 1);
    page.drawText(valueLines[0] || "-", { x, y: y - 30, size: 8, font, color: ink });
  });
  y -= 58;

  page.drawText("Notes", { x: contentX, y, size: 8, font: bold, color: gold });
  const notes = [
    "This receipt confirms the online course fee payment.",
    "Admission is confirmed by campus staff after this payment.",
    "This is a computer-generated invoice and does not require a signature.",
  ];
  notes.forEach((note, i) => {
    page.drawText(`${i + 1}.  ${note}`, { x: contentX, y: y - 16 - i * 13, size: 8, font, color: muted });
  });

  const signX = contentX + contentW - 170;
  page.drawLine({ start: { x: signX, y: 92 }, end: { x: contentX + contentW, y: 92 }, thickness: 0.7, color: line });
  const signLabel = `For ${institute}`;
  const signLines = wrapText(font, signLabel, 8, 170).slice(0, 1);
  page.drawText(signLines[0], { x: signX, y: 78, size: 8, font, color: muted });
  page.drawText("Authorised signatory", { x: signX, y: 66, size: 8, font: bold, color: ink });

  page.drawRectangle({ x: cardX, y: cardY, width: cardW, height: 28, color: navy });
  page.drawText("Thank you for choosing " + institute, { x: contentX, y: cardY + 10, size: 8, font, color: WHITE });
  rightText("Page 1 of 1", contentX + contentW, cardY + 10, 8, font, rgb(0.75, 0.76, 0.8));

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
