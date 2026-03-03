package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

var ahCache struct {
	sync.Mutex
	token   string
	expires time.Time
}

func getAHToken() (string, error) {
	ahCache.Lock()
	defer ahCache.Unlock()

	if ahCache.token != "" && time.Now().Before(ahCache.expires) {
		return ahCache.token, nil
	}

	body := bytes.NewBufferString(`{"clientId":"appie-android"}`)
	req, err := http.NewRequest("POST", "https://api.ah.nl/mobile-auth/v1/auth/token/anonymous", body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Appie/8.22.3")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("AH auth: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("AH auth decode: %w", err)
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("AH auth: empty token")
	}

	ahCache.token = result.AccessToken
	// Refresh 1 hour before actual expiry
	ahCache.expires = time.Now().Add(time.Duration(result.ExpiresIn-3600) * time.Second)
	return ahCache.token, nil
}

type AHProduct struct {
	ID            int     `json:"id"`
	Title         string  `json:"title"`
	Price         float64 `json:"price"`
	SalesUnitSize string  `json:"salesUnitSize"`
	UnitPriceDesc string  `json:"unitPriceDesc"`
	ImageURL      string  `json:"imageUrl"`
}

func translateToDutch(h *Handler, text string) string {
	settings, err := h.Store.GetSettings()
	if err != nil {
		return text
	}

	prompt := `Translate the following ingredient name to Dutch. Reply with only the Dutch translation, nothing else: ` + text

	var translated string
	if settings.AIProvider == "gemini" {
		apiKey := settings.GeminiAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("GEMINI_API_KEY")
		}
		if apiKey == "" {
			return text
		}
		model := settings.Model
		if model == "" {
			model = "gemini-2.5-flash"
		}
		translated, err = callGeminiText(apiKey, model, prompt)
	} else {
		apiKey := settings.AnthropicAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("ANTHROPIC_API_KEY")
		}
		if apiKey == "" {
			return text
		}
		model := settings.Model
		if model == "" {
			model = "claude-haiku-4-5-20251001"
		}
		translated, err = callAnthropicText(apiKey, model, prompt)
	}

	if err != nil || translated == "" {
		return text
	}
	return strings.TrimSpace(translated)
}

func callAnthropicText(apiKey, model, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":      model,
		"max_tokens": 64,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})
	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("anthropic error %d", resp.StatusCode)
	}
	var result struct {
		Content []struct{ Text string `json:"text"` } `json:"content"`
	}
	if err := json.Unmarshal(raw, &result); err != nil || len(result.Content) == 0 {
		return "", fmt.Errorf("unexpected response")
	}
	return result.Content[0].Text, nil
}

func callGeminiText(apiKey, model, prompt string) (string, error) {
	apiURL := "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey
	body, _ := json.Marshal(map[string]any{
		"contents": []map[string]any{
			{"parts": []map[string]string{{"text": prompt}}},
		},
	})
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(apiURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gemini error %d", resp.StatusCode)
	}
	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct{ Text string `json:"text"` } `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || len(result.Candidates) == 0 {
		return "", fmt.Errorf("unexpected response")
	}
	return result.Candidates[0].Content.Parts[0].Text, nil
}

func (h *Handler) SearchAH(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		h.writeError(w, http.StatusBadRequest, "q is required")
		return
	}

	q = translateToDutch(h, q)

	token, err := getAHToken()
	if err != nil {
		h.writeError(w, http.StatusBadGateway, "AH auth failed: "+err.Error())
		return
	}

	searchURL := "https://api.ah.nl/mobile-services/product/search/v2?query=" +
		url.QueryEscape(q) + "&size=10&sortOn=RELEVANCE"

	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "Appie/8.22.3")
	req.Header.Set("X-Application", "AHWEBSHOP")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, "AH search failed: "+err.Error())
		return
	}
	defer resp.Body.Close()

	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		h.writeError(w, http.StatusBadGateway, "AH read failed: "+err.Error())
		return
	}

	var raw struct {
		Products []struct {
			ID              int     `json:"id"`
			Title           string  `json:"title"`
			PriceBeforeBonus float64 `json:"priceBeforeBonus"`
			SalesUnitSize   string  `json:"salesUnitSize"`
			UnitPriceDescription string `json:"unitPriceDescription"`
			Images          []struct {
				URL string `json:"url"`
			} `json:"images"`
		} `json:"products"`
	}
	if err := json.Unmarshal(rawBody, &raw); err != nil {
		h.writeError(w, http.StatusBadGateway, "AH parse failed: "+err.Error())
		return
	}

	results := make([]AHProduct, 0, len(raw.Products))
	for _, p := range raw.Products {
		imgURL := ""
		if len(p.Images) > 0 {
			imgURL = p.Images[0].URL
		}
		results = append(results, AHProduct{
			ID:            p.ID,
			Title:         p.Title,
			Price:         p.PriceBeforeBonus,
			SalesUnitSize: p.SalesUnitSize,
			UnitPriceDesc: p.UnitPriceDescription,
			ImageURL:      imgURL,
		})
	}

	h.writeJSON(w, http.StatusOK, map[string]any{"products": results})
}
