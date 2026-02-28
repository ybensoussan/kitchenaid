# Build stage
FROM golang:1.26-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache gcc musl-dev

# Copy go mod and sum files
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build the application
# CGO_ENABLED=0 because the project uses modernc.org/sqlite (CGO-free)
RUN CGO_ENABLED=0 GOOS=linux go build -o kitchenaid main.go

# Final stage
FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/kitchenaid .

# Copy static assets
COPY --from=builder /app/static ./static

# Create directories for persistence
RUN mkdir -p /app/data /app/uploads

# Set environment variables defaults
ENV PORT=8080
ENV DB_PATH=/app/data/kitchenaid.db
ENV UPLOADS_DIR=/app/uploads

EXPOSE 8080

CMD ["./kitchenaid"]
