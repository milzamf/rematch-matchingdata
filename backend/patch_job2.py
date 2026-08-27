with open('app/Jobs/RunMatchingJob.php', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "public int $timeout = 3600;" in line:
        lines[i] = line.replace("3600;", "600;")
    if "public int $tries = 1;" in line:
        lines[i] = line.replace("1;", "3;")

# Find the last closing brace and insert before it
for i in range(len(lines)-1, -1, -1):
    if lines[i].strip() == "}":
        lines.insert(i, """
    public function failed(\Throwable $exception): void
    {
        \Log::error("RunMatchingJob permanent failure: " . $exception->getMessage());
        MatchingJob::where('id', $this->matchingJobId)->update([
            'status' => 'failed',
            'error_message' => $exception->getMessage(),
        ]);
    }
""")
        break

with open('app/Jobs/RunMatchingJob.php', 'w') as f:
    f.writelines(lines)
print("PATCHED JOB LINES")
