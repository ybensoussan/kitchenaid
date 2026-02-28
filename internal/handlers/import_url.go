package handlers

import (
	"kitchenaid/internal/models"
	"kitchenaid/internal/scraper"
	"net/http"
)

func (h *Handler) ImportURL(w http.ResponseWriter, r *http.Request) {
	var req models.ImportURLRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.URL == "" {
		h.writeError(w, http.StatusBadRequest, "url is required")
		return
	}

	result, err := scraper.ScrapeURL(req.URL)
	if err != nil {
		h.writeError(w, http.StatusUnprocessableEntity, "failed to import recipe: "+err.Error())
		return
	}

	h.writeJSON(w, http.StatusOK, result)
}

func (h *Handler) ImportHTML(w http.ResponseWriter, r *http.Request) {
	var req models.ImportHTMLRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.HTML == "" {
		h.writeError(w, http.StatusBadRequest, "html is required")
		return
	}

	result, err := scraper.ExtractJSONLD(req.HTML)
	if err != nil || result.Title == "" {
		h.writeError(w, http.StatusUnprocessableEntity, "could not find recipe data in the pasted HTML — make sure you copied the full page source")
		return
	}
	result.SourceURL = req.SourceURL

	h.writeJSON(w, http.StatusOK, result)
}
