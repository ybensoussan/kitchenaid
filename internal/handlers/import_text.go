package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"kitchenaid/internal/models"
	"kitchenaid/internal/scraper"
)

// buildIngLine assembles a parseable ingredient line from AI-returned fields.
func buildIngLine(amount float64, unit, name, notes string) string {
	var sb strings.Builder
	if amount > 0 {
		sb.WriteString(fmt.Sprintf("%g", amount))
		if unit != "" {
			sb.WriteString(" " + unit)
		}
		sb.WriteString(" ")
	} else if unit != "" {
		sb.WriteString(unit + " ")
	}
	sb.WriteString(name)
	if notes != "" {
		sb.WriteString(", " + notes)
	}
	return sb.String()
}

type importTextReq struct {
	Text   string `json:"text"`
	Method string `json:"method"` // "local" or "ai"
}

func (h *Handler) ImportText(w http.ResponseWriter, r *http.Request) {
	var req importTextReq
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		h.writeError(w, http.StatusBadRequest, "text is required")
		return
	}

	var result *models.CreateRecipeRequest
	var err error

	if req.Method == "ai" {
		settings, settingsErr := h.Store.GetSettings()
		if settingsErr != nil {
			h.writeError(w, http.StatusInternalServerError, "failed to get settings")
			return
		}
		result, err = parseRecipeTextAI(settings, req.Text)
	} else {
		result, err = scraper.ParseRecipeText(req.Text)
	}

	if err != nil {
		h.writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	h.writeJSON(w, http.StatusOK, result)
}

func parseRecipeTextAI(settings models.Settings, text string) (*models.CreateRecipeRequest, error) {
	prompt := buildTextParsePrompt(text)

	var raw string
	var err error

	if settings.AIProvider == "gemini" {
		apiKey := settings.GeminiAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("GEMINI_API_KEY")
		}
		if apiKey == "" {
			return nil, fmt.Errorf("GEMINI_API_KEY not configured")
		}
		model := settings.Model
		if model == "" {
			model = "gemini-2.5-flash"
		}
		raw, err = callGeminiForText(apiKey, model, prompt)
	} else {
		apiKey := settings.AnthropicAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("ANTHROPIC_API_KEY")
		}
		if apiKey == "" {
			return nil, fmt.Errorf("ANTHROPIC_API_KEY not configured")
		}
		model := settings.Model
		if model == "" {
			model = "claude-haiku-4-5-20251001"
		}
		raw, err = callAnthropicForText(apiKey, model, prompt)
	}

	if err != nil {
		return nil, err
	}
	return parseAITextResponse(raw)
}

func buildTextParsePrompt(text string) string {
	return `Parse this recipe text and return a single JSON object — no prose, no markdown fences:
{"title":"...","description":"...","prep_time":0,"cook_time":0,"base_servings":0,
 "ingredients":[{"name":"...","amount":0,"unit":"...","notes":"..."},...],
 "steps":[{"step_number":1,"instruction":"...","duration":0},...]}
Use minutes for times. Use 0 for unknown numbers. Keep original units in the ingredient unit field.

Recipe text:
` + text
}

func callAnthropicForText(apiKey, model, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"model":      model,
		"max_tokens": 2000,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})

	httpReq, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Claude API error %d", resp.StatusCode)
	}

	var claude struct {
		Content []struct{ Text string `json:"text"` } `json:"content"`
	}
	if err := json.Unmarshal(raw, &claude); err != nil || len(claude.Content) == 0 {
		return "", fmt.Errorf("unexpected API response")
	}
	return claude.Content[0].Text, nil
}

func callGeminiForText(apiKey, model, prompt string) (string, error) {
	url := "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey

	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{{"text": prompt}}},
		},
		"generationConfig": map[string]interface{}{
			"response_mime_type": "application/json",
		},
	})

	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("Gemini API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Gemini API error %d: %s", resp.StatusCode, string(raw))
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
		return "", fmt.Errorf("unexpected Gemini response")
	}
	return gemini.Candidates[0].Content.Parts[0].Text, nil
}

// aiRecipeJSON is the shape we expect from the AI response.
type aiRecipeJSON struct {
	Title        string `json:"title"`
	Description  string `json:"description"`
	PrepTime     int    `json:"prep_time"`
	CookTime     int    `json:"cook_time"`
	BaseServings int    `json:"base_servings"`
	Ingredients  []struct {
		Name   string  `json:"name"`
		Amount float64 `json:"amount"`
		Unit   string  `json:"unit"`
		Notes  string  `json:"notes"`
	} `json:"ingredients"`
	Steps []struct {
		StepNumber  int    `json:"step_number"`
		Instruction string `json:"instruction"`
		Duration    int    `json:"duration"`
	} `json:"steps"`
}

func parseAITextResponse(text string) (*models.CreateRecipeRequest, error) {
	// Strip markdown fences if present
	text = strings.TrimSpace(text)
	if idx := strings.Index(text, "{"); idx > 0 {
		text = text[idx:]
	}
	if idx := strings.LastIndex(text, "}"); idx >= 0 && idx < len(text)-1 {
		text = text[:idx+1]
	}

	var ai aiRecipeJSON
	if err := json.Unmarshal([]byte(text), &ai); err != nil {
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}

	req := &models.CreateRecipeRequest{
		Title:        ai.Title,
		Description:  ai.Description,
		PrepTime:     ai.PrepTime,
		CookTime:     ai.CookTime,
		BaseServings: ai.BaseServings,
	}

	// Normalize each ingredient via ParseIngredientLine for metric conversion
	for _, ing := range ai.Ingredients {
		if ing.Name == "" {
			continue
		}
		line := buildIngLine(ing.Amount, ing.Unit, ing.Name, ing.Notes)
		parsed := scraper.ParseIngredientLine(line)
		if parsed.Name == "" {
			parsed.Name = ing.Name
		}
		req.Ingredients = append(req.Ingredients, parsed)
	}

	for i, s := range ai.Steps {
		num := s.StepNumber
		if num == 0 {
			num = i + 1
		}
		req.Steps = append(req.Steps, models.StepInput{
			StepNumber:  num,
			Instruction: s.Instruction,
			Duration:    s.Duration,
		})
	}

	if req.BaseServings == 0 {
		req.BaseServings = 4
	}
	return req, nil
}
