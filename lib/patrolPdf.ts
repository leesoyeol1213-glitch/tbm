import { rgb, type PDFFont } from "pdf-lib";
import type { PatrolState, PatrolStatus } from "@prisma/client";
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
  plantName: string;
  patrolDate: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  weather: string | null;
  patrollerName: string;
  remarks: string | null;
  status: PatrolStatus;
  authorName: string | null;
  submittedAt: Date | null;
  /** 1차 결재 — 안전실장 */
  reviewerName: string | null;
  reviewedAt: Date | null;
  reviewOnBehalfName: string | null;
  /** 최종 결재 — 본부장 */
  approverName: string | null;
  approvedAt: Date | null;
  onBehalfOfName: string | null;
  correctedAt: Date | null;
  rounds: { place: string; content: string; state: PatrolState; note: string | null }[];
  checks: { content: string; state: PatrolState; action: string | null }[];
};

/**
 * 고정 문구 목록.
 *
 * 폰트를 문서에 쓰인 글자만 남겨 깎기 때문에, 여기 빠진 글자는 PDF에서 네모로
 * 나온다. 화면 문구를 고칠 때는 이 목록도 함께 확인할 것.
 */
const STATIC_TEXT = [
  "안전(순찰)일지",
  "순찰자 안전실장 본부장",
  "상신 결재 승인 대결 미기재",
  "승인 후 정정됨",
  "일자 시간 날씨",
  "1. 순찰사항",
  "장소 내용 양호 불량 비고",
  "2. 안전점검사항",
  "안전점검사항 (제반시설포함)",
  "점검상태(양호/불량) 조치사항 번호",
  "해당없음",
  "총 개 항목 중 불량 건",
  "3. 기타건의 및 특이사항",
  "기록된 순찰사항이 없습니다",
  "점검항목이 없습니다",
  "출력",
  "가나다라마바사아자차카타파하",
  "0123456789",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~·…—–○",
  "년월일시분초요일",
  "월화수목금토일",
].join("");

/** 이 문서를 그리는 데 필요한 글자만 모은다. */
function collectChars(data: PatrolPdfData): string {
  const parts: string[] = [STATIC_TEXT];
  const push = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
  };

  push(data.plantName);
  push(data.patrollerName);
  push(data.weather);
  push(data.remarks);
  push(data.authorName);
  push(data.reviewerName);
  push(data.reviewOnBehalfName);
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
    data.reviewedAt,
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

const ROW_BAD_BG = rgb(0.99, 0.95, 0.96);

type Col = { label: string; w: number; center?: boolean };

/**
 * 칸 안에서 줄바꿈이 일어나는 표.
 *
 * 조치사항은 한 문단이 통째로 들어오는 일이 흔해서 줄 높이를 미리 정할 수 없다.
 * 칸마다 줄 수를 세어 가장 긴 것에 맞춰 그 줄의 높이를 정한다.
 */
