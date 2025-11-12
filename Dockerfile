# --- STAGE 1: BUILD STAGE ---
# Use a Node.js image with tools needed for building and compiling
FROM node:20-alpine AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first to cache dependencies layer
# If these files don't change, Docker doesn't re-install node_modules
COPY package*.json ./

# Install dependencies, including dev dependencies (needed for NestJS build and Prisma generation)
RUN npm install

ARG DATABASE_URL

ENV DATABASE_URL=$DATABASE_URL

# Copy the rest of the source code
COPY . .

# CRITICAL: Generate the Prisma Client using the appropriate environment variables
# These are passed via the 'build-args' in your ci.yml

#ARG RABBITMQ_URL
#ARG API_KEY_SECRET

# Set environment variables for the build process

#ENV RABBITMQ_URL=$RABBITMQ_URL
#ENV API_KEY_SECRET=$API_KEY_SECRET


RUN npx prisma generate
# Run the NestJS build command (compiles TypeScript to JavaScript in 'dist/')
# This step also executes 'npx prisma generate' if it's set up in package.json pre-build script, 
# but we rely on the CI job's explicit 'prisma generate' step for robustness.
RUN npm run build


# --- STAGE 2: PRODUCTION STAGE (Runtime) ---
# Use a minimal, non-root Node.js image for a small, secure production environment
FROM node:20-alpine AS runner

# Set working directory
WORKDIR /usr/src/app

# Copy only the compiled application code and production dependencies

# 1. Copy the compiled NestJS code from the builder stage
COPY --from=builder /app/dist ./dist

# 2. Copy the production-only package files
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# 3. Copy the generated Prisma client code
# The Prisma client is installed in node_modules, but this is a safeguard for specific setups
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Expose the port your NestJS app listens on (default is usually 3000)
EXPOSE 3000

# Define production environment variables (Prisma, RabbitMQ, etc.)
# These should be passed to the container at runtime (via Kubernetes/Docker Compose)
ENV NODE_ENV=production
ENV PORT=3000

# Define the command to run the production application
CMD [ "node", "dist/main" ]