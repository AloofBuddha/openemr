-- =============================================================================
-- Clinical Co-Pilot Demo Augmentation #3
-- =============================================================================
-- Run AFTER demo_augment2.sql. Fixes:
--   1. procedure_order_code missing — Labs card shows "No lab data documented"
--      without a row here per procedure_order, the JOIN returns nothing.
--   2. Earlier encounters have no SOAP notes — adds brief but realistic
--      SOAP notes for all encounters that were missing them.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- =============================================================================
-- 1. PROCEDURE_ORDER_CODE — one row per procedure_order
-- =============================================================================
-- Columns used: procedure_order_id, procedure_order_seq, procedure_code,
--               procedure_name, procedure_source ('1' = manual)
INSERT INTO procedure_order_code
    (procedure_order_id, procedure_order_seq, procedure_code, procedure_name, procedure_source)
VALUES
-- Phil Belford A1C x3 (200-202)
(200, 1, '4548-4',  'Hemoglobin A1c',           '1'),
(201, 1, '4548-4',  'Hemoglobin A1c',           '1'),
(202, 1, '4548-4',  'Hemoglobin A1c',           '1'),
-- Susan Underwood metabolic panel x3 (203-205)
(203, 1, '4548-4',  'Hemoglobin A1c / Lipid Panel', '1'),
(204, 1, '4548-4',  'Hemoglobin A1c / Lipid Panel', '1'),
(205, 1, '4548-4',  'Hemoglobin A1c / Lipid Panel', '1'),
-- Marcus Johnson A1C + BMP x4 (206-209)
(206, 1, '4548-4',  'Hemoglobin A1c',           '1'),
(207, 1, '4548-4',  'Hemoglobin A1c',           '1'),
(208, 1, '4548-4',  'Hemoglobin A1c',           '1'),
(209, 1, '4548-4',  'Hemoglobin A1c / BMP',     '1'),
-- Patricia Williams INR x4 (210-213)
(210, 1, '5902-2',  'INR / Hemoglobin A1c',     '1'),
(211, 1, '5902-2',  'INR',                      '1'),
(212, 1, '5902-2',  'INR',                      '1'),
(213, 1, '5902-2',  'INR / Hemoglobin A1c',     '1'),
-- Jennifer Walsh TSH x2 (214-215)
(214, 1, '3016-3',  'TSH',                      '1'),
(215, 1, '3016-3',  'TSH',                      '1'),
-- David Kim glucose + A1C x2 (216-217)
(216, 1, '14771-0', 'Fasting Glucose / A1c',    '1'),
(217, 1, '14771-0', 'Fasting Glucose / A1c',    '1'),
-- Michael Thompson A1C + lipid + BMP x4 (218-221)
(218, 1, '4548-4',  'Hemoglobin A1c / Lipid Panel / BMP', '1'),
(219, 1, '4548-4',  'Hemoglobin A1c',           '1'),
(220, 1, '2089-1',  'Lipid Panel',              '1'),
(221, 1, '4548-4',  'Hemoglobin A1c / BMP',     '1'),
-- Aisha Williams CBC + CMP x2 (222-223)
(222, 1, '6690-2',  'CBC / CMP',                '1'),
(223, 1, '6690-2',  'CBC / CMP',                '1'),
-- Robert Chen spirometry x3 (224-226)
(224, 1, '20150-9', 'Spirometry — FEV1 % Predicted', '1'),
(225, 1, '20150-9', 'Spirometry — FEV1 % Predicted', '1'),
(226, 1, '20150-9', 'Spirometry — FEV1 % Predicted', '1'),
-- Elena Rodriguez lipid panel x3 (227-229)
(227, 1, '2089-1',  'Lipid Panel',              '1'),
(228, 1, '2089-1',  'Lipid Panel',              '1'),
(229, 1, '2089-1',  'Lipid Panel',              '1'),
-- James Park spirometry x3 (230-232)
(230, 1, '20150-9', 'Spirometry — FEV1 % Predicted', '1'),
(231, 1, '20150-9', 'Spirometry — FEV1 % Predicted', '1'),
(232, 1, '20150-9', 'Spirometry — FEV1 % Predicted', '1'),
-- Sarah Torres PHQ-9 + TSH x2 (233-234)
(233, 1, '44261-6', 'PHQ-9 / TSH',              '1'),
(234, 1, '44261-6', 'PHQ-9',                    '1'),
-- Wanda Moore TSH x2 (235-236)
(235, 1, '3016-3',  'TSH',                      '1'),
(236, 1, '3016-3',  'TSH',                      '1'),
-- Carlos Mendez lipid panel x2 (237-238)
(237, 1, '2089-1',  'Lipid Panel',              '1'),
(238, 1, '2089-1',  'Lipid Panel',              '1'),
-- Anna Kowalski TSH x2 (239-240)
(239, 1, '3016-3',  'TSH',                      '1'),
(240, 1, '3016-3',  'TSH',                      '1'),
-- Thomas Brown A1C x2 (241-242)
(241, 1, '4548-4',  'Hemoglobin A1c',           '1'),
(242, 1, '4548-4',  'Hemoglobin A1c',           '1'),
-- Kevin O'Brien BMP + BNP x2 (243-244)
(243, 1, '2160-0',  'BMP / BNP',                '1'),
(244, 1, '2160-0',  'BMP / BNP',                '1');

