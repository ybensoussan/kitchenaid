package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"kitchenaid/internal/models"
	"net/http"
	"os"
	"strconv"
	"strings"
)

func (h *Handler) ListAllTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.Store.ListAllTags()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]interface{}{"tags": tags})
}

func (h *Handler) AddRecipeTag(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	if err := h.Store.AddRecipeTag(id, req.Name); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) RemoveRecipeTag(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}
	tagName := r.PathValue("name")

	if err := h.Store.RemoveRecipeTag(id, tagName); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) SuggestTags(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}

	recipe, err := h.Store.GetRecipe(id)
	if err != nil || recipe == nil {
		h.writeError(w, http.StatusNotFound, "recipe not found")
		return
	}

	settings, _ := h.Store.GetSettings()

	prompt := fmt.Sprintf(`Suggest up to 6 concise tags/labels for this recipe: "%s".
Description: %s
Ingredients: %s
Suggest labels like: "vegetarian", "quick", "one pot", "dessert", "spicy", etc.
Reply with a JSON array of strings only — no prose, no markdown: ["tag1", "tag2", ...]`,
		recipe.Title, recipe.Description, strings.Join(func() []string {
			var names []string
			for _, ing := range recipe.Ingredients {
				names = append(names, ing.Name)
			}
			return names
		}(), ", "))

	var tags []string
	if settings.AIProvider == "gemini" {
		apiKey := settings.GeminiAPIKey
		if apiKey == "" { apiKey = os.Getenv("GEMINI_API_KEY") }
		if apiKey == "" { h.writeError(w, http.StatusServiceUnavailable, "GEMINI_API_KEY not set"); return }
		model := settings.Model
		if model == "" { model = "gemini-2.5-flash" }
		tags, err = suggestTagsGemini(apiKey, model, prompt)
	} else {
		apiKey := settings.AnthropicAPIKey
		if apiKey == "" { apiKey = os.Getenv("ANTHROPIC_API_KEY") }
		if apiKey == "" { h.writeError(w, http.StatusServiceUnavailable, "ANTHROPIC_API_KEY not set"); return }
		model := settings.Model
		if model == "" { model = "claude-haiku-4-5-20251001" }
		tags, err = suggestTagsAnthropic(apiKey, model, prompt)
	}

	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, http.StatusOK, models.TagSuggestionResponse{Tags: tags})
}

func suggestTagsAnthropic(apiKey, model, prompt string) ([]string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"model":      model,
		"max_tokens": 200,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})

	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()

	var result struct {
		Content []struct{ Text string `json:"text"` } `json:"content"`
		Error   struct{ Message string `json:"message"` } `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if resp.StatusCode != http.StatusOK {
		msg := result.Error.Message
		if msg == "" { msg = fmt.Sprintf("API error %d", resp.StatusCode) }
		return nil, fmt.Errorf("Anthropic: %s", msg)
	}
	if len(result.Content) == 0 { return nil, fmt.Errorf("no response from AI") }

	return parseTagsJson(result.Content[0].Text)
}

func suggestTagsGemini(apiKey, model, prompt string) ([]string, error) {
	url := "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey
	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{{"parts": []map[string]string{{"text": prompt}}}},
		"generationConfig": map[string]interface{}{"response_mime_type": "application/json"},
	})

	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil { return nil, err }
	defer resp.Body.Close()

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		Error struct{ Message string `json:"message"` } `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if resp.StatusCode != http.StatusOK {
		msg := result.Error.Message
		if msg == "" { msg = fmt.Sprintf("API error %d", resp.StatusCode) }
		return nil, fmt.Errorf("Gemini: %s", msg)
	}
	if len(result.Candidates) == 0 { return nil, fmt.Errorf("no response from AI") }

	return parseTagsJson(result.Candidates[0].Content.Parts[0].Text)
}

func parseTagsJson(text string) ([]string, error) {
	start := strings.Index(text, "[")
	end := strings.LastIndex(text, "]")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("no JSON array in response")
	}

	var tags []string
	if err := json.Unmarshal([]byte(text[start:end+1]), &tags); err != nil {
		return nil, err
	}
	return tags, nil
}
