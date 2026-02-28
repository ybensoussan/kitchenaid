package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

var allowedMIME = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
}

func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		h.writeError(w, http.StatusBadRequest, "failed to parse form")
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "image field required")
		return
	}
	defer file.Close()

	// Detect MIME from first 512 bytes
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	mime := http.DetectContentType(buf[:n])
	// Strip parameters
	if idx := strings.Index(mime, ";"); idx != -1 {
		mime = strings.TrimSpace(mime[:idx])
	}

	ext, ok := allowedMIME[mime]
	if !ok {
		// Fallback: try file extension from header
		origExt := strings.ToLower(strings.TrimPrefix(filepath.Ext(header.Filename), "."))
		for _, v := range []string{"jpg", "jpeg", "png", "webp"} {
			if origExt == v {
				if origExt == "jpeg" {
					origExt = "jpg"
				}
				ext = origExt
				ok = true
				break
			}
		}
		if !ok {
			h.writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported image type: %s", mime))
			return
		}
	}

	if err := os.MkdirAll(h.UploadsDir, 0755); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to create uploads dir")
		return
	}

	filename := uuid.New().String() + "." + ext
	dst, err := os.Create(filepath.Join(h.UploadsDir, filename))
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to create file")
		return
	}
	defer dst.Close()

	// Write the already-read bytes first, then the rest
	dst.Write(buf[:n])
	if _, err := io.Copy(dst, file); err != nil {
		h.writeError(w, http.StatusInternalServerError, "failed to save file")
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{
		"url": "/uploads/" + filename,
	})
}
