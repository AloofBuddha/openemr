<?php

/**
 * Clinical Co-Pilot intake processing endpoint.
 *
 * Called at copilot startup: retrieves any intake forms uploaded (e.g. by
 * front desk) that have not yet been processed by the agent, returns their
 * extractions, marks them processed, and writes extracted data back to the
 * OpenEMR patient chart (vitals, medications, allergies, PMH, social history).
 *
 * POST params:
 *   pid              (int)    — patient ID
 *   csrf_token_form  (string) — CSRF token
 *
 * Returns JSON: { processed: [{doc_id, doc_name, extraction}] }
 *              or { processed: [] } on any error (non-fatal, copilot continues)
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

// Suppress PHP notices/warnings from leaking into the JSON response body.
ini_set('display_errors', '0');

$ignoreAuth = true;
require_once dirname(__FILE__, 5) . '/globals.php';
require_once __DIR__ . '/_bootstrap.php';

ob_start();

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionTracker;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Modules\ClinicalCopilot\Authorization\PatientAccessGuard;
use OpenEMR\Modules\ClinicalCopilot\Authorization\UnauthorizedPatientAccessException;

header('Content-Type: application/json');

function intakeProcError(string $msg, int $code = 400): never
{
    ob_end_clean();
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode(['error' => $msg, 'processed' => []]);
    exit;
}

$session     = SessionWrapperFactory::getInstance()->getActiveSession();
$physicianId = (int) $session->get('authUserID');
if ($physicianId <= 0 || SessionTracker::isSessionExpired()) {
    intakeProcError('Session expired', 401);
}

try {
    CsrfUtils::checkCsrfInput(INPUT_POST);
} catch (\Throwable) {
    intakeProcError('CSRF check failed', 403);
}

$pid = filter_input(INPUT_POST, 'pid', FILTER_VALIDATE_INT);
if (!$pid || $pid <= 0) {
    intakeProcError('Invalid pid');
}

$guard = new PatientAccessGuard();
try {
    $guard->assertAccess($physicianId, $pid);
} catch (UnauthorizedPatientAccessException) {
    intakeProcError('Access denied', 403);
}

ob_end_clean();

// ── Call sidecar to retrieve and mark pending intakes ─────────────────────────

$sidecarHost = getenv('COPILOT_SIDECAR_HOST') ?: '127.0.0.1';
$sidecarUrl  = "http://{$sidecarHost}:8400/patients/{$pid}/intakes/process-pending";

$ch = curl_init($sidecarUrl);
if ($ch === false) {
    echo json_encode(['processed' => []]);
    exit;
}

curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => '{}',
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 5,
]);

$body      = curl_exec($ch);
$httpCode  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError !== '' || $httpCode !== 200 || !is_string($body)) {
    error_log("[CopilotIntakeProcess] Sidecar error: {$curlError}, HTTP {$httpCode}");
    echo json_encode(['processed' => []]);
    exit;
}

// ── Write extracted data back to OpenEMR chart ────────────────────────────────

$data = json_decode($body, true);
if (is_array($data) && !empty($data['processed'])) {
    $physicianUser = (string) ($session->get('authUser') ?? '');
    // Buffer any stray output from OpenEMR internal code paths so it can't
    // corrupt the JSON response body.
    ob_start();
    foreach ($data['processed'] as $item) {
        $extraction = $item['extraction'] ?? null;
        if (is_array($extraction) && ($extraction['doc_type'] ?? '') === 'intake_form') {
            writeIntakeToOpenEMR($extraction, (int) $pid, $physicianId, $physicianUser);
        }
    }
    $strayOutput = ob_get_clean();
    if ($strayOutput !== '' && $strayOutput !== false) {
        error_log('[CopilotIntakeProcess] Suppressed stray output during write-back: ' . substr($strayOutput, 0, 300));
    }
}

echo $body;

// ── Write-back helpers ────────────────────────────────────────────────────────

/**
 * Write structured intake form data to OpenEMR chart tables.
 * Covers: vitals, medications, allergies, PMH, surgical history, social/family history.
 * All writes are idempotent (skip duplicates). Failures are logged, not raised.
 */
