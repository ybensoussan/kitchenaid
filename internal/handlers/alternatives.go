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

	settings, err := h.Store.GetSettings()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}

	var alts []Alternative
	if settings.AIProvider == "gemini" {
		apiKey := settings.GeminiAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("GEMINI_API_KEY")
		}
		if apiKey == "" {
			h.writeError(w, http.StatusServiceUnavailable, "GEMINI_API_KEY not configured")
			return
		}
		model := settings.Model
		if model == "" {
			model = "gemini-2.5-flash"
		}
		alts, err = fetchGeminiAlternatives(apiKey, model, req)
	} else {
		apiKey := settings.AnthropicAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("ANTHROPIC_API_KEY")
		}
		if apiKey == "" {
			h.writeError(w, http.StatusServiceUnavailable, "ANTHROPIC_API_KEY not configured")
			return
		}
		model := settings.Model
		if model == "" {
			model = "claude-haiku-4-5-20251001"
		}
		alts, err = fetchAnthropicAlternatives(apiKey, model, req)
	}

	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{"alternatives": alts})
}

func getPrompt(req alternativesReq) string {
	desc := req.Name
	if req.Amount > 0 && req.Unit != "" {
		desc = fmt.Sprintf("%.4g %s %s", req.Amount, req.Unit, req.Name)
	} else if req.Amount > 0 {
		desc = fmt.Sprintf("%.4g %s", req.Amount, req.Name)
	}
	if req.Notes != "" {
		desc += " (" + req.Notes + ")"
	}

	return fmt.Sprintf(`A recipe calls for: %s.
Suggest 4 practical substitutes. Reply with a JSON array only — no prose, no markdown fences:
[{"name":"...","amount":number_or_0,"unit":"...","notes":"...","tip":"one-sentence tip"},...]
Match the unit system of the original. Use 0 for amount when quantity does not apply.`, desc)
}

func fetchAnthropicAlternatives(apiKey, model string, req alternativesReq) ([]Alternative, error) {
	prompt := getPrompt(req)
	body, _ := json.Marshal(map[string]interface{}{
		"model":      model,
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

	return parseJsonArray(claude.Content[0].Text)
}

func fetchGeminiAlternatives(apiKey, model string, req alternativesReq) ([]Alternative, error) {
	prompt := getPrompt(req)
	url := "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey

	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]string{
					{"text": prompt},
				},
			},
		},
		"generationConfig": map[string]interface{}{
			"response_mime_type": "application/json",
		},
	})

	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("Gemini API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Gemini API error %d: %s", resp.StatusCode, string(raw))
	}

	var gemini struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&gemini); err != nil || len(gemini.Candidates) == 0 {
		return nil, fmt.Errorf("unexpected Gemini response")
	}

	return parseJsonArray(gemini.Candidates[0].Content.Parts[0].Text)
}

func parseJsonArray(text string) ([]Alternative, error) {
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
