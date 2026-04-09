FROM node:18-slim

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for Tailwind/PostCSS/Vite)
RUN npm install

# Copy source code
COPY . .

# Build frontend (skip tsc strict check, use vite build directly)
RUN npx vite build

# Expose ports: 3011 (API server), 3010 (Vite dev — only used in dev mode)
EXPOSE 3011 3010

# Default: run both API server and Vite dev server
CMD ["npm", "run", "dev:all"]
