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

  return NextResponse.json(
    { env, dbUrlShape, db, runtime: process.version, region: process.env.VERCEL_REGION ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
