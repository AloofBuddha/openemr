CREATE TABLE IF NOT EXISTS `copilot_brief_cache` (
    `id`                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    `patient_id`          INT NOT NULL,
    `physician_id`        INT NOT NULL,
    `appointment_id`      INT NOT NULL DEFAULT 0,
    `appointment_date`    DATE NOT NULL,
    `brief_text`          TEXT NOT NULL,
    `follow_up_json`      JSON NOT NULL,
    `citation_registry`   JSON NOT NULL,
    `data_snapshot_hash`  VARCHAR(64) NOT NULL,
    `generated_at`        DATETIME NOT NULL,
    UNIQUE KEY `uq_patient_physician_date` (`patient_id`, `physician_id`, `appointment_date`),
    INDEX `idx_patient_physician_date` (`patient_id`, `physician_id`, `appointment_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `copilot_audit_log` (
    `id`             BIGINT AUTO_INCREMENT PRIMARY KEY,
    `session_id`     VARCHAR(64) NOT NULL,
    `physician_id`   INT NOT NULL,
    `patient_uuid`   VARCHAR(64),
    `query_text`     TEXT NOT NULL,
    `tools_called`   JSON NOT NULL,
    `llm_model`      VARCHAR(64) NOT NULL DEFAULT '',
    `input_tokens`   INT NOT NULL DEFAULT 0,
    `output_tokens`  INT NOT NULL DEFAULT 0,
    `total_ms`       INT NOT NULL DEFAULT 0,
    `verified`       TINYINT(1) NOT NULL DEFAULT 1,
    `flagged_claims` INT NOT NULL DEFAULT 0,
    `created_at`     DATETIME NOT NULL,
    INDEX `idx_physician_created` (`physician_id`, `created_at`),
    INDEX `idx_patient_created` (`patient_uuid`(36), `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