-- =============================================================================
-- 2. SOAP NOTES FOR EARLIER ENCOUNTERS
-- form_soap IDs 37-57 (21 notes)
-- forms links IDs 80-100
-- =============================================================================

INSERT INTO form_soap (id, date, pid, user, groupname, authorized, activity, subjective, objective, assessment, plan)
VALUES

-- ------------------------------------------------------------
-- Phil Belford (pid=1)
-- ------------------------------------------------------------
-- Encounter 100 (2025-01-08) — first HTN visit
(37, '2025-01-08 09:00:00', 1, 'sarah.chen', 'Default', 1, 1,
 'New patient, referred by PCP retiring. Reports BP readings 145-155/90-95 at home. Occasional headaches. No chest pain. Family history: father with HTN and stroke at 68.',
 'BP 148/92, HR 78, Weight 195 lbs. Regular rate and rhythm. No edema. Labs: A1C 7.4, pending lipid panel.',
 'Essential hypertension — newly established care, BP not at goal. Type 2 diabetes — A1C 7.4, suboptimal.',
 'Start amlodipine 5mg QD. Lifestyle: low-sodium diet, 30 min walking 5x/week. Recheck BP in 6 months. A1C recheck in 6 months.'),

-- Encounter 101 (2025-07-15) — 6-month HTN follow-up
(38, '2025-07-15 09:30:00', 1, 'sarah.chen', 'Default', 1, 1,
 'Follow-up on amlodipine. Reports good adherence. Home BP averaging 148-154/90. Headaches persist. A1C 7.8 today — up from 7.4 in January.',
 'BP 152/94, HR 80, Weight 197 lbs. A1C 7.8.',
 'Hypertension — not at goal despite amlodipine 5mg. T2DM — A1C worsening (7.4→7.8), consider adding agent.',
 'Add lisinopril 10mg QD for BP and renal protection given DM. Recheck BP and A1C in 6 months. Dietary counseling referral.'),

-- ------------------------------------------------------------
-- Susan Underwood (pid=2)
-- ------------------------------------------------------------
-- Encounter 103 (2024-11-05) — annual wellness
(39, '2024-11-05 08:00:00', 2, 'sarah.chen', 'Default', 1, 1,
 'Annual wellness exam. Reports fatigue and polyuria for 3 months. PMH: HTN on lisinopril started at prior PCP. Last A1C 3 years ago was 6.8.',
 'BP 136/86, HR 74, Weight 166 lbs. A1C 7.9. LDL 142. Pap smear and mammogram due.',
 'Type 2 diabetes — newly confirmed elevated A1C 7.9 (prior 6.8). Hypertension — continue lisinopril. Hyperlipidemia — LDL 142, treatment indicated.',
 'Start metformin 500mg QD, increase to 1000mg BID in 4 weeks if tolerated. Start atorvastatin 20mg QD. Mammogram order placed. Return in 6 months.'),

