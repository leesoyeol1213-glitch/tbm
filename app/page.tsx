import { redirect } from "next/navigation";
import { requireUser } from "@/lib/authz";

export default async function Home() {
  const user = await requireUser();
  // 로그인하고 처음 보는 것이 전체 현황이어야 한다.
  // 작업팀장은 대시보드를 보지 않으므로 자기 팀 TBM으로 보낸다.
  redirect(user.role === "TEAM_LEAD" ? "/tbm" : "/dashboard");
}
