import fs from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import subsetFont from "subset-font";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AttendanceState, TbmStatus } from "@prisma/client";
import { dateLabel, dateTimeLabel, timeLabel } from "@/lib/kst";
import { distanceLabel } from "@/lib/geo";

// A4
export const W = 595.28;
export const H = 841.89;
export const MARGIN = 42;
export const CONTENT_W = W - MARGIN * 2;

export const INK = rgb(0.09, 0.11, 0.15);
export const MUTED = rgb(0.42, 0.45, 0.5);
export const LINE = rgb(0.8, 0.83, 0.86);
export const HEAD_BG = rgb(0.93, 0.94, 0.96);
export const WARN = rgb(0.72, 0.11, 0.24);
export const OK = rgb(0.06, 0.5, 0.31);

// 사진 배치 치수. 섹션 제목이 첫 줄과 같은 쪽에 남으려면 미리 알아야 한다.
const PHOTO_PER_ROW = 2;
const PHOTO_GAP = 12;
const PHOTO_W = (CONTENT_W - PHOTO_GAP * (PHOTO_PER_ROW - 1)) / PHOTO_PER_ROW;
const PHOTO_H = PHOTO_W * 0.72;
const PHOTO_CAPTION_H = 22;
const PHOTO_ROW_H = PHOTO_H + PHOTO_CAPTION_H + 8;
// 지면에서 가장 큰 변이 250pt(약 3.5cm)다. 300dpi로 찍어도 이 화소면 충분하다.
const PHOTO_MAX_PX = Math.ceil((Math.max(PHOTO_W, PHOTO_H) / 72) * 300);

export type TbmPdfData = {
  siteName: string;
  siteCode: string;
  teamName: string;
  workDate: Date;
  heldAt: Date | null;
  heldUntil: Date | null;
  weather: string | null;
  status: TbmStatus;
  workDescription: string;
  remarks: string | null;
  authorName: string | null;
  submittedAt: Date | null;
  approverName: string | null;
  approvedAt: Date | null;
  /// 대결이면 대신 결재받은 법인 대표 이름
  onBehalfOfName: string | null;
  /// 승인 뒤 정정한 시각
  correctedAt: Date | null;
  eduItems: { content: string; done: boolean }[];
  hazards: { hazard: string; control: string }[];
  attendances: {
    empNo: string | null;
    name: string;
    state: AttendanceState | null;
    method: string | null;
    checkedInAt: Date | null;
  }[];
  photos: {
    url: string;
    takenAt: Date | null;
    distanceM: number | null;
    warnings: string[];
  }[];
  flags: { label: string; detail: string }[];
};

const STATE_LABEL: Record<AttendanceState, string> = {
  PRESENT: "참석",
  LATE: "지각",
  ABSENT: "불참",
};

/**
 * 문서에 찍히는 고정 문구를 한 곳에 모아 둔다.
 * 폰트를 문서에 쓰인 글자만으로 줄이기 때문에, 여기 빠진 글자는 인쇄되지 않는다.
 * 문구를 고칠 때는 이 목록도 함께 확인할 것.
 */
const STATIC_TEXT = [
  "TBM(작업 전 안전점검회의) 실시 기록",
  "작성 결재 상신 승인 미기재",
  "대결 승인 후 정정됨",
  "실시 정보 실시 시간 시각 날씨 작업 내용",
  "안전보건교육 실시 항목",
  "위험요인 및 안전대책",
  "참석자 명단 번호 사번 성명 출결 체크인 방식 수기 미기록",
  "참석 지각 불참",
  "총 명 중 참석",
  "특이사항 · 아차사고 공유 · 건의사항",
  "사진 촬영 정보 자동 검증 특이사항 없음 경고",
  "현장 사진 촬영 시각 없음 위치 정보 없음 현장에서",
  "사진을 불러오지 못했습니다",
  "출력",
  "가나다라마바사아자차카타파하",
  "0123456789",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~·…—–",
  "년월일시분초요일",
  "월화수목금토일",
].join("");

