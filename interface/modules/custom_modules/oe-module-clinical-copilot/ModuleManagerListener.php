<?php

/**
 * Clinical Co-Pilot Module Manager Listener
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

use OpenEMR\Core\AbstractModuleActionListener;

class ModuleManagerListener extends AbstractModuleActionListener
{
    public function __construct()
    {
        parent::__construct();
    }

    public function moduleManagerAction($methodName, $modId, string $currentActionStatus = 'Success'): string
    {
        if (method_exists(self::class, $methodName)) {
            return self::$methodName($modId, $currentActionStatus);
        }
        return $currentActionStatus;
    }

    public static function getModuleNamespace(): string
    {
        return 'OpenEMR\\Modules\\ClinicalCopilot\\';
    }

    public static function initListenerSelf(): ModuleManagerListener
    {
        return new self();
    }

    private function install($modId, $currentActionStatus): string
    {
        $sqlFile = __DIR__ . '/sql/install.sql';
        if (!file_exists($sqlFile)) {
            return $currentActionStatus;
        }
        $sql = file_get_contents($sqlFile);
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) {
            sqlStatement($statement);
        }
        return $currentActionStatus;
    }

    private function enable($modId, $currentActionStatus): string
    {
        return $currentActionStatus;
    }

    private function disable($modId, $currentActionStatus): string
    {
        return $currentActionStatus;
    }

    private function unregister($modId, $currentActionStatus): string
    {
        return $currentActionStatus;
    }
}