-- Encounter 104 (2025-05-14) — DM follow-up
(40, '2025-05-14 09:00:00', 2, 'sarah.chen', 'Default', 1, 1,
 'DM follow-up at 6 months. Metformin 1000mg BID tolerated. Dietary changes in progress. A1C 7.4 today — improved from 7.9.',
 'BP 132/84, HR 72, Weight 164 lbs. A1C 7.4. LDL 128.',
 'T2DM — improving on metformin (A1C 7.9→7.4). Hyperlipidemia — LDL improving (142→128) on atorvastatin 20mg.',
 'Continue metformin 1000mg BID and atorvastatin 20mg. Increase atorvastatin to 40mg at next visit if LDL not at goal. Mammogram referral follow-up. Return in 6 months.'),

-- ------------------------------------------------------------
-- Marcus Johnson (pid=4)
-- ------------------------------------------------------------
-- Encounter 108 (2024-10-01) — initial DM evaluation
(41, '2024-10-01 09:00:00', 4, 'sarah.chen', 'Default', 1, 1,
 'Established care for diabetes and hypertension. Prior PCP retiring. A1C 7.8 at last check 8 months ago. Reports good metformin adherence. BP at home 140-150/88-95.',
 'BP 146/92, HR 82, Weight 216 lbs. A1C 7.8 today. BMP pending.',
 'T2DM — A1C 7.8, suboptimal. Hypertension — BP elevated. Obesity BMI 30.2.',
 'Continue metformin 1000mg BID. Start lisinopril 10mg for BP and renal protection. Target A1C <7, BP <130/80. Dietary counseling. Return in 6 months.'),

-- Encounter 109 (2025-04-10) — DM worsening
(42, '2025-04-10 09:30:00', 4, 'sarah.chen', 'Default', 1, 1,
 'DM and HTN follow-up. Reports metformin adherence. Diet compliance poor — high-carb diet. A1C 8.1 today — up from 7.8. Weight up 4 lbs.',
 'BP 150/94, HR 84, Weight 220 lbs. A1C 8.1.',
 'T2DM — worsening A1C (7.8→8.1). Hypertension — not at goal. Obesity — weight trending up.',
 'Increase lisinopril to 20mg. Refer to diabetes educator and nutritionist. Discuss SGLT2 inhibitor if no improvement at next visit. Return in 6 months.'),

-- Encounter 110 (2025-10-22) — quarterly review
(43, '2025-10-22 09:00:00', 4, 'sarah.chen', 'Default', 1, 1,
 'Quarterly review. A1C 8.6 today — continued worsening. Fatigue and increased thirst reported. BP 148/90. Reviewed SGLT2 inhibitor options with patient today.',
 'BP 148/90, HR 80, Weight 222 lbs. A1C 8.6.',
 'T2DM — A1C 8.6, poorly controlled, progressive despite metformin. Hypertension — borderline on lisinopril 20mg.',
 'Plan to add Jardiance 10mg at next visit after checking BMP and renal function. Increase dietary focus. Return in 3 months.'),

-- ------------------------------------------------------------
-- Elena Rodriguez (pid=5)
-- ------------------------------------------------------------
-- Encounter 112 (2024-09-18) — initial HTN
(44, '2024-09-18 11:00:00', 5, 'sarah.chen', 'Default', 1, 1,
 'Established care. BP 158/96 at triage. Reports no prior antihypertensive treatment — diagnosed by prior PCP but never followed up. LDL 158 on today''s lipid panel. Denies chest pain.',
 'BP 158/96, HR 76, Weight 148 lbs. LDL 158. No edema.',
 'Essential hypertension — uncontrolled, no prior treatment. Hyperlipidemia — LDL 158, treatment indicated.',
 'Start amlodipine 10mg QD and hydrochlorothiazide 25mg QD. Start atorvastatin 40mg QD. Low sodium diet counseling. Recheck BP in 6 months.'),

-- Encounter 113 (2025-03-05) — lipid review
(45, '2025-03-05 11:30:00', 5, 'sarah.chen', 'Default', 1, 1,
 'BP and lipid follow-up at 6 months. Reports medication adherence. LDL 132 today — improved from 158. BP improving.',
 'BP 152/92, HR 74, Weight 146 lbs. LDL 132.',
 'Hypertension — improving on dual therapy, not yet at goal. Hyperlipidemia — LDL down from 158 to 132 on atorvastatin.',
 'Continue amlodipine 10mg, HCTZ 25mg, atorvastatin 40mg. DEXA scan ordered for bone density (age 62, post-menopausal). Return in 6 months.'),

