/**
 * RFC 5987 content-disposition: an ASCII fallback in `filename` for old clients, and the full
 * UTF-8 name in `filename*` (a title may carry non-ASCII, e.g. Yoruba names).
 */
export const contentDisposition = (kind, fileName) => {
  const ascii = String(fileName).replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};
