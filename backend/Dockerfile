FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Optionally copy pre-built frontend assets if using CRA build output placed under /app/frontend_build
EXPOSE 5200
CMD ["node","server.js"]
