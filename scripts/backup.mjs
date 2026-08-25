/**
 * 월간 백업.
 *
 * 무료 요금제에는 자동 백업이 없다. Neon 무료는 되돌릴 수 있는 기간이 짧고,
 * Blob 은 지우면 그걸로 끝이다. 그래서 한 달에 한 번 통째로 내려받아 둔다.
 *
 *   npm run backup            전체
 *   npm run backup -- --no-photos   사진 빼고 DB만 (빠르다)
 *   npm run backup -- --out D:/백업  저장 위치 지정
 *
 * 만들어지는 것:
 *   backup/2026-08-31/data.json     모든 표의 내용
 *   backup/2026-08-31/photos/…      현장 사진 원본
 *   backup/2026-08-31/README.txt    무엇이 몇 건 들어 있는지
 *
 * data.json 은 사람이 읽을 수 있는 형태로 저장한다. 되돌릴 일이 생기면
 * 이 파일을 보고 넣으면 되고, 감사 자료로 그대로 넘겨도 된다.
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const withPhotos = !args.includes("--no-photos");
const outArg = args.indexOf("--out");
const baseDir = outArg >= 0 ? args[outArg + 1] : "backup";

const prisma = new PrismaClient();

/** KST 기준 날짜. 서버가 UTC라 그냥 찍으면 하루가 밀린다. */
function todayKst() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function main() {
  const dir = path.resolve(baseDir, todayKst());
  await fs.mkdir(dir, { recursive: true });

  console.log(`백업 위치: ${dir}\n`);

  // 표 이름 → 읽는 방법. 관계는 펼치지 않는다. 각 표를 그대로 뜬 다음
  // id 로 이어 붙이는 편이 파일도 작고 되돌리기도 쉽다.
  const tables = {
    divisions: () => prisma.division.findMany(),
    sites: () => prisma.site.findMany(),
    plants: () => prisma.plant.findMany(),
    users: () =>
      // 비밀번호 해시는 백업에 넣지 않는다. 유출되면 그대로 로그인 시도에 쓰인다.
      prisma.user.findMany({
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          siteId: true,
          divisionId: true,
          phone: true,
          active: true,
          createdAt: true,
        },
      }),
    teams: () => prisma.team.findMany(),
    workers: () => prisma.worker.findMany(),
    checkinPoints: () => prisma.checkinPoint.findMany(),
    checkinPointSites: () => prisma.checkinPointSite.findMany(),
    tbmTemplates: () => prisma.tbmTemplate.findMany(),
    templateEduItems: () => prisma.templateEduItem.findMany(),
    templateHazards: () => prisma.templateHazard.findMany(),
    tbms: () => prisma.tbm.findMany(),
    tbmEduItems: () => prisma.tbmEduItem.findMany(),
    hazardItems: () => prisma.hazardItem.findMany(),
    tbmAttendances: () => prisma.tbmAttendance.findMany(),
    tbmPhotos: () => prisma.tbmPhoto.findMany(),
    patrolTemplates: () => prisma.patrolTemplate.findMany(),
    patrolTemplateItems: () => prisma.patrolTemplateItem.findMany(),
    patrolTemplateRounds: () => prisma.patrolTemplateRound.findMany(),
    patrols: () => prisma.patrol.findMany(),
    patrolRounds: () => prisma.patrolRound.findMany(),
    patrolChecks: () => prisma.patrolCheck.findMany(),
    auditLogs: () => prisma.auditLog.findMany(),
  };

  const data = {};
  const counts = [];
  for (const [name, read] of Object.entries(tables)) {
    const rows = await read();
    data[name] = rows;
    counts.push(`${name} ${rows.length}건`);
    console.log(`  ${name.padEnd(22)} ${String(rows.length).padStart(6)}건`);
  }

  const jsonPath = path.join(dir, "data.json");
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), "utf8");
  const jsonSize = (await fs.stat(jsonPath)).size;
  console.log(`\ndata.json ${(jsonSize / 1024).toFixed(0)} KB`);

  // --- 사진 ---------------------------------------------------------------
  let okCount = 0;
  let failCount = 0;
  let bytes = 0;

  if (withPhotos && data.tbmPhotos.length > 0) {
    const photoDir = path.join(dir, "photos");
    await fs.mkdir(photoDir, { recursive: true });
    console.log(`\n사진 ${data.tbmPhotos.length}장 내려받는 중…`);

    for (const photo of data.tbmPhotos) {
      // 저장 경로를 그대로 살려 둔다. 어느 TBM 사진인지 폴더만 보고 알 수 있다.
      const rel = photo.pathname.replace(/^\/+/, "").replace(/[:*?"<>|]/g, "_");
      const dest = path.join(photoDir, rel);
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const res = await fetch(photo.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(dest, buf);
        bytes += buf.length;
        okCount += 1;
      } catch (e) {
        failCount += 1;
        console.log(`  실패 ${photo.pathname}: ${e?.message ?? e}`);
      }
    }
    console.log(`  받음 ${okCount}장 (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
    if (failCount > 0) console.log(`  실패 ${failCount}장`);
  } else if (!withPhotos) {
    console.log("\n사진은 건너뜁니다 (--no-photos)");
  }

  const readme = [
    `가공사업부 안전관리 백업`,
    `받은 시각: ${new Date().toISOString()}`,
    ``,
    `data.json — 아래 표의 내용이 그대로 들어 있습니다.`,
    ...counts.map((c) => `  · ${c}`),
    ``,
    withPhotos
      ? `photos/ — 현장 사진 ${okCount}장 (${(bytes / 1024 / 1024).toFixed(1)} MB)${
          failCount > 0 ? `, 실패 ${failCount}장` : ""
        }`
      : `photos/ — 받지 않음 (--no-photos)`,
    ``,
    `※ 로그인 비밀번호(해시)는 백업에 넣지 않습니다.`,
    `   계정을 되살릴 때는 비밀번호를 새로 정해 주세요.`,
  ].join("\n");
  await fs.writeFile(path.join(dir, "README.txt"), readme, "utf8");

  console.log(`\n완료. ${dir}`);
}

main()
  .catch((e) => {
    console.error("백업 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