-- ------------------------------------------------------------
-- James Park (pid=6)
-- ------------------------------------------------------------
-- Encounter 115 (2025-02-20) — initial asthma follow-up
(46, '2025-02-20 13:00:00', 6, 'sarah.chen', 'Default', 1, 1,
 'Follow-up for asthma diagnosed at prior PCP 2 years ago. Using albuterol 2x/week. No recent exacerbations. Spirometry today: FEV1 82% predicted.',
 'BP 124/80, HR 76, Weight 168 lbs. O2 sat 97% RA. Mild expiratory wheeze on forced exhalation. FEV1 82% predicted.',
 'Asthma, mild persistent — controlled on rescue inhaler alone. FEV1 82% at lower end of normal.',
 'Continue albuterol PRN. Asthma action plan reviewed. Return in 6 months. Consider inhaled corticosteroid if frequency increases.'),

-- Encounter 116 (2025-08-07) — anxiety medication check
(47, '2025-08-07 13:30:00', 6, 'sarah.chen', 'Default', 1, 1,
 'Anxiety and asthma follow-up. Reports increasing anxiety symptoms — GAD-7 score 11. Albuterol use increased to daily. FEV1 78% on today''s spirometry.',
 'BP 120/78, HR 74, Weight 170 lbs. O2 sat 98% RA. FEV1 78%.',
 'Generalized anxiety disorder — moderate, new diagnosis. Asthma — borderline worsening, FEV1 declining (82%→78%), albuterol use increasing.',
 'Start sertraline 50mg QD for anxiety. Anxiety and asthma have bidirectional relationship — monitor both. Return in 6 months.'),

-- ------------------------------------------------------------
-- Patricia Williams (pid=7)
-- ------------------------------------------------------------
-- Encounter 118 (2024-08-29) — initial quarterly
(48, '2024-08-29 08:30:00', 7, 'sarah.chen', 'Default', 1, 1,
 'Complex patient establishing care. Multiple chronic conditions managed by prior PCP. On warfarin for A-fib, metformin for T2DM, levothyroxine for hypothyroid. INR 2.1 today. A1C 7.2.',
 'BP 158/88, HR 78 irregular, Weight 170 lbs. O2 sat 96%. 1+ pedal edema. INR 2.1. A1C 7.2.',
 'Atrial fibrillation — rate controlled, anticoagulation sub-therapeutic (INR 2.1, target 2-3, need consistent 2.5). Hypertension — elevated. T2DM — A1C 7.2, acceptable. Hypothyroidism — continue levothyroxine.',
 'Continue warfarin 5mg, metoprolol 50mg, metformin 500mg BID, levothyroxine 75mcg. Start amlodipine 10mg for BP. INR recheck in 4 weeks. Return in 6 months.'),

-- Encounter 119 (2025-02-19) — quarterly review
(49, '2025-02-19 08:30:00', 7, 'sarah.chen', 'Default', 1, 1,
 'Quarterly chronic disease review. Reports good medication compliance. No palpitations or dyspnea. INR 2.8 today — therapeutic. A1C 7.2 (checked today).',
 'BP 154/86, HR 76 irregular, Weight 168 lbs. INR 2.8. A1C 7.2.',
 'Atrial fibrillation — rate controlled, INR therapeutic at 2.8. Hypertension — borderline on amlodipine 10mg. T2DM — stable A1C.',
 'Continue all medications. BP still above goal — may need additional agent. Return in 6 months.'),

-- Encounter 120 (2025-08-28) — INR monitoring
(50, '2025-08-28 08:30:00', 7, 'sarah.chen', 'Default', 1, 1,
 'Quarterly review. Reports some ankle swelling over past 4 weeks. INR 2.4 today. BP elevated. No palpitations.',
 'BP 156/90, HR 80 irregular, Weight 170 lbs. Trace bilateral pedal edema. INR 2.4.',
 'Hypertension — BP not at goal, creeping up. Atrial fibrillation — INR therapeutic. Mild fluid retention.',
 'Increase amlodipine dose discussed — defer to next visit after BMP. Low sodium diet reinforced. INR remains therapeutic. Return in 6 months.'),

