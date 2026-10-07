import Link from "next/link";
import { requireAdmin } from "@/src/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="flex items-center gap-6 border-b px-6 py-3 text-sm">
        <Link href="/admin" className="font-semibold">Songfit admin</Link>
        <Link href="/admin/metrics">Metrics</Link>
        <span className="ml-auto text-neutral-500">{admin.email}</span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
