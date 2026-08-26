import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <Image
          src="/logo-wide.png"
          alt="금문철강 · 지지엠"
          width={756}
          height={96}
          priority
          unoptimized
          /*
            -translate-x-1.5 는 눈속임 보정이다. 로고 자체는 정확히 가운데인데,
            두 브랜드 사이의 빈 칸이 로고 한가운데보다 오른쪽(파일 기준 +26px,
            화면에서 약 7.6px)에 있다. 눈은 그 빈 칸을 가운데로 읽어서 로고 전체가
            오른쪽으로 밀린 것처럼 보인다. 그만큼 되밀어 준다.
          */
          className="mx-auto mb-5 h-7 w-auto -translate-x-1.5"
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
