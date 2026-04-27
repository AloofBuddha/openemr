-- =============================================================================
-- Clinical Co-Pilot Demo Seed Data
-- =============================================================================
-- Creates Dr. Sarah Chen's patient panel (10 patients) plus patients belonging
-- to other providers (Dr. Marcus Rivera) that should NOT appear in Chen's agent.
-- Includes encounters, SOAP notes, prescriptions, problems, allergies, lab results,
-- and today's (2026-04-27) appointment schedule for Dr. Chen.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- =============================================================================
-- PROVIDERS
-- =============================================================================

INSERT INTO users (id, username, password, fname, lname, mname, title, specialty,
    email, active, authorized, info, facility_id, physician_type, see_auth, calendar)
VALUES
(10, 'sarah.chen', '$2y$10$abcdefghijklmnopqrstuuVGZDcCWGUlNwEJhSAzpEmFkAFVpS7yW',
    'Sarah', 'Chen', 'L', 'Dr.', 'Family Medicine',
    'sarah.chen@clinic.local', 1, 1, 'Primary Care Physician', 3, 'DO', 1, 1),
(11, 'marcus.rivera', '$2y$10$abcdefghijklmnopqrstuuVGZDcCWGUlNwEJhSAzpEmFkAFVpS7yW',
    'Marcus', 'Rivera', 'A', 'Dr.', 'Internal Medicine',
    'marcus.rivera@clinic.local', 1, 1, 'Internist', 3, 'MD', 1, 1)
ON DUPLICATE KEY UPDATE fname = VALUES(fname), calendar = 1;

-- Passwords stored in users_secure (users.password is legacy, set to sentinel)
-- Passwords: sarah.chen = Sarah1234!   marcus.rivera = Marcus1234!
-- Re-run generates new hashes; change these to your own bcrypt hashes for production.
INSERT INTO users_secure (id, username, password, last_update_password)
VALUES
(10, 'sarah.chen',    '$2y$12$placeholder_replace_with_real_hash_chen',    NOW()),
(11, 'marcus.rivera', '$2y$12$placeholder_replace_with_real_hash_rivera',  NOW())
ON DUPLICATE KEY UPDATE last_update_password = VALUES(last_update_password);

-- Fix legacy password field
UPDATE users SET password = 'NoLongerUsed' WHERE id IN (10, 11);

-- groups table: required by AuthUtils.getAuthGroupForUser — without this login fails
INSERT IGNORE INTO `groups` (name, user) VALUES ('Default', 'sarah.chen'), ('Default', 'marcus.rivera');

-- ACL: assign both providers to the Physicians group so they appear in dropdowns
INSERT IGNORE INTO gacl_aro (id, section_value, value, order_value, name, hidden)
VALUES
(17, 'users', 'sarah.chen',    0, 'Sarah Chen',    0),
(18, 'users', 'marcus.rivera', 0, 'Marcus Rivera', 0);

INSERT IGNORE INTO gacl_groups_aro_map (group_id, aro_id)
VALUES
(13, 17),
(13, 18);

-- =============================================================================
-- UPDATE EXISTING PATIENTS — assign to Dr. Chen, enrich demographics
-- =============================================================================

UPDATE patient_data SET providerID = 10, city = 'Austin', state = 'TX',
    postal_code = '78701', phone_home = '512-555-0101'
WHERE pid = 1; -- Phil Belford

UPDATE patient_data SET providerID = 10, city = 'Austin', state = 'TX',
    postal_code = '78702', phone_home = '512-555-0102'
WHERE pid = 2; -- Susan Underwood

UPDATE patient_data SET providerID = 10, city = 'Austin', state = 'TX',
    postal_code = '78703', phone_home = '512-555-0103'
WHERE pid = 3; -- Wanda Moore

-- =============================================================================
-- DR. CHEN'S PATIENTS (PIDs 4–13)
-- =============================================================================

INSERT INTO patient_data (pid, uuid, fname, lname, DOB, sex, providerID,
    street, city, state, postal_code, phone_home, status, regdate)
