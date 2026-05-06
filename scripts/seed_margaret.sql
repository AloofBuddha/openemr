-- Apply Margaret Chen (pid=20) and refresh Dr. Chen's appointment schedule.
-- Safe to run repeatedly — all inserts use ON DUPLICATE KEY UPDATE or DELETE+INSERT.

SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------------------------
-- Patient record
-- -------------------------------------------------------------------------
INSERT INTO patient_data (pid, uuid, fname, lname, DOB, sex, providerID,
    street, city, state, postal_code, phone_home, status, regdate)
VALUES
(20, UNHEX(REPLACE(UUID(),'-','')), 'Margaret', 'Chen', '1967-08-14', 'Female', 10,
    '4421 Magnolia Ave Apt 3B', 'Austin', 'TX', '78704', '510-555-0148', 'active', '2026-04-22')
ON DUPLICATE KEY UPDATE fname=VALUES(fname), lname=VALUES(lname), DOB=VALUES(DOB);

-- -------------------------------------------------------------------------
-- Encounters
-- -------------------------------------------------------------------------
INSERT INTO form_encounter (id, date, reason, pid, encounter, provider_id, facility_id, pc_catid)
VALUES
(150, '2024-06-10 09:00:00', 'New patient — transfer of care, chronic disease review', 20, 150, 10, 3, 5),
(151, '2024-12-04 09:30:00', 'Diabetes + HTN 6-month follow-up',                       20, 151, 10, 3, 5),
(152, '2025-06-18 09:00:00', 'Diabetes poorly controlled — A1C worsening',             20, 152, 10, 3, 5),
(153, '2025-12-10 09:30:00', 'Annual review — lipids + glycemic management',            20, 153, 10, 3, 5)
ON DUPLICATE KEY UPDATE reason=VALUES(reason);

-- -------------------------------------------------------------------------
-- SOAP notes (linked via forms table so PatientBriefTool can find them)
-- -------------------------------------------------------------------------
INSERT INTO form_soap (id, date, pid, user, groupname, authorized, activity, subjective, objective, assessment, plan)
VALUES
(1150, '2024-06-10 09:00:00', 20, 'sarah.chen', 'Default', 1, 1,
 'New patient transferring from Berkeley. T2DM x6 years, HTN x8 years, hyperlipidemia x4 years. On Metformin, Lisinopril, Atorvastatin, baby aspirin. Reports diet compliance is "okay." No hypoglycemic episodes. Mild fatigue.',
 'BP 138/86, HR 74, Weight 172 lbs, BMI 28.4. Well-appearing. No edema. Lungs clear. A1C 7.1% (Berkeley, May 2024).',
 'T2DM — near goal. HTN — borderline controlled. Hyperlipidemia — on statin. Cardio prevention per family Hx.',
 'Continue current medications. Recheck A1C and lipids in 6 months. Counseled on DASH diet and exercise. Annual foot exam completed.'),

(1151, '2024-12-04 09:30:00', 20, 'sarah.chen', 'Default', 1, 1,
 'Fatigue improving. Occasional mild headaches. Denies chest pain or palpitations. Diet compliance variable — holiday season. Exercise: walking 3x/week.',
 'BP 142/88, HR 76, Weight 174 lbs. A1C 7.4% (up from 7.1%). LDL 148 mg/dL, HDL 46 mg/dL, TG 162 mg/dL.',
 'T2DM — A1C trending up. HTN — not at goal. Hyperlipidemia — LDL above goal for DM patient, HDL low.',
 'Increase Atorvastatin to 20mg (was 10mg). Reinforce dietary sodium restriction. Consider uptitrating Metformin if A1C continues to rise. Recheck in 6 months.'),

(1152, '2025-06-18 09:00:00', 20, 'sarah.chen', 'Default', 1, 1,
 'Reports increased fatigue and mild nocturia x2 months. Diet compliance poor — work stress. Walking less. Denies chest pain. Worried about diabetes complications — mother started insulin this year.',
 'BP 146/90, HR 80, Weight 178 lbs (up 4 lbs). A1C 8.0%. Fasting glucose 188. Feet: normal sensation bilaterally.',
 'T2DM — poorly controlled, A1C rising despite dual-agent therapy. HTN — above goal. Hyperlipidemia — insufficient lipid data this visit.',
 'Increase Metformin to 1000mg BID (from 500mg BID). Intensify lifestyle counseling. Refer to diabetes educator. Recheck A1C + full lipid panel in 6 months. Consider adding GLP-1 agonist if no improvement.'),

