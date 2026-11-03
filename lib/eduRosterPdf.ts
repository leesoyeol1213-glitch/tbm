import { type PDFFont, type PDFPage } from "pdf-lib";
import {
  CONTENT_W,
  Cursor,
  HEAD_BG,
  INK,
  LINE,
  MARGIN,
  MUTED,
  OK,
  WARN,
  createPdf,
  drawRun,
  measure,
} from "@/lib/pdf";
import { dateTimeLabel, timeLabel } from "@/lib/kst";
import { minutesLabel, stayMinutes, stayVerdict } from "@/lib/legalEdu";

/**
 * 법정의무교육 교육대장(참석자 서명부).
 *
 * 두 번 쓰인다.
 *  - **교육 전**: 일시·장소·강사를 비워 인쇄해 그 자리에서 손으로 적는다.
 *    QR 회차가 있으면 첫 장 머리에 스캔용 QR이 함께 찍힌다.
 *  - **교육 뒤**: 시작·종료 스캔 시각과 체류시간을 채워 보관용으로 다시 뽑는다.
 *    서명은 참석을, 두 번 찍힌 시각은 체류시간을 증명한다. 종이 한 장으로는
 *    "1시간 앉아 있었다"를 보일 수 없어서 둘을 같이 남긴다.
 *
 * 한 법인에 한 장(또는 여러 장)씩 나눠 뽑는다. 교육을 한자리에 모아 하더라도
 * 의무 주체는 법인이라, 서류가 법인별로 갈라져 있어야 그대로 서류철에 꽂힌다.
 */

const ROW_H = 22;
const HEAD_H = 18;
/** 서명을 손으로 받는 칸이라 글자 크기보다 칸 높이가 먼저다. */
const ROW_FONT = 9.5;

/**
 * 첫 장 머리에 찍는 QR 한 변.
 *
 * 74pt로 뒀다가 10명짜리 법인이 두 장으로 넘어가 58pt로 줄였다. QR 한 칸이
 * 세로로 먹는 자리가 표 두세 줄이고, 그만큼 장수가 늘면 열 곳을 뽑을 때
 * 종이가 거의 두 배가 된다. 휴대폰 카메라는 이 크기로도 충분히 읽는다.
 */
const QR_SIZE = 58;

type Col = { label: string; w: number };

/**
 * 칸 너비. 직종은 2026-11-03에 뺐다 — 7종뿐이라(가공 90·절곡 38·선조립 15…)
 * 누가 누군지 가리는 데 보탬이 없고, 그 폭을 서명란에 주는 쪽이 낫다.
 * 글자는 모두 가운데로 모은다.
 *
 * 스캔 시각을 찍는 보관용 출력에서는 서명란을 줄여 시작·종료·교육시간을 넣는다.
 * 서명은 이미 받아 둔 종이에 있으므로, 그 칸은 좁아도 된다.
 */
function columns(withScanTimes: boolean): Col[] {
  if (withScanTimes) {
    return [
      { label: "번호", w: 30 },
      { label: "사번", w: 56 },
      { label: "성명", w: 80 },
      { label: "작업팀", w: 85 },
      { label: "시작", w: 46 },
      { label: "종료", w: 46 },
      { label: "교육시간", w: 58 },
      { label: "서명", w: 110.28 },
    ];
  }
  return [
    { label: "번호", w: 36 },
    { label: "사번", w: 70 },
    { label: "성명", w: 100 },
    { label: "작업팀", w: 120 },
    { label: "서명", w: 185.28 },
  ];
}

/**
 * 화면에서 "몇 장 나옵니다"를 보여 주기 위한 수. 2026-11-03에 1명부터 80명까지
 * 실제로 찍어 보고 맞췄다 — QR이 있는 교육 전 출력이 첫 장 13줄·이후 장 31줄,
 * QR이 없는 보관용이 14줄·32줄이다. 둘 중 좁은 쪽을 쓴다. 지면 계산을 고쳤으면
 * 다시 재야 한다.
 */