VALUES
(4,  UNHEX(REPLACE(UUID(),'-','')), 'Marcus',    'Johnson',   '1979-08-14', 'Male',   10, '412 Oak St',      'Austin', 'TX', '78704', '512-555-0104', 'active', '2022-03-10'),
(5,  UNHEX(REPLACE(UUID(),'-','')), 'Elena',     'Rodriguez', '1962-11-30', 'Female', 10, '889 Maple Ave',   'Austin', 'TX', '78705', '512-555-0105', 'active', '2021-07-22'),
(6,  UNHEX(REPLACE(UUID(),'-','')), 'James',     'Park',      '1986-04-03', 'Male',   10, '231 Pine Rd',     'Austin', 'TX', '78706', '512-555-0106', 'active', '2023-01-15'),
(7,  UNHEX(REPLACE(UUID(),'-','')), 'Patricia',  'Williams',  '1953-01-19', 'Female', 10, '55 Elm Court',    'Austin', 'TX', '78707', '512-555-0107', 'active', '2020-09-04'),
(8,  UNHEX(REPLACE(UUID(),'-','')), 'David',     'Kim',       '1972-06-27', 'Male',   10, '734 Cedar Blvd',  'Austin', 'TX', '78708', '512-555-0108', 'active', '2022-11-08'),
(9,  UNHEX(REPLACE(UUID(),'-','')), 'Sarah',     'Torres',    '1995-02-11', 'Female', 10, '19 Willow Ln',    'Austin', 'TX', '78709', '512-555-0109', 'active', '2024-08-20'),
(10, UNHEX(REPLACE(UUID(),'-','')), 'Robert',    'Chen',      '1957-09-05', 'Male',   10, '600 Birch Way',   'Austin', 'TX', '78710', '512-555-0110', 'active', '2021-02-14'),
(11, UNHEX(REPLACE(UUID(),'-','')), 'Jennifer',  'Walsh',     '1980-12-22', 'Female', 10, '88 Spruce Dr',    'Austin', 'TX', '78711', '512-555-0111', 'active', '2022-06-30'),
(12, UNHEX(REPLACE(UUID(),'-','')), 'Michael',   'Thompson',  '1966-03-17', 'Male',   10, '345 Aspen Ct',    'Austin', 'TX', '78712', '512-555-0112', 'active', '2020-04-19'),
(13, UNHEX(REPLACE(UUID(),'-','')), 'Aisha',     'Williams',  '1991-07-08', 'Female', 10, '77 Redwood Pl',   'Austin', 'TX', '78713', '512-555-0113', 'active', '2023-05-02');

-- =============================================================================
-- OTHER PROVIDERS' PATIENTS (PIDs 14–18) — Dr. Rivera
-- These should NOT surface in Dr. Chen's agent responses
-- =============================================================================

INSERT INTO patient_data (pid, uuid, fname, lname, DOB, sex, providerID,
    street, city, state, postal_code, phone_home, status, regdate)
VALUES
(14, UNHEX(REPLACE(UUID(),'-','')), 'Carlos',  'Mendez',   '1969-05-23', 'Male',   11, '102 Rivera Rd',   'Austin', 'TX', '78720', '512-555-0201', 'active', '2021-03-11'),
(15, UNHEX(REPLACE(UUID(),'-','')), 'Anna',    'Kowalski', '1976-08-14', 'Female', 11, '204 Rivera Rd',   'Austin', 'TX', '78720', '512-555-0202', 'active', '2022-01-05'),
(16, UNHEX(REPLACE(UUID(),'-','')), 'Thomas',  'Brown',    '1961-02-28', 'Male',   11, '306 Rivera Rd',   'Austin', 'TX', '78720', '512-555-0203', 'active', '2020-11-17'),
(17, UNHEX(REPLACE(UUID(),'-','')), 'Lisa',    'Chang',    '1983-10-09', 'Female', 11, '408 Rivera Rd',   'Austin', 'TX', '78720', '512-555-0204', 'active', '2023-07-29'),
(18, UNHEX(REPLACE(UUID(),'-','')), 'Kevin',   'OBrien',   '1952-04-16', 'Male',   11, '510 Rivera Rd',   'Austin', 'TX', '78720', '512-555-0205', 'active', '2021-09-13');

-- =============================================================================
-- ENCOUNTERS — Dr. Chen's patients
-- =============================================================================

INSERT INTO form_encounter (id, date, reason, pid, encounter, provider_id, facility_id, pc_catid)
VALUES
-- Phil Belford (pid=1): HTN follow-ups
(100, '2025-01-08 09:00:00', 'Hypertension follow-up',          1,  100, 10, 3, 5),
(101, '2025-07-15 09:30:00', 'Hypertension + A1C check',        1,  101, 10, 3, 5),
(102, '2026-01-20 10:00:00', 'Hypertension - BP poorly controlled', 1, 102, 10, 3, 5),

-- Susan Underwood (pid=2): Wellness + diabetes management
(103, '2024-11-05 08:00:00', 'Annual wellness exam',             2,  103, 10, 3, 9),
(104, '2025-05-14 09:00:00', 'Diabetes management',              2,  104, 10, 3, 5),
(105, '2025-11-20 09:00:00', 'Diabetes + cholesterol follow-up', 2,  105, 10, 3, 5),

-- Wanda Moore (pid=3): Anxiety, last visit 14 months ago
(106, '2024-08-12 14:00:00', 'Anxiety - initial evaluation',     3,  106, 10, 3, 5),
(107, '2025-02-03 10:00:00', 'Sertraline follow-up + OB/GYN referral', 3, 107, 10, 3, 5),

-- Marcus Johnson (pid=4): T2DM + HTN
(108, '2024-10-01 09:00:00', 'Diabetes management',              4,  108, 10, 3, 5),
(109, '2025-04-10 09:30:00', 'Diabetes - A1C worsening',         4,  109, 10, 3, 5),
(110, '2025-10-22 09:00:00', 'Diabetes + HTN quarterly review',  4,  110, 10, 3, 5),
(111, '2026-01-15 10:00:00', 'Diabetes - medication adjustment',  4,  111, 10, 3, 5),

