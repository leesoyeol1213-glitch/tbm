import ExcelJS from "exceljs";
import { normalizeBirthMmdd } from "@/lib/workerVerify";

/** 엑셀/CSV 열 이름. 여러 표기를 받아 준다. */
const COLUMN_ALIASES: Record<keyof WorkerRow, string[]> = {
  name: ["이름", "성명", "작업자", "name"],
  empNo: ["사번", "사원번호", "직원번호", "empno", "emp_no"],
  phone: ["휴대폰", "전화번호", "연락처", "휴대전화", "phone", "tel"],
  birthMmdd: ["생년월일", "생일", "birth", "birthday", "dob"],
  jobTitle: ["직종", "직무", "담당", "직책", "jobtitle", "job"],
  teamName: ["팀", "소속팀", "작업팀", "반", "team"],
  company: ["업체", "소속업체", "협력업체", "회사", "company"],
};

export type WorkerRow = {
  name: string;
  empNo: string;
  phone: string;
  /** 월일 네 자리(MMDD)로 다듬은 값. 읽지 못했으면 빈 문자열. */
  birthMmdd: string;
  jobTitle: string;
  teamName: string;
  company: string;
};

export type ParsedRow = {
  /** 엑셀 기준 행 번호 (1행은 머리글) */
  line: number;
  data: WorkerRow;
  errors: string[];
};

export type ParseResult = {
  rows: ParsedRow[];
  /** 파일 자체가 잘못됐을 때 */
  fatal: string | null;
  /** 인식한 열 이름 */
  headers: string[];
};

export const TEMPLATE_HEADERS = [
  "이름",
  "사번",
  "생년월일",
  "휴대폰",
  "직종",
  "팀",
  "소속업체",
];

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "").replace(/[()[\]*]/g, "");
}

/** 머리글 행에서 각 항목이 몇 번째 열인지 찾는다. */
function mapColumns(headers: string[]): Partial<Record<keyof WorkerRow, number>> {
  const map: Partial<Record<keyof WorkerRow, number>> = {};
  headers.forEach((raw, index) => {
    const h = normalizeHeader(raw);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.some((a) => normalizeHeader(a) === h)) {
        const key = field as keyof WorkerRow;
        if (map[key] === undefined) map[key] = index;
      }
    }
  });
  return map;
}

/** 휴대폰을 010-1234-5678 형태로 다듬는다. 형식이 아니면 원본을 그대로 둔다. */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("010")) {
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return raw.trim();
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // 수식·리치텍스트 셀
  if (typeof value === "object") {
    const v = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (v.richText) return v.richText.map((r) => r.text).join("").trim();
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result).trim();
  }
  return String(value).trim();
}