export const ROWS_FIRST_PAGE = 13;
export const ROWS_LATER_PAGE = 31;

export type EduRosterWorker = {
  empNo: string | null;
  name: string;
  teamName: string | null;
  /** 교육 시작 스캔. 보관용 출력에서만 쓴다. */
  startedAt?: Date | null;
  /** 교육 종료 스캔. 비어 있으면 종이에도 비워 둔다 — 추측해 채우지 않는다. */
  endedAt?: Date | null;
};

export type EduRosterData = {
  siteName: string;
  siteCode: string;
  eduTitle: string;
  /** 근거 법령 한 줄 */
  basis: string;
  /** 미리 채운 값. null이면 손으로 적도록 밑줄만 둔다. */
  heldAtText: string | null;
  durationText: string | null;
  place: string | null;
  instructor: string | null;
  contents: string[];
  workers: EduRosterWorker[];
  /** 명부에 없는 사람을 적을 빈 줄 수 */
  blankRows: number;
  /**
   * 스캔용 QR(PNG). 교육 전 출력에 넣는다. 종이가 교육장으로 들어가므로
   * 서명부와 QR이 같은 장에 있으면 따로 챙길 것이 없다.
   */
  qrPng: Uint8Array | null;
  /** QR 아래에 적는 주소. 휴대폰 카메라가 안 되는 사람이 직접 칠 수 있게. */
  qrUrl: string | null;
  /** 시작·종료 칸을 만들지. 보관용 출력에서 true. */
  withScanTimes: boolean;
  /** 법정 최소시간(분). 미달을 붉게 찍는 기준. 규정이 없으면 null. */
  requiredMin: number | null;
  printedAt: Date;
};

/**
 * 문서에 찍히는 고정 문구.
 * 폰트를 쓰인 글자만으로 깎기 때문에 여기 빠진 글자는 인쇄되지 않는다.
 * 문구를 고칠 때는 이 목록도 함께 확인할 것.
 */
const STATIC_TEXT = [
  "법정의무교육 실시 기록",
  "교육대장 · 참석자 서명부",
  "교육 정보",
  "교육명 근거 사업장 일시 교육시간 장소 강사",
  "교육방법 집체교육 직원연수 조회 회의 사이버교육 자료 배포 게시",
  "교육 내용",
  "참석자 명단",
  "번호 사번 성명 작업팀 시작 종료 서명",
  "총 명 명부 기준",
  "명부에 없는 참석자는 빈 줄에 직접 적습니다",
  "위와 같이 교육을 실시하였음을 확인합니다",
  "강사 서명 작성자 서명",
  "이 문서는 교육자료와 교육 사진과 함께 보관합니다",
  "출력",
  // 스캔 안내와 집계
  "교육 시작과 끝에 각각 한 번 찍어 주세요",
  "시작 찍은 사람 끝까지 찍은 사람 최소시간 채움 미달 확인 안 됨 미기록",
  "시간 분 미확인 미달",
  "가나다라마바사아자차카타파하",
  "0123456789",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~·…—–",
  "년월일시분초",
].join("");

function collectChars(data: EduRosterData): string {
  const parts: string[] = [STATIC_TEXT];
  const push = (v: string | null | undefined) => {
    if (v) parts.push(v);
  };

  push(data.siteName);
  push(data.siteCode);
  push(data.eduTitle);
  push(data.basis);
  push(data.heldAtText);
  push(data.durationText);
  push(data.place);
  push(data.instructor);
  push(data.qrUrl);
  for (const line of data.contents) push(line);
  for (const w of data.workers) {
    push(w.empNo);
    push(w.name);
    push(w.teamName);
    if (w.startedAt) push(timeLabel(w.startedAt));
    if (w.endedAt) push(timeLabel(w.endedAt));
    push(minutesLabel(stayMinutes({ startedAt: w.startedAt ?? null, endedAt: w.endedAt ?? null })));
  }
  push(dateTimeLabel(data.printedAt));

  return [...new Set(parts.join(""))].join("");
}

