-- =============================================================================
-- Clinical Co-Pilot Demo Augmentation
-- =============================================================================
-- Run AFTER demo_seed.sql. Adds:
--   - Facility rename: "Cedar Family Medicine", Austin TX
--   - Vitals for all 37 patient encounters (form_vitals + forms links)
--   - SOAP notes for remaining 8 patients (form_soap + forms links)
--   - forms table links for the 5 SOAP notes already in form_soap but unlinked
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- =============================================================================
-- FACILITY
-- =============================================================================

UPDATE facility SET
    name         = 'Cedar Family Medicine',
    street       = '4801 Burnet Road, Suite 200',
    city         = 'Austin',
    state        = 'TX',
    postal_code  = '78756',
    phone        = '512-555-0100'
WHERE id = 3;

-- =============================================================================
-- SOAP NOTES — remaining 8 patients (form_soap IDs 19–26)
-- =============================================================================

INSERT INTO form_soap (id, date, pid, user, groupname, authorized, activity, subjective, objective, assessment, plan)
VALUES

-- Wanda Moore (pid=3), last encounter 107 (2025-02-03)
(19, '2025-02-03 10:00:00', 3, 'sarah.chen', 'Default', 1, 1,
 'Patient returns for sertraline follow-up at 6 months. Reports mood significantly improved. Still experiencing irregular periods. Completed OB/GYN referral last month — pelvic ultrasound ordered, results pending.',
 'BP 112/72, HR 82, Weight 130 lbs. No acute distress. Affect brighter than prior visit.',
 'Generalized anxiety disorder — responding well to sertraline 50mg. Irregular menstrual cycle — OB/GYN evaluation in progress.',
 'Continue sertraline 50mg. Follow up OB/GYN ultrasound result. Return in 3 months or sooner if needed.'),

-- Elena Rodriguez (pid=5), last encounter 114 (2025-09-11)
(20, '2025-09-11 10:00:00', 5, 'sarah.chen', 'Default', 1, 1,
 'Patient here for blood pressure follow-up. Reports compliance with amlodipine and HCTZ. Discussing DEXA results received last week — T-score -2.6 at lumbar spine, -2.1 at femoral neck.',
 'BP 148/88, HR 74, Weight 148 lbs. No edema. No acute distress.',
 'Hypertension — improved but not at goal (target <130/80). Osteoporosis confirmed on DEXA — bisphosphonate therapy indicated.',
 'Continue amlodipine 10mg + HCTZ 25mg. Start alendronate 70mg weekly. Calcium 1200mg + vitamin D3 2000 IU daily. Recheck BP in 3 months. Repeat DEXA in 2 years.'),

-- James Park (pid=6), last encounter 117 (2026-02-14)
(21, '2026-02-14 14:00:00', 6, 'sarah.chen', 'Default', 1, 1,
 'Patient seen after urgent care visit 2 weeks ago for asthma exacerbation. Using albuterol rescue inhaler daily — previously 2x/week. Anxiety symptoms worsening, particularly around dyspnea episodes.',
 'BP 126/82, HR 86, RR 18, O2 94% on room air. Mild diffuse expiratory wheeze. No use of accessory muscles.',
 'Asthma, mild persistent — worsening, inadequately controlled on rescue inhaler alone. Generalized anxiety disorder — likely exacerbating respiratory symptoms.',
 'Add fluticasone 110mcg BID as inhaled controller. Continue albuterol PRN. Continue sertraline 50mg. Pulmonology referral placed. Asthma action plan reviewed. Return in 4 weeks.'),

-- David Kim (pid=8), last encounter 123 (2025-07-24)
(22, '2025-07-24 10:30:00', 8, 'sarah.chen', 'Default', 1, 1,
 'Patient for pre-diabetes 6-month follow-up. Attempting lifestyle changes — walking 20 min most days, reducing carbs. Fasting glucose today 124. Weight up 4 lbs since January.',
 'BP 126/80, HR 72, Weight 198 lbs. BMI 30.1. No acute distress.',
 'Prediabetes — not responding adequately to lifestyle alone. A1C 6.1 (up from 5.9 in January). Hyperlipidemia — rosuvastatin continued.',
 'Start metformin 500mg QD to delay T2DM onset. Continue dietary counseling referral. Exercise goal: 150 min/week moderate intensity. Recheck A1C in 6 months. Recheck fasting lipids in 12 months.'),