/** 따옴표를 지원하는 최소 CSV 파서 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readGrid(buf: Buffer, filename: string): Promise<string[][]> {
  if (/\.csv$/i.test(filename)) {
    // 엑셀이 붙이는 BOM 제거
    const text = buf.toString("utf8").replace(/^﻿/, "");
    return parseCsv(text);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    // exceljs의 row.values는 1-based라 첫 칸이 비어 있다.
    grid.push(values.slice(1).map(cellText));
  });
  return grid;
}

export async function parseWorkerFile(
  buf: Buffer,
  filename: string,
): Promise<ParseResult> {
  let grid: string[][];
  try {
    grid = await readGrid(buf, filename);
  } catch {
    return { rows: [], fatal: "파일을 읽지 못했습니다. 엑셀(.xlsx) 또는 CSV인지 확인해 주세요.", headers: [] };
  }

  if (grid.length === 0) {
    return { rows: [], fatal: "파일이 비어 있습니다.", headers: [] };
  }

  const headers = grid[0].map((h) => h.trim());
  const cols = mapColumns(headers);

  if (cols.name === undefined) {
    return {
      rows: [],
      fatal: `"이름" 열을 찾지 못했습니다. 첫 줄이 머리글인지 확인해 주세요. (읽은 머리글: ${headers.join(", ") || "없음"})`,
      headers,
    };
  }

  const pick = (row: string[], key: keyof WorkerRow): string => {
    const i = cols[key];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const rows: ParsedRow[] = [];
  const seenEmpNo = new Map<string, number>();

  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r];
    const data: WorkerRow = {
      name: pick(raw, "name"),
      empNo: pick(raw, "empNo"),
      phone: normalizePhone(pick(raw, "phone")),
      birthMmdd: normalizeBirthMmdd(pick(raw, "birthMmdd")) ?? "",
      jobTitle: pick(raw, "jobTitle"),
      teamName: pick(raw, "teamName"),
      company: pick(raw, "company"),
    };

    // 완전히 빈 줄은 건너뛴다
    if (Object.values(data).every((v) => v === "")) continue;

    const errors: string[] = [];
    if (!data.name) errors.push("이름이 비어 있습니다.");
    if (data.name.length > 50) errors.push("이름이 너무 깁니다.");
    if (data.phone && !/^[\d-]{9,20}$/.test(data.phone)) {
      errors.push(`휴대폰 형식을 확인해 주세요: ${data.phone}`);
    }
    // 값이 들어 있는데 월일로 못 읽었으면 알려 준다. 조용히 버리면
    // 나중에 본인 확인이 휴대폰으로 내려간 것을 아무도 모른다.
    if (pick(raw, "birthMmdd") && !data.birthMmdd) {
      errors.push(
        `생년월일을 읽지 못했습니다: ${pick(raw, "birthMmdd")} (0315 또는 1990-03-15 형식)`,
      );
    }
    if (data.empNo) {
      const prev = seenEmpNo.get(data.empNo);
      if (prev !== undefined) errors.push(`사번이 ${prev}행과 중복됩니다: ${data.empNo}`);
      else seenEmpNo.set(data.empNo, r + 1);
    }

    rows.push({ line: r + 1, data, errors });
  }

  if (rows.length === 0) {
    return { rows: [], fatal: "등록할 인원이 없습니다. 머리글 아래에 내용을 채워 주세요.", headers };
  }

  return { rows, fatal: null, headers };
}

/** 업로드용 빈 템플릿 엑셀 */
export async function buildTemplateWorkbook(
  siteName: string,
  teamNames: string[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TBM 안전점검 기록";
  const ws = wb.addWorksheet("작업자 명부");

  ws.columns = [
    { header: "이름", key: "name", width: 12 },
    { header: "사번", key: "empNo", width: 14 },
    { header: "생년월일", key: "birthMmdd", width: 14 },
    { header: "휴대폰", key: "phone", width: 16 },
    { header: "직종", key: "jobTitle", width: 12 },
    { header: "팀", key: "teamName", width: 16 },
    { header: "소속업체", key: "company", width: 18 },
  ];

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };

  ws.addRow({
    name: "홍길동",
    empNo: "A-001",
    birthMmdd: "0315",
    phone: "010-1234-5678",
    jobTitle: "조립",
    teamName: teamNames[0] ?? "조립1반",
    company: "",
  });

  const guide = wb.addWorksheet("작성 안내");
  guide.columns = [{ width: 90 }];
  const lines = [
    `[${siteName}] 작업자 명부 업로드 양식`,
    "",
    "· 첫 번째 시트의 2행부터 채워 주세요. 1행(머리글)은 지우지 마세요.",
    "· 예시로 들어 있는 '홍길동' 줄은 지우고 실제 인원을 넣으세요.",
    "· 이름만 필수입니다. 나머지는 비워도 됩니다.",
    "",
    "· 사번: 같은 사업장 안에서 겹치면 안 됩니다. 다시 업로드할 때 이 값으로",
    "  같은 사람인지 판단하므로, 넣어 두면 나중에 수정이 편합니다.",
    "· 생년월일: QR 출석 때 본인 확인에 씁니다. 태어난 월일 네 자리(0315)만",
    "  저장하며 연도는 버립니다. 1990-03-15, 900315 처럼 넣어도 됩니다.",
    "  휴대폰과 달리 바뀌지 않으므로 이 칸을 채워 두는 것을 가장 권합니다.",
    "  ※ 엑셀이 0315를 315로 바꾸는 것을 막으려면 칸 서식을 '텍스트'로 두세요.",
    "· 휴대폰: 생년월일이 비어 있을 때만 뒤 4자리를 본인 확인에 씁니다.",
    "  형식은 010-1234-5678, 01012345678 어느 쪽이든 됩니다.",
    "· 팀: 팀이 없으면 QR을 찍어도 출석이 기록되지 않습니다. 꼭 채워 주세요.",
    "",
    teamNames.length > 0
      ? `현재 등록된 팀: ${teamNames.join(", ")}`
      : "아직 등록된 팀이 없습니다. 업로드할 때 '없는 팀 자동 생성'을 켜 두세요.",
  ];
  lines.forEach((line) => guide.addRow([line]));
  guide.getRow(1).font = { bold: true, size: 14 };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
