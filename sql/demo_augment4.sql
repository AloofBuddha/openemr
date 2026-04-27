-- demo_augment4.sql
-- Fixes three UC-specific data gaps discovered during use-case validation:
--   1. Wanda Moore (PID 3): missing sertraline prescription referenced in UC-3
--   2. Wanda Moore (PID 3): missing OB/GYN referral referenced in UC-3
--   3. Susan Underwood (PID 2): missing mammogram referral referenced in UC-5
--   4. Susan Underwood (PID 2): deactivate junk Lisinopril row (id=11, dosage='1') from legacy seed

-- ─── 1. Wanda Moore — sertraline 50mg (UC-3) ───────────────────────────────
INSERT INTO prescriptions
    (id, patient_id, provider_id, encounter, drug, dosage, route, note, active, start_date, date_added,
     txDate, usage_category_title, request_intent_title)
VALUES
    (70, 3, 10, 107, 'Sertraline', '50mg QD', NULL, 'Generalized anxiety disorder', 1, '2025-02-03', '2025-02-03 10:00:00',
     '2025-02-03', '', '');

-- ─── 2. Wanda Moore — OB/GYN referral (UC-3) ────────────────────────────────
-- Placed at the Feb 2025 encounter; no return visit recorded (activity=1, enddate=NULL)
INSERT INTO lists
    (id, pid, type, title, begdate, enddate, diagnosis, comments, activity, destination, user, modifydate)
VALUES
    (69, 3, 'referral', 'OB/GYN Referral', '2025-02-03', NULL, 'N91.2', 'Referred for evaluation of irregular menstrual cycle; no follow-up encounter recorded', 1, 'OB/GYN', 'sarah.chen', NOW());

-- ─── 3. Susan Underwood — mammogram referral (UC-5) ─────────────────────────
-- ~14 months before today (2026-04-27); no return visit recorded
INSERT INTO lists
    (id, pid, type, title, begdate, enddate, diagnosis, comments, activity, destination, user, modifydate)
VALUES
    (70, 2, 'referral', 'Mammography Screening Referral', '2025-02-28', NULL, 'Z12.31', 'Annual mammography screening for 40+ female; no follow-up recorded', 1, 'Radiology/Breast Imaging', 'sarah.chen', NOW());

-- ─── 4. Susan Underwood — deactivate junk Lisinopril seed row (id=11) ───────
UPDATE prescriptions SET active = 0 WHERE id = 11 AND patient_id = 2 AND dosage = '1';
