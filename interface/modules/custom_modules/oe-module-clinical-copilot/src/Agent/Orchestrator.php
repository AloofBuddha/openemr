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

use OpenEMR\Modules\ClinicalCopilot\Agent\Prompts\SuggestionParser;
use OpenEMR\Modules\ClinicalCopilot\Agent\Prompts\SystemPrompts;
use OpenEMR\Modules\ClinicalCopilot\Agent\Tools\PatientBriefTool;
use OpenEMR\Modules\ClinicalCopilot\Authorization\PatientAccessGuard;
use OpenEMR\Modules\ClinicalCopilot\Authorization\UnauthorizedPatientAccessException;
use OpenEMR\Modules\ClinicalCopilot\Observability\AgentAuditLogger;

/**
 * Week-1 single-patient chat orchestrator.
 *
 * Flow per request:
 *   1. Authz check (defence-in-depth — public endpoint already checked).
 *   2. Look up cached patient context for (patient, physician, today). On
 *      miss, gather via PatientBriefTool and build the LLM message + UI
 *      source registry via PatientContextBuilder.
 *   3. Emit ``snapshot`` and ``sources`` SSE events so the UI can render
 *      its patient card before the LLM produces any tokens.
 *   4. Pick BRIEF prompt for the first turn, FOLLOWUP for any follow-up.
 *   5. Stream Claude → emit ``delta`` events.
 *   6. Pull suggestion chips out of the trailing SUGGESTIONS block; emit
 *      ``suggestions`` and ``done`` events.
 *   7. Audit-log the whole interaction with token counts and timing.
 */
final class Orchestrator
{
    private const MODEL      = 'claude-sonnet-4-6';
    private const MAX_TOKENS = 2000;
    /** @var list<string> Used when Sonnet omits the SUGGESTIONS block — 2 generic + 1 guidelines. */
    private const FALLBACK_SUGGESTIONS = [
        'What is the most pressing item for today\'s visit?',
        'Are there any pending follow-ups from prior visits?',
        'What do guidelines say about this patient\'s conditions?',
    ];

    public function __construct(
        private readonly PatientBriefTool $briefTool,
        private readonly AgentAuditLogger $auditLogger,
        private readonly PatientAccessGuard $accessGuard,
        private readonly PatientContextBuilder $contextBuilder = new PatientContextBuilder(),
    ) {
    }

    /**
     * @param list<array{role: string, content: string}> $messages Full conversation so far
     */
    public function streamChat(int $patientId, int $physicianId, array $messages): void
    {
        try {
            $this->accessGuard->assertAccess($physicianId, $patientId);
        } catch (UnauthorizedPatientAccessException) {
            $this->emitEvent('error', ['message' => 'Access denied.']);
            return;
        }

        $apiKey = $_ENV['ANTHROPIC_API_KEY'] ?? getenv('ANTHROPIC_API_KEY') ?: '';
        if (empty($apiKey)) {
            $this->emitEvent('error', ['message' => 'ANTHROPIC_API_KEY not configured on this server.']);
            return;
        }

        $startMs = (int) (microtime(true) * 1000);
        ['context' => $context, 'tools_called' => $toolsCalled] =
            $this->loadOrBuildContext($patientId, $physicianId);

        if (empty($context['patient_data']['demographics'])) {
            $this->emitEvent('error', ['message' => 'Patient record not found or data unavailable.']);
            return;
        }

        // Snapshot fires first — frontend renders the patient card immediately, before LLM starts.
        $this->emitEvent('snapshot', $this->contextBuilder->buildSnapshot($context['patient_data']));
        $this->emitEvent('sources', ['sources' => $context['sources']]);

        // BRIEF runs when the physician has only sent one message — the
        // initial "brief me" request. Synthetic assistant messages from
        // intake auto-processing don't count, so check user messages only.
        $userMessageCount = count(array_filter(
            $messages,
            static fn(array $m): bool => ($m['role'] ?? '') === 'user',
        ));
        $isBrief = $userMessageCount === 1;
        $systemPrompt = $isBrief ? SystemPrompts::BRIEF : SystemPrompts::FOLLOWUP;
        $apiMessages  = $this->injectContextIntoFirstUserMessage($messages, $context['context_message']);

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
                if ($in > 0) {
                    $inputTokens = $in;
                }
                if ($out > 0) {
                    $outputTokens = $out;
                }
            },
        );

        $suggestions = SuggestionParser::parse($fullText);
        if (count($suggestions) < 3 && $isBrief) {
            // BRIEF must always present 3 chips (2 generic + 1 guidelines).
            // If Sonnet omitted the block or returned fewer, top up with the
            // fallback in order — keeping any chips Sonnet did produce.
            foreach (self::FALLBACK_SUGGESTIONS as $fallback) {
                if (count($suggestions) >= 3) {
                    break;
                }
                if (!in_array($fallback, $suggestions, true)) {
                    $suggestions[] = $fallback;
                }
            }
        }
        if (empty($suggestions)) {
            $suggestions = self::FALLBACK_SUGGESTIONS;
        }
        $this->emitEvent('suggestions', ['suggestions' => $suggestions]);

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
     * Look up cached context for (patient, physician, today); build it if absent.
     *
     * The session key includes the date so cached data auto-refreshes daily —
     * picks up new appointments, labs, etc. without an explicit invalidation.
     *
     * @return array{
     *   context: array{patient_data: array<string,mixed>, context_message: string, sources: array<string,mixed>},
     *   tools_called: list<array<string,mixed>>
     * }
     */
    private function loadOrBuildContext(int $patientId, int $physicianId): array
    {
        $sessionKey = "copilot_ctx_{$patientId}_{$physicianId}_" . date('Y-m-d');
        $context    = $_SESSION[$sessionKey] ?? null;
        if ($context !== null) {
            return ['context' => $context, 'tools_called' => []];
        }

        $toolStart    = (int) (microtime(true) * 1000);
        $patientData  = $this->briefTool->gather($patientId, $physicianId);
        $toolDuration = (int) (microtime(true) * 1000) - $toolStart;

        ['message' => $contextMessage, 'sources' => $sources] =
            $this->contextBuilder->buildUserMessage($patientData);

        $context = [
            'patient_data'    => $patientData,
            'context_message' => $contextMessage,
            'sources'         => $sources,
        ];
        $_SESSION[$sessionKey] = $context;

        return [
            'context'      => $context,
            'tools_called' => [[
                'name'        => 'PatientBriefTool',
                'duration_ms' => $toolDuration,
                'success'     => !empty($patientData['demographics']),
                'result_size' => strlen(json_encode($patientData) ?: ''),
            ]],
        ];
    }

    /**
     * Prepend the patient context block to the first user message so Claude
     * has the data even on the very first turn.
     *
     * @param list<array{role: string, content: string}> $messages
     * @return list<array{role: string, content: string}>
     */
    private function injectContextIntoFirstUserMessage(array $messages, string $contextMessage): array
    {
        $out = [];
        $injected = false;
        foreach ($messages as $msg) {
            $content = $msg['content'];
            if (!$injected && $msg['role'] === 'user') {
                $content = $contextMessage . "\n\n" . $content;
                $injected = true;
            }
            $out[] = ['role' => $msg['role'], 'content' => $content];
        }
        return $out;
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
                    } elseif ($type === 'message_delta') {
                        $usage = $event['usage'] ?? [];
                        $onUsage(0, (int) ($usage['output_tokens'] ?? 0));
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

    /** @param array<string,mixed> $data */
    private function emitEvent(string $type, array $data): void
    {
        echo "event: {$type}\n";
        echo 'data: ' . json_encode($data) . "\n\n";
        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }
}
