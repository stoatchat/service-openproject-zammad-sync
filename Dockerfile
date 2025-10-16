# Build stage
FROM denoland/deno:latest AS builder
WORKDIR /app
COPY . .
RUN deno cache main.ts

# Production stage
FROM denoland/deno:latest
WORKDIR /app
COPY --from=builder /app .
CMD ["deno", "run", "--allow-read=.env", "--allow-net", "--allow-env=SECRET_TOKEN,OP_URL,OP_PROJECT,OP_TOKEN,OP_CUSTOM_FIELD,URL_PREFIX,ASSIGNEES,STATUS_MAP", "main.ts"]
EXPOSE 8000
