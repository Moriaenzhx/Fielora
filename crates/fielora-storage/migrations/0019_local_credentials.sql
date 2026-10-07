-- Device-local secrets. Never projected to public DTOs, sync or portable exports.
-- NULL is a tombstone: deleting a key must not resurrect its legacy OS copy.
CREATE TABLE local_credentials (
    target TEXT PRIMARY KEY NOT NULL,
    secret BLOB CHECK(secret IS NULL OR (typeof(secret) = 'blob' AND length(secret) BETWEEN 1 AND 2048))
);
