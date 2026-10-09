"use client";
import dynamic from "next/dynamic";

// A client boundary so next/dynamic code-splits: the signed-out landing page never downloads the upload form,
// supabase-js, tus or zod at first paint. Signed-in creators still get it server-rendered.
const UploadForm = dynamic(() => import("./UploadForm").then((m) => m.UploadForm));
const ResumeUpload = dynamic(() => import("./landing/ResumeUpload").then((m) => m.ResumeUpload));

/** Signed-in home: the kept file from the Google round-trip (resume = its flowId), else the upload form. */
export function CreatorUpload({
  creator,
  resume,
  uploadsLeft,
}: {
  creator: { id: string; email: string };
  resume: string | null;
  uploadsLeft: number | null;
}) {
  return resume ? (
    <ResumeUpload creator={creator} flowId={resume} uploadsLeft={uploadsLeft} />
  ) : (
    <UploadForm creator={creator} uploadsLeft={uploadsLeft} />
  );
}
