-- =============================================================================
-- Clinical Co-Pilot Demo Augmentation #2
-- =============================================================================
-- Run AFTER demo_seed.sql and demo_augment.sql. Adds:
--   - Lab results for 7 of Dr. Chen's patients that previously had 0 labs
--     (referenced in their SOAP notes but missing from procedure tables)
--   - Dr. Rivera's patient panel: problems, prescriptions, encounters,
--     vitals, SOAP notes, labs, and today's appointment schedule
--   - UI configuration: calendar shows appointment titles, patient summary
--     cards pre-expanded, Message Center removed from default tabs
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- =============================================================================
-- UI CONFIGURATION
-- =============================================================================

-- Show "Lastname, Firstname (Appointment Title)" in calendar cells (was style 2 = name only)
UPDATE globals SET gl_value = '3' WHERE gl_name = 'calendar_appt_style';

-- Remove Message Center from default tabs (it throws a SQL error in this setup)
UPDATE list_options SET activity = 0 WHERE list_id = 'default_open_tabs' AND option_id = 'msg';

-- Pre-expand all clinically useful cards on the patient summary page for both providers.
-- Without these entries, getUserSetting() returns NULL which PHP evaluates as == 0 (collapsed).
INSERT INTO user_settings (setting_user, setting_label, setting_value) VALUES
(10, 'medical_problem_ps_expand',       '1'),
(10, 'allergy_ps_expand',               '1'),
(10, 'current_prescriptions_ps_expand', '1'),
(10, 'prescriptions_ps_expand',         '1'),
(10, 'labdata_ps_expand',               '1'),
(10, 'vitals_ps_expand',                '1'),
(10, 'appointments_ps_expand',          '1'),
(11, 'demographics_ps_expand',          '1'),
(11, 'medical_problem_ps_expand',       '1'),
(11, 'allergy_ps_expand',               '1'),
(11, 'current_prescriptions_ps_expand', '1'),
(11, 'prescriptions_ps_expand',         '1'),
(11, 'labdata_ps_expand',               '1'),
(11, 'vitals_ps_expand',                '1'),
(11, 'appointments_ps_expand',          '1')
ON DUPLICATE KEY UPDATE setting_value = '1';

-- =============================================================================
-- MISSING LABS — DR. CHEN'S PATIENTS
-- =============================================================================

