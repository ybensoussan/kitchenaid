package handlers

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

func (h *Handler) ImportImage(w http.ResponseWriter, r *http.Request) {
	fmt.Println("[ImportImage] Started")
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		fmt.Printf("[ImportImage] ParseMultipartForm error: %v\n", err)
		h.writeError(w, http.StatusBadRequest, "failed to parse form")
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		fmt.Printf("[ImportImage] FormFile error: %v\n", err)
		h.writeError(w, http.StatusBadRequest, "image field required")
		return
	}
	defer file.Close()

	// Detect MIME from first 512 bytes
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	mime := http.DetectContentType(buf[:n])
	if idx := strings.Index(mime, ";"); idx != -1 {
		mime = strings.TrimSpace(mime[:idx])
	}
	fmt.Printf("[ImportImage] MIME detected: %s\n", mime)

	ext, ok := allowedMIME[mime]
	if !ok {
		// Fallback: try extension from filename
		origExt := strings.ToLower(strings.TrimPrefix(filepath.Ext(header.Filename), "."))
		for _, v := range []string{"jpg", "jpeg", "png", "webp"} {
			if origExt == v {
				if origExt == "jpeg" {
					origExt = "jpg"
				}
				ext = origExt
				ok = true
				break
			}
		}
		if !ok {
			fmt.Printf("[ImportImage] Unsupported type: %s\n", mime)
			h.writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported image type: %s", mime))
			return
		}
	}

	// Read the rest of the file
	rest, err := io.ReadAll(file)
	if err != nil {
		fmt.Printf("[ImportImage] io.ReadAll error: %v\n", err)
		h.writeError(w, http.StatusInternalServerError, "failed to read image")
		return
	}
	imageBytes := append(buf[:n], rest...)
	fmt.Printf("[ImportImage] Read %d bytes\n", len(imageBytes))

	// Save image to uploads dir
	if err := os.MkdirAll(h.UploadsDir, 0755); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to create uploads dir")
		return
	}
	filename := uuid.New().String() + "." + ext
	if err := os.WriteFile(filepath.Join(h.UploadsDir, filename), imageBytes, 0644); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to save image")
		return
	}
	imageURL := "/uploads/" + filename

	// Get AI settings
	settings, err := h.Store.GetSettings()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}

	b64 := base64.StdEncoding.EncodeToString(imageBytes)
	prompt := imageParsePrompt()

	var raw string
	if settings.AIProvider == "gemini" {
		apiKey := settings.GeminiAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("GEMINI_API_KEY")
		}
		if apiKey == "" {
			h.writeError(w, http.StatusBadRequest, "GEMINI_API_KEY not configured")
			return
		}
		model := settings.Model
		if model == "" {
			model = "gemini-2.0-flash-001"
		}
		fmt.Printf("[ImportImage] Calling Gemini with model: %s\n", model)
		raw, err = parseImageGemini(apiKey, model, b64, mime, prompt)
	} else {
		apiKey := settings.AnthropicAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("ANTHROPIC_API_KEY")
		}
		if apiKey == "" {
			h.writeError(w, http.StatusBadRequest, "ANTHROPIC_API_KEY not configured")
			return
		}
		model := settings.Model
		if model == "" {
			model = "claude-3-5-sonnet-20241022"
		}
		fmt.Printf("[ImportImage] Calling Anthropic with model: %s\n", model)
		raw, err = parseImageAnthropic(apiKey, model, b64, mime, prompt)
	}

	if err != nil {
		fmt.Printf("[ImportImage] AI call error: %v\n", err)
		h.writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	fmt.Printf("[ImportImage] AI raw response length: %d\n", len(raw))
	result, err := parseAITextResponse(raw)
	if err != nil {
		fmt.Printf("[ImportImage] parseAITextResponse error: %v\n", err)
		h.writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	result.ImageURL = imageURL
	fmt.Println("[ImportImage] Success")
	h.writeJSON(w, http.StatusOK, result)
}

func imageParsePrompt() string {
	return `Extract the recipe from this image and return a single JSON object — no prose, no markdown fences:
{"title":"...","description":"...","prep_time":0,"cook_time":0,"base_servings":0,
 "ingredients":[{"name":"...","amount":0,"unit":"...","notes":"..."},...],
 "steps":[{"step_number":1,"instruction":"...","duration":0},...]}
Use minutes for times. Use 0 for unknown numbers. Keep original units in the ingredient unit field.
If the image is not a recipe, return {"title":"Unknown Recipe","ingredients":[],"steps":[]}.`
}

func parseImageAnthropic(apiKey, model, b64, mimeType, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"model":      model,
		"max_tokens": 2000,
		"messages": []map[string]interface{}{
			{
				"role": "user",
				"content": []map[string]interface{}{
					{
						"type": "image",
						"source": map[string]string{
							"type":       "base64",
							"media_type": mimeType,
							"data":       b64,
						},
					},
					{
						"type": "text",
						"text": prompt,
					},
				},
			},
		},
	})

	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
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

func parseImageGemini(apiKey, model, b64, mimeType, prompt string) (string, error) {
	url := "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey

	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]interface{}{
					{
						"inline_data": map[string]string{
							"mime_type": mimeType,
							"data":      b64,
						},
					},
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
