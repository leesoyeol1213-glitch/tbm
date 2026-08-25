import { rgb, type PDFFont } from "pdf-lib";
import type { PatrolState, TbmStatus } from "@prisma/client";
import { dateLabel, dateTimeLabel, timeLabel } from "@/lib/kst";
import {
  CONTENT_W,
  Cursor,
  createPdf,
  drawRun,
  HEAD_BG,
  INK,
  LINE,
  MARGIN,
  MUTED,
  measure,
  W,
  WARN,
  wrap,
} from "@/lib/pdf";

export type PatrolPdfData = {
  siteName: string;
  siteCode: string;
  patrolDate: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  weather: string | null;
  patrollerName: string;
  remarks: string | null;
  status: TbmStatus;
  authorName: string | null;
  submittedAt: Date | null;
  approverName: string | null;
  approvedAt: Date | null;
  /** 대결이면 대신 결재받은 법인 대표 이름 */
  onBehalfOfName: string | null;
  correctedAt: Date | null;
  rounds: { place: string; content: string; state: PatrolState; note: string | null }[];
  checks: { content: string; state: PatrolState; action: string | null }[];
};

const STATE_LABEL: Record<PatrolState, string> = {
  GOOD: "양호",
  BAD: "불량",
  NA: "해당없음",
};

/**
 * 고정 문구 목록.
 *
 * 폰트를 문서에 쓰인 글자만 남겨 깎기 때문에, 여기 빠진 글자는 PDF에서 네모로
 * 나온다. 화면 문구를 고칠 때는 이 목록도 함께 확인할 것.
 */
const STATIC_TEXT = [
  "안전(순찰)일지",
  "작성 결재 상신 승인 미기재",
  "대결 승인 후 정정됨",
  "일자 시간 날씨 순찰자",
  "1. 순찰사항",
  "장소 내용 판정 비고",
  "2. 안전점검사항",
  "번호 점검사항 조치사항",
  "양호 불량 해당없음",
  "총 개 항목 중 불량 건",
  "3. 기타건의 및 특이사항",
  "기록된 순찰사항이 없습니다",
  "점검항목이 없습니다",
  "출력",
  "가나다라마바사아자차카타파하",
  "0123456789",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~·…—–",
  "년월일시분초요일",
  "월화수목금토일",
].join("");

/** 이 문서를 그리는 데 필요한 글자만 모은다. */
function collectChars(data: PatrolPdfData): string {
  const parts: string[] = [STATIC_TEXT];
  const push = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
  };

  push(data.siteName);
  push(data.siteCode);
  push(data.patrollerName);
  push(data.weather);
  push(data.remarks);
  push(data.authorName);
  push(data.approverName);
  push(data.onBehalfOfName);
  for (const r of data.rounds) {
    push(r.place);
    push(r.content);
    push(r.note);
  }
  for (const c of data.checks) {
    push(c.content);
    push(c.action);
  }

  const dates = [
    data.patrolDate,
    data.startedAt,
    data.endedAt,
    data.submittedAt,
    data.approvedAt,
    data.correctedAt,
    new Date(),
  ];
  for (const d of dates) {
    if (!d) continue;
    parts.push(dateLabel(d), dateTimeLabel(d), timeLabel(d));
  }

  return parts.join("");
}

type Col = { label: string; w: number; bold?: boolean };

/**
 * 칸 안에서 줄바꿈이 일어나는 표.
 *
 * 조치사항은 한 문단이 통째로 들어오는 일이 흔해서 줄 높이를 미리 정할 수 없다.
 * 칸마다 줄 수를 세어 가장 긴 것에 맞춰 그 줄의 높이를 정한다.
 */
function drawWrappedTable(
  c: Cursor,
  cols: Col[],
  rows: string[][],
  regular: PDFFont,
  bold: PDFFont,
  opts: { emptyText: string; badRows?: Set<number> } = { emptyText: "—" },
) {
  const size = 8.5;
  const lineH = size + 3;
  const padY = 5;
  const headH = 16;

  const header = () => {
    c.ensure(headH + lineH * 2);
    let x = MARGIN;
    c.page.drawRectangle({
      x: MARGIN,
      y: c.y - headH,
      width: CONTENT_W,
      height: headH,
      color: HEAD_BG,
    });
    for (const col of cols) {
      drawRun(c.page, col.label, {
        x: x + 4,
        y: c.y - headH + 5.5,
        size,
        font: bold,
        color: INK,
      });
      x += col.w;
    }
    c.y -= headH;
  };

  header();

  if (rows.length === 0) {
    c.ensure(lineH + padY * 2);
    drawRun(c.page, opts.emptyText, {
      x: MARGIN + 4,
      y: c.y - lineH,
      size,
      font: regular,
      color: MUTED,
    });
    c.y -= lineH + padY;
    return;
  }

  rows.forEach((cells, ri) => {
    const wrapped = cells.map((v, ci) =>
      wrap(v || "—", cols[ci].bold ? bold : regular, size, cols[ci].w - 8),
    );
    const rowH = Math.max(...wrapped.map((w) => w.length)) * lineH + padY * 2;

    // 줄이 통째로 다음 쪽으로 넘어가야 머리글도 다시 그린다.
    if (c.y - rowH < MARGIN + 26) {
      c.ensure(rowH + headH);
      header();
    }

    const top = c.y;
    if (opts.badRows?.has(ri)) {
      c.page.drawRectangle({
        x: MARGIN,
        y: top - rowH,
        width: CONTENT_W,
        height: rowH,
        color: rgb(0.99, 0.95, 0.96),
      });
    }

    let x = MARGIN;
    wrapped.forEach((lines, ci) => {
      lines.forEach((line, li) => {
        drawRun(c.page, line, {
          x: x + 4,
          y: top - padY - lineH * (li + 1) + 3,
          size,
          font: cols[ci].bold ? bold : regular,
          color: INK,
        });
      });
      x += cols[ci].w;
    });

    c.page.drawLine({
      start: { x: MARGIN, y: top - rowH },
      end: { x: W - MARGIN, y: top - rowH },
      thickness: 0.4,
      color: LINE,
    });
    c.y -= rowH;
  });
}

