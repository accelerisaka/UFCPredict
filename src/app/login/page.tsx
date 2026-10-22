import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const params = await searchParams;
  const nextPath = params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";

  return (
    <div className="page narrow">
      <section className="intro compact">
        <p className="eyebrow">登录</p>
        <h1>回到你的预测账本</h1>
        <p className="lede">
          还没有账号？ <Link href={`/register?next=${encodeURIComponent(nextPath)}`}>注册</Link>
        </p>
      </section>
      <AuthForm action={loginAction} mode="login" nextPath={nextPath} />
    </div>
  );
}