/** 이 문서를 그리는 데 필요한 글자만 모은다. */
function collectChars(data: TbmPdfData): string {
  const parts: string[] = [STATIC_TEXT];

  const push = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
  };

  push(data.siteName);
  push(data.siteCode);
  push(data.teamName);
  push(data.weather);
  push(data.workDescription);
  push(data.remarks);
  push(data.authorName);
  push(data.approverName);
  push(data.onBehalfOfName);
  for (const e of data.eduItems) push(e.content);
  for (const h of data.hazards) {
    push(h.hazard);
    push(h.control);
  }
  for (const a of data.attendances) {
    push(a.name);
    push(a.empNo);
  }
  for (const f of data.flags) {
    push(f.label);
    push(f.detail);
  }

  // 날짜·시각 문자열도 실제로 찍히는 형태 그대로 넣어 둔다
  const dates = [
    data.workDate,
    data.heldAt,
    data.heldUntil,
    data.submittedAt,
    data.approvedAt,
    data.correctedAt,
    new Date(),
  ];
  for (const d of dates) {
    if (!d) continue;
    parts.push(dateLabel(d), dateTimeLabel(d), timeLabel(d));
  }
  for (const p of data.photos) {
    if (p.takenAt) parts.push(dateTimeLabel(p.takenAt));
    if (p.distanceM !== null) parts.push(distanceLabel(p.distanceM));
  }
  for (const a of data.attendances) {
    if (a.checkedInAt) parts.push(timeLabel(a.checkedInAt));
  }

  return [...new Set(parts.join(""))].join("");
}

let rawFonts: { regular: Buffer; bold: Buffer } | null = null;

async function loadRawFonts() {
  if (rawFonts) return rawFonts;
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [regular, bold] = await Promise.all([
    fs.readFile(path.join(dir, "NotoSansKR-Regular.ttf")),
    fs.readFile(path.join(dir, "NotoSansKR-Bold.ttf")),
  ]);
  rawFonts = { regular, bold };
  return rawFonts;
}

/**
 * 빈 PDF와, 넘겨준 글자만 남긴 한글 폰트를 만든다.
 *
 * pdf-lib의 subset 옵션은 한글에서 cmap을 잃어 글자가 깨지므로 쓰지 않고
 * subset-font로 직접 깎는다. 원본 폰트가 5.9MB라 통째로 넣으면 서버리스
 * 응답 한도에 걸린다. 문서마다 쓰는 글자가 다르므로 부르는 쪽이 모아 준다.
 */
export async function createPdf(usedChars: string) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const raw = await loadRawFonts();
  const [regularBytes, boldBytes] = await Promise.all([
    subsetFont(raw.regular, usedChars, { targetFormat: "truetype" }),
    subsetFont(raw.bold, usedChars, { targetFormat: "truetype" }),
  ]);

  return {
    doc,
    regular: await doc.embedFont(regularBytes),
    bold: await doc.embedFont(boldBytes),
  };
}

/**
 * 글자 폭의 단순 합.
 *
 * pdf-lib의 widthOfTextAtSize는 폰트의 조판 규칙(한글 옆 공백 치환 등)까지 반영하는데,
 * 뷰어가 그걸 그대로 재현하지 못해 글자가 벌어진다. 그래서 폭 계산과 그리기를
 * 모두 글자 단위로 맞춘다.
 */
export function measure(text: string, font: PDFFont, size: number): number {
  let w = 0;
  for (const ch of text) w += font.widthOfTextAtSize(ch, size);
  return w;
}

/**
 * 글자를 하나씩 계산된 위치에 찍는다.
 *
 * 통째로 drawText하면 뷰어가 폰트의 조판 규칙을 잘못 적용해 숫자 사이나
 * 한글 뒤 공백이 크게 벌어진다. 위치를 직접 정하면 그 문제가 사라진다.
 */
export function drawRun(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color: ReturnType<typeof rgb> },
): number {
  let cx = opts.x;
  for (const ch of text) {
    const w = opts.font.widthOfTextAtSize(ch, opts.size);
    if (ch !== " ") {
      page.drawText(ch, {
        x: cx,
        y: opts.y,
        size: opts.size,
        font: opts.font,
        color: opts.color,
      });
    }
    cx += w;
  }
  return cx - opts.x;
}

