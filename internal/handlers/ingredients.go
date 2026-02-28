package handlers

import (
	"kitchenaid/internal/models"
	"net/http"
	"strconv"
)

func (h *Handler) AddIngredient(w http.ResponseWriter, r *http.Request) {
	recipeID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}
	var inp models.IngredientInput
	if err := h.decodeJSON(r, &inp); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	ing, err := h.Store.AddIngredient(recipeID, inp)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusCreated, ing)
}

func (h *Handler) UpdateIngredient(w http.ResponseWriter, r *http.Request) {
	recipeID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}
	iid, err := strconv.ParseInt(r.PathValue("iid"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid ingredient id")
		return
	}
	var inp models.IngredientInput
	if err := h.decodeJSON(r, &inp); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	ing, err := h.Store.UpdateIngredient(iid, recipeID, inp)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, ing)
}

func (h *Handler) DeleteIngredient(w http.ResponseWriter, r *http.Request) {
	recipeID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}
	iid, err := strconv.ParseInt(r.PathValue("iid"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid ingredient id")
		return
	}
	if err := h.Store.DeleteIngredient(iid, recipeID); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handler) ReorderIngredients(w http.ResponseWriter, r *http.Request) {
	recipeID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}
	var req models.ReorderRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if err := h.Store.ReorderIngredients(recipeID, req.IDs); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
