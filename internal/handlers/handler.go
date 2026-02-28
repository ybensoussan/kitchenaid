package handlers

import (
	"encoding/json"
	"kitchenaid/internal/db"
	"kitchenaid/internal/models"
	"net/http"
)

type Handler struct {
	Store      *db.Store
	UploadsDir string
	DBPath     string
}

func (h *Handler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(models.APIResponse{Data: data, Error: nil})
}

func (h *Handler) writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(models.APIResponse{Data: nil, Error: &msg})
}

func (h *Handler) decodeJSON(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}
