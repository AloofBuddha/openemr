<?php

/**
 * Shared bootstrap for Clinical Co-Pilot public endpoints.
 *
 * Registers a PSR-4 autoloader for the module namespace. Sourced via
 * ``require_once __DIR__ . '/_bootstrap.php';`` from each endpoint AFTER
 * OpenEMR's ``globals.php`` is loaded (so `dirname(__FILE__, 5)` already
 * resolved).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

spl_autoload_register(function (string $class): void {
    $prefix = 'OpenEMR\\Modules\\ClinicalCopilot\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = dirname(__DIR__) . '/src/' . $relative . '.php';
    if (file_exists($file)) {
        require_once $file;
    }
});