-- Sarah Torres (pid=9), last encounter 125 (2025-02-18)
(23, '2025-02-18 15:30:00', 9, 'sarah.chen', 'Default', 1, 1,
 'Patient for sertraline follow-up at 4 months postpartum. Reports mood significantly improved — PHQ-9 today 6 (was 14 at initial visit). Bonding well with infant. Returned to work 2 weeks ago. No suicidal ideation.',
 'BP 114/72, HR 84, Weight 134 lbs. Alert, oriented. Mood euthymic.',
 'Postpartum depression — responding well to sertraline 50mg. PHQ-9 improved from 14 to 6.',
 'Continue sertraline 50mg — plan minimum 12 months per postpartum depression guideline. OB/GYN follow-up for contraception. Screen again at 6 months. Return in 3 months or PRN.'),

-- Jennifer Walsh (pid=11), last encounter 130 (2025-09-23)
(24, '2025-09-23 14:30:00', 11, 'sarah.chen', 'Default', 1, 1,
 'Patient returns for migraine management review. Migraine frequency has increased to 6-8 episodes per month, up from 2-3. Sumatriptan partially effective — takes 2 doses per attack. Reports increased work stress. TSH checked today.',
 'BP 122/78, HR 74, Weight 144 lbs. TSH 2.8 (normal). Neurological exam non-focal.',
 'Migraine without aura — frequency increasing, meets criteria for prophylactic therapy. Hypothyroidism — well-controlled on levothyroxine 100mcg (TSH 2.8).',
 'Start propranolol 40mg BID for migraine prophylaxis — discuss that benefit takes 6-8 weeks. Continue sumatriptan 50mg PRN (limit 2/week). Continue levothyroxine 100mcg. Headache diary started. Recheck in 6 weeks for propranolol tolerance.'),

-- Michael Thompson (pid=12), last encounter 134 (2025-10-07)
(25, '2025-10-07 08:30:00', 12, 'sarah.chen', 'Default', 1, 1,
 'Patient for CAD annual review. No chest pain or dyspnea at rest or with usual activity. Tolerating all medications. Nuclear stress test completed last month — small fixed inferior perfusion defect, unchanged from prior study.',
 'BP 128/78, HR 66, Weight 182 lbs. EKG: NSR, old inferior Q-waves unchanged from prior. No new ST changes.',
 'Coronary artery disease — stable, medically managed. Fixed defect on stress test consistent with old MI — no new ischemia. T2DM — A1C 7.2 (July). HTN — at goal.',
 'Continue aspirin 81mg, metoprolol 100mg, lisinopril 40mg, atorvastatin 80mg, metformin 1000mg BID. Cardiology follow-up for stress test review. A1C recheck January 2026. Annual diabetic eye exam ordered. Return in 3 months.'),

-- Aisha Williams (pid=13), last encounter 136 (2025-07-17)
(26, '2025-07-17 11:30:00', 13, 'sarah.chen', 'Default', 1, 1,
 'Patient for hydroxychloroquine monitoring and primary care co-management of lupus. Reports stable — fatigue present but manageable, no new rashes or joint flares since last visit. Rheumatology seen 3 months ago, disease activity score stable.',
 'BP 120/76, HR 76, Weight 130 lbs. No malar rash. Joints without active synovitis. Skin without active lesions.',
 'Systemic lupus erythematosus — stable, well-controlled on hydroxychloroquine per rheumatology. Annual ophthalmology screening due (hydroxychloroquine retinal toxicity monitoring).',
 'Continue hydroxychloroquine 400mg QD. Ophthalmology referral placed for annual hydroxychloroquine screening. Continue vitamin D3 2000 IU QD. CBC and CMP ordered per rheumatology protocol. Return in 6 months or per rheumatology.');

-- =============================================================================
-- VITALS (form_vitals IDs 15–51, one per encounter 100–136)
-- Columns: id, uuid, date, pid, user, groupname, authorized, activity,
--          bps, bpd, height, weight, temperature, temp_method, pulse,
--          respiration, BMI, BMI_status, oxygen_saturation
-- =============================================================================

INSERT INTO form_vitals
    (id, uuid, date, pid, user, groupname, authorized, activity,
     bps, bpd, height, weight, temperature, temp_method, pulse, respiration, BMI, BMI_status, oxygen_saturation)
