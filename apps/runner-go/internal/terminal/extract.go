package terminal

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"time"
)

// ExtractionResult holds the extracted answer from a terminal session. The
// Confidence score (0.0-1.0) is passed to the judge so it can weight panel
// inputs accordingly.
type ExtractionResult struct {
	Answer     string
	Confidence float64
	Strategy   string
	RawBytes   int
	Duration   time.Duration
	Warnings   []string
	ExitCode   int
}

// ExtractionStrategy is the interface implemented by each extraction
// strategy. Process is called for every chunk of PTY output. Finalize is
// called when the CLI process exits. A non-nil return from either method
// produces the final result.
type ExtractionStrategy interface {
	Name() string
	Process(chunk []byte) *ExtractionResult
	Finalize() *ExtractionResult
}

// Extractor runs the strategy chain. It consumes chunks from the byte pump
// and produces a single ExtractionResult on ResultCh.
type Extractor struct {
	strategies []ExtractionStrategy
	Input      chan []byte
	Done       chan struct{}
	ResultCh   chan ExtractionResult
	ringBuffer *RingBuffer
}

// NewExtractor creates an extractor with the standard strategy chain:
// sentinel → NDJSON → scrollback → process-exit.
func NewExtractor(ringBuffer *RingBuffer) *Extractor {
	return &Extractor{
		strategies: []ExtractionStrategy{
			NewSentinelStrategy(),
			NewNDJSONStrategy(),
			NewScrollbackStrategy(ringBuffer),
			NewProcessExitStrategy(ringBuffer),
		},
		Input:      make(chan []byte, 256),
		Done:       make(chan struct{}),
		ResultCh:   make(chan ExtractionResult, 1),
		ringBuffer: ringBuffer,
	}
}

// Run consumes chunks until the process exits (Done is closed), then
// finalizes all strategies and emits the best result.
func (e *Extractor) Run() {
	for {
		select {
		case chunk := <-e.Input:
			for _, strategy := range e.strategies {
				result := strategy.Process(chunk)
				if result != nil {
					e.ResultCh <- *result
					return
				}
			}
		case <-e.Done:
			// Drain any pending chunks before finalizing.
			for {
				select {
				case chunk := <-e.Input:
					for _, strategy := range e.strategies {
						result := strategy.Process(chunk)
						if result != nil {
							e.ResultCh <- *result
							return
						}
					}
				default:
					goto finalize
				}
			}
		finalize:
			var best *ExtractionResult
			for _, strategy := range e.strategies {
				result := strategy.Finalize()
				if result != nil {
					if best == nil || result.Confidence > best.Confidence {
						best = result
					}
				}
			}
			if best != nil {
				e.ResultCh <- *best
			} else {
				e.ResultCh <- ExtractionResult{
					Answer:     "",
					Confidence: 0.0,
					Strategy:   "none",
					Warnings:   []string{"no extraction strategy produced a result"},
				}
			}
			return
		}
	}
}

// --- Strategy 1: Sentinel Markers ---

var (
	sentinelStartRe = regexp.MustCompile(`===FUSION_ANSWER_START===`)
	sentinelEndRe   = regexp.MustCompile(`===FUSION_ANSWER_END===`)
)

type SentinelStrategy struct {
	buffer []byte
	found  bool
}

func NewSentinelStrategy() *SentinelStrategy {
	return &SentinelStrategy{}
}

func (s *SentinelStrategy) Name() string { return "sentinel" }

func (s *SentinelStrategy) Process(chunk []byte) *ExtractionResult {
	s.buffer = append(s.buffer, chunk...)

	startIdx := sentinelStartRe.FindIndex(s.buffer)
	if startIdx == nil {
		return nil
	}

	endIdx := sentinelEndRe.FindIndex(s.buffer[startIdx[1]:])
	if endIdx == nil {
		return nil
	}

	answerStart := startIdx[1]
	answerEnd := startIdx[1] + endIdx[0]
	raw := s.buffer[answerStart:answerEnd]
	clean := strings.TrimSpace(stripANSI(string(raw)))

	s.found = true

	confidence := 0.85
	if len(clean) < 50 {
		confidence = 0.6
	}

	return &ExtractionResult{
		Answer:     clean,
		Confidence: confidence,
		Strategy:   "sentinel",
		Warnings:   []string{},
	}
}

func (s *SentinelStrategy) Finalize() *ExtractionResult {
	if s.found {
		return nil
	}
	startIdx := sentinelStartRe.FindIndex(s.buffer)
	if startIdx != nil {
		raw := s.buffer[startIdx[1]:]
		clean := strings.TrimSpace(stripANSI(string(raw)))
		if len(clean) > 0 {
			return &ExtractionResult{
				Answer:     clean,
				Confidence: 0.5,
				Strategy:   "sentinel",
				Warnings:   []string{"end marker not found, took all text after start marker"},
			}
		}
	}
	return nil
}

// --- Strategy 2: NDJSON Parsing ---

type NDJSONStrategy struct {
	lineBuf      []byte
	texts        []string
	jsonDetected bool
}

func NewNDJSONStrategy() *NDJSONStrategy {
	return &NDJSONStrategy{}
}

func (s *NDJSONStrategy) Name() string { return "ndjson" }

func (s *NDJSONStrategy) Process(chunk []byte) *ExtractionResult {
	s.lineBuf = append(s.lineBuf, chunk...)
	for {
		idx := bytes.IndexByte(s.lineBuf, '\n')
		if idx == -1 {
			break
		}
		line := s.lineBuf[:idx]
		s.lineBuf = s.lineBuf[idx+1:]
		s.processLine(line)
	}
	return nil
}

