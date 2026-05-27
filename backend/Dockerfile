# --- build: compila o TypeScript ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime: só dependências de produção + dist ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Pasta de fotos/avatares (montada como volume no compose para persistir).
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "dist/index.js"]
