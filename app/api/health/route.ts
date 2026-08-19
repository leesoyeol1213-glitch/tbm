import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 배포 환경 점검용. 비밀값은 절대 내보내지 않고 "있는지 없는지"와
 * DB가 실제로 붙는지만 알려 준다. 배포 직후 한 번 열어 보는 용도.
 */
export async function GET() {
  const envs = [
    "DATABASE_URL",
    "AUTH_SECRET",
    "KAKAO_REST_API_KEY",
    "NEXT_PUBLIC_APP_URL",
    "BLOB_READ_WRITE_TOKEN",
  ] as const;

  const env: Record<string, unknown> = {};
  for (const key of envs) {
    const raw = process.env[key];
    env[key] = raw
      ? {
          set: true,
          length: raw.length,
          // 따옴표째 붙여넣는 실수가 잦아 따로 짚어 준다.
          wrappedInQuotes: /^["'].*["']$/.test(raw),
          hasWhitespace: raw !== raw.trim(),
        }
      : { set: false };
  }

  // DATABASE_URL은 형태만 확인한다. 비밀번호는 내보내지 않는다.
  let dbUrlShape: unknown = null;
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const u = new URL(url);
      // 공개 주소로 열리므로 호스트는 뒷부분만 보여 준다.
      const parts = u.hostname.split(".");
      dbUrlShape = {
        protocol: u.protocol,
        host: parts.length > 2 ? `***.${parts.slice(-3).join(".")}` : "***",
        database: u.pathname.slice(1),
        hasPassword: Boolean(u.password),
        pooled: u.hostname.includes("-pooler"),
        params: u.search,
      };
    } catch {
      dbUrlShape = { parseError: "URL 형식이 아닙니다" };
    }
  }

  // 실제 연결 시도
  let db: unknown;
  const started = Date.now();
  try {
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT 1 as n`;
    const sites = await prisma.site.count();
    const users = await prisma.user.count();
    db = { ok: Number(n) === 1, sites, users, ms: Date.now() - started };
  } catch (e) {
    // 메시지에 접속 정보가 섞일 수 있어 종류와 코드만 남긴다.
    const err = e as { name?: string; code?: string; message?: string };
    db = {
      ok: false,
      name: err.name ?? "Error",
      code: err.code ?? null,
      hint: (err.message ?? "").split("\n")[0].slice(0, 120),
      ms: Date.now() - started,
    };
  }

  // 결재 PDF는 사진을 줄여서 넣는다. 네이티브 모듈이라 배포 환경에서 못 올라올 수
  // 있는데, 그러면 PDF가 원본을 넣어 무거워진다(발급 자체는 된다). 여기서 확인한다.
  let imaging: unknown;
  try {
    const { default: sharp } = await import("sharp");
    // 모듈이 올라오는 것과 실제로 줄일 수 있는 것은 다르다. 작은 그림을 만들어 돌려 본다.
    const probe = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#888888" },
    })
      .resize({ width: 32 })
      .jpeg({ quality: 80 })
      .toBuffer();
    imaging = {
      ok: true,
      sharp: sharp.versions.sharp,
      libvips: sharp.versions.vips,
      resizedBytes: probe.length,
    };
  } catch (e) {
    const err = e as { message?: string };
    imaging = {
      ok: false,
      hint: (err.message ?? String(e)).split(/\r?\n/).slice(0, 3).join(" / ").slice(0, 300),
    };
  }

  return NextResponse.json(
    {
      env,
      dbUrlShape,
      db,
      imaging,
      runtime: process.version,
      region: process.env.VERCEL_REGION ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
