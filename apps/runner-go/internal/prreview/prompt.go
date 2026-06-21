package prreview

import (
	"fmt"
	"strings"
)

func BuildReviewPrompt(ctx *ReviewContext, req Request) string {
	var b strings.Builder

	b.WriteString("You are a senior full-stack developer performing a code review on a pull request.\n\n")

	b.WriteString("Review priorities (in order):\n")
	b.WriteString("1. Correctness: bugs, logic errors, race conditions, data corruption\n")
	b.WriteString("2. Security: injection, auth bypass, secrets exposure, SSRF, XSS\n")
	b.WriteString("3. Data integrity: missing validations, unsafe mutations, IDOR\n")
	b.WriteString("4. Accessibility: missing ARIA, keyboard traps, contrast\n")
	b.WriteString("5. Performance: N+1 queries, unnecessary re-renders, memory leaks\n")
	b.WriteString("6. Missing tests for critical paths\n")
	b.WriteString("7. Maintainability issues that will cause future bugs\n\n")

	b.WriteString("Rules:\n")
	b.WriteString("- Avoid style-only comments unless they prevent maintainability issues.\n")
	b.WriteString("- Comment only on changed lines when possible.\n")
	b.WriteString("- If a finding cannot be mapped to a diff line, put it in the summary instead of forcing a wrong line comment.\n")
	b.WriteString("- Do not include secrets, tokens, or full private file contents in output.\n")
	b.WriteString("- Return JSON only, no markdown fences, no explanation outside JSON.\n\n")

	b.WriteString(ctx.RepoIntelligence)
	b.WriteString("\n\n")

	b.WriteString("## Pull Request Metadata\n\n")
	b.WriteString(fmt.Sprintf("Repository: %s\n", req.RepoFullName))
	b.WriteString(fmt.Sprintf("PR Number: %d\n", req.PullNumber))
	b.WriteString(fmt.Sprintf("Base: %s (%s)\n", req.BaseRef, req.BaseSha[:min(12, len(req.BaseSha))]))
	b.WriteString(fmt.Sprintf("Head: %s (%s)\n", req.HeadRef, req.HeadSha[:min(12, len(req.HeadSha))]))
	b.WriteString(fmt.Sprintf("Review depth: %s\n", req.ReviewDepth))
	b.WriteString(fmt.Sprintf("Max comments: %d\n\n", req.MaxComments))

	b.WriteString("## Changed Files\n\n")
	for _, change := range ctx.ChangedFiles {
		b.WriteString(fmt.Sprintf("- %s (%s, +%d/-%d)\n", change.Path, change.Status, change.Additions, change.Deletions))
	}
	b.WriteString("\n\n")

	b.WriteString("## File Contents (before/after)\n\n")
	for path, pair := range ctx.FileContents {
		b.WriteString(fmt.Sprintf("### %s\n\n", path))
		if pair.Before != "" {
			b.WriteString("Before:\n```\n")
			b.WriteString(truncate(pair.Before, 3000))
			b.WriteString("\n```\n\n")
		}
		if pair.After != "" {
			b.WriteString("After:\n```\n")
			b.WriteString(truncate(pair.After, 3000))
			b.WriteString("\n```\n\n")
		}
	}

	b.WriteString("## Unified Diff\n\n```\n")
	b.WriteString(truncate(ctx.DiffText, 20000))
	b.WriteString("\n```\n\n")

	b.WriteString("## Output Format\n\n")
	b.WriteString("Return ONLY a JSON object with this exact schema:\n\n")
	b.WriteString("{\n")
	b.WriteString("  \"summary\": \"Short senior-review summary of the PR\",\n")
	b.WriteString("  \"riskLevel\": \"low | medium | high\",\n")
	b.WriteString("  \"decision\": \"comment | request_changes | approve\",\n")
	b.WriteString("  \"findings\": [\n")
	b.WriteString("    {\n")
	b.WriteString("      \"severity\": \"blocker | major | minor | nit\",\n")
	b.WriteString("      \"category\": \"bug | security | performance | maintainability | test | ux | accessibility | docs\",\n")
	b.WriteString("      \"filePath\": \"path/to/file.ts\",\n")
	b.WriteString("      \"side\": \"RIGHT\",\n")
	b.WriteString("      \"startLine\": 12,\n")
	b.WriteString("      \"line\": 18,\n")
	b.WriteString("      \"body\": \"Review comment written for a human developer.\",\n")
	b.WriteString("      \"suggestedChange\": \"Optional code suggestion block\",\n")
	b.WriteString("      \"confidence\": 0.86,\n")
	b.WriteString("      \"evidence\": \"Why this is a real issue\"\n")
	b.WriteString("    }\n")
	b.WriteString("  ]\n")
	b.WriteString("}\n\n")

	b.WriteString("Severity guidelines:\n")
	b.WriteString("- blocker: must fix before merge (security hole, data loss, crash)\n")
	b.WriteString("- major: should fix before merge (likely bug, missing auth check)\n")
	b.WriteString("- minor: nice to fix (edge case, minor perf)\n")
	b.WriteString("- nit: optional (naming, minor style)\n\n")

	b.WriteString("Use side RIGHT for lines in the new version, LEFT for lines in the old version.\n")
	b.WriteString("For single-line comments, omit startLine. For multi-line, set startLine to the first line.\n")
	b.WriteString("Return the JSON object now.\n")

	return b.String()
}

func truncate(text string, max int) string {
	if len(text) <= max {
		return text
	}
	return text[:max] + "\n... (truncated)"
}
