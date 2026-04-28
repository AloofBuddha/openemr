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
    private const MAX_TOKENS = 512;

    private const SYSTEM_PROMPT = <<<'PROMPT'
You are a Clinical Co-Pilot embedded in an EHR. Give physicians a fast, skimmable pre-encounter brief.

Rules:
- Only state facts present in the provided data. Never fabricate clinical details.
- Write 4–6 bullet points. No headers. Telegraphic style — short phrases, not sentences.
- Lead with why here today, then key changes since last visit, active meds of concern, flagged labs.
- For every specific data point (medication name/dose, lab value, visit reason), cite its source number inline: e.g. "Jardiance 10mg [3]".
- If data is missing, note it in one word (e.g. "No labs on file").
- Do not diagnose or recommend treatments.
PROMPT;

    public function __construct(
        private readonly PatientBriefTool $briefTool,
        private readonly AgentAuditLogger $auditLogger,
    ) {}

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
                $cachedSources = json_decode($cached['citation_registry'] ?? '{}', true) ?? [];
                $this->emitEvent('sources', ['sources' => $cachedSources]);
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

        // Build prompt + source registry; emit sources before streaming so citations are live immediately
        ['message' => $userMessage, 'sources' => $sources] = $this->buildUserMessage($patientData);
        $this->emitEvent('sources', ['sources' => $sources]);

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

        if (!empty($fullText)) {
            $this->saveCache($patientId, $physicianId, $patientData, $fullText, $sources);
        }

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

    /**
     * Builds the user message and a numbered source registry for citations.
     *
     * @param array<string,mixed> $patientData
     * @return array{message: string, sources: array<string, array{type: string, label: string, detail: string}>}
     */
    private function buildUserMessage(array $patientData): array
    {
        $demo = $patientData['demographics'];
        $name = $demo['name'] ?? 'Unknown';
        $age  = $demo['age'] ?? '';
        $sex  = $demo['sex'] ?? '';

        $sources = [];
        $sourceIndex = 1;
        $sourceLines = [];

        // [1] Today's appointment
        $appt = $patientData['today_appointment'];
        if ($appt) {
            $reason = $appt['reason'] ?: 'Not specified';
            $time   = $appt['time'] ?? '';
            $sources[(string) $sourceIndex] = [
                'type'   => 'appointment',
                'label'  => "Today's appointment" . ($time ? " at {$time}" : ''),
                'detail' => "Reason: {$reason}",
            ];
            $sourceLines[] = "[{$sourceIndex}] Today's appointment: {$reason}" . ($time ? " at {$time}" : '');
        } else {
            $sourceLines[] = "[{$sourceIndex}] Today's appointment: none on file";
            $sources[(string) $sourceIndex] = ['type' => 'appointment', 'label' => "Today's appointment", 'detail' => 'None on file'];
        }
        $apptRef = $sourceIndex++;

        // [N] Last encounter
        $enc = $patientData['last_encounter'];
        if ($enc) {
            $encDate   = $enc['date'] ?? 'unknown';
            $assessment = trim($enc['soap']['assessment'] ?? '');
            $plan       = trim($enc['soap']['plan'] ?? '');
            $detail     = $assessment ?: ($enc['reason'] ?? 'No SOAP note');
            $sources[(string) $sourceIndex] = [
                'type'   => 'encounter',
                'label'  => "Last encounter ({$encDate})",
                'detail' => ($assessment ? "Assessment: {$assessment}" : 'No assessment') . ($plan ? " — Plan: {$plan}" : ''),
            ];
            $sourceLines[] = "[{$sourceIndex}] Last encounter ({$encDate}): {$detail}";
        } else {
            $sources[(string) $sourceIndex] = ['type' => 'encounter', 'label' => 'Last encounter', 'detail' => 'No prior encounters'];
            $sourceLines[] = "[{$sourceIndex}] Last encounter: none";
        }
        $sourceIndex++;

        // Medications
        $meds = $patientData['active_medications'];
        $medRefs = [];
        if (empty($meds)) {
            $sourceLines[] = "[{$sourceIndex}] Medications: none documented";
            $sources[(string) $sourceIndex] = ['type' => 'medication', 'label' => 'Active medications', 'detail' => 'None documented'];
            $sourceIndex++;
        } else {
            foreach ($meds as $med) {
                $label  = trim("{$med['drug']} {$med['dosage']} {$med['unit']}");
                $detail = trim("Route: {$med['route']} — Interval: {$med['interval']}" . ($med['note'] ? " — {$med['note']}" : ''));
                $sources[(string) $sourceIndex] = ['type' => 'medication', 'label' => $label, 'detail' => $detail ?: 'Active prescription'];
                $sourceLines[] = "[{$sourceIndex}] Medication: {$label}" . ($med['interval'] ? " ({$med['interval']})" : '');
                $medRefs[] = $sourceIndex;
                $sourceIndex++;
            }
        }

        // Labs
        $labs = $patientData['recent_labs'];
        if (empty($labs)) {
            $sourceLines[] = "[{$sourceIndex}] Labs: none documented";
            $sources[(string) $sourceIndex] = ['type' => 'lab', 'label' => 'Recent labs', 'detail' => 'None on file'];
            $sourceIndex++;
        } else {
            foreach ($labs as $lab) {
                $label  = "{$lab['test']}: {$lab['value']} {$lab['units']}";
                $detail = ($lab['range'] ? "Ref: {$lab['range']}" : '') .
                          ($lab['abnormal'] ? " — ABNORMAL: {$lab['abnormal']}" : '') .
                          ($lab['date_collected'] ? " — {$lab['date_collected']}" : '');
                $sources[(string) $sourceIndex] = [
                    'type'   => 'lab',
                    'label'  => $label,
                    'detail' => trim($detail, " \t\n\r\0\x0B—"),
                ];
                $flag = $lab['abnormal'] ? " [ABNORMAL: {$lab['abnormal']}]" : '';
                $sourceLines[] = "[{$sourceIndex}] Lab: {$label}{$flag}" . ($lab['date_collected'] ? " — {$lab['date_collected']}" : '');
                $sourceIndex++;
            }
        }

        $sourcesBlock = implode("\n", $sourceLines);

        $message = <<<TEXT
Brief this patient. Cite source numbers inline (e.g. [1]) next to each fact.

PATIENT: {$name}, {$age}y {$sex}

SOURCES:
{$sourcesBlock}
TEXT;

        return ['message' => $message, 'sources' => $sources];
    }

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
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line   = substr($buffer, 0, $pos);
                    $buffer = substr($buffer, $pos + 1);
                    $line   = trim($line);
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
                            if (ob_get_level() > 0) {
                                ob_flush();
                            }
                            flush();
                        }
                    } elseif ($type === 'message_start') {
                        $usage = $event['message']['usage'] ?? [];
                        $onUsage((int) ($usage['input_tokens'] ?? 0), 0);
                    }
                }
                return strlen($chunk);
            },
            CURLOPT_TIMEOUT        => 60,
        ]);

        $result   = curl_exec($ch);
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
        $row = sqlQuery(
            "SELECT brief_text, citation_registry, data_snapshot_hash, generated_at
             FROM copilot_brief_cache
             WHERE patient_id = ? AND physician_id = ? AND appointment_date = CURDATE()
             ORDER BY generated_at DESC LIMIT 1",
            [$patientId, $physicianId]
        );
        if (empty($row)) {
            return null;
        }
        $generatedAt = strtotime($row['generated_at'] ?? '');
        if ($generatedAt && (time() - $generatedAt) > 1800) {
            return null;
        }
        return $row;
    }

    private function saveCache(
        int $patientId,
        int $physicianId,
        array $patientData,
        string $briefText,
        array $sources,
    ): void {
        $appointmentId = $patientData['today_appointment']['appointment_id'] ?? 0;

        sqlStatement(
            "INSERT INTO copilot_brief_cache
                (patient_id, physician_id, appointment_id, appointment_date,
                 brief_text, follow_up_json, citation_registry, data_snapshot_hash, generated_at)
             VALUES (?, ?, ?, CURDATE(), ?, '[]', ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
                brief_text         = VALUES(brief_text),
                citation_registry  = VALUES(citation_registry),
                data_snapshot_hash = VALUES(data_snapshot_hash),
                generated_at       = NOW()",
            [
                $patientId,
                $physicianId,
                $appointmentId,
                $briefText,
                json_encode($sources),
                $patientData['data_hash'] ?? '',
            ]
        );
    }
}
