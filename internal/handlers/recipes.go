package handlers

import (
	"kitchenaid/internal/models"
	"net/http"
	"strconv"
)

func (h *Handler) ListRecipes(w http.ResponseWriter, r *http.Request) {
	recipes, err := h.Store.ListRecipes()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if recipes == nil {
		recipes = []models.Recipe{}
	}
	h.writeJSON(w, http.StatusOK, recipes)
}

func (h *Handler) CreateRecipe(w http.ResponseWriter, r *http.Request) {
	var req models.CreateRecipeRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Title == "" {
		h.writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	recipe, err := h.Store.CreateRecipe(req)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusCreated, recipe)
}

func (h *Handler) GetRecipe(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	recipe, err := h.Store.GetRecipe(id)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if recipe == nil {
		h.writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	h.writeJSON(w, http.StatusOK, recipe)
}

func (h *Handler) UpdateRecipe(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req models.CreateRecipeRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	recipe, err := h.Store.UpdateRecipe(id, req)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if recipe == nil {
		h.writeError(w, http.StatusNotFound, "recipe not found")
		return
	}
	h.writeJSON(w, http.StatusOK, recipe)
}

func (h *Handler) PatchRecipe(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req models.PatchRequest
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if err := h.Store.PatchRecipe(id, req.Field, req.Value); err != nil {
		h.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) DeleteRecipe(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Store.DeleteRecipe(id); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
