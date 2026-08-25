$lines = file(".env", FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
$new = [];
foreach ($lines as $l) {
    $clean = preg_replace("/[^\x20-\x7E]/", "", $l);
    if (!str_starts_with($clean, "MEILISEARCH") && !empty($clean)) {
        $new[] = $clean;
    }
}
$new[] = "MEILISEARCH_HOST=http://127.0.0.1:7700";
$new[] = "MEILISEARCH_KEY=";
file_put_contents(".env", implode("\n", $new));
