# middleware/

## auth.js — user JWT
- Reads `Authorization: Bearer <jwt>`, verifies with `process.env.JWT_SECRET` (`jsonwebtoken`), sets `req.user = { id, email, name, iat, exp }`.
- 401 `"No token provided"` / `"Invalid or expired token"`. The Flutter Dio interceptor treats **any 401** as session expiry and signs the user out, so don't return 401 for non-auth reasons on JWT routes (e.g. the RevenueCat webhook uses 401 but isn't called by the app).
- Tokens are issued only by `routes/auth.js` (login/signup), 7-day expiry, no refresh or revocation. Changing `JWT_SECRET` logs everyone out.
- Always use `req.user.id` for ownership. Several routes still trust a `userId` in the body (see root CLAUDE.md).

## adminAuth.js — admin API key
- Requires header `x-admin-key` strictly equal to `process.env.ADMIN_API_KEY`. Used only by `/admin/*`. Plain `!==` comparison (not constant-time). A missing header is always rejected, so an unset `ADMIN_API_KEY` doesn't open the routes. A request sending an empty-string header is also rejected.
- No admin UI in this repo; the key is used by whatever tool generates promo codes (curl/Postman/dashboard elsewhere).

Usage: `router.post("/x", authMiddleware, handler)` per route — middleware is applied per route, not globally; a new route is public unless you add it.
