<?php

/**
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\ClinicalCopilot\Agent\Prompts;

/**
 * Pulls the trailing ``SUGGESTIONS: [...]`` block out of an LLM response.
 *
 * Both the W1 system prompts (BRIEF and FOLLOWUP) instruct Claude to emit a
 * JSON array of follow-up questions on its own line at the end. This class
 * recovers that array; missing/malformed input returns an empty list and
 * the caller decides whether to fall back to a default chip.
 */
final class SuggestionParser
{
    /** @return list<string> */
    public static function parse(string $fullText): array
    {
        $sugPos = strrpos($fullText, 'SUGGESTIONS:');
        if ($sugPos === false) {
            return [];
        }

        $rest = ltrim(substr($fullText, $sugPos + strlen('SUGGESTIONS:')));
        // Greedy match — handles arrays that span multiple lines.
        if (!preg_match('/(\[.*\])/s', $rest, $m)) {
            return [];
        }

        $decoded = json_decode($m[1], true);
        if (!is_array($decoded)) {
            return [];
        }

        return array_values(array_filter($decoded, 'is_string'));
    }
}
