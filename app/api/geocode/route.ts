import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { geocode } from "@/lib/geocode";

export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || user.role === "TEAM_LEAD") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const result = await geocode(q);

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