function writeIntakeToOpenEMR(array $ext, int $pid, int $physicianId, string $physicianUser): void
{
    try {
        // 1. Find or create today's encounter ─────────────────────────────────
        $enc = sqlQuery(
            "SELECT id FROM form_encounter WHERE pid = ? AND DATE(date) = CURDATE() ORDER BY id DESC LIMIT 1",
            [$pid]
        );
        if ($enc) {
            $encId = (int) $enc['id'];
        } else {
            $encId = (int) sqlInsert(
                "INSERT INTO form_encounter (date, reason, pid, encounter, provider_id, facility_id, pc_catid)
                 VALUES (NOW(), 'New patient intake — AI co-pilot', ?, 0, ?, 3, 5)",
                [$pid, $physicianId]
            );
            sqlStatement("UPDATE form_encounter SET encounter = ? WHERE id = ?", [$encId, $encId]);
        }

        // 2. Vitals ───────────────────────────────────────────────────────────
        $vitals = $ext['vitals'] ?? null;
        if ($vitals) {
            $existingVitals = sqlQuery(
                "SELECT id FROM form_vitals WHERE pid = ? AND DATE(date) = CURDATE() LIMIT 1",
                [$pid]
            );
            if (!$existingVitals) {
                [$bps, $bpd] = parseBP((string) ($vitals['blood_pressure'] ?? ''));
                $vitalsId = (int) sqlInsert(
                    "INSERT INTO form_vitals
                        (pid, date, user, authorized, activity, bps, bpd, height, weight, pulse, temperature, BMI, oxygen_saturation)
                     VALUES (?, NOW(), ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        $pid, $physicianUser,
                        $bps, $bpd,
                        extractNumeric((string) ($vitals['height']            ?? '')),
                        extractNumeric((string) ($vitals['weight']            ?? '')),
                        extractNumeric((string) ($vitals['heart_rate']        ?? '')),
                        extractNumeric((string) ($vitals['temperature']       ?? '')),
                        extractNumeric((string) ($vitals['bmi']               ?? '')),
                        extractNumeric((string) ($vitals['oxygen_saturation'] ?? '')),
                    ]
                );
                sqlInsert(
                    "INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, deleted, formdir)
                     VALUES (NOW(), ?, 'Vitals', ?, ?, ?, 'Default', 1, 0, 'vitals')",
                    [$encId, $vitalsId, $pid, $physicianUser]
                );
            }
        }

        // 3. Medications ──────────────────────────────────────────────────────
        foreach ($ext['current_medications'] ?? [] as $med) {
            $drug = trim((string) ($med['name'] ?? ''));
            if ($drug === '') {
                continue;
            }
            $dosage = trim(
                ($med['dose'] ?? '') . ' ' . ($med['frequency'] ?? '')
            );
            $exists = sqlQuery(
                "SELECT patient_id FROM prescriptions WHERE patient_id = ? AND drug = ? AND active = 1 LIMIT 1",
                [$pid, $drug]
            );
            if (!$exists) {
                sqlInsert(
                    "INSERT INTO prescriptions
                        (patient_id, provider_id, encounter, drug, dosage, start_date, active, txDate, uuid)
                     VALUES (?, ?, ?, ?, ?, CURDATE(), 1, CURDATE(), UNHEX(REPLACE(UUID(),'-','')))",
                    [$pid, $physicianId, $encId, $drug, $dosage]
                );
            }
        }

        // 4. Allergies ────────────────────────────────────────────────────────
        foreach ($ext['allergies'] ?? [] as $allergy) {
            $title = trim((string) ($allergy['allergen'] ?? ''));
            if ($title === '') {
                continue;
            }
            $reaction = trim((string) ($allergy['reaction'] ?? ''));
            $exists = sqlQuery(
                "SELECT id FROM lists WHERE pid = ? AND type = 'allergy' AND title = ? LIMIT 1",
                [$pid, $title]
            );
            if (!$exists) {
                sqlInsert(
                    "INSERT INTO lists (pid, type, title, begdate, activity, groupname, user, date, extrainfo)
                     VALUES (?, 'allergy', ?, CURDATE(), 1, 'Default', ?, NOW(), ?)",
                    [$pid, $title, $physicianUser, $reaction]
                );
            }
        }

        // 5. Past medical history ─────────────────────────────────────────────
        foreach ($ext['past_medical_history'] ?? [] as $condition) {
            $title = trim((string) $condition);
            if ($title === '') {
                continue;
            }
            $exists = sqlQuery(
                "SELECT id FROM lists WHERE pid = ? AND type = 'medical_problem' AND title = ? LIMIT 1",
                [$pid, $title]
            );
            if (!$exists) {
                sqlInsert(
                    "INSERT INTO lists (pid, type, title, begdate, activity, groupname, user, date)
                     VALUES (?, 'medical_problem', ?, CURDATE(), 1, 'Default', ?, NOW())",
                    [$pid, $title, $physicianUser]
                );
            }
        }

        // 6. Surgical history (stored as lists type='surgery') ────────────────
        foreach ($ext['surgical_history'] ?? [] as $procedure) {
            $title = trim((string) $procedure);
            if ($title === '') {
                continue;
            }
            $exists = sqlQuery(
                "SELECT id FROM lists WHERE pid = ? AND type = 'surgery' AND title = ? LIMIT 1",
                [$pid, $title]
            );
            if (!$exists) {
                sqlInsert(
                    "INSERT INTO lists (pid, type, title, begdate, activity, groupname, user, date)
                     VALUES (?, 'surgery', ?, CURDATE(), 1, 'Default', ?, NOW())",
                    [$pid, $title, $physicianUser]
                );
            }
        }

        // 7. Social + family history (history_data) ───────────────────────────
        $social        = $ext['social_history'] ?? null;
        $familyHistory = $ext['family_history']  ?? [];

        if ($social || $familyHistory) {
            [$histFather, $histMother] = splitFamilyHistory($familyHistory);
            $tobacco  = trim((string) ($social['tobacco']    ?? ''));
            $alcohol  = trim((string) ($social['alcohol']    ?? ''));
            $exercise = trim((string) ($social['exercise']   ?? ''));
            $occupation = trim((string) ($social['occupation'] ?? ''));

            $existing = sqlQuery(
                "SELECT id FROM history_data WHERE pid = ? ORDER BY id DESC LIMIT 1",
                [$pid]
            );

            if ($existing) {
                $sets   = [];
                $params = [];
                if ($tobacco)    { $sets[] = 'tobacco = ?';            $params[] = $tobacco; }
                if ($alcohol)    { $sets[] = 'alcohol = ?';            $params[] = $alcohol; }
                if ($exercise)   { $sets[] = 'exercise_patterns = ?';  $params[] = $exercise; }
                if ($histFather) { $sets[] = 'history_father = ?';     $params[] = $histFather; }
                if ($histMother) { $sets[] = 'history_mother = ?';     $params[] = $histMother; }
                if ($sets) {
                    $params[] = (int) $existing['id'];
                    sqlStatement(
                        "UPDATE history_data SET " . implode(', ', $sets) . " WHERE id = ?",
                        $params
                    );
                }
            } else {
                sqlInsert(
                    "INSERT INTO history_data (pid, tobacco, alcohol, exercise_patterns, history_father, history_mother)
                     VALUES (?, ?, ?, ?, ?, ?)",
                    [$pid, $tobacco, $alcohol, $exercise, $histFather, $histMother]
                );
            }
        }
    } catch (\Throwable $e) {
        error_log("[CopilotIntakeProcess] OpenEMR write-back failed for pid={$pid}: " . $e->getMessage());
    }
}

/** Extract the first numeric token from a string like "165 lbs", "64 in", "98%". */
function extractNumeric(string $s): string
{
    if (preg_match('/[\d.]+/', $s, $m)) {
        return $m[0];
    }
    return '';
}

/** Split "138/88" → ["138", "88"]. Returns ["", ""] if not parseable. */
function parseBP(string $bp): array
{
    $parts = explode('/', $bp);
    return [
        trim($parts[0] ?? ''),
        trim($parts[1] ?? ''),
    ];
}

/** Split family history list into father-side and mother-side strings. */
function splitFamilyHistory(array $entries): array
{
    $father = [];
    $mother = [];
    foreach ($entries as $entry) {
        $lower = strtolower((string) $entry);
        if (str_contains($lower, 'mother') || str_contains($lower, 'maternal')) {
            $mother[] = $entry;
        } else {
            $father[] = $entry; // default to father column (used as general family Hx)
        }
    }
    return [
        implode('; ', $father),
        implode('; ', $mother),
    ];
}
