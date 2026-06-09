# syntax=docker/dockerfile:1.7

############################################
# Stage 1 — build (Vite -> dist/ estático)
############################################
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# A API é consumida na MESMA origem do proxy (porta 2555), no caminho /api.
# O nginx-proxy roteia /api -> backend. Por isso o bundle nasce com VITE_API_URL=/api.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

COPY . .
RUN npm run build

############################################
# Stage 2 — runtime (nginx servindo o estático)
############################################
FROM nginx:1.27-alpine AS runner

# Config do SPA (fallback p/ index.html nas rotas do react-router)
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