/** 줄바꿈. 한글은 단어 경계가 없어 글자 단위로도 자른다. */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const chunk of paragraph.split(/(\s+)/)) {
      if (!chunk) continue;
      if (measure(line + chunk, font, size) <= maxWidth) {
        line += chunk;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = "";
      let piece = "";
      for (const ch of chunk) {
        if (measure(piece + ch, font, size) > maxWidth) {
          out.push(piece);
          piece = "";
        }
        piece += ch;
      }
      line = piece.trimStart();
    }
    out.push(line.trimEnd());
  }
  return out.length > 0 ? out : [""];
}

export class Cursor {
  page: PDFPage;
  y: number;
  private pages: PDFPage[] = [];

  constructor(
    private doc: PDFDocument,
    private regular: PDFFont,
    private bold: PDFFont,
  ) {
    this.page = doc.addPage([W, H]);
    this.pages.push(this.page);
    this.y = H - MARGIN;
  }

  get allPages() {
    return this.pages;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 26) {
      this.page = this.doc.addPage([W, H]);
      this.pages.push(this.page);
      this.y = H - MARGIN;
    }
  }

  /** 한 줄만 정확한 위치에 그린다 (줄바꿈 없음) */
  at(value: string, x: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    const size = opts.size ?? 9.5;
    drawRun(this.page, value, {
      x,
      y: this.y - size,
      size,
      font: opts.bold ? this.bold : this.regular,
      color: opts.color ?? INK,
    });
  }

  text(
    value: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      x?: number;
      width?: number;
      lineGap?: number;
    } = {},
  ) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.regular;
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? CONTENT_W - (x - MARGIN);
    const gap = opts.lineGap ?? 3.5;

    for (const line of wrap(value, font, size, width)) {
      this.ensure(size + gap);
      drawRun(this.page, line, {
        x,
        y: this.y - size,
        size,
        font,
        color: opts.color ?? INK,
      });
      this.y -= size + gap;
    }
  }

  gap(h: number) {
    this.y -= h;
  }

  rule(color = LINE) {
    this.ensure(8);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: W - MARGIN, y: this.y },
      thickness: 0.7,
      color,
    });
    this.y -= 8;
  }

  /**
   * @param keepWith 제목 뒤에 같은 쪽에 있어야 할 높이.
   *   그만큼 자리가 없으면 제목부터 다음 쪽에서 시작한다.
   */
  sectionTitle(title: string, keepWith = 14) {
    this.ensure(26 + keepWith);
    this.gap(7);
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 15,
      width: CONTENT_W,
      height: 17,
      color: HEAD_BG,
    });
    drawRun(this.page, title, {
      x: MARGIN + 6,
      y: this.y - 11.5,
      size: 10,
      font: this.bold,
      color: INK,
    });
    this.y -= 22;
  }

  /** 라벨 + 값을 정해진 위치에 나란히 (공백으로 벌리지 않는다) */
  fields(items: { label: string; value: string }[], colWidth = 150) {
    this.ensure(14);
    items.forEach((item, i) => {
      const x = MARGIN + colWidth * i;
      this.at(item.label, x, { size: 8.5, color: MUTED });
      this.at(item.value, x + 48, { size: 9.5 });
    });
    this.y -= 14;
  }
}

/** 문서를 그리다 생긴 문제를 부르는 쪽에 알리는 통로 (실패해도 문서는 나온다) */
export type PdfNote = (message: string) => void;

export type PdfOptions = {
  note?: PdfNote;
  /**
   * sharp 모듈. 여기서 직접 import하지 않고 받아 쓴다.
   * 번들 안쪽 모듈에서 부르면 Turbopack이 external 래퍼로 감싸는데 그 참조가
   * 서버리스 함수에서 풀리지 않는다("Failed to load external module sharp-…").
   * 라우트 파일에서 부른 것은 멀쩡히 올라오므로, 로드는 거기에 맡긴다.
   * 없으면 사진을 원본 그대로 넣는다. 문서는 그대로 나오고 크기만 커진다.
   */
  sharp?: Sharp | null;
};

