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

// murlRe extracts Bing image search "murl" (media URL) values from HTML
var murlRe = regexp.MustCompile(`murl&quot;:&quot;(https?://[^&"]+)`)

func (h *Handler) SearchImages(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		h.writeError(w, http.StatusBadRequest, "query required")
		return
	}

	searchURL := fmt.Sprintf("https://www.bing.com/images/search?q=%s&form=HDRSC2", url.QueryEscape(query))

	req, _ := http.NewRequest("GET", searchURL, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to fetch images")
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	matches := murlRe.FindAllSubmatch(body, 40)

	var results []imageResult
	seen := make(map[string]bool)

	for _, m := range matches {
		u := strings.TrimRight(string(m[1]), `\`)
		if !seen[u] {
			results = append(results, imageResult{URL: u})
			seen[u] = true
		}
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{"images": results})
}
