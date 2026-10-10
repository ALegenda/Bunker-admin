FROM golang:1.24-bookworm AS build
ARG MINIO_SOURCE_REV=07c3a429bfed433e49018cb0f78a52145d4bedeb
WORKDIR /src
RUN git init -q && \
    git fetch --depth 1 https://github.com/minio/minio.git "$MINIO_SOURCE_REV" && \
    git checkout --detach FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = "$MINIO_SOURCE_REV"
ENV CGO_ENABLED=0 GOMAXPROCS=2
RUN go build -p 2 -tags kqueue -trimpath \
    -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/minio .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /src/LICENSE /usr/share/doc/minio/LICENSE
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="07c3a429bfed433e49018cb0f78a52145d4bedeb"
ENV MINIO_UPDATE=off
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