export async function buildTbmPdf(
  data: TbmPdfData,
  { note = () => {}, sharp = null }: PdfOptions = {},
): Promise<Uint8Array> {
  const { doc, regular, bold } = await createPdf(collectChars(data));

  doc.setTitle(`TBM 실시 기록 ${data.siteName} ${data.teamName}`);
  doc.setCreator("가공사업부 안전관리 시스템");

  const c = new Cursor(doc, regular, bold);

  // --- 제목과 결재란을 같은 줄에 나란히 -----------------------------------
  const headTop = c.y;
  drawApprovalBox(c, data, regular, bold);

  c.y = headTop;
  c.text("TBM(작업 전 안전점검회의)", { size: 14, bold: true, width: 280 });
  c.text("실시 기록", { size: 14, bold: true, width: 280 });
  c.gap(2);
  c.text(`${data.siteName} (${data.siteCode})`, { size: 9, color: MUTED, width: 280 });
  c.text(`${data.teamName}   ${dateLabel(data.workDate)}`, {
    size: 9,
    color: MUTED,
    width: 280,
  });

  // 둘 중 아래쪽에 맞춰 구분선을 긋는다
  // 결재란(58pt)보다 아래에서 구분선을 긋는다
  c.y = Math.min(c.y, headTop - 62);
  c.gap(4);
  c.rule();

  // 승인 뒤에 내용을 고친 문서는 그 사실이 첫 화면에 보여야 한다.
  if (data.correctedAt) {
    c.text(`승인 후 정정됨 ${dateTimeLabel(data.correctedAt)}`, { size: 8.5, color: WARN });
    c.gap(2);
  }

  // --- 실시 정보 ----------------------------------------------------------
  c.sectionTitle("실시 정보");
  c.fields([
    {
      label: "실시 시간",
      value: data.heldAt
        ? data.heldUntil
          ? `${timeLabel(data.heldAt)} ~ ${timeLabel(data.heldUntil)}`
          : timeLabel(data.heldAt)
        : "미기재",
    },
    { label: "날씨", value: data.weather || "미기재" },
  ]);
  c.gap(2);
  c.text("작업 내용", { size: 8.5, color: MUTED });
  c.text(data.workDescription || "—");

  // --- 교육 항목 ----------------------------------------------------------
  if (data.eduItems.length > 0) {
    c.sectionTitle("안전보건교육 실시 항목");
    data.eduItems.forEach((item, i) => {
      c.text(`${item.done ? "[O]" : "[  ]"} ${i + 1}. ${item.content}`, {
        color: item.done ? INK : MUTED,
      });
    });
  }

  // --- 위험요인 -----------------------------------------------------------
  if (data.hazards.length > 0) {
    c.sectionTitle("위험요인 및 안전대책");
    data.hazards.forEach((h, i) => {
      c.text(`${i + 1}. ${h.hazard}`, { bold: true });
      c.text(h.control, { x: MARGIN + 14, color: MUTED });
      c.gap(2);
    });
  }

  // --- 참석자 -------------------------------------------------------------
  c.sectionTitle("참석자 명단", 30);
  drawAttendanceTable(c, data, regular, bold);

  // --- 특이사항 -----------------------------------------------------------
  if (data.remarks) {
    c.sectionTitle("특이사항 · 아차사고 공유 · 건의사항");
    c.text(data.remarks);
  }

  // --- 검증 결과 ----------------------------------------------------------
  c.sectionTitle("사진 촬영 정보 자동 검증");
  if (data.flags.length === 0) {
    c.text("특이사항 없음", { color: OK });
  } else {
    for (const f of data.flags) {
      c.text(`경고 · ${f.label} — ${f.detail}`, { color: WARN });
    }
  }

  // --- 현장 사진 ----------------------------------------------------------
  if (data.photos.length > 0) {
    c.sectionTitle("현장 사진", PHOTO_ROW_H);
    await drawPhotos(doc, c, data, regular, note, sharp);
  }

  // --- 쪽번호 -------------------------------------------------------------
  const pages = c.allPages;
  const printed = dateTimeLabel(new Date());
  pages.forEach((page, i) => {
    drawRun(
      page,
      `${data.siteName} ${data.teamName} · ${dateLabel(data.workDate)} · 출력 ${printed}`,
      { x: MARGIN, y: MARGIN - 14, size: 7.5, font: regular, color: MUTED },
    );
    const label = `${i + 1} / ${pages.length}`;
    drawRun(page, label, {
      x: W - MARGIN - measure(label, regular, 7.5),
      y: MARGIN - 14,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
  });

  return doc.save();
}

/** 누가 작성하고 누가 결재했는지 */
function drawApprovalBox(c: Cursor, data: TbmPdfData, regular: PDFFont, bold: PDFFont) {
  const boxH = 58;
  c.ensure(boxH + 8);

  // 대결이면 결재란에 대표 이름을 싣고, 실제로 누른 사람을 아래에 함께 적는다.
  // 누가 눌렀는지를 감추면 점검에서 문서 전체가 신뢰를 잃는다.
  const delegated = Boolean(data.onBehalfOfName);

  const cols = [
    {
      title: "작성",
      name: data.authorName ?? "—",
      at: data.submittedAt,
      note: "상신",
      extra: null as string | null,
    },
    {
      title: "결재",
      name: (delegated ? data.onBehalfOfName : data.approverName) ?? "—",
      at: data.approvedAt,
      note: "승인",
      extra: delegated ? `대결 ${data.approverName ?? "—"}` : null,
    },
  ];
  const colW = 148;
  const startX = W - MARGIN - colW * cols.length;
  const top = c.y;

  cols.forEach((col, i) => {
    const x = startX + colW * i;
    c.page.drawRectangle({
      x,
      y: top - boxH,
      width: colW,
      height: boxH,
      borderColor: LINE,
      borderWidth: 0.8,
    });
    c.page.drawRectangle({ x, y: top - 15, width: colW, height: 15, color: HEAD_BG });
    drawRun(c.page, col.title, { x: x + 6, y: top - 11.5, size: 9, font: bold, color: INK });
    drawRun(c.page, col.name, { x: x + 6, y: top - 31, size: 10.5, font: bold, color: INK });
    drawRun(c.page, col.at ? `${col.note} ${dateTimeLabel(col.at)}` : "—", {
      x: x + 6,
      y: top - 43,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
    if (col.extra) {
      drawRun(c.page, col.extra, {
        x: x + 6,
        y: top - 52,
        size: 7.5,
        font: regular,
        color: MUTED,
      });
    }
  });
}

function drawAttendanceTable(c: Cursor, data: TbmPdfData, regular: PDFFont, bold: PDFFont) {
  const cols = [
    { label: "번호", w: 34 },
    { label: "사번", w: 78 },
    { label: "성명", w: 110 },
    { label: "출결", w: 46 },
    { label: "체크인", w: 60 },
    { label: "방식", w: 60 },
  ];
  const rowH = 15;

  const header = () => {
    c.ensure(rowH);
    let x = MARGIN;
    c.page.drawRectangle({
      x: MARGIN,
      y: c.y - rowH + 2,
      width: CONTENT_W,
      height: rowH,
      color: HEAD_BG,
    });
    for (const col of cols) {
      drawRun(c.page, col.label, {
        x: x + 4,
        y: c.y - rowH + 6.5,
        size: 8.5,
        font: bold,
        color: INK,
      });
      x += col.w;
    }
    c.y -= rowH;
  };

  header();

  const present = data.attendances.filter(
    (a) => a.state === "PRESENT" || a.state === "LATE",
  ).length;

  data.attendances.forEach((a, i) => {
    if (c.y - rowH < MARGIN + 26) {
      c.ensure(rowH * 2);
      header();
    }
    let x = MARGIN;
    const cells = [
      String(i + 1),
      a.empNo ?? "—",
      a.name,
      a.state ? STATE_LABEL[a.state] : "미기록",
      a.checkedInAt ? timeLabel(a.checkedInAt) : "—",
      a.method === "QR" ? "QR" : a.method === "MANUAL" ? "수기" : "—",
    ];
    cells.forEach((value, ci) => {
      drawRun(c.page, value, {
        x: x + 4,
        y: c.y - rowH + 6.5,
        size: 8.5,
        font: regular,
        color: a.state === "ABSENT" || !a.state ? MUTED : INK,
      });
      x += cols[ci].w;
    });
    c.page.drawLine({
      start: { x: MARGIN, y: c.y - rowH + 2 },
      end: { x: W - MARGIN, y: c.y - rowH + 2 },
      thickness: 0.4,
      color: LINE,
    });
    c.y -= rowH;
  });

  c.gap(4);
  c.text(`총 ${data.attendances.length}명 중 참석 ${present}명`, { size: 9, bold: true });
}

/** sharp 모듈 타입. 값으로는 쓰지 않으므로 번들에 실체가 들어가지 않는다. */
export type Sharp = (typeof import("sharp"))["default"];

/** 에러 메시지 첫 줄만. 스택까지 헤더에 실을 수는 없다. */
function firstLine(e: unknown): string {
  return ((e as Error)?.message ?? String(e)).split(/\r?\n/)[0].slice(0, 200);
}

/**
 * 폰 사진은 4000px가 넘는데 지면에는 250pt로 들어간다. 원본을 그대로 넣으면
 * 사진 몇 장에 PDF가 수 MB가 되어 다운로드 자체가 막힌다. 필요한 만큼만 남긴다.
 * EXIF 회전도 여기서 화소에 반영한다 — pdf-lib은 회전 정보를 보지 않는다.
 */
async function embedPhoto(
  doc: PDFDocument,
  raw: Buffer,
  type: string,
  note: PdfNote,
  sharp: Sharp | null,
) {
  if (!sharp) {
    note("photo-scale-skipped: sharp 없음");
    return type.includes("png") ? doc.embedPng(raw) : doc.embedJpg(raw);
  }
  try {
    const fitted = await sharp(raw)
      .rotate()
      .resize({
        width: PHOTO_MAX_PX,
        height: PHOTO_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" }) // 투명 배경이 검게 나오는 것을 막는다
      .jpeg({ quality: 80 })
      .toBuffer();
    return await doc.embedJpg(fitted);
  } catch (e) {
    // 줄이지 못하면 원본이라도 넣는다. 그것도 실패하면 부르는 쪽에서 안내를 그린다.
    // 조용히 넘어가면 PDF만 무거워지고 아무도 모르므로 로그는 남긴다.
    const why = firstLine(e);
    console.error(`[pdf] 사진 축소 실패, 원본을 넣는다 — ${why}`);
    note(`photo-scale-failed: ${why}`);
    return type.includes("png") ? doc.embedPng(raw) : doc.embedJpg(raw);
  }
}

async function drawPhotos(
  doc: PDFDocument,
  c: Cursor,
  data: TbmPdfData,
  regular: PDFFont,
  note: PdfNote,
  sharp: Sharp | null,
) {
  const perRow = PHOTO_PER_ROW;
  const imgW = PHOTO_W;
  const imgH = PHOTO_H;
  const captionH = PHOTO_CAPTION_H;

  for (let i = 0; i < data.photos.length; i += perRow) {
    const row = data.photos.slice(i, i + perRow);
    c.ensure(PHOTO_ROW_H);
    const top = c.y;

    for (const [j, photo] of row.entries()) {
      const x = MARGIN + (imgW + PHOTO_GAP) * j;
      try {
        const res = await fetch(photo.url);
        if (!res.ok) throw new Error(String(res.status));
        const raw = Buffer.from(await res.arrayBuffer());
        const type = res.headers.get("content-type") ?? "";
        const img = await embedPhoto(doc, raw, type, note, sharp);

        const scale = Math.min(imgW / img.width, imgH / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        c.page.drawImage(img, {
          x: x + (imgW - dw) / 2,
          y: top - imgH + (imgH - dh) / 2,
          width: dw,
          height: dh,
        });
      } catch {
        drawRun(c.page, "사진을 불러오지 못했습니다", {
          x: x + 8,
          y: top - imgH / 2,
          size: 8.5,
          font: regular,
          color: MUTED,
        });
      }

      c.page.drawRectangle({
        x,
        y: top - imgH,
        width: imgW,
        height: imgH,
        borderColor: LINE,
        borderWidth: 0.8,
      });

      drawRun(
        c.page,
        photo.takenAt ? `촬영 ${dateTimeLabel(photo.takenAt)}` : "촬영 시각 없음",
        { x, y: top - imgH - 10, size: 7.5, font: regular, color: MUTED },
      );
      drawRun(
        c.page,
        photo.distanceM !== null ? `현장에서 ${distanceLabel(photo.distanceM)}` : "위치 정보 없음",
        {
          x,
          y: top - imgH - 19,
          size: 7.5,
          font: regular,
          color: photo.warnings.length > 0 ? WARN : MUTED,
        },
      );
    }

    c.y = top - imgH - captionH - 6;
  }
}
