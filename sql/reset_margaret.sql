-- Reset Margaret Chen (pid=20) to a new-patient state.
-- Clears all clinical history, keeps demographics + today's appointment,
-- and inserts a single pre-seeded intake form document (id=9901).
--
-- Run via scripts/demo_reset.sh — not meant to be run directly.

SET FOREIGN_KEY_CHECKS = 0;

-- ── Clear clinical history ────────────────────────────────────────────────────

DELETE FROM form_vitals    WHERE pid = 20;
DELETE FROM form_soap      WHERE pid = 20;
DELETE FROM forms          WHERE pid = 20;
DELETE FROM form_encounter WHERE pid = 20;

DELETE FROM prescriptions  WHERE patient_id = 20;

DELETE FROM lists          WHERE pid = 20 AND type IN ('allergy', 'medical_problem');

DELETE FROM procedure_result
  WHERE procedure_report_id IN (
    SELECT procedure_report_id FROM procedure_report
    WHERE procedure_order_id IN (
      SELECT procedure_order_id FROM procedure_order WHERE patient_id = 20
    )
  );

DELETE FROM procedure_report
  WHERE procedure_order_id IN (
    SELECT procedure_order_id FROM procedure_order WHERE patient_id = 20
  );

DELETE FROM procedure_order_code
  WHERE procedure_order_id IN (
    SELECT procedure_order_id FROM procedure_order WHERE patient_id = 20
  );

DELETE FROM procedure_order WHERE patient_id = 20;

-- ── Clear existing documents for pid=20 ──────────────────────────────────────

DELETE FROM categories_to_documents
  WHERE document_id IN (SELECT id FROM documents WHERE foreign_id = 20);

DELETE FROM documents WHERE foreign_id = 20;

-- ── Insert pre-seeded intake form document (id=9901) ─────────────────────────
-- The file path is a placeholder; the copilot reads the extraction cache,
-- not the actual file bytes, so the missing file is harmless for the demo.

INSERT INTO documents
    (id, type, size, date, url, mimetype, owner, foreign_id, storagemethod,
     path_depth, imported, audit_master_approval_status, name, deleted)
VALUES
    (9901, 'file_url', 312945, NOW(),
     'sites/default/documents/20/margaret-intake.pdf',
     'application/pdf', 10, 20, 0, 1, 0, 1,
     'margaret-intake.pdf', 0);

-- Link to "Medical Record" category (id=3)
INSERT INTO categories_to_documents (category_id, document_id) VALUES (3, 9901);

-- ── Ensure appointment still reads as a new-patient intake visit ──────────────
-- (The appointment itself was created in seed_margaret.sql and only the
--  pc_hometext note is updated here to reflect the clean-slate state.)

UPDATE openemr_postcalendar_events
   SET pc_hometext = 'First visit — intake form uploaded by front desk, no prior chart'
 WHERE pc_aid = 10 AND pc_pid = 20;

SET FOREIGN_KEY_CHECKS = 1;