(1153, '2025-12-10 09:30:00', 20, 'sarah.chen', 'Default', 1, 1,
 'A1C improved somewhat. Reports trying harder with diet. Still fatigued. No chest pain at rest. Slight chest tightness walking uphill — denies at time of visit. Father had MI at 61; she is now 58.',
 'BP 144/88, HR 78, Weight 176 lbs. A1C 7.6% (down from 8.0%). LDL 162 mg/dL (H), HDL 47 mg/dL (L), TG 171 mg/dL (H). Non-HDL-C 172 mg/dL.',
 'T2DM — improving but not at goal. HTN — persistent. Hyperlipidemia — LDL above target for high-risk DM patient. Exertional symptoms warrant evaluation.',
 'Order stress EKG given exertional symptoms and family Hx. Reorder lipid panel in spring. Discuss statin intensification pending lipid results. Cardiology referral if stress test abnormal. Follow up 4-6 months.')
ON DUPLICATE KEY UPDATE subjective=VALUES(subjective), objective=VALUES(objective),
    assessment=VALUES(assessment), plan=VALUES(plan);

-- Link form_soap records to their encounters via the forms table
INSERT INTO forms (id, date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir)
VALUES
(1150, '2024-06-10 09:00:00', 150, 'SOAP', 1150, 20, 'sarah.chen', 'Default', 1, 0, 'soap'),
(1151, '2024-12-04 09:30:00', 151, 'SOAP', 1151, 20, 'sarah.chen', 'Default', 1, 0, 'soap'),
(1152, '2025-06-18 09:00:00', 152, 'SOAP', 1152, 20, 'sarah.chen', 'Default', 1, 0, 'soap'),
(1153, '2025-12-10 09:30:00', 153, 'SOAP', 1153, 20, 'sarah.chen', 'Default', 1, 0, 'soap')
ON DUPLICATE KEY UPDATE form_id=VALUES(form_id);

