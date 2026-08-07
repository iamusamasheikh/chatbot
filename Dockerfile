FROM node:18-alpine

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy source files
COPY . .

# Ensure data directory exists for SQLite storage
RUN mkdir -p /app/data

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
