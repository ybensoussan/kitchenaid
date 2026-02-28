package handlers

import (
	"kitchenaid/internal/models"
	"net/http"
)

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.Store.GetSettings()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, settings)
}

func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings models.Settings
	if err := h.decodeJSON(r, &settings); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if settings.AIProvider != "anthropic" && settings.AIProvider != "gemini" {
		h.writeError(w, http.StatusBadRequest, "invalid provider")
		return
	}
	if err := h.Store.UpdateSettings(settings); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, settings)
}
