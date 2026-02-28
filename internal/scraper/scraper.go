package scraper

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"kitchenaid/internal/models"

	recipe "github.com/kkyr/go-recipe/pkg/recipe"
)

var httpClient = &http.Client{
	Timeout: 15 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		// Carry browser-like headers through redirects
		req.Header.Set("User-Agent", browserUA)
		req.Header.Set("Accept", browserAccept)
		return nil
	},
}

const browserUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const browserAccept = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"

// ScrapeURL tries multiple strategies to extract a recipe from a URL.
// We always fetch HTML ourselves (with a modern UA) and pass it to each strategy,
// so we never fall back to go-recipe's internal old-UA client.
func ScrapeURL(rawURL string) (*models.CreateRecipeRequest, error) {
	body, fetchErr := fetchHTML(rawURL)
	if fetchErr != nil {
		return nil, fetchErr
	}

	// Strategy 1: go-recipe schema/JSON-LD scraper (pass our HTML so no second fetch)
	if req := tryGoRecipeHTML(rawURL, body); req != nil {
		return req, nil
	}

	// Strategy 2: our own JSON-LD extraction
	if req, err := ExtractJSONLD(body); err == nil && req.Title != "" {
		req.SourceURL = rawURL
		return req, nil
	}

	// Strategy 3: Heuristic HTML fallback
	if req := extractHeuristic(body, rawURL); req != nil {
		return req, nil
	}

	return nil, fmt.Errorf("could not extract recipe from %s", rawURL)
}

func tryGoRecipeHTML(rawURL, body string) *models.CreateRecipeRequest {
	r, err := recipe.ScrapeHTML(rawURL, strings.NewReader(body))
	if err != nil {
		return nil
	}

	req := &models.CreateRecipeRequest{
		SourceURL: rawURL,
	}

	if name, ok := r.Name(); ok {
		req.Title = name
	}
	if req.Title == "" {
		return nil
	}

	if desc, ok := r.Description(); ok {
		req.Description = desc
	}
	if img, ok := r.ImageURL(); ok {
		req.ImageURL = img
	}
	if pt, ok := r.PrepTime(); ok {
		req.PrepTime = int(pt.Minutes())
	}
	if ct, ok := r.CookTime(); ok {
		req.CookTime = int(ct.Minutes())
	}
	if yield, ok := r.Yields(); ok {
		req.BaseServings = parseServings(yield)
	}
	if req.BaseServings == 0 {
		req.BaseServings = 4
	}

	if ings, ok := r.Ingredients(); ok {
		for _, line := range ings {
			req.Ingredients = append(req.Ingredients, ParseIngredientLine(line))
		}
	}

	if steps, ok := r.Instructions(); ok {
		for i, inst := range steps {
			req.Steps = append(req.Steps, models.StepInput{
				StepNumber:  i + 1,
				Instruction: strings.TrimSpace(inst),
			})
		}
	}

	return req
}

func fetchHTML(rawURL string) (string, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", browserAccept)
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Accept-Encoding", "identity") // avoid gzip so we read plaintext
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == 401 || resp.StatusCode == 403:
		return "", fmt.Errorf("access denied (HTTP %d) — this site may require a login", resp.StatusCode)
	case resp.StatusCode == 429:
		return "", fmt.Errorf("the site is rate-limiting requests — try again in a moment")
	case resp.StatusCode >= 400:
		return "", fmt.Errorf("HTTP %d from %s", resp.StatusCode, rawURL)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20)) // 2MB limit
	if err != nil {
		return "", err
	}

	// Detect soft paywall: page loaded but contains a login wall
	if isPaywallPage(string(body)) {
		return "", fmt.Errorf("this page requires a subscription or login — try a different recipe source")
	}

	return string(body), nil
}

// paywallSignals are strings that appear in hard paywalls but not on freely-accessible recipe pages.
// Keep these specific — generic signup CTAs like "create a free account" appear on many open sites.
var paywallSignals = []string{
	`"isAccessibleForFree":"False"`,
	`"isAccessibleForFree": false`,
	`nyt-vi-reg-wall`,
	`subscribe to continue reading`,
	`subscribe to continue`,
}

func isPaywallPage(body string) bool {
	lower := strings.ToLower(body)
	for _, sig := range paywallSignals {
		if strings.Contains(lower, strings.ToLower(sig)) {
			return true
		}
	}
	return false
}

// extractHeuristic tries WordPress recipe plugin class names as a fallback.
func extractHeuristic(body, sourceURL string) *models.CreateRecipeRequest {
	// Very basic: look for common patterns
	req := &models.CreateRecipeRequest{
		SourceURL:    sourceURL,
		BaseServings: 4,
	}

	// Look for title in common patterns
	if title := extractBetween(body, `class="wprm-recipe-name"`, "</", ">"); title != "" {
		req.Title = title
	} else if title := extractBetween(body, `class="tasty-recipes-title"`, "</", ">"); title != "" {
		req.Title = title
	}

	if req.Title == "" {
		return nil
	}
	return req
}

func extractBetween(body, marker, end, start string) string {
	idx := strings.Index(body, marker)
	if idx == -1 {
		return ""
	}
	idx2 := strings.Index(body[idx:], start)
	if idx2 == -1 {
		return ""
	}
	start2 := idx + idx2 + len(start)
	end2 := strings.Index(body[start2:], end)
	if end2 == -1 {
		return ""
	}
	return strings.TrimSpace(body[start2 : start2+end2])
}