VALUES
-- Phil Belford (pid=1), 5'10" = 70in
(15, UNHEX(REPLACE(UUID(),'-','')), '2025-01-08 09:00:00', 1, 'sarah.chen','Default',1,1, '148','92', 70, 195, 98.4,'oral', 78, 16, 27.98,'Overweight', 98),
(16, UNHEX(REPLACE(UUID(),'-','')), '2025-07-15 09:30:00', 1, 'sarah.chen','Default',1,1, '152','94', 70, 197, 98.6,'oral', 80, 16, 28.26,'Overweight', 98),
(17, UNHEX(REPLACE(UUID(),'-','')), '2026-01-20 10:00:00', 1, 'sarah.chen','Default',1,1, '152','94', 70, 198, 98.4,'oral', 78, 16, 28.41,'Overweight', 98),

-- Susan Underwood (pid=2), 5'5" = 65in
(18, UNHEX(REPLACE(UUID(),'-','')), '2024-11-05 08:00:00', 2, 'sarah.chen','Default',1,1, '136','86', 65, 166, 98.6,'oral', 74, 16, 27.63,'Overweight', 99),
(19, UNHEX(REPLACE(UUID(),'-','')), '2025-05-14 09:00:00', 2, 'sarah.chen','Default',1,1, '132','84', 65, 164, 98.4,'oral', 72, 16, 27.30,'Overweight', 99),
(20, UNHEX(REPLACE(UUID(),'-','')), '2025-11-20 09:00:00', 2, 'sarah.chen','Default',1,1, '128','82', 65, 164, 98.6,'oral', 72, 16, 27.30,'Overweight', 99),

-- Wanda Moore (pid=3), 5'4" = 64in
(21, UNHEX(REPLACE(UUID(),'-','')), '2024-08-12 14:00:00', 3, 'sarah.chen','Default',1,1, '118','74', 64, 132, 98.6,'oral', 88, 18, 22.65,'Normal Weight', 99),
(22, UNHEX(REPLACE(UUID(),'-','')), '2025-02-03 10:00:00', 3, 'sarah.chen','Default',1,1, '112','72', 64, 130, 98.4,'oral', 82, 16, 22.31,'Normal Weight', 99),

-- Marcus Johnson (pid=4), 5'11" = 71in
(23, UNHEX(REPLACE(UUID(),'-','')), '2024-10-01 09:00:00', 4, 'sarah.chen','Default',1,1, '146','92', 71, 216, 98.4,'oral', 82, 18, 30.16,'Obese', 97),
(24, UNHEX(REPLACE(UUID(),'-','')), '2025-04-10 09:30:00', 4, 'sarah.chen','Default',1,1, '150','94', 71, 220, 98.6,'oral', 84, 18, 30.72,'Obese', 97),
(25, UNHEX(REPLACE(UUID(),'-','')), '2025-10-22 09:00:00', 4, 'sarah.chen','Default',1,1, '148','90', 71, 222, 98.4,'oral', 80, 18, 31.00,'Obese', 97),
(26, UNHEX(REPLACE(UUID(),'-','')), '2026-01-15 10:00:00', 4, 'sarah.chen','Default',1,1, '148','90', 71, 224, 98.6,'oral', 80, 18, 31.28,'Obese', 97),

-- Elena Rodriguez (pid=5), 5'3" = 63in
(27, UNHEX(REPLACE(UUID(),'-','')), '2024-09-18 11:00:00', 5, 'sarah.chen','Default',1,1, '158','96', 63, 148, 98.6,'oral', 76, 16, 26.20,'Overweight', 98),
(28, UNHEX(REPLACE(UUID(),'-','')), '2025-03-05 11:30:00', 5, 'sarah.chen','Default',1,1, '152','92', 63, 146, 98.4,'oral', 74, 16, 25.84,'Overweight', 98),
(29, UNHEX(REPLACE(UUID(),'-','')), '2025-09-11 10:00:00', 5, 'sarah.chen','Default',1,1, '148','88', 63, 148, 98.6,'oral', 74, 16, 26.20,'Overweight', 98),

-- James Park (pid=6), 5'9" = 69in
(30, UNHEX(REPLACE(UUID(),'-','')), '2025-02-20 13:00:00', 6, 'sarah.chen','Default',1,1, '124','80', 69, 168, 98.4,'oral', 76, 16, 24.82,'Normal Weight', 97),
(31, UNHEX(REPLACE(UUID(),'-','')), '2025-08-07 13:30:00', 6, 'sarah.chen','Default',1,1, '120','78', 69, 170, 98.6,'oral', 74, 16, 25.12,'Overweight', 98),
(32, UNHEX(REPLACE(UUID(),'-','')), '2026-02-14 14:00:00', 6, 'sarah.chen','Default',1,1, '126','82', 69, 172, 98.4,'oral', 86, 18, 25.41,'Overweight', 94),

