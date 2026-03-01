package handlers

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"kitchenaid/internal/models"
)

// ── Portable export structs ───────────────────────────────────────────────────

type exportedIngredient struct {
	Name      string  `json:"name"`
	Amount    float64 `json:"amount"`
	Unit      string  `json:"unit"`
	Notes     string  `json:"notes"`
	SortOrder int     `json:"sort_order"`
}

type exportedStep struct {
	StepNumber  int    `json:"step_number"`
	Instruction string `json:"instruction"`
	Duration    int    `json:"duration"`
}

type exportedRecipe struct {
	Title        string               `json:"title"`
	Description  string               `json:"description,omitempty"`
	PrepTime     int                  `json:"prep_time"`
	CookTime     int                  `json:"cook_time"`
	BaseServings int                  `json:"base_servings"`
	SourceURL    string               `json:"source_url,omitempty"`
	ImageURL     string               `json:"image_url,omitempty"`
	Tags         []string             `json:"tags,omitempty"`
	Ingredients  []exportedIngredient `json:"ingredients"`
	Steps        []exportedStep       `json:"steps"`
}

// ── HTML template source ──────────────────────────────────────────────────────

const exportHTMLTmpl = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{.Title}}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 780px; margin: 0 auto; padding: 2rem 1.5rem; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 0.5rem; }
    .description { color: #555; margin-bottom: 1.25rem; }
    .meta { display: flex; gap: 2rem; flex-wrap: wrap; margin-bottom: 1.5rem; border-top: 1px solid #e5e5e5; border-bottom: 1px solid #e5e5e5; padding: 0.75rem 0; }
    .meta-item label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: #888; display: block; }
    .meta-item span { font-weight: 600; font-size: 0.95rem; }
    .tags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1.25rem; }
    .tag { background: #f0f0f0; border-radius: 999px; padding: 0.2rem 0.65rem; font-size: 0.78rem; color: #555; }
    .recipe-image { width: 100%; border-radius: 12px; object-fit: cover; max-height: 260px; display: block; margin-bottom: 1.5rem; }
    .layout { display: grid; grid-template-columns: 1fr 2fr; gap: 2rem; align-items: start; }
    @media (max-width: 600px) { .layout { grid-template-columns: 1fr; } }
    .ingredients { background: #fafafa; border: 1px solid #e5e5e5; border-radius: 12px; padding: 1.25rem; }
    .ingredients h2, .steps h2 { font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 1rem; color: #888; }
    .ingredients ul { list-style: none; }
    .ingredients li { padding: 0.35rem 0; border-bottom: 1px solid #f0f0f0; font-size: 0.92rem; }
    .ingredients li:last-child { border-bottom: none; }
    .ing-amount { font-weight: 600; margin-right: 0.25rem; }
    .ing-notes { color: #888; font-size: 0.85rem; }
    .steps ol { list-style: none; }
    .step { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
    .step-num { background: #1a1a1a; color: #fff; border-radius: 50%; width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; flex-shrink: 0; }
    .step-text { padding-top: 0.2rem; }
    .step-duration { font-size: 0.8rem; color: #888; margin-top: 0.25rem; }
    .source { margin-top: 2.5rem; font-size: 0.8rem; color: #aaa; }
    .source a { color: inherit; }
    .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e5e5; font-size: 0.75rem; color: #bbb; text-align: center; }
  </style>
</head>
<body>
  <h1>{{.Title}}</h1>
  {{if .Description}}<p class="description">{{.Description}}</p>{{end}}
  <div class="meta">
    {{if .PrepTime}}<div class="meta-item"><label>Prep</label><span>{{formatTime .PrepTime}}</span></div>{{end}}
    {{if .CookTime}}<div class="meta-item"><label>Cook</label><span>{{formatTime .CookTime}}</span></div>{{end}}
    {{if .BaseServings}}<div class="meta-item"><label>Serves</label><span>{{.BaseServings}}</span></div>{{end}}
  </div>
  {{if .Tags}}<div class="tags">{{range .Tags}}<span class="tag">{{.}}</span>{{end}}</div>{{end}}
  {{if .ImageURL}}<img class="recipe-image" src="{{.ImageURL}}" alt="{{.Title}}">{{end}}
  <div class="layout">
    <aside>
      <div class="ingredients">
        <h2>Ingredients</h2>
        <ul>
          {{range .Ingredients}}
          <li>
            {{if .Amount}}<span class="ing-amount">{{formatAmount .Amount}} {{.Unit}}</span>{{end}}
            {{.Name}}
            {{if .Notes}}<span class="ing-notes"> — {{.Notes}}</span>{{end}}
          </li>
          {{end}}
        </ul>
      </div>
    </aside>
    <main class="steps">
      <h2>Instructions</h2>
      <ol>
        {{range .Steps}}
        <li class="step">
          <div class="step-num">{{.StepNumber}}</div>
          <div>
            <p class="step-text">{{.Instruction}}</p>
            {{if .Duration}}<p class="step-duration">⏱ {{.Duration}} min</p>{{end}}
          </div>
        </li>
        {{end}}
      </ol>
    </main>
  </div>
  {{if .SourceURL}}<p class="source">Source: <a href="{{.SourceURL}}">{{.SourceURL}}</a></p>{{end}}
  <p class="footer">Exported from KitchenAid</p>
</body>
</html>`

var exportFuncs = template.FuncMap{
	"formatTime": func(mins int) string {
		if mins == 0 {
			return "—"
		}
		if mins < 60 {
			return fmt.Sprintf("%d min", mins)
		}
		h, m := mins/60, mins%60
		if m == 0 {
			return fmt.Sprintf("%dh", h)
		}
		return fmt.Sprintf("%dh %dm", h, m)
	},
	"formatAmount": func(f float64) string {
		if f == float64(int(f)) {
			return strconv.Itoa(int(f))
		}
		return strconv.FormatFloat(f, 'f', -1, 64)
	},
}

var parsedHTMLTmpl = template.Must(template.New("export").Funcs(exportFuncs).Parse(exportHTMLTmpl))

// ── Handler ───────────────────────────────────────────────────────────────────

func (h *Handler) ExportRecipe(w http.ResponseWriter, r *http.Request) {
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

	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	switch format {
	case "json":
		h.exportJSON(w, recipe)
	case "html":
		h.exportHTML(w, recipe)
	default:
		h.writeError(w, http.StatusBadRequest, "unsupported format; use json or html")
	}
}

// ── JSON export ───────────────────────────────────────────────────────────────

func (h *Handler) exportJSON(w http.ResponseWriter, recipe *models.Recipe) {
	exp := toExported(recipe)

	data, err := json.MarshalIndent(exp, "", "  ")
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to encode recipe")
		return
	}

	safeName := sanitizeFilename(recipe.Title)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.kitchenaid.json"`, safeName))
	w.WriteHeader(http.StatusOK)
	w.Write(data) //nolint:errcheck
}

// ── HTML export ───────────────────────────────────────────────────────────────

func (h *Handler) exportHTML(w http.ResponseWriter, recipe *models.Recipe) {
	exp := toExported(recipe)

	// Embed local uploads as base64 data URIs
	if strings.HasPrefix(exp.ImageURL, "/uploads/") {
		filename := strings.TrimPrefix(exp.ImageURL, "/uploads/")
		path := filepath.Join(h.UploadsDir, filename)
		if imgData, err := os.ReadFile(path); err == nil {
			mime := "image/jpeg"
			switch strings.ToLower(filepath.Ext(filename)) {
			case ".png":
				mime = "image/png"
			case ".webp":
				mime = "image/webp"
			case ".gif":
				mime = "image/gif"
			}
			exp.ImageURL = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(imgData)
		}
	}

	var buf bytes.Buffer
	if err := parsedHTMLTmpl.Execute(&buf, exp); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to render HTML: "+err.Error())
		return
	}

	safeName := sanitizeFilename(recipe.Title)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.html"`, safeName))
	w.WriteHeader(http.StatusOK)
	w.Write(buf.Bytes()) //nolint:errcheck
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func toExported(recipe *models.Recipe) exportedRecipe {
	exp := exportedRecipe{
		Title:        recipe.Title,
		Description:  recipe.Description,
		PrepTime:     recipe.PrepTime,
		CookTime:     recipe.CookTime,
		BaseServings: recipe.BaseServings,
		SourceURL:    recipe.SourceURL,
		ImageURL:     recipe.ImageURL,
		Tags:         recipe.Tags,
	}
	for _, ing := range recipe.Ingredients {
		exp.Ingredients = append(exp.Ingredients, exportedIngredient{
			Name:      ing.Name,
			Amount:    ing.Amount,
			Unit:      ing.Unit,
			Notes:     ing.Notes,
			SortOrder: ing.SortOrder,
		})
	}
	for _, step := range recipe.Steps {
		exp.Steps = append(exp.Steps, exportedStep{
			StepNumber:  step.StepNumber,
			Instruction: step.Instruction,
			Duration:    step.Duration,
		})
	}
	return exp
}

var nonAlnum = regexp.MustCompile(`[^a-zA-Z0-9]+`)

func sanitizeFilename(name string) string {
	s := nonAlnum.ReplaceAllString(name, "-")
	s = strings.Trim(s, "-")
	if len(s) > 60 {
		s = s[:60]
	}
	if s == "" {
		s = "recipe"
	}
	return s
}
