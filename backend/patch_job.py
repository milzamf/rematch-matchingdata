import re

with open('app/Jobs/RunMatchingJob.php', 'r') as f:
    code = f.read()

# Update timeout and tries
code = code.replace("public int $timeout = 3600;", "public int $timeout = 600;")
code = code.replace("public int $tries = 1;", "public int $tries = 3;")

# Add failed method at the end
hook = """
    public function failed(\Throwable $exception): void
    {
        \Log::error("RunMatchingJob permanent failure: " . $exception->getMessage());
        MatchingJob::where('id', $this->matchingJobId)->update([
            'status' => 'failed',
            'error_message' => $exception->getMessage(),
        ]);
    }
}"""
code = code.replace("}\n", hook)
# Ensure we don't accidentally replace the wrong '}' if there are multiple at the end
# Better to use regex for the last closing brace
code = re.sub(r"}\s*$", hook, code)

with open('app/Jobs/RunMatchingJob.php', 'w') as f:
    f.write(code)
print("PATCHED JOB")
