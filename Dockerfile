FROM node:20-alpine

WORKDIR /app

# Install dependencies first for caching
COPY package.json package-lock.json* bun.lock* ./
RUN npm install

# Copy application source code
COPY . .

# Expose ports (TanStack Start / Vite)
EXPOSE 8080 5173

# Start development server
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
