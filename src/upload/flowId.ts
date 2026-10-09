/** sessionStorage key holding this tab's landing flowId. Its own module so the landing page reads it
 *  without loading the IndexedDB code (src/upload/pendingUpload.ts) at first paint. */
export const FLOW_ID_KEY = "songfit.flowId";
