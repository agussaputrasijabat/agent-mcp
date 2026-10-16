ALTER TABLE settings ADD COLUMN shell_policy TEXT NOT NULL DEFAULT 'strict' CHECK (shell_policy IN ('risky', 'strict'));
