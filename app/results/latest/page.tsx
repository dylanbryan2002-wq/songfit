import { redirect } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { listSubmissionsForCreator } from "@/src/db/queries/submissions";

export const dynamic = "force-dynamic";

/** Sends the signed-in creator to their NEWEST submission, whatever its status: the results page
 *  shows the waiting screen in flight and Retry when failed. A stable link to type on a phone;
 *  added after a pasted results link 404'd on 2026-10-07. */
export default async function LatestResultsPage() {
  const creator = await getCreator();
  if (!creator) redirect("/");
  const subs = await listSubmissionsForCreator(creator.id);
  const target = subs[0]; // newest first
  redirect(target ? `/results/${target.id}` : "/");
}
