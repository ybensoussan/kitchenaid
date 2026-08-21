package handlers

import (
	"net/http"
	"strconv"

	"kitchenaid/internal/models"
)

// ListGroceryItems handles GET /api/grocery
func (h *Handler) ListGroceryItems(w http.ResponseWriter, r *http.Request) {
	items, err := h.Store.ListGroceryItems()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, items)
}

// AddGroceryItems handles POST /api/grocery. Accepts either a single item or
// {"items": [...]} so a recipe can push its whole ingredient list in one call.
func (h *Handler) AddGroceryItems(w http.ResponseWriter, r *http.Request) {
	var req models.AddGroceryRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if len(req.Items) == 0 {
		h.writeError(w, http.StatusBadRequest, "items is required")
		return
	}
	for _, it := range req.Items {
		if it.Name == "" {
			h.writeError(w, http.StatusBadRequest, "every item needs a name")
			return
		}
	}
	if err := h.Store.AddGroceryItems(req.Items); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	items, err := h.Store.ListGroceryItems()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusCreated, items)
}

// UpdateGroceryItem handles PATCH /api/grocery/{id}
func (h *Handler) UpdateGroceryItem(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req models.UpdateGroceryRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if err := h.Store.UpdateGroceryItem(id, req); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

// DeleteGroceryItem handles DELETE /api/grocery/{id}
func (h *Handler) DeleteGroceryItem(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Store.DeleteGroceryItem(id); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]any{"deleted": id})
}

// ClearCheckedGroceryItems handles DELETE /api/grocery/checked
func (h *Handler) ClearCheckedGroceryItems(w http.ResponseWriter, r *http.Request) {
	n, err := h.Store.ClearCheckedGroceryItems()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]any{"deleted": n})
}

// ClearAllGroceryItems handles DELETE /api/grocery/all
func (h *Handler) ClearAllGroceryItems(w http.ResponseWriter, r *http.Request) {
	n, err := h.Store.ClearAllGroceryItems()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]any{"deleted": n})
}
