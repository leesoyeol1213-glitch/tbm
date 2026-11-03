import { type PDFFont, type PDFPage } from "pdf-lib";
import {
  CONTENT_W,
  Cursor,
  HEAD_BG,
  INK,
  LINE,
  MARGIN,
  MUTED,
  createPdf,
  drawRun,
  measure,
} from "@/lib/pdf";
import { dateTimeLabel } from "@/lib/kst";

/**
 * 법정의무교육 교육대장(참석자 서명부).
 *
 * TBM 양식과 달리 **빈 칸을 인쇄하는 서식**이다. 교육일시·장소·강사는 교육을
 * 하는 그 자리에서 손으로 적고, 서명은 사람이 직접 받아야 하기 때문이다.
 * 미리 채워 넣고 싶은 값만 화면에서 받아 찍고, 나머지는 밑줄로 비워 둔다.
 *
 * 한 법인에 한 장(또는 여러 장)씩 나눠 뽑는다. 교육을 한자리에 모아 하더라도
 * 의무 주체는 법인이라, 서류가 법인별로 갈라져 있어야 그대로 서류철에 꽂힌다.
 */

const ROW_H = 22;
const HEAD_H = 18;
/** 서명을 손으로 받는 칸이라 글자 크기보다 칸 높이가 먼저다. */
const ROW_FONT = 9.5;

/**
 * 칸 너비. 직종은 2026-11-03에 뺐다 — 7종뿐이라(가공 90·절곡 38·선조립 15…)
 * 누가 누군지 가리는 데 보탬이 없고, 그 폭을 서명란에 주는 쪽이 낫다.
 * 글자는 모두 가운데로 모은다.
 */
const COLS = [
  { label: "번호", w: 36 },
  { label: "사번", w: 70 },
  { label: "성명", w: 100 },
  { label: "작업팀", w: 120 },
  { label: "서명", w: 185.28 },
];

/**
 * 화면에서 "몇 장 나옵니다"를 보여 주기 위한 어림수. 실제 장수는 Cursor가
 * 자리를 보고 넘기므로 이 값과 한 장 어긋날 수 있다. 지면 계산을 고쳤으면
 * 여기도 같이 본다.
 */
export const ROWS_FIRST_PAGE = 17;
export const ROWS_LATER_PAGE = 31;

export type EduRosterWorker = {
  empNo: string | null;
  name: string;
  teamName: string | null;
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
  "번호 사번 성명 작업팀 서명",
  "총 명 명부 기준",
  "명부에 없는 참석자는 빈 줄에 직접 적습니다",
  "위와 같이 교육을 실시하였음을 확인합니다",
  "강사 서명 작성자 서명",
  "이 문서는 교육자료와 교육 사진과 함께 보관합니다",
  "출력",
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
  for (const line of data.contents) push(line);
  for (const w of data.workers) {
    push(w.empNo);
    push(w.name);
    push(w.teamName);
  }
  push(dateTimeLabel(data.printedAt));

  return [...new Set(parts.join(""))].join("");
}

/** 칸 왼쪽 x 좌표를 미리 구해 둔다. */
function columnXs(): number[] {
  const xs: number[] = [];
  let x = MARGIN;
  for (const col of COLS) {
    xs.push(x);
    x += col.w;
  }
  return xs;
}

function drawCellBorders(page: PDFPage, top: number, height: number) {
  const xs = columnXs();
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

function drawTableHead(c: Cursor, bold: PDFFont) {
  c.ensure(HEAD_H + ROW_H);
  const top = c.y;
  c.page.drawRectangle({
    x: MARGIN,
    y: top - HEAD_H,
    width: CONTENT_W,
    height: HEAD_H,
    color: HEAD_BG,
  });
  drawCellBorders(c.page, top, HEAD_H);

  const xs = columnXs();
  COLS.forEach((col, i) => {
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

function drawRow(c: Cursor, cells: (string | null)[], regular: PDFFont, bold: PDFFont) {
  // 표 머리와 첫 줄은 떨어지지 않게 묶어 두었으므로, 줄 하나가 들어갈
  // 자리가 없으면 표 머리부터 다음 장에서 다시 시작한다.
  if (c.y - ROW_H < MARGIN + 26) {
    c.ensure(ROW_H);
    drawTableHead(c, bold);
  }

  const top = c.y;
  drawCellBorders(c.page, top, ROW_H);

  const xs = columnXs();
  const baseline = top - ROW_H + 7.5;
  cells.forEach((value, i) => {
    if (!value) return;
    const col = COLS[i];
    let text = value;
    // 칸을 넘치면 잘라 낸다. 서명란이 좁아지는 쪽이 더 나쁘다.
    while (measure(text, regular, ROW_FONT) > col.w - 10 && text.length > 1) {
      text = text.slice(0, -1);
    }
    const w = measure(text, regular, ROW_FONT);
    drawRun(c.page, text, {
      x: xs[i] + (col.w - w) / 2,
      y: baseline,
      size: ROW_FONT,
      font: regular,
      color: INK,
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

  const c = new Cursor(doc, regular, bold);

  // --- 머리 ---------------------------------------------------------------
  const title = "법정의무교육 실시 기록";
  const titleW = measure(title, bold, 17);
  drawRun(c.page, title, {
    x: MARGIN + (CONTENT_W - titleW) / 2,
    y: c.y - 17,
    size: 17,
    font: bold,
    color: INK,
  });
  c.y -= 24;

  const sub = "교육대장 · 참석자 서명부";
  const subW = measure(sub, regular, 9.5);
  drawRun(c.page, sub, {
    x: MARGIN + (CONTENT_W - subW) / 2,
    y: c.y - 9.5,
    size: 9.5,
    font: regular,
    color: MUTED,
  });
  c.y -= 16;
  c.rule(INK);

  // --- 교육 정보 -----------------------------------------------------------
  c.sectionTitle("교육 정보", 80);

  c.fields([{ label: "교육명", value: data.eduTitle }], CONTENT_W);
  c.fields([{ label: "근거", value: data.basis }], CONTENT_W);
  c.fields(
    [{ label: "사업장", value: `${data.siteName} (${data.siteCode})` }],
    CONTENT_W,
  );
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

  drawTableHead(c, bold);
  data.workers.forEach((w, i) => {
    drawRow(c, [String(i + 1), w.empNo, w.name, w.teamName, null], regular, bold);
  });
  for (let i = 0; i < data.blankRows; i += 1) {
    drawRow(c, [String(data.workers.length + i + 1), null, null, null, null], regular, bold);
  }

  // --- 확인 ---------------------------------------------------------------
  c.gap(10);
  c.ensure(56);
  c.text("위와 같이 교육을 실시하였음을 확인합니다.", { size: 9.5, bold: true });
  c.gap(8);
  drawField(c, MARGIN + half - 180, 56, 110, "강사 서명", null, regular);
  drawField(c, MARGIN + half + 10, 56, 110, "작성자 서명", null, regular);
  c.y -= 24;

  c.text("이 문서는 교육자료와 교육 사진과 함께 보관합니다.", {
    size: 8,
    color: MUTED,
  });
  c.gap(2);
  c.text(`${dateTimeLabel(data.printedAt)} 출력 · ${data.siteName}`, {
    size: 8,
    color: MUTED,
  });

  return doc.save();
}
