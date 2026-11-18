# 500cc Grand Prix '90

Two-stroke 500cc motorcycle racing in the browser with local 2P split-screen, 3D PBR showroom, 3-round 1990 Championship, and **Online 1v1 Duel** over WebRTC DataChannels.

---

## Local Development

```powershell
# Start local HTTP + signaling server (default http://localhost:8090)
node server.js

# Run automated verification suite
node test_gp500.js
```

Locally, `/api/room` uses an in-memory `Map` with 600-second room TTL and STUN-only ICE discovery (suitable for localhost / same-LAN browser testing).

---

## Vercel Deployment (Online 1v1 Duel)

1. **Push to GitHub**
   - Push the repository to GitHub with `main` as your default branch.

2. **Import into Vercel**
   - In the Vercel Dashboard, click **Add New -> Project** and import the GitHub repository.
   - Set **Root Directory** to `gp500-1990`.
   - Set **Framework Preset** to `Other` (leave **Build Command** and **Output Directory** empty).
   - `vercel.json` configures `Cache-Control: no-store` on `/api/*` and `Content-Type: model/gltf-binary` on `*.glb`, while `api/room.js` is deployed automatically as `/api/room`.

3. **Connect Upstash Redis Storage**
   - Open your Vercel project -> **Storage** -> **Create Database** -> **Upstash Redis (Free)** -> **Connect** to the project.
   - This injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` (direct `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` env vars are also supported).

4. **Add TURN Relay Environment Variables**
   - In Cloudflare Dashboard, open **Calls / Realtime -> TURN**, create a TURN key, and copy the Key ID and API Token.
   - In Vercel Project -> **Settings -> Environment Variables**, add:
     - `TURN_KEY_ID` — Cloudflare TURN Key ID
     - `TURN_API_TOKEN` — Cloudflare TURN API Token
   - *(Optional static fallback if using another TURN provider: `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`.)*

5. **Redeploy**
   - Trigger a **Redeploy** in Vercel **Deployments** so the `/api/room` serverless function picks up the Redis and TURN environment variables.

---

## Verifying Online Multiplayer & Forced TURN (`?relay=1`)

1. **Cross-network test**: Open your Vercel URL on a desktop browser (`Host`) and click **PLAY ONLINE -> CREATE ROOM**, then open the invite link (`?room=XXXXX`) on a phone over **cellular data (Wi-Fi off)**. Confirm the DataChannel connects within a few seconds.
2. **Forced TURN relay check (`?relay=1`)**:
   - Open `https://<your-deployment>.vercel.app/?relay=1` on the Host, create a room, and append `&relay=1` to the Guest invite link (`https://<your-deployment>.vercel.app/?room=XXXXX&relay=1`).
   - `?relay=1` sets `iceTransportPolicy: 'relay'` so WebRTC traffic must traverse your configured TURN server.
   - Confirm the connection succeeds and the race HUD badge displays **`RELAY`** (instead of `P2P`).

---

## `/api/room` Signaling API

| Method & Query | Request Body | Success Response | Error Codes |
|---|---|---|---|
| `GET /api/room?action=ice` | — | `200 { iceServers }` | `405` |
| `POST /api/room?action=create` | `{ offer, hostMeta?, code? }` | `200 { code, expiresIn: 600 }` | `400`, `409` (code taken), `429` (>20/hr per IP) |
| `GET /api/room?code=XXXXX` | — | `200 { code, offer, answer, hostMeta, guestMeta, iceServers }` | `400`, `404` (missing/expired) |
| `POST /api/room?action=answer` | `{ code, answer, guestMeta? }` | `200 { ok: true, code }` | `400`, `404` (missing/expired), `409` (room full) |