-- ------------------------------------------------------------
-- David Kim (pid=8)
-- ------------------------------------------------------------
-- Encounter 122 (2025-01-30) — pre-diabetes evaluation
(51, '2025-01-30 10:30:00', 8, 'sarah.chen', 'Default', 1, 1,
 'Annual exam reveals elevated fasting glucose and A1C. Patient unaware. Reports no symptoms. Works sedentary desk job. Diet: frequent fast food. No family history of diabetes discussed.',
 'BP 128/82, HR 74, Weight 194 lbs. BMI 29.5. Fasting glucose 118. A1C 5.9.',
 'Prediabetes — fasting glucose 118 (normal <100), A1C 5.9 (normal <5.7). Hyperlipidemia — LDL elevated on lipid panel. Overweight.',
 'Intensive lifestyle counseling: target 5-7% weight loss, 150 min/week moderate exercise. Nutrition referral. Recheck A1C and fasting glucose in 6 months. Rosuvastatin 10mg for hyperlipidemia.'),

-- ------------------------------------------------------------
-- Sarah Torres (pid=9)
-- ------------------------------------------------------------
-- Encounter 124 (2024-10-14) — initial PPD
(52, '2024-10-14 15:00:00', 9, 'sarah.chen', 'Default', 1, 1,
 '6-week postpartum visit. Patient self-referred for mood concerns. Reports persistent low mood since delivery, crying spells, difficulty bonding with infant, poor sleep beyond typical newborn disruption. PHQ-9 today: 14. Denies SI. TSH normal.',
 'BP 112/70, HR 86, Weight 138 lbs. Alert, tearful. TSH 2.1 mIU/L (normal). PHQ-9: 14 (moderate).',
 'Postpartum depression — moderate severity (PHQ-9 14). Hypothyroidism ruled out (TSH 2.1).',
 'Start sertraline 50mg QD — safe in breastfeeding. Provide PPD resources and hotline. Lactation support referral if needed. Return in 4 months for PHQ-9 recheck.'),

-- ------------------------------------------------------------
-- Robert Chen (pid=10)
-- ------------------------------------------------------------
-- Encounter 126 (2024-11-12) — initial COPD
(53, '2024-11-12 09:00:00', 10, 'sarah.chen', 'Default', 1, 1,
 'Establishing care. COPD diagnosed 3 years ago at pulmonologist. On albuterol PRN only. Quit smoking 4 years ago, 30 pack-year history. Reports dyspnea on moderate exertion. FEV1 62% on today''s spirometry — GOLD stage 2.',
 'BP 132/82, HR 78, RR 18, O2 sat 93% RA. Diffuse expiratory wheeze. FEV1 62% predicted.',
 'COPD, moderate (GOLD stage 2) — FEV1 62%, symptomatic on exertion. Former tobacco user. Inadequate maintenance therapy.',
 'Start tiotropium 18mcg QD as maintenance. Continue albuterol PRN. Pulmonary rehab referral. Flu and pneumococcal vaccines today. Return in 6 months.'),

-- Encounter 127 (2025-05-08) — COPD spirometry review
(54, '2025-05-08 09:30:00', 10, 'sarah.chen', 'Default', 1, 1,
 'COPD follow-up at 6 months on tiotropium. Reports improvement in daily dyspnea. FEV1 60% on today''s spirometry — slight decline from 62%. No exacerbations since last visit.',
 'BP 128/80, HR 76, RR 18, O2 sat 94% RA. Mild expiratory wheeze. FEV1 60%.',
 'COPD — stable on tiotropium, minor FEV1 decline (62%→60%), no exacerbations.',
 'Continue tiotropium 18mcg QD and albuterol PRN. Pulmonary rehab adherence encouraged. Return in 6 months.'),

-- ------------------------------------------------------------
-- Jennifer Walsh (pid=11)
-- ------------------------------------------------------------
-- Encounter 129 (2025-03-11) — hypothyroid follow-up
(55, '2025-03-11 14:00:00', 11, 'sarah.chen', 'Default', 1, 1,
 'Hypothyroid follow-up. On levothyroxine 100mcg since 2022. Reports no symptoms of hypo or hyperthyroid. TSH 3.2 today — stable in range.',
 'BP 118/76, HR 72, Weight 142 lbs. TSH 3.2 mIU/L (normal range).',
 'Hypothyroidism — well-controlled on levothyroxine 100mcg (TSH 3.2). Migraine frequency stable at 2-3/month on current management.',
 'Continue levothyroxine 100mcg. Annual TSH. Migraine frequency acceptable — monitoring. Return in 6 months.'),