/** 누가 작성하고 누가 결재했는지 */
function drawApprovalBox(
  c: Cursor,
  data: PatrolPdfData,
  regular: PDFFont,
  bold: PDFFont,
) {
  const boxH = 58;
  c.ensure(boxH + 8);

  // 대결이면 결재란에 대표 이름을 싣고, 실제로 누른 사람을 아래에 함께 적는다.
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

export async function buildPatrolPdf(data: PatrolPdfData): Promise<Uint8Array> {
  const { doc, regular, bold } = await createPdf(collectChars(data));

  doc.setTitle(`안전(순찰)일지 ${data.siteName} ${dateLabel(data.patrolDate)}`);
  doc.setCreator("TBM 안전점검 기록 시스템");

  const c = new Cursor(doc, regular, bold);

  // --- 제목과 결재란을 같은 줄에 나란히 -----------------------------------
  const headTop = c.y;
  drawApprovalBox(c, data, regular, bold);

  c.y = headTop;
  c.text("안전(순찰)일지", { size: 15, bold: true, width: 280 });
  c.gap(3);
  c.text(`${data.siteName} (${data.siteCode})`, { size: 9, color: MUTED, width: 280 });

  c.y = headTop - 62;
  c.rule();

  if (data.correctedAt) {
    c.text(`승인 후 정정됨 ${dateTimeLabel(data.correctedAt)}`, { size: 8.5, color: WARN });
    c.gap(2);
  }

  // --- 머리말 (일자·시간·날씨·순찰자) --------------------------------------
  const time = data.startedAt
    ? `${timeLabel(data.startedAt)} ~ ${data.endedAt ? timeLabel(data.endedAt) : ""}`
    : "미기재";
  c.fields(
    [
      { label: "일자", value: dateLabel(data.patrolDate) },
      { label: "시간", value: time },
    ],
    255,
  );
  c.fields(
    [
      { label: "날씨", value: data.weather || "미기재" },
      { label: "순찰자", value: data.patrollerName || "미기재" },
    ],
    255,
  );

  // --- 1. 순찰사항 ---------------------------------------------------------
  c.sectionTitle("1. 순찰사항", 34);
  drawWrappedTable(
    c,
    [
      { label: "장소", w: 90 },
      { label: "내용", w: 231 },
      { label: "판정", w: 50 },
      { label: "비고", w: 140 },
    ],
    data.rounds.map((r) => [r.place, r.content, STATE_LABEL[r.state], r.note ?? ""]),
    regular,
    bold,
    {
      emptyText: "기록된 순찰사항이 없습니다.",
      badRows: new Set(
        data.rounds.map((r, i) => (r.state === "BAD" ? i : -1)).filter((i) => i >= 0),
      ),
    },
  );

  // --- 2. 안전점검사항 -----------------------------------------------------
  const bad = data.checks.filter((x) => x.state === "BAD").length;
  c.sectionTitle("2. 안전점검사항", 34);
  drawWrappedTable(
    c,
    [
      { label: "번호", w: 32 },
      { label: "점검사항", w: 219 },
      { label: "판정", w: 50 },
      { label: "조치사항", w: 210 },
    ],
    data.checks.map((x, i) => [
      String(i + 1),
      x.content,
      STATE_LABEL[x.state],
      x.action ?? "",
    ]),
    regular,
    bold,
    {
      emptyText: "점검항목이 없습니다.",
      badRows: new Set(
        data.checks.map((x, i) => (x.state === "BAD" ? i : -1)).filter((i) => i >= 0),
      ),
    },
  );
  c.gap(4);
  c.text(`총 ${data.checks.length}개 항목 중 불량 ${bad}건`, {
    size: 9,
    bold: true,
    color: bad > 0 ? WARN : INK,
  });

  // --- 3. 기타건의 및 특이사항 ---------------------------------------------
  c.sectionTitle("3. 기타건의 및 특이사항", 20);
  c.text(data.remarks || "—");

  // --- 쪽번호 -------------------------------------------------------------
  const pages = c.allPages;
  const printed = dateTimeLabel(new Date());
  pages.forEach((page, i) => {
    drawRun(
      page,
      `${data.siteName} · ${dateLabel(data.patrolDate)} · 출력 ${printed}`,
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
