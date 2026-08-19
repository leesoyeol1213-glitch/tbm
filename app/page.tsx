import { redirect } from "next/navigation";
import { requireUser } from "@/lib/authz";

export default async function Home() {
  const user = await requireUser();
  redirect(user.role === "HQ_ADMIN" ? "/dashboard" : "/tbm");
}