-- Patricia Williams (pid=7), 5'2" = 62in
(33, UNHEX(REPLACE(UUID(),'-','')), '2024-08-29 08:30:00', 7, 'sarah.chen','Default',1,1, '158','88', 62, 170, 98.6,'oral', 78, 16, 31.12,'Obese', 96),
(34, UNHEX(REPLACE(UUID(),'-','')), '2025-02-19 08:30:00', 7, 'sarah.chen','Default',1,1, '154','86', 62, 168, 98.4,'oral', 76, 16, 30.75,'Obese', 97),
(35, UNHEX(REPLACE(UUID(),'-','')), '2025-08-28 08:30:00', 7, 'sarah.chen','Default',1,1, '156','90', 62, 170, 98.6,'oral', 80, 16, 31.12,'Obese', 96),
(36, UNHEX(REPLACE(UUID(),'-','')), '2026-02-26 09:00:00', 7, 'sarah.chen','Default',1,1, '162','88', 62, 171, 98.4,'oral', 82, 16, 31.30,'Obese', 96),

-- David Kim (pid=8), 5'8" = 68in
(37, UNHEX(REPLACE(UUID(),'-','')), '2025-01-30 10:30:00', 8, 'sarah.chen','Default',1,1, '128','82', 68, 194, 98.6,'oral', 74, 16, 29.47,'Overweight', 99),
(38, UNHEX(REPLACE(UUID(),'-','')), '2025-07-24 10:30:00', 8, 'sarah.chen','Default',1,1, '126','80', 68, 198, 98.4,'oral', 72, 16, 30.08,'Obese', 99),

-- Sarah Torres (pid=9), 5'6" = 66in
(39, UNHEX(REPLACE(UUID(),'-','')), '2024-10-14 15:00:00', 9, 'sarah.chen','Default',1,1, '112','70', 66, 138, 98.6,'oral', 86, 18, 22.28,'Normal Weight', 99),
(40, UNHEX(REPLACE(UUID(),'-','')), '2025-02-18 15:30:00', 9, 'sarah.chen','Default',1,1, '114','72', 66, 134, 98.4,'oral', 84, 16, 21.63,'Normal Weight', 99),

-- Robert Chen (pid=10), 5'7" = 67in
(41, UNHEX(REPLACE(UUID(),'-','')), '2024-11-12 09:00:00',10, 'sarah.chen','Default',1,1, '132','82', 67, 164, 98.4,'oral', 78, 18, 25.68,'Overweight', 93),
(42, UNHEX(REPLACE(UUID(),'-','')), '2025-05-08 09:30:00',10, 'sarah.chen','Default',1,1, '128','80', 67, 162, 98.6,'oral', 76, 18, 25.37,'Overweight', 94),
(43, UNHEX(REPLACE(UUID(),'-','')), '2025-12-03 09:00:00',10, 'sarah.chen','Default',1,1, '134','84', 67, 164, 98.4,'oral', 80, 18, 25.68,'Overweight', 94),

-- Jennifer Walsh (pid=11), 5'5" = 65in
(44, UNHEX(REPLACE(UUID(),'-','')), '2025-03-11 14:00:00',11, 'sarah.chen','Default',1,1, '118','76', 65, 142, 98.6,'oral', 72, 16, 23.64,'Normal Weight', 99),
(45, UNHEX(REPLACE(UUID(),'-','')), '2025-09-23 14:30:00',11, 'sarah.chen','Default',1,1, '122','78', 65, 144, 98.4,'oral', 74, 16, 23.97,'Normal Weight', 99),

-- Michael Thompson (pid=12), 5'11" = 71in
(46, UNHEX(REPLACE(UUID(),'-','')), '2024-10-08 08:00:00',12, 'sarah.chen','Default',1,1, '136','84', 71, 188, 98.6,'oral', 68, 16, 26.26,'Overweight', 97),
(47, UNHEX(REPLACE(UUID(),'-','')), '2025-01-14 08:30:00',12, 'sarah.chen','Default',1,1, '132','82', 71, 186, 98.4,'oral', 66, 16, 25.98,'Overweight', 97),
(48, UNHEX(REPLACE(UUID(),'-','')), '2025-04-22 08:00:00',12, 'sarah.chen','Default',1,1, '130','80', 71, 184, 98.6,'oral', 68, 16, 25.70,'Overweight', 97),
(49, UNHEX(REPLACE(UUID(),'-','')), '2025-10-07 08:30:00',12, 'sarah.chen','Default',1,1, '128','78', 71, 182, 98.4,'oral', 66, 16, 25.42,'Overweight', 97),

