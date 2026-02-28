package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

type modelInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// GetModels returns available models for the currently configured AI provider.
func (h *Handler) GetModels(w http.ResponseWriter, r *http.Request) {
	settings, err := h.Store.GetSettings()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}

	if settings.AIProvider == "gemini" {
		apiKey := settings.GeminiAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("GEMINI_API_KEY")
		}
		if apiKey == "" {
			h.writeError(w, http.StatusServiceUnavailable, "GEMINI_API_KEY not configured")
			return
		}
		models, err := fetchGeminiModels(apiKey)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		h.writeJSON(w, http.StatusOK, models)
	} else {
		// Anthropic — return curated list of current production models
		models := []modelInfo{
			{ID: "claude-haiku-4-5-20251001", Name: "Claude Haiku 4.5 (fast)"},
			{ID: "claude-sonnet-4-6", Name: "Claude Sonnet 4.6 (balanced)"},
			{ID: "claude-opus-4-6", Name: "Claude Opus 4.6 (most capable)"},
		}
		h.writeJSON(w, http.StatusOK, models)
	}
}

func fetchGeminiModels(apiKey string) ([]modelInfo, error) {
	url := "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("Gemini models request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Gemini models error %d: %s", resp.StatusCode, string(raw))
	}

	var result struct {
		Models []struct {
			Name               string   `json:"name"`
			DisplayName        string   `json:"displayName"`
			SupportedMethods   []string `json:"supportedGenerationMethods"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("parse Gemini models: %w", err)
	}

	var models []modelInfo
	for _, m := range result.Models {
		for _, method := range m.SupportedMethods {
			if method == "generateContent" {
				// name is like "models/gemini-2.5-flash" — strip prefix
				id := m.Name
				if len(id) > 7 && id[:7] == "models/" {
					id = id[7:]
				}
				models = append(models, modelInfo{ID: id, Name: m.DisplayName})
				break
			}
		}
	}
	return models, nil
}
