/**
 * The absolute origin the caller reached us on.
 *
 * A share link has to be absolute and has to point back at the host the student is using, so it
 * is derived from the request rather than from configuration: one deployment serves the app and
 * the API on the same host, and a hardcoded origin would be wrong the moment it does not.
 * `app.set('trust proxy', 1)` is what makes `req.protocol` honour `X-Forwarded-Proto` behind the
 * load balancer, so a proxied request still mints an https link.
 */
export const requestOrigin = (req) => `${req.protocol}://${req.get('host')}`;
