package handlers

import (
	"net/http"
	"strconv"
)

// ListMealPlans handles GET /api/plans
func (h *Handler) ListMealPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := h.Store.ListMealPlans()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, plans)
}

// CreateMealPlan handles POST /api/plans
func (h *Handler) CreateMealPlan(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name      string `json:"name"`
		WeekStart string `json:"week_start"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.WeekStart == "" {
		h.writeError(w, http.StatusBadRequest, "week_start is required")
		return
	}
	if req.Name == "" {
		req.Name = "Week of " + req.WeekStart
	}
	plan, err := h.Store.CreateMealPlan(req.Name, req.WeekStart)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusCreated, plan)
}

// GetMealPlan handles GET /api/plans/{id}
func (h *Handler) GetMealPlan(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	plan, err := h.Store.GetMealPlan(id)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if plan == nil {
		h.writeError(w, http.StatusNotFound, "plan not found")
		return
	}
	h.writeJSON(w, http.StatusOK, plan)
}

// DeleteMealPlan handles DELETE /api/plans/{id}
func (h *Handler) DeleteMealPlan(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Store.DeleteMealPlan(id); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// AddMealPlanEntry handles POST /api/plans/{id}/entries
func (h *Handler) AddMealPlanEntry(w http.ResponseWriter, r *http.Request) {
	planID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req struct {
		RecipeID int64  `json:"recipe_id"`
		Day      string `json:"day"`
		MealType string `json:"meal_type"`
		Servings int    `json:"servings"`
	}
	if err := h.decodeJSON(r, &req); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.RecipeID == 0 || req.Day == "" || req.MealType == "" {
		h.writeError(w, http.StatusBadRequest, "recipe_id, day, and meal_type are required")
		return
	}
	if req.Servings <= 0 {
		req.Servings = 1
	}
	entry, err := h.Store.AddMealPlanEntry(planID, req.RecipeID, req.Day, req.MealType, req.Servings)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusCreated, entry)
}

// DeleteMealPlanEntry handles DELETE /api/plans/{id}/entries/{eid}
func (h *Handler) DeleteMealPlanEntry(w http.ResponseWriter, r *http.Request) {
	planID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	entryID, err := strconv.ParseInt(r.PathValue("eid"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid entry id")
		return
	}
	if err := h.Store.DeleteMealPlanEntry(entryID, planID); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// GetGroceryList handles GET /api/plans/{id}/grocery
func (h *Handler) GetGroceryList(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	items, err := h.Store.GetGroceryList(id)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, items)
}
