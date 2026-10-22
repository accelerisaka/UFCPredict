import Link from "next/link";
import { redirect } from "next/navigation";
import { registerAction } from "@/app/actions";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const params = await searchParams;
  const nextPath = params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";

  return (
    <div className="page narrow">
      <section className="intro compact">
        <p className="eyebrow">注册</p>
        <h1>开一个 100 美元一场的模拟账本</h1>
        <p className="lede">
          已经有账号？ <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>登录</Link>
        </p>
      </section>
      <AuthForm action={registerAction} mode="register" nextPath={nextPath} />
    </div>
  );
}
