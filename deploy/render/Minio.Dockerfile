FROM quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z
COPY deploy/render/storage.sh /usr/local/bin/bunker-storage.sh
ENV MINIO_BROWSER=off MINIO_UPDATE=off
EXPOSE 9000
ENTRYPOINT ["/bin/sh", "/usr/local/bin/bunker-storage.sh"]
