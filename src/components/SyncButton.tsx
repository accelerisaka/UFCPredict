"use client";

import { useFormStatus } from "react-dom";
import { forceSyncAction } from "@/app/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button ghost" type="submit" disabled={pending}>
      {pending ? "正在同步赛程…" : "同步最新赛程"}
    </button>
  );
}

export function SyncButton() {
  return (
    <form action={forceSyncAction}>
      <SubmitButton />
    </form>
  );
}