-- ------------------------------------------------------------
-- Michael Thompson (pid=12)
-- ------------------------------------------------------------
-- Encounter 131 (2024-10-08) — initial quarterly CAD
(56, '2024-10-08 08:00:00', 12, 'sarah.chen', 'Default', 1, 1,
 'Complex CAD patient establishing care. History of MI and PCI 4 years ago. On full secondary prevention regimen. No chest pain or dyspnea. Nuclear stress test last year: small fixed inferior defect (consistent with old MI). A1C 7.5, LDL 88 today.',
 'BP 136/84, HR 68, Weight 188 lbs. EKG: NSR, old inferior Q-waves. No new ST changes. A1C 7.5, LDL 88.',
 'CAD — stable, medically managed, on full secondary prevention. T2DM — A1C 7.5, acceptable. Hypertension — at goal.',
 'Continue aspirin 81mg, metoprolol 100mg, lisinopril 40mg, atorvastatin 80mg, metformin 1000mg BID, nitroglycerin SL PRN. Annual cardiology follow-up arranged. Return in 3 months.'),

-- Encounter 132 (2025-01-14) — echo result review
(57, '2025-01-14 08:30:00', 12, 'sarah.chen', 'Default', 1, 1,
 'Echo result review. Cardiology ordered echo last month: EF 55% (preserved), no new wall motion abnormalities. A1C 7.3 today — slight improvement.',
 'BP 132/82, HR 66, Weight 186 lbs. A1C 7.3.',
 'CAD — stable. Echo shows preserved EF, no progression. T2DM — A1C improving (7.5→7.3).',
 'Continue all current medications. Good news on echo. Encourage continued exercise and diet. Return in 3 months.'),

-- Encounter 133 (2025-04-22) — post-cath follow-up
(58, '2025-04-22 08:00:00', 12, 'sarah.chen', 'Default', 1, 1,
 'Post-catheterization follow-up at 4 weeks. Cardiology performed elective cath in March — found patent stents, no new lesions. Patient doing well. No chest pain. LDL 82 on today''s panel.',
 'BP 130/80, HR 68, Weight 184 lbs. LDL 82. Cath site healed.',
 'CAD — patent stents confirmed on cath, no new lesions. LDL 82, at goal on atorvastatin 80mg. T2DM — stable.',
 'Continue current medical regimen. Cath results reassuring. Annual stress test scheduled. Return in 6 months.'),

-- ------------------------------------------------------------
-- Aisha Williams (pid=13)
-- ------------------------------------------------------------
-- Encounter 135 (2025-01-09) — initial lupus co-management
(59, '2025-01-09 11:00:00', 13, 'sarah.chen', 'Default', 1, 1,
 'Lupus patient establishing primary care co-management with rheumatology. Diagnosed 18 months ago. On hydroxychloroquine 400mg per rheumatology. Stable — no new flares since diagnosis. Fatigue present but manageable.',
 'BP 122/78, HR 78, Weight 132 lbs. No malar rash. Joints without active synovitis. CBC: WBC 5.2, Hgb 12.1. CMP: creatinine 0.9.',
 'Systemic lupus erythematosus — stable on hydroxychloroquine per rheumatology. CBC and CMP within normal limits. Annual ophthalmology screening needed.',
 'Continue hydroxychloroquine 400mg QD. Vitamin D3 2000 IU QD for bone health. Ophthalmology referral placed for hydroxychloroquine retinal monitoring. Return in 6 months or per rheumatology.'),

