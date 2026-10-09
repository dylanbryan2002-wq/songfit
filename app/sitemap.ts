import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/src/shared/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_ORIGIN}/` }, { url: `${SITE_ORIGIN}/privacy` }];
}
