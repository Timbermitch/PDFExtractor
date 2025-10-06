# Deployment Guide

This document explains how to deploy the PDF Extraction Tool as a live demo URL and production-ready service. Multiple deployment targets are supported; choose the one aligned with your stack and required feature set.

## Components
- Backend: Node.js (Express) located in `backend/` (ESM modules). Serves APIs + static `frontend/` fallback.
- Frontend: React (CRA) single-page app or minimal static `index.html + app.js` explorer.

## Environment Variables (Backend)
| Variable | Purpose | Notes |
|----------|---------|-------|
| `PORT` | Listening port (default 5200) | Auto retry (5200→5202) if busy. |
| `NODE_ENV` | `production` / `development` | Impacts logging & potential optimizations. |
| `OPENAI_API_KEY` | Optional LLM classification | Omit to skip classification stage. |
| `ANTHROPIC_API_KEY` | Reserved for future multi-provider classification | Not currently required. |
| `BMP_FILTER` | `1` to enable BMP filtering | Reduces noisy BMP lines. |
| `KEEP_ALIVE` | `1` to disable graceful shutdown on SIGINT (dev) | Leave unset in prod. |
| `GIT_SHA` | Short commit hash (injected at build) | Surfaced at `/version`. |
| `BUILD_TIME` | ISO build timestamp | Surfaced at `/version`. |

Add any secrets through platform secret managers (Render, Railway, Vercel, Netlify, etc.). Do not commit `.env` with real keys.

## Quick Production Build
```
# From repo root
npm install
(cd frontend && npm run build)
# Option 1: Serve CRA build via backend (copy build to a served dir)
cp -R frontend/build backend/public_build
# Adjust server or add express.static('backend/public_build') if not already served.
node backend/server.js
```
For the current minimal static `frontend/index.html` explorer (non-CRA dashboard), simply ensure backend root serves `frontend/` (already implemented).

## Deployment Targets
### 1. Render / Railway (Full Stack)
Pros: Persistent disk, simple service definition.
Steps:
1. Create new Web Service pointing to repo.
2. Root directory: `backend` (start command: `node server.js`).
3. Add environment variables (PORT=10000 typically auto). Expose persistent volume if you need to keep `data/` across restarts.
4. (Optional) Build frontend separately and copy into `backend/frontend` or leverage existing root `frontend` dir.
5. Access via generated URL (e.g., `https://pdf-extractor.onrender.com`).

Persisting data:
- Configure a disk mount at `/opt/render/project/src/data` (Render) or assigned volume path (Railway) and symlink or ensure `process.cwd()` is inside that mapped directory.

Large PDFs:
- Increase instance memory tier if >100MB documents frequently processed. Consider streaming variant (future enhancement) if memory saturated.

### 2. Netlify (Static Frontend + Serverless Functions)
Use only if you refactor backend into serverless functions (not default here). Current setup better suited to a single Node runtime.

Migration Outline (future):
- Move API routes into `netlify/functions` using `@netlify/functions` lambda handler wrappers.
- PDF parsing (heavy) may exceed default function timeout; enable Netlify function timeouts or choose a persistent host instead.

### 3. Vercel
Path 1: Deploy frontend only (static) and point environment variable `REACT_APP_API_BASE` to an external backend URL (Render/Railway).
Path 2 (Advanced): Convert each Express route to Vercel Serverless Functions — not recommended for large PDF parsing due to 10–60s function limits.

### 4. Docker + Any Container Host
Create container images for backend + (optionally) static built frontend.

## Docker Setup
### Backend `Dockerfile` Example
```
FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS build
WORKDIR /app
COPY backend/ ./
COPY --from=deps /app/node_modules ./node_modules
# Optional: copy pre-built frontend bundle if using React build output
# COPY frontend/build ./frontend_build
ENV NODE_ENV=production
EXPOSE 5200
CMD ["node","server.js"]
```

### Frontend (CRA) `Dockerfile` Example
```
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/build /usr/share/nginx/html
# Optionally inject API base via runtime env + entrypoint script
EXPOSE 80
```

### docker-compose.yml
See root `docker-compose.yml` for combined local stack with optional volume persistence.

## docker-compose (Local Dev / Demo)
```
version: '3.9'
services:
  backend:
    build: ./backend
    environment:
      - PORT=5200
      - NODE_ENV=production
      - BMP_FILTER=1
    volumes:
      - ./data:/app/data
    ports:
      - "5200:5200"
  frontend:
    build: ./frontend
    depends_on:
      - backend
    ports:
      - "3000:80"
```
If using the minimal static `frontend/index.html` (non-CRA) you can omit the separate frontend service and serve it directly from backend.

## File Upload & Large PDFs
- In-memory buffering is acceptable up to ~100MB on medium containers (512–1024MB RAM). For serverless or memory-constrained hosts:
  * Switch Multer to disk storage: `multer({ dest: '/tmp/uploads' })`.
  * Stream parse: integrate a streaming PDF text extractor (future integration) to avoid loading entire file.
- Consider adding a max file size limit: `multer({ limits: { fileSize: 120 * 1024 * 1024 } })`.

## Caching & CDN
- Static frontend (if built) can be served behind CDN (Netlify/Vercel/CloudFront) with immutable file naming (`asset.[hash].js`).
- API responses (dynamic) disabled from caching via default Express headers; add `Cache-Control` for idempotent GETs (`/reports`, `/reports/summary`) if needed.

## Observability
- `/health` for liveness.
- `/version` for build metadata (commit SHA & build timestamp).
- (Future) `/metrics` for Prometheus style metrics.

## Security & Hardening (Minimal Baseline)
- Limit upload type to PDF (already enforced).
- Sanitize slug generation (non-alphanumeric replaced with `-`).
- Optional auth: Add API key header check or JWT middleware (not included by default for open demo simplicity).
- Rate limiting: Add `express-rate-limit` to `/upload` and `/process` if exposed publicly.
- CORS: Currently open; restrict origin list for production.

## Zero-Downtime Redeploy (Container Host)
1. Build new image tagged with commit SHA.
2. Push image to registry.
3. Update service to new tag (Rolling update). `/version` change confirms rollout.

## Troubleshooting
| Symptom | Probable Cause | Mitigation |
|---------|----------------|------------|
| Upload 413 Payload Too Large | Host reverse proxy limit | Increase platform body size limit or lower file size. |
| PDF parse fails both methods | Corrupt / scanned (image only) PDF | Integrate OCR (future) or reject with actionable error. |
| High memory usage | Multiple large PDFs concurrently | Queue uploads or scale instance memory. |
| Frontend cannot reach API | Wrong API base / port blocked | Set `REACT_APP_API_BASE` or serve static from backend. |

## Manual One-Liner Smoke (After Deploy)
```
curl -s $BASE_URL/health && curl -s $BASE_URL/version && curl -F "file=@test.pdf" $BASE_URL/upload | jq '.id'
```
Then:
```
ID=<returned-id>
curl -s -X POST $BASE_URL/process -H 'Content-Type: application/json' -d "{\"id\":\"$ID\"}" | jq '.summary'
```

## Future Deployment Enhancements
- Add GitHub Action building & pushing multi-arch images.
- Implement infrastructure as code (Terraform) for cloud storage + OCR batch integration.
- Introduce WebSocket / SSE for long-running batch progress streaming.

---
This deployment guide should be updated when new hosting targets or operational features (metrics, auth, rate limiting) are added.