-- -------------------------------------------------------------------------
-- Vitals (BP, weight, pulse — consistent with SOAP objective notes)
-- Height: 64 in (5'4"). BP trends show progressive control on Lisinopril.
-- -------------------------------------------------------------------------
INSERT INTO form_vitals (id, pid, date, user, authorized, activity, bps, bpd, height, weight, pulse, temperature, BMI, oxygen_saturation)
VALUES
(400, 20, '2024-06-10 09:00:00', 'sarah.chen', 1, 1, '138', '86', 64.000000, 172.000000, 74.000000, 98.600000, 29.520000, 98.00),
(401, 20, '2024-12-04 09:30:00', 'sarah.chen', 1, 1, '142', '88', 64.000000, 174.000000, 76.000000, 98.400000, 29.860000, 98.00),
(402, 20, '2025-06-18 09:00:00', 'sarah.chen', 1, 1, '146', '90', 64.000000, 178.000000, 80.000000, 98.600000, 30.540000, 97.00),
(403, 20, '2025-12-10 09:30:00', 'sarah.chen', 1, 1, '144', '88', 64.000000, 176.000000, 78.000000, 98.400000, 30.200000, 98.00)
ON DUPLICATE KEY UPDATE bps=VALUES(bps), bpd=VALUES(bpd), weight=VALUES(weight);

-- Link vitals to encounters via forms table
INSERT INTO forms (id, date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir)
VALUES
(1160, '2024-06-10 09:00:00', 150, 'Vitals', 400, 20, 'sarah.chen', 'Default', 1, 0, 'vitals'),
(1161, '2024-12-04 09:30:00', 151, 'Vitals', 401, 20, 'sarah.chen', 'Default', 1, 0, 'vitals'),
(1162, '2025-06-18 09:00:00', 152, 'Vitals', 402, 20, 'sarah.chen', 'Default', 1, 0, 'vitals'),
(1163, '2025-12-10 09:30:00', 153, 'Vitals', 403, 20, 'sarah.chen', 'Default', 1, 0, 'vitals')
ON DUPLICATE KEY UPDATE form_id=VALUES(form_id);

-- -------------------------------------------------------------------------
-- Medications (insert only if none exist for pid=20 to stay idempotent)
-- -------------------------------------------------------------------------
INSERT INTO prescriptions (patient_id, provider_id, encounter, drug, drug_id,
    rxnorm_drugcode, dosage, quantity, start_date, end_date, refills, active, note,
    txDate, usage_category_title, request_intent_title, uuid)
SELECT 20, 10, 150, 'Lisinopril',   0, '29046',  '10mg QD',        30, '2024-06-10', NULL, 11, 1, 'HTN',                   '2024-06-10', '', '', UNHEX(REPLACE(UUID(),'-',''))
WHERE NOT EXISTS (SELECT 1 FROM prescriptions WHERE patient_id=20 AND drug='Lisinopril');
INSERT INTO prescriptions (patient_id, provider_id, encounter, drug, drug_id,
    rxnorm_drugcode, dosage, quantity, start_date, end_date, refills, active, note,
    txDate, usage_category_title, request_intent_title, uuid)
SELECT 20, 10, 152, 'Metformin',    0, '6809',   '1000mg BID',      60, '2025-06-18', NULL, 11, 1, 'T2DM - increased dose', '2025-06-18', '', '', UNHEX(REPLACE(UUID(),'-',''))
WHERE NOT EXISTS (SELECT 1 FROM prescriptions WHERE patient_id=20 AND drug='Metformin');
INSERT INTO prescriptions (patient_id, provider_id, encounter, drug, drug_id,
    rxnorm_drugcode, dosage, quantity, start_date, end_date, refills, active, note,
    txDate, usage_category_title, request_intent_title, uuid)
SELECT 20, 10, 151, 'Atorvastatin', 0, '83367',  '20mg at bedtime', 30, '2024-12-04', NULL, 11, 1, 'Hyperlipidemia',        '2024-12-04', '', '', UNHEX(REPLACE(UUID(),'-',''))
WHERE NOT EXISTS (SELECT 1 FROM prescriptions WHERE patient_id=20 AND drug='Atorvastatin');
INSERT INTO prescriptions (patient_id, provider_id, encounter, drug, drug_id,
    rxnorm_drugcode, dosage, quantity, start_date, end_date, refills, active, note,
    txDate, usage_category_title, request_intent_title, uuid)
SELECT 20, 10, 150, 'Aspirin',      0, '243670', '81mg QD',         30, '2024-06-10', NULL, 11, 1, 'Cardio prevention',     '2024-06-10', '', '', UNHEX(REPLACE(UUID(),'-',''))
WHERE NOT EXISTS (SELECT 1 FROM prescriptions WHERE patient_id=20 AND drug='Aspirin');

-- -------------------------------------------------------------------------
-- Allergies (idempotent — delete existing before reinserting)
-- -------------------------------------------------------------------------
DELETE FROM lists WHERE pid=20 AND type='allergy';
INSERT INTO lists (pid, type, title, begdate, enddate, returndate, occurrence, classification,
    referredby, extrainfo, diagnosis, activity, comments, outcome, groupname, user, date)
VALUES
(20, 'allergy', 'Penicillin',        '1999-01-01', NULL, NULL, 0, NULL, NULL, 'Hives (wheal)',    'SNOMED:91936005',  1, 'Moderate severity', 0, 'Default', 'sarah.chen', NOW()),
(20, 'allergy', 'Sulfa drugs',       '2010-01-01', NULL, NULL, 0, NULL, NULL, 'Rash',             'SNOMED:763875007', 1, 'Mild severity',     0, 'Default', 'sarah.chen', NOW()),
(20, 'allergy', 'Shellfish/iodine?', NULL,         NULL, NULL, 0, NULL, NULL, 'Itchy? Uncertain', NULL,               1, 'Unclear — verify',  0, 'Default', 'sarah.chen', NOW());

-- -------------------------------------------------------------------------
-- Problem list (idempotent — delete existing before reinserting)
-- -------------------------------------------------------------------------
DELETE FROM lists WHERE pid=20 AND type='medical_problem';
INSERT INTO lists (pid, type, title, begdate, enddate, returndate, occurrence, classification,
    referredby, extrainfo, diagnosis, activity, comments, outcome, groupname, user, date)
VALUES
(20, 'medical_problem', 'Type 2 diabetes mellitus', '2018-01-01', NULL, NULL, 0, NULL, NULL, NULL, 'ICD10:E11.9', 1, NULL, 0, 'Default', 'sarah.chen', NOW()),
(20, 'medical_problem', 'Essential hypertension',   '2016-01-01', NULL, NULL, 0, NULL, NULL, NULL, 'ICD10:I10',   1, NULL, 0, 'Default', 'sarah.chen', NOW()),
(20, 'medical_problem', 'Hyperlipidemia',           '2020-01-01', NULL, NULL, 0, NULL, NULL, NULL, 'ICD10:E78.5', 1, NULL, 0, 'Default', 'sarah.chen', NOW());

-- -------------------------------------------------------------------------
-- Lab orders, reports, results
-- -------------------------------------------------------------------------
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(300, 10, 20, 150, '2024-06-10', 'complete', 1),
(301, 10, 20, 151, '2024-12-04', 'complete', 1),
(302, 10, 20, 152, '2025-06-18', 'complete', 1),
(303, 10, 20, 153, '2025-12-10', 'complete', 1)
ON DUPLICATE KEY UPDATE order_status=VALUES(order_status);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(300, 300, '2024-06-12', 'final'),
(301, 301, '2024-12-06', 'final'),
(302, 302, '2025-06-20', 'final'),
(303, 303, '2025-12-12', 'final')
ON DUPLICATE KEY UPDATE report_status=VALUES(report_status);

-- procedure_report has a date_collected column (used by PatientBriefTool)
UPDATE procedure_report SET date_collected='2024-06-10' WHERE procedure_report_id=300;
UPDATE procedure_report SET date_collected='2024-12-04' WHERE procedure_report_id=301;
UPDATE procedure_report SET date_collected='2025-06-18' WHERE procedure_report_id=302;
UPDATE procedure_report SET date_collected='2025-12-10' WHERE procedure_report_id=303;

-- procedure_order_code: required for labdata_fragment.php JOIN to display labs in patient summary
INSERT INTO procedure_order_code (procedure_order_id, procedure_order_seq, procedure_code, procedure_name, procedure_source)
VALUES
(300, 1, 'DIAB-PANEL',  'Diabetes Monitoring Panel (A1c, Fasting Glucose)', '1'),
(301, 1, 'LIPID-A1C',   'Lipid Panel with HbA1c (Comprehensive)',           '1'),
(302, 1, 'DIAB-PANEL',  'Diabetes Monitoring Panel (A1c, Fasting Glucose)', '1'),
(303, 1, 'CMP-LIPID',   'Comprehensive Metabolic & Lipid Panel',             '1')
ON DUPLICATE KEY UPDATE procedure_name=VALUES(procedure_name);

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(300, '4548-4',  'Hemoglobin A1c',    '7.1', '%',     '4.0-5.6', 'H', 'final', '2024-06-12'),
(300, '14771-0', 'Fasting glucose',   '142', 'mg/dL', '70-99',   'H', 'final', '2024-06-12'),
(301, '4548-4',  'Hemoglobin A1c',    '7.4', '%',     '4.0-5.6', 'H', 'final', '2024-12-06'),
(301, '2093-3',  'Cholesterol Total', '218', 'mg/dL', '<200',    'H', 'final', '2024-12-06'),
(301, '2085-9',  'HDL Cholesterol',   '46',  'mg/dL', '>50',     'L', 'final', '2024-12-06'),
(301, '13457-7', 'LDL Cholesterol',   '148', 'mg/dL', '<100',    'H', 'final', '2024-12-06'),
(301, '2571-8',  'Triglycerides',     '162', 'mg/dL', '<150',    'H', 'final', '2024-12-06'),
(302, '4548-4',  'Hemoglobin A1c',    '8.0', '%',     '4.0-5.6', 'H', 'final', '2025-06-20'),
(302, '14771-0', 'Fasting glucose',   '188', 'mg/dL', '70-99',   'H', 'final', '2025-06-20'),
(303, '4548-4',  'Hemoglobin A1c',    '7.6', '%',     '4.0-5.6', 'H', 'final', '2025-12-12'),
(303, '2093-3',  'Cholesterol Total', '228', 'mg/dL', '<200',    'H', 'final', '2025-12-12'),
(303, '2085-9',  'HDL Cholesterol',   '47',  'mg/dL', '>50',     'L', 'final', '2025-12-12'),
(303, '13457-7', 'LDL Cholesterol',   '162', 'mg/dL', '<100',    'H', 'final', '2025-12-12'),
(303, '2571-8',  'Triglycerides',     '171', 'mg/dL', '<150',    'H', 'final', '2025-12-12'),
(303, '2160-0',  'Creatinine',        '0.9', 'mg/dL', '0.5-1.1', 'N', 'final', '2025-12-12'),
(303, '2823-3',  'Potassium',         '4.0', 'mEq/L', '3.5-5.1', 'N', 'final', '2025-12-12');

-- -------------------------------------------------------------------------
-- Appointments: replace Dr. Chen's entire schedule
-- -------------------------------------------------------------------------
DELETE FROM openemr_postcalendar_events WHERE pc_aid = 10;

INSERT INTO openemr_postcalendar_events
    (pc_catid, pc_aid, pc_pid, pc_title, pc_time, pc_hometext,
     pc_eventDate, pc_startTime, pc_endTime, pc_duration, pc_alldayevent,
     pc_apptstatus, pc_prefcatid, pc_multiple, pc_sharing, pc_facility, pc_eventstatus)
VALUES
(5, '10', '20', 'Established patient follow-up — chest tightness, lipid review', CONCAT(CURDATE(),' 08:55:00'), 'Chest tightness on exertion x3 weeks; intake form uploaded by front desk', CURDATE(), '08:55:00', '09:15:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '4',  'Diabetes follow-up',       CONCAT(CURDATE(),' 09:20:00'), 'A1C recheck post-Jardiance addition',              CURDATE(), '09:20:00', '09:40:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '7',  'Quarterly chronic review', CONCAT(CURDATE(),' 09:45:00'), 'BP elevated at last visit; BMP + INR',             CURDATE(), '09:45:00', '10:05:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '1',  'Hypertension follow-up',   CONCAT(CURDATE(),' 10:10:00'), 'BP recheck 6 wks post Lisinopril uptitration',     CURDATE(), '10:10:00', '10:30:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '11', 'Migraine management',      CONCAT(CURDATE(),' 10:35:00'), 'Propranolol efficacy check',                       CURDATE(), '10:35:00', '10:55:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '6',  'Asthma medication check',  CONCAT(CURDATE(),' 11:00:00'), 'Follow-up after fluticasone addition',             CURDATE(), '11:00:00', '11:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(9, '10', '2',  'Annual wellness exam',     CONCAT(CURDATE(),' 11:30:00'), 'Overdue mammogram referral follow-up',             CURDATE(), '11:30:00', '12:00:00', 1800, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '3',  'Medication check',         CONCAT(CURDATE(),' 13:00:00'), 'Sertraline - has not been seen in 14 months',      CURDATE(), '13:00:00', '13:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '5',  'Hypertension follow-up',   CONCAT(CURDATE(),' 13:30:00'), 'BP + lipid review',                               CURDATE(), '13:30:00', '13:50:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '12', 'CAD quarterly review',     CONCAT(CURDATE(),' 14:00:00'), 'Annual review; stress test result',               CURDATE(), '14:00:00', '14:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '8',  'Pre-diabetes check-in',    CONCAT(CURDATE(),' 14:30:00'), 'Weight and glucose recheck',                      CURDATE(), '14:30:00', '14:50:00', 1200, 0, '@', 0, 0, 1, 3, 1);

SET FOREIGN_KEY_CHECKS = 1;
