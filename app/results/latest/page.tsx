import { redirect } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { listSubmissionsForCreator } from "@/src/db/queries/submissions";

export const dynamic = "force-dynamic";

/** Sends the signed-in creator to their newest finished result (or newest submission). A stable
 *  link to type on a phone; added after a pasted results link 404'd on 2026-10-07. */
export default async function LatestResultsPage() {
  const creator = await getCreator();
  if (!creator) redirect("/");
  const subs = await listSubmissionsForCreator(creator.id);
  const target = subs.find((s) => s.status === "ready") ?? subs[0];
  redirect(target ? `/results/${target.id}` : "/");
}
