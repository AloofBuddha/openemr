<?php

/**
 * Orchestrates patient conversations: gather data → call Claude → stream response.
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
    private const MODEL      = 'claude-sonnet-4-6';
    private const MAX_TOKENS = 1024;

    // First-turn: structured brief with citation markers + suggestion chips
    private const BRIEF_SYSTEM_PROMPT = <<<'PROMPT'
You are a Clinical Co-Pilot embedded in an EHR. Give physicians a fast, skimmable pre-encounter brief.

Rules:
- Only state facts present in the provided data. Never fabricate clinical details.
- Write 4–6 bullet points. No headers. Telegraphic style — short phrases, not sentences.
- Always open with today's appointment reason (from the appointment source). If no appointment is on file, note it.
- If the last encounter date is more than 6 months before today's visit date, add a bullet flagging this: "⚠️ Last seen [date] — [N] months ago" and include a one-phrase recap from that encounter's assessment if available.
- If the last encounter SOAP plan mentions a referral, pending lab, or follow-up item with no subsequent entry in the data, flag it as an open item (e.g. "⚠️ Open: [item] from [date] visit — no follow-up recorded").
- Then cover: key changes since last visit, active meds of concern, flagged labs.
- For every specific data point (medication name/dose, lab value, visit reason), wrap the cited phrase in source markers: [[N]]the phrase[[/N]] where N is the source number. Only wrap the data phrase itself, not surrounding prose.
- If data is missing, note it briefly (e.g. "No labs on file").
- Do not diagnose or recommend treatments.
- You have data for exactly one patient. If asked about any other patient by name, respond: "I only have access to [first name]'s chart right now."
- At the very end of your response, on its own line, output exactly:
  SUGGESTIONS: followed by a JSON array of 2–3 follow-up questions using the patient's first name.

  Chip selection — include only chips that apply to this patient's actual data:
  1. Lab trend: if the same lab test appears 2 or more times across different dates in the data, include "Show [first name]'s [test name] trend"
  2. History gap: if the last encounter was more than 6 months ago, include "Walk me through [first name]'s history since [last encounter date]"
  3. Medication check: if there are active medications, include one chart-answerable question about a specific drug — e.g. "When was [first name]'s [drug name] last adjusted?" (not pharmacology)
  Use the patient's first name. Be specific ("Show Marcus's A1C trend" not "Show lab trends"). Every chip must be answerable from the chart data alone.
PROMPT;

    // Follow-up turns: concise answer grounded in the same patient context
    private const FOLLOWUP_SYSTEM_PROMPT = <<<'PROMPT'
You are a Clinical Co-Pilot embedded in an EHR. Answer the physician's follow-up question concisely, grounded in the patient data provided earlier in this conversation.

Rules:
- Only state facts present in the patient data. Never fabricate clinical details.
- 1–3 sentences for simple answers. Be direct. Telegraphic style.
- For every specific data point, wrap in source markers: [[N]]the phrase[[/N]].
- Do not diagnose or recommend treatments.
- If a question has both a chart-answerable part and a general clinical part: answer the chart part directly first, then briefly note what falls outside the chart. Never redirect with "you could ask instead" — just answer what you can from the data.
- You have data for exactly one patient. If asked about any other patient by name, respond: "I only have access to [current patient first name]'s chart right now."
- If a question is entirely unanswerable from chart data (pure clinical reference), say so in one sentence and move on.
- For trend questions (multiple data points over time — lab values, weight, BP): format as a compact markdown table with columns Date | Value | Flag. Newest row first. Only include rows present in the data. Add a one-sentence trend summary after the table.
- At the very end of your response, on its own line, output exactly:
  SUGGESTIONS: followed by a JSON array of 0–2 follow-up questions answerable from this patient's chart data.

  Chip selection after follow-ups — pick naturally from what was just answered:
  - After a lab trend answer: suggest the medication context if relevant (e.g. "What medications is [first name] on for this condition?")
  - After a medication answer: suggest related lab results (e.g. "What do [first name]'s recent labs show since starting [drug]?")
  - After a history recap: suggest today's visit context (e.g. "What is today's appointment for?")
  - After a today's-visit answer: suggest an open item if one exists from the brief
  - Use [] if no follow-up fits naturally from the data just presented.
PROMPT;

    public function __construct(
        private readonly PatientBriefTool $briefTool,
        private readonly AgentAuditLogger $auditLogger,
    ) {}

    /**
     * Multi-turn chat: manages patient context in session, routes brief vs follow-up.
     *
     * @param list<array{role: string, content: string}> $messages Full conversation so far
     */
    public function streamChat(int $patientId, int $physicianId, array $messages): void
    {
        $startMs = (int) (microtime(true) * 1000);
        $apiKey  = $_ENV['ANTHROPIC_API_KEY'] ?? getenv('ANTHROPIC_API_KEY') ?: '';

        if (empty($apiKey)) {
            $this->emitEvent('error', ['message' => 'ANTHROPIC_API_KEY not configured on this server.']);
            return;
        }

        // Retrieve or gather patient context (cached per patient+physician in session)
        $sessionKey = "copilot_ctx_{$patientId}_{$physicianId}";
        $context    = $_SESSION[$sessionKey] ?? null;
        $toolsCalled = [];

        if ($context === null) {
            $toolStart   = (int) (microtime(true) * 1000);
            $patientData = $this->briefTool->gather($patientId, $physicianId);
            $toolDuration = (int) (microtime(true) * 1000) - $toolStart;

            ['message' => $contextMessage, 'sources' => $sources] = $this->buildUserMessage($patientData);

            $context = [
                'patient_data'    => $patientData,
                'context_message' => $contextMessage,
                'sources'         => $sources,
            ];
            $_SESSION[$sessionKey] = $context;

            $toolsCalled[] = [
                'name'        => 'PatientBriefTool',
                'duration_ms' => $toolDuration,
                'success'     => !empty($patientData['demographics']),
                'result_size' => strlen(json_encode($patientData) ?: ''),
            ];
        }

        // Emit source registry before streaming so citations render immediately
        $this->emitEvent('sources', ['sources' => $context['sources']]);

        // Build Anthropic messages: inject patient context into the first user message
        $isBrief      = count($messages) === 1;
        $systemPrompt = $isBrief ? self::BRIEF_SYSTEM_PROMPT : self::FOLLOWUP_SYSTEM_PROMPT;
        $apiMessages  = [];

        foreach ($messages as $i => $msg) {
            $content = $msg['content'];
            if ($i === 0 && $msg['role'] === 'user') {
                $content = $context['context_message'] . "\n\n" . $content;
            }
            $apiMessages[] = ['role' => $msg['role'], 'content' => $content];
        }

        $fullText     = '';
        $inputTokens  = 0;
        $outputTokens = 0;

        $this->streamAnthropicApi(
            apiKey:       $apiKey,
            systemPrompt: $systemPrompt,
            messages:     $apiMessages,
            onDelta:      function (string $text) use (&$fullText): void {
                $fullText .= $text;
                $this->emitEvent('delta', ['text' => $text]);
            },
            onUsage: function (int $in, int $out) use (&$inputTokens, &$outputTokens): void {
                $inputTokens  = $in;
                $outputTokens = $out;
            },
        );

        // Parse suggestions block from end of response
        $suggestions = [];
        if (preg_match('/\nSUGGESTIONS:\s*(\[.*?\])\s*$/s', $fullText, $m)) {
            $decoded = json_decode($m[1], true);
            if (is_array($decoded)) {
                $suggestions = array_values(array_filter($decoded, 'is_string'));
            }
        }

        if (!empty($suggestions)) {
            $this->emitEvent('suggestions', ['suggestions' => $suggestions]);
        }

        // Cache the brief on first turn
        if ($isBrief && !empty($fullText)) {
            $cleanText = preg_replace('/\nSUGGESTIONS:\s*\[.*?\]\s*$/s', '', $fullText) ?? $fullText;
            $this->saveCache($patientId, $physicianId, $context['patient_data'], $cleanText, $context['sources']);
        }

        $totalMs = (int) (microtime(true) * 1000) - $startMs;

        $this->auditLogger->log(
            physicianId:  $physicianId,
            patientId:    $patientId,
            queryText:    $messages[count($messages) - 1]['content'] ?? '',
            toolsCalled:  $toolsCalled,
            model:        self::MODEL,
            inputTokens:  $inputTokens,
            outputTokens: $outputTokens,
            totalMs:      $totalMs,
            verified:     true,
        );

        $this->emitEvent('done', [
            'cached'        => false,
            'total_ms'      => $totalMs,
            'input_tokens'  => $inputTokens,
            'output_tokens' => $outputTokens,
        ]);
    }

    /**
     * Legacy single-shot brief — used for cache hits without conversation history.
     */
    public function streamBrief(int $patientId, int $physicianId, bool $forceRefresh = false): void
    {
        $startMs = (int) (microtime(true) * 1000);
        $apiKey  = $_ENV['ANTHROPIC_API_KEY'] ?? getenv('ANTHROPIC_API_KEY') ?: '';

        if (empty($apiKey)) {
            $this->emitEvent('error', ['message' => 'ANTHROPIC_API_KEY not configured on this server.']);
            return;
        }

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

        // Route through streamChat with a single message
        $this->streamChat($patientId, $physicianId, [
            ['role' => 'user', 'content' => 'Brief me on this patient.'],
        ]);
    }

    /**
     * Builds the LLM user message and a structured source registry from gathered patient data.
     *
     * @param array<string,mixed> $patientData
     * @return array{message: string, sources: array<string, array{type: string, label: string, fields: list<array{key: string, value: string}>, scroll_to: string}>}
     */
    private function buildUserMessage(array $patientData): array
    {
        $sources = [];
        $idx     = 1;
        $lines   = [];

        // ── Appointment ──────────────────────────────────────────────────────
        $appt   = $patientData['today_appointment'];
        $reason = $appt ? ($appt['reason'] ?: 'Not specified') : 'None on file';
        $sources[(string) $idx] = [
            'type'      => 'appointment',
            'label'     => "Today's appointment",
            'fields'    => $this->compactFields([
                ['key' => 'Date',   'value' => $appt['date'] ?? ''],
                ['key' => 'Time',   'value' => $appt['time'] ?? ''],
                ['key' => 'Reason', 'value' => $reason],
            ]),
            'scroll_to' => '#appointments_ps_expand',
        ];
        $lines[] = "[{$idx}] Today's appointment: {$reason}";
        $idx++;

        // ── Last encounter ────────────────────────────────────────────────────
        $enc = $patientData['last_encounter'];
        if ($enc) {
            $encDate    = $enc['date'] ?? 'unknown';
            $soap       = $enc['soap'] ?? [];
            $assessment = trim($soap['assessment'] ?? '');
            $plan       = trim($soap['plan'] ?? '');
            $subjective = trim($soap['subjective'] ?? '');
            $sources[(string) $idx] = [
                'type'      => 'encounter',
                'label'     => "Encounter {$encDate}",
                'fields'    => $this->compactFields([
                    ['key' => 'Date',        'value' => $encDate],
                    ['key' => 'Reason',      'value' => $enc['reason'] ?? ''],
                    ['key' => 'Subjective',  'value' => $subjective],
                    ['key' => 'Assessment',  'value' => $assessment],
                    ['key' => 'Plan',        'value' => $plan],
                ]),
                'scroll_to' => '#appointments_ps_expand',
            ];
            $lines[] = "[{$idx}] Last encounter ({$encDate}): " . ($assessment ?: 'No assessment');
        } else {
            $sources[(string) $idx] = [
                'type'      => 'encounter',
                'label'     => 'Last encounter',
                'fields'    => [['key' => 'Note', 'value' => 'No prior encounters on file']],
                'scroll_to' => '',
            ];
            $lines[] = "[{$idx}] Last encounter: none";
        }
        $idx++;

        // ── Medications ───────────────────────────────────────────────────────
        $meds = $patientData['active_medications'];
        if (empty($meds)) {
            $sources[(string) $idx] = [
                'type'      => 'medication',
                'label'     => 'Active medications',
                'fields'    => [['key' => 'Note', 'value' => 'None documented']],
                'scroll_to' => '#prescriptions_ps_expand',
            ];
            $lines[] = "[{$idx}] Medications: none documented";
            $idx++;
        } else {
            foreach ($meds as $med) {
                $label = trim("{$med['drug']} {$med['dosage']} {$med['unit']}");
                $sources[(string) $idx] = [
                    'type'      => 'medication',
                    'label'     => $label,
                    'fields'    => $this->compactFields([
                        ['key' => 'Drug',      'value' => $med['drug'] ?? ''],
                        ['key' => 'Dose',      'value' => trim(($med['dosage'] ?? '') . ' ' . ($med['unit'] ?? ''))],
                        ['key' => 'Route',     'value' => $med['route'] ?? ''],
                        ['key' => 'Frequency', 'value' => $med['interval'] ?? ''],
                        ['key' => 'Notes',     'value' => $med['note'] ?? ''],
                    ]),
                    'scroll_to' => '#prescriptions_ps_expand',
                ];
                $lines[] = "[{$idx}] Medication: {$label}" . ($med['interval'] ? " ({$med['interval']})" : '');
                $idx++;
            }
        }

        // ── Labs ──────────────────────────────────────────────────────────────
        $labs = $patientData['recent_labs'];
        if (empty($labs)) {
            $sources[(string) $idx] = [
                'type'      => 'lab',
                'label'     => 'Recent labs',
                'fields'    => [['key' => 'Note', 'value' => 'None on file']],
                'scroll_to' => '#labdata_ps_expand',
            ];
            $lines[] = "[{$idx}] Labs: none on file";
        } else {
            foreach ($labs as $lab) {
                $result = trim(($lab['value'] ?? '') . ' ' . ($lab['units'] ?? ''));
                $status = $lab['abnormal'] ? "ABNORMAL ({$lab['abnormal']})" : 'Within range';
                $label  = "{$lab['test']}: {$result}";
                $sources[(string) $idx] = [
                    'type'     => 'lab',
                    'label'    => $label,
                    'fields'   => $this->compactFields([
                        ['key' => 'Test',      'value' => $lab['test'] ?? ''],
                        ['key' => 'Result',    'value' => $result],
                        ['key' => 'Reference', 'value' => $lab['range'] ?? ''],
                        ['key' => 'Status',    'value' => $status],
                        ['key' => 'Collected', 'value' => $lab['date_collected'] ?? ''],
                    ]),
                    'scroll_to' => '#labdata_ps_expand',
                ];
                $flag    = $lab['abnormal'] ? " [ABNORMAL: {$lab['abnormal']}]" : '';
                $lines[] = "[{$idx}] Lab: {$label}{$flag}" . ($lab['date_collected'] ? " — {$lab['date_collected']}" : '');
                $idx++;
            }
        }

        $demo    = $patientData['demographics'];
        $name    = $demo['name'] ?? 'Unknown';
        $age     = $demo['age'] ?? '';
        $sex     = $demo['sex'] ?? '';
        $srcBlock = implode("\n", $lines);

        $message = <<<TEXT
Brief this patient. Cite source numbers inline using [[N]]phrase[[/N]] markers.

PATIENT: {$name}, {$age}y {$sex}

SOURCES:
{$srcBlock}
TEXT;

        return ['message' => $message, 'sources' => $sources];
    }

    /**
     * @param list<array{key: string, value: string}> $fields
     * @return list<array{key: string, value: string}>
     */
    private function compactFields(array $fields): array
    {
        return array_values(
            array_filter($fields, fn(array $f): bool => trim($f['value']) !== '')
        );
    }

    /**
     * @param list<array{role: string, content: string}> $messages
     */
    private function streamAnthropicApi(
        string $apiKey,
        string $systemPrompt,
        array $messages,
        \Closure $onDelta,
        \Closure $onUsage,
    ): void {
        $payload = json_encode([
            'model'      => self::MODEL,
            'max_tokens' => self::MAX_TOKENS,
            'stream'     => true,
            'system'     => $systemPrompt,
            'messages'   => $messages,
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
