-- Non-secret model settings and bounded compatibility evidence, isolated by endpoint and model.
CREATE TABLE model_runtime_settings (
    provider_config_id TEXT NOT NULL REFERENCES provider_configs(id) ON DELETE CASCADE,
    endpoint_key TEXT NOT NULL,
    model_id TEXT NOT NULL,
    settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
    revision INTEGER NOT NULL CHECK(revision >= 1),
    validation_json TEXT CHECK(validation_json IS NULL OR json_valid(validation_json)),
    PRIMARY KEY(provider_config_id, endpoint_key, model_id)
);