-- ------------------------------------------------------------
-- Wanda Moore (pid=3)
-- ------------------------------------------------------------
-- Encounter 106 (2024-08-12) — initial anxiety evaluation
(60, '2024-08-12 14:00:00', 3, 'sarah.chen', 'Default', 1, 1,
 'Presenting with anxiety and irregular periods for 8 months. Reports excessive worry, difficulty sleeping, tension. GAD-7 today: 12. Also reports irregular cycles since stopping OCP 6 months ago. TSH 2.4 — thyroid not a cause.',
 'BP 118/74, HR 88, Weight 132 lbs. Alert, anxious affect. TSH 2.4 mIU/L (normal). No thyromegaly.',
 'Generalized anxiety disorder — moderate (GAD-7 12). Thyroid dysfunction ruled out (TSH 2.4). Irregular menstrual cycle — needs OB/GYN evaluation.',
 'Start sertraline 50mg QD for anxiety. OB/GYN referral for menstrual irregularity evaluation. Return in 6 months for sertraline follow-up.');

-- FORMS TABLE LINKS for new SOAPs (IDs 80-100)
INSERT INTO forms
    (id, date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir, provider_id)
VALUES
(80,  '2025-01-08 09:00:00', 100, 'SOAP', 37,  1, 'sarah.chen','Default',1,0,'soap',10),
(81,  '2025-07-15 09:30:00', 101, 'SOAP', 38,  1, 'sarah.chen','Default',1,0,'soap',10),
(82,  '2024-11-05 08:00:00', 103, 'SOAP', 39,  2, 'sarah.chen','Default',1,0,'soap',10),
(83,  '2025-05-14 09:00:00', 104, 'SOAP', 40,  2, 'sarah.chen','Default',1,0,'soap',10),
(84,  '2024-10-01 09:00:00', 108, 'SOAP', 41,  4, 'sarah.chen','Default',1,0,'soap',10),
(85,  '2025-04-10 09:30:00', 109, 'SOAP', 42,  4, 'sarah.chen','Default',1,0,'soap',10),
(86,  '2025-10-22 09:00:00', 110, 'SOAP', 43,  4, 'sarah.chen','Default',1,0,'soap',10),
(87,  '2024-09-18 11:00:00', 112, 'SOAP', 44,  5, 'sarah.chen','Default',1,0,'soap',10),
(88,  '2025-03-05 11:30:00', 113, 'SOAP', 45,  5, 'sarah.chen','Default',1,0,'soap',10),
(89,  '2025-02-20 13:00:00', 115, 'SOAP', 46,  6, 'sarah.chen','Default',1,0,'soap',10),
(90,  '2025-08-07 13:30:00', 116, 'SOAP', 47,  6, 'sarah.chen','Default',1,0,'soap',10),
(91,  '2024-08-29 08:30:00', 118, 'SOAP', 48,  7, 'sarah.chen','Default',1,0,'soap',10),
(92,  '2025-02-19 08:30:00', 119, 'SOAP', 49,  7, 'sarah.chen','Default',1,0,'soap',10),
(93,  '2025-08-28 08:30:00', 120, 'SOAP', 50,  7, 'sarah.chen','Default',1,0,'soap',10),
(94,  '2025-01-30 10:30:00', 122, 'SOAP', 51,  8, 'sarah.chen','Default',1,0,'soap',10),
(95,  '2024-10-14 15:00:00', 124, 'SOAP', 52,  9, 'sarah.chen','Default',1,0,'soap',10),
(96,  '2024-11-12 09:00:00', 126, 'SOAP', 53, 10, 'sarah.chen','Default',1,0,'soap',10),
(97,  '2025-05-08 09:30:00', 127, 'SOAP', 54, 10, 'sarah.chen','Default',1,0,'soap',10),
(98,  '2025-03-11 14:00:00', 129, 'SOAP', 55, 11, 'sarah.chen','Default',1,0,'soap',10),
(99,  '2024-10-08 08:00:00', 131, 'SOAP', 56, 12, 'sarah.chen','Default',1,0,'soap',10),
(100, '2025-01-14 08:30:00', 132, 'SOAP', 57, 12, 'sarah.chen','Default',1,0,'soap',10),
(101, '2025-04-22 08:00:00', 133, 'SOAP', 58, 12, 'sarah.chen','Default',1,0,'soap',10),
(102, '2025-01-09 11:00:00', 135, 'SOAP', 59, 13, 'sarah.chen','Default',1,0,'soap',10),
(103, '2024-08-12 14:00:00', 106, 'SOAP', 60,  3, 'sarah.chen','Default',1,0,'soap',10);

SET FOREIGN_KEY_CHECKS = 1;