func (s *NDJSONStrategy) processLine(line []byte) {
	trimmed := bytes.TrimSpace(line)
	if len(trimmed) == 0 || (trimmed[0] != '{' && trimmed[0] != '[') {
		return
	}
	s.jsonDetected = true
	var obj map[string]any
	if err := json.Unmarshal(trimmed, &obj); err != nil {
		return
	}
	eventType, _ := obj["type"].(string)
	switch {
	case eventType == "message" || eventType == "result" ||
		eventType == "completed" || eventType == "final":
		if text := extractTextField(obj); text != "" {
			s.texts = append(s.texts, text)
		}
	case eventType == "reasoning_summary_text.done":
		if text := extractTextField(obj); text != "" {
			s.texts = append(s.texts, text)
		}
	}
}

func (s *NDJSONStrategy) Finalize() *ExtractionResult {
	if !s.jsonDetected || len(s.texts) == 0 {
		return nil
	}
	answer := strings.Join(s.texts, "\n\n")
	confidence := 0.95
	if len(answer) < 50 {
		confidence = 0.7
	}
	return &ExtractionResult{
		Answer:     answer,
		Confidence: confidence,
		Strategy:   "ndjson",
	}
}

// extractTextField searches an NDJSON object for text content. Priority:
// text > content > message > answer > response. Also checks nested objects.
func extractTextField(obj map[string]any) string {
	for _, key := range []string{"text", "content", "message", "answer", "response"} {
		if val, ok := obj[key].(string); ok && val != "" {
			return val
		}
	}
	for _, nestedKey := range []string{"part", "data", "payload"} {
		if nested, ok := obj[nestedKey].(map[string]any); ok {
			for _, key := range []string{"text", "content"} {
				if val, ok := nested[key].(string); ok && val != "" {
					return val
				}
			}
		}
	}
	return ""
}

// --- Strategy 3: Scrollback Scrape ---

var defaultChromePatterns = []*regexp.Regexp{
	regexp.MustCompile(`^\s*[░▒▓█]+\s*$`),
	regexp.MustCompile(`^\s*[╔╗╚╝║═╠╣╦╩╬]+\s*$`),
	regexp.MustCompile(`^\s*\.{3,}\s*$`),
	regexp.MustCompile(`^\s*(⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s*$`),
	regexp.MustCompile(`^\s*\[[=|*\-]+\]\s*\d*%?\s*$`),
	regexp.MustCompile(`^\s*(Loading|Working|Thinking|Processing)\.\.\.\s*$`),
}

type ScrollbackStrategy struct {
	ringBuffer *RingBuffer
}

func NewScrollbackStrategy(ringBuffer *RingBuffer) *ScrollbackStrategy {
	return &ScrollbackStrategy{ringBuffer: ringBuffer}
}

func (s *ScrollbackStrategy) Name() string { return "scrollback" }

func (s *ScrollbackStrategy) Process(chunk []byte) *ExtractionResult {
	return nil
}

func (s *ScrollbackStrategy) Finalize() *ExtractionResult {
	raw := s.ringBuffer.Bytes()
	if len(raw) == 0 {
		return nil
	}
	text := string(raw)
	text = stripAlternateScreen(text)
	text = stripANSI(text)

	lines := strings.Split(text, "\n")
	var kept []string
	for _, line := range lines {
		if isChromeLine(line) {
			continue
		}
		kept = append(kept, line)
	}
	text = collapseBlankLines(strings.Join(kept, "\n"))
	text = strings.TrimSpace(text)
	if len(text) == 0 {
		return nil
	}

	confidence := 0.5
	if len(text) < 100 {
		confidence = 0.2
	} else if len(text) > 500 {
		confidence = 0.6
	}

	return &ExtractionResult{
		Answer:     text,
		Confidence: confidence,
		Strategy:   "scrollback",
		Warnings:   []string{"no sentinels or JSON detected, answer scraped from terminal output"},
	}
}

func isChromeLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	for _, re := range defaultChromePatterns {
		if re.MatchString(trimmed) {
			return true
		}
	}
	if isBoxDrawingOnly(trimmed) {
		return true
	}
	return false
}

// --- Strategy 4: Process Exit (Final Fallback) ---

type ProcessExitStrategy struct {
	ringBuffer *RingBuffer
}

func NewProcessExitStrategy(ringBuffer *RingBuffer) *ProcessExitStrategy {
	return &ProcessExitStrategy{ringBuffer: ringBuffer}
}

func (s *ProcessExitStrategy) Name() string { return "process_exit" }

func (s *ProcessExitStrategy) Process(chunk []byte) *ExtractionResult {
	return nil
}

func (s *ProcessExitStrategy) Finalize() *ExtractionResult {
	raw := s.ringBuffer.Bytes()
	text := strings.TrimSpace(stripANSI(string(raw)))
	if len(text) == 0 {
		return &ExtractionResult{
			Answer:     "",
			Confidence: 0.0,
			Strategy:   "process_exit",
			Warnings:   []string{"no output produced by CLI"},
		}
	}
	return &ExtractionResult{
		Answer:     text,
		Confidence: 0.2,
		Strategy:   "process_exit",
		Warnings:   []string{"all extraction strategies failed, returning raw terminal output"},
	}
}
