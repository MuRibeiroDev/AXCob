# syntax=docker/dockerfile:1.7

############################################
# Stage 1 — build (compila TS -> dist/)
############################################
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Dependências completas (inclui dev p/ o nest build).
# bookworm (glibc) usa o binário pré-compilado do bcrypt — sem toolchain de compilação.
COPY package.json package-lock.json ./
RUN npm ci

# Código + configs de build
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Descarta devDependencies, mantém apenas as de produção
RUN npm prune --omit=dev

############################################
# Stage 2 — runtime (imagem enxuta)
############################################
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

# Usuário "node" já existe na imagem oficial — roda sem privilégios de root
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# Qualquer resposta HTTP (mesmo 404 em /api) prova que o Nest está de pé.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api',r=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
