import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <Image
          src="/logo-wide.png"
          alt="금문철강 · 지지엠"
          width={756}
          height={96}
          priority
          unoptimized
          className="mb-5 h-7 w-auto"
        />
        <h1 className="text-2xl font-bold text-slate-900">가공사업부 안전관리</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          일일 TBM 실시 기록·출석·결재 시스템
        </p>
      </div>

      <LoginForm />

      <p className="mt-8 text-center text-xs text-slate-400">
        작업자 출석은 현장에 부착된 QR을 스캔하세요. 로그인이 필요 없습니다.
      </p>
    </main>
  );
}