/** 칸 왼쪽 x 좌표를 미리 구해 둔다. */
function columnXs(cols: Col[]): number[] {
  const xs: number[] = [];
  let x = MARGIN;
  for (const col of cols) {
    xs.push(x);
    x += col.w;
  }
  return xs;
}

function drawCellBorders(page: PDFPage, cols: Col[], top: number, height: number) {
  const xs = columnXs(cols);
  page.drawRectangle({
    x: MARGIN,
    y: top - height,
    width: CONTENT_W,
    height,
    borderColor: LINE,
    borderWidth: 0.7,
  });
  // 첫 칸 왼쪽 선은 바깥 테두리와 겹치므로 건너뛴다.
  for (const x of xs.slice(1)) {
    page.drawLine({
      start: { x, y: top },
      end: { x, y: top - height },
      thickness: 0.7,
      color: LINE,
    });
  }
}

function drawTableHead(c: Cursor, cols: Col[], bold: PDFFont) {
  c.ensure(HEAD_H + ROW_H);
  const top = c.y;
  c.page.drawRectangle({
    x: MARGIN,
    y: top - HEAD_H,
    width: CONTENT_W,
    height: HEAD_H,
    color: HEAD_BG,
  });
  drawCellBorders(c.page, cols, top, HEAD_H);

  const xs = columnXs(cols);
  cols.forEach((col, i) => {
    const size = 9;
    const w = measure(col.label, bold, size);
    drawRun(c.page, col.label, {
      x: xs[i] + (col.w - w) / 2,
      y: top - 12.5,
      size,
      font: bold,
      color: INK,
    });
  });

  c.y = top - HEAD_H;
}

type Cell = { text: string | null; color?: typeof INK };

function drawRow(
  c: Cursor,
  cols: Col[],
  cells: Cell[],
  regular: PDFFont,
  bold: PDFFont,
) {
  // 표 머리와 첫 줄은 떨어지지 않게 묶어 두었으므로, 줄 하나가 들어갈
  // 자리가 없으면 표 머리부터 다음 장에서 다시 시작한다.
  if (c.y - ROW_H < MARGIN + 26) {
    c.ensure(ROW_H);
    drawTableHead(c, cols, bold);
  }

  const top = c.y;
  drawCellBorders(c.page, cols, top, ROW_H);

  const xs = columnXs(cols);
  const baseline = top - ROW_H + 7.5;
  cells.forEach((cell, i) => {
    if (!cell.text) return;
    const col = cols[i];
    let text = cell.text;
    // 칸을 넘치면 잘라 낸다. 서명란이 좁아지는 쪽이 더 나쁘다.
    while (measure(text, regular, ROW_FONT) > col.w - 8 && text.length > 1) {
      text = text.slice(0, -1);
    }
    const w = measure(text, regular, ROW_FONT);
    drawRun(c.page, text, {
      x: xs[i] + (col.w - w) / 2,
      y: baseline,
      size: ROW_FONT,
      font: regular,
      color: cell.color ?? INK,
    });
  });

  c.y = top - ROW_H;
}

/** 라벨 + 값(또는 밑줄). 미리 채운 값이 없으면 손으로 적도록 선만 긋는다. */
function drawField(
  c: Cursor,
  x: number,
  labelWidth: number,
  fieldWidth: number,
  label: string,
  value: string | null,
  regular: PDFFont,
) {
  const baseline = c.y - 11;
  drawRun(c.page, label, { x, y: baseline, size: 8.5, font: regular, color: MUTED });

  const vx = x + labelWidth;
  if (value) {
    drawRun(c.page, value, { x: vx, y: baseline, size: 9.5, font: regular, color: INK });
  }
  // 값이 있어도 선은 그린다. 고쳐 적을 자리가 되고, 칸의 끝이 보인다.
  c.page.drawLine({
    start: { x: vx, y: baseline - 3.5 },
    end: { x: vx + fieldWidth, y: baseline - 3.5 },
    thickness: 0.7,
    color: LINE,
  });
}