-- Elena Rodriguez (pid=5): HTN + hyperlipidemia
(112, '2024-09-18 11:00:00', 'Hypertension follow-up',           5,  112, 10, 3, 5),
(113, '2025-03-05 11:30:00', 'Lipid panel review',               5,  113, 10, 3, 5),
(114, '2025-09-11 10:00:00', 'HTN + osteoporosis screening',     5,  114, 10, 3, 5),

-- James Park (pid=6): Asthma + anxiety
(115, '2025-02-20 13:00:00', 'Asthma follow-up',                 6,  115, 10, 3, 5),
(116, '2025-08-07 13:30:00', 'Anxiety - medication check',       6,  116, 10, 3, 5),
(117, '2026-02-14 14:00:00', 'Asthma exacerbation',              6,  117, 10, 3, 5),

-- Patricia Williams (pid=7): Complex geriatric
(118, '2024-08-29 08:30:00', 'Quarterly chronic disease review', 7,  118, 10, 3, 5),
(119, '2025-02-19 08:30:00', 'Quarterly review + A-fib check',   7,  119, 10, 3, 5),
(120, '2025-08-28 08:30:00', 'Quarterly review - warfarin INR',  7,  120, 10, 3, 5),
(121, '2026-02-26 09:00:00', 'Quarterly review - BP elevated',   7,  121, 10, 3, 5),

-- David Kim (pid=8): Pre-diabetes
(122, '2025-01-30 10:30:00', 'Pre-diabetes evaluation',          8,  122, 10, 3, 5),
(123, '2025-07-24 10:30:00', 'Pre-diabetes follow-up + weight',  8,  123, 10, 3, 5),

-- Sarah Torres (pid=9): Postpartum depression — last visit 14 months ago
(124, '2024-10-14 15:00:00', 'Postpartum depression - initial',  9,  124, 10, 3, 5),
(125, '2025-02-18 15:30:00', 'Sertraline follow-up',             9,  125, 10, 3, 5),

-- Robert Chen (pid=10): COPD
(126, '2024-11-12 09:00:00', 'COPD management',                  10, 126, 10, 3, 5),
(127, '2025-05-08 09:30:00', 'COPD - spirometry review',         10, 127, 10, 3, 5),
(128, '2025-12-03 09:00:00', 'COPD exacerbation follow-up',      10, 128, 10, 3, 5),

-- Jennifer Walsh (pid=11): Migraine + hypothyroidism
(129, '2025-03-11 14:00:00', 'Hypothyroid follow-up - TSH check', 11, 129, 10, 3, 5),
(130, '2025-09-23 14:30:00', 'Migraine - frequency increasing',   11, 130, 10, 3, 5),

-- Michael Thompson (pid=12): CAD + DM + HTN
(131, '2024-10-08 08:00:00', 'CAD quarterly review',             12, 131, 10, 3, 5),
(132, '2025-01-14 08:30:00', 'Diabetes management + echo result', 12, 132, 10, 3, 5),
(133, '2025-04-22 08:00:00', 'Post-cath follow-up',              12, 133, 10, 3, 5),
(134, '2025-10-07 08:30:00', 'CAD annual review',                12, 134, 10, 3, 5),

-- Aisha Williams (pid=13): Lupus
(135, '2025-01-09 11:00:00', 'Lupus primary care co-management', 13, 135, 10, 3, 5),
(136, '2025-07-17 11:30:00', 'Hydroxychloroquine monitoring',    13, 136, 10, 3, 5);

-- =============================================================================
-- SOAP NOTES
-- =============================================================================

INSERT INTO form_soap (date, pid, user, groupname, authorized, activity, subjective, objective, assessment, plan)
VALUES
-- Phil Belford last encounter (2026-01-20)
('2026-01-20 10:00:00', 1, 'sarah.chen', 'Default', 1, 1,
 'Patient reports headaches, no chest pain or dyspnea. Reports taking Norvasc and Lisinopril as prescribed.',
 'BP 152/94, HR 78, Weight 198 lbs. No edema. Clear lungs.',
 'Hypertension — inadequately controlled. A1C 8.2 (up from 7.4 six months ago).',
 'Increase Lisinopril to 20mg. Recheck BP in 6 weeks. Recheck A1C in 3 months. Referred to diabetes educator.'),

-- Susan Underwood last encounter (2025-11-20)
('2025-11-20 09:00:00', 2, 'sarah.chen', 'Default', 1, 1,
 'Patient here for diabetes follow-up. Denies hypoglycemic episodes. Diet compliance inconsistent.',
 'BP 128/82, HR 72, Weight 164 lbs. A1C 7.1 today.',
 'Type 2 diabetes — improved but not at goal. Hyperlipidemia — LDL 118.',
 'Continue Metformin 1000mg BID. Increase Lipitor to 40mg. Annual wellness overdue — schedule mammogram. Flu vaccine given today.'),

