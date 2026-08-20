import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import type { SessionUser } from "@/lib/permissions";

// 권한 규칙 자체는 세션과 무관한 순수 함수라 @/lib/permissions에 있다.
// 부르는 쪽이 두 곳을 신경 쓰지 않도록 여기서 그대로 다시 내보낸다.
export * from "@/lib/permissions";

/** 로그인 필수. 세션이 없으면 /login으로 보낸다. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) redirect("/login");
  return { id: u.id, name: u.name ?? "", role: u.role, siteId: u.siteId };
}

/** 특정 역할 필수. 아니면 홈으로 돌려보낸다. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/");
  return user;
}