/** 네모 칸 + 글자. ☐ 글리프는 폰트에 없을 수 있어 직접 그린다. */
function drawCheckbox(c: Cursor, x: number, label: string, regular: PDFFont): number {
  const baseline = c.y - 11;
  const box = 8;
  c.page.drawRectangle({
    x,
    y: baseline - 0.5,
    width: box,
    height: box,
    borderColor: MUTED,
    borderWidth: 0.8,
  });
  drawRun(c.page, label, {
    x: x + box + 4,
    y: baseline,
    size: 9,
    font: regular,
    color: INK,
  });
  return box + 4 + measure(label, regular, 9);
}

export async function buildEduRosterPdf(data: EduRosterData): Promise<Uint8Array> {
  const { doc, regular, bold } = await createPdf(collectChars(data));
  doc.setTitle(`${data.eduTitle} 교육대장 · ${data.siteName}`);
  doc.setCreator("가공사업부 안전관리 시스템");

  const cols = columns(data.withScanTimes);
  const c = new Cursor(doc, regular, bold);
  /** 첫 장 맨 위. QR 아래 끝을 재는 기준이다. */
  const topY = c.y;

  // QR은 머리 오른쪽에 둔다. 제목과 교육 정보가 왼쪽으로 좁아지지 않도록
  // 제목만 가운데를 비켜 앉힌다.
  const qr = data.qrPng ? await doc.embedPng(data.qrPng) : null;
  if (qr) {
    c.page.drawImage(qr, {
      x: MARGIN + CONTENT_W - QR_SIZE,
      y: c.y - QR_SIZE,
      width: QR_SIZE,
      height: QR_SIZE,
    });
    // 주소는 맨 아래 꼬리말에 적는다. QR 밑에 두면 그 한 줄 때문에 표가
    // 한 장 더 넘어간다.
    const note = "시작·끝 각각 한 번";
    const nw = measure(note, regular, 6.5);
    drawRun(c.page, note, {
      x: MARGIN + CONTENT_W - QR_SIZE / 2 - nw / 2,
      y: c.y - QR_SIZE - 8,
      size: 6.5,
      font: regular,
      color: MUTED,
    });
  }

  // --- 머리 ---------------------------------------------------------------
  const titleCenter = qr ? MARGIN + (CONTENT_W - QR_SIZE - 10) / 2 : MARGIN + CONTENT_W / 2;

  const title = "법정의무교육 실시 기록";
  const titleW = measure(title, bold, 17);
  drawRun(c.page, title, {
    x: titleCenter - titleW / 2,
    y: c.y - 17,
    size: 17,
    font: bold,
    color: INK,
  });
  c.y -= 24;

  const sub = "교육대장 · 참석자 서명부";
  const subW = measure(sub, regular, 9.5);
  drawRun(c.page, sub, {
    x: titleCenter - subW / 2,
    y: c.y - 9.5,
    size: 9.5,
    font: regular,
    color: MUTED,
  });
  c.y -= 16;

  // QR이 있으면 그 아래까지 내려간 다음 선을 긋는다. 제목·부제가 QR보다
  // 짧아서, 그냥 두면 선이 QR을 가로지른다.
  if (qr) c.y = Math.min(c.y, topY - QR_SIZE - 13);
  c.rule(INK);

  // --- 교육 정보 -----------------------------------------------------------
  c.sectionTitle("교육 정보", 80);

  c.fields([{ label: "교육명", value: data.eduTitle }], CONTENT_W);
  c.fields([{ label: "근거", value: data.basis }], CONTENT_W);
  c.fields([{ label: "사업장", value: `${data.siteName} (${data.siteCode})` }], CONTENT_W);
  c.gap(4);

  const half = CONTENT_W / 2;
  drawField(c, MARGIN, 52, half - 64, "일시", data.heldAtText, regular);
  drawField(c, MARGIN + half, 52, half - 52, "교육시간", data.durationText, regular);
  c.y -= 20;

  drawField(c, MARGIN, 52, half - 64, "장소", data.place, regular);
  drawField(c, MARGIN + half, 52, half - 52, "강사", data.instructor, regular);
  c.y -= 22;

  drawRun(c.page, "교육방법", {
    x: MARGIN,
    y: c.y - 11,
    size: 8.5,
    font: regular,
    color: MUTED,
  });
  let bx = MARGIN + 52;
  for (const label of ["집체교육(직원연수·조회·회의)", "사이버교육", "자료 배포·게시"]) {
    bx += drawCheckbox(c, bx, label, regular) + 14;
  }
  c.y -= 20;

  // --- 교육 내용 -----------------------------------------------------------
  if (data.contents.length > 0) {
    c.sectionTitle("교육 내용", 30);
    data.contents.forEach((line, i) => {
      c.text(`${i + 1}. ${line}`, { size: 9.5, x: MARGIN + 4 });
    });
  }

  // --- 참석자 명단 ---------------------------------------------------------
  c.sectionTitle(`참석자 명단 (명부 기준 총 ${data.workers.length}명)`, HEAD_H + ROW_H * 2);
  c.text("명부에 없는 참석자는 빈 줄에 직접 적습니다.", { size: 8.5, color: MUTED });
  c.gap(2);

  drawTableHead(c, cols, bold);
  data.workers.forEach((w, i) => {
    const scan = { startedAt: w.startedAt ?? null, endedAt: w.endedAt ?? null };
    const base: Cell[] = [
      { text: String(i + 1) },
      { text: w.empNo },
      { text: w.name },
      { text: w.teamName },
    ];
    if (!data.withScanTimes) {
      drawRow(c, cols, [...base, { text: null }], regular, bold);
      return;
    }
    const verdict = stayVerdict(scan, data.requiredMin);
    drawRow(
      c,
      cols,
      [
        ...base,
        { text: scan.startedAt ? timeLabel(scan.startedAt) : null },
        { text: scan.endedAt ? timeLabel(scan.endedAt) : null },
        {
          text: minutesLabel(stayMinutes(scan)),
          color: verdict === "SHORT" ? WARN : verdict === "OK" ? OK : MUTED,
        },
        { text: null },
      ],
      regular,
      bold,
    );
  });
  for (let i = 0; i < data.blankRows; i += 1) {
    drawRow(
      c,
      cols,
      [{ text: String(data.workers.length + i + 1) }, ...cols.slice(1).map(() => ({ text: null }))],
      regular,
      bold,
    );
  }

  // --- 확인 ---------------------------------------------------------------
  c.gap(8);
  c.ensure(56);
  c.text("위와 같이 교육을 실시하였음을 확인합니다.", { size: 9.5, bold: true });
  c.gap(8);
  drawField(c, MARGIN + half - 180, 56, 110, "강사 서명", null, regular);
  drawField(c, MARGIN + half + 10, 56, 110, "작성자 서명", null, regular);
  c.y -= 24;

  c.text("이 문서는 교육자료와 교육 사진과 함께 보관합니다.", { size: 8, color: MUTED });
  c.gap(2);
  // 꼬리말은 한 줄로 모은다. 줄 하나가 늘면 열세 줄짜리 명부도 두 장이 된다.
  // 주소를 함께 적는 것은 휴대폰 카메라가 QR을 못 읽는 사람이 직접 칠 수 있게다.
  c.text(
    [
      `${dateTimeLabel(data.printedAt)} 출력`,
      data.siteName,
      data.qrUrl ? `스캔 ${data.qrUrl}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    { size: 7.5, color: MUTED },
  );

  return doc.save();
}
