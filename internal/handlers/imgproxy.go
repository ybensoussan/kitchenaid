package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

var imgProxyClient = &http.Client{Timeout: 30 * time.Second}

const (
	imgProxyMaxBytes int64 = 20 << 20
	imgThumbMaxDim         = 480 // max pixel side for cached thumbnails
	imgThumbQuality        = 82
)

// ProxyImage fetches a remote image, downscales it to a cache-friendly
// thumbnail, persists it to disk, and streams it with long-lived cache
// headers. Cache key is sha256(url); files live under <UploadsDir>/cache/.
func (h *Handler) ProxyImage(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("u")
	if raw == "" {
		http.Error(w, "missing u", http.StatusBadRequest)
		return
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}

	cacheDir := filepath.Join(h.UploadsDir, "cache")
	sum := sha256.Sum256([]byte(raw))
	path := filepath.Join(cacheDir, hex.EncodeToString(sum[:]))

	if info, err := os.Stat(path); err == nil && info.Size() > 0 {
		serveCachedImage(w, r, path, info)
		return
	}

	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		http.Error(w, "cache mkdir failed", http.StatusInternalServerError)
		return
	}

	req, _ := http.NewRequestWithContext(r.Context(), "GET", raw, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; KitchenAid/1.0)")
	req.Header.Set("Accept", "image/*,*/*;q=0.8")

	resp, err := imgProxyClient.Do(req)
	if err != nil {
		http.Error(w, "fetch failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf("upstream %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, imgProxyMaxBytes+1))
	if err != nil || int64(len(bodyBytes)) > imgProxyMaxBytes || len(bodyBytes) == 0 {
		http.Error(w, "read failed", http.StatusBadGateway)
		return
	}

	payload := bodyBytes
	if resized, ok := resizeForCache(bodyBytes); ok {
		payload = resized
	}

	if err := writeCache(cacheDir, path, payload); err != nil {
		http.Error(w, "cache write failed", http.StatusInternalServerError)
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		http.Error(w, "stat failed", http.StatusInternalServerError)
		return
	}
	serveCachedImage(w, r, path, info)
}

// resizeForCache decodes and downsizes large images to a cache-friendly JPEG
// thumbnail. Returns (resized, true) on success or (nil, false) if the image
// is already small, unknown-format, or non-rasterizable (e.g. SVG) — in which
// case the caller should persist the original bytes as-is.
func resizeForCache(src []byte) ([]byte, bool) {
	img, _, err := image.Decode(bytes.NewReader(src))
	if err != nil {
		return nil, false
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= imgThumbMaxDim && h <= imgThumbMaxDim && len(src) <= 120_000 {
		return nil, false
	}

	var nw, nh int
	if w >= h {
		nw = imgThumbMaxDim
		nh = h * imgThumbMaxDim / w
	} else {
		nh = imgThumbMaxDim
		nw = w * imgThumbMaxDim / h
	}
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: imgThumbQuality}); err != nil {
		return nil, false
	}
	return buf.Bytes(), true
}

func writeCache(dir, path string, data []byte) error {
	tmp, err := os.CreateTemp(dir, "tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return nil
}

func serveCachedImage(w http.ResponseWriter, r *http.Request, path string, info os.FileInfo) {
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, "open failed", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	// Empty name → http.ServeContent sniffs Content-Type from the first 512 bytes.
	http.ServeContent(w, r, "", info.ModTime(), f)
}
