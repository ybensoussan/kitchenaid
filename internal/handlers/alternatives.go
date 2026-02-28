package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

type alternativesReq struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
	Unit   string  `json:"unit"`
	Notes  string  `json:"notes"`
}

type Alternative struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
	Unit   string  `json:"unit"`
	Notes  string  `json:"notes"`
	Tip    string  `json:"tip"`
}

func (h *Handler) FindAlternatives(w http.ResponseWriter, r *http.Request) {
	var req alternativesReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		h.writeError(w, http.StatusBadRequest, "name required")
		return
	}

	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		h.writeError(w, http.StatusServiceUnavailable, "ANTHROPIC_API_KEY not configured")
		return
	}

	alts, err := fetchAlternatives(apiKey, req)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{"alternatives": alts})
}

func fetchAlternatives(apiKey string, req alternativesReq) ([]Alternative, error) {
	// Build ingredient description
	desc := req.Name
	if req.Amount > 0 && req.Unit != "" {
		desc = fmt.Sprintf("%.4g %s %s", req.Amount, req.Unit, req.Name)
	} else if req.Amount > 0 {
		desc = fmt.Sprintf("%.4g %s", req.Amount, req.Name)
	}
	if req.Notes != "" {
		desc += " (" + req.Notes + ")"
	}

	prompt := fmt.Sprintf(`A recipe calls for: %s.
Suggest 4 practical substitutes. Reply with a JSON array only — no prose, no markdown fences:
[{"name":"...","amount":number_or_0,"unit":"...","notes":"...","tip":"one-sentence tip"},...]
Match the unit system of the original. Use 0 for amount when quantity does not apply.`, desc)

	body, _ := json.Marshal(map[string]interface{}{
		"model":      "claude-haiku-4-5-20251001",
		"max_tokens": 600,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})

	httpReq, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Claude API error %d", resp.StatusCode)
	}

	var claude struct {
		Content []struct{ Text string `json:"text"` } `json:"content"`
	}
	if err := json.Unmarshal(raw, &claude); err != nil || len(claude.Content) == 0 {
		return nil, fmt.Errorf("unexpected API response")
	}

	text := claude.Content[0].Text
	start := strings.Index(text, "[")
	end := strings.LastIndex(text, "]")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("no JSON array in response")
	}

	var alts []Alternative
	if err := json.Unmarshal([]byte(text[start:end+1]), &alts); err != nil {
		return nil, fmt.Errorf("parse alternatives: %w", err)
	}
	return alts, nil
}
