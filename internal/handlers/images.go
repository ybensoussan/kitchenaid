package handlers

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// imageResult is a simple struct for search results
type imageResult struct {
	URL string `json:"url"`
}

var googleImageRe = regexp.MustCompile(`imgurl=(https?://[^&]+)`)

func (h *Handler) SearchImages(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		h.writeError(w, http.StatusBadRequest, "query required")
		return
	}

	// We use a specific UA to get a version of Google that is easier to parse
	// Mobile UAs often return simpler HTML with direct imgurl parameters in links
	searchURL := fmt.Sprintf("https://www.google.com/search?q=%s&tbm=isch&safe=active", url.QueryEscape(query))
	
	req, _ := http.NewRequest("GET", searchURL, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to fetch images")
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	html := string(body)

	// Broad regex for URLs ending in common image extensions
	imgRe := regexp.MustCompile(`https?://[^ "]+?\.(?:jpg|jpeg|png|webp)`)
	matches := imgRe.FindAllString(html, 40)
	
	var results []imageResult
	seen := make(map[string]bool)

	for _, u := range matches {
		// Filter out internal/tracking URLs
		lower := strings.ToLower(u)
		if strings.Contains(lower, "gstatic.com") || 
		   strings.Contains(lower, "google.com") ||
		   strings.Contains(lower, "googleusercontent.com") {
			continue
		}
		
		if !seen[u] {
			results = append(results, imageResult{URL: u})
			seen[u] = true
		}
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{"images": results})
}
