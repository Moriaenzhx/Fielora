ALTER TABLE provider_configs ADD COLUMN model_optimization INTEGER NOT NULL DEFAULT 1 CHECK(model_optimization IN (0,1));