-- Aisha Williams (pid=13), 5'4" = 64in
(50, UNHEX(REPLACE(UUID(),'-','')), '2025-01-09 11:00:00',13, 'sarah.chen','Default',1,1, '122','78', 64, 132, 98.6,'oral', 78, 16, 22.65,'Normal Weight', 99),
(51, UNHEX(REPLACE(UUID(),'-','')), '2025-07-17 11:30:00',13, 'sarah.chen','Default',1,1, '120','76', 64, 130, 98.4,'oral', 76, 16, 22.31,'Normal Weight', 99);

-- =============================================================================
-- FORMS TABLE — links all SOAP notes and vitals to their encounters
-- =============================================================================

INSERT INTO forms
    (id, date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir, provider_id)
VALUES

-- Link existing unlinked SOAP notes (form_soap IDs 14–18)
(10, '2026-01-20 10:00:00', 102, 'SOAP',   14,  1, 'sarah.chen','Default',1,0,'soap', 10),
(11, '2025-11-20 09:00:00', 105, 'SOAP',   15,  2, 'sarah.chen','Default',1,0,'soap', 10),
(12, '2026-01-15 10:00:00', 111, 'SOAP',   16,  4, 'sarah.chen','Default',1,0,'soap', 10),
(13, '2026-02-26 09:00:00', 121, 'SOAP',   17,  7, 'sarah.chen','Default',1,0,'soap', 10),
(14, '2025-12-03 09:00:00', 128, 'SOAP',   18, 10, 'sarah.chen','Default',1,0,'soap', 10),

-- Link new SOAP notes (form_soap IDs 19–26)
(15, '2025-02-03 10:00:00', 107, 'SOAP',   19,  3, 'sarah.chen','Default',1,0,'soap', 10),
(16, '2025-09-11 10:00:00', 114, 'SOAP',   20,  5, 'sarah.chen','Default',1,0,'soap', 10),
(17, '2026-02-14 14:00:00', 117, 'SOAP',   21,  6, 'sarah.chen','Default',1,0,'soap', 10),
(18, '2025-07-24 10:30:00', 123, 'SOAP',   22,  8, 'sarah.chen','Default',1,0,'soap', 10),
(19, '2025-02-18 15:30:00', 125, 'SOAP',   23,  9, 'sarah.chen','Default',1,0,'soap', 10),
(20, '2025-09-23 14:30:00', 130, 'SOAP',   24, 11, 'sarah.chen','Default',1,0,'soap', 10),
(21, '2025-10-07 08:30:00', 134, 'SOAP',   25, 12, 'sarah.chen','Default',1,0,'soap', 10),
(22, '2025-07-17 11:30:00', 136, 'SOAP',   26, 13, 'sarah.chen','Default',1,0,'soap', 10),

