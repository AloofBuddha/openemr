<?php

/**
 * Orchestrates the patient brief: gather data → call Claude → stream response.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\ClinicalCopilot\Agent;

use OpenEMR\Modules\ClinicalCopilot\Agent\Tools\PatientBriefTool;
use OpenEMR\Modules\ClinicalCopilot\Observability\AgentAuditLogger;

class Orchestrator
{
    private const MODEL = 'claude-sonnet-4-6';
    private const MAX_TOKENS = 1024;

    private const SYSTEM_PROMPT = <<<'PROMPT'
You are a Clinical Co-Pilot embedded in OpenEMR. You assist physicians by synthesizing patient data from their EHR system.

Rules:
- Only state facts present in the patient data provided. Never fabricate clinical details.
- Be concise — the physician has 90 seconds between exam rooms.
- Structure your brief: (1) Why here today, (2) What changed since last visit, (3) Active medications (flag any concerns), (4) Recent labs (flag abnormals), (5) 2-3 suggested follow-up actions.
- If data is missing or incomplete, say so explicitly rather than omitting it silently.
- Do not diagnose. Do not recommend treatments. Surface data only.
- Use plain language, not clinical jargon.
- Note: "This brief is only as complete as the EHR data. Undocumented medications or conditions will not appear."
PROMPT;

    public function __construct(
        private readonly PatientBriefTool $briefTool,
        private readonly AgentAuditLogger $auditLogger,
    ) {}

    /**
     * Generate a streaming patient brief. Outputs SSE events directly to the
     * HTTP response. Caller must set SSE headers and disable output buffering
     * before calling this method.
     */
    public function streamBrief(int $patientId, int $physicianId, bool $forceRefresh = false): void
    {
        $startMs = (int) (microtime(true) * 1000);
        $apiKey = $_ENV['ANTHROPIC_API_KEY'] ?? getenv('ANTHROPIC_API_KEY') ?: '';

        if (empty($apiKey)) {
            $this->emitEvent('error', ['message' => 'ANTHROPIC_API_KEY not configured on this server.']);
            return;
        }

        // Check cache first (unless force refresh requested)
        if (!$forceRefresh) {
            $cached = $this->fetchCache($patientId, $physicianId);
            if ($cached !== null) {
                $this->emitEvent('cached', ['text' => $cached['brief_text']]);
                $this->emitEvent('done', ['cached' => true]);
                return;
            }
        }

        // Gather patient data
        $toolStart = (int) (microtime(true) * 1000);
        $patientData = $this->briefTool->gather($patientId, $physicianId);
        $toolDuration = (int) (microtime(true) * 1000) - $toolStart;

        $toolsCalled = [[
            'name'        => 'PatientBriefTool',
            'duration_ms' => $toolDuration,
            'success'     => !empty($patientData['demographics']),
            'result_size' => strlen(json_encode($patientData) ?: ''),
        ]];

        // Build prompt
        $userMessage = $this->buildUserMessage($patientData);

        // Stream from Anthropic
        $fullText = '';
        $inputTokens = 0;
        $outputTokens = 0;

        $this->streamAnthropicApi(
            apiKey: $apiKey,
            userMessage: $userMessage,
            onDelta: function (string $text) use (&$fullText): void {
                $fullText .= $text;
                $this->emitEvent('delta', ['text' => $text]);
            },
            onUsage: function (int $in, int $out) use (&$inputTokens, &$outputTokens): void {
                $inputTokens  = $in;
                $outputTokens = $out;
            },
        );

        $totalMs = (int) (microtime(true) * 1000) - $startMs;

        // Cache the result
        if (!empty($fullText)) {
            $this->saveCache($patientId, $physicianId, $patientData, $fullText);
        }

        // Audit log
        $this->auditLogger->log(
            physicianId:   $physicianId,
            patientId:     $patientId,
            queryText:     'Pre-encounter brief (auto)',
            toolsCalled:   $toolsCalled,
            model:         self::MODEL,
            inputTokens:   $inputTokens,
            outputTokens:  $outputTokens,
            totalMs:       $totalMs,
            verified:      true,
        );

        $this->emitEvent('done', [
            'cached'        => false,
            'total_ms'      => $totalMs,
            'input_tokens'  => $inputTokens,
            'output_tokens' => $outputTokens,
        ]);
    }

    private function buildUserMessage(array $patientData): string
    {
        $demo = $patientData['demographics'];
        $name = $demo['name'] ?? 'Unknown';
        $age  = $demo['age'] ?? '';
        $sex  = $demo['sex'] ?? '';

        $appt = $patientData['today_appointment'];
        $apptReason = $appt ? ($appt['reason'] ?: 'Not specified') : 'No appointment found today';

        $enc = $patientData['last_encounter'];
        $lastEncDate = $enc ? ($enc['date'] ?? 'unknown date') : 'No prior encounters';
        $soap = $enc['soap'] ?? [];

        $meds = $patientData['active_medications'];
        $labs = $patientData['recent_labs'];

        $medsText = empty($meds)
            ? 'No active medications documented'
            : implode("\n", array_map(
                fn($m) => "- {$m['drug']} {$m['dosage']} {$m['unit']} ({$m['interval']})" . ($m['note'] ? " — {$m['note']}" : ''),
                $meds
            ));

        $labsText = empty($labs)
            ? 'No recent labs documented'
            : implode("\n", array_map(
                fn($l) => "- {$l['test']}: {$l['value']} {$l['units']}" .
                    ($l['range'] ? " (ref: {$l['range']})" : '') .
                    ($l['abnormal'] ? " [ABNORMAL: {$l['abnormal']}]" : '') .
                    " — {$l['date_collected']}",
                $labs
            ));

        $soapText = '';
        if ($enc) {
            $soapText = "\nLast encounter ({$lastEncDate}):";
            if ($soap['subjective']) {
                $soapText .= "\n  Subjective: {$soap['subjective']}";
            }
            if ($soap['assessment']) {
                $soapText .= "\n  Assessment: {$soap['assessment']}";
            }
            if ($soap['plan']) {
                $soapText .= "\n  Plan: {$soap['plan']}";
            }
        }

        return <<<TEXT
Generate a pre-encounter brief for this patient.

PATIENT: {$name}, {$age}y {$sex}

TODAY'S VISIT REASON: {$apptReason}
{$soapText}

ACTIVE MEDICATIONS:
{$medsText}

RECENT LABS:
{$labsText}

Note: This is the complete data available in OpenEMR for this patient. Brief me in 90 seconds or less.
TEXT;
    }

    /**
     * Makes a streaming request to the Anthropic Messages API.
     * Calls $onDelta for each text token, $onUsage once with final token counts.
     */
    private function streamAnthropicApi(
        string $apiKey,
        string $userMessage,
        \Closure $onDelta,
        \Closure $onUsage,
    ): void {
        $payload = json_encode([
            'model'      => self::MODEL,
            'max_tokens' => self::MAX_TOKENS,
            'stream'     => true,
            'system'     => self::SYSTEM_PROMPT,
            'messages'   => [['role' => 'user', 'content' => $userMessage]],
        ]);

        $buffer = '';

        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'x-api-key: ' . $apiKey,
                'anthropic-version: 2023-06-01',
            ],
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_WRITEFUNCTION  => function ($ch, $chunk) use (&$buffer, $onDelta, $onUsage): int {
                $buffer .= $chunk;
                // Process complete SSE lines
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line = substr($buffer, 0, $pos);
                    $buffer = substr($buffer, $pos + 1);
                    $line = trim($line);
                    if (!str_starts_with($line, 'data: ')) {
                        continue;
                    }
                    $json = substr($line, 6);
                    if ($json === '[DONE]') {
                        continue;
                    }
                    $event = json_decode($json, true);
                    if (!is_array($event)) {
                        continue;
                    }
                    $type = $event['type'] ?? '';
                    if ($type === 'content_block_delta') {
                        $text = $event['delta']['text'] ?? '';
                        if ($text !== '') {
                            $onDelta($text);
                            // Flush immediately for streaming UX
                            if (ob_get_level() > 0) {
                                ob_flush();
                            }
                            flush();
                        }
                    } elseif ($type === 'message_delta') {
                        $usage = $event['usage'] ?? [];
                        if (isset($usage['output_tokens'])) {
                            // input_tokens come from message_start; we use message_delta for output
                        }
                    } elseif ($type === 'message_start') {
                        $usage = $event['message']['usage'] ?? [];
                        $onUsage((int) ($usage['input_tokens'] ?? 0), 0);
                    } elseif ($type === 'message_stop') {
                        // Final output token count is in the message_delta before stop
                    }
                }
                return strlen($chunk);
            },
            CURLOPT_TIMEOUT        => 60,
        ]);

        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

        if ($result === false || $httpCode !== 200) {
            $error = curl_error($ch) ?: "HTTP {$httpCode}";
            curl_close($ch);
            $this->emitEvent('error', ['message' => "Anthropic API error: {$error}"]);
            return;
        }
        curl_close($ch);
    }

    private function emitEvent(string $type, array $data): void
    {
        echo "event: {$type}\n";
        echo 'data: ' . json_encode($data) . "\n\n";
        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }

    private function fetchCache(int $patientId, int $physicianId): ?array
    {
        // Cache is valid for today's date only
        $row = sqlQuery(
            "SELECT brief_text, data_snapshot_hash, generated_at
             FROM copilot_brief_cache
             WHERE patient_id = ? AND physician_id = ? AND appointment_date = CURDATE()
             ORDER BY generated_at DESC LIMIT 1",
            [$patientId, $physicianId]
        );
        if (empty($row)) {
            return null;
        }
        // Check if cache is recent enough (within 30 minutes)
        $generatedAt = strtotime($row['generated_at'] ?? '');
        if ($generatedAt && (time() - $generatedAt) > 1800) {
            return null;
        }
        return $row;
    }

    private function saveCache(int $patientId, int $physicianId, array $patientData, string $briefText): void
    {
        $appointment = $patientData['today_appointment'];
        $appointmentId = $appointment['appointment_id'] ?? 0;

        sqlStatement(
            "INSERT INTO copilot_brief_cache
                (patient_id, physician_id, appointment_id, appointment_date,
                 brief_text, follow_up_json, citation_registry, data_snapshot_hash, generated_at)
             VALUES (?, ?, ?, CURDATE(), ?, '[]', '{}', ?, NOW())
             ON DUPLICATE KEY UPDATE
                brief_text = VALUES(brief_text),
                data_snapshot_hash = VALUES(data_snapshot_hash),
                generated_at = NOW()",
            [
                $patientId,
                $physicianId,
                $appointmentId,
                $briefText,
                $patientData['data_hash'] ?? '',
            ]
        );
    }
}
