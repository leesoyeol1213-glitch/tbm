import { NextResponse } from "next/server";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { PDFDocument } from "pdf-lib";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canAccessSite, type SessionUser, siteIdsFor, siteScope } from "@/lib/authz";
import { BLANK_ROWS, findPreset } from "@/lib/eduRoster";
import { buildEduRosterPdf, type EduRosterWorker } from "@/lib/eduRosterPdf";

export const dynamic = "force-dynamic";

/** 공개 접속 주소. 환경변수가 있으면 그것을 쓰고, 없으면 요청 호스트에서 유추한다. */
async function baseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** 한 줄 입력에서 받아 올 값. 빈 칸은 종이에서 손으로 적는다. */
function text(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  // 화면과 같은 자리를 지킨다. 본사만 보는 일인데 주소만 알면 받을 수 있으면
  // 막아 둔 뜻이 없어진다 — 더구나 이 응답에는 법인 전체의 명부가 들어간다.
  if (session.user.role !== "HQ_ADMIN") {
    return NextResponse.json({ error: "본사만 내려받을 수 있습니다." }, { status: 403 });
  }
  const user: SessionUser = {
    id: session.user.id,
    name: session.user.name ?? "",
    role: session.user.role,
    siteId: session.user.siteId,
    siteIds: await siteIdsFor({ id: session.user.id, siteId: session.user.siteId }),
  };

  const form = await req.formData();
  const siteId = text(form, "siteId");
  const preset = findPreset(String(form.get("kind") ?? ""));
  // 법인마다 한 장씩 따로 뽑는 것이 원칙이지만, 한 해에 한 번 하는 일이라
  // 열 번 눌러 받게 하지 않는다. 합쳐도 법인별로 장이 갈려 그대로 꽂힌다.
  const all = form.get("all") === "on";
  // 교육이 끝난 뒤 보관용. 스캔 시각과 체류시간을 채워 다시 뽑는다.
  const withScanTimes = form.get("withScanTimes") === "on";

  if (!preset || (!all && !siteId)) {
    return NextResponse.json({ error: "사업장과 교육을 골라 주세요." }, { status: 400 });
  }

  const sites = all
    ? await prisma.site.findMany({
        where: { active: true, ...siteScope(user) },
        select: { id: true, name: true, code: true },
        orderBy: { code: "asc" },
      })
    : await prisma.site.findMany({
        where: { id: siteId! },
        select: { id: true, name: true, code: true },
      });

  if (sites.length === 0) {
    return NextResponse.json({ error: "사업장을 찾지 못했습니다." }, { status: 404 });
  }
  for (const s of sites) {
    if (!canAccessSite(user, s.id)) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
  }

  // 교육 내용은 화면에서 고칠 수 있다. 조문이 개정되면 기본값이 뒤처지므로
  // 보내 온 값을 그대로 쓰고, 비어 있을 때만 기본값으로 돌아간다.
  const contentsRaw = form.get("contents");
  const contents =
    typeof contentsRaw === "string" && contentsRaw.trim().length > 0
      ? contentsRaw
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : preset.contents;

  /**
   * 그 법인·그 교육의 회차. 있으면 QR을 찍고, 보관용 출력에서는 스캔 시각을 쓴다.
   * 가장 최근 교육일 한 건만 본다 — 해가 바뀌어도 종이는 그해 것으로 뽑는다.
   */
  const sessions = await prisma.legalEduSession.findMany({
    where: { siteId: { in: sites.map((s) => s.id) }, kind: preset.kind },
    select: {
      siteId: true,
      token: true,
      place: true,
      instructor: true,
      eduDate: true,
      openedAt: true,
      closedAt: true,
      scans: { select: { workerId: true, startedAt: true, endedAt: true } },
    },
    orderBy: { eduDate: "desc" },
  });
  const sessionBySite = new Map<string, (typeof sessions)[number]>();
  for (const s of sessions) if (!sessionBySite.has(s.siteId)) sessionBySite.set(s.siteId, s);

  const base = await baseUrl();

  const common = {
    eduTitle: preset.title,
    basis: preset.basis,
    heldAtText: text(form, "heldAt"),
    durationText: text(form, "duration"),
    place: text(form, "place"),
    instructor: text(form, "instructor"),
    contents,
    blankRows: BLANK_ROWS,
    withScanTimes,
    requiredMin: preset.requiredMin,
    printedAt: new Date(),
  };

  const merged = await PDFDocument.create();
  merged.setTitle(`${preset.title} 교육대장`);
  merged.setCreator("가공사업부 안전관리 시스템");

  for (const site of sites) {
    const workers = await prisma.worker.findMany({
      where: { siteId: site.id, active: true },
      select: {
        id: true,
        empNo: true,
        name: true,
        team: { select: { name: true } },
      },
      // 서명을 받으러 돌 때 팀별로 모여 있는 쪽이 빠르다.
      orderBy: [{ team: { name: "asc" } }, { name: "asc" }],
    });

    const eduSession = sessionBySite.get(site.id) ?? null;
    const scanByWorker = new Map(
      (eduSession?.scans ?? []).map((s) => [s.workerId, s]),
    );

    // 보관용 출력에는 QR이 필요 없다. 교육이 끝난 종이에 스캔하라는 그림이
    // 남아 있으면 다음 해에 그걸 찍는 사람이 생긴다.
    let qrPng: Uint8Array | null = null;
    let qrUrl: string | null = null;
    if (eduSession && !withScanTimes && !eduSession.closedAt) {
      qrUrl = `${base}/e/${eduSession.token}`;
      qrPng = new Uint8Array(
        await QRCode.toBuffer(qrUrl, { width: 320, margin: 1, errorCorrectionLevel: "M" }),
      );
    }

    const rosterWorkers: EduRosterWorker[] = workers.map((w) => {
      const scan = scanByWorker.get(w.id);
      return {
        empNo: w.empNo,
        name: w.name,
        teamName: w.team?.name ?? null,
        startedAt: scan?.startedAt ?? null,
        endedAt: scan?.endedAt ?? null,
      };
    });

    const bytes = await buildEduRosterPdf({
      ...common,
      // 회차에 적어 둔 장소·강사가 있으면 폼이 비었을 때 그것을 쓴다.
      place: common.place ?? eduSession?.place ?? null,
      instructor: common.instructor ?? eduSession?.instructor ?? null,
      siteName: site.name,
      siteCode: site.code,
      workers: rosterWorkers,
      qrPng,
      qrUrl,
    });

    const one = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(one, one.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }

  const pdf = await merged.save();
  const suffix = withScanTimes ? "_기록" : "";
  const filename = all
    ? `${preset.title}_교육대장${suffix}_${sites.length}개사업장.pdf`
    : `${preset.title}_교육대장${suffix}_${sites[0].name}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition":
        `attachment; filename="edu-roster.pdf"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
