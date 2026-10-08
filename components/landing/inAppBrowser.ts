/** Instagram, Facebook and TikTok in-app browsers: Google refuses OAuth inside embedded webviews. */
const IN_APP = /Instagram|FBAN|FBAV|musical_ly|BytedanceWebview|TikTok/i;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP.test(userAgent);
}

export const SITE_LINK = "https://thissongfits.com";
