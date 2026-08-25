$lines = file(".env", FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
$new = [];
$updated = [
    "APP_URL" => "http://localhost:8000",
    "FRONTEND_URL" => "http://localhost:8080",
    "SANCTUM_STATEFUL_DOMAINS" => "localhost:8080,127.0.0.1:8080",
    "SESSION_DOMAIN" => "localhost",
    "SESSION_DRIVER" => "cookie"
];

foreach ($lines as $l) {
    $clean = preg_replace("/[^\x20-\x7E]/", "", $l);
    if (empty($clean)) continue;
    
    $parts = explode("=", $clean, 2);
    $key = trim($parts[0]);
    
    if (isset($updated[$key])) {
        $new[] = "$key=" . $updated[$key];
        unset($updated[$key]);
    } else {
        $new[] = $clean;
    }
}

foreach ($updated as $k => $v) {
    $new[] = "$k=$v";
}

file_put_contents(".env", implode("\n", $new));
