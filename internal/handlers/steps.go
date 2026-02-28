package handlers

import (
	"kitchenaid/internal/models"
	"net/http"
	"strconv"
)

func (h *Handler) AddStep(w http.ResponseWriter, r *http.Request) {
	recipeID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}
	var inp models.StepInput
	if err := h.decodeJSON(r, &inp); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	step, err := h.Store.AddStep(recipeID, inp)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusCreated, step)
}

func (h *Handler) UpdateStep(w http.ResponseWriter, r *http.Request) {
	recipeID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}
	sid, err := strconv.ParseInt(r.PathValue("sid"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid step id")
		return
	}
	var inp models.StepInput
	if err := h.decodeJSON(r, &inp); err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	step, err := h.Store.UpdateStep(sid, recipeID, inp)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, step)
}

func (h *Handler) DeleteStep(w http.ResponseWriter, r *http.Request) {
	recipeID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid recipe id")
		return
	}
	sid, err := strconv.ParseInt(r.PathValue("sid"), 10, 64)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "invalid step id")
		return
	}
	if err := h.Store.DeleteStep(sid, recipeID); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
