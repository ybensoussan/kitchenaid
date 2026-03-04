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

// ── Request / response types ──────────────────────────────────────────────

type smartMatchReq struct {
	Ingredients []smIngredient `json:"ingredients"`
	PantryItems []smPantry     `json:"pantry_items"`
}

type smIngredient struct {
	ID       int64   `json:"id"`
	RecipeID int64   `json:"recipe_id"`
	Name     string  `json:"name"`
	Amount   float64 `json:"amount"`
	Unit     string  `json:"unit"`
}

type smPantry struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type SmartMatchResult struct {
	Matches    []smMatch     `json:"matches"`
	Duplicates []smDuplicate `json:"duplicates"`
}

type smMatch struct {
	IngredientID int64          `json:"ingredient_id"`
	RecipeID     int64          `json:"recipe_id"`
	Suggestions  []smSuggestion `json:"suggestions"`
}

type smSuggestion struct {
	PantryItemID int64  `json:"pantry_item_id"`
	Confidence   string `json:"confidence"`
	Reason       string `json:"reason"`
}

type smDuplicate struct {
	KeepID        int64    `json:"keep_id"`
	MergeID       int64    `json:"merge_id"`
	Reason        string   `json:"reason"`
	Confidence    string   `json:"confidence"`
	KeepRecipes   []string `json:"keep_recipes,omitempty"`
	MergeRecipes  []string `json:"merge_recipes,omitempty"`
}

// ── Handlers ──────────────────────────────────────────────────────────────

func (h *Handler) SmartMatch(w http.ResponseWriter, r *http.Request) {
	var req smartMatchReq
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	empty := SmartMatchResult{Matches: []smMatch{}, Duplicates: []smDuplicate{}}
	if len(req.Ingredients) == 0 && len(req.PantryItems) < 2 {
		h.writeJSON(w, http.StatusOK, empty)
		return
	}

	settings, _ := h.Store.GetSettings()
	prompt := buildSmartMatchPrompt(req)

	var result SmartMatchResult
	var err error
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
		result, err = smartMatchGemini(apiKey, model, prompt)
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
		result, err = smartMatchAnthropic(apiKey, model, prompt)
	}

	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Enrich duplicates with which recipes reference each pantry item
	for i := range result.Duplicates {
		d := &result.Duplicates[i]
		d.KeepRecipes, _ = h.Store.GetRecipesByPantryItem(d.KeepID)
		d.MergeRecipes, _ = h.Store.GetRecipesByPantryItem(d.MergeID)
	}

	h.writeJSON(w, http.StatusOK, result)
}

func (h *Handler) MergePantryItems(w http.ResponseWriter, r *http.Request) {
	var req struct {
		KeepID  int64 `json:"keep_id"`
		MergeID int64 `json:"merge_id"`
	}
	if err := h.decodeJSON(r, &req); err != nil || req.KeepID == 0 || req.MergeID == 0 {
		h.writeError(w, http.StatusBadRequest, "keep_id and merge_id required")
		return
	}
	if err := h.Store.MergePantryItems(req.KeepID, req.MergeID); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "merged"})
}

func (h *Handler) GetUnlinkedIngredients(w http.ResponseWriter, r *http.Request) {
	ings, err := h.Store.GetUnlinkedIngredients()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, ings)
}

// ── Prompt ────────────────────────────────────────────────────────────────

