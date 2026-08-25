/**
 * 오래된 현장 사진 정리.
 *
 * 무료 저장 용량의 병목은 사진뿐이다. 텍스트 기록은 15년을 둬도 안 차므로
 * 건드리지 않는다. 사진 파일만 지우고 촬영 시각·좌표·경고는 DB에 남겨 둔다.
 * 그래서 사진이 없어도 그 사진에 무엇이 걸려 있었는지는 계속 확인된다.
 *
 *   npm run prune-photos -- --before 2026-10-01            미리보기 (아무것도 안 지움)
 *   npm run prune-photos -- --before 2026-10-01 --confirm  실제 정리
 *
 * 안전장치:
 *   - 기본은 미리보기다. --confirm 을 붙여야 지운다.
 *   - 지울 사진이 백업 폴더에 실제로 있는지 파일 단위로 확인한다.
 *     하나라도 없으면 아무것도 지우지 않고 멈춘다.
 *   - 백업 위치는 --backup 으로 바꿀 수 있다(기본 backup/).
 *
 * 한 번 지운 사진은 되돌릴 방법이 없다. 그래서 자동으로 돌리지 않는다.
 */

import { PrismaClient } from "@prisma/client";
import { del } from "@vercel/blob";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const before = flag("before");
const backupRoot = flag("backup") ?? "backup";
const confirm = args.includes("--confirm");

if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
  console.error("사용법: npm run prune-photos -- --before YYYY-MM-DD [--confirm]");
  process.exit(1);
}

// KST 자정 기준. 서버가 UTC라 그냥 파싱하면 하루가 밀린다.
const cutoff = new Date(`${before}T00:00:00+09:00`);
const prisma = new PrismaClient();

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 백업 폴더들에서 이 사진 파일을 찾는다. 어느 회차에 있든 상관없다. */
async function findInBackups(dirs, pathname) {
  const rel = pathname.replace(/^\/+/, "").replace(/[:*?"<>|]/g, "_");
  for (const d of dirs) {
    if (await exists(path.join(d, "photos", rel))) return path.join(d, "photos", rel);
  }
  return null;
}

async function main() {
  const targets = await prisma.tbmPhoto.findMany({
    where: { archivedAt: null, tbm: { workDate: { lt: cutoff } } },
    include: { tbm: { select: { workDate: true, site: { select: { name: true } } } } },
    orderBy: { uploadedAt: "asc" },
  });

  console.log(`기준: ${before} 이전 작업일`);
  console.log(`대상: ${targets.length}장\n`);

  if (targets.length === 0) {
    console.log("정리할 사진이 없습니다.");
    return;
  }

  // --- 백업 확인 -----------------------------------------------------------
  const root = path.resolve(backupRoot);
  let dirs = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
  } catch {
    console.error(`백업 폴더를 찾지 못했습니다: ${root}`);
    console.error("먼저 npm run backup 을 실행하세요.");
    process.exitCode = 1;
    return;
  }

  console.log(`백업 폴더 ${dirs.length}개 확인 중…`);
  const missing = [];
  for (const photo of targets) {
    if (!(await findInBackups(dirs, photo.pathname))) missing.push(photo);
  }

  if (missing.length > 0) {
    console.error(`\n백업에 없는 사진이 ${missing.length}장 있습니다. 아무것도 지우지 않았습니다.`);
    for (const m of missing.slice(0, 5)) {
      console.error(`  ${m.tbm.site.name} ${m.tbm.workDate.toISOString().slice(0, 10)} · ${m.pathname}`);
    }
    if (missing.length > 5) console.error(`  … 외 ${missing.length - 5}장`);
    console.error("\nnpm run backup 을 먼저 실행하세요.");
    process.exitCode = 1;
    return;
  }
  console.log("전부 백업에 있습니다.\n");

  // --- 미리보기 ------------------------------------------------------------
  const bySite = new Map();
  for (const p of targets) {
    const key = `${p.tbm.site.name} ${p.tbm.workDate.toISOString().slice(0, 7)}`;
    bySite.set(key, (bySite.get(key) ?? 0) + 1);
  }
  for (const [k, n] of [...bySite].sort()) console.log(`  ${k.padEnd(34)} ${n}장`);

  if (!confirm) {
    console.log(`\n미리보기입니다. 실제로 지우려면 --confirm 을 붙이세요.`);
    console.log(`  npm run prune-photos -- --before ${before} --confirm`);
    return;
  }

  // --- 실제 정리 -----------------------------------------------------------
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const now = new Date();
  let ok = 0;
  let fail = 0;

  console.log("\n지우는 중…");
  for (const photo of targets) {
    try {
      if (token) await del(photo.url, { token });
      // 파일을 못 지웠는데 표시만 하면 용량은 그대로인 채 화면에서만 사라진다.
      await prisma.tbmPhoto.update({
        where: { id: photo.id },
        data: { archivedAt: now },
      });
      ok += 1;
    } catch (e) {
      fail += 1;
      console.log(`  실패 ${photo.pathname}: ${e?.message ?? e}`);
    }
  }

  console.log(`\n정리 ${ok}장${fail > 0 ? `, 실패 ${fail}장` : ""}`);
  console.log("TBM 본문·출석·점검 결과와 촬영 시각·위치 검증 기록은 그대로 남아 있습니다.");
}

main()
  .catch((e) => {
    console.error("정리 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
