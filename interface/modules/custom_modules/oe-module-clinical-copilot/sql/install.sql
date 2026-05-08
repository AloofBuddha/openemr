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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Provenance back-links: every chart row written by intake-process.php gets
-- one row here pointing at the source document + the bbox of the verbatim
-- text the extractor pulled from that page. Powers the "yellow box on the
-- intake PDF" UX for [[PN]] citations referring to chart facts.
CREATE TABLE IF NOT EXISTS `copilot_source_links` (
    `id`             BIGINT AUTO_INCREMENT PRIMARY KEY,
    `patient_id`     INT NOT NULL,
    `record_type`    VARCHAR(32) NOT NULL,    -- 'medication' | 'allergy' | 'medical_problem' | 'surgery' | 'vital' | 'social' | 'family'
    `record_id`      INT NOT NULL,            -- prescriptions.id, lists.id, form_vitals.id, history_data.id
    `source_doc_id`  INT NOT NULL,            -- documents.id of the originating intake/lab PDF
    `page_num`       INT NOT NULL DEFAULT 1,
    `x0`             FLOAT DEFAULT NULL,
    `y0`             FLOAT DEFAULT NULL,
    `x1`             FLOAT DEFAULT NULL,
    `y1`             FLOAT DEFAULT NULL,
    `page_width`     FLOAT DEFAULT NULL,
    `page_height`    FLOAT DEFAULT NULL,
    `quote`          TEXT,                    -- verbatim text from the source, for staleness checks
    `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_record` (`record_type`, `record_id`),
    INDEX `idx_patient` (`patient_id`),
    INDEX `idx_source_doc` (`source_doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
