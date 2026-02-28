package handlers

import (
	"io"
	"net/http"
	"os"
)

func (h *Handler) ExportDB(w http.ResponseWriter, r *http.Request) {
	f, err := os.Open(h.DBPath)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to open database file")
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/x-sqlite3")
	w.Header().Set("Content-Disposition", "attachment; filename=kitchenaid.db")
	io.Copy(w, f)
}

func (h *Handler) ImportDB(w http.ResponseWriter, r *http.Request) {
	file, _, err := r.FormFile("database")
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "no database file provided")
		return
	}
	defer file.Close()

	// 1. Close current connection
	if err := h.Store.Close(); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to close current database connection")
		return
	}

	// 2. Replace the file
	out, err := os.Create(h.DBPath)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to overwrite database file")
		// Try to reopen if replacement failed
		h.Store.Reopen(h.DBPath)
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to save database file")
		h.Store.Reopen(h.DBPath)
		return
	}
	out.Close()

	// 3. Reopen the connection
	if err := h.Store.Reopen(h.DBPath); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to reopen database: "+err.Error())
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"status": "database imported successfully"})
}