-- Marcus Johnson last encounter (2026-01-15)
('2026-01-15 10:00:00', 4, 'sarah.chen', 'Default', 1, 1,
 'Patient reports fatigue, increased thirst and urination over past 2 months. BP medications taken consistently.',
 'BP 148/90, HR 80, Weight 224 lbs (up 8 lbs from last visit). A1C 9.1.',
 'T2DM — poorly controlled, A1C worsening trend. Hypertension — suboptimal.',
 'Add Jardiance 10mg QD. Increase Lisinopril to 20mg. Dietary counseling referral. Return in 6 weeks.'),

-- Patricia Williams last encounter (2026-02-26)
('2026-02-26 09:00:00', 7, 'sarah.chen', 'Default', 1, 1,
 'Patient reports some ankle swelling and occasional palpitations. INR last checked 6 weeks ago at 2.4.',
 'BP 162/88 (elevated), HR 82 irregular, Weight 171 lbs. Trace pedal edema bilateral.',
 'Hypertension — not at goal. Atrial fibrillation — rate controlled, anticoagulation therapeutic. Mild fluid retention.',
 'Increase amlodipine to 10mg. Check BMP and repeat INR. Reduce sodium intake. Return in 4 weeks.'),

-- Robert Chen last encounter (2025-12-03)
('2025-12-03 09:00:00', 10, 'sarah.chen', 'Default', 1, 1,
 'Patient recovered from COPD exacerbation 3 weeks ago. Reports improved breathing but still more short of breath than baseline on exertion. Quit smoking 4 years ago.',
 'O2 sat 94% on room air, RR 18. Diffuse expiratory wheeze. FEV1 58% predicted on spirometry.',
 'COPD — GOLD stage 2, post-exacerbation. Pulmonology follow-up scheduled.',
 'Continue tiotropium and albuterol PRN. Add budesonide/formoterol inhaler. Pulmonary rehab referral. Flu and pneumococcal vaccines up to date.');

-- =============================================================================
-- PRESCRIPTIONS — Dr. Chen's patients
-- =============================================================================

INSERT INTO prescriptions (id, patient_id, provider_id, encounter, drug, drug_id,
    rxnorm_drugcode, dosage, quantity, start_date, end_date, refills, active, note,
    txDate, usage_category_title, request_intent_title, uuid)