-- -----------------------------------------------------------------------
-- Michael Thompson (pid=12): A1C trend + LDL + creatinine
-- Encounters 131 (2024-10-08), 132 (2025-01-14), 133 (2025-04-22), 134 (2025-10-07)
-- -----------------------------------------------------------------------
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(218, 10, 12, 131, '2024-10-08', 'complete', 1),
(219, 10, 12, 132, '2025-01-14', 'complete', 1),
(220, 10, 12, 133, '2025-04-22', 'complete', 1),
(221, 10, 12, 134, '2025-10-07', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(218, 218, '2024-10-10', 'final'),
(219, 219, '2025-01-16', 'final'),
(220, 220, '2025-04-24', 'final'),
(221, 221, '2025-10-09', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(218, '4548-4', 'Hemoglobin A1c',  '7.5', '%',    '4.0-5.6', 'H', 'final', '2024-10-10'),
(218, '2089-1', 'LDL Cholesterol', '88',  'mg/dL', '<100',   'N', 'final', '2024-10-10'),
(218, '2160-0', 'Creatinine',      '1.2', 'mg/dL', '0.7-1.3','N', 'final', '2024-10-10'),
(219, '4548-4', 'Hemoglobin A1c',  '7.3', '%',    '4.0-5.6', 'H', 'final', '2025-01-16'),
(220, '2089-1', 'LDL Cholesterol', '82',  'mg/dL', '<100',   'N', 'final', '2025-04-24'),
(221, '4548-4', 'Hemoglobin A1c',  '7.2', '%',    '4.0-5.6', 'H', 'final', '2025-10-09'),
(221, '2160-0', 'Creatinine',      '1.2', 'mg/dL', '0.7-1.3','N', 'final', '2025-10-09');

-- -----------------------------------------------------------------------
-- Aisha Williams (pid=13): CBC + CMP per rheumatology protocol
-- Encounters 135 (2025-01-09), 136 (2025-07-17)
-- -----------------------------------------------------------------------
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(222, 10, 13, 135, '2025-01-09', 'complete', 1),
(223, 10, 13, 136, '2025-07-17', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(222, 222, '2025-01-11', 'final'),
(223, 223, '2025-07-19', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(222, '6690-2', 'WBC',        '5.2', 'K/uL',  '4.0-11.0', 'N', 'final', '2025-01-11'),
(222, '718-7',  'Hemoglobin', '12.1','g/dL',  '12.0-16.0','N', 'final', '2025-01-11'),
(222, '2160-0', 'Creatinine', '0.9', 'mg/dL', '0.5-1.1',  'N', 'final', '2025-01-11'),
(223, '6690-2', 'WBC',        '5.8', 'K/uL',  '4.0-11.0', 'N', 'final', '2025-07-19'),
(223, '718-7',  'Hemoglobin', '12.4','g/dL',  '12.0-16.0','N', 'final', '2025-07-19'),
(223, '2160-0', 'Creatinine', '0.9', 'mg/dL', '0.5-1.1',  'N', 'final', '2025-07-19');

-- -----------------------------------------------------------------------
-- Robert Chen (pid=10): FEV1% spirometry (COPD progression)
-- Encounters 126 (2024-11-12), 127 (2025-05-08), 128 (2025-12-03)
-- -----------------------------------------------------------------------
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(224, 10, 10, 126, '2024-11-12', 'complete', 1),
(225, 10, 10, 127, '2025-05-08', 'complete', 1),
(226, 10, 10, 128, '2025-12-03', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(224, 224, '2024-11-14', 'final'),
(225, 225, '2025-05-10', 'final'),
(226, 226, '2025-12-05', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(224, '20150-9', 'FEV1 % Predicted', '62', '%', '80-100', 'L', 'final', '2024-11-14'),
(225, '20150-9', 'FEV1 % Predicted', '60', '%', '80-100', 'L', 'final', '2025-05-10'),
(226, '20150-9', 'FEV1 % Predicted', '58', '%', '80-100', 'L', 'final', '2025-12-05');

-- -----------------------------------------------------------------------
-- Elena Rodriguez (pid=5): LDL trend on atorvastatin
-- Encounters 112 (2024-09-18), 113 (2025-03-05), 114 (2025-09-11)
-- -----------------------------------------------------------------------
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(227, 10, 5, 112, '2024-09-18', 'complete', 1),
(228, 10, 5, 113, '2025-03-05', 'complete', 1),
(229, 10, 5, 114, '2025-09-11', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(227, 227, '2024-09-20', 'final'),
(228, 228, '2025-03-07', 'final'),
(229, 229, '2025-09-13', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(227, '2089-1', 'LDL Cholesterol', '158', 'mg/dL', '<100', 'H', 'final', '2024-09-20'),
(228, '2089-1', 'LDL Cholesterol', '132', 'mg/dL', '<100', 'H', 'final', '2025-03-07'),
(229, '2089-1', 'LDL Cholesterol', '118', 'mg/dL', '<100', 'H', 'final', '2025-09-13');

-- -----------------------------------------------------------------------
-- James Park (pid=6): Spirometry (asthma — worsening trend)
-- Encounters 115 (2025-02-20), 116 (2025-08-07), 117 (2026-02-14)
-- -----------------------------------------------------------------------
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(230, 10, 6, 115, '2025-02-20', 'complete', 1),
(231, 10, 6, 116, '2025-08-07', 'complete', 1),
(232, 10, 6, 117, '2026-02-14', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(230, 230, '2025-02-22', 'final'),
(231, 231, '2025-08-09', 'final'),
(232, 232, '2026-02-16', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(230, '20150-9', 'FEV1 % Predicted', '82', '%', '80-100', 'N', 'final', '2025-02-22'),
(231, '20150-9', 'FEV1 % Predicted', '78', '%', '80-100', 'L', 'final', '2025-08-09'),
(232, '20150-9', 'FEV1 % Predicted', '74', '%', '80-100', 'L', 'final', '2026-02-16');

-- -----------------------------------------------------------------------
-- Sarah Torres (pid=9): PHQ-9 + TSH (postpartum depression)
-- Encounters 124 (2024-10-14), 125 (2025-02-18)
-- -----------------------------------------------------------------------
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(233, 10, 9, 124, '2024-10-14', 'complete', 1),
(234, 10, 9, 125, '2025-02-18', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(233, 233, '2024-10-14', 'final'),
(234, 234, '2025-02-18', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(233, '44261-6', 'PHQ-9 Total Score', '14', 'score', '0-27', 'H', 'final', '2024-10-14'),
(233, '3016-3',  'TSH',               '2.1','mIU/L', '0.4-4.0','N','final','2024-10-14'),
(234, '44261-6', 'PHQ-9 Total Score', '6',  'score', '0-27', 'H', 'final', '2025-02-18');

-- -----------------------------------------------------------------------
-- Wanda Moore (pid=3): TSH (rule out thyroid cause of anxiety)
-- Encounters 106 (2024-08-12), 107 (2025-02-03)
-- -----------------------------------------------------------------------
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(235, 10, 3, 106, '2024-08-12', 'complete', 1),
(236, 10, 3, 107, '2025-02-03', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(235, 235, '2024-08-14', 'final'),
(236, 236, '2025-02-05', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(235, '3016-3', 'TSH', '2.4', 'mIU/L', '0.4-4.0', 'N', 'final', '2024-08-14'),
(236, '3016-3', 'TSH', '2.6', 'mIU/L', '0.4-4.0', 'N', 'final', '2025-02-05');

-- =============================================================================
-- DR. RIVERA'S PATIENT PANEL
-- Patients: Carlos Mendez (14), Anna Kowalski (15), Thomas Brown (16),
--           Lisa Chang (17), Kevin O'Brien (18)
-- =============================================================================

-- -----------------------------------------------------------------------
-- PROBLEMS (auto-increment IDs)
-- -----------------------------------------------------------------------
INSERT INTO lists (pid, type, title, begdate, enddate, activity, diagnosis, verification)
VALUES
-- Carlos Mendez (pid=14)
(14, 'medical_problem', 'Essential hypertension', '2024-08-01', NULL, 1, 'I10',   'confirmed'),
(14, 'medical_problem', 'Hyperlipidemia',         '2024-08-01', NULL, 1, 'E78.5', 'confirmed'),
(14, 'allergy',         'NKDA',                   '2024-08-01', NULL, 1, '',      'confirmed'),

-- Anna Kowalski (pid=15)
(15, 'medical_problem', 'Hypothyroidism',          '2024-04-01', NULL, 1, 'E03.9', 'confirmed'),
(15, 'medical_problem', 'Major depressive disorder','2024-04-01',NULL, 1, 'F32.9', 'confirmed'),
(15, 'allergy',         'NKDA',                    '2024-04-01', NULL, 1, '',      'confirmed'),

-- Thomas Brown (pid=16)
(16, 'medical_problem', 'Type 2 diabetes mellitus', '2020-11-01', NULL, 1, 'E11.9',  'confirmed'),
(16, 'medical_problem', 'Essential hypertension',   '2020-11-01', NULL, 1, 'I10',    'confirmed'),
(16, 'medical_problem', 'COPD, moderate',            '2020-11-01', NULL, 1, 'J44.1',  'confirmed'),
(16, 'medical_problem', 'Former tobacco user',       '2020-11-01', NULL, 1, 'Z87.891','confirmed'),
(16, 'allergy',         'Aspirin',                   '2020-11-01', NULL, 1, '',       'confirmed'),

-- Lisa Chang (pid=17)
(17, 'medical_problem', 'Migraine without aura',        '2024-12-01', NULL, 1, 'G43.009','confirmed'),
(17, 'medical_problem', 'Generalized anxiety disorder', '2024-12-01', NULL, 1, 'F41.1',  'confirmed'),
(17, 'allergy',         'NKDA',                         '2024-12-01', NULL, 1, '',        'confirmed'),

-- Kevin O'Brien (pid=18)
(18, 'medical_problem', 'Heart failure with reduced EF',   '2021-09-01', NULL, 1, 'I50.20','confirmed'),
(18, 'medical_problem', 'Atrial fibrillation',             '2021-09-01', NULL, 1, 'I48.91','confirmed'),
(18, 'medical_problem', 'Chronic kidney disease stage 3',  '2021-09-01', NULL, 1, 'N18.3', 'confirmed'),
(18, 'medical_problem', 'Essential hypertension',          '2021-09-01', NULL, 1, 'I10',   'confirmed'),
(18, 'allergy',         'NKDA',                            '2021-09-01', NULL, 1, '',      'confirmed');

-- -----------------------------------------------------------------------
-- PRESCRIPTIONS (IDs 57-69)
-- -----------------------------------------------------------------------
INSERT INTO prescriptions (id, patient_id, provider_id, encounter, drug, drug_id,
    rxnorm_drugcode, dosage, quantity, start_date, end_date, refills, active, note,
    txDate, usage_category_title, request_intent_title, uuid)
VALUES
-- Carlos Mendez (pid=14)
(57, 14, 11, 138, 'Lisinopril',    0, '29046',   '10mg QD',  30, '2024-08-15', NULL, 11, 1, 'HTN',           '2024-08-15','','',UNHEX(REPLACE(UUID(),'-',''))),
(58, 14, 11, 138, 'Atorvastatin',  0, '83367',   '20mg QD',  30, '2024-08-15', NULL, 11, 1, 'Hyperlipidemia','2024-08-15','','',UNHEX(REPLACE(UUID(),'-',''))),

-- Anna Kowalski (pid=15)
(59, 15, 11, 140, 'Levothyroxine', 0, '10582',   '75mcg QD', 30, '2024-04-10', NULL, 11, 1, 'Hypothyroidism','2024-04-10','','',UNHEX(REPLACE(UUID(),'-',''))),
(60, 15, 11, 140, 'Escitalopram',  0, '596926',  '10mg QD',  30, '2024-04-10', NULL, 11, 1, 'Depression',    '2024-04-10','','',UNHEX(REPLACE(UUID(),'-',''))),

-- Thomas Brown (pid=16)
(61, 16, 11, 142, 'Metformin',          0, '6809',    '1000mg BID', 60, '2020-11-17', NULL, 11, 1, 'T2DM',    '2020-11-17','','',UNHEX(REPLACE(UUID(),'-',''))),
(62, 16, 11, 142, 'Lisinopril',         0, '29046',   '20mg QD',    30, '2020-11-17', NULL, 11, 1, 'HTN',     '2020-11-17','','',UNHEX(REPLACE(UUID(),'-',''))),
(63, 16, 11, 142, 'Tiotropium inhaler', 0, '274783',  '18mcg QD',    1, '2020-11-17', NULL,  3, 1, 'COPD',    '2020-11-17','','',UNHEX(REPLACE(UUID(),'-',''))),

-- Lisa Chang (pid=17)
(64, 17, 11, 144, 'Topiramate', 0, '38404',  '50mg BID', 60, '2024-12-05', NULL,  5, 1, 'Migraine prophylaxis','2024-12-05','','',UNHEX(REPLACE(UUID(),'-',''))),
(65, 17, 11, 144, 'Sertraline', 0, '36437',  '50mg QD',  30, '2024-12-05', NULL, 11, 1, 'Anxiety',            '2024-12-05','','',UNHEX(REPLACE(UUID(),'-',''))),

-- Kevin O'Brien (pid=18)
(66, 18, 11, 146, 'Carvedilol', 0, '20352',   '25mg BID', 60, '2021-09-13', NULL, 11, 1, 'CHF + HTN',              '2021-09-13','','',UNHEX(REPLACE(UUID(),'-',''))),
(67, 18, 11, 146, 'Furosemide', 0, '4603',    '40mg QD',  30, '2021-09-13', NULL, 11, 1, 'CHF fluid management',   '2021-09-13','','',UNHEX(REPLACE(UUID(),'-',''))),
(68, 18, 11, 146, 'Apixaban',   0, '1364430', '5mg BID',  60, '2021-09-13', NULL, 11, 1, 'A-fib anticoagulation',  '2021-09-13','','',UNHEX(REPLACE(UUID(),'-',''))),
(69, 18, 11, 146, 'Lisinopril', 0, '29046',   '10mg QD',  30, '2021-09-13', NULL, 11, 1, 'CHF + HTN + CKD',        '2021-09-13','','',UNHEX(REPLACE(UUID(),'-','')));

-- -----------------------------------------------------------------------
-- ENCOUNTERS (IDs 137-146)
-- -----------------------------------------------------------------------
INSERT INTO form_encounter (id, date, reason, pid, encounter, provider_id, facility_id, pc_catid)
VALUES
(137, '2024-08-15 10:00:00', 'Hypertension - initial evaluation',   14, 137, 11, 3, 5),
(138, '2025-08-20 10:00:00', 'HTN + lipid annual follow-up',        14, 138, 11, 3, 5),
(139, '2024-04-10 11:30:00', 'Hypothyroidism management',           15, 139, 11, 3, 5),
(140, '2025-04-18 11:00:00', 'Thyroid + depression follow-up',      15, 140, 11, 3, 5),
(141, '2024-07-22 09:00:00', 'Diabetes management',                 16, 141, 11, 3, 5),
(142, '2025-07-17 09:00:00', 'DM + HTN + COPD annual review',       16, 142, 11, 3, 5),
(143, '2024-12-05 14:00:00', 'Migraine - initial evaluation',       17, 143, 11, 3, 5),
(144, '2025-12-10 14:00:00', 'Migraine + anxiety follow-up',        17, 144, 11, 3, 5),
(145, '2024-09-05 08:30:00', 'CHF management',                      18, 145, 11, 3, 5),
(146, '2025-03-12 08:30:00', 'CHF quarterly review',                18, 146, 11, 3, 5);

-- -----------------------------------------------------------------------
-- VITALS (form_vitals IDs 52-61)
-- -----------------------------------------------------------------------
INSERT INTO form_vitals
    (id, uuid, date, pid, user, groupname, authorized, activity,
     bps, bpd, height, weight, temperature, temp_method, pulse, respiration, BMI, BMI_status, oxygen_saturation)
VALUES
-- Carlos Mendez (pid=14), 5'10" = 70in
(52, UNHEX(REPLACE(UUID(),'-','')), '2024-08-15 10:00:00', 14, 'marcus.rivera','Default',1,1, '152','94', 70,212, 98.6,'oral',78,16, 30.43,'Obese',       98),
(53, UNHEX(REPLACE(UUID(),'-','')), '2025-08-20 10:00:00', 14, 'marcus.rivera','Default',1,1, '136','86', 70,208, 98.4,'oral',74,16, 29.86,'Overweight',  98),

-- Anna Kowalski (pid=15), 5'6" = 66in
(54, UNHEX(REPLACE(UUID(),'-','')), '2024-04-10 11:30:00', 15, 'marcus.rivera','Default',1,1, '118','76', 66,150, 98.6,'oral',72,16, 24.21,'Normal Weight',99),
(55, UNHEX(REPLACE(UUID(),'-','')), '2025-04-18 11:00:00', 15, 'marcus.rivera','Default',1,1, '114','74', 66,148, 98.4,'oral',70,16, 23.89,'Normal Weight',99),

-- Thomas Brown (pid=16), 5'8" = 68in — COPD: lower O2 sat
(56, UNHEX(REPLACE(UUID(),'-','')), '2024-07-22 09:00:00', 16, 'marcus.rivera','Default',1,1, '142','90', 68,204, 98.4,'oral',76,18, 31.00,'Obese',       95),
(57, UNHEX(REPLACE(UUID(),'-','')), '2025-07-17 09:00:00', 16, 'marcus.rivera','Default',1,1, '136','86', 68,200, 98.6,'oral',74,18, 30.39,'Obese',       95),

-- Lisa Chang (pid=17), 5'4" = 64in
(58, UNHEX(REPLACE(UUID(),'-','')), '2024-12-05 14:00:00', 17, 'marcus.rivera','Default',1,1, '116','74', 64,132, 98.6,'oral',76,16, 22.65,'Normal Weight',99),
(59, UNHEX(REPLACE(UUID(),'-','')), '2025-12-10 14:00:00', 17, 'marcus.rivera','Default',1,1, '114','72', 64,130, 98.4,'oral',74,16, 22.31,'Normal Weight',99),

-- Kevin O'Brien (pid=18), 5'9" = 69in — CHF: lower O2 sat, elevated pulse
(60, UNHEX(REPLACE(UUID(),'-','')), '2024-09-05 08:30:00', 18, 'marcus.rivera','Default',1,1, '148','92', 69,182, 98.4,'oral',82,18, 26.89,'Overweight',  95),
(61, UNHEX(REPLACE(UUID(),'-','')), '2025-03-12 08:30:00', 18, 'marcus.rivera','Default',1,1, '136','84', 69,176, 98.6,'oral',76,16, 26.00,'Overweight',  96);

-- -----------------------------------------------------------------------
-- SOAP NOTES (form_soap IDs 27-36)
-- -----------------------------------------------------------------------
INSERT INTO form_soap (id, date, pid, user, groupname, authorized, activity, subjective, objective, assessment, plan)
VALUES

-- Carlos Mendez: initial HTN evaluation (encounter 137, 2024-08-15)
(27, '2024-08-15 10:00:00', 14, 'marcus.rivera', 'Default', 1, 1,
 'New patient. Home BP readings 150-160/90-95 for 3 months. Denies chest pain or dyspnea. Family history: father had MI at 62. Former smoker — 12 pack-years, quit 8 years ago.',
 'BP 152/94, HR 78, Weight 212 lbs, BMI 30.4. Regular rate and rhythm, no murmurs. Lipid panel today: LDL 162.',
 'Essential hypertension — newly diagnosed. Hyperlipidemia — LDL 162, treatment threshold met. Overweight.',
 'Start lisinopril 10mg QD. Start atorvastatin 20mg QD. DASH diet counseling. 150 min/week moderate exercise. Recheck BP and labs in 3 months.'),

-- Carlos Mendez: annual follow-up (encounter 138, 2025-08-20)
(28, '2025-08-20 10:00:00', 14, 'marcus.rivera', 'Default', 1, 1,
 'Annual follow-up. Good medication adherence. Home BP averaging 135-140/85. Walking 30 minutes daily. Weight down 4 lbs since last visit.',
 'BP 136/86, HR 74, Weight 208 lbs. LDL 110 on today''s lipid panel.',
 'Hypertension — improved, approaching goal (<130/80). Hyperlipidemia — LDL down from 162 to 110 on atorvastatin 20mg.',
 'Continue lisinopril 10mg and atorvastatin 20mg. If BP not at goal at next visit, increase lisinopril to 20mg. Annual labs complete. Return in 12 months.'),

-- Anna Kowalski: initial hypothyroid/depression (encounter 139, 2024-04-10)
(29, '2024-04-10 11:30:00', 15, 'marcus.rivera', 'Default', 1, 1,
 'Presents with fatigue, weight gain, and cold intolerance over past year. Also describes persistent low mood for 6 months — decreased interest in activities, poor sleep, low energy. Denies suicidal ideation.',
 'BP 118/76, HR 72, Weight 150 lbs. Dry skin, mild periorbital puffiness. TSH 5.8 mIU/L. PHQ-9: 12 (moderate depression).',
 'Hypothyroidism — newly diagnosed (TSH 5.8). Major depressive disorder — moderate (PHQ-9 12). Some depressive symptoms may overlap with hypothyroidism.',
 'Start levothyroxine 75mcg QD on empty stomach. Start escitalopram 10mg QD. Recheck TSH in 6-8 weeks. PHQ-9 follow-up in 4-6 weeks. Return in 6 weeks.'),

-- Anna Kowalski: annual follow-up (encounter 140, 2025-04-18)
(30, '2025-04-18 11:00:00', 15, 'marcus.rivera', 'Default', 1, 1,
 'Annual follow-up. Significant improvement in energy and mood. PHQ-9 today: 4 (minimal). Reports regular sleep, resumed gardening. Tolerating both medications well. No palpitations.',
 'BP 114/74, HR 70, Weight 148 lbs. TSH 2.4 mIU/L (normal). PHQ-9: 4.',
 'Hypothyroidism — well-controlled on levothyroxine 75mcg (TSH 2.4). Major depressive disorder — in remission (PHQ-9 4).',
 'Continue levothyroxine 75mcg and escitalopram 10mg. Plan minimum 12 months escitalopram per guideline before considering taper. Annual TSH. Return in 12 months.'),

-- Thomas Brown: DM follow-up (encounter 141, 2024-07-22)
(31, '2024-07-22 09:00:00', 16, 'marcus.rivera', 'Default', 1, 1,
 'Diabetes follow-up. Reports metformin adherence inconsistent — GI intolerance with higher doses. Diet compliance poor. Uses tiotropium daily without albuterol rescue in past 3 months. No COPD exacerbations.',
 'BP 142/90, HR 76, Weight 204 lbs. O2 sat 95% RA. Mild expiratory prolongation. A1C 8.2.',
 'T2DM — inadequately controlled, A1C 8.2. Hypertension — above goal at 142/90. COPD, moderate — stable on tiotropium.',
 'Increase metformin to 1000mg BID with meals to reduce GI side effects. Increase lisinopril to 20mg. Dietary counseling referral. Recheck A1C in 3 months.'),

-- Thomas Brown: annual review (encounter 142, 2025-07-17)
(32, '2025-07-17 09:00:00', 16, 'marcus.rivera', 'Default', 1, 1,
 'Annual review. Improved diet — low-carb approach. Metformin 1000mg BID tolerated with meals. A1C 7.6 today. BP better controlled. No COPD exacerbations in past year. Still using tiotropium daily.',
 'BP 136/86, HR 74, Weight 200 lbs. O2 sat 95% RA. A1C 7.6.',
 'T2DM — improved, A1C 7.6 (down from 8.2). Hypertension — at goal on lisinopril 20mg. COPD — stable, no exacerbations.',
 'Continue metformin 1000mg BID, lisinopril 20mg, tiotropium. Target A1C <7 — add SGLT2 inhibitor next visit if not achieved. Annual diabetic eye exam and foot exam done. Return in 12 months.'),

-- Lisa Chang: initial migraine evaluation (encounter 143, 2024-12-05)
(33, '2024-12-05 14:00:00', 17, 'marcus.rivera', 'Default', 1, 1,
 'Migraine evaluation. 4-6 episodes/month × 8 months. Throbbing unilateral headache with photophobia and nausea, lasting 6-18 hours. Ibuprofen partially effective. Also reports generalized worry, difficulty concentrating at work, poor sleep — GAD-7 today: 12.',
 'BP 116/74, HR 76, Weight 132 lbs. Neurological exam: non-focal. No papilledema.',
 'Migraine without aura — meets criteria for prophylactic therapy (4+ per month). Generalized anxiety disorder — moderate severity (GAD-7 12).',
 'Start topiramate 25mg QD × 2 weeks then titrate to 50mg BID for migraine prophylaxis. Start sertraline 50mg QD for anxiety. Headache diary initiated. Lifestyle: regular sleep, hydration. Return in 6 weeks.'),

-- Lisa Chang: annual follow-up (encounter 144, 2025-12-10)
(34, '2025-12-10 14:00:00', 17, 'marcus.rivera', 'Default', 1, 1,
 'Annual follow-up. Migraine frequency decreased to 1-2/month on topiramate. Anxiety significantly improved on sertraline — GAD-7 today: 5. Notes occasional word-finding difficulty (known topiramate side effect). Accepts side effect given efficacy.',
 'BP 114/72, HR 74, Weight 130 lbs. GAD-7: 5 (mild). Neurological: non-focal.',
 'Migraine without aura — well-controlled (1-2/month from 4-6) on topiramate 50mg BID. Generalized anxiety disorder — improved on sertraline (GAD-7 5).',
 'Continue topiramate 50mg BID and sertraline 50mg. Discussed cognitive side effects — patient accepts tradeoff. Continue headache diary. Return in 12 months.'),

-- Kevin O'Brien: CHF management (encounter 145, 2024-09-05)
(35, '2024-09-05 08:30:00', 18, 'marcus.rivera', 'Default', 1, 1,
 'CHF management. Reports increased dyspnea on exertion — can walk half a block before stopping (was 2 blocks last year). Bilateral ankle edema worsening. Wakes 2x/night to void. Cardiologist echo 3 months ago: EF 40%. BNP today: 280 pg/mL. Weight up 4 lbs from last visit.',
 'BP 148/92, HR 82 irregular (A-fib rate-controlled), Weight 182 lbs. O2 sat 95% RA. 1+ pitting edema bilateral ankles. BMP: Creatinine 1.8, K+ 4.6.',
 'Heart failure with reduced EF (EF 40%) — worsening, volume overloaded. Atrial fibrillation — rate-controlled, anticoagulated on apixaban. CKD stage 3 — creatinine stable at 1.8. Hypertension — suboptimal.',
 'Increase furosemide to 40mg QD. Continue carvedilol 25mg BID, apixaban 5mg BID, lisinopril 10mg. Daily weights — call if >3 lbs gain in 2 days. Fluid restriction 1.5L/day. Low-sodium diet. Return in 2 weeks.'),

-- Kevin O'Brien: CHF quarterly review (encounter 146, 2025-03-12)
(36, '2025-03-12 08:30:00', 18, 'marcus.rivera', 'Default', 1, 1,
 'Quarterly CHF review. Improved exercise tolerance — can walk 1 full block without stopping. Ankle edema resolved. Better sleep. Daily weights compliant — no >3 lb gains. BNP today: 210 (down from 280).',
 'BP 136/84, HR 76 irregular (A-fib), Weight 176 lbs (down 6 lbs). O2 sat 96% RA. No peripheral edema. BMP: Creatinine 1.8, K+ 4.4.',
 'CHF with reduced EF — improved on adjusted diuresis, BNP trending down. Atrial fibrillation — stable. CKD stage 3 — creatinine unchanged.',
 'Continue furosemide 40mg, carvedilol 25mg BID, apixaban 5mg BID, lisinopril 10mg. Daily weights ongoing. Cardiology follow-up scheduled. Renal function recheck in 3 months. Return in 3 months.');

-- -----------------------------------------------------------------------
-- FORMS TABLE LINKS for Rivera's encounters (IDs 60-79)
-- -----------------------------------------------------------------------
INSERT INTO forms
    (id, date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir, provider_id)
VALUES
-- Vitals links
(60, '2024-08-15 10:00:00', 137, 'Vitals', 52, 14, 'marcus.rivera','Default',1,0,'vitals',11),
(61, '2025-08-20 10:00:00', 138, 'Vitals', 53, 14, 'marcus.rivera','Default',1,0,'vitals',11),
(62, '2024-04-10 11:30:00', 139, 'Vitals', 54, 15, 'marcus.rivera','Default',1,0,'vitals',11),
(63, '2025-04-18 11:00:00', 140, 'Vitals', 55, 15, 'marcus.rivera','Default',1,0,'vitals',11),
(64, '2024-07-22 09:00:00', 141, 'Vitals', 56, 16, 'marcus.rivera','Default',1,0,'vitals',11),
(65, '2025-07-17 09:00:00', 142, 'Vitals', 57, 16, 'marcus.rivera','Default',1,0,'vitals',11),
(66, '2024-12-05 14:00:00', 143, 'Vitals', 58, 17, 'marcus.rivera','Default',1,0,'vitals',11),
(67, '2025-12-10 14:00:00', 144, 'Vitals', 59, 17, 'marcus.rivera','Default',1,0,'vitals',11),
(68, '2024-09-05 08:30:00', 145, 'Vitals', 60, 18, 'marcus.rivera','Default',1,0,'vitals',11),
(69, '2025-03-12 08:30:00', 146, 'Vitals', 61, 18, 'marcus.rivera','Default',1,0,'vitals',11),
-- SOAP links
(70, '2024-08-15 10:00:00', 137, 'SOAP',   27, 14, 'marcus.rivera','Default',1,0,'soap', 11),
(71, '2025-08-20 10:00:00', 138, 'SOAP',   28, 14, 'marcus.rivera','Default',1,0,'soap', 11),
(72, '2024-04-10 11:30:00', 139, 'SOAP',   29, 15, 'marcus.rivera','Default',1,0,'soap', 11),
(73, '2025-04-18 11:00:00', 140, 'SOAP',   30, 15, 'marcus.rivera','Default',1,0,'soap', 11),
(74, '2024-07-22 09:00:00', 141, 'SOAP',   31, 16, 'marcus.rivera','Default',1,0,'soap', 11),
(75, '2025-07-17 09:00:00', 142, 'SOAP',   32, 16, 'marcus.rivera','Default',1,0,'soap', 11),
(76, '2024-12-05 14:00:00', 143, 'SOAP',   33, 17, 'marcus.rivera','Default',1,0,'soap', 11),
(77, '2025-12-10 14:00:00', 144, 'SOAP',   34, 17, 'marcus.rivera','Default',1,0,'soap', 11),
(78, '2024-09-05 08:30:00', 145, 'SOAP',   35, 18, 'marcus.rivera','Default',1,0,'soap', 11),
(79, '2025-03-12 08:30:00', 146, 'SOAP',   36, 18, 'marcus.rivera','Default',1,0,'soap', 11);

-- -----------------------------------------------------------------------
-- LABS for Rivera's patients (procedure_order/report IDs 237-244)
-- -----------------------------------------------------------------------

-- Carlos Mendez: lipid panel x2
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(237, 11, 14, 137, '2024-08-15', 'complete', 1),
(238, 11, 14, 138, '2025-08-20', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(237, 237, '2024-08-17', 'final'),
(238, 238, '2025-08-22', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(237, '2089-1', 'LDL Cholesterol', '162', 'mg/dL', '<100', 'H', 'final', '2024-08-17'),
(238, '2089-1', 'LDL Cholesterol', '110', 'mg/dL', '<100', 'H', 'final', '2025-08-22');

-- Anna Kowalski: TSH x2
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(239, 11, 15, 139, '2024-04-10', 'complete', 1),
(240, 11, 15, 140, '2025-04-18', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(239, 239, '2024-04-12', 'final'),
(240, 240, '2025-04-20', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(239, '3016-3', 'TSH', '5.8', 'mIU/L', '0.4-4.0', 'H', 'final', '2024-04-12'),
(240, '3016-3', 'TSH', '2.4', 'mIU/L', '0.4-4.0', 'N', 'final', '2025-04-20');

-- Thomas Brown: A1C x2
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(241, 11, 16, 141, '2024-07-22', 'complete', 1),
(242, 11, 16, 142, '2025-07-17', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(241, 241, '2024-07-24', 'final'),
(242, 242, '2025-07-19', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(241, '4548-4', 'Hemoglobin A1c', '8.2', '%', '4.0-5.6', 'H', 'final', '2024-07-24'),
(242, '4548-4', 'Hemoglobin A1c', '7.6', '%', '4.0-5.6', 'H', 'final', '2025-07-19');

-- Kevin O'Brien: BMP + BNP x2 (CHF monitoring)
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES
(243, 11, 18, 145, '2024-09-05', 'complete', 1),
(244, 11, 18, 146, '2025-03-12', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES
(243, 243, '2024-09-05', 'final'),
(244, 244, '2025-03-12', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES
(243, '2160-0', 'Creatinine', '1.8', 'mg/dL', '0.7-1.3', 'H', 'final', '2024-09-05'),
(243, '2823-3', 'Potassium',  '4.6', 'mEq/L', '3.5-5.1', 'N', 'final', '2024-09-05'),
(243, '42637-9','BNP',        '280', 'pg/mL', '<100',    'H', 'final', '2024-09-05'),
(244, '2160-0', 'Creatinine', '1.8', 'mg/dL', '0.7-1.3', 'H', 'final', '2025-03-12'),
(244, '2823-3', 'Potassium',  '4.4', 'mEq/L', '3.5-5.1', 'N', 'final', '2025-03-12'),
(244, '42637-9','BNP',        '210', 'pg/mL', '<100',    'H', 'final', '2025-03-12');

-- -----------------------------------------------------------------------
-- TODAY'S SCHEDULE — Dr. Rivera (2026-04-27)
-- -----------------------------------------------------------------------
INSERT INTO openemr_postcalendar_events
    (pc_catid, pc_aid, pc_pid, pc_title, pc_time, pc_hometext,
     pc_eventDate, pc_startTime, pc_endTime, pc_duration, pc_alldayevent,
     pc_apptstatus, pc_prefcatid, pc_multiple, pc_sharing, pc_facility, pc_eventstatus)
VALUES
(5, '11', '14', 'HTN annual follow-up',        '2026-04-27 09:00:00', 'BP recheck + lipid panel review',      '2026-04-27', '09:00:00', '09:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '11', '16', 'DM + COPD annual review',     '2026-04-27 09:30:00', 'A1C recheck + COPD stability check',   '2026-04-27', '09:30:00', '09:50:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '11', '15', 'Thyroid + depression follow-up','2026-04-27 10:00:00','TSH recheck; PHQ-9 reassessment',     '2026-04-27', '10:00:00', '10:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '11', '18', 'CHF quarterly review',        '2026-04-27 10:30:00', 'Weight, BMP, BNP — fluid status',      '2026-04-27', '10:30:00', '10:50:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '11', '17', 'Migraine + anxiety follow-up','2026-04-27 11:00:00', 'Topiramate efficacy; GAD-7 recheck',   '2026-04-27', '11:00:00', '11:20:00', 1200, 0, '@', 0, 0, 1, 3, 1);

-- procedure_report.date_collected must be set or the Labs card on the patient
-- summary page won't recognize that lab results exist. Copy from date_report.
UPDATE procedure_report SET date_collected = date_report
WHERE date_collected IS NULL AND date_report IS NOT NULL;

SET FOREIGN_KEY_CHECKS = 1;
