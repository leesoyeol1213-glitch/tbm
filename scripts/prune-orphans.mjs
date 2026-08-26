/**
 * 주인 없는 사진 파일 정리.
 *
 * 사진을 화면에서 지우면 기록은 사라지지만 파일은 저장소에 남아 있었다.
 * 올라가다 만 파일이 아니라, 올라간 뒤에 사람이 지운 파일들이다. 그것을
 * 찾아 지운다. 어느 기록도 가리키지 않으므로 화면이나 PDF에서 사라지는
 * 것은 없고, 되찾는 것은 용량뿐이다.
 *
 *   npm run prune-orphans                          미리보기 (아무것도 안 지움)
 *   npm run prune-orphans -- --confirm             실제 정리
 *   npm run prune-orphans -- --confirm --no-save   받아두지 않고 바로 지움
 *
 * 지우기 전에 backup/orphans-YYYY-MM-DD/ 로 먼저 받아 둔다. 사람이 이미
 * 지운 사진이라 되살릴 일은 거의 없지만, 한 번 지우면 방법이 없다.
 * 받아두지 못한 파일은 지우지도 않는다.
 *
 * 지금은 사진을 지울 때 파일도 함께 지운다. 이 명령은 그 전에 쌓인 것을
 * 치우는 용도이고, 앞으로도 어쩌다 남는 것이 있으면 여기서 잡힌다.
 *
 * 보관 기간이 지난 사진을 정리하는 것은 이 명령이 아니다. 그건
 * prune-photos 쪽이고, 백업 확인을 거친다.
 */

import { PrismaClient } from "@prisma/client";
import { del, list } from "@vercel/blob";
import fs from "node:fs/promises";
import path from "node:path";

const confirm = process.argv.includes("--confirm");
const save = !process.argv.includes("--no-save");
const token = process.env.BLOB_READ_WRITE_TOKEN;
const prisma = new PrismaClient();

if (!token) {
  console.error("BLOB_READ_WRITE_TOKEN이 없습니다.");
  process.exit(1);
}

const mb = (n) => (n / 1024 / 1024).toFixed(2);

async function main() {
  // 살아 있는 기록이 가리키는 파일. 정리된(archivedAt) 사진은 파일이 이미
  // 없으므로 지키지 않는다 — 남아 있다면 그것도 주인 없는 파일이다.
  const rows = await prisma.tbmPhoto.findMany({
    where: { archivedAt: null },
    select: { pathname: true },
  });
  const used = new Set(rows.map((r) => r.pathname));

  const blobs = [];
  let cursor;
  do {
    const res = await list({ cursor, limit: 1000, token });
    blobs.push(...res.blobs);
    cursor = res.cursor;
  } while (cursor);

  const orphans = blobs.filter((b) => !used.has(b.pathname));
  const bytes = orphans.reduce((s, b) => s + b.size, 0);
  const totalBytes = blobs.reduce((s, b) => s + b.size, 0);

  console.log(`저장소 파일 ${blobs.length}개 · ${mb(totalBytes)}MB`);
  console.log(`쓰이는 파일 ${used.size}개`);
  console.log(`주인 없는 파일 ${orphans.length}개 · ${mb(bytes)}MB\n`);

  if (orphans.length === 0) {
    console.log("정리할 것이 없습니다.");
    return;
  }

  for (const o of orphans.slice(0, 20)) {
    const kb = String(Math.round(o.size / 1024)).padStart(5);
    console.log(`  ${kb}KB  ${o.uploadedAt.toISOString().slice(0, 16)}  ${o.pathname}`);
  }
  if (orphans.length > 20) console.log(`  … 외 ${orphans.length - 20}개`);

  if (!confirm) {
    console.log("\n미리보기입니다. 실제로 지우려면 --confirm 을 붙이세요.");
    console.log("  npm run prune-orphans -- --confirm");
    return;
  }

  // KST 기준 날짜. 서버가 UTC라 그냥 찍으면 하루가 밀린다.
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const saveDir = path.resolve("backup", `orphans-${today}`);
  if (save) {
    await fs.mkdir(saveDir, { recursive: true });
    console.log(`\n먼저 받아 둡니다: ${saveDir}`);
  }

  let ok = 0;
  let fail = 0;
  let saved = 0;

  console.log("\n지우는 중…");
  for (const o of orphans) {
    try {
      if (save) {
        // 저장 경로를 살려 둔다. 어느 TBM 사진이었는지 폴더만 보고 알 수 있다.
        const rel = o.pathname.replace(/^\/+/, "").replace(/[:*?"<>|]/g, "_");
        const dest = path.join(saveDir, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const res = await fetch(o.url);
        if (!res.ok) throw new Error(`받아두기 실패 HTTP ${res.status}`);
        await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
        saved += 1;
      }
      await del(o.url, { token });
      ok += 1;
    } catch (e) {
      // 못 받아뒀으면 지우지 않는다. 받아 두는 뜻이 없어진다.
      fail += 1;
      console.log(`  실패 ${o.pathname}: ${e?.message ?? e}`);
    }
  }

  console.log(`\n정리 ${ok}개${fail > 0 ? `, 실패 ${fail}개` : ""} · ${mb(bytes)}MB 회수`);
  if (save) console.log(`받아 둔 파일 ${saved}개: ${saveDir}`);
}

main()
  .catch((e) => {
    console.error("정리 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