VALUES
-- Phil Belford (pid=1)
(20, 1, 10, 102, 'Norvasc (amlodipine)', 0, '17767',   '5mg QD',   30, '2025-01-08', NULL, 11, 1, 'HTN',                              '2025-01-08', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(21, 1, 10, 102, 'Lisinopril',           0, '29046',   '20mg QD',  30, '2026-01-20', NULL, 11, 1, 'HTN - increased from 10mg',         '2026-01-20', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- Susan Underwood (pid=2)
(22, 2, 10, 105, 'Metformin',            0, '6809',    '1000mg BID', 60, '2024-11-05', NULL, 11, 1, 'T2DM',                             '2024-11-05', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(23, 2, 10, 105, 'Lipitor (atorvastatin)',0, '83367',  '40mg QD',  30, '2025-11-20', NULL, 11, 1, 'Hyperlipidemia - increased dose',    '2025-11-20', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(24, 2, 10, 105, 'Lisinopril',           0, '29046',   '10mg QD',  30, '2024-11-05', NULL, 11, 1, 'HTN + diabetic nephroprotection',    '2024-11-05', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- Marcus Johnson (pid=4)
(25, 4, 10, 111, 'Metformin',            0, '6809',    '1000mg BID', 60, '2024-10-01', NULL, 11, 1, 'T2DM',                             '2024-10-01', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(26, 4, 10, 111, 'Lisinopril',           0, '29046',   '20mg QD',  30, '2026-01-15', NULL, 11, 1, 'HTN',                              '2026-01-15', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(27, 4, 10, 111, 'Jardiance (empagliflozin)', 0, '1656338', '10mg QD', 30, '2026-01-15', NULL, 5, 1, 'T2DM - added for glycemic control','2026-01-15', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- Elena Rodriguez (pid=5)
(28, 5, 10, 114, 'Amlodipine',           0, '17767',   '10mg QD',  30, '2024-09-18', NULL, 11, 1, 'HTN',                              '2024-09-18', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(29, 5, 10, 114, 'Hydrochlorothiazide',  0, '33770',   '25mg QD',  30, '2024-09-18', NULL, 11, 1, 'HTN',                              '2024-09-18', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(30, 5, 10, 114, 'Atorvastatin',         0, '83367',   '40mg QD',  30, '2025-03-05', NULL, 11, 1, 'Hyperlipidemia',                   '2025-03-05', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(31, 5, 10, 114, 'Alendronate',          0, '41493',   '70mg weekly', 4, '2025-09-11', NULL, 11, 1, 'Osteoporosis',                    '2025-09-11', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- James Park (pid=6)
(32, 6, 10, 117, 'Albuterol inhaler',    0, '435',     '2 puffs PRN', 1, '2025-02-20', NULL, 5,  1, 'Asthma rescue',                    '2025-02-20', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(33, 6, 10, 117, 'Fluticasone inhaler',  0, '351371',  '110mcg BID',  1, '2026-02-14', NULL, 5,  1, 'Asthma controller',                '2026-02-14', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(34, 6, 10, 116, 'Sertraline',           0, '36437',   '50mg QD',   30, '2025-08-07', NULL, 11, 1, 'Anxiety',                          '2025-08-07', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- Patricia Williams (pid=7)
(35, 7, 10, 121, 'Amlodipine',           0, '17767',   '10mg QD',  30, '2024-08-29', NULL, 11, 1, 'HTN',                              '2024-08-29', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(36, 7, 10, 121, 'Metoprolol succinate', 0, '866514',  '50mg QD',  30, '2024-08-29', NULL, 11, 1, 'A-fib rate control',               '2024-08-29', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(37, 7, 10, 121, 'Warfarin',             0, '11289',   '5mg QD',   30, '2024-08-29', NULL, 11, 1, 'A-fib anticoagulation INR 2-3',     '2024-08-29', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(38, 7, 10, 121, 'Metformin',            0, '6809',    '500mg BID',60, '2024-08-29', NULL, 11, 1, 'T2DM',                             '2024-08-29', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(39, 7, 10, 121, 'Levothyroxine',        0, '10582',   '75mcg QD', 30, '2020-09-04', NULL, 11, 1, 'Hypothyroidism',                   '2020-09-04', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- David Kim (pid=8)
(40, 8, 10, 123, 'Metformin',            0, '6809',    '500mg QD', 30, '2025-07-24', NULL, 11, 1, 'Pre-diabetes',                     '2025-07-24', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(41, 8, 10, 123, 'Rosuvastatin',         0, '301542',  '10mg QD',  30, '2025-01-30', NULL, 11, 1, 'Hyperlipidemia',                   '2025-01-30', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- Sarah Torres (pid=9)
(42, 9, 10, 125, 'Sertraline',           0, '36437',   '50mg QD',  30, '2024-10-14', NULL, 11, 1, 'Postpartum depression',            '2024-10-14', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- Robert Chen (pid=10)
(43, 10, 10, 128, 'Tiotropium inhaler',  0, '274783',  '18mcg QD',  1, '2024-11-12', NULL, 3,  1, 'COPD maintenance',                 '2024-11-12', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(44, 10, 10, 128, 'Albuterol inhaler',   0, '435',     '2 puffs PRN',1,'2024-11-12', NULL, 5,  1, 'COPD rescue',                      '2024-11-12', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(45, 10, 10, 128, 'Budesonide/formoterol',0,'896209',  '160/4.5mcg BID',1,'2025-12-03',NULL,5, 1, 'COPD post-exacerbation',           '2025-12-03', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- Jennifer Walsh (pid=11)
(46, 11, 10, 130, 'Levothyroxine',       0, '10582',   '100mcg QD',30, '2022-06-30', NULL, 11, 1, 'Hypothyroidism',                   '2022-06-30', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(47, 11, 10, 130, 'Sumatriptan',         0, '41493',   '50mg PRN',  9, '2025-09-23', NULL, 3,  1, 'Migraine abortive',                '2025-09-23', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(48, 11, 10, 130, 'Propranolol',         0, '8787',    '40mg BID', 60, '2025-09-23', NULL, 5,  1, 'Migraine prophylaxis',             '2025-09-23', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- Michael Thompson (pid=12)
(49, 12, 10, 134, 'Aspirin',             0, '1191',    '81mg QD',  30, '2020-04-19', NULL, 11, 1, 'CAD secondary prevention',         '2020-04-19', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(50, 12, 10, 134, 'Metoprolol succinate',0, '866514',  '100mg QD', 30, '2020-04-19', NULL, 11, 1, 'CAD + HTN',                        '2020-04-19', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(51, 12, 10, 134, 'Lisinopril',          0, '29046',   '40mg QD',  30, '2020-04-19', NULL, 11, 1, 'CAD + HTN + DM',                   '2020-04-19', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(52, 12, 10, 134, 'Atorvastatin',        0, '83367',   '80mg QD',  30, '2020-04-19', NULL, 11, 1, 'CAD high intensity statin',        '2020-04-19', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(53, 12, 10, 134, 'Metformin',           0, '6809',    '1000mg BID',60,'2020-04-19', NULL, 11, 1, 'T2DM',                             '2020-04-19', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(54, 12, 10, 134, 'Nitroglycerin SL',    0, '4917',    '0.4mg PRN', 25,'2020-04-19', NULL, 3,  1, 'CAD PRN chest pain',               '2020-04-19', '', '', UNHEX(REPLACE(UUID(),'-',''))),

-- Aisha Williams (pid=13)
(55, 13, 10, 136, 'Hydroxychloroquine',  0, '5521',    '400mg QD', 30, '2023-05-02', NULL, 11, 1, 'Lupus per rheumatology',           '2023-05-02', '', '', UNHEX(REPLACE(UUID(),'-',''))),
(56, 13, 10, 136, 'Vitamin D3',          0, '11253',   '2000 IU QD',30,'2023-05-02', NULL, 11, 1, 'Lupus supplementation',            '2023-05-02', '', '', UNHEX(REPLACE(UUID(),'-','')));

-- =============================================================================
-- PROBLEMS / ALLERGIES (lists table)
-- =============================================================================

INSERT INTO lists (pid, type, title, begdate, enddate, activity, diagnosis, verification)
VALUES
-- Phil Belford
(1, 'medical_problem', 'Essential hypertension',     '2022-03-01', NULL, 1, 'I10',    'confirmed'),
(1, 'medical_problem', 'Type 2 diabetes mellitus',   '2023-06-01', NULL, 1, 'E11.9',  'confirmed'),
(1, 'allergy',         'Penicillin',                 '2022-03-01', NULL, 1, '',       'confirmed'),

-- Susan Underwood
(2, 'medical_problem', 'Type 2 diabetes mellitus',   '2021-07-01', NULL, 1, 'E11.9',  'confirmed'),
(2, 'medical_problem', 'Hypertension',               '2021-07-01', NULL, 1, 'I10',    'confirmed'),
(2, 'medical_problem', 'Hyperlipidemia',             '2021-07-01', NULL, 1, 'E78.5',  'confirmed'),
(2, 'allergy',         'Sulfa drugs',                '2021-07-01', NULL, 1, '',       'confirmed'),

-- Wanda Moore
(3, 'medical_problem', 'Generalized anxiety disorder','2024-08-01',NULL, 1, 'F41.1',  'confirmed'),
(3, 'medical_problem', 'Irregular menstrual cycle',  '2024-08-01', NULL, 1, 'N91.2',  'confirmed'),

-- Marcus Johnson
(4, 'medical_problem', 'Type 2 diabetes mellitus',   '2024-10-01', NULL, 1, 'E11.9',  'confirmed'),
(4, 'medical_problem', 'Essential hypertension',     '2024-10-01', NULL, 1, 'I10',    'confirmed'),
(4, 'medical_problem', 'Obesity',                    '2024-10-01', NULL, 1, 'E66.9',  'confirmed'),
(4, 'allergy',         'Codeine',                    '2024-10-01', NULL, 1, '',       'confirmed'),

-- Elena Rodriguez
(5, 'medical_problem', 'Essential hypertension',     '2021-07-01', NULL, 1, 'I10',    'confirmed'),
(5, 'medical_problem', 'Hyperlipidemia',             '2021-07-01', NULL, 1, 'E78.5',  'confirmed'),
(5, 'medical_problem', 'Osteoporosis',               '2025-09-01', NULL, 1, 'M81.0',  'confirmed'),
(5, 'allergy',         'NKDA',                       '2021-07-01', NULL, 1, '',       'confirmed'),

-- James Park
(6, 'medical_problem', 'Asthma, mild persistent',    '2023-01-01', NULL, 1, 'J45.30', 'confirmed'),
(6, 'medical_problem', 'Generalized anxiety disorder','2025-08-01',NULL, 1, 'F41.1',  'confirmed'),
(6, 'allergy',         'Aspirin',                    '2023-01-01', NULL, 1, '',       'confirmed'),

-- Patricia Williams
(7, 'medical_problem', 'Hypertension',               '2020-09-01', NULL, 1, 'I10',    'confirmed'),
(7, 'medical_problem', 'Atrial fibrillation',        '2020-09-01', NULL, 1, 'I48.91', 'confirmed'),
(7, 'medical_problem', 'Type 2 diabetes mellitus',   '2020-09-01', NULL, 1, 'E11.9',  'confirmed'),
(7, 'medical_problem', 'Hypothyroidism',             '2020-09-01', NULL, 1, 'E03.9',  'confirmed'),
(7, 'allergy',         'Penicillin',                 '2020-09-01', NULL, 1, '',       'confirmed'),
(7, 'allergy',         'NSAIDs',                     '2020-09-01', NULL, 1, '',       'confirmed'),

-- David Kim
(8, 'medical_problem', 'Prediabetes',                '2025-01-01', NULL, 1, 'R73.09', 'confirmed'),
(8, 'medical_problem', 'Hyperlipidemia',             '2025-01-01', NULL, 1, 'E78.5',  'confirmed'),
(8, 'medical_problem', 'Overweight',                 '2025-01-01', NULL, 1, 'E66.9',  'confirmed'),

-- Sarah Torres
(9, 'medical_problem', 'Postpartum depression',      '2024-10-01', NULL, 1, 'F53.0',  'confirmed'),

-- Robert Chen
(10,'medical_problem', 'COPD, moderate',             '2021-02-01', NULL, 1, 'J44.1',  'confirmed'),
(10,'medical_problem', 'Former tobacco user',        '2021-02-01', NULL, 1, 'Z87.891','confirmed'),
(10,'allergy',         'Aspirin',                    '2021-02-01', NULL, 1, '',       'confirmed'),

-- Jennifer Walsh
(11,'medical_problem', 'Migraine without aura',      '2022-06-01', NULL, 1, 'G43.009','confirmed'),
(11,'medical_problem', 'Hypothyroidism',             '2022-06-01', NULL, 1, 'E03.9',  'confirmed'),

-- Michael Thompson
(12,'medical_problem', 'Coronary artery disease',    '2020-04-01', NULL, 1, 'I25.10', 'confirmed'),
(12,'medical_problem', 'Type 2 diabetes mellitus',   '2020-04-01', NULL, 1, 'E11.9',  'confirmed'),
(12,'medical_problem', 'Hypertension',               '2020-04-01', NULL, 1, 'I10',    'confirmed'),
(12,'allergy',         'Clopidogrel',                '2020-04-01', NULL, 1, '',       'confirmed'),

-- Aisha Williams
(13,'medical_problem', 'Systemic lupus erythematosus','2023-05-01',NULL, 1, 'M32.9',  'confirmed');

-- =============================================================================
-- LAB RESULTS (procedure_order → procedure_report → procedure_result)
-- =============================================================================

-- Phil Belford: A1C trend
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES (200, 10, 1, 100, '2025-01-08', 'complete', 1),
       (201, 10, 1, 101, '2025-07-15', 'complete', 1),
       (202, 10, 1, 102, '2026-01-20', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES (200, 200, '2025-01-10', 'final'),
       (201, 201, '2025-07-17', 'final'),
       (202, 202, '2026-01-22', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES (200, '4548-4', 'Hemoglobin A1c',  '7.4', '%', '4.0-5.6', 'H', 'final', '2025-01-10'),
       (201, '4548-4', 'Hemoglobin A1c',  '7.8', '%', '4.0-5.6', 'H', 'final', '2025-07-17'),
       (202, '4548-4', 'Hemoglobin A1c',  '8.2', '%', '4.0-5.6', 'H', 'final', '2026-01-22');

-- Susan Underwood: A1C + LDL trend
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES (203, 10, 2, 103, '2024-11-05', 'complete', 1),
       (204, 10, 2, 104, '2025-05-14', 'complete', 1),
       (205, 10, 2, 105, '2025-11-20', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES (203, 203, '2024-11-07', 'final'),
       (204, 204, '2025-05-16', 'final'),
       (205, 205, '2025-11-22', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES (203, '4548-4', 'Hemoglobin A1c',  '7.9', '%',    '4.0-5.6', 'H', 'final', '2024-11-07'),
       (203, '2089-1', 'LDL Cholesterol', '142', 'mg/dL','<100',    'H', 'final', '2024-11-07'),
       (204, '4548-4', 'Hemoglobin A1c',  '7.4', '%',    '4.0-5.6', 'H', 'final', '2025-05-16'),
       (204, '2089-1', 'LDL Cholesterol', '128', 'mg/dL','<100',    'H', 'final', '2025-05-16'),
       (205, '4548-4', 'Hemoglobin A1c',  '7.1', '%',    '4.0-5.6', 'H', 'final', '2025-11-22'),
       (205, '2089-1', 'LDL Cholesterol', '118', 'mg/dL','<100',    'H', 'final', '2025-11-22');

-- Marcus Johnson: A1C + BMP trend (worsening DM)
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES (206, 10, 4, 108, '2024-10-01', 'complete', 1),
       (207, 10, 4, 109, '2025-04-10', 'complete', 1),
       (208, 10, 4, 110, '2025-10-22', 'complete', 1),
       (209, 10, 4, 111, '2026-01-15', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES (206, 206, '2024-10-03', 'final'),
       (207, 207, '2025-04-12', 'final'),
       (208, 208, '2025-10-24', 'final'),
       (209, 209, '2026-01-17', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES (206, '4548-4', 'Hemoglobin A1c',  '7.8', '%', '4.0-5.6', 'H', 'final', '2024-10-03'),
       (207, '4548-4', 'Hemoglobin A1c',  '8.1', '%', '4.0-5.6', 'H', 'final', '2025-04-12'),
       (208, '4548-4', 'Hemoglobin A1c',  '8.6', '%', '4.0-5.6', 'H', 'final', '2025-10-24'),
       (209, '4548-4', 'Hemoglobin A1c',  '9.1', '%', '4.0-5.6', 'H', 'final', '2026-01-17'),
       (209, '2160-0', 'Creatinine',      '1.1', 'mg/dL', '0.7-1.3', 'N', 'final', '2026-01-17'),
       (209, '2823-3', 'Potassium',       '4.2', 'mEq/L', '3.5-5.1', 'N', 'final', '2026-01-17');

-- Patricia Williams: INR monitoring
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES (210, 10, 7, 118, '2024-08-29', 'complete', 1),
       (211, 10, 7, 119, '2025-02-19', 'complete', 1),
       (212, 10, 7, 120, '2025-08-28', 'complete', 1),
       (213, 10, 7, 121, '2026-02-26', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES (210, 210, '2024-08-29', 'final'),
       (211, 211, '2025-02-19', 'final'),
       (212, 212, '2025-08-28', 'final'),
       (213, 213, '2026-02-26', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES (210, '5902-2', 'INR', '2.1', 'ratio', '2.0-3.0', 'N', 'final', '2024-08-29'),
       (210, '4548-4', 'Hemoglobin A1c', '7.2', '%', '4.0-5.6', 'H', 'final', '2024-08-29'),
       (211, '5902-2', 'INR', '2.8', 'ratio', '2.0-3.0', 'N', 'final', '2025-02-19'),
       (212, '5902-2', 'INR', '2.4', 'ratio', '2.0-3.0', 'N', 'final', '2025-08-28'),
       (213, '5902-2', 'INR', '2.6', 'ratio', '2.0-3.0', 'N', 'final', '2026-02-26'),
       (213, '4548-4', 'Hemoglobin A1c', '7.5', '%', '4.0-5.6', 'H', 'final', '2026-02-26');

-- Jennifer Walsh: TSH
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES (214, 10, 11, 129, '2025-03-11', 'complete', 1),
       (215, 10, 11, 130, '2025-09-23', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES (214, 214, '2025-03-13', 'final'),
       (215, 215, '2025-09-25', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES (214, '3016-3', 'TSH', '3.2', 'mIU/L', '0.4-4.0', 'N', 'final', '2025-03-13'),
       (215, '3016-3', 'TSH', '2.8', 'mIU/L', '0.4-4.0', 'N', 'final', '2025-09-25');

-- David Kim: fasting glucose trend
INSERT INTO procedure_order (procedure_order_id, provider_id, patient_id, encounter_id, date_ordered, order_status, activity)
VALUES (216, 10, 8, 122, '2025-01-30', 'complete', 1),
       (217, 10, 8, 123, '2025-07-24', 'complete', 1);

INSERT INTO procedure_report (procedure_report_id, procedure_order_id, date_report, report_status)
VALUES (216, 216, '2025-02-01', 'final'),
       (217, 217, '2025-07-26', 'final');

INSERT INTO procedure_result (procedure_report_id, result_code, result_text, result, units, `range`, abnormal, result_status, date)
VALUES (216, '14771-0', 'Fasting glucose', '118', 'mg/dL', '70-99', 'H', 'final', '2025-02-01'),
       (216, '4548-4',  'Hemoglobin A1c',  '5.9', '%',     '4.0-5.6','H','final', '2025-02-01'),
       (217, '14771-0', 'Fasting glucose', '124', 'mg/dL', '70-99', 'H', 'final', '2025-07-26'),
       (217, '4548-4',  'Hemoglobin A1c',  '6.1', '%',     '4.0-5.6','H','final', '2025-07-26');

-- =============================================================================
-- TODAY'S APPOINTMENTS (2026-04-27) — Dr. Sarah Chen's schedule
-- UC-1: Brief me on my next patient / UC-5: What do I need to know today
-- =============================================================================

INSERT INTO openemr_postcalendar_events
    (pc_catid, pc_aid, pc_pid, pc_title, pc_time, pc_hometext,
     pc_eventDate, pc_startTime, pc_endTime, pc_duration, pc_alldayevent,
     pc_apptstatus, pc_prefcatid, pc_multiple, pc_sharing, pc_facility, pc_eventstatus)
VALUES
(5, '10', '4',  'Diabetes follow-up',         '2026-04-27 09:00:00', 'A1C recheck post-Jardiance addition',   '2026-04-27', '09:00:00', '09:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '7',  'Quarterly chronic review',   '2026-04-27 09:30:00', 'BP elevated at last visit; BMP + INR',  '2026-04-27', '09:30:00', '09:50:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '1',  'Hypertension follow-up',     '2026-04-27 10:00:00', 'BP recheck 6 wks post Lisinopril uptitration', '2026-04-27', '10:00:00', '10:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '11', 'Migraine management',        '2026-04-27 10:30:00', 'Propranolol efficacy check',            '2026-04-27', '10:30:00', '10:50:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '6',  'Asthma medication check',    '2026-04-27 11:00:00', 'Follow-up after fluticasone addition',  '2026-04-27', '11:00:00', '11:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(9, '10', '2',  'Annual wellness exam',       '2026-04-27 11:30:00', 'Overdue mammogram referral follow-up',  '2026-04-27', '11:30:00', '12:00:00', 1800, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '3',  'Medication check',           '2026-04-27 13:00:00', 'Sertraline - has not been seen in 14 months', '2026-04-27', '13:00:00', '13:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '5',  'Hypertension follow-up',     '2026-04-27 13:30:00', 'BP + lipid review',                    '2026-04-27', '13:30:00', '13:50:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '12', 'CAD quarterly review',       '2026-04-27 14:00:00', 'Annual review; stress test result',     '2026-04-27', '14:00:00', '14:20:00', 1200, 0, '@', 0, 0, 1, 3, 1),
(5, '10', '8',  'Pre-diabetes check-in',      '2026-04-27 14:30:00', 'Weight and glucose recheck',            '2026-04-27', '14:30:00', '14:50:00', 1200, 0, '@', 0, 0, 1, 3, 1);

SET FOREIGN_KEY_CHECKS = 1;
