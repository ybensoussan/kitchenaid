package handlers

import (
	"kitchenaid/internal/models"
	"net/http"
	"strconv"
)

func (h *Handler) ListPantryItems(w http.ResponseWriter, r *http.Request) {
	items, err := h.Store.ListPantryItems()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []models.PantryItem{}
	}
	h.writeJSON(w, http.StatusOK, items)
}

func (h *Handler) CreatePantryItem(w http.ResponseWriter, r *http.Request) {
	var inp models.PantryItemInput
	if err := h.decodeJSON(r, &inp); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if inp.Name == "" {
		h.writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	item, err := h.Store.AddPantryItem(inp)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusCreated, item)
}

func (h *Handler) UpdatePantryItem(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var inp models.PantryItemInput
	if err := h.decodeJSON(r, &inp); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if inp.Name == "" {
		h.writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	item, err := h.Store.UpdatePantryItem(id, inp)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		h.writeError(w, http.StatusNotFound, "pantry item not found")
		return
	}
	h.writeJSON(w, http.StatusOK, item)
}

func (h *Handler) BatchAddPantryItems(w http.ResponseWriter, r *http.Request) {
	var items []models.PantryItemInput
	if err := h.decodeJSON(r, &items); err != nil || len(items) == 0 {
		h.writeError(w, http.StatusBadRequest, "items array required")
		return
	}
	added := 0
	for _, inp := range items {
		if inp.Name == "" {
			continue
		}
		if _, err := h.Store.AddPantryItem(inp); err == nil {
			added++
		}
	}
	h.writeJSON(w, http.StatusOK, map[string]int{"added": added})
}

func (h *Handler) DeletePantryItem(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Store.DeletePantryItem(id); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