func buildSmartMatchPrompt(req smartMatchReq) string {
	ingJSON, _ := json.Marshal(req.Ingredients)
	pantryJSON, _ := json.Marshal(req.PantryItems)

	return fmt.Sprintf(`You are a kitchen pantry matcher. Perform two tasks:

TASK 1 — Link ingredients to pantry items:
For each recipe ingredient, find the best matching pantry item(s). The same ingredient may have different names (e.g. "all-purpose flour" → "Flour", "spring onion" → "Green onion", "heavy cream" → "Slagroom").
Provide up to 3 suggestions per ingredient, ranked by confidence ("high"/"medium"/"low").
Only suggest matches you are reasonably confident about. If no pantry item is a reasonable match, return an empty suggestions array for that ingredient.

TASK 2 — Identify pantry duplicates:
Find pairs of pantry items that represent the same ingredient and should be merged (e.g. "Flour" and "All-purpose flour"). Do NOT flag items that are merely related (e.g. "Sugar" and "Brown sugar" are NOT duplicates). For each duplicate pair, specify which id to keep (prefer the more descriptive or commonly-used name).

Recipe ingredients (unlinked):
%s

Pantry items:
%s

Reply with JSON only — no markdown, no prose:
{"matches":[{"ingredient_id":0,"recipe_id":0,"suggestions":[{"pantry_item_id":0,"confidence":"high","reason":"..."}]}],"duplicates":[{"keep_id":0,"merge_id":0,"reason":"...","confidence":"high"}]}`,
		string(ingJSON), string(pantryJSON))
}

// ── AI calls ──────────────────────────────────────────────────────────────

func smartMatchAnthropic(apiKey, model, prompt string) (SmartMatchResult, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"model":      model,
		"max_tokens": 2000,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})

	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return SmartMatchResult{}, fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return SmartMatchResult{}, fmt.Errorf("Claude API error %d", resp.StatusCode)
	}

	var claude struct {
		Content []struct{ Text string `json:"text"` } `json:"content"`
	}
	if err := json.Unmarshal(raw, &claude); err != nil || len(claude.Content) == 0 {
		return SmartMatchResult{}, fmt.Errorf("unexpected API response")
	}
	return parseSmartMatchJSON(claude.Content[0].Text)
}

func smartMatchGemini(apiKey, model, prompt string) (SmartMatchResult, error) {
	url := "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey
	body, _ := json.Marshal(map[string]interface{}{
		"contents":         []map[string]interface{}{{"parts": []map[string]string{{"text": prompt}}}},
		"generationConfig": map[string]interface{}{"response_mime_type": "application/json"},
	})

	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return SmartMatchResult{}, fmt.Errorf("Gemini request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return SmartMatchResult{}, fmt.Errorf("Gemini error %d: %s", resp.StatusCode, string(raw))
	}

	var gemini struct {
		Candidates []struct {
			Content struct {
				Parts []struct{ Text string `json:"text"` } `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&gemini); err != nil || len(gemini.Candidates) == 0 {
		return SmartMatchResult{}, fmt.Errorf("unexpected Gemini response")
	}
	return parseSmartMatchJSON(gemini.Candidates[0].Content.Parts[0].Text)
}

// extractJSONObject finds the first complete {...} object in text, correctly
// handling nested braces and quoted strings so trailing prose doesn't corrupt it.
func extractJSONObject(text string) (string, error) {
	start := strings.Index(text, "{")
	if start < 0 {
		return "", fmt.Errorf("no JSON object found in AI response")
	}
	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(text); i++ {
		c := text[i]
		if escaped {
			escaped = false
			continue
		}
		if c == '\\' && inString {
			escaped = true
			continue
		}
		if c == '"' {
			inString = !inString
			continue
		}
		if inString {
			continue
		}
		switch c {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return text[start : i+1], nil
			}
		}
	}
	return "", fmt.Errorf("unterminated JSON object in AI response")
}

func parseSmartMatchJSON(text string) (SmartMatchResult, error) {
	obj, err := extractJSONObject(text)
	if err != nil {
		return SmartMatchResult{}, err
	}
	var result SmartMatchResult
	if err := json.Unmarshal([]byte(obj), &result); err != nil {
		return SmartMatchResult{}, fmt.Errorf("parse smart match response: %w", err)
	}
	if result.Matches == nil {
		result.Matches = []smMatch{}
	}
	if result.Duplicates == nil {
		result.Duplicates = []smDuplicate{}
	}
	return result, nil
}