function drawTable(
  c: Cursor,
  cols: Col[],
  rows: string[][],
  regular: PDFFont,
  bold: PDFFont,
  opts: { emptyText: string; badRows?: Set<number>; head2?: (string | null)[] },
) {
  const size = 8.5;
  const lineH = size + 3;
  const padY = 5;
  const headH = 15;

  const header = () => {
    const rows2 = opts.head2 ? 2 : 1;
    c.ensure(headH * rows2 + lineH * 2);
    c.page.drawRectangle({
      x: MARGIN,
      y: c.y - headH * rows2,
      width: CONTENT_W,
      height: headH * rows2,
      color: HEAD_BG,
    });

    let x = MARGIN;
    for (const col of cols) {
      const label = col.label;
      const tx = col.center ? x + (col.w - measure(label, bold, size)) / 2 : x + 4;
      drawRun(c.page, label, {
        x: tx,
        y: c.y - headH + 5,
        size,
        font: bold,
        color: INK,
      });
      x += col.w;
    }

    // 둘째 줄 머리글 (양식의 "점검상태(양호/불량)" 아래 공장 이름 칸)
    if (opts.head2) {
      x = MARGIN;
      opts.head2.forEach((label, i) => {
        if (label) {
          const tx = cols[i].center
            ? x + (cols[i].w - measure(label, regular, size - 0.5)) / 2
            : x + 4;
          drawRun(c.page, label, {
            x: tx,
            y: c.y - headH * 2 + 5,
            size: size - 0.5,
            font: regular,
            color: MUTED,
          });
        }
        x += cols[i].w;
      });
    }

    c.y -= headH * rows2;
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
    const wrapped = cells.map((v, ci) => wrap(v || "", regular, size, cols[ci].w - 8));
    const rowH = Math.max(1, ...wrapped.map((w) => w.length)) * lineH + padY * 2;

    // 줄이 통째로 다음 쪽으로 넘어가야 머리글도 다시 그린다.
    if (c.y - rowH < MARGIN + 26) {
      c.ensure(rowH + headH * (opts.head2 ? 2 : 1));
      header();
    }

    const top = c.y;
    if (opts.badRows?.has(ri)) {
      c.page.drawRectangle({
        x: MARGIN,
        y: top - rowH,
        width: CONTENT_W,
        height: rowH,
        color: ROW_BAD_BG,
      });
    }

    let x = MARGIN;
    wrapped.forEach((lines, ci) => {
      lines.forEach((line, li) => {
        const tx = cols[ci].center
          ? x + (cols[ci].w - measure(line, regular, size)) / 2
          : x + 4;
        drawRun(c.page, line, {
          x: tx,
          y: top - padY - lineH * (li + 1) + 3,
          size,
          font: regular,
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

/**
 * 결재란. 종이 양식의 세 칸(공장장·안전관리실장·본부장) 자리에
 * 실제 결재선인 순찰자 → 안전실장 → 본부장을 넣는다.
 */
function drawApprovalBox(
  c: Cursor,
  data: PatrolPdfData,
  regular: PDFFont,
  bold: PDFFont,
) {
  const boxH = 58;
  c.ensure(boxH + 8);

  const cols = [
    {
      title: "순찰자",
      name: data.patrollerName || data.authorName || "—",
      at: data.submittedAt,
      note: "상신",
      extra: null as string | null,
    },
    {
      title: "안전실장",
      name: data.reviewedAt
        ? (data.reviewOnBehalfName ?? data.reviewerName ?? "—")
        : "—",
      at: data.reviewedAt,
      note: "결재",
      extra: data.reviewOnBehalfName ? `대결 ${data.reviewerName ?? "—"}` : null,
    },
    {
      title: "본부장",
      name: data.approvedAt ? (data.onBehalfOfName ?? data.approverName ?? "—") : "—",
      at: data.approvedAt,
      note: "승인",
      extra: data.onBehalfOfName ? `대결 ${data.approverName ?? "—"}` : null,
    },
  ];

  const colW = 98;
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
    drawRun(c.page, col.title, {
      x: x + (colW - measure(col.title, bold, 8.5)) / 2,
      y: top - 11.5,
      size: 8.5,
      font: bold,
      color: INK,
    });
    drawRun(c.page, col.name, {
      x: x + (colW - measure(col.name, bold, 10)) / 2,
      y: top - 32,
      size: 10,
      font: bold,
      color: INK,
    });
    const when = col.at ? `${col.note} ${dateLabel(col.at)}` : "—";
    drawRun(c.page, when, {
      x: x + (colW - measure(when, regular, 7)) / 2,
      y: top - 44,
      size: 7,
      font: regular,
      color: MUTED,
    });
    if (col.extra) {
      drawRun(c.page, col.extra, {
        x: x + (colW - measure(col.extra, regular, 7)) / 2,
        y: top - 53,
        size: 7,
        font: regular,
        color: MUTED,
      });
    }
  });
}

/** 양식의 양호·불량 칸. 해당하는 쪽에만 O를 찍는다. */
function mark(state: PatrolState, want: "GOOD" | "BAD"): string {
  if (state === "NA") return want === "GOOD" ? "해당없음" : "";
  return state === want ? "O" : "";
}

export async function buildPatrolPdf(data: PatrolPdfData): Promise<Uint8Array> {
  const { doc, regular, bold } = await createPdf(collectChars(data));

  doc.setTitle(`안전(순찰)일지 ${data.plantName} ${dateLabel(data.patrolDate)}`);
  doc.setCreator("가공사업부 안전관리 시스템");

  const c = new Cursor(doc, regular, bold);

  // --- 제목과 결재란을 같은 줄에 나란히 -----------------------------------
  const headTop = c.y;
  drawApprovalBox(c, data, regular, bold);

  c.y = headTop;
  c.gap(14);
  c.text("안전(순찰)일지", { size: 17, bold: true, width: 280 });

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
  drawTable(
    c,
    [
      { label: "장소", w: 95 },
      { label: "내용", w: 216 },
      { label: "양호", w: 46, center: true },
      { label: "불량", w: 46, center: true },
      { label: "비고", w: 108 },
    ],
    data.rounds.map((r) => [
      r.place,
      r.content,
      mark(r.state, "GOOD"),
      mark(r.state, "BAD"),
      r.note ?? "",
    ]),
    regular,
    bold,
    {
      emptyText: "기록된 순찰사항이 없습니다.",
      badRows: new Set(
        data.rounds.flatMap((r, i) => (r.state === "BAD" ? [i] : [])),
      ),
    },
  );

  // --- 2. 안전점검사항 -----------------------------------------------------
  const bad = data.checks.filter((x) => x.state === "BAD").length;
  c.sectionTitle("2. 안전점검사항", 40);
  drawTable(
    c,
    [
      { label: "번호", w: 30, center: true },
      { label: "안전점검사항 (제반시설포함)", w: 231 },
      { label: "점검상태(양호/불량)", w: 90, center: true },
      { label: "조치사항", w: 160 },
    ],
    data.checks.map((x, i) => [
      String(i + 1),
      x.content,
      x.state === "GOOD" ? "양호" : x.state === "BAD" ? "불량" : "해당없음",
      x.action ?? "",
    ]),
    regular,
    bold,
    {
      emptyText: "점검항목이 없습니다.",
      // 양식에서 점검상태 칸 머리에 공장 이름이 들어간다.
      head2: [null, null, data.plantName, null],
      badRows: new Set(data.checks.flatMap((x, i) => (x.state === "BAD" ? [i] : []))),
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
    drawRun(page, `${data.plantName} · ${dateLabel(data.patrolDate)} · 출력 ${printed}`, {
      x: MARGIN,
      y: MARGIN - 14,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
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
