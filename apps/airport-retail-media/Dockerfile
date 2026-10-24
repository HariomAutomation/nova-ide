# Multi-stage production build for Airport Retail Media Platform
# TopCoder Development Challenge Deliverable

FROM node:22-alpine AS builder

WORKDIR /app

# Copy root and workspace package files
COPY package.json package-lock.json ./
COPY backend/tsconfig.json ./backend/
COPY frontend/package.json ./frontend/
COPY frontend/tsconfig.json frontend/vite.config.ts frontend/index.html ./frontend/

# Install dependencies
RUN npm ci

# Copy source files
COPY backend/src ./backend/src
COPY frontend/src ./frontend/src

# Compile backend and build frontend static bundle
RUN npm run build

# Stage 2: Lean Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV STATIC_DIR=/app/frontend/dist

# Copy minimal production package.json
COPY package.json ./

# Copy compiled backend and frontend distribution
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/api/health || exit 1

CMD ["node", "backend/dist/server/main.js"]