-- Link vitals (form_vitals IDs 15–51 → encounters 100–136)
(23, '2025-01-08 09:00:00', 100, 'Vitals', 15,  1, 'sarah.chen','Default',1,0,'vitals', 10),
(24, '2025-07-15 09:30:00', 101, 'Vitals', 16,  1, 'sarah.chen','Default',1,0,'vitals', 10),
(25, '2026-01-20 10:00:00', 102, 'Vitals', 17,  1, 'sarah.chen','Default',1,0,'vitals', 10),
(26, '2024-11-05 08:00:00', 103, 'Vitals', 18,  2, 'sarah.chen','Default',1,0,'vitals', 10),
(27, '2025-05-14 09:00:00', 104, 'Vitals', 19,  2, 'sarah.chen','Default',1,0,'vitals', 10),
(28, '2025-11-20 09:00:00', 105, 'Vitals', 20,  2, 'sarah.chen','Default',1,0,'vitals', 10),
(29, '2024-08-12 14:00:00', 106, 'Vitals', 21,  3, 'sarah.chen','Default',1,0,'vitals', 10),
(30, '2025-02-03 10:00:00', 107, 'Vitals', 22,  3, 'sarah.chen','Default',1,0,'vitals', 10),
(31, '2024-10-01 09:00:00', 108, 'Vitals', 23,  4, 'sarah.chen','Default',1,0,'vitals', 10),
(32, '2025-04-10 09:30:00', 109, 'Vitals', 24,  4, 'sarah.chen','Default',1,0,'vitals', 10),
(33, '2025-10-22 09:00:00', 110, 'Vitals', 25,  4, 'sarah.chen','Default',1,0,'vitals', 10),
(34, '2026-01-15 10:00:00', 111, 'Vitals', 26,  4, 'sarah.chen','Default',1,0,'vitals', 10),
(35, '2024-09-18 11:00:00', 112, 'Vitals', 27,  5, 'sarah.chen','Default',1,0,'vitals', 10),
(36, '2025-03-05 11:30:00', 113, 'Vitals', 28,  5, 'sarah.chen','Default',1,0,'vitals', 10),
(37, '2025-09-11 10:00:00', 114, 'Vitals', 29,  5, 'sarah.chen','Default',1,0,'vitals', 10),
(38, '2025-02-20 13:00:00', 115, 'Vitals', 30,  6, 'sarah.chen','Default',1,0,'vitals', 10),
(39, '2025-08-07 13:30:00', 116, 'Vitals', 31,  6, 'sarah.chen','Default',1,0,'vitals', 10),
(40, '2026-02-14 14:00:00', 117, 'Vitals', 32,  6, 'sarah.chen','Default',1,0,'vitals', 10),
(41, '2024-08-29 08:30:00', 118, 'Vitals', 33,  7, 'sarah.chen','Default',1,0,'vitals', 10),
(42, '2025-02-19 08:30:00', 119, 'Vitals', 34,  7, 'sarah.chen','Default',1,0,'vitals', 10),
(43, '2025-08-28 08:30:00', 120, 'Vitals', 35,  7, 'sarah.chen','Default',1,0,'vitals', 10),
(44, '2026-02-26 09:00:00', 121, 'Vitals', 36,  7, 'sarah.chen','Default',1,0,'vitals', 10),
(45, '2025-01-30 10:30:00', 122, 'Vitals', 37,  8, 'sarah.chen','Default',1,0,'vitals', 10),
(46, '2025-07-24 10:30:00', 123, 'Vitals', 38,  8, 'sarah.chen','Default',1,0,'vitals', 10),
(47, '2024-10-14 15:00:00', 124, 'Vitals', 39,  9, 'sarah.chen','Default',1,0,'vitals', 10),
(48, '2025-02-18 15:30:00', 125, 'Vitals', 40,  9, 'sarah.chen','Default',1,0,'vitals', 10),
(49, '2024-11-12 09:00:00', 126, 'Vitals', 41, 10, 'sarah.chen','Default',1,0,'vitals', 10),
(50, '2025-05-08 09:30:00', 127, 'Vitals', 42, 10, 'sarah.chen','Default',1,0,'vitals', 10),
(51, '2025-12-03 09:00:00', 128, 'Vitals', 43, 10, 'sarah.chen','Default',1,0,'vitals', 10),
(52, '2025-03-11 14:00:00', 129, 'Vitals', 44, 11, 'sarah.chen','Default',1,0,'vitals', 10),
(53, '2025-09-23 14:30:00', 130, 'Vitals', 45, 11, 'sarah.chen','Default',1,0,'vitals', 10),
(54, '2024-10-08 08:00:00', 131, 'Vitals', 46, 12, 'sarah.chen','Default',1,0,'vitals', 10),
(55, '2025-01-14 08:30:00', 132, 'Vitals', 47, 12, 'sarah.chen','Default',1,0,'vitals', 10),
(56, '2025-04-22 08:00:00', 133, 'Vitals', 48, 12, 'sarah.chen','Default',1,0,'vitals', 10),
(57, '2025-10-07 08:30:00', 134, 'Vitals', 49, 12, 'sarah.chen','Default',1,0,'vitals', 10),
(58, '2025-01-09 11:00:00', 135, 'Vitals', 50, 13, 'sarah.chen','Default',1,0,'vitals', 10),
(59, '2025-07-17 11:30:00', 136, 'Vitals', 51, 13, 'sarah.chen','Default',1,0,'vitals', 10);

SET FOREIGN_KEY_CHECKS = 1;
