<?php

// Stop only our resumable maintenance command; never a queue worker or MySQL.
foreach (glob('/proc/[0-9]*/cmdline') as $file) {
    $args = explode("\0", file_get_contents($file));
    if (($args[0] ?? '') !== 'php' || ($args[1] ?? '') !== 'scripts/prune_unused_matching_data.php') continue;
    $pid = (int) basename(dirname($file));
    echo "Maintenance PID {$pid}".PHP_EOL;
    if (in_array('--apply', $argv, true) && !posix_kill($pid, SIGTERM)) throw new RuntimeException('Could not stop maintenance.');
}
